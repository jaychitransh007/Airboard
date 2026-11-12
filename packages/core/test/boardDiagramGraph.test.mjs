import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  boardDiagramGraph,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
} from "../src/index.ts";

let eventCounter = 0;
const context = {
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  userId: "user-1",
  createdAt: "2026-11-12T00:00:00.000Z",
  eventIdFactory: () => `event-${++eventCounter}`,
};

const BOXES = {
  user: { x: 100, y: 100, width: 160, height: 92 },
  api: { x: 400, y: 100, width: 180, height: 92 },
  db: { x: 700, y: 100, width: 160, height: 92 },
};
const LABELS = { user: "Customer", api: "Orders API", db: "Orders DB" };
const TYPES = { user: "user", api: "api", db: "database" };

function command(state, value) {
  return applyDiagramCommand(state, value, context).state;
}

function created(state, element) {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
    type: "element.created",
    element: createBoardSceneElement({ boardId: "board-1", ...element }),
  });
}

function sceneShape(state, id) {
  return created(state, {
    id,
    kind: "shape",
    shapeKind: TYPES[id],
    transform: { ...BOXES[id], rotation: 0 },
    content: createRichTextDocument(LABELS[id], `${id}:content`),
  });
}

/** The diagram as Airo draws it today: legacy annotation strokes. */
function legacyBoard() {
  let state = createInitialBoardState("board-1");
  for (const id of ["user", "api", "db"]) {
    state = command(state, { type: "node.create", nodeId: id, nodeType: TYPES[id], label: LABELS[id], bounds: BOXES[id], source: "voice" });
  }
  state = command(state, { type: "nodes.connect", connectorId: "e1", fromId: "user", toId: "api", label: "places order" });
  state = command(state, { type: "nodes.connect", connectorId: "e2", fromId: "api", toId: "db", label: "writes" });
  state = command(state, { type: "objects.group", groupId: "g1", objectIds: ["api", "db"], label: "Backend" });
  return state;
}

/** The same diagram made of v2 scene elements only. */
function sceneBoard() {
  let state = createInitialBoardState("board-1");
  for (const id of ["user", "api", "db"]) state = sceneShape(state, id);
  state = command(state, { type: "scene.connect", connectorId: "e1", fromId: "user", toId: "api", label: "places order" });
  state = command(state, { type: "scene.connect", connectorId: "e2", fromId: "api", toId: "db", label: "writes" });
  state = command(state, { type: "scene.group", sectionId: "g1", memberIds: ["api", "db"], label: "Backend" });
  return state;
}

/** What should not depend on the model: names, types, boxes, links, labels, groups. */
function projection(graph) {
  const byId = (left, right) => left.id.localeCompare(right.id);
  return {
    nodes: graph.nodes.map(({ id, label, name, kind, role, bounds, groupIds }) =>
      ({ id, label, name, kind, role, bounds, groupIds: [...groupIds].sort() })).sort(byId),
    edges: graph.edges.map(({ id, from, to, label, directed, lineStyle, attached }) =>
      ({ id, from, to, label, directed, lineStyle, attached })).sort(byId),
    groups: graph.groups.map(({ id, label, memberIds }) => ({ id, label, memberIds: [...memberIds].sort() })).sort(byId),
  };
}

test("a legacy-only board: nodes, edges and the group come from the strokes, once each", () => {
  const state = legacyBoard();
  assert.ok(Object.keys(state.elements).length > 0, "legacy strokes are mirrored into scene elements");
  const graph = boardDiagramGraph(state);
  assert.deepEqual(graph.nodes.map((node) => node.id), ["user", "api", "db"]);
  assert.ok(graph.nodes.every((node) => node.model === "stroke" && node.role === "shape"));
  assert.deepEqual(graph.nodes.map((node) => node.kind), ["user", "api", "database"]);
  assert.deepEqual(graph.nodes[1].bounds, BOXES.api);
  assert.deepEqual(graph.edges.map(({ id, from, to, label, directed, attached }) => ({ id, from, to, label, directed, attached })), [
    { id: "e1", from: "user", to: "api", label: "places order", directed: true, attached: true },
    { id: "e2", from: "api", to: "db", label: "writes", directed: true, attached: true },
  ]);
  assert.equal(graph.edges[0].geometry.model, "stroke");
  assert.equal(graph.groups.length, 1);
  assert.equal(graph.groups[0].id, "g1");
  assert.deepEqual([...graph.groups[0].memberIds].sort(), ["api", "db"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "db").groupIds, ["g1"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "user").groupIds, []);
});

test("a v2-only board: nodes, edges and the section come from the scene elements", () => {
  const graph = boardDiagramGraph(sceneBoard());
  assert.deepEqual(graph.nodes.map((node) => node.id), ["user", "api", "db"]);
  assert.ok(graph.nodes.every((node) => node.model === "scene" && node.objectType === "shape"));
  assert.deepEqual(graph.nodes.map((node) => node.label), ["Customer", "Orders API", "Orders DB"]);
  assert.deepEqual(graph.edges.map(({ from, to, label, directed, attached }) => ({ from, to, label, directed, attached })), [
    { from: "user", to: "api", label: "places order", directed: true, attached: true },
    { from: "api", to: "db", label: "writes", directed: true, attached: true },
  ]);
  assert.equal(graph.edges[0].geometry.model, "scene");
  assert.equal(graph.groups.length, 1);
  assert.equal(graph.groups[0].kind, "section");
  assert.equal(graph.groups[0].label, "Backend");
});

test("the same diagram in either model gives the same projection", () => {
  assert.deepEqual(projection(boardDiagramGraph(sceneBoard())), projection(boardDiagramGraph(legacyBoard())));
});

test("a mixed board lists legacy and v2 objects once each, and edges may join one of each", () => {
  let state = createInitialBoardState("board-1");
  state = command(state, { type: "node.create", nodeId: "db", nodeType: "database", label: "Orders DB", bounds: BOXES.db, source: "voice" });
  state = sceneShape(state, "api");
  state = command(state, { type: "scene.connect", connectorId: "c1", fromId: "api", toId: "db", label: "writes" });
  const graph = boardDiagramGraph(state);
  assert.equal(state.elements.db.legacyStrokeId, "db");
  assert.deepEqual(graph.nodes.map(({ id, model }) => ({ id, model })), [
    { id: "db", model: "stroke" },
    { id: "api", model: "scene" },
  ]);
  assert.deepEqual(graph.edges.map(({ id, from, to, model, attached }) => ({ id, from, to, model, attached })), [
    { id: "c1", from: "api", to: "db", model: "scene", attached: true },
  ]);
});

test("deleted, hidden and collapsed objects are left out; marks and blank shapes are named by type", () => {
  let state = sceneBoard();
  state = command(state, { type: "scene.delete", elementIds: ["user"] });
  state = created(state, {
    id: "note",
    kind: "text",
    transform: { x: 100, y: 400, width: 120, height: 30, rotation: 0 },
    content: createRichTextDocument("  remember   this ", "note:content"),
  });
  state = created(state, { id: "blank", kind: "shape", shapeKind: "database", transform: { x: 400, y: 400, width: 100, height: 80, rotation: 0 } });
  state = created(state, { id: "hidden", kind: "shape", shapeKind: "api", visible: false, transform: { x: 600, y: 400, width: 100, height: 80, rotation: 0 } });
  const graph = boardDiagramGraph(state);
  const ids = graph.nodes.map((node) => node.id);
  assert.ok(!ids.includes("user"), "deleted");
  assert.ok(!ids.includes("hidden"), "hidden");
  assert.ok(!graph.edges.some((edge) => edge.id === "e1"), "a deleted node takes its connector along");
  const note = graph.nodes.find((node) => node.id === "note");
  assert.equal(note.role, "mark");
  assert.equal(note.label, "remember this");
  const blank = graph.nodes.find((node) => node.id === "blank");
  assert.equal(blank.label, null);
  assert.equal(blank.name, "Database");
  assert.equal(blank.kind, "database");

  const collapsed = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
    type: "element.patched",
    elementId: "g1",
    patches: [{ op: "field.set", path: ["collapsed"], value: true }],
  });
  const collapsedIds = boardDiagramGraph(collapsed).nodes.map((node) => node.id);
  assert.ok(!collapsedIds.includes("api") && !collapsedIds.includes("db"), "inside a collapsed section");
});

test("a legacy connector dragged off its nodes is not attached; a deleted legacy node leaves the graph", () => {
  let state = legacyBoard();
  const connector = state.strokes.e1;
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
    type: "stroke.annotation_updated",
    strokeId: "e1",
    annotation: { ...connector.annotation, start: { x: 0, y: 600 }, end: { x: 50, y: 650 } },
    points: [{ x: 0, y: 600, t: 1 }, { x: 50, y: 650, t: 2 }],
  });
  const detached = boardDiagramGraph(state).edges.find((edge) => edge.id === "e1");
  assert.equal(detached.from, "user", "the binding is still recorded");
  assert.equal(detached.attached, false);

  state = command(state, { type: "objects.delete", objectIds: ["user"] });
  const graph = boardDiagramGraph(state);
  assert.ok(!graph.nodes.some((node) => node.id === "user"));
  assert.ok(!graph.edges.some((edge) => edge.id === "e1"), "its connector goes too");
});

test("the graph only reads the state", () => {
  const state = legacyBoard();
  const before = JSON.stringify(state);
  boardDiagramGraph(state);
  assert.equal(JSON.stringify(state), before);
});
