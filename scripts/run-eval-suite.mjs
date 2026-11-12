#!/usr/bin/env node

// The offline eval gate (`pnpm eval:pr`). It runs only eval CLIs: unit and
// script tests run once, through `pnpm test` and `pnpm test:scripts`, never
// here. The runner writes one JSON summary, suite-results.json.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * The PR tier, in run order. Each step is an eval CLI with its arguments.
 * `{output}` is replaced by the run's output directory.
 */
export const prSteps = [
  { id: "dataset-policy", args: ["scripts/validate-eval-datasets.mjs"] },
  { id: "capability-coverage", args: ["scripts/eval-capability-coverage.mjs"] },
  {
    id: "release-quality-report-policy",
    args: [
      "scripts/eval-quality-report.mjs",
      "--mode",
      "pr",
      "--output",
      "{output}/quality-report-policy.json",
    ],
  },
  {
    id: "release-quality-policy",
    args: [
      "scripts/eval-quality-gate.mjs",
      "--mode",
      "pr",
      "--output",
      "{output}/quality-policy.json",
    ],
  },
  { id: "deterministic-contract-matrix", args: ["scripts/eval-contract-matrix.mjs"] },
  { id: "deterministic-positive-corpus", args: ["scripts/eval-grammar.mjs"] },
  { id: "grounded-ambient-negatives", args: ["scripts/eval-false-accepts.mjs"] },
  {
    id: "semantic-ambient-negative-replay",
    args: ["scripts/eval-semantic-negatives.mjs", "--replay"],
  },
  { id: "provider-event-replay", args: ["scripts/eval-provider-events.mjs"] },
  { id: "seeded-evaluator-faults", args: ["scripts/eval-seeded-faults.mjs"] },
  {
    id: "canonical-interactions",
    args: ["scripts/eval-interactions.mjs", "--output-dir", "{output}/interactions"],
  },
  { id: "landmark-replay", args: ["scripts/eval-gesture-replay.mjs"] },
  {
    id: "semantic-metamorphic-contract",
    args: ["scripts/eval-semantic-metamorphic.mjs", "--validate-only"],
  },
  { id: "audio-adapter-replay", args: ["scripts/eval-audio-stt.mjs"] },
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Eval suite could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tier = options.tier ?? "pr";
  if (tier !== "pr") throw new Error(`Unknown eval tier: ${tier}`);
  const runId = process.env.AIRBOARD_EVAL_RUN_ID ?? `${tier}-latest`;
  const outputDirectory = resolve(
    process.cwd(),
    options.outputDir ?? "artifacts/evals/latest",
  );
  await mkdir(outputDirectory, { recursive: true });

  const results = [];
  for (const step of prSteps) {
    const result = await runStep(step, { outputDirectory, runId });
    results.push(result);
    console.log(
      `${result.status === "passed" ? "PASS" : "FAIL"} ${step.id} (${formatMs(result.durationMs)})`,
    );
    if (result.status !== "passed") {
      // The whole output, so CI logs carry the failure without artifacts.
      for (const line of result.output.trim().split(/\r?\n/u)) console.log(`  ${line}`);
      if (!options.keepGoing) break;
    }
  }
  const summary = {
    total: results.length,
    passed: results.filter(({ status }) => status === "passed").length,
    failed: results.filter(({ status }) => status === "failed").length,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
  };
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
    results,
    summary,
    replay: `node scripts/run-eval-suite.mjs --tier ${tier}`,
  };
  await writeFile(
    resolve(outputDirectory, "suite-results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Summary: ${resolve(outputDirectory, "suite-results.json")}`);
  if (summary.failed > 0 || summary.total < prSteps.length) process.exitCode = 1;
}

function runStep(step, { outputDirectory, runId }) {
  const args = step.args.map((arg) => arg.replaceAll("{output}", outputDirectory));
  const command = [process.execPath, ...args]
    .map((part) => (/[\s"']/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
  return new Promise((resolveStep) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, args, {
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
    const finish = (exitCode, extra = {}) =>
      resolveStep({
        id: step.id,
        command,
        exitCode,
        status: exitCode === 0 ? "passed" : "failed",
        durationMs: performance.now() - startedAt,
        output,
        ...extra,
      });
    child.on("error", (error) => {
      output += error.message;
      finish(2);
    });
    child.on("close", (code, signal) => finish(code ?? 2, { signal: signal ?? null }));
  });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tier") result.tier = argv[++index];
    else if (arg.startsWith("--tier=")) result.tier = arg.slice(7);
    else if (arg === "--output-dir") result.outputDir = argv[++index];
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

function formatMs(value) {
  return value < 1_000 ? `${value.toFixed(0)}ms` : `${(value / 1_000).toFixed(1)}s`;
}
