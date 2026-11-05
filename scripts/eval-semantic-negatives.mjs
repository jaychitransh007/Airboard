#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
} from "../apps/api/src/semanticIntent/types.ts";
import {
  parseIntentCanvasCommand,
} from "../apps/web/src/features/board/intentCanvasParser.ts";
import {
  delegateSemanticMetamorphicLive,
} from "./eval-semantic-metamorphic.mjs";
import {
  SEMANTIC_NEGATIVE_DEFAULT_MODEL,
  SEMANTIC_NEGATIVE_RECORD_COMMAND,
  compareWithKnownFalseAccepts,
  readKnownFalseAccepts,
  readSemanticNegativeRecordings,
  recordSemanticNegativeAnswers,
  replaySemanticNegativeAnswers,
  writeSemanticNegativeRecordings,
} from "./lib/semantic-negative-replay.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = resolve(
  ROOT,
  "evals/voice-intent/meeting-negatives.v1.json",
);
const RECOVERABLE_ISSUES = new Set(
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
);

export async function buildSemanticNegativeCorpus(sourcePath = DEFAULT_SOURCE) {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  if (
    source?.schemaVersion !== "1.0" ||
    !Array.isArray(source.utterances) ||
    source.utterances.length === 0
  ) {
    throw new Error("Expected a non-empty meeting-negatives corpus.");
  }
  const cases = source.utterances.map((utterance) => {
    const parsed = parseIntentCanvasCommand(utterance.text, {
      activationPolicy: "externally_activated",
    });
    if (
      parsed.status === "parsed" ||
      !RECOVERABLE_ISSUES.has(parsed.issue.code)
    ) {
      throw new Error(
        `Ambient case ${utterance.id} no longer enters production semantic fallback.`,
      );
    }
    return {
      id: `ambient-${utterance.id}`,
      transcript: utterance.text,
      parserIssue: parsed.issue.code,
      context: temptingBoardContext(),
      expected: {
        status: "unsupported",
        issueCode: "not_board_command",
        actionTypeCounts: {},
      },
      ambientSafety: {
        sourceCaseId: utterance.id,
        expectedBoardMutationCount: 0,
      },
    };
  });
  return {
    schemaVersion: "1.0",
    description:
      "Meeting-style utterances that reach semantic fallback but must remain unsupported even against a tempting board.",
    ambientSafety: {
      schemaVersion: "airboard-semantic-negatives.v1",
      sourceSchemaVersion: source.schemaVersion,
      caseCount: cases.length,
      generatedDeterministically: true,
    },
    cases,
  };
}

function temptingBoardContext() {
  const objects = [
    ["User", "user"],
    ["Payment API", "api"],
    ["Ledger Database", "database"],
    ["Billing Service", "service"],
    ["Orders Queue", "queue"],
    ["Release Decision", "decision"],
    ["Agenda Note", "note"],
    ["Start", "terminator"],
    ["Input", "io"],
    ["Shared Document", "document"],
    ["Circle", "circle"],
    ["Legacy Box", "custom"],
  ].map(([label, nodeType], index) => ({
    label,
    nodeType,
    ordinal: 1,
    position: { x: 120 + (index % 4) * 220, y: 120 + Math.floor(index / 4) * 170 },
    size: { width: 152, height: 80 },
  }));
  return {
    selectionCount: 0,
    selected: [],
    objects,
    edges: [
      {
        from: { label: "User", nodeType: "user", ordinal: 1 },
        to: { label: "Payment API", nodeType: "api", ordinal: 1 },
        label: "requests",
      },
      {
        from: { label: "Payment API", nodeType: "api", ordinal: 1 },
        to: {
          label: "Ledger Database",
          nodeType: "database",
          ordinal: 1,
        },
        label: "writes",
      },
      {
        from: { label: "Billing Service", nodeType: "service", ordinal: 1 },
        to: { label: "Orders Queue", nodeType: "queue", ordinal: 1 },
        label: "publishes",
      },
    ],
    projectGlossary: [],
    pointerAvailable: true,
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const sourcePath = resolve(process.cwd(), options.source ?? DEFAULT_SOURCE);
  const corpus = await buildSemanticNegativeCorpus(sourcePath);
  console.log(
    `Airboard semantic ambient negatives: ${corpus.cases.length} fallback cases, all require unsupported/not_board_command and zero actions`,
  );
  if (options.record) {
    const recordings = await recordSemanticNegativeAnswers(corpus, {
      apiKey: process.env.AIRBOARD_INTENT_API_KEY || process.env.OPENAI_API_KEY,
      model: options.model ?? SEMANTIC_NEGATIVE_DEFAULT_MODEL,
      log: (line) => console.log(`  ${line}`),
    });
    await writeSemanticNegativeRecordings(recordings, options.recordings);
    console.log(`Recorded ${recordings.answers.length} answers from ${recordings.model}`);
    return replay(corpus, recordings, options.known);
  }
  if (options.replay) {
    return replay(corpus, await readSemanticNegativeRecordings(options.recordings), options.known);
  }
  if (!options.live) {
    console.log("Result: VALID (offline validation only)");
    return 0;
  }
  const result = await delegateSemanticMetamorphicLive({
    corpus,
    attempts: options.attempts,
    repositoryRoot: ROOT,
    apiUrl: options.apiUrl,
    origin: options.origin,
    model: options.model,
    timeoutMs: options.timeoutMs,
    caseIds: options.caseIds,
    replayCommand: semanticNegativeReplayCommand(options),
  });
  return result.exitCode;
}

/**
 * The offline false-accept gate: recorded provider answers for every ambient
 * case go back through the production API and browser code. Each case must
 * stay quiet unless the reviewed known list names it with the same outcome,
 * and a changed prompt, tool, model or request fails until the answers are
 * re-recorded, so the gate never passes on stale evidence.
 */
async function replay(corpus, recordings, knownPath) {
  const result = await replaySemanticNegativeAnswers(corpus, recordings);
  const known = await readKnownFalseAccepts(knownPath);
  const problems = compareWithKnownFalseAccepts(result, known);
  for (const problem of problems) console.log(`FAIL ${problem}`);
  if (result.stale.length > 0) {
    console.log(
      `STALE ${result.stale.length} of ${result.results.length} recordings: the prompt, tool, model or request changed since ${recordings.recordedAt}. Re-record with: ${SEMANTIC_NEGATIVE_RECORD_COMMAND}`,
    );
  }
  if (result.unknown.length > 0) {
    console.log(`UNKNOWN recordings for cases no longer in the corpus: ${result.unknown.join(", ")}`);
  }
  const counts = {};
  for (const { outcome } of result.results) counts[outcome] = (counts[outcome] ?? 0) + 1;
  const passed = problems.length === 0 && result.stale.length === 0 && result.unknown.length === 0;
  console.log(
    `Replay of ${result.results.length} recorded ${recordings.model} answers: ${Object.entries(counts).map(([outcome, count]) => `${count} ${outcome}`).join(", ")}. Known list: ${known.cases.length}. Result: ${passed ? "PASS" : "FAIL"}`,
  );
  return passed ? 0 : 1;
}

function semanticNegativeReplayCommand(options) {
  const args = [
    "node",
    "scripts/eval-semantic-negatives.mjs",
    "--live",
    "--attempts",
    String(options.attempts),
  ];
  if (options.source) args.push("--source", options.source);
  if (options.apiUrl) args.push("--api-url", options.apiUrl);
  if (options.origin) args.push("--origin", options.origin);
  if (options.model) args.push("--model", options.model);
  if (options.timeoutMs !== undefined) {
    args.push("--timeout-ms", String(options.timeoutMs));
  }
  for (const caseId of options.caseIds) args.push("--case", caseId);
  return args.map(shellQuote).join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseArguments(args) {
  const options = { live: false, replay: false, record: false, attempts: 1, caseIds: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--validate-only") continue;
    if (argument === "--live") {
      options.live = true;
      continue;
    }
    if (argument === "--replay") {
      options.replay = true;
      continue;
    }
    if (argument === "--record") {
      options.record = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    if (name === "--source") options.source = value;
    else if (name === "--api-url") options.apiUrl = value;
    else if (name === "--origin") options.origin = value;
    else if (name === "--model") options.model = value;
    else if (name === "--timeout-ms") options.timeoutMs = bounded(value, name, 100, 120_000);
    else if (name === "--attempts") options.attempts = bounded(value, name, 1, 20);
    else if (name === "--case") options.caseIds.push(value);
    else if (name === "--recordings") options.recordings = resolve(process.cwd(), value);
    else if (name === "--known") options.known = resolve(process.cwd(), value);
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!options.live && (options.attempts !== 1 || options.caseIds.length > 0)) {
    throw new Error("--attempts and --case require --live");
  }
  if ([options.live, options.replay, options.record].filter(Boolean).length > 1) {
    throw new Error("Choose one of --live, --replay and --record");
  }
  return options;
}

function bounded(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

const direct =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Semantic ambient-negative evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 2;
    });
}
