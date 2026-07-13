#!/usr/bin/env node

/**
 * Offline positive-grammar evaluation: replays the deterministic-positives
 * corpus through the real parser and fails if any case stops parsing to its
 * expected command. Together with eval-false-accepts (the negatives) this
 * makes every grammar change prove itself in CI: nothing users rely on may
 * break, and no meeting talk may start executing.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeScopedVoiceUtterance } from "../apps/web/src/features/board/browserSpeech.ts";
import { parseIntentCanvasCommand } from "../apps/web/src/features/board/intentCanvasParser.ts";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "evals/voice-intent/deterministic-positives.v1.json",
);

main().catch((error) => {
  console.error(
    `Grammar evaluation could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const fixturePath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_FIXTURE);
  const corpus = JSON.parse(await readFile(fixturePath, "utf8"));
  if (corpus?.schemaVersion !== "1.0" || !Array.isArray(corpus.cases)) {
    throw new Error(`${fixturePath} is not a deterministic-positives corpus (schema 1.0)`);
  }

  const failures = [];
  for (const testCase of corpus.cases) {
    const text = testCase.scoped
      ? normalizeScopedVoiceUtterance(testCase.text)
      : testCase.text;
    // externally_activated both accepts bare commands and strips a leading
    // wake phrase, so one policy covers typed, gated, and wake-prefixed cases.
    const result = parseIntentCanvasCommand(text, {
      activationPolicy: "externally_activated",
    });
    const problems = checkExpectations(result, testCase.expected);
    if (problems.length > 0) {
      failures.push({ id: testCase.id, text: testCase.text, problems });
    }
  }

  const passed = corpus.cases.length - failures.length;
  console.log(
    `Airboard grammar evaluation: ${passed}/${corpus.cases.length} positive cases parse as expected`,
  );
  if (Array.isArray(corpus.knownGaps) && corpus.knownGaps.length > 0) {
    console.log(`(${corpus.knownGaps.length} known grammar gaps documented in the fixture)`);
  }
  for (const failure of failures) {
    console.log(`  FAIL ${failure.id}: “${failure.text}”`);
    for (const problem of failure.problems) {
      console.log(`     - ${problem}`);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function checkExpectations(result, expected) {
  if (result.status !== "parsed") {
    return [
      `expected ${expected.kind}, but the parser ${result.status}: ${result.issue?.code ?? ""}`,
    ];
  }
  const command = result.command;
  const problems = [];
  if (command.kind !== expected.kind) {
    problems.push(`kind: expected ${expected.kind}, received ${command.kind}`);
    return problems;
  }
  if (expected.nodeType !== undefined && command.nodeType !== expected.nodeType) {
    problems.push(`nodeType: expected ${expected.nodeType}, received ${command.nodeType}`);
  }
  if (expected.count !== undefined && command.count !== expected.count) {
    problems.push(`count: expected ${expected.count}, received ${command.count}`);
  }
  if (expected.label !== undefined && command.label !== expected.label) {
    problems.push(`label: expected ${JSON.stringify(expected.label)}, received ${JSON.stringify(command.label)}`);
  }
  if (expected.direction !== undefined && command.direction !== expected.direction) {
    problems.push(`direction: expected ${expected.direction}, received ${command.direction}`);
  }
  if (
    expected.placementDirection !== undefined &&
    command.placement?.direction !== expected.placementDirection
  ) {
    problems.push(
      `placement: expected ${expected.placementDirection}, received ${command.placement?.direction}`,
    );
  }
  if (expected.fromKind !== undefined && command.from?.kind !== expected.fromKind) {
    problems.push(`from: expected ${expected.fromKind}, received ${command.from?.kind}`);
  }
  if (expected.toKind !== undefined && command.to?.kind !== expected.toKind) {
    problems.push(`to: expected ${expected.toKind}, received ${command.to?.kind}`);
  }
  if (expected.connectorLabel !== undefined && command.label !== expected.connectorLabel) {
    problems.push(
      `connector label: expected ${JSON.stringify(expected.connectorLabel)}, received ${JSON.stringify(command.label)}`,
    );
  }
  return problems;
}
