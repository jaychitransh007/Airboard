import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  createInitialBoardState,
  createStroke,
} from "../dist/boardReducer.js";

const envelope = (createdAt = "2026-07-09T00:00:00.000Z") => ({
  id: crypto.randomUUID(),
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  createdAt,
});

test("stroke.annotation_updated replaces annotation geometry and points", () => {
  const startedAt = "2026-07-09T00:00:00.000Z";
  const stroke = createStroke({
    id: "stroke-1",
    boardId: "board-1",
    userId: "user-1",
    point: { x: 10, y: 10, t: 1 },
    createdAt: startedAt,
    annotation: {
      type: "rectangle",
      source: "gesture",
      bounds: { x: 10, y: 10, width: 100, height: 60 },
    },
  });

  let state = createInitialBoardState("board-1");
  state = applyBoardEvent(state, {
    ...envelope(startedAt),
    type: "stroke.started",
    stroke,
  });
  state = applyBoardEvent(state, {
    ...envelope(startedAt),
    type: "stroke.committed",
    strokeId: stroke.id,
  });

  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:01.000Z"),
    type: "stroke.annotation_updated",
    strokeId: stroke.id,
    annotation: {
      type: "rectangle",
      source: "gesture",
      bounds: { x: 40, y: 35, width: 140, height: 80 },
    },
    points: [
      { x: 40, y: 35, t: 2 },
      { x: 180, y: 35, t: 3 },
    ],
  });

  assert.equal(state.strokes["stroke-1"].annotation.bounds.x, 40);
  assert.equal(state.strokes["stroke-1"].annotation.bounds.width, 140);
  assert.equal(state.strokes["stroke-1"].points.length, 2);
  assert.equal(state.strokes["stroke-1"].updatedAt, "2026-07-09T00:00:01.000Z");
});

test("an unknown event type is ignored (state preserved, sequence advanced) not corrupted", () => {
  const state = createInitialBoardState("board-1");
  const next = applyBoardEvent(state, {
    ...envelope(),
    sequence: 5,
    type: "some.future.event",
    payload: { anything: true },
  });
  assert.ok(next, "reducer must not return undefined for an unknown type");
  assert.equal(next.lastSequence, 5);
  assert.deepEqual(next.strokes, state.strokes);
  // A subsequent real event still applies on top (no corruption).
  const stroke = createStroke({
    id: "s1",
    boardId: "board-1",
    userId: "user-1",
    point: { x: 0, y: 0, t: 1 },
    createdAt: "2026-07-09T00:00:00.000Z",
  });
  const after = applyBoardEvent(next, { ...envelope(), type: "stroke.started", stroke });
  assert.ok(after.activeStrokes["s1"]);
});

test("a non-finite point timestamp does not crash the reducer", () => {
  let state = createInitialBoardState("board-1");
  const stroke = createStroke({
    id: "s1",
    boardId: "board-1",
    userId: "user-1",
    point: { x: 0, y: 0, t: 1 },
    createdAt: "2026-07-09T00:00:00.000Z",
  });
  state = applyBoardEvent(state, { ...envelope(), type: "stroke.started", stroke });
  const before = state.activeStrokes["s1"].updatedAt;
  // NaN timestamp must not throw RangeError; updatedAt falls back to prior value.
  const next = applyBoardEvent(state, {
    ...envelope(),
    type: "stroke.point_added",
    strokeId: "s1",
    point: { x: 5, y: 5, t: Number.NaN },
  });
  assert.equal(next.activeStrokes["s1"].points.length, 2);
  assert.equal(next.activeStrokes["s1"].updatedAt, before);
});
