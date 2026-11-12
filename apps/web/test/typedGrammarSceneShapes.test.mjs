import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDiagramCommand,
  applyLegacyDiagramFixture,
  boardDiagramGraph,
  createInitialBoardState,
  richTextToPlainText,
} from "@airboard/core";
import { parseIntentCanvasCommand } from "../src/features/board/intentCanvasParser.ts";
import { resolveIntentOperation } from "../src/features/board/intentPipeline.ts";
import {
  ALL_SHAPES,
  creationToolForPlacementTool,
  legacyToolForCreationTool,
} from "../src/features/board/creationToolCatalog.ts";

// Shape-merge phase 1: the older typed grammar draws v2 shapes only, and its
// edits reach v2 shapes as well as the legacy nodes on older boards.

const BOARD = "typed-grammar-board";
const commandContext = { boardSessionId: BOARD, actorParticipantId: "p", userId: "u" };

function context(boardState, overrides = {}) {
  return {
    boardState,
    pointer: { x: 450, y: 300 },
    canvasWidth: 1200,
    canvasHeight: 800,
    selectionIds: [],
    primarySelectionId: null,
    hoverStrokeId: null,
    strokeColor: "#111827",
    ...overrides,
  };
}

/** Parses and grounds one typed command, applies it, and returns the result. */
function typed(boardState, text, overrides) {
  const parsed = parseIntentCanvasCommand(text, { activationPolicy: "externally_activated" });
  assert.equal(parsed.status, "parsed", `${text}: ${JSON.stringify(parsed)}`);
  const resolution = resolveIntentOperation(parsed.command, context(boardState, overrides));
  assert.ok(!("error" in resolution), `${text}: ${JSON.stringify(resolution)}`);
  const state = resolution.commands.reduce(
    (current, command) => applyDiagramCommand(current, command, commandContext).state,
    boardState,
  );
  return { resolution, state };
}

const labelled = (state) =>
  Object.fromEntries(boardDiagramGraph(state).nodes.map((node) => [node.name, node]));

test("the typed grammar draws v2 shapes and v2 arrows, never strokes", () => {
  let { state } = typed(createInitialBoardState(BOARD), "add a database named Orders");
  ({ state } = typed(state, "add a service named Checkout"));
  ({ state } = typed(state, "connect Checkout to Orders"));
  assert.deepEqual(state.strokes, {});
  const nodes = labelled(state);
  assert.equal(nodes.Orders.kind, "database");
  assert.equal(nodes.Orders.model, "scene");
  const [edge] = boardDiagramGraph(state).edges;
  assert.deepEqual([edge.from, edge.to, edge.attached, edge.model], [nodes.Checkout.id, nodes.Orders.id, true, "scene"]);
});

test("typed edits by name reach v2 shapes", () => {
  let { state } = typed(createInitialBoardState(BOARD), "add a service named Checkout");
  ({ state } = typed(state, "add a database named Orders"));
  const before = labelled(state);
  ({ state } = typed(state, "rename Checkout to Payments"));
  assert.ok(labelled(state).Payments);
  ({ state } = typed(state, "make Payments red"));
  assert.equal(state.elements[before.Checkout.id].style.fill, "#fee2e2");
  ({ state } = typed(state, "make Orders bigger"));
  assert.ok(labelled(state).Orders.bounds.width > before.Orders.bounds.width);
  ({ state } = typed(state, "connect Payments to Orders"));
  ({ state } = typed(state, "delete the connection between Payments and Orders"));
  assert.equal(boardDiagramGraph(state).edges.length, 0);
});

test("typed edits on the selection reach v2 shapes, and select all includes them", () => {
  let { state } = typed(createInitialBoardState(BOARD), "add a service named Checkout");
  const id = labelled(state).Checkout.id;
  const selection = { selectionIds: [id], primarySelectionId: id };
  const startX = labelled(state).Checkout.bounds.x;
  ({ state } = typed(state, "move selected right", selection));
  assert.equal(labelled(state).Checkout.bounds.x, startX + 96);
  const added = typed(state, "add a database named Orders right of selected", selection);
  assert.ok(labelled(added.state).Orders.bounds.x > labelled(state).Checkout.bounds.x, "placed beside the v2 selection");
  const all = typed(added.state, "select all");
  assert.deepEqual([...all.resolution.selectionAfter].sort(), Object.keys(added.state.elements).sort());
  const copied = typed(added.state, "duplicate selected", selection);
  assert.equal(Object.values(copied.state.elements).filter((element) => element.kind === "shape").length, 3);
  assert.deepEqual(copied.state.strokes, {});
});

test("the typed grammar still edits the legacy nodes of an older board", () => {
  let state = applyLegacyDiagramFixture(createInitialBoardState(BOARD), {
    type: "node.create", nodeId: "old", nodeType: "service", label: "Old API", center: { x: 300, y: 300 },
  }, commandContext).state;
  ({ state } = typed(state, "rename Old API to Legacy API"));
  assert.equal(state.strokes.old.annotation.label, "Legacy API");
  ({ state } = typed(state, "add a database named Store"));
  ({ state } = typed(state, "connect Legacy API to Store"));
  const connector = Object.values(state.elements).find((element) => element.kind === "connector" && !element.legacyStrokeId);
  assert.equal(connector.start.binding.elementId, "old", "a v2 arrow from the legacy node");
  assert.equal(Object.keys(state.strokes).length, 1, "no new stroke");
  assert.equal(richTextToPlainText(connector.label), "");
});

test("every older placement tool maps to a toolbar tool that draws the same thing as a v2 object", () => {
  // Guards the deleted legacy placement path: a placement that arrives with
  // only an older tool still places a v2 object.
  for (const tool of ["flow", "service", "database", "queue", "user", "api", "decision", "terminator", "io", "document", "circle", "box"]) {
    const creationTool = creationToolForPlacementTool(tool);
    assert.ok(creationTool?.startsWith("shape:"), tool);
    assert.equal(legacyToolForCreationTool(creationTool), tool, tool);
  }
  assert.equal(creationToolForPlacementTool("note"), "sticky");
  assert.equal(creationToolForPlacementTool("connector"), "connector:bent");
  assert.equal(creationToolForPlacementTool("arrow"), "connector:straight");
  assert.equal(creationToolForPlacementTool("highlight"), "draw:highlighter");
  assert.equal(creationToolForPlacementTool("select"), null);
  assert.ok(ALL_SHAPES.length > 0);
});
