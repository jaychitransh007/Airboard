import assert from "node:assert/strict";
import test from "node:test";

import {
  boardDeletionSnapshot,
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

test("delete flushes content without ephemeral participants, cursors, or active strokes", () => {
  const state = {
    boardId: "live-session",
    strokes: { committed: { id: "committed" } },
    activeStrokes: { active: { id: "active" } },
    eraseActions: {},
    participants: { user: { id: "user" } },
    cursors: { user: { x: 1, y: 2 } },
    lastSequence: 4,
  };
  const snapshot = boardDeletionSnapshot(state, "durable-board");
  assert.equal(snapshot.boardId, "durable-board");
  assert.deepEqual(snapshot.strokes, state.strokes);
  assert.deepEqual(snapshot.activeStrokes, {});
  assert.deepEqual(snapshot.participants, {});
  assert.deepEqual(snapshot.cursors, {});
});
