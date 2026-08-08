#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  aggregateQualityArtifacts,
} from "./lib/eval-quality-report.mjs";
import {
  loadQualityGateConfig,
} from "./lib/eval-quality-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = resolve(
  ROOT,
  "evals/quality-gates/release.v1.json",
);

export async function main(
  args = process.argv.slice(2),
  environment = process.env,
) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return 0;
  }

  const artifactRoot = resolve(
    process.cwd(),
    options.root ?? environment.AIRBOARD_EVAL_OUTPUT_DIR ?? ".",
  );
  const qualityGateConfig = await loadQualityGateConfig(
    resolve(process.cwd(), options.config ?? DEFAULT_CONFIG),
  );
  const report = await aggregateQualityArtifacts({
    artifactRoot,
    qualityGateConfig,
    mode: options.mode,
  });
  const outputPath = resolve(
    process.cwd(),
    options.output ??
      resolve(artifactRoot, "airboard-quality-report.v1.json"),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report, outputPath);
  }
  if (report.status === "inconclusive") return 2;
  return report.status === "incomplete" ? 1 : 0;
}

function parseArguments(args) {
  const options = {
    help: false,
    json: false,
    mode: "pr",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    switch (name) {
      case "--mode":
        if (!["pr", "release"].includes(value)) {
          throw new Error("--mode must be pr or release");
        }
        options.mode = value;
        break;
      case "--root":
        options.root = value;
        break;
      case "--config":
        options.config = value;
        break;
      case "--output":
        options.output = value;
        break;
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }
  return options;
}

function printSummary(report, outputPath) {
  if (report.status === "config_only") {
    console.log(
      "Airboard quality report: CONFIG ONLY (PR does not assert protected media, participant coverage, or observed hours)",
    );
  } else {
    console.log(
      `Airboard quality report: ${report.status.toLocaleUpperCase("en-US")} (${report.evidence.issues.length} evidence issue(s))`,
    );
    for (const evidenceIssue of report.evidence.issues) {
      console.log(
        `  ${evidenceIssue.code} ${evidenceIssue.source}/${evidenceIssue.path}: ${evidenceIssue.message}`,
      );
    }
  }
  console.log(`Report: ${outputPath}`);
}

function printHelp() {
  console.log(`Usage: node scripts/eval-quality-report.mjs [options]

Aggregates structured Airboard eval artifacts into the provider-neutral
airboard-quality-report.v1 schema consumed by eval-quality-gate.mjs.

Options:
  --mode pr|release  PR emits an explicit config-only report; release requires
                     complete live/media/participant evidence (default: pr)
  --root PATH        Eval artifact root (default: AIRBOARD_EVAL_OUTPUT_DIR)
  --config PATH      Quality-gate config
  --output PATH      Output JSON path
  --json             Print the complete report
  --help             Show this help
`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Quality report could not be created: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 2;
    });
}
