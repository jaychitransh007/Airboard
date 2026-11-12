import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  boardDiagramGraph,
  createInitialBoardState,
  isBoardSceneElement,
  nodeVisualDefaultSize,
  richTextToPlainText,
  sceneElementNodeType,
} from "../src/index.ts";

/**
 * The diagram verbs Airo's plans and the typed grammar use create and edit
 * v2 scene elements (shape-merge phases 1 and 3).
 */

let counter = 0;
const context = () => ({
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt: "2026-11-12T00:00:00.000Z",
  eventIdFactory: () => `event-${++counter}`,
});

const run = (state, command) => applyDiagramCommand(state, command, context());
const node = (state, nodeId, nodeType, center, extra = {}) =>
  run(state, { type: "node.create", nodeId, nodeType, label: nodeId, center, source: "voice", ...extra }).state;
const connect = (state, connectorId, fromId, toId, label) =>
  run(state, { type: "nodes.connect", connectorId, fromId, toId, ...(label ? { label } : {}), source: "voice" }).state;

test("node.create draws a v2 shape of the node type's catalogue shape", () => {
  const result = run(createInitialBoardState("board-1"), {
    type: "node.create",
    nodeId: "check",
    nodeType: "decision",
    label: "Paid?",
    center: { x: 300, y: 200 },
    source: "voice",
    style: { strokeColor: "#111827" },
  });
  assert.deepEqual(result.events.map((event) => event.type), ["element.created"]);
  assert.equal("strokes" in result.state, false);
  const shape = result.state.elements.check;
  assert.ok(isBoardSceneElement(shape));
  assert.equal(shape.kind, "shape");
  assert.equal(shape.shapeKind, "diamond");
  assert.equal(richTextToPlainText(shape.content), "Paid?");
  assert.equal(shape.style.fill, "#f8fafc", "a new node has the colours Airo's legacy nodes had");
  assert.equal(shape.style.stroke, "#111827");
  assert.equal(shape.style.strokeWidth, 3);
  assert.deepEqual(shape.metadata, { source: "voice", nodeType: "decision", nodeShape: "diamond" });
  assert.equal(sceneElementNodeType(shape), "decision");
  // The node type's default box around the centre, so layouts and placement are unchanged.
  const size = nodeVisualDefaultSize("decision");
  assert.deepEqual(
    { x: shape.transform.x, y: shape.transform.y, width: shape.transform.width, height: shape.transform.height },
    { x: 300 - size.width / 2, y: 200 - size.height / 2, width: size.width, height: size.height },
  );
  // Undo takes it away again.
  assert.equal(applyDiagramUndo(result.state, result).state.elements.check.status, "deleted");
});

test("node.create keeps a catalogue shape, a note's paper and explicit colours", () => {
  let state = createInitialBoardState("board-1");
  state = node(state, "cache", "database", { x: 100, y: 100 }, { shapeKind: "horizontal-cylinder" });
  state = node(state, "memo", "note", { x: 400, y: 100 });
  state = node(state, "ring", "circle", { x: 700, y: 100 }, { style: { fillColor: "#dbeafe", strokeColor: "#1d4ed8", thickness: 3 } });
  assert.equal(state.elements.cache.shapeKind, "horizontal-cylinder");
  assert.equal(sceneElementNodeType(state.elements.cache), "database");
  assert.equal(state.elements.memo.shapeKind, "rounded-rectangle");
  assert.equal(state.elements.memo.style.fill, "#fef9c3");
  assert.equal(state.elements.ring.shapeKind, "ellipse");
  assert.deepEqual(
    [state.elements.ring.style.fill, state.elements.ring.style.stroke, state.elements.ring.style.strokeWidth],
    ["#dbeafe", "#1d4ed8", 3],
  );
  assert.throws(() => node(state, "cache", "service", { x: 0, y: 0 }), /already exists/);
});

test("a v2 shape retyped by hand is named by its new shape, not its old node type", () => {
  let state = node(createInitialBoardState("board-1"), "check", "decision", { x: 300, y: 200 });
  state = run(state, { type: "scene.retype", elementId: "check", shapeKind: "cloud" }).state;
  assert.equal(sceneElementNodeType(state.elements.check), "cloud");
  state = run(state, { type: "object.retype", objectId: "check", nodeType: "queue" }).state;
  assert.equal(state.elements.check.shapeKind, "queue");
  assert.equal(boardDiagramGraph(state).nodes[0].kind, "queue");
});

test("nodes.connect draws a bound v2 connector that meets a diamond on its outline", () => {
  let state = createInitialBoardState("board-1");
  state = node(state, "api", "api", { x: 100, y: 100 });
  state = node(state, "check", "decision", { x: 400, y: 260 });
  const result = run(state, { type: "nodes.connect", connectorId: "c", fromId: "api", toId: "check", label: "checks", source: "voice" });
  assert.deepEqual(result.events.map((event) => event.type), ["element.created"]);
  const connector = result.state.elements.c;
  assert.equal(connector.kind, "connector");
  assert.equal(connector.start.binding.elementId, "api");
  assert.equal(connector.end.binding.elementId, "check");
  assert.equal(richTextToPlainText(connector.label), "checks");
  assert.equal(connector.routeOffset, undefined);
  // The end lies on the diamond's edge |dx|/(w/2) + |dy|/(h/2) = 1, not on its box.
  const { x, y, width, height } = result.state.elements.check.transform;
  const dx = Math.abs(connector.end.point.x - (x + width / 2)) / (width / 2);
  const dy = Math.abs(connector.end.point.y - (y + height / 2)) / (height / 2);
  assert.ok(Math.abs(dx + dy - 1) < 1e-9, `end ${JSON.stringify(connector.end.point)} on the diamond`);
  const edge = boardDiagramGraph(result.state).edges[0];
  assert.deepEqual([edge.label, edge.attached], ["checks", true]);
});

test("Airo's and typed arrows are drawn heavy unless a light weight is asked for", () => {
  let state = createInitialBoardState("board-1");
  state = node(state, "api", "api", { x: 100, y: 100 });
  state = node(state, "db", "database", { x: 400, y: 100 });
  const heavy = run(state, { type: "nodes.connect", connectorId: "c", fromId: "api", toId: "db", source: "voice", style: { strokeColor: "#111827" } });
  assert.equal(heavy.state.elements.c.style.thickness, "thick");
  assert.equal(heavy.state.elements.c.style.color, "#111827");
  const light = run(state, { type: "nodes.connect", connectorId: "c", fromId: "api", toId: "db", style: { thickness: 2 } });
  assert.equal(light.state.elements.c.style.thickness, "thin");
});

test("parallel and two-way arrows between the same objects take separate lanes", () => {
  let state = createInitialBoardState("board-1");
  state = node(state, "a", "service", { x: 100, y: 100 });
  state = node(state, "b", "service", { x: 500, y: 100 });
  state = connect(state, "first", "a", "b");
  state = connect(state, "back", "b", "a", "replies");
  state = connect(state, "third", "a", "b");
  assert.deepEqual(
    ["first", "back", "third"].map((id) => state.elements[id].routeOffset),
    [undefined, 72, -72],
  );
});

test("grouping and duplicating v2 objects make v2 sections and copies", () => {
  let state = createInitialBoardState("board-1");
  state = node(state, "api", "api", { x: 100, y: 100 });
  state = node(state, "db", "database", { x: 400, y: 100 });
  state = connect(state, "c", "api", "db", "reads");
  const grouped = run(state, { type: "objects.group", groupId: "g", objectIds: ["api", "db"], label: "Backend" });
  assert.equal(grouped.state.elements.g.kind, "section");
  assert.deepEqual(grouped.state.elements.g.memberIds, ["api", "db"]);
  assert.deepEqual(boardDiagramGraph(grouped.state).groups.map((group) => group.label), ["Backend"]);

  const copied = run(state, { type: "objects.duplicate", objectIds: ["api"], idMap: { api: "api-2" }, offset: { x: 0, y: 200 } });
  assert.equal(copied.state.elements["api-2"].kind, "shape");
  assert.equal(copied.state.elements["api-2"].transform.y, state.elements.api.transform.y + 200);
});

test("the edit verbs move, restyle, rename and delete with their connectors, undoably", () => {
  let state = node(createInitialBoardState("board-1"), "old", "service", { x: 100, y: 100 }, { label: "Old" });
  state = node(state, "new", "service", { x: 400, y: 100 });
  state = connect(state, "c", "old", "new");

  const moved = run(state, { type: "objects.move", objectIds: ["old", "new"], to: { x: 0, y: 300 } });
  const graph = boardDiagramGraph(moved.state);
  const byName = Object.fromEntries(graph.nodes.map((entry) => [entry.name, entry.bounds]));
  assert.equal(byName.Old.x, 0);
  assert.equal(byName.Old.y, 300);
  assert.equal(byName.new.x, state.elements.new.transform.x - state.elements.old.transform.x);
  assert.equal(graph.edges[0].attached, true, "the arrow follows both ends");
  assert.deepEqual(projectionOf(applyDiagramUndo(moved.state, moved).state), projectionOf(state));

  const restyled = run(state, { type: "object.restyle", objectId: "new", fillColor: "#fee2e2", strokeColor: "#b91c1c" });
  assert.deepEqual([restyled.state.elements.new.style.fill, restyled.state.elements.new.style.stroke], ["#fee2e2", "#b91c1c"]);
  assert.equal(applyDiagramUndo(restyled.state, restyled).state.elements.new.style.fill, "#f8fafc");

  const renamed = run(state, { type: "object.rename", objectId: "new", label: "Fresh" });
  assert.equal(richTextToPlainText(renamed.state.elements.new.content), "Fresh");

  const deleted = run(state, { type: "objects.delete", objectIds: ["old", "new"] });
  assert.equal(deleted.state.elements.old.status, "deleted");
  assert.equal(deleted.state.elements.new.status, "deleted");
  assert.equal(deleted.state.elements.c.status, "deleted", "the arrow goes with its shapes");
  const restored = applyDiagramUndo(deleted.state, deleted).state;
  assert.deepEqual(projectionOf(restored), projectionOf(state));

  const lineOnly = run(state, { type: "objects.delete", objectIds: ["c"], cascadeConnectors: false });
  assert.equal(lineOnly.state.elements.c.status, "deleted");
  assert.equal(lineOnly.state.elements.new.status, "active");
});

test("deleting a node cascades to its arrows, and undo restores both", () => {
  let state = node(createInitialBoardState("board-1"), "a", "service", { x: 100, y: 100 });
  state = node(state, "b", "service", { x: 400, y: 100 });
  state = node(state, "c", "service", { x: 700, y: 100 });
  state = connect(state, "ab", "a", "b");
  state = connect(state, "bc", "b", "c");
  const deleted = run(state, { type: "objects.delete", objectIds: ["b"] });
  assert.deepEqual(
    ["a", "b", "c", "ab", "bc"].map((id) => deleted.state.elements[id].status),
    ["active", "deleted", "active", "deleted", "deleted"],
  );
  const restored = applyDiagramUndo(deleted.state, deleted).state;
  assert.deepEqual(
    ["a", "b", "c", "ab", "bc"].map((id) => restored.elements[id].status),
    ["active", "active", "active", "active", "active"],
  );
  assert.deepEqual(projectionOf(restored), projectionOf(state));
});

test("objects.move skips missing selection ids, and a connector alone is not moved", () => {
  let state = node(createInitialBoardState("board-1"), "one", "service", { x: 100, y: 100 });
  state = node(state, "two", "service", { x: 400, y: 100 });
  state = connect(state, "edge", "one", "two");
  const before = structuredClone(state.elements.one.transform);

  const moved = run(state, { type: "objects.move", objectIds: ["one", "ghost-that-was-deleted"], delta: { x: 30, y: 20 } });
  assert.equal(moved.state.elements.one.transform.x, before.x + 30);
  assert.equal(moved.state.elements.one.transform.y, before.y + 20);
  assert.equal(boardDiagramGraph(moved.state).edges[0].attached, true, "its arrow follows");

  // A connector follows its objects; on its own it has nothing to move.
  assert.throws(
    () => run(state, { type: "objects.move", objectIds: ["edge"], delta: { x: 0, y: 120 } }),
    /no movable objects/,
  );
  assert.throws(
    () => run(state, { type: "objects.move", objectIds: ["one"], delta: { x: 1, y: 1 }, to: { x: 0, y: 0 } }),
    /exactly one of delta or to/,
  );
});

test("connection.reverse, object.resize and connector.restyle act on v2 elements, undoably", () => {
  let state = node(createInitialBoardState("board-1"), "api", "api", { x: 100, y: 100 });
  state = node(state, "db", "database", { x: 400, y: 100 });
  state = connect(state, "c", "api", "db", "reads");

  const reversed = run(state, { type: "connection.reverse", connectorId: "c", label: "writes" });
  assert.equal(reversed.state.elements.c.start.binding.elementId, "db");
  assert.equal(reversed.state.elements.c.end.binding.elementId, "api");
  assert.equal(richTextToPlainText(reversed.state.elements.c.label), "writes");
  assert.equal(applyDiagramUndo(reversed.state, reversed).state.elements.c.start.binding.elementId, "api");

  const resized = run(state, { type: "object.resize", objectId: "api", bounds: { x: 300, y: 200, width: -200, height: 120 } });
  const { x, y, width, height } = resized.state.elements.api.transform;
  assert.deepEqual({ x, y, width, height }, { x: 100, y: 200, width: 200, height: 120 }, "a negative width is normalised");
  assert.equal(boardDiagramGraph(resized.state).edges[0].attached, true, "the arrow follows the new box");
  assert.deepEqual(applyDiagramUndo(resized.state, resized).state.elements.api.transform, state.elements.api.transform);

  const dashed = run(state, { type: "connector.restyle", connectorId: "c", lineStyle: "dashed" });
  assert.equal(dashed.state.elements.c.style.strokeStyle, "dashed");
  assert.equal(applyDiagramUndo(dashed.state, dashed).state.elements.c.style.strokeStyle, "solid");
});

function projectionOf(state) {
  const graph = boardDiagramGraph(state);
  return {
    nodes: graph.nodes.map(({ name, kind, bounds }) => ({ name, kind, bounds })),
    edges: graph.edges.map(({ from, to, label, attached }) => ({ from, to, label, attached })),
    groups: graph.groups.map(({ label, memberIds }) => ({ label, memberIds })),
  };
}
