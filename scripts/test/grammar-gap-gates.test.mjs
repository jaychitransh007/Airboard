import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertAllGrammarGapScenariosExecuted,
  prepareGrammarEvalCorpus,
} from "../lib/grammar-eval-corpus.mjs";

const fixtureUrl = new URL(
  "../../evals/voice-intent/deterministic-positives.v1.json",
  import.meta.url,
);

async function loadCorpus() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

test("all 28 known grammar gaps own explicit executable behavior", async () => {
  const corpus = await loadCorpus();
  const prepared = prepareGrammarEvalCorpus(corpus);

  assert.equal(prepared.knownGaps.length, 28);
  assert.equal(corpus.knownGapCount, 28);
  assert.ok(prepared.gapCases.length >= 28);
  assert.ok(
    prepared.gapCases.every(
      (scenario) =>
        scenario.knownGapId &&
        ["parsed", "semantic_fallback"].includes(scenario.expected.outcome),
    ),
  );
});

test("metadata-only grammar gaps are rejected", async () => {
  const corpus = await loadCorpus();
  corpus.knownGaps[0].scenarios = [];

  assert.throws(
    () => prepareGrammarEvalCorpus(corpus),
    /metadata-only grammar gaps are forbidden/,
  );
});

test("removing a known gap cannot pass even if its declared count is lowered", async () => {
  const corpus = await loadCorpus();
  corpus.knownGaps.pop();
  corpus.knownGapCount = 27;

  assert.throws(
    () => prepareGrammarEvalCorpus(corpus),
    /contract 1\.0 requires knownGapCount 28; received 27/,
  );
});

test("skipping any declared gap scenario is a blocking failure", async () => {
  const corpus = await loadCorpus();
  const prepared = prepareGrammarEvalCorpus(corpus);
  const executed = prepared.gapCases.map(({ id }) => id);
  const skipped = executed.at(-1);

  assert.doesNotThrow(() =>
    assertAllGrammarGapScenariosExecuted(prepared.knownGaps, executed),
  );
  assert.throws(
    () =>
      assertAllGrammarGapScenariosExecuted(
        prepared.knownGaps,
        executed.filter((id) => id !== skipped),
      ),
    new RegExp(`skipped 1 executable known-gap scenario.*${skipped}`),
  );
});
