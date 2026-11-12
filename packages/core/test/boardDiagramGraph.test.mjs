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

/** A diagram made of v2 scene elements. */
function sceneBoard() {
  let state = createInitialBoardState("board-1");
  for (const id of ["user", "api", "db"]) state = sceneShape(state, id);
  state = command(state, { type: "scene.connect", connectorId: "e1", fromId: "user", toId: "api", label: "places order" });
  state = command(state, { type: "scene.connect", connectorId: "e2", fromId: "api", toId: "db", label: "writes" });
  state = command(state, { type: "scene.group", sectionId: "g1", memberIds: ["api", "db"], label: "Backend" });
  return state;
}

test("nodes, edges and the section come from the scene elements", () => {
  const graph = boardDiagramGraph(sceneBoard());
  assert.deepEqual(graph.nodes.map((node) => node.id), ["user", "api", "db"]);
  assert.ok(graph.nodes.every((node) => node.objectType === "shape"));
  assert.deepEqual(graph.nodes.map((node) => node.label), ["Customer", "Orders API", "Orders DB"]);
  assert.deepEqual(graph.edges.map(({ from, to, label, directed, attached }) => ({ from, to, label, directed, attached })), [
    { from: "user", to: "api", label: "places order", directed: true, attached: true },
    { from: "api", to: "db", label: "writes", directed: true, attached: true },
  ]);
  assert.ok(graph.edges[0].geometry.controlPoints);
  assert.equal(graph.groups.length, 1);
  assert.equal(graph.groups[0].kind, "section");
  assert.equal(graph.groups[0].label, "Backend");
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

test("a connector dragged off its nodes is not attached; a deleted node leaves the graph", () => {
  let state = sceneBoard();
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "board-1", actorParticipantId: "participant-1" }),
    type: "element.patched",
    elementId: "e1",
    patches: [
      { op: "field.set", path: ["start", "point"], value: { x: 0, y: 600 } },
      { op: "field.set", path: ["end", "point"], value: { x: 50, y: 650 } },
    ],
  });
  const detached = boardDiagramGraph(state).edges.find((edge) => edge.id === "e1");
  assert.equal(detached.from, "user", "the binding is still recorded");
  assert.equal(detached.attached, false);

  state = command(state, { type: "objects.delete", objectIds: ["user"] });
  const graph = boardDiagramGraph(state);
  assert.ok(!graph.nodes.some((node) => node.id === "user"));
  assert.ok(!graph.edges.some((edge) => edge.id === "e1"), "its connector goes too");
});

test("the graph only reads the state, and every node, edge and group is a scene one", () => {
  const state = sceneBoard();
  const before = JSON.stringify(state);
  const graph = boardDiagramGraph(state);
  assert.equal(JSON.stringify(state), before);
  assert.ok([...graph.nodes, ...graph.edges, ...graph.groups].every((item) => !("model" in item)));
});
