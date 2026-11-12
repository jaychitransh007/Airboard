import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  applyLegacyDiagramFixture,
  createBoardSceneElement,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  richTextToPlainText,
} from "@airboard/core";
import { semanticBoardNodes as semanticBoardNodesForTest } from "../src/features/board/semanticBoardObjects.ts";
import {
  groundSemanticPlan,
  resolveSemanticPlanAction,
} from "../src/features/board/intentPipeline.ts";

// Hands-free gaps 6, 10 and 12: Airo applies a best guess instead of asking,
// can make the edits a presenter names out loud, and keeps the good steps of
// a plan when one step can't be matched.

const BOARD = "grounding-board";

function at(isoSecond) {
  return { boardSessionId: BOARD, actorParticipantId: "p", userId: "u", createdAt: `2026-11-11T10:00:${isoSecond}.000Z` };
}

// Airo's nodes on a board saved before it drew v2 shapes: legacy strokes,
// which must stay reachable by name. (Shapes Airo draws now are v2, as
// toolbar shapes are: see sceneShape and the plan-created objects below.)
function node(state, nodeId, label, x, second, nodeType = "service", y = 100) {
  return applyLegacyDiagramFixture(
    state,
    { type: "node.create", nodeId, nodeType, label, center: { x, y }, source: "voice" },
    at(second),
  ).state;
}

function sceneShape(state, id, label, x, shapeKind = "square") {
  return applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: BOARD, actorParticipantId: "p" }),
    type: "element.created",
    element: createBoardSceneElement({
      id, boardId: BOARD, kind: "shape", shapeKind,
      transform: { x, y: 300, width: 120, height: 80, rotation: 0 },
      content: createRichTextDocument(label, `${id}:content`),
    }),
  });
}

function context(boardState, overrides = {}) {
  return {
    boardState,
    pointer: { x: 450, y: 300 },
    pointerAvailable: false,
    canvasWidth: 1200,
    canvasHeight: 800,
    selectionIds: [],
    primarySelectionId: null,
    hoverStrokeId: null,
    strokeColor: "#111111",
    ...overrides,
  };
}

const named = (label) => ({ kind: "visible_label", label, occurrence: null });
const resolve = (state, action, overrides) => resolveSemanticPlanAction(action, context(state, overrides), new Map());
const apply = (state, commands) =>
  commands.reduce((current, command) => applyDiagramCommand(current, command, at("59")).state, state);

function twoServices() {
  let state = createInitialBoardState(BOARD);
  state = node(state, "payments", "Payments Service", 200, "01");
  state = node(state, "auth", "Auth Service", 500, "02");
  return state;
}

test("a name that fits several objects picks the selected one, else the newest", () => {
  const state = twoServices();
  const selected = resolve(state, { type: "delete", targets: [named("service")] }, { selectionIds: ["payments"], primarySelectionId: "payments" });
  assert.ok(!("error" in selected), JSON.stringify(selected));
  assert.deepEqual(selected.commands[0].objectIds, ["payments"]);

  const newest = resolve(state, { type: "delete", targets: [named("service")] });
  assert.ok(!("error" in newest), JSON.stringify(newest));
  assert.deepEqual(newest.commands[0].objectIds, ["auth"], "Auth Service was created last");
});

test("a type word finds an object of that type, and 'it' with nothing selected is the newest", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "orders", "Orders", 200, "01", "database");
  state = node(state, "api", "Gateway", 500, "02", "api");
  const byType = resolve(state, { type: "rename", target: named("the database"), label: "Orders DB" });
  assert.ok(!("error" in byType), JSON.stringify(byType));
  assert.equal(byType.commands[0].objectId, "orders");

  const pronoun = resolve(state, { type: "rename", target: { kind: "current_selection" }, label: "Edge" });
  assert.ok(!("error" in pronoun), JSON.stringify(pronoun));
  assert.equal(pronoun.commands[0].objectId, "api");
});

test("connecting to a shape that isn't there creates it, shaped from its name", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  const resolution = resolve(state, { type: "connect", from: named("User"), to: named("cache"), label: null });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands.map(({ type }) => type), ["node.create", "nodes.connect"]);
  const [create, connect] = resolution.commands;
  assert.equal(create.label, "Cache");
  assert.equal(create.nodeType, "database");
  assert.equal(create.shapeKind, "horizontal-cylinder");
  assert.equal(connect.fromId, "user");
  assert.equal(connect.toId, create.nodeId);
  assert.deepEqual(resolution.repairKinds, ["created_missing_object"]);

  const after = apply(state, resolution.commands);
  assert.equal(after.strokes[create.nodeId], undefined, "the new shape is a v2 shape");
  assert.equal(after.elements[create.nodeId].shapeKind, "horizontal-cylinder");
  assert.equal(after.elements[connect.connectorId].start.binding.elementId, "user", "its arrow starts at the older legacy node");
  assert.ok(create.center.x > 200, "the new shape sits beside the user, not on top of it");
});

test("create draws a catalogue shape, and an unmet pointer placement falls back to a free spot", () => {
  const state = createInitialBoardState(BOARD);
  const resolution = resolve(state, {
    type: "create", nodeType: "custom", shape: "cloud", label: "CDN", handle: "cdn", placement: { kind: "pointer" },
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands[0].shapeKind, "cloud");
  const after = apply(state, resolution.commands);
  assert.deepEqual(after.strokes, {}, "Airo draws v2 shapes only");
  assert.equal(after.elements[resolution.commands[0].nodeId].shapeKind, "cloud");
});

test("change type works on Airo's nodes and on toolbar shapes", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "review", "Review", 200, "01", "process");
  state = sceneShape(state, "box", "Check", 500);
  const resolution = resolve(state, {
    type: "change_type", targets: [named("Review"), named("Check")], nodeType: "decision", shape: null,
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands.map(({ type }) => type), ["object.retype", "scene.retype"]);
  const after = apply(state, resolution.commands);
  assert.equal(after.strokes.review.annotation.nodeType, "decision");
  assert.equal(after.strokes.review.annotation.label, "Review", "the label stays");
  assert.equal(after.elements.box.shapeKind, "diamond");
});

test("resize makes legacy and toolbar shapes bigger around their centers", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "api", "API", 200, "01", "api");
  state = sceneShape(state, "box", "Box", 500);
  const before = state.strokes.api.annotation.bounds;
  const resolution = resolve(state, { type: "resize", targets: [named("API"), named("Box")], change: "bigger" });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands.map(({ type }) => type), ["object.resize", "scene.resize"]);
  const after = apply(state, resolution.commands);
  const bounds = after.strokes.api.annotation.bounds;
  assert.ok(bounds.width > before.width);
  assert.equal(Math.round(bounds.x + bounds.width / 2), Math.round(before.x + before.width / 2));
  assert.equal(after.elements.box.transform.width, 150);
});

test("connectors can be labelled and dashed by naming their ends", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  state = node(state, "api", "API", 600, "02", "api");
  state = applyLegacyDiagramFixture(state, { type: "nodes.connect", connectorId: "edge", fromId: "user", toId: "api" }, at("03")).state;
  const connection = { kind: "connection", from: named("User"), to: named("API"), label: null, occurrence: null };

  const labelled = resolve(state, { type: "label_connection", connection, label: "login" });
  assert.ok(!("error" in labelled), JSON.stringify(labelled));
  state = apply(state, labelled.commands);
  assert.equal(state.strokes.edge.annotation.label, "login");

  const dashed = resolve(state, { type: "style_connection", connection, lineStyle: "dashed" });
  assert.ok(!("error" in dashed), JSON.stringify(dashed));
  state = apply(state, dashed.commands);
  assert.equal(state.strokes.edge.annotation.lineStyle, "dashed");
  assert.equal(state.elements.edge.style.strokeStyle, "dashed", "the v2 mirror is dashed too");

  const solid = resolve(state, { type: "style_connection", connection, lineStyle: "solid" });
  state = apply(state, solid.commands);
  assert.equal(state.strokes.edge.annotation.lineStyle, undefined);
});

test("v2 connectors take labels and dash styles through scene commands", () => {
  let state = createInitialBoardState(BOARD);
  state = sceneShape(state, "a", "Web", 100);
  state = sceneShape(state, "b", "Store", 500);
  state = applyDiagramCommand(state, { type: "scene.connect", connectorId: "line", fromId: "a", toId: "b" }, at("03")).state;
  const connection = { kind: "connection", from: named("Web"), to: named("Store"), label: null, occurrence: null };
  const dotted = resolve(state, { type: "style_connection", connection, lineStyle: "dotted" });
  assert.deepEqual(dotted.commands.map(({ type }) => type), ["scene.connector.restyle"]);
  state = apply(state, dotted.commands);
  assert.equal(state.elements.line.style.strokeStyle, "dotted");
  const labelled = resolve(state, { type: "label_connection", connection, label: "writes" });
  state = apply(state, labelled.commands);
  assert.equal(richTextToPlainText(state.elements.line.label), "writes");
});

test("labelling an arrow that doesn't exist draws it with the label", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  state = node(state, "api", "API", 600, "02", "api");
  const resolution = resolve(state, {
    type: "label_connection",
    connection: { kind: "connection", from: named("User"), to: named("API"), label: null, occurrence: null },
    label: "login",
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands[0].type, "nodes.connect");
  assert.equal(resolution.commands[0].label, "login");
});

test("several parallel connectors: the newest is the one meant", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  state = node(state, "api", "API", 600, "02", "api");
  state = applyLegacyDiagramFixture(state, { type: "nodes.connect", connectorId: "old", fromId: "user", toId: "api", label: "requests" }, at("03")).state;
  state = applyLegacyDiagramFixture(state, { type: "nodes.connect", connectorId: "new", fromId: "user", toId: "api", label: "requests" }, at("04")).state;
  const resolution = resolve(state, {
    type: "delete_connection",
    connection: { kind: "connection", from: named("User"), to: named("API"), label: "requests", occurrence: null },
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands[0].objectIds, ["new"]);
});

test("tree layout follows the arrows from the root down", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "root", "Root", 600, "01", "service", 500);
  state = node(state, "left", "Left", 100, "02", "service", 100);
  state = node(state, "right", "Right", 900, "03", "service", 100);
  for (const [id, to] of [["e1", "left"], ["e2", "right"]]) {
    state = applyLegacyDiagramFixture(state, { type: "nodes.connect", connectorId: id, fromId: "root", toId: to }, at("04")).state;
  }
  const resolution = resolve(state, {
    type: "layout", targets: [named("Root"), named("Left"), named("Right")], direction: "tree",
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  const after = apply(state, resolution.commands);
  const center = (id) => {
    const bounds = after.strokes[id].annotation.bounds;
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  };
  assert.ok(center("root").y < center("left").y, "the root is above its children");
  assert.equal(center("left").y, center("right").y, "siblings share a row");
  assert.ok(center("left").x < center("root").x && center("root").x < center("right").x);
});

test("radial layout keeps the hub and rings the spokes around it", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "hub", "API", 600, "01", "api", 400);
  state = node(state, "a", "Auth", 100, "02", "service", 100);
  state = node(state, "b", "Billing", 300, "03", "service", 100);
  state = sceneShape(state, "c", "Search", 500);
  const resolution = resolve(state, {
    type: "layout", targets: [named("API"), named("Auth"), named("Billing"), named("Search")], direction: "radial",
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.ok(resolution.commands.some(({ type }) => type === "scene.move"), "toolbar shapes move through scene commands");
  const after = apply(state, resolution.commands);
  const hub = after.strokes.hub.annotation.bounds;
  assert.deepEqual(hub, state.strokes.hub.annotation.bounds, "the hub stays put");
  const hubCenter = { x: hub.x + hub.width / 2, y: hub.y + hub.height / 2 };
  const distances = ["a", "b"].map((id) => {
    const bounds = after.strokes[id].annotation.bounds;
    return Math.round(Math.hypot(bounds.x + bounds.width / 2 - hubCenter.x, bounds.y + bounds.height / 2 - hubCenter.y));
  });
  const search = after.elements.c.transform;
  distances.push(Math.round(Math.hypot(search.x + search.width / 2 - hubCenter.x, search.y + search.height / 2 - hubCenter.y)));
  assert.equal(new Set(distances).size, 1, `every spoke is the same distance from the hub: ${distances}`);
});

const applyCommand = (state, command) => {
  const result = applyDiagramCommand(state, command, at("30"));
  return { state: result.state, affectedStrokeIds: result.affectedStrokeIds };
};

function plan(boardState, actions, overrides = {}, extra = {}) {
  return groundSemanticPlan({ actions, context: context(boardState, overrides), applyCommand, ...extra });
}

test("a plan keeps its good steps and reports the one it couldn't match", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  const result = plan(state, [
    { type: "create", nodeType: "api", shape: null, label: "API", handle: "api", placement: { kind: "auto" } },
    { type: "connect", from: named("User"), to: { kind: "plan_handle", handle: "api" }, label: "calls" },
    { type: "rename", target: named("Zebra"), label: "Horse" },
    { type: "create", nodeType: "database", shape: null, label: "Orders", handle: "db", placement: { kind: "auto" } },
  ]);
  assert.equal(result.status, "grounded", JSON.stringify(result));
  assert.equal(result.appliedActionCount, 3);
  assert.deepEqual(result.skipped.map(({ index, actionType, errorCode }) => [index, actionType, errorCode]), [
    [2, "rename", "grounding_missing_label"],
  ]);
  assert.ok(result.skipped[0].reason.length > 0);
  assert.deepEqual(result.commands.map(({ type }) => type), ["node.create", "nodes.connect", "node.create"]);
  assert.equal(semanticBoardNodesForTest(result.previewState).length, 3);
});

test("a plan is rejected when a left-out step is one later steps build on", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  const result = plan(state, [
    { type: "group", targets: [named("Nothing Here")], label: "Edge", handle: "edge" },
    { type: "move", targets: [{ kind: "plan_handle", handle: "edge" }], placement: { kind: "canvas_region", region: "left" } },
  ]);
  assert.equal(result.status, "rejected");
  assert.equal(result.skipped[0].actionType, "group");
});

test("steps past the change limit are skipped, not the whole plan", () => {
  const state = createInitialBoardState(BOARD);
  const create = (handle) => ({ type: "create", nodeType: "process", shape: null, label: handle, handle, placement: { kind: "auto" } });
  const result = plan(state, [create("one"), create("two"), create("three")], {}, { maxCommands: 2 });
  assert.equal(result.status, "grounded");
  assert.equal(result.appliedActionCount, 2);
  assert.deepEqual(result.skipped.map(({ index, errorCode }) => [index, errorCode]), [[2, "command_limit"]]);
});

test("a step whose change fails leaves nothing half-applied", () => {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  let calls = 0;
  const result = groundSemanticPlan({
    actions: [
      { type: "rename", target: named("User"), label: "Customer" },
      { type: "create", nodeType: "api", shape: null, label: "API", handle: "api", placement: { kind: "auto" } },
    ],
    context: context(state),
    applyCommand: (current, command) => {
      calls += 1;
      if (command.type === "object.rename") throw new Error("That label can't be changed.");
      return applyCommand(current, command);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "grounded");
  assert.deepEqual(result.skipped.map(({ errorCode }) => errorCode), ["command_failed"]);
  assert.equal(result.previewState.strokes.user.annotation.label, "User");
});

test("a plan with nothing that can apply is rejected with the reason", () => {
  const state = createInitialBoardState(BOARD);
  const result = plan(state, [{ type: "rename", target: named("Ghost"), label: "Spirit" }]);
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /Ghost/);
});

test("a guessed name is reported with the step", () => {
  const state = twoServices();
  const guessed = resolve(state, { type: "rename", target: named("service"), label: "Gateway" });
  assert.deepEqual(guessed.repairKinds, ["best_guess_reference"]);
  const exact = resolve(state, { type: "rename", target: named("Auth Service"), label: "Gateway" });
  assert.equal(exact.repairKinds, undefined);
});

function userApiEdge(label) {
  let state = createInitialBoardState(BOARD);
  state = node(state, "user", "User", 200, "01", "user");
  state = node(state, "api", "API", 600, "02", "api");
  state = node(state, "cache", "Cache", 900, "04", "database");
  return applyLegacyDiagramFixture(
    state,
    { type: "nodes.connect", connectorId: "edge", fromId: "user", toId: "api", ...(label ? { label } : {}) },
    at("03"),
  ).state;
}

test("'this' with only a connector selected deletes the connector, never the newest shape", () => {
  const state = userApiEdge();
  const deleted = resolve(state, { type: "delete", targets: [{ kind: "current_selection" }] }, { selectionIds: ["edge"], primarySelectionId: "edge" });
  assert.ok(!("error" in deleted), JSON.stringify(deleted));
  assert.deepEqual(deleted.commands.map(({ type }) => type), ["objects.delete"]);
  assert.deepEqual(deleted.commands[0].objectIds, ["edge"]);

  // A step that can't take a connector is skipped rather than aimed at Cache.
  const resized = resolve(state, { type: "resize", targets: [{ kind: "current_selection" }], change: "bigger" }, { selectionIds: ["edge"], primarySelectionId: "edge" });
  assert.ok("error" in resized, JSON.stringify(resized));
  const renamed = resolve(state, { type: "rename", target: { kind: "current_selection" }, label: "X" }, { selectionIds: ["edge"], primarySelectionId: "edge" });
  assert.ok("error" in renamed, JSON.stringify(renamed));
});

test("'this' whose selection vanished while Airo was planning is skipped, not guessed", () => {
  const state = userApiEdge();
  // The rebase dropped the selected shape; the request-time selection held it.
  const gone = resolve(state, { type: "delete", targets: [{ kind: "current_selection" }] }, { selectionIds: [], requestSelectionIds: ["deleted-shape"] });
  assert.ok("error" in gone, JSON.stringify(gone));
  const goneIds = resolve(state, { type: "change_type", targets: [{ kind: "current_selection" }], nodeType: "decision", shape: null }, { selectionIds: ["deleted-shape"] });
  assert.ok("error" in goneIds, JSON.stringify(goneIds));
  // Nothing selected at all still means the shape just made.
  const newest = resolve(state, { type: "delete", targets: [{ kind: "current_selection" }] });
  assert.deepEqual(newest.commands[0].objectIds, ["cache"]);
});

test("a connector with a clearly different label is never taken for a misheard one", () => {
  const state = userApiEdge("logout");
  const connection = (label) => ({ kind: "connection", from: named("User"), to: named("API"), label, occurrence: null });
  for (const action of [
    { type: "delete_connection", connection: connection("login") },
    { type: "reverse_connection", connection: connection("login"), label: null },
    { type: "style_connection", connection: connection("payment"), lineStyle: "dashed" },
    { type: "label_connection", connection: connection("payment"), label: "pays" },
  ]) {
    const resolution = resolve(state, action);
    assert.ok("error" in resolution, `${action.type}: ${JSON.stringify(resolution)}`);
  }
  // A near match is a mishearing.
  const near = resolve(state, { type: "delete_connection", connection: connection("log out") });
  assert.deepEqual(near.commands[0].objectIds, ["edge"]);
  const typo = resolve(userApiEdge("requests"), { type: "delete_connection", connection: connection("request") });
  assert.deepEqual(typo.commands[0].objectIds, ["edge"]);
  // The only connector, unlabelled, is the one meant.
  const unlabelled = resolve(userApiEdge(), { type: "delete_connection", connection: connection("login") });
  assert.deepEqual(unlabelled.commands[0].objectIds, ["edge"]);
});

test("labelling the arrow between two shapes finds it whichever way it points", () => {
  const state = userApiEdge();
  const resolution = resolve(state, {
    type: "label_connection",
    connection: { kind: "connection", from: named("API"), to: named("User"), label: null, occurrence: null },
    label: "login",
  });
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands.map(({ type }) => type), ["object.rename"]);
  assert.equal(resolution.commands[0].objectId, "edge");
  const after = apply(state, resolution.commands);
  const connectors = Object.values(after.strokes).filter((stroke) => stroke.annotation?.type === "connector");
  assert.equal(connectors.length, 1, "no second, opposing arrow");
});

test("a plural name changes every object it fits, a singular one only the best guess", () => {
  const state = twoServices();
  const plural = resolve(state, { type: "delete", targets: [named("the services")] });
  assert.ok(!("error" in plural), JSON.stringify(plural));
  assert.deepEqual([...plural.commands[0].objectIds].sort(), ["auth", "payments"]);
  const singular = resolve(state, { type: "delete", targets: [named("the service")] });
  assert.deepEqual(singular.commands[0].objectIds, ["auth"]);
  // A name that is plural on the board itself still means one object.
  let orders = createInitialBoardState(BOARD);
  orders = node(orders, "o1", "Orders Service", 200, "01");
  orders = node(orders, "o2", "Orders DB", 500, "02", "database");
  const named1 = resolve(orders, { type: "delete", targets: [named("orders")] });
  assert.equal(named1.commands[0].objectIds.length, 1);
});
