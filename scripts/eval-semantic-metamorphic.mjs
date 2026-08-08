#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadAndExpandSemanticMetamorphicCorpus,
} from "./lib/semantic-metamorphic-corpus.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_SOURCE = resolve(
  REPOSITORY_ROOT,
  "evals/voice-intent/v1.json",
);
const DEFAULT_SEMANTIC_RUNNER = resolve(
  REPOSITORY_ROOT,
  "scripts/eval-voice-intent.mjs",
);

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseSemanticMetamorphicArguments(args);
  if (options.help) {
    printHelp();
    return 0;
  }

  const sourcePath = resolve(
    dependencies.cwd ?? process.cwd(),
    options.source ?? DEFAULT_SOURCE,
  );
  const { corpus, validation } =
    await loadAndExpandSemanticMetamorphicCorpus(sourcePath);
  printValidation(validation, sourcePath);

  if (!options.live) {
    console.log("Result: VALID (offline validation only)");
    return 0;
  }

  console.log(
    `Live delegation: ${corpus.cases.length} cases × ${options.attempts} attempt${options.attempts === 1 ? "" : "s"}`,
  );
  const result = await delegateSemanticMetamorphicLive({
    corpus,
    attempts: options.attempts,
    runnerPath:
      dependencies.runnerPath ?? DEFAULT_SEMANTIC_RUNNER,
    repositoryRoot:
      dependencies.repositoryRoot ?? REPOSITORY_ROOT,
    apiUrl: options.apiUrl,
    origin: options.origin,
    model: options.model,
    timeoutMs: options.timeoutMs,
    caseIds: options.caseIds,
    replayCommand: buildStableReplayCommand({
      script: "scripts/eval-semantic-metamorphic.mjs",
      source: options.source,
      attempts: options.attempts,
      apiUrl: options.apiUrl,
      origin: options.origin,
      model: options.model,
      timeoutMs: options.timeoutMs,
      caseIds: options.caseIds,
    }),
    spawnImpl: dependencies.spawnImpl,
    environment: dependencies.environment,
  });
  return result.exitCode;
}

export function parseSemanticMetamorphicArguments(args) {
  const options = {
    attempts: 1,
    caseIds: [],
    help: false,
    live: false,
  };
  let validateOnly = false;
  let attemptsSupplied = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--validate-only") {
      validateOnly = true;
      continue;
    }
    if (argument === "--live") {
      options.live = true;
      continue;
    }

    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    switch (name) {
      case "--source":
        options.source = value;
        break;
      case "--attempts":
        options.attempts = parseInteger(
          value,
          "--attempts",
          1,
          20,
        );
        attemptsSupplied = true;
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
        options.timeoutMs = parseInteger(
          value,
          "--timeout-ms",
          100,
          120_000,
        );
        break;
      case "--case":
        options.caseIds.push(value);
        break;
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }

  if (!options.help && validateOnly && options.live) {
    throw new Error("--validate-only and --live are mutually exclusive");
  }
  if (!options.help && attemptsSupplied && !options.live) {
    throw new Error("--attempts requires --live");
  }
  if (
    !options.help &&
    !options.live &&
    (options.apiUrl ||
      options.origin ||
      options.model ||
      options.timeoutMs ||
      options.caseIds.length > 0)
  ) {
    throw new Error("Live runner options require --live");
  }
  return options;
}

export function buildSemanticRunnerArguments({
  fixturePath,
  attempts,
  apiUrl,
  origin,
  model,
  timeoutMs,
  caseIds = [],
}) {
  const args = [
    "--fixture",
    fixturePath,
    "--attempts",
    String(attempts),
  ];
  if (apiUrl) args.push("--api-url", apiUrl);
  if (origin) args.push("--origin", origin);
  if (model) args.push("--model", model);
  if (timeoutMs !== undefined) {
    args.push("--timeout-ms", String(timeoutMs));
  }
  for (const caseId of caseIds) args.push("--case", caseId);
  return args;
}

export async function withMaterializedSemanticCorpus(corpus, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Materialized corpus callback must be a function");
  }
  const directory = await mkdtemp(
    join(tmpdir(), "airboard-semantic-metamorphic-"),
  );
  const fixturePath = join(directory, "corpus.v1.json");
  try {
    await writeFile(
      fixturePath,
      `${JSON.stringify(corpus, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    return await callback(fixturePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function delegateSemanticMetamorphicLive({
  corpus,
  attempts = 1,
  runnerPath = DEFAULT_SEMANTIC_RUNNER,
  repositoryRoot = REPOSITORY_ROOT,
  apiUrl,
  origin,
  model,
  timeoutMs,
  caseIds = [],
  replayCommand,
  spawnImpl = spawn,
  environment = process.env,
}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error("attempts must be an integer from 1 to 20");
  }
  return withMaterializedSemanticCorpus(corpus, async (fixturePath) => {
    const runnerArguments = buildSemanticRunnerArguments({
      fixturePath,
      attempts,
      apiUrl,
      origin,
      model,
      timeoutMs,
      caseIds,
    });
    const child = spawnImpl(
      process.execPath,
      [runnerPath, ...runnerArguments],
      {
        cwd: repositoryRoot,
        env: {
          ...environment,
          ...(replayCommand
            ? { AIRBOARD_EVAL_REPLAY_COMMAND: replayCommand }
            : {}),
        },
        stdio: "inherit",
      },
    );
    return waitForChild(child);
  });
}

export function buildStableReplayCommand({
  script,
  source,
  attempts,
  apiUrl,
  origin,
  model,
  timeoutMs,
  caseIds = [],
}) {
  const args = ["node", script, "--live", "--attempts", String(attempts)];
  if (source) args.push("--source", source);
  if (apiUrl) args.push("--api-url", apiUrl);
  if (origin) args.push("--origin", origin);
  if (model) args.push("--model", model);
  if (timeoutMs !== undefined) args.push("--timeout-ms", String(timeoutMs));
  for (const caseId of caseIds) args.push("--case", caseId);
  return args.map(shellQuote).join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function waitForChild(child) {
  return new Promise((resolveChild, rejectChild) => {
    child.once("error", rejectChild);
    child.once("exit", (exitCode, signal) => {
      resolveChild({
        exitCode: Number.isInteger(exitCode) ? exitCode : 2,
        signal: signal ?? null,
      });
    });
  });
}

function printValidation(validation, sourcePath) {
  const { summary } = validation;
  console.log("Airboard semantic metamorphic corpus");
  console.log(`Source:      ${sourcePath}`);
  console.log(
    `Contracts:   plan ${summary.semanticPlanContractVersion} / capabilities ${summary.capabilityRegistryVersion}`,
  );
  console.log(
    `Scenarios:   ${summary.scenarioCount} / ${summary.distinctRequestCount} distinct inputs (minimum ${summary.minimumScenarios})`,
  );
  console.log(
    `Transcript:  max ${summary.maxTranscriptCharacters}/500 characters`,
  );
  console.log(
    `Invariants:  ${Object.entries(summary.invariantCounts)
      .map(([invariant, count]) => `${invariant}=${count}`)
      .join(", ")}`,
  );
  console.log(
    `Statuses:    ${Object.entries(summary.expectedStatuses)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`,
  );
  console.log(
    `Registry:    ${summary.productionActionTypeCount} actions / ${summary.productionNodeTypeCount} node types aligned`,
  );
  console.log(
    `Expected:    ${Object.keys(summary.expectedActionTypes).sort().join(", ")}`,
  );
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/eval-semantic-metamorphic.mjs [mode] [options]

Modes:
  --validate-only       Generate and validate locally without network calls (default)
  --live                Materialize a temporary corpus and delegate to eval-voice-intent

Options:
  --source PATH         Production semantic seed corpus (evals/voice-intent/v1.json)
  --attempts N          Live attempts per scenario, 1-20 (default 1; requires --live)
  --api-url URL         Forward API URL to the live semantic runner
  --origin URL          Forward Origin header to the live semantic runner
  --model MODEL         Forward an optional allowlisted model
  --timeout-ms N        Forward per-case timeout, 100-120000ms
  --case ID             Run one materialized scenario; may be repeated
  --help                Show this help
`);
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Semantic metamorphic evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 2;
    });
}
