import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  createInitialBoardState,
} from "../dist/index.js";

let eventCounter = 0;
const context = (createdAt = "2026-07-11T00:00:00.000Z") => ({
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt,
  eventIdFactory: () => `event-${++eventCounter}`,
});

const createNode = (state, nodeId, center, label = nodeId) =>
  applyDiagramCommand(
    state,
    {
      type: "node.create",
      nodeId,
      nodeType: "service",
      label,
      center,
      source: "voice",
    },
    context(),
  );

test("creates annotation-compatible nodes and snapped connectors through BoardEvents", () => {
  let state = createInitialBoardState("board-1");
  const first = createNode(state, "api", { x: 100, y: 100 }, "API");
  state = first.state;
  state = createNode(state, "database", { x: 400, y: 100 }, "Orders").state;

  const connected = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "api-orders",
      fromId: "api",
      toId: "database",
      label: "writes",
      source: "voice",
    },
    context(),
  );

  assert.deepEqual(first.events.map((event) => event.type), [
    "stroke.started",
    "stroke.committed",
  ]);
  assert.equal(first.state.strokes.api.status, "committed");
  assert.equal(first.state.strokes.api.annotation.type, "flow_node");
  assert.equal(first.state.strokes.api.annotation.source, "voice");
  assert.deepEqual(first.state.strokes.api.annotation.bounds, {
    x: 20,
    y: 60,
    width: 160,
    height: 80,
  });

  const connector = connected.state.strokes["api-orders"];
  assert.equal(connector.annotation.type, "connector");
  assert.equal(connector.annotation.snappedStartStrokeId, "api");
  assert.equal(connector.annotation.snappedEndStrokeId, "database");
  assert.deepEqual(connector.annotation.start, { x: 180, y: 100 });
  assert.deepEqual(connector.annotation.end, { x: 320, y: 100 });
  assert.equal(connector.points.length, 2);
});

test("creates semantic circles as true ellipse annotations", () => {
  const result = applyDiagramCommand(
    createInitialBoardState("board-1"),
    {
      type: "node.create",
      nodeId: "circle",
      nodeType: "circle",
      label: "Circle",
      center: { x: 240, y: 180 },
      source: "voice",
    },
    context(),
  );

  assert.equal(result.state.strokes.circle.annotation.type, "ellipse");
  assert.equal(result.state.strokes.circle.annotation.nodeType, "circle");
  assert.deepEqual(result.state.strokes.circle.annotation.bounds, {
    x: 180,
    y: 120,
    width: 120,
    height: 120,
  });
});

test("moving a node keeps attached connectors bound and compensating events undo both", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "one", { x: 100, y: 100 }).state;
  state = createNode(state, "two", { x: 400, y: 100 }).state;
  state = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "edge",
      fromId: "one",
      toId: "two",
    },
    context(),
  ).state;
  const beforeNode = structuredClone(state.strokes.one.annotation);
  const beforeConnector = structuredClone(state.strokes.edge.annotation);

  const moved = applyDiagramCommand(
    state,
    {
      type: "objects.move",
      objectIds: ["one"],
      delta: { x: 60, y: 40 },
    },
    context("2026-07-11T00:00:01.000Z"),
  );

  assert.equal(moved.state.strokes.one.annotation.bounds.x, 80);
  assert.equal(moved.state.strokes.one.annotation.bounds.y, 100);
  assert.notDeepEqual(moved.state.strokes.edge.annotation.start, beforeConnector.start);
  assert.equal(moved.state.strokes.edge.annotation.snappedStartStrokeId, "one");
  assert.ok(moved.events.some((event) => event.type === "stroke.annotation_updated"));

  const undone = applyDiagramUndo(
    moved.state,
    moved,
    context("2026-07-11T00:00:02.000Z"),
  );
  assert.deepEqual(undone.state.strokes.one.annotation, beforeNode);
  assert.deepEqual(undone.state.strokes.edge.annotation, beforeConnector);
  assert.ok(undone.events.every((event) => event.createdAt === "2026-07-11T00:00:02.000Z"));
});

test("objects.move skips missing selection ids instead of aborting the whole move", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "one", { x: 100, y: 100 }).state;
  const before = structuredClone(state.strokes.one.annotation.bounds);

  const moved = applyDiagramCommand(
    state,
    {
      type: "objects.move",
      objectIds: ["one", "ghost-that-was-deleted"],
      delta: { x: 30, y: 20 },
    },
    context("2026-07-11T00:00:01.000Z"),
  );

  assert.equal(moved.state.strokes.one.annotation.bounds.x, before.x + 30);
  assert.equal(moved.state.strokes.one.annotation.bounds.y, before.y + 20);
});

test("rename, resize, and cascade delete remain undoable with existing event types", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "source", { x: 100, y: 100 }, "Old").state;
  state = createNode(state, "target", { x: 400, y: 100 }).state;
  state = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "source-target",
      fromId: "source",
      toId: "target",
    },
    context(),
  ).state;

  state = applyDiagramCommand(
    state,
    { type: "object.rename", objectId: "source", label: "Payments" },
    context(),
  ).state;
  state = applyDiagramCommand(
    state,
    {
      type: "object.resize",
      objectId: "source",
      bounds: { x: 10, y: 20, width: 220, height: 110 },
    },
    context(),
  ).state;
  assert.equal(state.strokes.source.annotation.label, "Payments");
  assert.deepEqual(state.strokes.source.annotation.bounds, {
    x: 10,
    y: 20,
    width: 220,
    height: 110,
  });
  assert.equal(state.strokes.source.points.length, 5);

  const deleted = applyDiagramCommand(
    state,
    { type: "objects.delete", objectIds: ["source"] },
    context(),
  );
  assert.equal(deleted.state.strokes.source.status, "deleted");
  assert.equal(deleted.state.strokes["source-target"].status, "deleted");
  assert.deepEqual(deleted.events.map((event) => event.type), ["stroke.deleted"]);

  const restored = applyDiagramUndo(deleted.state, deleted);
  assert.equal(restored.state.strokes.source.status, "committed");
  assert.equal(restored.state.strokes["source-target"].status, "committed");
});

test("groups stay renderer-compatible and duplicate with remapped memberships", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "a", { x: 100, y: 100 }).state;
  state = createNode(state, "b", { x: 340, y: 100 }).state;

  const grouped = applyDiagramCommand(
    state,
    {
      type: "objects.group",
      groupId: "backend",
      objectIds: ["a", "b"],
      label: "Backend",
      padding: 20,
    },
    context(),
  );
  state = grouped.state;
  assert.equal(state.strokes.backend.annotation.type, "rectangle");
  assert.deepEqual(state.strokes.backend.annotation.groupMemberStrokeIds, ["a", "b"]);
  assert.equal(state.strokes.a.annotation.groupId, "backend");
  assert.equal(state.strokes.b.annotation.groupId, "backend");

  const deletedGroup = applyDiagramCommand(
    state,
    { type: "objects.delete", objectIds: ["backend"] },
    context(),
  );
  assert.equal(deletedGroup.state.strokes.backend.status, "deleted");
  assert.equal(deletedGroup.state.strokes.a.annotation.groupId, undefined);
  assert.equal(deletedGroup.state.strokes.b.annotation.groupId, undefined);
  const restoredGroup = applyDiagramUndo(deletedGroup.state, deletedGroup);
  assert.equal(restoredGroup.state.strokes.backend.status, "committed");
  assert.equal(restoredGroup.state.strokes.a.annotation.groupId, "backend");

  const duplicated = applyDiagramCommand(
    state,
    {
      type: "objects.duplicate",
      objectIds: ["backend"],
      offset: { x: 500, y: 0 },
      idMap: {
        backend: "backend-copy",
        a: "a-copy",
        b: "b-copy",
      },
    },
    context(),
  );
  assert.deepEqual(
    duplicated.state.strokes["backend-copy"].annotation.groupMemberStrokeIds,
    ["a-copy", "b-copy"],
  );
  assert.equal(duplicated.state.strokes["a-copy"].annotation.groupId, "backend-copy");
  assert.equal(
    duplicated.state.strokes["a-copy"].annotation.bounds.x,
    state.strokes.a.annotation.bounds.x + 500,
  );
});

test("align and layout produce deterministic constraint-based geometry", () => {
  let state = createInitialBoardState("board-1");
  for (const [id, bounds] of [
    ["a", { x: 50, y: 80, width: 100, height: 60 }],
    ["b", { x: 280, y: 180, width: 100, height: 60 }],
    ["c", { x: 520, y: 300, width: 100, height: 60 }],
  ]) {
    state = applyDiagramCommand(
      state,
      { type: "node.create", nodeId: id, nodeType: "process", bounds },
      context(),
    ).state;
  }

  state = applyDiagramCommand(
    state,
    { type: "objects.align", objectIds: ["a", "b", "c"], alignment: "top" },
    context(),
  ).state;
  assert.deepEqual(
    ["a", "b", "c"].map((id) => state.strokes[id].annotation.bounds.y),
    [80, 80, 80],
  );

  state = applyDiagramCommand(
    state,
    {
      type: "objects.layout",
      objectIds: ["c", "a", "b"],
      direction: "horizontal",
      gap: 20,
      origin: { x: 10, y: 25 },
    },
    context(),
  ).state;
  assert.deepEqual(
    ["a", "b", "c"].map((id) => state.strokes[id].annotation.bounds.x),
    [10, 130, 250],
  );
  assert.deepEqual(
    ["a", "b", "c"].map((id) => state.strokes[id].annotation.bounds.y),
    [25, 25, 25],
  );
});

test("object.restyle updates colors with a compensating undo", () => {
  const context = { boardSessionId: "b", actorParticipantId: "p", userId: "u" };
  const created = applyDiagramCommand(
    createInitialBoardState("b"),
    {
      type: "node.create",
      nodeId: "n1",
      nodeType: "service",
      label: "API",
      center: { x: 200, y: 200 },
      source: "voice",
    },
    context,
  );
  const restyled = applyDiagramCommand(
    created.state,
    { type: "object.restyle", objectId: "n1", fillColor: "#fee2e2", strokeColor: "#b91c1c" },
    context,
  );
  const annotation = restyled.state.strokes.n1.annotation;
  assert.equal(annotation.fillColor, "#fee2e2");
  assert.equal(annotation.strokeColor, "#b91c1c");

  const undone = applyDiagramUndo(restyled.state, { undoEvents: restyled.undoEvents });
  assert.equal(undone.state.strokes.n1.annotation.fillColor, created.state.strokes.n1.annotation.fillColor);
});
