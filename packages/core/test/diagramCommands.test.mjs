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
    x: 24,
    y: 60,
    width: 152,
    height: 80,
  });

  const connector = connected.state.strokes["api-orders"];
  assert.equal(connector.annotation.type, "connector");
  assert.equal(connector.annotation.snappedStartStrokeId, "api");
  assert.equal(connector.annotation.snappedEndStrokeId, "database");
  assert.deepEqual(connector.annotation.start, { x: 176, y: 100 });
  assert.deepEqual(connector.annotation.end, { x: 324, y: 100 });
  assert.equal(connector.points.length, 2);
});

test("reverses a connector in place as one undoable annotation update", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "user-one", { x: 100, y: 100 }, "User One").state;
  state = createNode(state, "user-two", { x: 400, y: 100 }, "User Two").state;
  state = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "calls",
      fromId: "user-one",
      toId: "user-two",
      label: "calls",
    },
    context(),
  ).state;
  const before = structuredClone(state.strokes.calls.annotation);

  const reversed = applyDiagramCommand(
    state,
    {
      type: "connection.reverse",
      connectorId: "calls",
      label: "calls",
    },
    context("2026-07-11T00:00:01.000Z"),
  );

  assert.deepEqual(reversed.events.map((event) => event.type), [
    "stroke.annotation_updated",
  ]);
  assert.equal(reversed.state.strokes.calls.id, "calls", "connector identity is preserved");
  assert.equal(
    reversed.state.strokes.calls.annotation.snappedStartStrokeId,
    "user-two",
  );
  assert.equal(
    reversed.state.strokes.calls.annotation.snappedEndStrokeId,
    "user-one",
  );

  const undone = applyDiagramUndo(
    reversed.state,
    reversed,
    context("2026-07-11T00:00:02.000Z"),
  );
  assert.deepEqual(undone.state.strokes.calls.annotation, before);
});

test("attaches stale connector geometry atomically while preserving identity and style", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "client", { x: 100, y: 100 }, "Client").state;
  state = createNode(state, "planner", { x: 400, y: 100 }, "Planner").state;
  state = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "request", fromId: "client", toId: "planner",
    label: "request goes to", style: { strokeColor: "#22d3ee", thickness: 5, opacity: 0.7 },
  }, context()).state;
  const original = structuredClone(state.strokes.request);
  state = {
    ...state,
    strokes: {
      ...state.strokes,
      request: {
        ...state.strokes.request,
        points: [{ x: 250, y: 240, t: 1 }, { x: 324, y: 100, t: 2 }],
        annotation: {
          ...state.strokes.request.annotation,
          start: { x: 250, y: 240 },
          end: { x: 324, y: 100 },
        },
      },
    },
  };
  const before = structuredClone(state.strokes.request);
  const attached = applyDiagramCommand(state, {
    type: "connection.attach", connectorId: "request", fromId: "client", toId: "planner",
  }, context("2026-08-01T00:00:01.000Z"));
  assert.deepEqual(attached.events.map((event) => event.type), ["stroke.annotation_updated"]);
  assert.equal(attached.state.strokes.request.id, "request");
  assert.equal(attached.state.strokes.request.annotation.label, "request goes to");
  assert.equal(attached.state.strokes.request.color, original.color);
  assert.equal(attached.state.strokes.request.thickness, 5);
  assert.equal(attached.state.strokes.request.annotation.opacity, 0.7);
  assert.deepEqual(attached.state.strokes.request.annotation.start, { x: 176, y: 100 });
  assert.deepEqual(attached.state.strokes.request.annotation.end, { x: 324, y: 100 });
  const undone = applyDiagramUndo(attached.state, attached);
  assert.deepEqual(undone.state.strokes.request.annotation, before.annotation);
  assert.deepEqual(undone.state.strokes.request.points, before.points);
});

test("reciprocal connectors receive distinct deterministic route lanes", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "user", { x: 100, y: 100 }, "User").state;
  state = createNode(state, "auth", { x: 400, y: 100 }, "Authentication").state;
  state = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "request",
      fromId: "user",
      toId: "auth",
      label: "requests",
    },
    context(),
  ).state;
  state = applyDiagramCommand(
    state,
    {
      type: "nodes.connect",
      connectorId: "authenticates",
      fromId: "auth",
      toId: "user",
      label: "authenticates",
    },
    context(),
  ).state;

  assert.equal(state.strokes.request.annotation.routeOffset, undefined);
  assert.equal(state.strokes.authenticates.annotation.routeOffset, 72);
});

test("connectors and arrows share deterministic route lanes without overlap", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "client", { x: 100, y: 100 }, "Client").state;
  state = createNode(state, "planner", { x: 400, y: 100 }, "Planner").state;
  state = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "first", fromId: "client", toId: "planner",
  }, context()).state;
  state = {
    ...state,
    strokes: {
      ...state.strokes,
      first: {
        ...state.strokes.first,
        annotation: { ...state.strokes.first.annotation, type: "arrow" },
      },
    },
  };

  const second = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "second", fromId: "client", toId: "planner",
  }, context("2026-08-01T00:00:01.000Z"));
  assert.equal(second.state.strokes.first.annotation.routeOffset, undefined);
  assert.equal(second.state.strokes.second.annotation.routeOffset, 72);

  state = {
    ...second.state,
    strokes: {
      ...second.state.strokes,
      second: {
        ...second.state.strokes.second,
        annotation: { ...second.state.strokes.second.annotation, type: "arrow" },
      },
    },
  };
  const third = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "third", fromId: "client", toId: "planner",
  }, context("2026-08-01T00:00:02.000Z"));
  assert.equal(third.state.strokes.third.annotation.routeOffset, -72);
  assert.notEqual(
    third.state.strokes.third.annotation.routeOffset,
    third.state.strokes.second.annotation.routeOffset,
  );

  const undone = applyDiagramUndo(
    third.state,
    third,
    context("2026-08-01T00:00:03.000Z"),
  );
  assert.equal(undone.state.strokes.third.status, "deleted");
  assert.equal(undone.state.strokes.first.status, "committed");
  assert.equal(undone.state.strokes.second.status, "committed");
});

test("node deletion cascades attached arrows and Undo restores both", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "client", { x: 100, y: 100 }, "Client").state;
  state = createNode(state, "planner", { x: 400, y: 100 }, "Planner").state;
  state = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "arrow", fromId: "client", toId: "planner",
  }, context()).state;
  state = {
    ...state,
    strokes: {
      ...state.strokes,
      arrow: {
        ...state.strokes.arrow,
        annotation: { ...state.strokes.arrow.annotation, type: "arrow" },
      },
    },
  };

  const deleted = applyDiagramCommand(state, {
    type: "objects.delete", objectIds: ["client"], cascadeConnectors: true,
  }, context("2026-08-01T00:00:01.000Z"));
  assert.equal(deleted.state.strokes.client.status, "deleted");
  assert.equal(deleted.state.strokes.arrow.status, "deleted");
  assert.equal(deleted.state.strokes.planner.status, "committed");

  const undone = applyDiagramUndo(
    deleted.state,
    deleted,
    context("2026-08-01T00:00:02.000Z"),
  );
  assert.equal(undone.state.strokes.client.status, "committed");
  assert.equal(undone.state.strokes.arrow.status, "committed");
  assert.equal(undone.state.strokes.arrow.annotation.type, "arrow");
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

  assert.equal(moved.state.strokes.one.annotation.bounds.x, 84);
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

test("moving a connector alone detaches its bindings so former nodes cannot pull it back", () => {
  let state = createInitialBoardState("board-1");
  state = createNode(state, "one", { x: 100, y: 100 }).state;
  state = createNode(state, "two", { x: 400, y: 100 }).state;
  state = applyDiagramCommand(state, {
    type: "nodes.connect", connectorId: "edge", fromId: "one", toId: "two",
  }, context()).state;

  const detached = applyDiagramCommand(state, {
    type: "objects.move", objectIds: ["edge"], delta: { x: 0, y: 120 },
  }, context("2026-08-01T00:00:01.000Z"));
  assert.equal(detached.state.strokes.edge.annotation.snappedStartStrokeId, undefined);
  assert.equal(detached.state.strokes.edge.annotation.snappedEndStrokeId, undefined);
  const detachedAnnotation = structuredClone(detached.state.strokes.edge.annotation);
  const detachedPoints = structuredClone(detached.state.strokes.edge.points);

  const movedFormerNode = applyDiagramCommand(detached.state, {
    type: "objects.move", objectIds: ["one"], delta: { x: 80, y: 0 },
  }, context("2026-08-01T00:00:02.000Z"));
  assert.deepEqual(movedFormerNode.state.strokes.edge.annotation, detachedAnnotation);
  assert.deepEqual(movedFormerNode.state.strokes.edge.points, detachedPoints);

  const undoneNode = applyDiagramUndo(
    movedFormerNode.state,
    movedFormerNode,
    context("2026-08-01T00:00:03.000Z"),
  );
  const undoneLine = applyDiagramUndo(
    undoneNode.state,
    detached,
    context("2026-08-01T00:00:04.000Z"),
  );
  assert.deepEqual(undoneLine.state.strokes.edge.annotation, state.strokes.edge.annotation);
  assert.deepEqual(undoneLine.state.strokes.edge.points, state.strokes.edge.points);
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
