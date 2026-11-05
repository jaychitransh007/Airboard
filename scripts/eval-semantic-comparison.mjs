#!/usr/bin/env node

import { resolve } from "node:path";

import {
  compareSemanticEvalReports,
  loadSemanticEvalReport,
  writeSemanticComparisonReports,
} from "./lib/eval-semantic-comparison.mjs";

main().catch((error) => {
  console.error(
    `Semantic model comparison could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const baselinePath = resolve(process.cwd(), options.baseline);
  const candidatePath = resolve(process.cwd(), options.candidate);
  const outputPrefix = resolve(process.cwd(), options.outputPrefix);
  const replay = buildReplayCommand({
    baselinePath,
    candidatePath,
    outputPrefix,
  });
  const [baseline, candidate] = await Promise.all([
    loadSemanticEvalReport(baselinePath),
    loadSemanticEvalReport(candidatePath),
  ]);
  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    replay,
  });
  const paths = await writeSemanticComparisonReports({
    report,
    outputPrefix,
  });

  console.log("Airboard semantic model comparison");
  console.log(`Status:    ${report.status.toUpperCase()}`);
  console.log(
    `Dataset:   ${report.inputs.baseline?.datasetHash ?? "unavailable"}`,
  );
  console.log(
    `Core:      ${formatScore(report.metrics.coreAccuracy.baseline)} → ${formatScore(report.metrics.coreAccuracy.candidate)}`,
  );
  console.log(
    `Overall:   ${formatScore(report.metrics.overallAccuracy.baseline)} → ${formatScore(report.metrics.overallAccuracy.candidate)}`,
  );
  console.log(
    `Critical:  ${report.metrics.criticalSlices.filter(({ passed }) => passed).length}/${report.metrics.criticalSlices.length} slices within regression budget`,
  );
  console.log(`Reports:   ${paths.json.replace(/\.json$/u, ".[json|xml|md|html]")}`);
  for (const failure of report.failures) {
    console.log(`GATE FAIL: ${failure}`);
  }
  for (const reason of report.inconclusiveReasons) {
    console.log(`INCONCLUSIVE: ${reason}`);
  }

  if (report.status === "inconclusive") process.exitCode = 2;
  else if (report.status === "failed") process.exitCode = 1;
}

function parseArguments(args) {
  const options = {
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    if (name === "--baseline") options.baseline = value;
    else if (name === "--candidate") options.candidate = value;
    else if (name === "--output-prefix") options.outputPrefix = value;
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (
    !options.help &&
    (!options.baseline || !options.candidate || !options.outputPrefix)
  ) {
    throw new Error(
      "--baseline, --candidate, and --output-prefix are required",
    );
  }
  return options;
}

function buildReplayCommand({
  baselinePath,
  candidatePath,
  outputPrefix,
}) {
  return [
    "node",
    "scripts/eval-semantic-comparison.mjs",
    "--baseline",
    baselinePath,
    "--candidate",
    candidatePath,
    "--output-prefix",
    outputPrefix,
  ]
    .map(shellQuote)
    .join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatScore(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : "unavailable";
}

function printHelp() {
  console.log(`Usage: node scripts/eval-semantic-comparison.mjs [options]

Required:
  --baseline PATH       Baseline semantic-metamorphic JSON artifact
  --candidate PATH      Candidate semantic-metamorphic JSON artifact
  --output-prefix PATH  Report path without an extension

The comparator writes JSON, JUnit XML, Markdown, and HTML reports. Exit status
is 0 for pass, 1 for a quality/contract failure, and 2 for an inconclusive
provider-infrastructure comparison.
`);
}
