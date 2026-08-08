#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateQualityGate,
  loadQualityGateConfig,
  QualityGateConfigError,
} from "./lib/eval-quality-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = resolve(
  ROOT,
  "evals/quality-gates/release.v1.json",
);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return 0;
  }

  const configPath = resolve(process.cwd(), options.config ?? DEFAULT_CONFIG);
  const config = await loadQualityGateConfig(configPath);
  const report = options.report
    ? await readJson(resolve(process.cwd(), options.report), "quality report")
    : null;
  const result = evaluateQualityGate({
    config,
    report,
    mode: options.mode,
  });

  if (options.output) {
    const outputPath = resolve(process.cwd(), options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSummary(result);
  }
  return result.passed ? 0 : 1;
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
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue =
      separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${name} requires a value`);
    switch (name) {
      case "--mode":
        if (!["pr", "release"].includes(value)) {
          throw new Error("--mode must be pr or release");
        }
        options.mode = value;
        break;
      case "--config":
        options.config = value;
        break;
      case "--report":
        options.report = value;
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

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} ${path}: ${describeError(error)}`);
  }
}

function printSummary(result) {
  const label = result.passed ? "PASS" : "FAIL";
  if (result.status === "config_validated") {
    console.log(
      `Airboard quality gate: ${label} (PR config validated; report and media availability not asserted)`,
    );
  } else {
    console.log(
      `Airboard quality gate: ${label} (${result.mode}; ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped)`,
    );
  }
  console.log(
    `Config ${result.configVersion}; baseline ${result.baselineVersion}`,
  );
  for (const gate of result.gates.filter(
    ({ status }) => status === "failed",
  )) {
    console.log(`  FAIL ${gate.id}: ${gate.message}`);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/eval-quality-gate.mjs [options]

Validates a versioned Airboard release policy and optionally evaluates a
provider-neutral quality report. Reports use schema
"airboard-quality-report.v1" and a nested or dotted-path "metrics" object.

Options:
  --mode pr|release  PR validates config without asserting media availability;
                     release requires every configured metric and slice
  --config PATH      Gate/baseline config
                     (default: evals/quality-gates/release.v1.json)
  --report PATH      Normalized quality report JSON
  --output PATH      Write the complete gate result JSON
  --json             Print the complete gate result JSON
  --help             Show this help
`);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
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
      const prefix =
        error instanceof QualityGateConfigError
          ? "Quality-gate config is invalid"
          : "Quality-gate evaluation could not start";
      console.error(`${prefix}: ${describeError(error)}`);
      process.exitCode = 2;
    });
}
