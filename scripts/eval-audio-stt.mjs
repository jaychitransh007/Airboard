#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
} from "../packages/core/src/semanticCapabilities.ts";
import {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
} from "../packages/core/src/semanticPlan.ts";
import {
  AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
} from "../apps/api/src/semanticIntent/contract.ts";
import {
  createDeepgramReplayAdapter,
  createFakeTranscriptionAdapter,
  createLiveGatewayWebSocketAdapter,
  createMeetBridgeReplayAdapter,
} from "./lib/audio-stt-eval/adapters.mjs";
import {
  loadAudioAssetManifest,
} from "./lib/audio-stt-eval/assets.mjs";
import {
  createFakeSemanticAdapter,
  createLiveSemanticApiAdapter,
  createRecordedSemanticAdapter,
} from "./lib/audio-stt-eval/semantic-adapters.mjs";
import {
  loadAudioSttScenarioCorpus,
  runAudioSttScenarios,
} from "./lib/audio-stt-eval/runner.mjs";
import { buildConfusionMatrix } from "./lib/confusion-matrix.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURE = resolve(ROOT, "evals/audio/stt-scenarios.v1.json");
const DEFAULT_MANIFEST = resolve(ROOT, "evals/audio/corpus.v1.json");

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return 0;
  }

  const fixturePath = resolve(
    process.cwd(),
    options.fixture ?? DEFAULT_FIXTURE,
  );
  const manifestPath = resolve(
    process.cwd(),
    options.manifest ?? DEFAULT_MANIFEST,
  );
  const corpus = await loadAudioSttScenarioCorpus(fixturePath);
  const mediaRoot =
    options.mediaRoot ??
    env.AIRBOARD_EVAL_MEDIA_ROOT ??
    undefined;
  const assetCatalog = await loadAudioAssetManifest(
    manifestPath,
    {
      mediaRoot,
      requireAssets: options.requireAssets,
    },
  );
  const externalScenarios = assetCatalog.listEvaluationScenarios();
  let scenarios = [...corpus.scenarios, ...externalScenarios];
  if (options.adapters.length > 0) {
    scenarios = scenarios.filter((scenario) =>
      options.adapters.includes(scenario.adapter),
    );
  }
  if (options.datasetSplit) {
    scenarios = scenarios.filter(
      (scenario) => scenario.datasetSplit === options.datasetSplit,
    );
  }
  if (options.maxScenarios !== undefined) {
    scenarios = selectRepresentativeScenarios(
      scenarios,
      options.maxScenarios,
    );
  }
  if (scenarios.length === 0) {
    throw new Error("No audio/STT scenarios matched the requested adapters.");
  }
  if (
    options.requireAssets &&
    !scenarios.some(
      (scenario) =>
        ["live-websocket", "meet-bridge-replay"].includes(
          scenario.adapter,
        ) &&
        typeof scenario.assetId === "string",
    )
  ) {
    throw new Error(
      "External audio assets are required, but no live direct or Meet bridge scenario references one.",
    );
  }

  const liveTranscriptionDefaults = {
    ...(options.wsUrl || env.AIRBOARD_EVAL_TRANSCRIPTION_WS_URL
      ? { url: options.wsUrl ?? env.AIRBOARD_EVAL_TRANSCRIPTION_WS_URL }
      : {}),
    ...(options.apiUrl || env.AIRBOARD_API_URL
      ? { apiBaseUrl: options.apiUrl ?? env.AIRBOARD_API_URL }
      : {}),
    ...(env.AIRBOARD_EVAL_ACCESS_TOKEN
      ? { accessToken: env.AIRBOARD_EVAL_ACCESS_TOKEN }
      : {}),
    ...(env.AIRBOARD_EVAL_API_TOKEN
      ? { apiToken: env.AIRBOARD_EVAL_API_TOKEN }
      : {}),
    origin:
      options.origin ??
      env.AIRBOARD_EVAL_ORIGIN ??
      "http://localhost:3000",
    timeoutMs: options.timeoutMs,
    frameDelayMs: options.frameDelayMs,
  };
  const adapters = [
    createFakeTranscriptionAdapter(),
    createDeepgramReplayAdapter(),
    createLiveGatewayWebSocketAdapter(liveTranscriptionDefaults),
    createMeetBridgeReplayAdapter(liveTranscriptionDefaults),
  ];
  const semanticModel =
    options.model ??
    env.AIRBOARD_EVAL_MODEL ??
    env.AIRBOARD_INTENT_MODEL ??
    undefined;
  const semanticAdapters = [
    createFakeSemanticAdapter(),
    createRecordedSemanticAdapter(),
    createLiveSemanticApiAdapter({
      apiBaseUrl:
        options.apiUrl ??
        env.AIRBOARD_API_URL ??
        "http://127.0.0.1:4000",
      origin:
        options.origin ??
        env.AIRBOARD_EVAL_ORIGIN ??
        "http://localhost:3000",
      model: semanticModel,
      timeoutMs: options.timeoutMs,
      accessToken: env.AIRBOARD_EVAL_ACCESS_TOKEN,
      apiToken: env.AIRBOARD_EVAL_API_TOKEN,
    }),
  ];
  const report = await runAudioSttScenarios({
    scenarios,
    adapters,
    semanticAdapters,
    assetCatalog,
    requireAssets: options.requireAssets,
  });
  const aggregate = aggregateMetrics(report, scenarios);
  const coverage = assetCatalog.coverageForResults(report.results);
  const gateFailures = evaluateAudioGates(aggregate);
  const inconclusive = aggregate.providerFailureRate > 0.05;
  const passed = gateFailures.length === 0 && !inconclusive;
  const output = {
    ...report,
    passed,
    inconclusive,
    gateFailures,
    aggregate,
    coverage,
    confusionMatrices: buildAudioConfusionMatrices(report.results, scenarios),
    metadata: {
      datasetHash: createHash("sha256")
        .update(await readFile(fixturePath))
        .update(await readFile(manifestPath))
        .digest("hex"),
      corpusVersion: assetCatalog.corpusVersion,
      generatedAt: new Date().toISOString(),
      semanticPlanContract: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
      semanticCapabilityRegistry:
        AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
      semanticPrompt: AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
      adapters: [...new Set(scenarios.map(({ adapter }) => adapter))].sort(),
      semanticAdapters: [
        ...new Set(
          report.results
            .map(({ assessment }) => assessment?.semantic?.provider)
            .filter(Boolean),
        ),
      ].sort(),
      semanticModels: [
        ...new Set(
          report.results
            .map(({ assessment }) => assessment?.semantic?.model)
            .filter(Boolean),
        ),
      ].sort(),
      datasetSplit: options.datasetSplit ?? null,
      replay: buildAudioReplayCommand(options),
    },
  };
  if (env.AIRBOARD_EVAL_OUTPUT_DIR) {
    const outputDirectory = resolve(env.AIRBOARD_EVAL_OUTPUT_DIR, "audio");
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(outputDirectory, "audio-results.json"),
        `${JSON.stringify(output, null, 2)}\n`,
      ),
      writeFile(
        resolve(outputDirectory, "audio-results.xml"),
        junit(output),
      ),
      writeFile(
        resolve(outputDirectory, "audio-results.md"),
        markdown(output),
      ),
      writeFile(
        resolve(outputDirectory, "audio-results.html"),
        html(output),
      ),
    ]);
  }

  console.log(
    `Airboard audio/STT evaluation: ${inconclusive ? "INCONCLUSIVE" : passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total} passed, ${report.summary.skipped} skipped)`,
  );
  console.log(
    `Assets: ${assetCatalog.declaredCount} declared; raw paths, audio, and transcripts are omitted from output.`,
  );
  for (const result of report.results) {
    if (result.status === "skipped") {
      console.log(`SKIP ${result.id} [${result.adapter}] external asset unavailable`);
      continue;
    }
    const assessment = result.assessment;
    console.log(
      `${result.status === "passed" ? "PASS" : "FAIL"} ${result.id} [${result.adapter}] critical=${formatScore(assessment?.criticalTokens.recall)} actionF1=${formatScore(assessment?.actionScore.f1)} finals=${assessment?.finalCount ?? 0}`,
    );
    for (const failure of assessment?.failures ?? result.failures ?? []) {
      console.log(`     - ${failure}`);
    }
  }
  for (const failure of gateFailures) {
    console.log(`GATE FAIL: ${failure}`);
  }
  if (inconclusive) {
    console.log(
      `INCONCLUSIVE: provider infrastructure failures ${(aggregate.providerFailureRate * 100).toFixed(1)}% exceed 5.0%.`,
    );
    return 2;
  }
  return passed ? 0 : 1;
}

function buildAudioConfusionMatrices(results, scenarios) {
  const scenariosById = new Map(
    scenarios.map((scenario) => [scenario.id, scenario]),
  );
  return {
    processingPath: buildConfusionMatrix(
      results.map((result) => ({
        expected:
          scenariosById.get(result.id)?.processingPath ?? "unknown",
        actual:
          result.assessment?.processingPath ??
          (result.failureClass === "provider_infrastructure"
            ? "provider_infrastructure"
            : result.status === "skipped"
              ? "asset_unavailable"
              : "invalid_output"),
      })),
    ),
    boardMutation: buildConfusionMatrix(
      results.map((result) => {
        const scenario = scenariosById.get(result.id);
        const expectedActions = scenario?.oracle?.expectedActions ?? [];
        const observedActions = result.assessment?.routedActions ?? [];
        return {
          expected: expectedActions.length > 0 ? "mutation" : "no_mutation",
          actual: observedActions.length > 0 ? "mutation" : "no_mutation",
        };
      }),
    ),
  };
}

export function aggregateMetrics(report, scenarios) {
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const assessed = report.results.filter(({ assessment }) => assessment);
  const expectedCriticalTokens = assessed.reduce(
    (sum, { assessment }) => sum + assessment.criticalTokens.expected,
    0,
  );
  const matchedCriticalTokens = assessed.reduce(
    (sum, { assessment }) => sum + assessment.criticalTokens.matched,
    0,
  );
  const criticalTokenRoleTotals = new Map();
  for (const { assessment } of assessed) {
    for (const [role, observation] of Object.entries(
      assessment.criticalTokens.roles ?? {},
    )) {
      const totals = criticalTokenRoleTotals.get(role) ?? {
        expected: 0,
        matched: 0,
      };
      totals.expected += observation.expected;
      totals.matched += observation.matched;
      criticalTokenRoleTotals.set(role, totals);
    }
  }
  const actionExact = assessed.filter(
    ({ assessment }) =>
      assessment.actionScore.exact &&
      assessment.boardOutcome?.passed === true,
  ).length;
  const providerFailures = report.results.filter(
    ({ failureClass }) => failureClass === "provider_infrastructure",
  ).length;
  const qualityResults = report.results.filter(
    ({ assessment }) => assessment,
  );
  const coreResults = qualityResults.filter(({ id }) =>
    isCoreAudioScenario(scenariosById.get(id)),
  );
  const safetyResults = qualityResults.filter(({ id }) =>
    isSafetyAudioScenario(scenariosById.get(id)),
  );
  const deterministicEndToAction = assessed
    .filter(
      ({ assessment }) =>
        assessment.processingPath === "deterministic",
    )
    .map(({ assessment }) => assessment.endToActionMs)
    .filter(Number.isFinite);
  const semanticEndToAction = assessed
    .filter(
      ({ assessment }) => assessment.processingPath === "semantic",
    )
    .map(({ assessment }) => assessment.endToActionMs)
    .filter(Number.isFinite);
  return {
    assessedScenarioCount: assessed.length,
    criticalTokenCount: expectedCriticalTokens,
    coreScenarioCount: coreResults.length,
    safetyScenarioCount: safetyResults.length,
    positiveActionScenarioCount: qualityResults.filter(
      ({ assessment }) => assessment.routedActions.length > 0,
    ).length,
    criticalTokenRecall:
      expectedCriticalTokens === 0
        ? 1
        : matchedCriticalTokens / expectedCriticalTokens,
    criticalTokenRecallByRole: Object.fromEntries(
      [...criticalTokenRoleTotals.entries()].map(([role, totals]) => [
        role,
        {
          ...totals,
          recall:
            totals.expected === 0
              ? 1
              : totals.matched / totals.expected,
        },
      ]),
    ),
    downstreamActionCorrectness:
      assessed.length === 0 ? 0 : actionExact / assessed.length,
    coreActionCorrectness:
      coreResults.length === 0
        ? 1
        : coreResults.filter(
            ({ assessment }) =>
              assessment.actionScore.exact &&
              assessment.boardOutcome?.passed === true,
          )
            .length / coreResults.length,
    safetyActionPrecision:
      safetyResults.length === 0
        ? 1
        : safetyResults.filter(
            ({ assessment }) =>
              assessment.actionScore.precision === 1 &&
              assessment.routedActions.length === 0 &&
              assessment.boardOutcome?.boardEventCount === 0,
          ).length / safetyResults.length,
    hardFalseActions: assessed.reduce(
      (sum, { assessment }) =>
        sum +
        (assessment.actionScore.precision < 1
          ? assessment.routedActions.length
          : 0) +
        (assessment.routedActions.length === 0
          ? assessment.boardOutcome?.boardEventCount ?? 0
          : 0),
      0,
    ),
    providerFailures,
    providerFailureRate:
      report.summary.total === 0 ? 0 : providerFailures / report.summary.total,
    qualityFailures: Math.max(0, report.summary.failed - providerFailures),
    durationP95Ms: percentile(
      report.results.map(({ durationMs }) => durationMs),
      0.95,
    ),
    deterministicEndToActionP95Ms: percentile(
      deterministicEndToAction,
      0.95,
    ),
    semanticEndToActionP95Ms: percentile(
      semanticEndToAction,
      0.95,
    ),
    slices: buildAudioSlices(qualityResults, scenariosById),
  };
}

export function evaluateAudioGates(aggregate) {
  const failures = [];
  if (aggregate.assessedScenarioCount === 0) {
    failures.push("audio evaluation has no scored scenarios");
  }
  if (aggregate.criticalTokenCount === 0) {
    failures.push(
      "audio evaluation has no command-critical token observations",
    );
  }
  if (aggregate.coreScenarioCount === 0) {
    failures.push("audio evaluation has no core command scenarios");
  }
  if (aggregate.positiveActionScenarioCount === 0) {
    failures.push("audio evaluation has no positive downstream action scenarios");
  }
  if (aggregate.criticalTokenRecall < 0.97) {
    failures.push(
      `command-critical token recall ${(aggregate.criticalTokenRecall * 100).toFixed(2)}% is below 97.00%`,
    );
  }
  for (const [role, observation] of Object.entries(
    aggregate.criticalTokenRecallByRole ?? {},
  )) {
    if (observation.recall < 0.97) {
      failures.push(
        `command-critical ${role} token recall ${(observation.recall * 100).toFixed(2)}% is below 97.00%`,
      );
    }
  }
  if (aggregate.coreActionCorrectness < 0.95) {
    failures.push(
      `core downstream action correctness ${(aggregate.coreActionCorrectness * 100).toFixed(2)}% is below 95.00%`,
    );
  }
  if (aggregate.downstreamActionCorrectness < 0.9) {
    failures.push(
      `overall downstream action correctness ${(aggregate.downstreamActionCorrectness * 100).toFixed(2)}% is below 90.00%`,
    );
  }
  if (aggregate.hardFalseActions !== 0) {
    failures.push(
      `hard false actions must be zero; observed ${aggregate.hardFalseActions}`,
    );
  }
  if (aggregate.safetyActionPrecision < 1) {
    failures.push(
      `unsupported/ambient mutation precision must be 100%; observed ${(aggregate.safetyActionPrecision * 100).toFixed(2)}%`,
    );
  }
  if (
    Number.isFinite(aggregate.deterministicEndToActionP95Ms) &&
    aggregate.deterministicEndToActionP95Ms >= 1_000
  ) {
    failures.push(
      `deterministic end-to-action p95 ${Math.round(aggregate.deterministicEndToActionP95Ms)}ms must be below 1000ms`,
    );
  }
  if (
    Number.isFinite(aggregate.semanticEndToActionP95Ms) &&
    aggregate.semanticEndToActionP95Ms >= 2_500
  ) {
    failures.push(
      `semantic end-to-action p95 ${Math.round(aggregate.semanticEndToActionP95Ms)}ms must be below 2500ms`,
    );
  }
  for (const [sliceId, slice] of Object.entries(aggregate.slices ?? {})) {
    if (slice.accuracy < 0.85) {
      failures.push(
        `audio slice ${sliceId} ${(slice.accuracy * 100).toFixed(2)}% is below 85.00%`,
      );
    }
  }
  return failures;
}

export function buildAudioSlices(results, scenariosById) {
  const slices = new Map();
  const participantSlices = new Map();
  for (const result of results) {
    const scenario = scenariosById.get(result.id);
    const passed =
      result.assessment.actionScore.exact &&
      result.assessment.boardOutcome?.passed === true
        ? 1
        : 0;
    const ids = new Set();
    if (scenario?.accent === "en-IN") ids.add("indian_english");
    for (const [prefix, value] of [
      ["accent", scenario?.accent],
      ["microphone", scenario?.microphone],
      ["distance", scenario?.distance],
      ["length", scenario?.lengthClass],
      ["surface", scenario?.surface],
    ]) {
      const normalized = safeSliceComponent(value);
      if (normalized) ids.add(`${prefix}_${normalized}`);
    }
    for (const condition of scenario?.conditions ?? []) {
      const normalized = safeSliceComponent(condition);
      if (normalized) ids.add(`condition_${normalized}`);
    }
    for (const id of ids) {
      const values = slices.get(id) ?? [];
      values.push(passed);
      slices.set(id, values);
    }
    if (typeof scenario?.participantId === "string") {
      const values = participantSlices.get(scenario.participantId) ?? [];
      values.push(passed);
      participantSlices.set(scenario.participantId, values);
    }
  }
  const reported = Object.fromEntries(
    [...slices.entries()].map(([id, values]) => [
      id,
      {
        accuracy:
          values.reduce((sum, value) => sum + value, 0) / values.length,
        critical: true,
        count: values.length,
      },
    ]),
  );
  if (participantSlices.size > 0) {
    const participantAccuracies = [...participantSlices.values()].map(
      (values) =>
        values.reduce((sum, value) => sum + value, 0) / values.length,
    );
    reported.participant_minimum = {
      accuracy: Math.min(...participantAccuracies),
      critical: true,
      count: participantSlices.size,
    };
  }
  return reported;
}

function safeSliceComponent(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "");
  return /^[a-z0-9][a-z0-9_]{0,63}$/u.test(normalized)
    ? normalized
    : null;
}

function isCoreAudioScenario(scenario) {
  if (!scenario) return false;
  if (scenario.evaluationClass) return scenario.evaluationClass === "core";
  const actions = scenario.oracle.expectedActions ?? [];
  return actions.length === 1;
}

function isSafetyAudioScenario(scenario) {
  if (!scenario) return false;
  if (scenario.evaluationClass) return scenario.evaluationClass === "safety";
  return (
    scenario.oracle.maximumRoutedActions === 0 ||
    (scenario.oracle.expectedActions ?? []).length === 0
  );
}

function junit(report) {
  const gateFailureCount = report.gateFailures.length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Airboard audio/STT" tests="${report.summary.total + gateFailureCount}" failures="${report.aggregate.qualityFailures + gateFailureCount}" errors="${report.aggregate.providerFailures}" skipped="${report.summary.skipped}">`,
  ];
  for (const result of report.results) {
    lines.push(
      `  <testcase classname="audio-stt.${xml(result.adapter)}" name="${xml(result.id)}" time="${(result.durationMs / 1000).toFixed(3)}">`,
    );
    if (result.status === "skipped") {
      lines.push('    <skipped message="External asset unavailable"/>');
    } else if (result.status === "failed") {
      const details = result.assessment?.failures ?? result.failures ?? [];
      const provider = details.some((failure) =>
        failure.startsWith("provider infrastructure error:"),
      );
      const tag = provider ? "error" : "failure";
      lines.push(
        `    <${tag} message="${provider ? "provider infrastructure" : "quality gate"}">${xml(details.join("\n"))}</${tag}>`,
      );
    }
    lines.push("  </testcase>");
  }
  report.gateFailures.forEach((failure, index) => {
    lines.push(
      `  <testcase classname="audio-stt.release-gate" name="aggregate-${index + 1}"><failure message="quality gate">${xml(failure)}</failure></testcase>`,
    );
  });
  lines.push(
    `  <system-out>${xml(JSON.stringify({ confusionMatrices: report.confusionMatrices }, null, 2))}</system-out>`,
  );
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

function markdown(report) {
  const lines = [
    "# Airboard audio/STT evaluation",
    "",
    `Dataset: \`${report.metadata.datasetHash}\`  `,
    `Replay: \`${report.metadata.replay}\``,
    "",
    `Passed **${report.summary.passed}/${report.summary.total}**; failed ${report.summary.failed}; skipped ${report.summary.skipped}. Critical-token recall: ${(report.aggregate.criticalTokenRecall * 100).toFixed(2)}%. Downstream action correctness: ${(report.aggregate.downstreamActionCorrectness * 100).toFixed(2)}%.`,
    "",
    "## Gate failures",
    "",
    ...(report.gateFailures.length
      ? report.gateFailures.map((failure) => `- ${failure}`)
      : ["- None"]),
    "",
    "| Status | Scenario | Adapter | Critical recall | Action F1 |",
    "| --- | --- | --- | ---: | ---: |",
  ];
  for (const result of report.results) {
    lines.push(
      `| ${result.status.toUpperCase()} | ${result.id} | ${result.adapter} | ${formatScore(result.assessment?.criticalTokens.recall)} | ${formatScore(result.assessment?.actionScore.f1)} |`,
    );
  }
  appendAudioConfusionMarkdown(lines, report.confusionMatrices);
  return `${lines.join("\n")}\n`;
}

function html(report) {
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${xml(result.status.toUpperCase())}</td><td>${xml(result.id)}</td><td>${xml(result.adapter)}</td><td>${xml(formatScore(result.assessment?.criticalTokens.recall))}</td><td>${xml(formatScore(result.assessment?.actionScore.f1))}</td></tr>`,
    )
    .join("\n");
  const confusion = renderAudioConfusionHtml(report.confusionMatrices);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Airboard audio/STT evaluation</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}</style></head>
<body><h1>Airboard audio/STT evaluation</h1><p><strong>${report.summary.passed}/${report.summary.total} passed</strong>. Dataset <code>${xml(report.metadata.datasetHash)}</code>.</p><h2>Gate failures</h2><ul>${(report.gateFailures.length ? report.gateFailures : ["None"]).map((failure) => `<li>${xml(failure)}</li>`).join("")}</ul>${confusion}<table><thead><tr><th>Status</th><th>Scenario</th><th>Adapter</th><th>Critical recall</th><th>Action F1</th></tr></thead><tbody>${rows}</tbody></table></body></html>
`;
}

function appendAudioConfusionMarkdown(lines, matrices) {
  for (const [name, matrix] of Object.entries(matrices ?? {})) {
    if (!Array.isArray(matrix?.labels) || !matrix.matrix) continue;
    lines.push(
      "",
      `## Confusion matrix: ${name}`,
      "",
      `| Expected \\ Actual | ${matrix.labels.join(" | ")} |`,
      `| --- | ${matrix.labels.map(() => "---:").join(" | ")} |`,
    );
    for (const expected of matrix.labels) {
      lines.push(
        `| ${expected} | ${matrix.labels
          .map((actual) => matrix.matrix[expected]?.[actual] ?? 0)
          .join(" | ")} |`,
      );
    }
  }
}

function renderAudioConfusionHtml(matrices) {
  return Object.entries(matrices ?? {})
    .filter(([, matrix]) => Array.isArray(matrix?.labels) && matrix.matrix)
    .map(
      ([name, matrix]) =>
        `<section><h2>Confusion matrix: ${xml(name)}</h2><table><thead><tr><th>Expected \\ Actual</th>${matrix.labels.map((label) => `<th>${xml(label)}</th>`).join("")}</tr></thead><tbody>${matrix.labels.map((expected) => `<tr><th>${xml(expected)}</th>${matrix.labels.map((actual) => `<td>${matrix.matrix[expected]?.[actual] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`,
    )
    .join("");
}

function percentile(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseArguments(args) {
  const options = {
    adapters: [],
    frameDelayMs: 80,
    help: false,
    requireAssets: false,
    timeoutMs: 30_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--require-assets") {
      options.requireAssets = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value.`);
    switch (name) {
      case "--fixture":
        options.fixture = value;
        break;
      case "--manifest":
        options.manifest = value;
        break;
      case "--media-root":
        options.mediaRoot = value;
        break;
      case "--adapter":
        options.adapters.push(value);
        break;
      case "--dataset-split":
        if (!["development", "regression", "holdout"].includes(value)) {
          throw new Error(
            "--dataset-split must be development, regression, or holdout.",
          );
        }
        options.datasetSplit = value;
        break;
      case "--ws-url":
        options.wsUrl = value;
        break;
      case "--api-url":
        options.apiUrl = value;
        break;
      case "--origin":
        options.origin = value;
        break;
      case "--model":
        options.model = value;
        break;
      case "--timeout-ms":
        options.timeoutMs = boundedInteger(value, name, 100, 120_000);
        break;
      case "--frame-delay-ms":
        options.frameDelayMs = boundedInteger(value, name, 0, 1_000);
        break;
      case "--max-scenarios":
        options.maxScenarios = boundedInteger(value, name, 1, 10_000);
        break;
      default:
        throw new Error(`Unknown argument: ${name}.`);
    }
  }
  return options;
}

function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/eval-audio-stt.mjs [options]

Options:
  --fixture PATH          Scenario corpus (evals/audio/stt-scenarios.v1.json)
  --manifest PATH         Privacy/hash manifest (evals/audio/corpus.v1.json)
  --media-root PATH       Restricted asset mount (AIRBOARD_EVAL_MEDIA_ROOT)
  --adapter NAME          Run one adapter; may be repeated (Meet assets require meet-bridge-replay)
  --dataset-split NAME    Restrict external assets to development/regression/holdout
  --ws-url URL            Live Airboard transcription WebSocket URL
  --api-url URL           Airboard API base URL used to derive /transcription/ws
  --origin URL            Allowed Origin header for the live gateway
  --model MODEL           Allowlisted semantic model for audio fallback
  --timeout-ms N          Live scenario timeout, 100-120000 (default 30000)
  --frame-delay-ms N      PCM frame pacing, 0-1000 (default 80)
  --max-scenarios N       Deterministic diversity-first subset (for canaries)
  --require-assets        Fail closed unless mounted external WAV evals exist
  --help                  Show this help
`);
}

function buildAudioReplayCommand(options) {
  const args = ["node", "scripts/eval-audio-stt.mjs"];
  for (const adapter of options.adapters) {
    args.push("--adapter", adapter);
  }
  if (options.datasetSplit) {
    args.push("--dataset-split", options.datasetSplit);
  }
  if (options.requireAssets) args.push("--require-assets");
  if (options.apiUrl) args.push("--api-url", options.apiUrl);
  if (options.origin) args.push("--origin", options.origin);
  if (options.model) args.push("--model", options.model);
  if (options.timeoutMs !== 30_000) {
    args.push("--timeout-ms", String(options.timeoutMs));
  }
  if (options.frameDelayMs !== 80) {
    args.push("--frame-delay-ms", String(options.frameDelayMs));
  }
  if (options.maxScenarios !== undefined) {
    args.push("--max-scenarios", String(options.maxScenarios));
  }
  return args.map(shellQuote).join(" ");
}

/**
 * Select a stable canary subset without relying on manifest order. Each pass
 * greedily covers new channel/path/class/adapter/device facets before filling
 * the remaining budget by stable ID. The normal nightly/release paths do not
 * use a limit.
 */
export function selectRepresentativeScenarios(scenarios, maximum) {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new TypeError("maximum must be a positive integer");
  }
  const remaining = [...scenarios].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  if (remaining.length <= maximum) return remaining;

  const selected = [];
  const covered = new Set();
  while (selected.length < maximum && remaining.length > 0) {
    let bestIndex = 0;
    let bestGain = -1;
    for (const [index, scenario] of remaining.entries()) {
      const gain = scenarioFacets(scenario).filter(
        (facet) => !covered.has(facet),
      ).length;
      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = index;
      }
    }
    const [scenario] = remaining.splice(bestIndex, 1);
    selected.push(scenario);
    for (const facet of scenarioFacets(scenario)) covered.add(facet);
  }
  return selected;
}

function scenarioFacets(scenario) {
  return [
    ["adapter", scenario.adapter],
    ["channel", scenario.channel],
    ["class", scenario.evaluationClass],
    ["path", scenario.processingPath],
    ["surface", scenario.surface],
    ["accent", scenario.accent],
    ["microphone", scenario.microphone],
    ["distance", scenario.distance],
    ["length", scenario.lengthClass],
    ...(Array.isArray(scenario.conditions)
      ? scenario.conditions.map((condition) => ["condition", condition])
      : []),
  ]
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([kind, value]) => `${kind}:${value}`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatScore(value) {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Audio/STT evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 2;
    });
}
