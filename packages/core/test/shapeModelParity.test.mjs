import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  applyLegacyDiagramFixture,
  boardDiagramGraph,
  createInitialBoardState,
} from "../src/index.ts";

/**
 * Per-verb parity between the two shape models (shape-merge phase 0).
 *
 * The same diagram is built twice: once as the legacy annotation strokes that
 * boards saved before November 2026 hold, once as the v2 scene elements every
 * command makes now. Each of the ten verbs that has a legacy form and a
 * scene.* twin then runs on both boards (the legacy verb on the legacy board;
 * the scene verb and the legacy verb, which now takes v2 ids too, on the v2
 * board), and the model-independent diagram the two boards show must match,
 * before and after undo.
 */

let counter = 0;
const context = () => ({
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt: "2026-11-12T00:00:00.000Z",
  eventIdFactory: () => `event-${++counter}`,
  objectIdFactory: () => `object-${++counter}`,
});

const NODES = [
  { id: "user", nodeType: "user", label: "Customer", center: { x: 120, y: 120 } },
  { id: "api", nodeType: "api", label: "Orders API", center: { x: 420, y: 120 } },
  { id: "check", nodeType: "decision", label: "Paid?", center: { x: 720, y: 120 } },
  { id: "db", nodeType: "database", label: "Orders DB", center: { x: 420, y: 380 } },
];
const EDGES = [
  { id: "e-order", fromId: "user", toId: "api", label: "orders" },
  { id: "e-check", fromId: "api", toId: "check" },
  { id: "e-write", fromId: "api", toId: "db", label: "writes" },
];

function build(model) {
  const apply = model === "legacy" ? applyLegacyDiagramFixture : applyDiagramCommand;
  let state = createInitialBoardState("board-1");
  for (const node of NODES) {
    state = apply(state, {
      type: "node.create",
      nodeId: node.id,
      nodeType: node.nodeType,
      label: node.label,
      center: node.center,
      source: "voice",
      style: { strokeColor: "#111827" },
    }, context()).state;
  }
  for (const edge of EDGES) {
    state = apply(state, {
      type: "nodes.connect",
      connectorId: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      ...(edge.label ? { label: edge.label } : {}),
      source: "voice",
    }, context()).state;
  }
  return state;
}

const round = (value) => Math.round(value);
const box = ({ x, y, width, height }) => ({ x: round(x), y: round(y), width: round(width), height: round(height) });

/**
 * What a person sees: each node's name, type and box; each edge's ends,
 * label, style and whether it is attached; each group's name and members.
 * Ids, the model and edge routes (which differ by a few units between the
 * two painters) are left out.
 */
function projection(state) {
  const graph = boardDiagramGraph(state);
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  return {
    nodes: graph.nodes
      .map((node) => ({
        name: node.name,
        kind: node.kind,
        role: node.role,
        bounds: box(node.bounds),
        groups: node.groupIds.map((id) => graph.groups.find((group) => group.id === id)?.label ?? null),
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y),
    edges: graph.edges
      .map((edge) => ({
        from: names.get(edge.from) ?? null,
        to: names.get(edge.to) ?? null,
        label: edge.label,
        directed: edge.directed,
        lineStyle: edge.lineStyle,
        attached: edge.attached,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    groups: graph.groups
      .map((group) => ({ label: group.label, members: group.memberIds.map((id) => names.get(id)).sort() }))
      .sort((left, right) => String(left.label).localeCompare(String(right.label))),
  };
}

/** Runs one command, checks undo restores the board exactly, and returns the projection after it. */
function runAndUndo(state, command) {
  const result = applyDiagramCommand(state, command, context());
  const undone = applyDiagramUndo(result.state, result);
  assert.deepEqual(projection(undone.state), projection(state), `${command.type} undoes cleanly`);
  return projection(result.state);
}

const legacyBoard = build("legacy");
const sceneBoard = build("scene");

test("the legacy board and its v2 twin show the same diagram", () => {
  assert.equal(Object.keys(legacyBoard.strokes).length, NODES.length + EDGES.length);
  assert.deepEqual(Object.keys(sceneBoard.strokes), [], "node.create and nodes.connect write no strokes");
  assert.deepEqual(projection(sceneBoard), projection(legacyBoard));
});

/**
 * The ten verb pairs. `legacy` runs on the legacy board; `scene` (the twin)
 * and `legacy` again run on the v2 board.
 */
const PAIRS = [
  {
    name: "connect",
    legacy: { type: "nodes.connect", connectorId: "e-new", fromId: "db", toId: "check", label: "audits" },
    scene: { type: "scene.connect", connectorId: "e-new", fromId: "db", toId: "check", label: "audits" },
  },
  {
    name: "rename",
    legacy: { type: "object.rename", objectId: "api", label: "Checkout API" },
    scene: { type: "scene.rename", elementId: "api", label: "Checkout API" },
  },
  {
    name: "move",
    legacy: { type: "objects.move", objectIds: ["db"], delta: { x: 40, y: 60 } },
    scene: { type: "scene.move", elementIds: ["db"], delta: { x: 40, y: 60 } },
  },
  {
    name: "delete",
    legacy: { type: "objects.delete", objectIds: ["db"] },
    scene: { type: "scene.delete", elementIds: ["db"] },
  },
  {
    name: "reverse",
    legacy: { type: "connection.reverse", connectorId: "e-write", label: "reads" },
    scene: { type: "scene.connector.reverse", connectorId: "e-write", label: "reads" },
  },
  {
    name: "duplicate",
    legacy: { type: "objects.duplicate", objectIds: ["check"], idMap: { check: "check-copy" }, offset: { x: 0, y: 200 } },
    scene: { type: "scene.duplicate", elementIds: ["check"], idMap: { check: "check-copy" }, offset: { x: 0, y: 200 } },
  },
  {
    name: "group",
    legacy: { type: "objects.group", groupId: "backend", objectIds: ["api", "db"], label: "Backend" },
    scene: { type: "scene.group", sectionId: "backend", memberIds: ["api", "db"], label: "Backend" },
  },
  {
    name: "resize",
    legacy: { type: "object.resize", objectId: "api", bounds: { x: 330, y: 70, width: 220, height: 110 } },
    scene: { type: "scene.resize", elementId: "api", bounds: { x: 330, y: 70, width: 220, height: 110 } },
  },
  {
    name: "retype",
    legacy: { type: "object.retype", objectId: "db", nodeType: "queue" },
    scene: { type: "scene.retype", elementId: "db", shapeKind: "queue", nodeType: "queue" },
  },
  {
    name: "connector restyle",
    legacy: { type: "connector.restyle", connectorId: "e-check", lineStyle: "dashed" },
    scene: { type: "scene.connector.restyle", connectorId: "e-check", lineStyle: "dashed" },
  },
];

for (const pair of PAIRS) {
  test(`parity: ${pair.name} gives the same diagram on legacy strokes and on v2 elements`, () => {
    const legacy = runAndUndo(legacyBoard, pair.legacy);
    const twin = runAndUndo(sceneBoard, pair.scene);
    const agnostic = runAndUndo(sceneBoard, pair.legacy);
    // A legacy group is a framed rectangle, a v2 group a section: the members
    // and name match, and the frame itself is not a node in either.
    assert.deepEqual(twin, legacy, `${pair.scene.type} on v2 matches ${pair.legacy.type} on legacy`);
    assert.deepEqual(agnostic, twin, `${pair.legacy.type} on v2 matches ${pair.scene.type}`);
  });
}

test("parity: grouping refuses to mix a legacy node with a v2 shape", () => {
  const mixed = applyDiagramCommand(legacyBoard, {
    type: "node.create",
    nodeId: "cache",
    nodeType: "service",
    label: "Cache",
    center: { x: 720, y: 380 },
  }, context()).state;
  assert.throws(
    () => applyDiagramCommand(mixed, { type: "objects.group", objectIds: ["db", "cache"], label: "Data" }, context()),
    /older diagram can't be grouped with newer shapes/,
  );
});
