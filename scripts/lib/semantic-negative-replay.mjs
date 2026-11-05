import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The API sources use extensionless relative imports; resolve them to their
// .ts files the way the API's own tests do.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { loadConfig } = await import("../../apps/api/src/config.ts");
const { OpenAiResponsesSemanticIntentProvider } = await import(
  "../../apps/api/src/semanticIntent/openaiResponses.ts"
);
const { parseSemanticIntentRequest } = await import(
  "../../apps/api/src/semanticIntent/protocol.ts"
);
const { resolveExistingBoardFanIn } = await import(
  "../../packages/core/src/existingBoardFanIn.ts"
);
const { parseSemanticPlan } = await import("../../packages/core/src/semanticPlan.ts");
const { evaluateGroundedSemanticPlan, validateGroundedSemanticOutcome } = await import(
  "./semantic-grounding-eval.mjs"
);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const SEMANTIC_NEGATIVE_RECORDINGS_PATH = resolve(
  ROOT,
  "evals/voice-intent/semantic-negatives.recorded.v1.json",
);
export const SEMANTIC_NEGATIVE_KNOWN_PATH = resolve(
  ROOT,
  "evals/voice-intent/semantic-negatives.known-false-accepts.v1.json",
);
export const SEMANTIC_NEGATIVE_RECORDINGS_SCHEMA =
  "airboard-semantic-negative-recordings.v1";
// The pilot API sets AIRBOARD_INTENT_MODEL to this; record with the model
// production uses, and re-record when it changes.
export const SEMANTIC_NEGATIVE_DEFAULT_MODEL = "gpt-5.4-mini";
export const SEMANTIC_NEGATIVE_RECORD_COMMAND =
  "node --env-file-if-exists=.env scripts/eval-semantic-negatives.mjs --record";

const REPLAY_ONLY_API_KEY = "replay-only";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runtimeConfig(model, apiKey) {
  const base = loadConfig({}).semanticIntent;
  return {
    ...base,
    provider: "openai",
    apiKey,
    defaultModel: model,
    allowedModels: [...new Set([...base.allowedModels, model])],
  };
}

/** The request the API route builds from the browser's body for this case. */
function semanticRequest(scenario, model, config) {
  const parsed = parseSemanticIntentRequest(
    {
      voiceTurnId: `eval-${scenario.id}`.slice(0, 64),
      transcript: scenario.transcript,
      parserIssue: scenario.parserIssue,
      context: scenario.context,
      model,
    },
    config,
  );
  if (!parsed.ok) {
    throw new Error(`${scenario.id} is not a valid semantic request: ${parsed.error.message}`);
  }
  return parsed.value;
}

/**
 * Ask the live provider once per ambient case and keep what the provider
 * reads back: the tool call. Each answer carries a hash of the exact request
 * body, so a later change to the prompt, tool, model or request shape shows
 * up as a stale recording instead of passing on old evidence.
 */
export async function recordSemanticNegativeAnswers(corpus, {
  apiKey,
  model = SEMANTIC_NEGATIVE_DEFAULT_MODEL,
  fetchImpl = fetch,
  log = () => {},
}) {
  if (!apiKey) {
    throw new Error("Recording needs AIRBOARD_INTENT_API_KEY or OPENAI_API_KEY.");
  }
  const config = runtimeConfig(model, apiKey);
  const answers = [];
  for (const scenario of corpus.cases) {
    let requestHash = null;
    let payload = null;
    const recordingFetch = async (url, init) => {
      requestHash = sha256(String(init.body));
      const response = await fetchImpl(url, init);
      const text = await response.text();
      if (response.ok) payload = JSON.parse(text);
      return new Response(text, { status: response.status, headers: response.headers });
    };
    const provider = new OpenAiResponsesSemanticIntentProvider(config, recordingFetch);
    let outcome;
    try {
      const { plan } = await provider.resolve(
        semanticRequest(scenario, model, config),
        model,
        AbortSignal.timeout(30_000),
      );
      outcome = `${plan.status}/${plan.issueCode}`;
    } catch (error) {
      if (!payload) throw new Error(`${scenario.id}: provider request failed: ${error.message}`);
      outcome = `rejected: ${error.message}`;
    }
    answers.push({
      caseId: scenario.id,
      requestHash,
      response: {
        status: payload.status ?? null,
        model: payload.model ?? null,
        output: (payload.output ?? [])
          .filter((item) => item.type === "function_call")
          .map(({ type, name, arguments: toolArguments }) => ({
            type,
            name,
            arguments: toolArguments,
          })),
      },
    });
    log(`${scenario.id}: ${outcome}`);
  }
  return {
    schemaVersion: SEMANTIC_NEGATIVE_RECORDINGS_SCHEMA,
    description:
      "One live provider answer per ambient meeting case, replayed offline by eval-semantic-negatives.mjs --replay.",
    recordedAt: new Date().toISOString(),
    model,
    answers,
  };
}

/**
 * Replay recorded answers through everything deterministic between the
 * microphone and the board: the API's built-in fan-in rule (which answers
 * before any model), the production OpenAI provider's request building and
 * output checks, the browser's plan parser, and the production command
 * pipeline. Each case gets one outcome:
 *
 * - quiet: unsupported / not_board_command, nothing reaches the board
 * - changes_board: the plan emitted board events
 * - acts: a resolved plan with actions but no board events (a selection)
 * - asks_clarification: Airo would ask a question
 * - wrong_issue: unsupported, for a reason other than not_board_command
 * - rejected: the API or browser refused the answer, so nothing happens
 * - answered_by_rule: the API's fan-in rule answered without the model
 */
export async function replaySemanticNegativeAnswers(corpus, recordings) {
  if (recordings?.schemaVersion !== SEMANTIC_NEGATIVE_RECORDINGS_SCHEMA) {
    throw new Error(`Expected ${SEMANTIC_NEGATIVE_RECORDINGS_SCHEMA} recordings.`);
  }
  const config = runtimeConfig(recordings.model, REPLAY_ONLY_API_KEY);
  const answers = new Map(recordings.answers.map((answer) => [answer.caseId, answer]));
  const results = [];
  for (const scenario of corpus.cases) {
    const answer = answers.get(scenario.id);
    const fanIn = resolveExistingBoardFanIn(scenario.transcript, scenario.context);
    if (fanIn.status !== "unrecognized") {
      results.push({
        caseId: scenario.id,
        stale: !answer,
        outcome: "answered_by_rule",
        detail: `the API's fan-in rule answered "${fanIn.status}" before any model`,
      });
      continue;
    }
    if (!answer) {
      results.push({ caseId: scenario.id, stale: true, outcome: null, detail: "no recorded answer" });
      continue;
    }
    let requestHash = null;
    const replayFetch = async (_url, init) => {
      requestHash = sha256(String(init.body));
      return new Response(JSON.stringify(answer.response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const provider = new OpenAiResponsesSemanticIntentProvider(config, replayFetch);
    let outcome;
    let detail;
    try {
      const { plan } = await provider.resolve(
        semanticRequest(scenario, recordings.model, config),
        recordings.model,
      );
      // The browser parses the API's answer again before acting on it.
      const parsed = parseSemanticPlan(plan);
      if (!parsed.ok) {
        outcome = "rejected";
        detail = `the browser rejected the plan at ${parsed.error.path}: ${parsed.error.message}`;
      } else {
        ({ outcome, detail } = classifyPlan(parsed.value, scenario));
      }
    } catch (error) {
      outcome = "rejected";
      detail = `the API rejected the answer: ${error.message}`;
    }
    results.push({
      caseId: scenario.id,
      stale: requestHash !== answer.requestHash,
      outcome,
      detail,
    });
  }
  const unknown = recordings.answers
    .map((answer) => answer.caseId)
    .filter((caseId) => !corpus.cases.some((scenario) => scenario.id === caseId));
  return {
    results,
    stale: results.filter((result) => result.stale).map((result) => result.caseId),
    unknown,
  };
}

function classifyPlan(plan, scenario) {
  const actions = plan.actions ?? [];
  const summary = `${plan.status}/${plan.issueCode}`;
  const grounded = evaluateGroundedSemanticPlan(plan, scenario.context);
  const groundingFailures = validateGroundedSemanticOutcome(grounded, scenario.expected, "unsupported");
  if (groundingFailures.length > 0) {
    const what = actions.map((action) => [action.type, action.label].filter(Boolean).join(" ")).join(", ");
    return { outcome: "changes_board", detail: `${summary}: ${what}` };
  }
  if (plan.status === "resolved" && actions.length > 0) {
    return { outcome: "acts", detail: `${summary}: ${actions.map((action) => action.type).join(", ")}` };
  }
  if (plan.status === "clarification") return { outcome: "asks_clarification", detail: summary };
  if (plan.status === scenario.expected.status && plan.issueCode === scenario.expected.issueCode) {
    return { outcome: "quiet", detail: summary };
  }
  return { outcome: "wrong_issue", detail: summary };
}

/**
 * Every case must be quiet unless the reviewed known list names it with the
 * same outcome. A listed case that improves must leave the list, so the list
 * only ever shrinks unless someone adds to it in a reviewed change.
 */
export function compareWithKnownFalseAccepts(replay, known) {
  const listed = new Map((known?.cases ?? []).map((entry) => [entry.caseId, entry.outcome]));
  const problems = [];
  for (const result of replay.results) {
    if (result.outcome === null) continue;
    const expected = listed.get(result.caseId) ?? "quiet";
    if (result.outcome !== expected) {
      problems.push(
        expected === "quiet"
          ? `${result.caseId} now ${result.outcome} (${result.detail})`
          : `${result.caseId} is listed as ${expected} but is now ${result.outcome}; update the known list`,
      );
    }
  }
  for (const caseId of listed.keys()) {
    if (!replay.results.some((result) => result.caseId === caseId)) {
      problems.push(`${caseId} is on the known list but not in the corpus`);
    }
  }
  return problems;
}

export async function readKnownFalseAccepts(path = SEMANTIC_NEGATIVE_KNOWN_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readSemanticNegativeRecordings(path = SEMANTIC_NEGATIVE_RECORDINGS_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeSemanticNegativeRecordings(
  recordings,
  path = SEMANTIC_NEGATIVE_RECORDINGS_PATH,
) {
  await writeFile(path, `${JSON.stringify(recordings, null, 2)}\n`, "utf8");
}
