import assert from "node:assert/strict";
import test from "node:test";

import {
  validateBoardTitle,
} from "../src/features/board/boardLifecycle.ts";

test("canvas title validation trims, bounds, and rejects control characters", () => {
  assert.deepEqual(validateBoardTitle("  System Design  "), {
    valid: true,
    title: "System Design",
  });
  assert.equal(validateBoardTitle("   ").valid, false);
  assert.equal(validateBoardTitle("x".repeat(241)).valid, false);
  assert.equal(validateBoardTitle("bad\nname").valid, false);
  assert.equal(validateBoardTitle("x".repeat(240)).valid, true);
});
