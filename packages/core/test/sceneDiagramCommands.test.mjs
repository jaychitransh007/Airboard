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
} from "../dist/index.js";

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
