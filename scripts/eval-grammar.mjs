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
import {
  assertAllGrammarGapScenariosExecuted,
  compareGrammarExpectation,
  prepareGrammarEvalCorpus,
} from "./lib/grammar-eval-corpus.mjs";

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
  const prepared = prepareGrammarEvalCorpus(corpus);

  const failures = [];
  const executedGapScenarioIds = new Set();
  for (const testCase of prepared.allCases) {
    const text = testCase.scoped
      ? normalizeScopedVoiceUtterance(testCase.text)
      : testCase.text;
    // externally_activated both accepts bare commands and strips a leading
    // wake phrase, so one policy covers typed, gated, and wake-prefixed cases.
    const result = parseIntentCanvasCommand(text, {
      activationPolicy: "externally_activated",
    });
    const problems = compareGrammarExpectation(result, testCase.expected, {
      effectiveText: text,
    });
    if (problems.length > 0) {
      failures.push({ id: testCase.id, text: testCase.text, problems });
    }
    if (testCase.knownGapId) {
      executedGapScenarioIds.add(testCase.id);
    }
  }
  assertAllGrammarGapScenariosExecuted(
    prepared.knownGaps,
    executedGapScenarioIds,
  );

  const passed = prepared.allCases.length - failures.length;
  console.log(
    `Airboard grammar evaluation: ${passed}/${prepared.allCases.length} contract cases behave as expected`,
  );
  console.log(
    `Executable grammar gaps: ${prepared.knownGaps.length}/${corpus.knownGapCount} gaps, ${executedGapScenarioIds.size}/${prepared.gapCases.length} scenarios`,
  );
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
