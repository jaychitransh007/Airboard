import assert from "node:assert/strict";
import test from "node:test";

import { buildConfusionMatrix } from "../lib/confusion-matrix.mjs";

test("builds a deterministic categorical confusion matrix", () => {
  const matrix = buildConfusionMatrix([
    { expected: "resolved", actual: "resolved" },
    { expected: "clarification", actual: "unsupported" },
    { expected: "resolved", actual: "resolved" },
  ]);

  assert.deepEqual(matrix.labels, [
    "clarification",
    "resolved",
    "unsupported",
  ]);
  assert.equal(matrix.total, 3);
  assert.equal(matrix.matrix.resolved.resolved, 2);
  assert.equal(matrix.matrix.clarification.unsupported, 1);
  assert.deepEqual(matrix.cells, [
    {
      expected: "clarification",
      actual: "unsupported",
      count: 1,
    },
    { expected: "resolved", actual: "resolved", count: 2 },
  ]);
});

test("normalizes missing labels without exposing input content", () => {
  const matrix = buildConfusionMatrix([
    { expected: null, actual: undefined },
  ]);
  assert.deepEqual(matrix.labels, ["unknown"]);
  assert.equal(matrix.matrix.unknown.unknown, 1);
});
