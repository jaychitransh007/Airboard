import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  createInitialBoardState,
  createStroke,
  upgradeBoardStateToSceneVersion,
} from "../dist/boardReducer.js";
import {
  createBoardSceneElement,
  createDefaultTableData,
  createRichTextDocument,
} from "../dist/sceneElements.js";

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

test("initial state is scene v2 and committed legacy strokes are adapted", () => {
  const stroke = createStroke({
    id: "legacy-node",
    boardId: "board-1",
    userId: "user-1",
    point: { x: 10, y: 20, t: 1 },
    createdAt: "2026-07-09T00:00:00.000Z",
    annotation: {
      type: "flow_node",
      source: "voice",
      nodeType: "decision",
      label: "Approve?",
      bounds: { x: 10, y: 20, width: 180, height: 100 },
    },
  });
  let state = createInitialBoardState("board-1");
  assert.equal(state.sceneVersion, 2);
  assert.deepEqual(state.elements, {});
  state = applyBoardEvent(state, { ...envelope(), type: "stroke.started", stroke });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:01.000Z"),
    type: "stroke.committed",
    strokeId: stroke.id,
  });
  assert.equal(state.strokes[stroke.id].status, "committed", "legacy storage is preserved");
  assert.equal(state.elements[stroke.id].kind, "shape");
  assert.equal(state.elements[stroke.id].shapeKind, "diamond");
  assert.equal(state.elements[stroke.id].legacyStrokeId, stroke.id);
});

test("element patches merge unrelated concurrent fields instead of replacing the element", () => {
  const shape = createBoardSceneElement({
    id: "shape-1",
    boardId: "board-1",
    kind: "shape",
    shapeKind: "star",
  });
  let state = applyBoardEvent(createInitialBoardState("board-1"), {
    ...envelope(),
    type: "element.created",
    element: shape,
  });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:01.000Z"),
    type: "element.patched",
    elementId: shape.id,
    baseRevision: 1,
    patches: [{ op: "field.set", path: ["transform", "x"], value: 240 }],
  });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:02.000Z"),
    type: "element.patched",
    elementId: shape.id,
    baseRevision: 1,
    patches: [{ op: "field.set", path: ["style", "fill"], value: "#fef08a" }],
  });
  assert.equal(state.elements[shape.id].transform.x, 240);
  assert.equal(state.elements[shape.id].style.fill, "#fef08a");
  assert.equal(state.elements[shape.id].revision, 3);
});

test("table cell and structure patches are granular and enforce the 500-cell cap", () => {
  const data = createDefaultTableData("table-1", 2, 2);
  const table = createBoardSceneElement({
    id: "table-1",
    boardId: "board-1",
    kind: "table",
    ...data,
  });
  const firstCell = Object.values(table.cells)[0];
  let state = applyBoardEvent(createInitialBoardState("board-1"), {
    ...envelope(),
    type: "element.created",
    element: table,
  });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:01.000Z"),
    type: "element.patched",
    elementId: table.id,
    patches: [
      {
        op: "table.cell.patched",
        cellId: firstCell.id,
        patch: { content: createRichTextDocument("Updated") },
      },
      {
        op: "table.row.inserted",
        index: 1,
        row: { id: "new-row", height: 44 },
      },
    ],
  });
  assert.equal(state.elements[table.id].rows[1].id, "new-row");
  assert.equal(
    state.elements[table.id].cells[firstCell.id].content.blocks[0].runs[0].text,
    "Updated",
  );

  const full = createBoardSceneElement({
    id: "full",
    boardId: "board-1",
    kind: "table",
    ...createDefaultTableData("full", 20, 25),
  });
  state = applyBoardEvent(state, { ...envelope(), type: "element.created", element: full });
  state = applyBoardEvent(state, {
    ...envelope(),
    type: "element.patched",
    elementId: full.id,
    patches: [{ op: "table.row.inserted", index: 20, row: { id: "overflow", height: 44 } }],
  });
  assert.equal(state.elements.full.rows.length, 20);
});

test("element deletion/restoration is revisioned and legacy snapshots upgrade without loss", () => {
  const sticky = createBoardSceneElement({
    id: "sticky-1",
    boardId: "board-1",
    kind: "sticky",
  });
  let state = applyBoardEvent(createInitialBoardState("board-1"), {
    ...envelope(),
    type: "element.created",
    element: sticky,
  });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:01.000Z"),
    type: "element.deleted",
    elementId: sticky.id,
  });
  state = applyBoardEvent(state, {
    ...envelope("2026-07-09T00:00:02.000Z"),
    type: "element.restored",
    elementId: sticky.id,
  });
  assert.equal(state.elements[sticky.id].status, "active");
  assert.equal(state.elements[sticky.id].revision, 3);

  const legacy = structuredClone(createInitialBoardState("board-1"));
  delete legacy.sceneVersion;
  delete legacy.elements;
  const upgraded = upgradeBoardStateToSceneVersion(legacy);
  assert.equal(upgraded.sceneVersion, 2);
  assert.deepEqual(upgraded.elements, {});
  assert.deepEqual(upgraded.strokes, legacy.strokes);
});
