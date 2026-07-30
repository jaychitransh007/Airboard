#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runInteractionCorpus,
} from "./lib/interaction-eval-corpus.mjs";
import {
  executeInteractionEvalCase,
} from "./lib/interaction-eval-production-executor.mjs";
import {
  emitJsonReport,
  emitJunitReport,
  emitMarkdownReport,
  emitHtmlReport,
} from "./lib/interaction-eval-reporters.mjs";
import { buildConfusionMatrix } from "./lib/confusion-matrix.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const corpusPath = resolve(
  process.cwd(),
  args.fixture ?? resolve(ROOT, "evals/interactions/v1.json"),
);

main().catch((error) => {
  console.error(
    `Interaction evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const corpusBytes = await readFile(corpusPath);
  const corpus = JSON.parse(corpusBytes.toString("utf8"));
  const report = await runInteractionCorpus(
    corpus,
    executeInteractionEvalCase,
    {
      ...(args.caseIds.length > 0 ? { caseIds: args.caseIds } : {}),
      failFast: args.failFast,
    },
  );
  const metadata = {
    datasetHash: createHash("sha256").update(corpusBytes).digest("hex"),
    commit: gitCommit(),
    node: process.version,
    environment: process.env.CI ? "ci" : "local",
    replay: `node scripts/eval-interactions.mjs --fixture ${relativeToRoot(corpusPath)}`,
  };
  const casesById = new Map(
    corpus.cases.map((evalCase) => [evalCase.id, evalCase]),
  );
  const output = {
    ...report,
    metadata,
    confusionMatrices: {
      outcome: buildConfusionMatrix(
        report.results.map((result) => ({
          expected:
            casesById.get(result.caseId)?.expected?.outcome ?? "unknown",
          actual:
            result.observed?.outcome ??
            (result.status === "error" ? "evaluation_error" : "unknown"),
        })),
      ),
    },
  };

  if (args.outputDir) {
    const outputDirectory = resolve(process.cwd(), args.outputDir);
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(outputDirectory, "interaction-results.json"),
        emitJsonReport(output, { metadata }),
      ),
      writeFile(
        resolve(outputDirectory, "interaction-results.xml"),
        emitJunitReport(output, {
          suiteName: "Airboard interaction evals",
          includeObserved: true,
        }),
      ),
      writeFile(
        resolve(outputDirectory, "interaction-results.md"),
        emitMarkdownReport(output, {
          title: "Airboard interaction evaluation",
        }),
      ),
      writeFile(
        resolve(outputDirectory, "interaction-results.html"),
        emitHtmlReport(output, {
          title: "Airboard interaction evaluation",
        }),
      ),
    ]);
    console.log(`Artifacts: ${outputDirectory}`);
  }

  console.log(
    `Airboard interaction evaluation: ${report.summary.passed}/${report.summary.total} passed`,
  );
  console.log(
    `Capabilities: ${report.coverage.coveredRequiredCapabilityCount}/${report.coverage.requiredCapabilityCount} required`,
  );
  for (const result of report.results.filter(({ status }) => status !== "passed")) {
    console.log(`  ${result.status.toLocaleUpperCase("en-US")} ${result.caseId}`);
    for (const check of result.checks?.filter(({ status }) => status === "failed") ?? []) {
      console.log(`     - ${check.id}: ${check.message}`);
    }
    if (result.error) console.log(`     - ${result.error.message}`);
  }
  if (report.summary.failed > 0 || report.summary.errors > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = { caseIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--output-dir") options.outputDir = argv[++index];
    else if (arg === "--case") options.caseIds.push(argv[++index]);
    else if (arg === "--fail-fast") options.failFast = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
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

function relativeToRoot(path) {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}
