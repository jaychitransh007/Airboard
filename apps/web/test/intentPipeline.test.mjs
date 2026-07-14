import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  createEventEnvelope,
  createInitialBoardState,
} from "@airboard/core";
import {
  boardContentChanged,
  resolveIntentOperation,
} from "../src/features/board/intentPipeline.ts";

const BOARD_ID = "test-board";

function envelope() {
  return createEventEnvelope({
    boardSessionId: BOARD_ID,
    actorParticipantId: "p1",
  });
}

function groundingContext(boardState) {
  return {
    boardState,
    pointer: { x: 450, y: 300 },
    canvasWidth: 900,
    canvasHeight: 600,
    selectionIds: [],
    primarySelectionId: null,
    hoverStrokeId: null,
    strokeColor: "#111111",
  };
}

test("REGRESSION: cursor churn is not board-content staleness", () => {
  // The bug this encodes: cursor.moved events replace the BoardState object
  // dozens of times per second while a hand is on camera, which used to fail
  // the identity-based staleness check for EVERY semantic round-trip.
  const base = createInitialBoardState(BOARD_ID);
  let churned = base;
  for (let i = 0; i < 120; i += 1) {
    churned = applyBoardEvent(churned, {
      ...envelope(),
      type: "cursor.moved",
      cursor: {
        participantId: "p1",
        x: i,
        y: i,
        mode: "marker_hover",
        updatedAt: new Date().toISOString(),
      },
    });
  }
  assert.notEqual(churned, base, "cursor events do replace the state object");
  assert.equal(
    boardContentChanged(base, churned),
    false,
    "…but they must never count as content changes",
  );
});

test("committed strokes and board clears ARE content staleness", () => {
  const base = createInitialBoardState(BOARD_ID);
  const withStroke = applyBoardEvent(base, {
    ...envelope(),
    type: "stroke.started",
    stroke: {
      id: "s1",
      boardId: BOARD_ID,
      userId: "u1",
      color: "#000",
      thickness: 3,
      status: "active",
      points: [{ x: 1, y: 1, t: 0 }],
      createdAt: new Date().toISOString(),
    },
  });
  // In-flight ink only touches activeStrokes — not content yet.
  assert.equal(boardContentChanged(base, withStroke), false);

  const committed = applyBoardEvent(withStroke, {
    ...envelope(),
    type: "stroke.committed",
    strokeId: "s1",
    points: [{ x: 1, y: 1, t: 0 }],
  });
  assert.equal(boardContentChanged(base, committed), true);

  const cleared = applyBoardEvent(committed, {
    ...envelope(),
    type: "board.cleared",
  });
  assert.equal(boardContentChanged(committed, cleared), true);
});

test("grounds a create operation into a diagram command at the pointer", () => {
  const board = createInitialBoardState(BOARD_ID);
  const resolution = resolveIntentOperation(
    {
      kind: "create_node",
      nodeType: "circle",
      count: 1,
      placement: { direction: "here", relativeTo: { kind: "pointer" } },
    },
    groundingContext(board),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands.length, 1);
  assert.equal(resolution.commands[0].type, "node.create");
  assert.deepEqual(resolution.commands[0].center, { x: 450, y: 300 });
  assert.equal(resolution.selectionAfter.length, 1);
});

test("grounding a selection edit without a selection fails closed", () => {
  const board = createInitialBoardState(BOARD_ID);
  const resolution = resolveIntentOperation(
    { kind: "delete_selection" },
    groundingContext(board),
  );
  assert.ok("error" in resolution, "no selection → grounding error, not a mutation");
});

test("grounds a voice resize into a center-preserving object.resize", () => {
  let board = createInitialBoardState(BOARD_ID);
  board = {
    ...board,
    strokes: {
      n1: {
        id: "n1", boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
        status: "committed", points: [], createdAt: new Date().toISOString(),
        annotation: {
          type: "flow_node", source: "voice", nodeType: "custom", label: "No",
          bounds: { x: 100, y: 100, width: 200, height: 100 },
        },
      },
    },
  };
  const resolution = resolveIntentOperation(
    {
      kind: "resize_object",
      target: { kind: "named", label: "No box", normalizedLabel: "no box" },
      dimension: "height",
      direction: "shrink",
    },
    groundingContext(board),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  const command = resolution.commands[0];
  assert.equal(command.type, "object.resize");
  assert.equal(command.objectId, "n1", "'the No box' resolves the node labeled 'No'");
  assert.equal(command.bounds.width, 200, "width untouched");
  assert.equal(command.bounds.height, 80, "height shrunk 0.8x");
  assert.equal(command.bounds.y, 110, "center preserved");
});

test("grounds delete_connection against endpoint bindings", () => {
  let board = createInitialBoardState(BOARD_ID);
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 },
    },
  });
  board = {
    ...board,
    strokes: {
      a: node("a", "API", 100),
      b: node("b", "Database", 400),
      edge: {
        id: "edge", boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
        status: "committed", points: [], createdAt: new Date().toISOString(),
        annotation: {
          type: "connector", source: "voice",
          start: { x: 220, y: 130 }, end: { x: 400, y: 130 },
          snappedStartStrokeId: "a", snappedEndStrokeId: "b",
        },
      },
    },
  };
  const resolution = resolveIntentOperation(
    {
      kind: "delete_connection",
      from: { kind: "named", label: "Database", normalizedLabel: "database" },
      to: { kind: "named", label: "API", normalizedLabel: "api" },
    },
    groundingContext(board),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands[0].type, "objects.delete");
  assert.deepEqual(resolution.commands[0].objectIds, ["edge"], "order-independent match");

  const missing = resolveIntentOperation(
    {
      kind: "delete_connection",
      from: { kind: "named", label: "API", normalizedLabel: "api" },
      to: { kind: "named", label: "Ledger", normalizedLabel: "ledger" },
    },
    groundingContext(board),
  );
  assert.ok("error" in missing, "unknown endpoint fails closed");
});
