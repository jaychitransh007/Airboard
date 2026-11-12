import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  createInitialBoardState,
  createStroke,
} from "../src/boardReducer.ts";
import {
  createBoardSceneElement,
  createDefaultTableData,
  createRichTextDocument,
} from "../src/sceneElements.ts";

const envelope = (createdAt = "2026-07-09T00:00:00.000Z") => ({
  id: crypto.randomUUID(),
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  createdAt,
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
  assert.deepEqual(next.elements, state.elements);
  // A subsequent real event still applies on top (no corruption).
  const sticky = createBoardSceneElement({ id: "sticky-1", boardId: "board-1", kind: "sticky" });
  const after = applyBoardEvent(next, { ...envelope(), type: "element.created", element: sticky });
  assert.equal(after.elements["sticky-1"].kind, "sticky");
});

test("a retired stroke.* or erase.committed event is ignored and only advances lastSequence", () => {
  const state = createInitialBoardState("board-1");
  const stroke = createStroke({
    id: "s1",
    boardId: "board-1",
    userId: "user-1",
    point: { x: 0, y: 0, t: 1 },
    createdAt: "2026-07-09T00:00:00.000Z",
  });
  let next = applyBoardEvent(state, { ...envelope(), sequence: 3, type: "stroke.started", stroke });
  next = applyBoardEvent(next, { ...envelope(), sequence: 4, type: "stroke.committed", strokeId: "s1" });
  next = applyBoardEvent(next, { ...envelope(), sequence: 5, type: "erase.committed", eraseAction: {
    id: "erase-1", boardId: "board-1", userId: "user-1", eraserPath: [], radius: 10, affectedStrokeIds: ["s1"], createdAt: "2026-07-09T00:00:00.000Z",
  } });
  assert.deepEqual(next, { ...state, lastSequence: 5 });
  assert.equal("strokes" in next, false);
});

test("a non-finite point timestamp in a drawing does not crash the reducer", () => {
  const drawing = createBoardSceneElement({
    id: "ink-1",
    boardId: "board-1",
    kind: "drawing",
    points: [{ x: 0, y: 0, t: 1 }, { x: 5, y: 5, t: Number.NaN }],
  });
  const next = applyBoardEvent(createInitialBoardState("board-1"), {
    ...envelope(),
    sequence: 2,
    type: "element.created",
    element: drawing,
  });
  assert.equal(next.lastSequence, 2);
  assert.ok(next.elements, "the state is intact");
});

test("initial state is scene v3 with no legacy strokes", () => {
  const state = createInitialBoardState("board-1");
  assert.equal(state.sceneVersion, 3);
  assert.deepEqual(state.elements, {});
  assert.equal("strokes" in state, false);
  // A snapshot without elements (very old) is read as an empty scene.
  const { elements: _elements, ...old } = state;
  const next = applyBoardEvent(old, {
    ...envelope(),
    type: "element.created",
    element: createBoardSceneElement({ id: "sticky-1", boardId: "board-1", kind: "sticky" }),
  });
  assert.equal(next.elements["sticky-1"].kind, "sticky");
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

test("element deletion/restoration is revisioned", () => {
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
});
