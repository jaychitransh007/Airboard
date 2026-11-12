#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const tier = options.tier ?? "pr";
const runId =
  process.env.AIRBOARD_EVAL_RUN_ID ??
  `${tier}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDirectory = resolve(
  process.cwd(),
  options.outputDir ?? `artifacts/evals/${runId}`,
);

const coreBrowserFiles = [
  "e2e/typedCommand.spec.ts",
  "e2e/voiceRouting.spec.ts",
  "e2e/diagramVisibility.spec.ts",
  "e2e/catalogDock.spec.ts",
  "e2e/directInputChannels.spec.ts",
  "e2e/mediaOwnership.spec.ts",
];

const suites = {
  pr: [
    nodeStep("dataset-policy", "scripts/validate-eval-datasets.mjs"),
    nodeStep("capability-coverage", "scripts/eval-capability-coverage.mjs"),
    nodeStep(
      "capability-coverage-tests",
      "--test",
      "scripts/test/capability-coverage.test.mjs",
      "apps/web/test/capabilityCoverageEvidence.test.mjs",
      "apps/web/test/inputCapabilities.test.mjs",
    ),
    nodeStep(
      "release-quality-policy-tests",
      "--test",
      "scripts/test/eval-quality-gate.test.mjs",
      "scripts/test/eval-quality-report.test.mjs",
    ),
    nodeStep(
      "release-quality-report-policy",
      "scripts/eval-quality-report.mjs",
      "--mode",
      "pr",
      "--output",
      resolve(outputDirectory, "quality-report-policy.json"),
    ),
    nodeStep(
      "release-quality-policy",
      "scripts/eval-quality-gate.mjs",
      "--mode",
      "pr",
      "--output",
      resolve(outputDirectory, "quality-policy.json"),
    ),
    nodeStep(
      "interaction-foundation-tests",
      "--test",
      "scripts/test/interaction-eval-foundation.test.mjs",
    ),
    nodeStep(
      "end-to-end-evaluator-tests",
      "--test",
      "scripts/test/audio-stt-eval.test.mjs",
      "scripts/test/confusion-matrix.test.mjs",
      "scripts/test/eval-suite-composition.test.mjs",
      "scripts/test/gesture-browser-evidence.test.mjs",
      "scripts/test/gesture-eval-report.test.mjs",
      "scripts/test/launch-ready-check.test.mjs",
      "scripts/test/seeded-faults.test.mjs",
      "scripts/test/semantic-grounding-eval.test.mjs",
      "scripts/test/semantic-live-runner.test.mjs",
      "scripts/test/semantic-metamorphic-corpus.test.mjs",
      "scripts/test/semantic-negatives.test.mjs",
    ),
    nodeStep("deterministic-contract-matrix", "scripts/eval-contract-matrix.mjs"),
    nodeStep("deterministic-positive-corpus", "scripts/eval-grammar.mjs"),
    nodeStep("grounded-ambient-negatives", "scripts/eval-false-accepts.mjs"),
    nodeStep(
      "semantic-ambient-negative-replay",
      "scripts/eval-semantic-negatives.mjs",
      "--replay",
    ),
    nodeStep("provider-event-replay", "scripts/eval-provider-events.mjs"),
    nodeStep("seeded-evaluator-faults", "scripts/eval-seeded-faults.mjs"),
    nodeStep(
      "canonical-interactions",
      "scripts/eval-interactions.mjs",
      "--output-dir",
      resolve(outputDirectory, "interactions"),
    ),
    nodeStep("landmark-replay", "scripts/eval-gesture-replay.mjs"),
    nodeStep(
      "production-coordinator-tests",
      "--test",
      "apps/web/test/commandTurnCoordinator.test.mjs",
      "apps/web/test/gestureActionEvidence.test.mjs",
      "apps/web/test/gestureFrameCoordinator.test.mjs",
      "apps/web/test/gesturePerceptionConfig.test.mjs",
      "apps/web/test/interactionAttribution.test.mjs",
      "apps/web/test/inputCapabilities.test.mjs",
      "apps/web/test/realDeviceMediaEval.test.mjs",
      "apps/web/test/voiceTrace.test.mjs",
    ),
    nodeStep(
      "existing-board-fan-in-regressions",
      "--test",
      "apps/web/test/existingBoardFanIn.test.mjs",
      "apps/web/test/intentPipeline.test.mjs",
      "apps/web/test/semanticIntent.test.mjs",
      "apps/api/test/semanticIntentRoutes.test.mjs",
      "apps/api/test/voiceTrace.test.mjs",
    ),
    nodeStep(
      "semantic-metamorphic-contract",
      "scripts/eval-semantic-metamorphic.mjs",
      "--validate-only",
    ),
    nodeStep(
      "semantic-ambient-negative-contract",
      "scripts/eval-semantic-negatives.mjs",
      "--validate-only",
    ),
    nodeStep("audio-adapter-replay", "scripts/eval-audio-stt.mjs"),
    ...(options.skipBrowser
      ? []
      : [
          commandStep(
            "core-browser-journeys",
            "pnpm",
            [
              "--filter",
              "@airboard/web",
              "exec",
              "playwright",
              "test",
              ...coreBrowserFiles,
            ],
          ),
        ]),
  ],
};

main().catch((error) => {
  console.error(
    `Eval suite could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const steps = suites[tier];
  if (!steps) throw new Error(`Unknown eval tier: ${tier}`);
  await mkdir(outputDirectory, { recursive: true });
  const results = [];
  for (const step of steps) {
    const result = await runStep(step);
    results.push(result);
    console.log(
      `${statusLabel(result.status)} ${step.id} (${formatMs(result.durationMs)})`,
    );
    if (result.status !== "passed") {
      const tail = result.output.trim().split(/\r?\n/u).slice(-12);
      for (const line of tail) console.log(`  ${line}`);
      if (!options.keepGoing) break;
    }
  }
  const report = {
    schemaVersion: "airboard-eval-suite-result.v1",
    tier,
    runId,
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ci: Boolean(process.env.CI),
    },
    datasetHash: await hashEvalManifests(resolve(ROOT, "evals")),
    versions: {
      semanticPlanContract: "production-imported",
      semanticPrompt: "production-response-metadata",
      semanticModel:
        process.env.AIRBOARD_SEMANTIC_INTENT_MODEL ??
        process.env.AIRBOARD_INTENT_MODEL ??
        "provider-default",
      transcriptionModel:
        process.env.AIRBOARD_TRANSCRIPTION_MODEL ??
        process.env.DEEPGRAM_MODEL ??
        "provider-default",
    },
    results,
    summary: summarize(results),
    replay: `node scripts/run-eval-suite.mjs --tier ${tier}`,
  };
  await Promise.all([
    writeFile(
      resolve(outputDirectory, "suite-results.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(resolve(outputDirectory, "suite-results.xml"), junit(report)),
    writeFile(resolve(outputDirectory, "suite-results.md"), markdown(report)),
    writeFile(resolve(outputDirectory, "suite-results.html"), html(report)),
  ]);
  console.log(`Artifacts: ${outputDirectory}`);

  if (report.summary.failed > 0) process.exitCode = 1;
}

async function runStep(step) {
  const result = await spawnStep(step);
  return {
    ...result,
    status: result.exitCode === 0 ? "passed" : "failed",
    failureClass: result.exitCode === 0 ? null : "quality_or_contract",
  };
}

function spawnStep(step) {
  return new Promise((resolveStep) => {
    const startedAt = performance.now();
    const child = spawn(step.command, step.args, {
      cwd: ROOT,
      env: {
        ...process.env,
        AIRBOARD_EVAL_OUTPUT_DIR: outputDirectory,
        AIRBOARD_EVAL_RUN_ID: runId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      resolveStep({
        id: step.id,
        command: replayCommand(step),
        exitCode: 2,
        durationMs: performance.now() - startedAt,
        output: error.message,
        attempts: 1,
      });
    });
    child.on("close", (code, signal) => {
      resolveStep({
        id: step.id,
        command: replayCommand(step),
        exitCode: code ?? 2,
        signal: signal ?? null,
        durationMs: performance.now() - startedAt,
        output,
        attempts: 1,
      });
    });
  });
}

function nodeStep(id, ...args) {
  return commandStep(id, process.execPath, args);
}

function commandStep(id, command, args) {
  return { id, command, args };
}

function replayCommand(step) {
  return [step.command, ...step.args]
    .map((part) => (/[\s"']/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function summarize(results) {
  return {
    total: results.length,
    passed: results.filter(({ status }) => status === "passed").length,
    failed: results.filter(({ status }) => status === "failed").length,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
  };
}

function junit(report) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Airboard eval:${xml(report.tier)}" tests="${report.summary.total}" failures="${report.summary.failed}" time="${(report.summary.durationMs / 1000).toFixed(3)}">`,
  ];
  for (const result of report.results) {
    lines.push(
      `  <testcase classname="eval.${xml(report.tier)}" name="${xml(result.id)}" time="${(result.durationMs / 1000).toFixed(3)}">`,
    );
    if (result.status === "failed") {
      lines.push(
        `    <failure message="${xml(result.failureClass)}">${xml(result.output)}</failure>`,
      );
    }
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

function markdown(report) {
  const lines = [
    `# Airboard ${report.tier} evaluation`,
    "",
    `Commit: \`${report.commit}\`  `,
    `Run: \`${report.runId}\`  `,
    `Dataset: \`${report.datasetHash}\`  `,
    `Replay: \`${report.replay}\``,
    "",
    `Passed **${report.summary.passed}/${report.summary.total}**. Failed: ${report.summary.failed}.`,
    "",
    "| Status | Step | Duration | Replay |",
    "| --- | --- | ---: | --- |",
  ];
  for (const result of report.results) {
    lines.push(
      `| ${statusLabel(result.status)} | ${result.id} | ${formatMs(result.durationMs)} | \`${result.command.replaceAll("`", "\\`")}\` |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function html(report) {
  const rows = report.results
    .map(
      (result) => `<tr>
  <td class="${xml(result.status)}">${xml(statusLabel(result.status))}</td>
  <td>${xml(result.id)}</td>
  <td>${xml(formatMs(result.durationMs))}</td>
  <td><code>${xml(result.command)}</code></td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Airboard ${xml(report.tier)} evaluation</title>
  <style>
    body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17202a}
    table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #d9dee3;text-align:left}
    code{white-space:pre-wrap}.passed{color:#08783d}.failed{color:#b42318}
  </style>
</head>
<body>
  <h1>Airboard ${xml(report.tier)} evaluation</h1>
  <p>Commit <code>${xml(report.commit)}</code><br>Dataset <code>${xml(report.datasetHash)}</code><br>Replay <code>${xml(report.replay)}</code></p>
  <p><strong>${report.summary.passed}/${report.summary.total} passed</strong>; ${report.summary.failed} failed.</p>
  <table><thead><tr><th>Status</th><th>Step</th><th>Duration</th><th>Replay</th></tr></thead><tbody>
${rows}
  </tbody></table>
</body>
</html>
`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tier") result.tier = argv[++index];
    else if (arg.startsWith("--tier=")) result.tier = arg.slice(7);
    else if (arg === "--output-dir") result.outputDir = argv[++index];
    else if (arg === "--skip-browser") result.skipBrowser = true;
    else if (arg === "--keep-going") result.keepGoing = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? "unknown";
  }
}

async function hashEvalManifests(directory) {
  const paths = [];
  await walk(directory, paths);
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    hash.update(path.slice(directory.length));
    hash.update(await readFile(path));
  }
  return `sha256:${hash.digest("hex")}`;
}

async function walk(directory, paths) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, paths);
    else if (entry.isFile() && entry.name.endsWith(".json")) paths.push(path);
  }
}

function statusLabel(status) {
  return status === "passed" ? "PASS" : "FAIL";
}

function formatMs(value) {
  return value < 1_000 ? `${value.toFixed(0)}ms` : `${(value / 1_000).toFixed(1)}s`;
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
