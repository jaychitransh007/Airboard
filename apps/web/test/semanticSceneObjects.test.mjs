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
import { computeSemanticAutoLayout } from "../src/features/board/semanticAutoLayout.ts";

// RGB-039: Airo must see, and change, the shapes typed commands and the
// toolbar make (v2 scene elements), not only its own legacy nodes.

const BOARD = "scene-board";
const commandContext = { boardSessionId: BOARD, actorParticipantId: "participant", userId: "user" };

function created(state, element) {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: BOARD, actorParticipantId: "participant" }),
    type: "element.created",
    element,
  });
}

/** User and API from typed commands, joined by a toolbar connector, plus Airo's own Database. */
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
    hoverStrokeId: null,
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
  assert.equal(resolution.commands[0].type, "scene.connect");
  const next = applyDiagramCommand(state, resolution.commands[0], commandContext).state;
  const connectors = Object.values(next.elements).filter((element) => element.kind === "connector" && element.status === "active" && !element.legacyStrokeId);
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

  const mixedDelete = resolve(state, { type: "delete", targets: [label("API"), label("Database")] });
  assert.deepEqual(mixedDelete.commands, [
    { type: "objects.delete", objectIds: ["db"] },
    { type: "scene.delete", elementIds: ["api"] },
  ]);

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

test("Airo says plainly what it can't do to typed shapes yet, rather than guessing", () => {
  const resolution = resolve(mixedBoard(), { type: "align", targets: [label("User"), label("API")], alignment: "top" });
  assert.match(resolution.error, /can't align shapes added from the toolbar or with typed commands yet/);
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
