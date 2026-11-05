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
  const options = { live: false, attempts: 1, caseIds: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--validate-only") continue;
    if (argument === "--live") {
      options.live = true;
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
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!options.live && (options.attempts !== 1 || options.caseIds.length > 0)) {
    throw new Error("--attempts and --case require --live");
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
