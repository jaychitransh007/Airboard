import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  applyDiagramUndo,
  createEventEnvelope,
  createInitialBoardState,
} from "@airboard/core";
import {
  boardContentChanged,
  buildSemanticIntentContext,
  describeSemanticPlan,
  resolveIntentOperation,
  resolveSemanticPlanAction,
} from "../src/features/board/intentPipeline.ts";
import { parseDesiredGraphCorrection } from "../src/features/board/desiredGraphCorrection.ts";

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

test("REGRESSION: reverses the existing edge, adds only the missing edge, and undoes both together", () => {
  let board = createInitialBoardState(BOARD_ID);
  const node = (id, label, nodeType, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType, label,
      bounds: { x, y: 100, width: 120, height: 60 },
    },
  });
  board = {
    ...board,
    strokes: {
      user1: node("user1", "User 1", "user", 100),
      user2: node("user2", "User 2", "user", 400),
      database: node("database", "Database", "database", 700),
      calls: {
        id: "calls", boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
        status: "committed", points: [], createdAt: new Date().toISOString(),
        annotation: {
          type: "connector", source: "voice", label: "calls",
          start: { x: 220, y: 130 }, end: { x: 400, y: 130 },
          snappedStartStrokeId: "user1", snappedEndStrokeId: "user2",
        },
      },
    },
  };
  const before = structuredClone(board);
  assert.deepEqual(
    buildSemanticIntentContext(board, [], false).edges,
    [
      {
        from: { label: "User 1", nodeType: "user", ordinal: 1 },
        to: { label: "User 2", nodeType: "user", ordinal: 2 },
        label: "calls",
        occurrence: 1,
      },
    ],
    "connectors are addressable in semantic context by endpoints, label, and occurrence",
  );
  const semanticContext = {
    ...groundingContext(board),
    pointerAvailable: false,
  };
  const reverseAction = {
    type: "reverse_connection",
    connection: {
      kind: "connection",
      from: { kind: "visible_label", label: "User One", occurrence: null },
      to: { kind: "visible_label", label: "User Two", occurrence: null },
      label: null,
      occurrence: null,
    },
    label: "calls",
  };
  const connectAction = {
    type: "connect",
    from: { kind: "visible_label", label: "User Two", occurrence: null },
    to: { kind: "visible_label", label: "Database", occurrence: null },
    label: "updates",
  };

  const reversed = resolveSemanticPlanAction(reverseAction, semanticContext, new Map());
  assert.ok(!("error" in reversed), JSON.stringify(reversed));
  assert.deepEqual(reversed.commands.map((command) => command.type), [
    "connection.reverse",
  ]);
  let state = board;
  let undoEvents = [];
  let result = applyDiagramCommand(state, reversed.commands[0], {
    boardSessionId: BOARD_ID,
    actorParticipantId: "p1",
    userId: "u",
  });
  state = result.state;
  undoEvents = [...result.undoEvents, ...undoEvents];

  const connected = resolveSemanticPlanAction(
    connectAction,
    { ...semanticContext, boardState: state },
    new Map(),
  );
  assert.ok(!("error" in connected), JSON.stringify(connected));
  assert.deepEqual(connected.commands.map((command) => command.type), [
    "nodes.connect",
  ]);
  result = applyDiagramCommand(state, connected.commands[0], {
    boardSessionId: BOARD_ID,
    actorParticipantId: "p1",
    userId: "u",
  });
  state = result.state;
  undoEvents = [...result.undoEvents, ...undoEvents];

  assert.equal(state.strokes.calls.id, "calls");
  assert.equal(state.strokes.calls.annotation.snappedStartStrokeId, "user2");
  assert.equal(state.strokes.calls.annotation.snappedEndStrokeId, "user1");
  const updatesEdges = Object.values(state.strokes).filter(
    (stroke) =>
      stroke.status === "committed" &&
      stroke.annotation?.snappedStartStrokeId === "user2" &&
      stroke.annotation?.snappedEndStrokeId === "database" &&
      stroke.annotation?.label === "updates",
  );
  assert.equal(updatesEdges.length, 1);
  assert.equal(
    describeSemanticPlan([reverseAction, connectAction]),
    "Reverse User One → User Two and add User Two → Database.",
  );

  const undone = applyDiagramUndo(state, { undoEvents });
  assert.deepEqual(
    undone.state.strokes.calls.annotation,
    before.strokes.calls.annotation,
    "the original connector direction is restored",
  );
  assert.equal(undone.state.strokes.calls.status, "committed");
  assert.deepEqual(undone.state.strokes.user1.annotation, before.strokes.user1.annotation);
  assert.deepEqual(undone.state.strokes.user2.annotation, before.strokes.user2.annotation);
  assert.deepEqual(
    undone.state.strokes.database.annotation,
    before.strokes.database.annotation,
  );
  assert.equal(
    Object.values(undone.state.strokes).filter(
      (stroke) =>
        stroke.annotation?.snappedStartStrokeId === "user2" &&
        stroke.annotation?.snappedEndStrokeId === "database" &&
        stroke.status === "committed",
    ).length,
    0,
    "the added edge is removed by the same undo batch",
  );
});

test("semantic connect performs a minimum graph diff instead of adding duplicates", () => {
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
      a: node("a", "User 2", 100),
      b: node("b", "Database", 400),
      edge: {
        id: "edge", boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
        status: "committed", points: [], createdAt: new Date().toISOString(),
        annotation: {
          type: "connector", source: "voice", label: "updates",
          start: { x: 220, y: 130 }, end: { x: 400, y: 130 },
          snappedStartStrokeId: "a", snappedEndStrokeId: "b",
        },
      },
    },
  };
  const resolution = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "User Two", occurrence: null },
      to: { kind: "visible_label", label: "Database", occurrence: null },
      label: "updates",
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands, []);
});

test("REGRESSION: the reported flowing-request transcript grounds into the intended sequence", () => {
  const plan = parseDesiredGraphCorrection(
    "There are there are two square rectangles for... named as user, user one and user two are there. Currently, request is flowing from user one to user two. It should be reversed. Request should be flowing from user two to user one, and then it updates the database.",
  );
  assert.ok(plan);
  let board = createInitialBoardState(BOARD_ID);
  const node = (id, label, nodeType, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType, label,
      bounds: { x, y: 100, width: 120, height: 60 },
    },
  });
  board = {
    ...board,
    strokes: {
      user1: node("user1", "User 1", "user", 100),
      user2: node("user2", "User 2", "user", 400),
      database: node("database", "Database", "database", 700),
      request: {
        id: "request", boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
        status: "committed", points: [], createdAt: new Date().toISOString(),
        annotation: {
          type: "connector", source: "voice", label: "request",
          start: { x: 220, y: 130 }, end: { x: 400, y: 130 },
          snappedStartStrokeId: "user1", snappedEndStrokeId: "user2",
        },
      },
    },
  };
  const commandTypes = [];
  for (const action of plan.actions) {
    const resolution = resolveSemanticPlanAction(
      action,
      { ...groundingContext(board), pointerAvailable: false },
      new Map(),
    );
    assert.ok(!("error" in resolution), JSON.stringify(resolution));
    for (const command of resolution.commands) {
      commandTypes.push(command.type);
      board = applyDiagramCommand(board, command, {
        boardSessionId: BOARD_ID,
        actorParticipantId: "p1",
        userId: "u",
      }).state;
    }
  }

  assert.deepEqual(commandTypes, ["connection.reverse", "nodes.connect"]);
  assert.equal(board.strokes.request.annotation.snappedStartStrokeId, "user2");
  assert.equal(board.strokes.request.annotation.snappedEndStrokeId, "user1");
  assert.equal(
    Object.values(board.strokes).filter(
      (stroke) =>
        stroke.status === "committed" &&
        stroke.annotation?.snappedStartStrokeId === "user1" &&
        stroke.annotation?.snappedEndStrokeId === "database" &&
        stroke.annotation?.label === "updates",
    ).length,
    1,
  );
});

test("grounds recolor into restyle commands and select_all into pure selection", () => {
  let board = createInitialBoardState(BOARD_ID);
  const node = (id, label) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x: 100, y: 100, width: 120, height: 60 },
    },
  });
  board = { ...board, strokes: { a: node("a", "API"), b: node("b", "Ledger") } };

  const recolor = resolveIntentOperation(
    {
      kind: "recolor_object",
      target: { kind: "named", label: "API", normalizedLabel: "api" },
      color: "red",
    },
    groundingContext(board),
  );
  assert.ok(!("error" in recolor), JSON.stringify(recolor));
  assert.equal(recolor.commands[0].type, "object.restyle");
  assert.equal(recolor.commands[0].fillColor, "#fee2e2");
  assert.equal(recolor.commands[0].strokeColor, "#b91c1c");

  const all = resolveIntentOperation({ kind: "select_all" }, groundingContext(board));
  assert.ok(!("error" in all));
  assert.equal(all.commands.length, 0, "pure selection change — nothing mutates");
  assert.deepEqual([...all.selectionAfter].sort(), ["a", "b"]);

  const empty = resolveIntentOperation(
    { kind: "select_all" },
    groundingContext(createInitialBoardState(BOARD_ID)),
  );
  assert.ok("error" in empty, "empty board fails closed");
});
