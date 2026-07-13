#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(REPOSITORY_ROOT, "evals/voice-intent/v1.json");
const DEFAULT_API_URL = "http://127.0.0.1:4000";
const DEFAULT_ORIGIN = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 20_000;
const VALID_STATUSES = new Set(["resolved", "clarification", "unsupported"]);
const VALID_ACTION_TYPES = new Set([
  "create",
  "connect",
  "branch",
  "rename",
  "delete",
  "duplicate",
  "move",
  "align",
  "distribute",
  "layout",
  "group",
  "select",
  "undo",
  "cancel",
]);

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

  const fixturePath = resolve(process.cwd(), options.fixture ?? DEFAULT_FIXTURE);
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  validateCorpus(corpus, fixturePath);
  const cases = options.caseIds.length
    ? corpus.cases.filter((fixtureCase) => options.caseIds.includes(fixtureCase.id))
    : corpus.cases;
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

  console.log(`Airboard voice-intent evaluation ${corpus.schemaVersion}`);
  console.log(`Endpoint: ${new URL("/intent/resolve", apiUrl)}`);
  console.log(`Origin:   ${origin}`);
  console.log(`Model:    ${model ?? "server default"}`);
  console.log(`Cases:    ${cases.length}\n`);

  const results = [];
  for (const fixtureCase of cases) {
    const result = await runCase({ apiUrl, origin, model, timeoutMs, fixtureCase });
    results.push(result);
    const actionSummary = result.plan
      ? `[${result.plan.actions.map((action) => action.type).join(", ") || "no actions"}]`
      : "[no plan]";
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${fixtureCase.id.padEnd(31)} ${formatMilliseconds(result.latencyMs).padStart(8)} ${result.plan?.status ?? "request failed"} ${actionSummary}`,
    );
    if (!result.passed) {
      for (const failure of result.failures) {
        console.log(`     - ${failure}`);
      }
      console.log(`     - voiceTurnId: ${result.voiceTurnId}`);
    }
  }

  const passing = results.filter((result) => result.passed).length;
  const latencies = results.map((result) => result.latencyMs);
  const passRate = results.length ? (passing / results.length) * 100 : 0;
  console.log("\nSummary");
  console.log(`  Passed: ${passing}/${results.length} (${passRate.toFixed(1)}%)`);
  console.log(`  p50:    ${formatMilliseconds(percentile(latencies, 0.5))}`);
  console.log(`  p95:    ${formatMilliseconds(percentile(latencies, 0.95))}`);

  if (passing !== results.length) {
    process.exitCode = 1;
  }
}

async function runCase({ apiUrl, origin, model, timeoutMs, fixtureCase }) {
  const voiceTurnId = createVoiceTurnId(fixtureCase.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL("/intent/resolve", apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
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
    const latencyMs = performance.now() - startedAt;
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
        latencyMs,
        plan: null,
        voiceTurnId,
      };
    }

    const plan = isRecord(payload) && isRecord(payload.plan) ? payload.plan : payload;
    const failures = [
      ...validatePlanShape(plan),
      ...(isRecord(plan) ? validateExpectedOutcome(plan, fixtureCase.expected) : []),
    ];
    return {
      passed: failures.length === 0,
      failures,
      latencyMs,
      plan: isRecord(plan) && Array.isArray(plan.actions) ? plan : null,
      voiceTurnId,
    };
  } catch (error) {
    return {
      passed: false,
      failures: [
        error instanceof Error && error.name === "AbortError"
          ? `request exceeded ${timeoutMs}ms timeout`
          : describeError(error),
      ],
      latencyMs: performance.now() - startedAt,
      plan: null,
      voiceTurnId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function validatePlanShape(plan) {
  if (!isRecord(plan)) {
    return ["response does not contain a plan object"];
  }
  const failures = [];
  if (plan.version !== "1.0") failures.push(`plan.version must be 1.0, received ${JSON.stringify(plan.version)}`);
  if (!VALID_STATUSES.has(plan.status)) failures.push(`plan.status is invalid: ${JSON.stringify(plan.status)}`);
  if (typeof plan.issueCode !== "string" || !plan.issueCode) failures.push("plan.issueCode must be a non-empty string");
  if (plan.clarificationQuestion !== null && typeof plan.clarificationQuestion !== "string") {
    failures.push("plan.clarificationQuestion must be a string or null");
  }
  if (!Array.isArray(plan.missingSlots) || !plan.missingSlots.every((slot) => typeof slot === "string")) {
    failures.push("plan.missingSlots must be an array of strings");
  }
  if (!Array.isArray(plan.actions)) {
    failures.push("plan.actions must be an array");
    return failures;
  }
  if (plan.actions.length > 12) failures.push("plan.actions exceeds the 12-action safety bound");
  plan.actions.forEach((action, index) => failures.push(...validateActionShape(action, index)));
  if (plan.status === "resolved" && plan.actions.length === 0) failures.push("resolved plan has no actions");
  if (plan.status !== "resolved" && plan.actions.length !== 0) failures.push(`${plan.status} plan must not contain actions`);
  return failures;
}

function validateActionShape(action, index) {
  const path = `plan.actions[${index}]`;
  if (!isRecord(action) || !VALID_ACTION_TYPES.has(action.type)) {
    return [`${path} has an invalid action type`];
  }
  switch (action.type) {
    case "create":
      return [
        ...(typeof action.nodeType === "string" && action.nodeType ? [] : [`${path}.nodeType is required`]),
        ...(typeof action.handle === "string" && action.handle ? [] : [`${path}.handle is required`]),
        ...(isRecord(action.placement) ? [] : [`${path}.placement is required`]),
      ];
    case "connect":
      return [
        ...validateReference(action.from, `${path}.from`),
        ...validateReference(action.to, `${path}.to`),
        ...validateNullableLabel(action.label, `${path}.label`),
      ];
    case "branch": {
      const failures = validateReference(action.from, `${path}.from`);
      if (!Array.isArray(action.branches) || action.branches.length < 2) {
        return [...failures, `${path}.branches must contain at least two edges`];
      }
      action.branches.forEach((branch, branchIndex) => {
        if (!isRecord(branch)) {
          failures.push(`${path}.branches[${branchIndex}] must be an object`);
          return;
        }
        failures.push(...validateReference(branch.to, `${path}.branches[${branchIndex}].to`));
        failures.push(...validateNullableLabel(branch.label, `${path}.branches[${branchIndex}].label`));
      });
      return failures;
    }
    case "rename":
      return [
        ...validateReference(action.target, `${path}.target`),
        ...(typeof action.label === "string" && action.label.trim() ? [] : [`${path}.label is required`]),
      ];
    case "undo":
    case "cancel":
      return [];
    default:
      return Array.isArray(action.targets) && action.targets.length
        ? action.targets.flatMap((target, targetIndex) =>
            validateReference(target, `${path}.targets[${targetIndex}]`),
          )
        : [`${path}.targets must be a non-empty array`];
  }
}

function validateReference(reference, path) {
  if (!isRecord(reference) || typeof reference.kind !== "string") return [`${path} is not a typed object reference`];
  switch (reference.kind) {
    case "current_selection":
    case "pointer":
      return [];
    case "visible_label":
      return typeof reference.label === "string" && reference.label.trim() ? [] : [`${path}.label is required`];
    case "type_ordinal":
      return typeof reference.nodeType === "string" && Number.isInteger(reference.ordinal)
        ? []
        : [`${path} needs nodeType and ordinal`];
    case "plan_handle":
      return typeof reference.handle === "string" && reference.handle ? [] : [`${path}.handle is required`];
    default:
      return [`${path}.kind is invalid: ${String(reference.kind)}`];
  }
}

function validateNullableLabel(label, path) {
  return label === null || (typeof label === "string" && label.trim())
    ? []
    : [`${path} must be a non-empty string or null`];
}

function validateExpectedOutcome(plan, expected) {
  const failures = [];
  if (plan.status !== expected.status) {
    failures.push(`expected status ${expected.status}, received ${String(plan.status)}`);
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
  if (expected.missingSlotsIncludes) {
    const missingSlots = Array.isArray(plan.missingSlots) ? plan.missingSlots : [];
    for (const slot of expected.missingSlotsIncludes) {
      if (!missingSlots.includes(slot)) failures.push(`missingSlots does not include ${slot}`);
    }
  }
  return failures;
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

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON content`);
  }
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
      typeof fixtureCase.parserIssue !== "string" ||
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
        !Array.isArray(fixtureCase.pendingClarification.missingSlots))
    ) {
      throw new Error(`${fixturePath} contains a malformed pending clarification`);
    }
    if (seenIds.has(fixtureCase.id)) throw new Error(`Duplicate fixture case id: ${fixtureCase.id}`);
    seenIds.add(fixtureCase.id);
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
  --timeout-ms N      Per-case client timeout (default 20000)
  --help              Show this help
`);
}

function createVoiceTurnId(caseId) {
  const safeCaseId = caseId.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").slice(0, 50);
  return `eval-${safeCaseId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
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
