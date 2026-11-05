#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA,
  AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS,
  parseSemanticPlan,
  SEMANTIC_PLAN_ISSUE_CODES,
  SEMANTIC_PLAN_MISSING_SLOTS,
  SEMANTIC_PLAN_RESOLUTION_STATUSES,
} from "../packages/core/src/semanticPlan.ts";
import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
} from "../packages/core/src/semanticCapabilities.ts";
import {
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
} from "../apps/api/src/semanticIntent/types.ts";
import {
  AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
} from "../apps/api/src/semanticIntent/contract.ts";
import {
  evaluateGroundedSemanticPlan,
  evaluateSemanticNoChange,
  validateGroundedSemanticOutcome,
} from "./lib/semantic-grounding-eval.mjs";
import {
  diagramSpatialConstraintErrors,
} from "../packages/drawing-engine/src/spatialQuality.ts";
import { buildConfusionMatrix } from "./lib/confusion-matrix.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(REPOSITORY_ROOT, "evals/voice-intent/v1.json");
const DEFAULT_API_URL = "http://127.0.0.1:4000";
const DEFAULT_ORIGIN = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 1;
const VALID_EXPECTED_OUTCOMES = new Set([
  ...SEMANTIC_PLAN_RESOLUTION_STATUSES,
  "already_satisfied",
]);
const VALID_ISSUE_CODES = new Set(SEMANTIC_PLAN_ISSUE_CODES);
const VALID_MISSING_SLOTS = new Set(SEMANTIC_PLAN_MISSING_SLOTS);
const VALID_ACTION_TYPES = new Set(
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.actions.map(({ actionType }) => actionType),
);
const VALID_PARSER_ISSUES = new Set(SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES);

main().catch((error) => {
  console.error(`Voice-intent evaluation could not start: ${describeError(error)}`);
  process.exitCode = 2;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertProductionContractConsistency();

  const fixturePath = resolve(process.cwd(), options.fixture ?? DEFAULT_FIXTURE);
  const fixtureSource = await readFile(fixturePath, "utf8");
  const corpus = JSON.parse(fixtureSource);
  const datasetHash = `sha256:${createHash("sha256").update(fixtureSource).digest("hex")}`;
  validateCorpus(corpus, fixturePath);
  const cases = options.caseIds.length
    ? corpus.cases.filter((fixtureCase) => options.caseIds.includes(fixtureCase.id))
    : corpus.cases;
  const casesById = new Map(cases.map((fixtureCase) => [
    fixtureCase.id,
    fixtureCase,
  ]));
  const missingCaseIds = options.caseIds.filter(
    (caseId) => !corpus.cases.some((fixtureCase) => fixtureCase.id === caseId),
  );
  if (missingCaseIds.length) {
    throw new Error(`Unknown fixture case(s): ${missingCaseIds.join(", ")}`);
  }

  const apiUrl = normalizeBaseUrl(
    options.apiUrl ?? process.env.AIRBOARD_API_URL ?? DEFAULT_API_URL,
  );
  const origin = options.origin ?? process.env.AIRBOARD_EVAL_ORIGIN ?? DEFAULT_ORIGIN;
  const model =
    options.model ??
    process.env.AIRBOARD_EVAL_MODEL ??
    process.env.AIRBOARD_INTENT_MODEL ??
    undefined;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiToken = cleanSecret(process.env.AIRBOARD_EVAL_API_TOKEN);
  const attempts =
    options.attempts ??
    parseAttempts(process.env.AIRBOARD_EVAL_ATTEMPTS) ??
    DEFAULT_ATTEMPTS;

  console.log(`Airboard voice-intent evaluation ${corpus.schemaVersion}`);
  console.log(
    `Plan:     ${AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION} / capabilities ${AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version}`,
  );
  console.log(`Endpoint: ${new URL("/intent/resolve", apiUrl)}`);
  console.log(`Origin:   ${origin}`);
  console.log(`Model:    ${model ?? "server default"}`);
  console.log(`Cases:    ${cases.length} × ${attempts} attempt${attempts === 1 ? "" : "s"}\n`);

  const results = [];
  for (const fixtureCase of cases) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await runCase({
        apiUrl,
        origin,
        model,
        timeoutMs,
        apiToken,
        fixtureCase,
        attempt,
      });
      results.push(result);
      const actionSummary = result.plan
        ? `[${result.plan.actions.map((action) => action.type).join(", ") || "no actions"}]`
        : "[no plan]";
      const planOutcome = result.plan
        ? `${result.plan.status}${result.plan.issueCode === "none" ? "" : `/${result.plan.issueCode}`}`
        : result.outcome ?? "request failed";
      const attemptLabel = attempts === 1 ? "" : ` ${String(attempt).padStart(2)}/${attempts}`;
      console.log(
        `${result.passed ? "PASS" : "FAIL"} ${fixtureCase.id.padEnd(31)}${attemptLabel} ${formatMilliseconds(result.latencyMs).padStart(8)} ${planOutcome} ${actionSummary}`,
      );
      if (!result.passed) {
        for (const failure of result.failures) {
          console.log(`     - ${failure}`);
        }
        console.log(`     - voiceTurnId: ${result.voiceTurnId}`);
      }
    }
  }

  const passing = results.filter((result) => result.passed).length;
  const quality = evaluateQualityPolicy(results, cases, attempts);
  const stableCases = quality.policyPassingCases;
  const latencies = results.map((result) => result.latencyMs);
  const passRate = results.length ? (passing / results.length) * 100 : 0;
  console.log("\nSummary");
  console.log(`  Attempts: ${passing}/${results.length} passed (${passRate.toFixed(1)}%)`);
  if (attempts > 1) {
    console.log(`  Cases:    ${stableCases}/${cases.length} met repetition policy`);
  }
  console.log(`  p50:    ${formatMilliseconds(percentile(latencies, 0.5))}`);
  console.log(`  p95:    ${formatMilliseconds(percentile(latencies, 0.95))}`);
  console.log(
    `  Core:   ${(quality.coreAccuracy * 100).toFixed(1)}% (gate 95.0%)`,
  );
  console.log(
    `  Overall:${(quality.overallAccuracy * 100).toFixed(1).padStart(7)}% (gate 90.0%)`,
  );
  console.log(
    `  End→action p95: ${formatMilliseconds(quality.semanticEndToActionP95Ms)}`,
  );
  console.log(
    `  Provider infrastructure: ${quality.infrastructureFailures}/${results.length}`,
  );
  for (const failure of quality.failures) {
    console.log(`  GATE FAIL: ${failure}`);
  }

  const usage = summarizeUsage(results);
  const report = {
    schemaVersion: "airboard-semantic-eval-result.v1",
    generatedAt: new Date().toISOString(),
    corpus: {
      schemaVersion: corpus.schemaVersion,
      kind: corpusKind(corpus),
      caseCount: cases.length,
      attempts,
      datasetHash,
    },
    versions: {
      semanticPlanContract: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
      capabilityRegistry: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
      prompt: AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
      providers: [...new Set(results.map(({ provider }) => provider).filter(Boolean))],
      models: [...new Set(results.map(({ model: resultModel }) => resultModel).filter(Boolean))],
      commit:
        process.env.AIRBOARD_EVAL_COMMIT ??
        process.env.GITHUB_SHA ??
        null,
    },
    summary: {
      attempts: results.length,
      passed: passing,
      failed: results.length - passing,
      policyPassingCases: quality.policyPassingCases,
      totalCases: cases.length,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      ...quality,
      usage,
    },
    confusionMatrices: {
      semanticStatus: buildConfusionMatrix(
        results.map((result) => ({
          expected:
            casesById.get(result.caseId)?.expected?.status ?? "unknown",
          actual:
            result.plan?.status ??
            result.outcome ??
            (result.failureClass === "provider_infrastructure"
              ? "provider_infrastructure"
              : "invalid_output"),
        })),
      ),
    },
    results: results.map(sanitizeResultForReport),
    replay:
      process.env.AIRBOARD_EVAL_REPLAY_COMMAND ??
      `node scripts/eval-voice-intent.mjs --fixture ${shellQuote(fixturePath)} --attempts ${attempts}`,
  };
  await writeReports(report);

  if (quality.infrastructureRate > 0.05) {
    process.exitCode = 2;
  } else if (quality.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runCase(argumentsValue) {
  const first = await runCaseOnce(argumentsValue);
  if (
    first.failureClass !== "provider_infrastructure" ||
    !first.retryableInfrastructure
  ) {
    return { ...first, providerRetryCount: 0 };
  }
  const retried = await runCaseOnce(argumentsValue);
  return {
    ...retried,
    providerRetryCount: 1,
    firstProviderFailure: first.failures,
  };
}

async function runCaseOnce({
  apiUrl,
  origin,
  model,
  timeoutMs,
  apiToken,
  fixtureCase,
  attempt,
}) {
  const voiceTurnId = createVoiceTurnId(fixtureCase.id, attempt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL("/intent/resolve", apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        voiceTurnId,
        transcript: fixtureCase.transcript,
        parserIssue: fixtureCase.parserIssue,
        context: fixtureCase.context,
        ...(fixtureCase.pendingClarification
          ? { pendingClarification: fixtureCase.pendingClarification }
          : {}),
        ...(model ? { model } : {}),
      }),
      signal: controller.signal,
    });
    const providerLatencyMs = performance.now() - startedAt;
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const providerRequestId = stringValue(payload?.providerRequestId);
      const code = stringValue(payload?.error) ?? `HTTP_${response.status}`;
      const message = stringValue(payload?.message);
      return {
        passed: false,
        failures: [
          `HTTP ${response.status} ${code}${message ? `: ${message}` : ""}${providerRequestId ? ` (provider request ${providerRequestId})` : ""}`,
        ],
        attempt,
        latencyMs: providerLatencyMs,
        providerLatencyMs,
        plan: null,
        grounding: null,
        voiceTurnId,
        caseId: fixtureCase.id,
        failureClass: classifyFailure(code, response.status),
        retryableInfrastructure: isTransientProviderFailure(code, response.status),
        provider: null,
        model: model ?? null,
        metadata: null,
      };
    }

    if (isAlreadySatisfiedPayload(payload)) {
      const failures =
        fixtureCase.expected.status === "already_satisfied"
          ? []
          : [
              `expected status ${fixtureCase.expected.status}, received already_satisfied`,
            ];
      const grounding = evaluateSemanticNoChange(fixtureCase.context);
      failures.push(
        ...validateGroundedSemanticOutcome(
          grounding,
          fixtureCase.expected,
          "already_satisfied",
        ),
      );
      const latencyMs = performance.now() - startedAt;
      return {
        passed: failures.length === 0,
        failures,
        attempt,
        latencyMs,
        providerLatencyMs,
        outcome: "already_satisfied",
        plan: null,
        grounding,
        voiceTurnId,
        caseId: fixtureCase.id,
        failureClass: failures.length === 0 ? null : "quality",
        retryableInfrastructure: false,
        provider: payload.provider,
        model: payload.model,
        metadata: sanitizeProviderMetadata(payload.metadata),
      };
    }

    const rawPlan = isRecord(payload) && isRecord(payload.plan) ? payload.plan : payload;
    const parsedPlan = parseSemanticPlan(rawPlan);
    const failures = parsedPlan.ok
      ? fixtureCase.expected.status === "already_satisfied"
        ? ["expected already_satisfied, received an executable semantic plan"]
        : validateExpectedOutcome(parsedPlan.value, fixtureCase.expected)
      : [
          `plan violates production contract ${AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION} at ${parsedPlan.error.path}: ${parsedPlan.error.message}`,
        ];
    let grounding = null;
    if (parsedPlan.ok) {
      try {
        grounding = evaluateGroundedSemanticPlan(
          parsedPlan.value,
          fixtureCase.context,
        );
        failures.push(
          ...validateGroundedSemanticOutcome(
            grounding,
            fixtureCase.expected,
            fixtureCase.expected.status,
          ),
        );
      } catch (error) {
        failures.push(
          `production grounding harness failed: ${describeError(error)}`,
        );
      }
    }
    const latencyMs = performance.now() - startedAt;
    return {
      passed: failures.length === 0,
      failures,
      attempt,
      latencyMs,
      providerLatencyMs,
      plan: parsedPlan.ok ? parsedPlan.value : null,
      outcome: parsedPlan.ok ? parsedPlan.value.status : null,
      grounding,
      voiceTurnId,
      caseId: fixtureCase.id,
      failureClass: failures.length === 0 ? null : "quality",
      retryableInfrastructure: false,
      provider:
        isRecord(payload) && typeof payload.provider === "string"
          ? payload.provider
          : null,
      model:
        isRecord(payload) && typeof payload.model === "string"
          ? payload.model
          : model ?? null,
      metadata:
        isRecord(payload) && isRecord(payload.metadata)
          ? sanitizeProviderMetadata(payload.metadata)
          : null,
    };
  } catch (error) {
    const latencyMs = performance.now() - startedAt;
    return {
      passed: false,
      failures: [
        error instanceof Error && error.name === "AbortError"
          ? `request exceeded ${timeoutMs}ms timeout`
          : describeError(error),
      ],
      attempt,
      latencyMs,
      providerLatencyMs: latencyMs,
      plan: null,
      grounding: null,
      voiceTurnId,
      caseId: fixtureCase.id,
      failureClass: "provider_infrastructure",
      retryableInfrastructure: true,
      provider: null,
      model: model ?? null,
      metadata: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function validateExpectedOutcome(plan, expected) {
  const failures = [];
  if (plan.status !== expected.status) {
    failures.push(`expected status ${expected.status}, received ${String(plan.status)}`);
  }
  if (expected.issueCode !== undefined && plan.issueCode !== expected.issueCode) {
    failures.push(`expected issueCode ${expected.issueCode}, received ${String(plan.issueCode)}`);
  }
  if (!Array.isArray(plan.actions)) return failures;

  const actualCounts = countBy(plan.actions.map((action) => action.type));
  const expectedCounts = expected.actionTypeCounts ?? {};
  const actionTypes = new Set([...Object.keys(actualCounts), ...Object.keys(expectedCounts)]);
  for (const actionType of actionTypes) {
    if ((actualCounts[actionType] ?? 0) !== (expectedCounts[actionType] ?? 0)) {
      failures.push(
        `expected ${expectedCounts[actionType] ?? 0} ${actionType} action(s), received ${actualCounts[actionType] ?? 0}`,
      );
    }
  }

  if (expected.createdNodeTypes) {
    compareNormalizedMultisets(
      plan.actions.filter((action) => action.type === "create").map((action) => action.nodeType),
      expected.createdNodeTypes,
      "created node types",
      failures,
    );
  }
  if (expected.renamedLabels) {
    compareNormalizedMultisets(
      plan.actions.filter((action) => action.type === "rename").map((action) => action.label),
      expected.renamedLabels,
      "rename labels",
      failures,
    );
  }
  if (expected.branchLabels) {
    compareNormalizedMultisets(
      plan.actions
        .filter((action) => action.type === "branch")
        .flatMap((action) => action.branches ?? [])
        .map((branch) => branch.label)
        .filter((label) => typeof label === "string"),
      expected.branchLabels,
      "branch labels",
      failures,
    );
  }
  if (expected.connectorLabelGroups) {
    const labels = plan.actions
      .filter((action) => action.type === "connect" && typeof action.label === "string")
      .map((action) => normalizeText(action.label));
    for (const alternatives of expected.connectorLabelGroups) {
      if (!alternatives.some((alternative) => labels.includes(normalizeText(alternative)))) {
        failures.push(
          `connector labels ${JSON.stringify(labels)} contain none of ${JSON.stringify(alternatives)}`,
        );
      }
    }
  }
  if (expected.actionDetails) {
    const unmatched = [...plan.actions];
    for (const detail of expected.actionDetails) {
      const index = unmatched.findIndex((action) =>
        matchesExpectedActionDetail(action, detail),
      );
      if (index < 0) {
        failures.push(
          `no semantic action matched required detail ${JSON.stringify(detail)}`,
        );
      } else {
        unmatched.splice(index, 1);
      }
    }
  }
  if (expected.missingSlotsIncludes) {
    const missingSlots = Array.isArray(plan.missingSlots) ? plan.missingSlots : [];
    for (const slot of expected.missingSlotsIncludes) {
      if (!missingSlots.includes(slot)) failures.push(`missingSlots does not include ${slot}`);
    }
  }
  if (expected.clarificationQuestionIncludes) {
    const question =
      typeof plan.clarificationQuestion === "string"
        ? normalizeText(plan.clarificationQuestion)
        : "";
    for (const phrase of expected.clarificationQuestionIncludes) {
      if (!question.includes(normalizeText(phrase))) {
        failures.push(`clarificationQuestion does not include ${JSON.stringify(phrase)}`);
      }
    }
  }
  return failures;
}

function matchesExpectedActionDetail(actual, expected) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, index) =>
        matchesExpectedActionDetail(actual[index], entry),
      )
    );
  }
  if (isRecord(expected)) {
    return (
      isRecord(actual) &&
      Object.entries(expected).every(([key, value]) =>
        matchesExpectedActionDetail(actual[key], value),
      )
    );
  }
  if (typeof expected === "string") {
    return normalizeText(actual) === normalizeText(expected);
  }
  return Object.is(actual, expected);
}

function compareNormalizedMultisets(actual, expected, description, failures) {
  const normalizedActual = actual.map(normalizeText).sort();
  const normalizedExpected = expected.map(normalizeText).sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    failures.push(
      `expected ${description} ${JSON.stringify(normalizedExpected)}, received ${JSON.stringify(normalizedActual)}`,
    );
  }
}

function evaluateQualityPolicy(results, cases, attempts) {
  const casesById = new Map(cases.map((fixtureCase) => [fixtureCase.id, fixtureCase]));
  const qualityResults = results.filter(
    (result) => result.failureClass !== "provider_infrastructure",
  );
  const infrastructureFailures = results.length - qualityResults.length;
  const infrastructureRate = results.length
    ? infrastructureFailures / results.length
    : 0;
  const passingQualityResults = qualityResults.filter((result) => result.passed);
  const overallAccuracy = qualityResults.length
    ? passingQualityResults.length / qualityResults.length
    : 0;
  const coreResults = qualityResults.filter((result) =>
    isCoreSingleActionCase(casesById.get(result.caseId)),
  );
  const coreAccuracy = coreResults.length
    ? coreResults.filter((result) => result.passed).length / coreResults.length
    : 1;
  const failures = [];
  if (qualityResults.length === 0) {
    failures.push("no provider responses were available for quality scoring");
  } else {
    if (overallAccuracy < 0.9) {
      failures.push(
        `overall semantic correctness ${(overallAccuracy * 100).toFixed(1)}% is below 90.0%`,
      );
    }
    if (coreResults.length > 0 && coreAccuracy < 0.95) {
      failures.push(
        `core single-action correctness ${(coreAccuracy * 100).toFixed(1)}% is below 95.0%`,
      );
    }
  }

  const groupedByCase = groupBy(results, (result) => result.caseId);
  let policyPassingCases = 0;
  for (const fixtureCase of cases) {
    const caseResults = groupedByCase.get(fixtureCase.id) ?? [];
    const passingAttempts = caseResults.filter((result) => result.passed).length;
    const critical = isCriticalCase(fixtureCase);
    const requiredPasses = critical
      ? attempts
      : attempts >= 5
        ? Math.max(1, attempts - 1)
        : attempts;
    if (passingAttempts >= requiredPasses) {
      policyPassingCases += 1;
    } else if (critical || attempts >= 5) {
      failures.push(
        `${fixtureCase.id} passed ${passingAttempts}/${attempts}; ${critical ? "critical" : "ordinary"} cases require ${requiredPasses}/${attempts}`,
      );
    }
  }

  const slices = buildQualitySlices(qualityResults, casesById);
  for (const slice of slices) {
    if (slice.critical && slice.total > 0 && slice.accuracy < 0.85) {
      failures.push(
        `${slice.name} correctness ${(slice.accuracy * 100).toFixed(1)}% is below the 85.0% critical-slice floor`,
      );
    }
  }

  const appliedSemanticResults = qualityResults.filter(
    (result) =>
      result.plan?.status === "resolved" &&
      (result.grounding?.status === "applied" ||
        result.grounding?.status === "immediate_action"),
  );
  const semanticEndToActionP95Ms = percentile(
    appliedSemanticResults.map((result) => result.latencyMs),
    0.95,
  );
  const semanticPlannerLatencyP95Ms = percentile(
    qualityResults.map(
      (result) => result.providerLatencyMs ?? result.latencyMs,
    ),
    0.95,
  );
  if (
    appliedSemanticResults.length > 0 &&
    semanticEndToActionP95Ms >= 2_500
  ) {
    failures.push(
      `semantic end-to-action p95 ${Math.round(semanticEndToActionP95Ms)}ms must be below 2500ms`,
    );
  }

  return {
    overallAccuracy,
    coreAccuracy,
    policyPassingCases,
    qualityAttempts: qualityResults.length,
    infrastructureFailures,
    infrastructureRate,
    semanticEndToActionP95Ms,
    semanticPlannerLatencyP95Ms,
    // Retained for report consumers written before end-to-action grounding
    // was available. This is explicitly planner-only diagnostic latency.
    semanticLatencyP95Ms: semanticPlannerLatencyP95Ms,
    slices,
    failures: uniqueStrings(failures),
    inconclusive:
      infrastructureRate > 0.05,
    inconclusiveReason:
      infrastructureRate > 0.05
        ? `${(infrastructureRate * 100).toFixed(1)}% provider infrastructure failure rate exceeds 5.0%`
        : null,
  };
}

function buildQualitySlices(results, casesById) {
  const memberships = new Map();
  for (const result of results) {
    const fixtureCase = casesById.get(result.caseId);
    if (!fixtureCase) continue;
    const names = new Set([
      `status:${fixtureCase.expected.status}`,
      `parser:${fixtureCase.parserIssue}`,
    ]);
    for (const [actionType, count] of Object.entries(
      fixtureCase.expected.actionTypeCounts ?? {},
    )) {
      if (count > 0) names.add(`action:${actionType}`);
    }
    if (fixtureCase.metamorphic?.invariant) {
      names.add(`invariant:${fixtureCase.metamorphic.invariant}`);
    }
    if (fixtureCase.ambientSafety) names.add("safety:ambient");
    for (const name of names) {
      const values = memberships.get(name) ?? [];
      values.push(result);
      memberships.set(name, values);
    }
  }
  return [...memberships.entries()]
    .map(([name, sliceResults]) => ({
      name,
      critical:
        name.startsWith("status:") ||
        name.startsWith("action:") ||
        name.startsWith("safety:"),
      total: sliceResults.length,
      passed: sliceResults.filter((result) => result.passed).length,
      accuracy:
        sliceResults.length === 0
          ? 1
          : sliceResults.filter((result) => result.passed).length /
            sliceResults.length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isCoreSingleActionCase(fixtureCase) {
  if (!fixtureCase || fixtureCase.expected.status !== "resolved") return false;
  return (
    Object.values(fixtureCase.expected.actionTypeCounts ?? {}).reduce(
      (total, count) => total + count,
      0,
    ) === 1
  );
}

function isCriticalCase(fixtureCase) {
  if (fixtureCase.expected.status !== "resolved") return true;
  const criticalActions = new Set([
    "delete",
    "delete_connection",
    "reverse_connection",
    "undo",
  ]);
  return Object.entries(fixtureCase.expected.actionTypeCounts ?? {}).some(
    ([actionType, count]) => count > 0 && criticalActions.has(actionType),
  );
}

function summarizeUsage(results) {
  const usage = results.reduce(
    (totals, result) => {
      const value = result.metadata?.usage;
      if (!value) return totals;
      totals.inputTokens += value.inputTokens;
      totals.outputTokens += value.outputTokens;
      totals.totalTokens += value.totalTokens;
      totals.responses += 1;
      return totals;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, responses: 0 },
  );
  const inputPrice = optionalNonNegativeNumber(
    process.env.AIRBOARD_EVAL_INPUT_USD_PER_MILLION,
  );
  const outputPrice = optionalNonNegativeNumber(
    process.env.AIRBOARD_EVAL_OUTPUT_USD_PER_MILLION,
  );
  const totalCostUsd =
    inputPrice === null || outputPrice === null
      ? null
      : (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) /
        1_000_000;
  const successfulTurns = results.filter((result) => result.passed).length;
  return {
    ...usage,
    inputUsdPerMillion: inputPrice,
    outputUsdPerMillion: outputPrice,
    totalCostUsd,
    costPerSuccessfulTurnUsd:
      totalCostUsd === null || successfulTurns === 0
        ? null
        : totalCostUsd / successfulTurns,
  };
}

function sanitizeProviderMetadata(metadata) {
  const usage = isRecord(metadata.usage)
    ? {
        inputTokens: nonNegativeNumber(metadata.usage.inputTokens),
        outputTokens: nonNegativeNumber(metadata.usage.outputTokens),
        totalTokens: nonNegativeNumber(metadata.usage.totalTokens),
      }
    : null;
  return {
    responseModel: stringValue(metadata.responseModel),
    providerProcessingMs: nullableNonNegativeNumber(
      metadata.providerProcessingMs,
    ),
    totalLatencyMs: nullableNonNegativeNumber(metadata.totalLatencyMs),
    usage:
      usage &&
      Object.values(usage).every((value) => typeof value === "number")
        ? usage
        : null,
  };
}

function cleanSecret(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeResultForReport(result) {
  const grounding = result.grounding;
  return {
    caseId: result.caseId,
    attempt: result.attempt,
    passed: result.passed,
    failureClass: result.failureClass,
    failures: result.failures,
    latencyMs: result.latencyMs,
    providerLatencyMs: result.providerLatencyMs,
    stageTimings: grounding
      ? {
          semanticProviderMs: result.providerLatencyMs,
          groundingMs: grounding.timings.groundingMs,
          actionMs: grounding.timings.actionMs,
          endToActionMs: result.latencyMs,
        }
      : {
          semanticProviderMs: result.providerLatencyMs,
          endToActionMs: result.latencyMs,
        },
    plan: result.plan,
    outcome: result.outcome ?? null,
    groundedCommands: grounding?.commands ?? [],
    eventDelta: grounding?.eventDelta ?? [],
    initialBoardState: grounding?.initialBoardState ?? null,
    finalBoardState: grounding?.finalBoardState ?? null,
    finalSelection: grounding?.selectionIds ?? [],
    effects: grounding?.effects ?? null,
    undo: grounding?.undo ?? null,
    groundingStatus: grounding?.status ?? null,
    groundingError: grounding?.groundingError ?? null,
    provider: result.provider,
    model: result.model,
    metadata: result.metadata,
    providerRetryCount: result.providerRetryCount ?? 0,
  };
}

function corpusKind(corpus) {
  if (corpus.ambientSafety) return "ambient-safety";
  if (corpus.metamorphic) return "metamorphic";
  return "contract";
}

function classifyFailure(code, status) {
  const normalized = String(code).toUpperCase();
  if (
    normalized.includes("INVALID_PROVIDER_OUTPUT") ||
    normalized.includes("MALFORMED") ||
    normalized.includes("INVALID_OUTPUT")
  ) {
    return "quality";
  }
  if (
    status === 429 ||
    status >= 500 ||
    normalized.includes("TIMEOUT") ||
    normalized.includes("RATE_LIMIT") ||
    normalized.includes("QUOTA") ||
    normalized.includes("AUTH") ||
    normalized.includes("UNAVAILABLE") ||
    normalized.includes("PROVIDER")
  ) {
    return "provider_infrastructure";
  }
  return "quality";
}

function isTransientProviderFailure(code, status) {
  const normalized = String(code).toUpperCase();
  if (
    normalized.includes("QUOTA") ||
    normalized.includes("AUTH") ||
    normalized.includes("MODEL_UNAVAILABLE") ||
    normalized.includes("REQUEST_REJECTED")
  ) {
    return false;
  }
  return (
    status === 429 ||
    status >= 500 ||
    normalized.includes("TIMEOUT") ||
    normalized.includes("RATE_LIMIT") ||
    normalized.includes("UNAVAILABLE") ||
    normalized.includes("PROVIDER_FAILED")
  );
}

async function writeReports(report) {
  const outputRoot = process.env.AIRBOARD_EVAL_OUTPUT_DIR;
  if (!outputRoot) return;
  const outputDirectory = resolve(outputRoot, "semantic");
  await mkdir(outputDirectory, { recursive: true });
  const name = `semantic-${report.corpus.kind}`;
  const jsonPath = resolve(outputDirectory, `${name}.json`);
  const junitPath = resolve(outputDirectory, `${name}.xml`);
  const markdownPath = resolve(outputDirectory, `${name}.md`);
  const htmlPath = resolve(outputDirectory, `${name}.html`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(junitPath, semanticJUnit(report), "utf8"),
    writeFile(markdownPath, semanticMarkdown(report), "utf8"),
    writeFile(htmlPath, semanticHtml(report), "utf8"),
  ]);
  console.log(`  Reports: ${outputDirectory}`);
}

function semanticJUnit(report) {
  const tests = report.results
    .map((result) => {
      const name = escapeXml(`${result.caseId} attempt ${result.attempt}`);
      const detail = escapeXml(result.failures.join("; "));
      const outcome = result.passed
        ? ""
        : result.failureClass === "provider_infrastructure"
          ? `<error type="provider_infrastructure" message="${detail}"/>`
          : `<failure type="quality" message="${detail}"/>`;
      return `  <testcase classname="semantic.${escapeXml(report.corpus.kind)}" name="${name}" time="${(result.latencyMs / 1_000).toFixed(3)}">${outcome}</testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Airboard semantic ${escapeXml(report.corpus.kind)}" tests="${report.results.length}" failures="${report.results.filter((result) => !result.passed && result.failureClass !== "provider_infrastructure").length}" errors="${report.summary.infrastructureFailures}">
${tests}
  <system-out>${escapeXml(JSON.stringify({ confusionMatrices: report.confusionMatrices }, null, 2))}</system-out>
</testsuite>
`;
}

function semanticMarkdown(report) {
  const summary = report.summary;
  const failureLines = summary.failures.length
    ? summary.failures.map((failure) => `- ${failure}`).join("\n")
    : "- None";
  return `# Airboard semantic evaluation: ${report.corpus.kind}

- Dataset: \`${report.corpus.datasetHash}\`
- Cases: ${report.corpus.caseCount} × ${report.corpus.attempts}
- Overall correctness: ${(summary.overallAccuracy * 100).toFixed(1)}%
- Core single-action correctness: ${(summary.coreAccuracy * 100).toFixed(1)}%
- Provider infrastructure failures: ${summary.infrastructureFailures}/${summary.attempts}
- Semantic planner p95: ${Math.round(summary.semanticPlannerLatencyP95Ms)} ms
- End-to-action p95: ${Math.round(summary.semanticEndToActionP95Ms)} ms
- Prompt / plan: ${report.versions.prompt} / ${report.versions.semanticPlanContract}
- Replay: \`${report.replay}\`

## Gate failures

${failureLines}

${semanticConfusionMarkdown(report.confusionMatrices.semanticStatus)}
`;
}

function semanticHtml(report) {
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${escapeHtml(result.caseId)}</td><td>${result.attempt}</td><td>${result.passed ? "PASS" : "FAIL"}</td><td>${Math.round(result.latencyMs)} ms</td><td>${escapeHtml(result.failureClass ?? "")}</td><td>${escapeHtml(result.failures.join("; "))}</td></tr>`,
    )
    .join("");
  const confusion = semanticConfusionHtml(
    report.confusionMatrices.semanticStatus,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Airboard semantic evaluation</title>
<style>body{font:14px system-ui;margin:2rem;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3df;padding:.45rem;text-align:left}th{background:#eef2f7}.pass{color:#08783e}</style></head>
<body><h1>Airboard semantic evaluation: ${escapeHtml(report.corpus.kind)}</h1>
<p>Dataset <code>${escapeHtml(report.corpus.datasetHash)}</code> · overall ${(report.summary.overallAccuracy * 100).toFixed(1)}% · core ${(report.summary.coreAccuracy * 100).toFixed(1)}% · end-to-action p95 ${Math.round(report.summary.semanticEndToActionP95Ms)} ms</p>
${confusion}
<table><thead><tr><th>Case</th><th>Attempt</th><th>Outcome</th><th>Latency</th><th>Class</th><th>Failure</th></tr></thead><tbody>${rows}</tbody></table>
<p>Replay: <code>${escapeHtml(report.replay)}</code></p></body></html>
`;
}

function semanticConfusionMarkdown(matrix) {
  if (!Array.isArray(matrix?.labels) || !matrix.matrix) return "";
  const lines = [
    "## Semantic-status confusion matrix",
    "",
    `| Expected \\ Actual | ${matrix.labels.join(" | ")} |`,
    `| --- | ${matrix.labels.map(() => "---:").join(" | ")} |`,
  ];
  for (const expected of matrix.labels) {
    lines.push(
      `| ${expected} | ${matrix.labels
        .map((actual) => matrix.matrix[expected]?.[actual] ?? 0)
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function semanticConfusionHtml(matrix) {
  if (!Array.isArray(matrix?.labels) || !matrix.matrix) return "";
  return `<section><h2>Semantic-status confusion matrix</h2><table><thead><tr><th>Expected \\ Actual</th>${matrix.labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${matrix.labels.map((expected) => `<tr><th>${escapeHtml(expected)}</th>${matrix.labels.map((actual) => `<td>${matrix.matrix[expected]?.[actual] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON content`);
  }
}

function isAlreadySatisfiedPayload(value) {
  if (!isRecord(value)) return false;
  const keys = ["metadata", "model", "outcome", "plan", "provider"];
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    value.outcome === "already_satisfied" &&
    value.plan === null &&
    typeof value.provider === "string" &&
    Boolean(value.provider.trim()) &&
    typeof value.model === "string" &&
    Boolean(value.model.trim()) &&
    isRecord(value.metadata)
  );
}

function validateCorpus(corpus, fixturePath) {
  if (!isRecord(corpus) || corpus.schemaVersion !== "1.0" || !Array.isArray(corpus.cases)) {
    throw new Error(`${fixturePath} is not a voice-intent corpus with schemaVersion 1.0`);
  }
  const seenIds = new Set();
  for (const fixtureCase of corpus.cases) {
    if (
      !isRecord(fixtureCase) ||
      typeof fixtureCase.id !== "string" ||
      typeof fixtureCase.transcript !== "string" ||
      !VALID_PARSER_ISSUES.has(fixtureCase.parserIssue) ||
      !isRecord(fixtureCase.context) ||
      !isRecord(fixtureCase.expected)
    ) {
      throw new Error(`${fixturePath} contains a malformed case`);
    }
    if (
      fixtureCase.pendingClarification !== undefined &&
      (!isRecord(fixtureCase.pendingClarification) ||
        typeof fixtureCase.pendingClarification.previousTranscript !== "string" ||
        typeof fixtureCase.pendingClarification.question !== "string" ||
        !Array.isArray(fixtureCase.pendingClarification.missingSlots) ||
        fixtureCase.pendingClarification.missingSlots.some(
          (slot) => !VALID_MISSING_SLOTS.has(slot),
        ))
    ) {
      throw new Error(`${fixturePath} contains a malformed pending clarification`);
    }
    if (!VALID_EXPECTED_OUTCOMES.has(fixtureCase.expected.status)) {
      throw new Error(`${fixturePath} case ${fixtureCase.id} has an invalid expected status`);
    }
    if (
      fixtureCase.expected.issueCode !== undefined &&
      !VALID_ISSUE_CODES.has(fixtureCase.expected.issueCode)
    ) {
      throw new Error(`${fixturePath} case ${fixtureCase.id} has an invalid expected issueCode`);
    }
    if (
      fixtureCase.expected.missingSlotsIncludes !== undefined &&
      (!Array.isArray(fixtureCase.expected.missingSlotsIncludes) ||
        fixtureCase.expected.missingSlotsIncludes.some(
          (slot) => !VALID_MISSING_SLOTS.has(slot),
        ))
    ) {
      throw new Error(`${fixturePath} case ${fixtureCase.id} has invalid expected missing slots`);
    }
    if (
      fixtureCase.expected.clarificationQuestionIncludes !== undefined &&
      (!Array.isArray(fixtureCase.expected.clarificationQuestionIncludes) ||
        fixtureCase.expected.clarificationQuestionIncludes.some(
          (phrase) => typeof phrase !== "string" || !phrase.trim(),
        ))
    ) {
      throw new Error(
        `${fixturePath} case ${fixtureCase.id} has invalid clarification question expectations`,
      );
    }
    validateFinalStateExpectation(
      fixtureCase.expected.finalState,
      fixturePath,
      fixtureCase.id,
    );
    const expectedCounts = fixtureCase.expected.actionTypeCounts ?? {};
    if (
      !isRecord(expectedCounts) ||
      Object.entries(expectedCounts).some(
        ([actionType, count]) =>
          !VALID_ACTION_TYPES.has(actionType) ||
          !Number.isInteger(count) ||
          count < 0,
      ) ||
      Object.values(expectedCounts).reduce((total, count) => total + count, 0) >
        AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS
    ) {
      throw new Error(`${fixturePath} case ${fixtureCase.id} has invalid action counts`);
    }
    if (seenIds.has(fixtureCase.id)) throw new Error(`Duplicate fixture case id: ${fixtureCase.id}`);
    seenIds.add(fixtureCase.id);
  }
}

function validateFinalStateExpectation(value, fixturePath, caseId) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(
      `${fixturePath} case ${caseId} has an invalid finalState expectation`,
    );
  }
  for (const field of ["nodeCountDelta", "edgeCountDelta"]) {
    if (
      value[field] !== undefined &&
      !Number.isInteger(value[field])
    ) {
      throw new Error(
        `${fixturePath} case ${caseId} finalState.${field} must be an integer`,
      );
    }
  }
  for (const field of [
    "requiredNodes",
    "forbiddenNodes",
    "requiredEdges",
    "forbiddenEdges",
    "requiredDeletedNodes",
    "requiredDeletedEdges",
  ]) {
    if (
      value[field] !== undefined &&
      (!Array.isArray(value[field]) ||
        value[field].some(
          (constraint) =>
            !isRecord(constraint) ||
            (constraint.count !== undefined &&
              (!Number.isInteger(constraint.count) ||
                constraint.count < 0)),
        ))
    ) {
      throw new Error(
        `${fixturePath} case ${caseId} finalState.${field} must contain object constraints`,
      );
    }
  }
  if (value.spatialConstraints !== undefined) {
    const spatialErrors = diagramSpatialConstraintErrors(
      value.spatialConstraints,
    );
    if (spatialErrors.length > 0) {
      throw new Error(
        `${fixturePath} case ${caseId} finalState.spatialConstraints ` +
        spatialErrors.join("; "),
      );
    }
  }
}

function parseArguments(args) {
  const options = { caseIds: [], help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    switch (name) {
      case "--api-url":
        options.apiUrl = value;
        break;
      case "--origin":
        options.origin = value;
        break;
      case "--model":
        options.model = value;
        break;
      case "--fixture":
        options.fixture = value;
        break;
      case "--case":
        options.caseIds.push(value);
        break;
      case "--attempts":
        options.attempts = parseAttempts(value, "--attempts");
        break;
      case "--timeout-ms": {
        const timeoutMs = Number(value);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
          throw new Error("--timeout-ms must be an integer from 100 to 120000");
        }
        options.timeoutMs = timeoutMs;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm eval:voice -- [options]

Options:
  --api-url URL       Airboard API base URL (AIRBOARD_API_URL or http://127.0.0.1:4000)
  --origin URL        Origin header (AIRBOARD_EVAL_ORIGIN or http://localhost:3000)
  --model MODEL       Optional allowlisted intent model (AIRBOARD_EVAL_MODEL)
  --fixture PATH      Fixture corpus (evals/voice-intent/v1.json)
  --case ID           Run one case; may be repeated
  --attempts N        Repeat every case 1-20 times (AIRBOARD_EVAL_ATTEMPTS)
  --timeout-ms N      Per-case client timeout (default 20000)
  --help              Show this help

Environment:
  AIRBOARD_EVAL_API_TOKEN  Protected shared token for authenticated live API runs
`);
}

function createVoiceTurnId(caseId, attempt) {
  const safeCaseId = caseId.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").slice(0, 50);
  return `eval-${safeCaseId}-a${attempt}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function parseAttempts(value, source = "AIRBOARD_EVAL_ATTEMPTS") {
  if (value === undefined) return null;
  const attempts = Number(value);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error(`${source} must be an integer from 1 to 20`);
  }
  return attempts;
}

function assertProductionContractConsistency() {
  const schemaActionTypes = AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA.$defs.action.anyOf
    .map((actionSchema) => actionSchema.properties.type.enum[0])
    .sort();
  const registryActionTypes = [...VALID_ACTION_TYPES].sort();
  if (JSON.stringify(schemaActionTypes) !== JSON.stringify(registryActionTypes)) {
    throw new Error(
      `Production semantic action registry and plan schema diverge: schema=${schemaActionTypes.join(",")} registry=${registryActionTypes.join(",")}`,
    );
  }
  const schemaStatuses = [...AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA.properties.status.enum].sort();
  const productionStatuses = [...SEMANTIC_PLAN_RESOLUTION_STATUSES].sort();
  if (
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA.properties.version.enum[0] !==
      AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION ||
    JSON.stringify(schemaStatuses) !== JSON.stringify(productionStatuses)
  ) {
    throw new Error("Production semantic plan constants and JSON schema diverge");
  }
}

function normalizeBaseUrl(input) {
  const url = new URL(input);
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString();
}

function percentile(values, proportion) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
}

function formatMilliseconds(value) {
  return `${Math.round(value)}ms`;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nullableNonNegativeNumber(value) {
  return value === null ? null : nonNegativeNumber(value);
}

function optionalNonNegativeNumber(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

function normalizeText(value) {
  return String(value).normalize("NFKC").trim().toLowerCase();
}

function stringValue(value) {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
