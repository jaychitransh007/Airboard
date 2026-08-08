#!/usr/bin/env node

import { resolve } from "node:path";

import {
  loadCapabilityCoverage,
} from "./lib/capability-coverage.mjs";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(
    `Capability coverage validation could not start: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 2;
});

async function main() {
  const result = await loadCapabilityCoverage({
    root: resolve(import.meta.dirname, ".."),
    ...(args.manifest ? { manifestPath: args.manifest } : {}),
    release: args.release,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          valid: result.valid,
          mode: result.mode,
          manifestPath: result.manifestPath,
          registryVersion: result.catalog.registryVersion,
          summary: result.summary,
          physicalMedia: result.physicalMedia,
          errors: result.errors,
          warnings: result.warnings,
          coverage: result.coverage,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Airboard capability coverage: ${result.valid ? "PASS" : "FAIL"} (${result.mode})`,
    );
    console.log(
      `  Registry ${result.catalog.registryVersion}; capabilities ${result.summary.completeCapabilityCount}/${result.summary.capabilityCount}; evidence IDs ${result.summary.indexedEvidenceCount}`,
    );
    for (const [dimension, summary] of Object.entries(
      result.summary.dimensions,
    )) {
      console.log(`  ${dimension}: ${summary.complete}/${summary.total}`);
    }
    for (const warning of result.warnings) {
      console.log(`  WARN ${warning.code}: ${warning.message}`);
    }
    for (const error of result.errors) {
      console.log(`  FAIL ${error.code} ${error.path}: ${error.message}`);
    }
  }

  if (!result.valid) process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = { release: false, json: false, manifest: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--release") {
      parsed.release = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--manifest") {
      parsed.manifest = argv[++index];
      if (!parsed.manifest) throw new Error("--manifest requires a path");
    } else if (arg.startsWith("--manifest=")) {
      parsed.manifest = arg.slice("--manifest=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
