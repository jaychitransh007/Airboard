import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  applyDiagramUndo,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  richTextToPlainText,
} from "../src/index.ts";

let eventCounter = 0;
const context = {
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt: "2026-11-07T00:00:00.000Z",
  eventIdFactory: () => `event-${++eventCounter}`,
};

/** A v2 shape, as typed commands and the toolbar make them. */
function withSceneShape(state, id, label, x) {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
    type: "element.created",
    element: createBoardSceneElement({
      id,
      boardId: "board-1",
      kind: "shape",
      shapeKind: "api",
      transform: { x, y: 100, width: 120, height: 80, rotation: 0 },
      content: createRichTextDocument(label, `${id}:content`),
    }),
  });
}

/** A legacy node, as Airo makes them; mirrored into an element of the same id. */
function withLegacyNode(state, id, x) {
  return applyDiagramCommand(state, {
    type: "node.create",
    nodeId: id,
    nodeType: "database",
    label: "Database",
    center: { x, y: 140 },
    source: "voice",
  }, context).state;
}

function board() {
  let state = createInitialBoardState("board-1");
  state = withSceneShape(state, "api", "API", 100);
  state = withLegacyNode(state, "db", 500);
  return state;
}

test("a connector joins a v2 shape and a legacy node, and undo removes it", () => {
  const state = board();
  assert.equal(state.elements.db?.legacyStrokeId, "db", "the legacy node is mirrored under its own id");
  const result = applyDiagramCommand(state, { type: "scene.connect", connectorId: "c1", fromId: "api", toId: "db", label: "reads" }, context);
  const connector = result.state.elements.c1;
  assert.equal(connector.kind, "connector");
  assert.equal(connector.start.binding.elementId, "api");
  assert.equal(connector.end.binding.elementId, "db");
  assert.equal(richTextToPlainText(connector.label), "reads");
  assert.ok(connector.start.point.x >= 220 - 0.5, "starts on the API's right edge");
  assert.ok(connector.end.point.x < 500, "ends on the database's left edge");
  assert.equal(applyDiagramUndo(result.state, result).state.elements.c1.status, "deleted");
});

test("renaming, moving and deleting a v2 shape undo cleanly, and its connectors follow", () => {
  const connected = applyDiagramCommand(board(), { type: "scene.connect", connectorId: "c1", fromId: "api", toId: "db" }, context).state;

  const renamed = applyDiagramCommand(connected, { type: "scene.rename", elementId: "api", label: "Gateway" }, context);
  assert.equal(richTextToPlainText(renamed.state.elements.api.content), "Gateway");
  assert.equal(richTextToPlainText(applyDiagramUndo(renamed.state, renamed).state.elements.api.content), "API");

  const before = connected.elements.c1.start.point;
  const moved = applyDiagramCommand(connected, { type: "scene.move", elementIds: ["api"], delta: { x: 0, y: 200 } }, context);
  assert.equal(moved.state.elements.api.transform.y, 300);
  assert.notDeepEqual(moved.state.elements.c1.start.point, before, "the attached connector follows");
  const unmoved = applyDiagramUndo(moved.state, moved).state;
  assert.equal(unmoved.elements.api.transform.y, 100);
  assert.deepEqual(unmoved.elements.c1.start.point, before);

  const deleted = applyDiagramCommand(connected, { type: "scene.delete", elementIds: ["api"] }, context);
  assert.equal(deleted.state.elements.api.status, "deleted");
  assert.equal(deleted.state.elements.c1.status, "deleted", "a connector to nothing goes too");
  const restored = applyDiagramUndo(deleted.state, deleted).state;
  assert.equal(restored.elements.api.status, "active");
  assert.equal(restored.elements.c1.status, "active");
});

test("moving or deleting a legacy node keeps v2 connectors attached to it in step", () => {
  const connected = applyDiagramCommand(board(), { type: "scene.connect", connectorId: "c1", fromId: "api", toId: "db" }, context).state;
  const before = connected.elements.c1.end.point;

  const moved = applyDiagramCommand(connected, { type: "objects.move", objectIds: ["db"], delta: { x: 0, y: 150 } }, context);
  assert.ok(moved.state.elements.c1.end.point.y > before.y, "the connector's end follows the node");
  assert.deepEqual(applyDiagramUndo(moved.state, moved).state.elements.c1.end.point, before);

  const deleted = applyDiagramCommand(connected, { type: "objects.delete", objectIds: ["db"] }, context);
  assert.equal(deleted.state.elements.c1.status, "deleted");
  assert.equal(applyDiagramUndo(deleted.state, deleted).state.elements.c1.status, "active");
});

test("a v2 connector reverses with its arrowhead staying at the end", () => {
  const connected = applyDiagramCommand(board(), { type: "scene.connect", connectorId: "c1", fromId: "api", toId: "db", label: "reads" }, context).state;
  const reversed = applyDiagramCommand(connected, { type: "scene.connector.reverse", connectorId: "c1", label: "writes" }, context);
  const connector = reversed.state.elements.c1;
  assert.equal(connector.start.binding.elementId, "db");
  assert.equal(connector.end.binding.elementId, "api");
  assert.equal(connector.end.decoration, "solid_arrow");
  assert.equal(richTextToPlainText(connector.label), "writes");
  const back = applyDiagramUndo(reversed.state, reversed).state.elements.c1;
  assert.equal(back.start.binding.elementId, "api");
  assert.equal(richTextToPlainText(back.label), "reads");
});

test("scene commands refuse objects that aren't there", () => {
  assert.throws(() => applyDiagramCommand(board(), { type: "scene.connect", fromId: "api", toId: "missing" }, context));
  assert.throws(() => applyDiagramCommand(board(), { type: "scene.connect", fromId: "api", toId: "api" }, context));
  assert.throws(() => applyDiagramCommand(board(), { type: "scene.rename", elementId: "missing", label: "x" }, context));
});

test("align, distribute and layout arrange v2 shapes and legacy nodes together, and undo cleanly", () => {
  let state = board();
  state = withSceneShape(state, "web", "Web", 300);
  state = applyDiagramCommand(state, { type: "scene.move", elementIds: ["web"], delta: { x: 0, y: 90 } }, context).state;
  state = applyDiagramCommand(state, { type: "scene.connect", connectorId: "c1", fromId: "web", toId: "db" }, context).state;

  // The first object is the anchor; the others line up with its top.
  const aligned = applyDiagramCommand(state, { type: "objects.align", objectIds: ["api", "web", "db"], alignment: "top" }, context);
  assert.equal(aligned.state.elements.web.transform.y, 100);
  assert.equal(aligned.state.strokes.db.annotation.bounds.y, 100);
  assert.notDeepEqual(aligned.state.elements.c1.start.point, state.elements.c1.start.point, "the connector follows");
  const unaligned = applyDiagramUndo(aligned.state, aligned).state;
  assert.equal(unaligned.elements.web.transform.y, 190);
  assert.deepEqual(unaligned.elements.c1.start.point, state.elements.c1.start.point);

  const spread = applyDiagramCommand(aligned.state, { type: "objects.align", objectIds: ["api", "web", "db"], alignment: "distribute-x" }, context).state;
  const lefts = ["api", "web"].map((id) => spread.elements[id].transform.x);
  const gapOne = lefts[1] - (lefts[0] + 120);
  const gapTwo = spread.strokes.db.annotation.bounds.x - (lefts[1] + 120);
  assert.ok(Math.abs(gapOne - gapTwo) < 0.001, `even gaps: ${gapOne} and ${gapTwo}`);

  const laidOut = applyDiagramCommand(state, { type: "objects.layout", objectIds: ["web", "api"], direction: "vertical", gap: 40 }, context).state;
  assert.equal(laidOut.elements.api.transform.x, laidOut.elements.web.transform.x);
  assert.equal(laidOut.elements.web.transform.y, laidOut.elements.api.transform.y + 80 + 40);
});

test("a v2 shape is copied with a new id at the offset, and undo removes the copy", () => {
  const result = applyDiagramCommand(board(), { type: "scene.duplicate", elementIds: ["api"], idMap: { api: "api-copy" }, offset: { x: 0, y: 150 } }, context);
  const copy = result.state.elements["api-copy"];
  assert.equal(copy.status, "active");
  assert.equal(copy.shapeKind, "api");
  assert.equal(richTextToPlainText(copy.content), "API");
  assert.deepEqual([copy.transform.x, copy.transform.y], [100, 250]);
  assert.ok(copy.zIndex > result.state.elements.api.zIndex);
  assert.equal(applyDiagramUndo(result.state, result).state.elements["api-copy"].status, "deleted");
  assert.throws(() => applyDiagramCommand(result.state, { type: "scene.duplicate", elementIds: ["api"], idMap: { api: "api-copy" } }, context));
});

test("grouping v2 shapes draws a section around them, as the toolbar does", () => {
  const state = withSceneShape(board(), "web", "Web", 300);
  const result = applyDiagramCommand(state, { type: "scene.group", sectionId: "s1", memberIds: ["api", "web"], label: "Edge" }, context);
  const section = result.state.elements.s1;
  assert.equal(section.kind, "section");
  assert.equal(richTextToPlainText(section.title), "Edge");
  assert.deepEqual(section.memberIds, ["api", "web"]);
  assert.deepEqual(
    [section.transform.x, section.transform.y, section.transform.width, section.transform.height],
    [100 - 48, 100 - 48, 320 + 96, 80 + 96],
  );
  assert.equal(result.state.elements.api.sectionId, "s1");
  const undone = applyDiagramUndo(result.state, result).state;
  assert.equal(undone.elements.s1.status, "deleted");
  assert.equal(undone.elements.api.sectionId, undefined);
  // A legacy node's place is set by its stroke, so a section can't own it.
  assert.throws(() => applyDiagramCommand(state, { type: "scene.group", memberIds: ["api", "db"] }, context));
});

test("v2 shapes resize and change shape, and v2 connectors change line style, all undoably", async () => {
  const core = await import("../src/index.ts");
  const board = "scene-edit";
  const ctx = { boardSessionId: board, actorParticipantId: "p", userId: "u" };
  let state = core.createInitialBoardState(board);
  for (const [id, x] of [["a", 0], ["b", 400]]) {
    state = core.applyBoardEvent(state, {
      ...core.createEventEnvelope({ boardSessionId: board, actorParticipantId: "p" }),
      type: "element.created",
      element: core.createBoardSceneElement({
        id, boardId: board, kind: "shape", shapeKind: "square",
        transform: { x, y: 0, width: 100, height: 60, rotation: 0 },
        content: core.createRichTextDocument(id, `${id}:content`),
      }),
    });
  }
  state = core.applyDiagramCommand(state, { type: "scene.connect", connectorId: "line", fromId: "a", toId: "b" }, ctx).state;

  const resized = core.applyDiagramCommand(state, { type: "scene.resize", elementId: "a", bounds: { x: -10, y: -6, width: 120, height: 72 } }, ctx);
  assert.equal(resized.state.elements.a.transform.width, 120);
  assert.notDeepEqual(resized.state.elements.line.start.point, state.elements.line.start.point, "the connector follows");
  assert.equal(core.applyDiagramUndo(resized.state, resized).state.elements.a.transform.width, 100);

  const reshaped = core.applyDiagramCommand(state, { type: "scene.retype", elementId: "a", shapeKind: "diamond" }, ctx);
  assert.equal(reshaped.state.elements.a.shapeKind, "diamond");
  assert.equal(core.applyDiagramUndo(reshaped.state, reshaped).state.elements.a.shapeKind, "square");

  const dotted = core.applyDiagramCommand(state, { type: "scene.connector.restyle", connectorId: "line", lineStyle: "dotted" }, ctx);
  assert.equal(dotted.state.elements.line.style.strokeStyle, "dotted");
  assert.equal(core.applyDiagramUndo(dotted.state, dotted).state.elements.line.style.strokeStyle, "solid");
});
