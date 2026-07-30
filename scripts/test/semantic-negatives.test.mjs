import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticNegativeCorpus,
  main,
} from "../eval-semantic-negatives.mjs";

test("all meeting negatives enter production semantic fallback with tempting grounding", async () => {
  const corpus = await buildSemanticNegativeCorpus();
  assert.equal(corpus.cases.length, 60);
  for (const scenario of corpus.cases) {
    assert.equal(scenario.expected.status, "unsupported");
    assert.equal(scenario.expected.issueCode, "not_board_command");
    assert.deepEqual(scenario.expected.actionTypeCounts, {});
    assert.equal(scenario.context.objects.length, 12);
    assert.equal(scenario.context.edges.length, 3);
  }
});

test("semantic ambient-negative CLI remains offline by default", async () => {
  assert.equal(await main(["--validate-only"]), 0);
  await assert.rejects(
    () => main(["--attempts", "2"]),
    /require --live/u,
  );
});
