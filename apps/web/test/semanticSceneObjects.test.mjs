import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  richTextToPlainText,
} from "@airboard/core";
import {
  buildSemanticIntentContext,
  resolveSemanticPlanAction,
} from "../src/features/board/intentPipeline.ts";
import { commitCommandTurn } from "../src/features/board/commandTurnCoordinator.ts";
import { computeSemanticAutoLayout } from "../src/features/board/semanticAutoLayout.ts";

// RGB-039: Airo must see, and change, the shapes typed commands and the
// toolbar make, alongside the nodes it draws itself.

const BOARD = "scene-board";
const commandContext = { boardSessionId: BOARD, actorParticipantId: "participant", userId: "user" };

function created(state, element) {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: BOARD, actorParticipantId: "participant" }),
    type: "element.created",
    element,
  });
}

/** User and API from typed commands, joined by a toolbar connector, plus a Database Airo drew. */
function mixedBoard() {
  let state = createInitialBoardState(BOARD);
  state = created(state, createBoardSceneElement({
    id: "user", boardId: BOARD, kind: "shape", shapeKind: "user",
    transform: { x: 100, y: 100, width: 120, height: 80, rotation: 0 },
    content: createRichTextDocument("User", "user:content"),
  }));
  state = created(state, createBoardSceneElement({
    id: "api", boardId: BOARD, kind: "shape", shapeKind: "api",
    transform: { x: 400, y: 100, width: 120, height: 80, rotation: 0 },
    content: createRichTextDocument("API", "api:content"),
  }));
  state = applyDiagramCommand(state, { type: "scene.connect", connectorId: "user-api", fromId: "user", toId: "api", label: "requests" }, commandContext).state;
  state = applyDiagramCommand(state, {
    type: "node.create", nodeId: "db", nodeType: "database", label: "Database", center: { x: 760, y: 140 }, source: "voice",
  }, commandContext).state;
  return state;
}

function grounding(boardState, overrides = {}) {
  return {
    boardState,
    pointer: { x: 460, y: 140 },
    pointerAvailable: true,
    canvasWidth: 900,
    canvasHeight: 600,
    selectionIds: [],
    primarySelectionId: null,
    strokeColor: "#111111",
    ...overrides,
  };
}

const label = (value) => ({ kind: "visible_label", label: value, occurrence: null });
const resolve = (state, action, overrides) => resolveSemanticPlanAction(action, grounding(state, overrides), new Map());

test("Airo's board summary lists typed and toolbar shapes and their connectors", () => {
  const context = buildSemanticIntentContext(mixedBoard(), ["api"], false);
  assert.deepEqual(context.objects.map(({ label: name, nodeType }) => [name, nodeType]), [
    ["User", "user"],
    ["API", "api"],
    ["Database", "database"],
  ]);
  assert.equal(context.objects.find(({ label: name }) => name === "API").selected, true);
  assert.deepEqual(context.edges.map(({ from, to, label: name }) => [from.label, to.label, name]), [["User", "API", "requests"]]);
});

test("connecting a typed shape to Airo's own node draws one connector between the existing objects", () => {
  const state = mixedBoard();
  const resolution = resolve(state, { type: "connect", from: label("API"), to: label("Database"), label: "talks to" });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands.length, 1);
  assert.equal(resolution.commands[0].type, "nodes.connect", "a new arrow, drawn as a v2 connector");
  const next = applyDiagramCommand(state, resolution.commands[0], commandContext).state;
  const connectors = Object.values(next.elements).filter((element) => element.kind === "connector" && element.status === "active");
  assert.equal(connectors.length, 2);
  const added = connectors.find(({ id }) => id !== "user-api");
  assert.deepEqual([added.start.binding.elementId, added.end.binding.elementId], ["api", "db"]);
  assert.equal(richTextToPlainText(added.label), "talks to");
  // No second API appeared.
  assert.equal(Object.values(next.elements).filter((element) => element.status === "active" && element.kind === "shape" && element.shapeKind === "api").length, 1);
});

test("a connection that already exists between typed shapes is left alone", () => {
  const resolution = resolve(mixedBoard(), { type: "connect", from: label("User"), to: label("API"), label: "requests" });
  assert.deepEqual(resolution.commands, []);
});

test("rename, move, delete and reverse reach typed shapes and their connectors", () => {
  const state = mixedBoard();
  const rename = resolve(state, { type: "rename", target: label("API"), label: "Gateway" });
  assert.deepEqual(rename.commands, [{ type: "scene.rename", elementId: "api", label: "Gateway" }]);

  const move = resolve(state, { type: "move", targets: [label("API")], placement: { kind: "offset", direction: "below", distance: "medium" } });
  assert.equal(move.commands.length, 1);
  assert.equal(move.commands[0].type, "scene.move");
  assert.deepEqual(move.commands[0].elementIds, ["api"]);

  const bothDelete = resolve(state, { type: "delete", targets: [label("API"), label("Database")] });
  assert.deepEqual(bothDelete.commands, [{ type: "scene.delete", elementIds: ["api", "db"] }]);

  const reverse = resolve(state, {
    type: "reverse_connection",
    connection: { from: label("User"), to: label("API"), label: null, occurrence: null },
    label: null,
  });
  assert.deepEqual(reverse.commands, [{ type: "scene.connector.reverse", connectorId: "user-api" }]);

  const unlink = resolve(state, { type: "delete_connection", connection: { from: label("User"), to: label("API"), label: null, occurrence: null } });
  assert.deepEqual(unlink.commands, [{ type: "scene.delete", elementIds: ["user-api"] }]);
});

test("a new node placed next to a typed shape is placed beside it, not on top", () => {
  const state = mixedBoard();
  const resolution = resolve(state, {
    type: "create", nodeType: "cache", label: "Cache", handle: "cache_1",
    placement: { kind: "relative", anchor: label("API"), direction: "below" },
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands[0].center.x, 460);
  assert.ok(resolution.commands[0].center.y > 180, "below the API, not over it");
});

test("the pointer and ordinals reach typed shapes", () => {
  const state = mixedBoard();
  const pointed = resolve(state, { type: "rename", target: { kind: "pointer" }, label: "Edge" });
  assert.deepEqual(pointed.commands, [{ type: "scene.rename", elementId: "api", label: "Edge" }]);
  const ordinal = resolve(state, { type: "rename", target: { kind: "type_ordinal", nodeType: "user", ordinal: 1 }, label: "Shopper" });
  assert.deepEqual(ordinal.commands, [{ type: "scene.rename", elementId: "user", label: "Shopper" }]);
});

/** Resolves a plan action and applies its commands, as one Airo turn would. */
function applyAction(state, action) {
  const resolution = resolve(state, action);
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  const turn = commitCommandTurn({
    snapshot: { boardState: state, selectionIds: [] },
    currentState: state,
    currentSelectionIds: [],
    commands: resolution.commands,
    ...(resolution.selectionAfter ? { requestedSelectionIds: resolution.selectionAfter } : {}),
    contextForCommand: () => commandContext,
  });
  assert.equal(turn.status, "applied");
  return { resolution, turn, state: turn.state };
}

test("Airo lines up and spreads out typed shapes with its own nodes", () => {
  const { state, turn } = applyAction(mixedBoard(), { type: "align", targets: [label("User"), label("API"), label("Database")], alignment: "bottom" });
  const bottom = (id) => state.elements[id].transform.y + state.elements[id].transform.height;
  assert.equal(bottom("api"), bottom("user"));
  assert.equal(bottom("db"), bottom("user"));
  // The typed shapes stay selected for a follow-up such as "now move them left".
  assert.deepEqual(turn.selectionIds, ["user", "api", "db"]);

  let spread = mixedBoard();
  spread = applyDiagramCommand(spread, { type: "scene.move", elementIds: ["api"], delta: { x: -250, y: 0 } }, commandContext).state;
  const distributed = applyAction(spread, { type: "distribute", targets: [label("User"), label("API"), label("Database")], axis: "horizontal" }).state;
  const right = (id) => distributed.elements[id].transform.x + distributed.elements[id].transform.width;
  const gapOne = distributed.elements.api.transform.x - right("user");
  const gapTwo = distributed.elements.db.transform.x - right("api");
  assert.ok(Math.abs(gapOne - gapTwo) < 0.001, `even gaps: ${gapOne} and ${gapTwo}`);
});

test("Airo lays typed shapes out in a column, and their connector follows", () => {
  const before = mixedBoard();
  const { resolution, state } = applyAction(before, { type: "layout", targets: [label("User"), label("API")], direction: "top_to_bottom" });
  assert.ok(resolution.commands.every(({ type }) => type === "scene.move"), JSON.stringify(resolution.commands));
  assert.equal(state.elements.user.transform.x, state.elements.api.transform.x);
  assert.ok(state.elements.api.transform.y > state.elements.user.transform.y + 80);
  assert.notDeepEqual(state.elements["user-api"].end.point, before.elements["user-api"].end.point);
});

test("Airo copies a typed shape where it's asked to", () => {
  const before = mixedBoard();
  const { resolution, state } = applyAction(before, {
    type: "duplicate", targets: [label("API")], placement: { kind: "offset", direction: "below", distance: "large" },
  });
  assert.deepEqual(resolution.commands.map(({ type }) => type), ["scene.duplicate"]);
  const copyId = resolution.selectionAfter[0];
  const copy = state.elements[copyId];
  assert.equal(richTextToPlainText(copy.content), "API");
  assert.deepEqual([copy.transform.x, copy.transform.y], [400, 100 + 180]);

  // A typed shape and Airo's node are copied together, at the same offset.
  const both = applyAction(before, {
    type: "duplicate", targets: [label("API"), label("Database")], placement: { kind: "offset", direction: "right", distance: "small" },
  });
  assert.deepEqual(both.resolution.commands.map(({ type }) => type), ["scene.duplicate"]);
  const [apiCopy, dbCopy] = both.resolution.selectionAfter;
  assert.equal(both.state.elements[apiCopy].transform.x, 400 + 48);
  assert.equal(both.state.elements[dbCopy].transform.x, before.elements.db.transform.x + 48);
});

test("Airo groups typed shapes in a section, together with its own nodes", () => {
  const { resolution, state } = applyAction(mixedBoard(), { type: "group", targets: [label("User"), label("API")], label: "Front end", handle: "g_1" });
  const [command] = resolution.commands;
  assert.equal(command.type, "scene.group");
  const section = state.elements[command.sectionId];
  assert.equal(richTextToPlainText(section.title), "Front end");
  assert.deepEqual(section.memberIds, ["user", "api"]);
  assert.deepEqual(resolution.selectionAfter, ["user", "api"]);

  const withAiro = applyAction(mixedBoard(), { type: "group", targets: [label("API"), label("Database")], label: null, handle: "g_2" });
  assert.equal(withAiro.resolution.commands[0].type, "scene.group");
  assert.deepEqual(withAiro.state.elements[withAiro.resolution.commands[0].sectionId].memberIds, ["api", "db"]);

  let fresh = mixedBoard();
  fresh = applyDiagramCommand(fresh, {
    type: "node.create", nodeId: "cache", nodeType: "database", label: "Cache", center: { x: 760, y: 400 }, source: "voice",
  }, commandContext).state;
  const together = applyAction(fresh, { type: "group", targets: [label("API"), label("Cache")], label: "Back end", handle: "g_3" });
  assert.equal(together.resolution.commands[0].type, "scene.group");
  assert.deepEqual(together.state.elements[together.resolution.commands[0].sectionId].memberIds, ["api", "cache"]);
});

test("automatic placement keeps new nodes off typed shapes", () => {
  let state = createInitialBoardState(BOARD);
  state = created(state, createBoardSceneElement({
    id: "middle", boardId: BOARD, kind: "shape", shapeKind: "service",
    transform: { x: 300, y: 220, width: 300, height: 160, rotation: 0 },
    content: createRichTextDocument("Middle", "middle:content"),
  }));
  const centers = computeSemanticAutoLayout({
    actions: [{ type: "create", nodeType: "service", label: "New", handle: "new_1", placement: { kind: "auto" } }],
    boardState: state,
    canvasWidth: 900,
    canvasHeight: 600,
  });
  const center = centers.get("new_1");
  const inside = center.x > 300 && center.x < 600 && center.y > 220 && center.y < 380;
  assert.equal(inside, false, `placed at ${JSON.stringify(center)}`);
});
