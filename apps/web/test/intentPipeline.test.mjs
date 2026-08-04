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

test("REGRESSION: repairs the unique visually detached line in place", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: {
      type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 },
    },
  });
  const board = {
    ...createInitialBoardState(BOARD_ID),
    strokes: {
      user: node("user", "User", 0),
      client: node("client", "Client", 300),
      planner: node("planner", "Planner", 650),
      healthy: {
        id: "healthy", boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
        status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
        annotation: {
          type: "connector", source: "voice", label: "makes a request",
          start: { x: 120, y: 130 }, end: { x: 300, y: 130 },
          snappedStartStrokeId: "user", snappedEndStrokeId: "client",
        },
      },
      loose: {
        id: "loose", boardId: BOARD_ID, userId: "u", color: "#67e8f9", thickness: 5,
        status: "committed", points: [{ x: 510, y: 230, t: 1 }, { x: 650, y: 130, t: 2 }],
        createdAt: "2026-08-01T00:00:02.000Z",
        annotation: {
          type: "connector", source: "gesture", label: "request goes to",
          strokeColor: "#67e8f9", opacity: 0.8,
          start: { x: 510, y: 230 }, end: { x: 650, y: 130 },
          // Production had logical IDs despite visibly stale geometry.
          snappedStartStrokeId: "client", snappedEndStrokeId: "planner",
        },
      },
    },
  };

  assert.deepEqual(
    buildSemanticIntentContext(board, [], false).edges.map((edge) => edge.label),
    ["makes a request"],
    "stale geometry must not be advertised as a satisfied edge",
  );
  const resolution = resolveIntentOperation(
    {
      kind: "attach_connection",
      from: { kind: "named", label: "Client", normalizedLabel: "client" },
      to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
    },
    groundingContext(board),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands, [{
    type: "connection.attach",
    connectorId: "loose",
    fromId: "client",
    toId: "planner",
  }]);

  const semantic = resolveSemanticPlanAction({
    type: "connect",
    from: { kind: "visible_label", label: "Client", occurrence: null },
    to: { kind: "visible_label", label: "Planner", occurrence: null },
    label: "request goes to",
  }, { ...groundingContext(board), pointerAvailable: false }, new Map());
  assert.ok(!("error" in semantic), JSON.stringify(semantic));
  assert.deepEqual(
    semantic.commands.map((command) => command.type),
    ["connection.attach"],
    "semantic fallback repairs stale geometry instead of claiming idempotent success",
  );

  const before = structuredClone(board.strokes.loose);
  const applied = applyDiagramCommand(board, resolution.commands[0], {
    boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u",
  });
  assert.deepEqual(applied.events.map((event) => event.type), ["stroke.annotation_updated"]);
  assert.equal(applied.state.strokes.loose.id, "loose");
  assert.equal(applied.state.strokes.loose.annotation.label, "request goes to");
  assert.equal(applied.state.strokes.loose.annotation.strokeColor, "#67e8f9");
  assert.equal(applied.state.strokes.loose.thickness, 5);
  assert.deepEqual(applied.state.strokes.loose.annotation.start, { x: 420, y: 130 });
  assert.deepEqual(applied.state.strokes.loose.annotation.end, { x: 650, y: 130 });
  const undone = applyDiagramUndo(applied.state, applied);
  assert.deepEqual(undone.state.strokes.loose.annotation, before.annotation);
  assert.deepEqual(undone.state.strokes.loose.points, before.points);
});

test("disconnected-line grounding fails closed when candidates are ambiguous", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const line = (id, y) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "connector", source: "gesture",
      start: { x: 300, y }, end: { x: 500, y } },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100), planner: node("planner", "Planner", 600),
    loose1: line("loose1", 250), loose2: line("loose2", 300),
  } };
  const resolution = resolveIntentOperation({
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  }, groundingContext(board));
  assert.ok("error" in resolution);
  assert.match(resolution.error, /more than one disconnected line/iu);
});

test("selected and pointed disconnected-line references never fall back to a global line", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100), planner: node("planner", "Planner", 600),
    loose: {
      id: "loose", boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
      status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
      annotation: { type: "connector", source: "gesture",
        start: { x: 340, y: 260 }, end: { x: 500, y: 260 } },
    },
  } };
  const operation = {
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
    endpointOrder: "directed",
  };

  const selectedMissing = resolveIntentOperation(
    { ...operation, lineReference: "selected" },
    groundingContext(board),
  );
  assert.ok("error" in selectedMissing);
  assert.match(selectedMissing.error, /selected object is not/iu);

  const pointedMissing = resolveIntentOperation(
    { ...operation, lineReference: "pointer" },
    groundingContext(board),
  );
  assert.ok("error" in pointedMissing);
  assert.match(pointedMissing.error, /pointed object is not/iu);

  const selected = resolveIntentOperation(
    { ...operation, lineReference: "selected" },
    { ...groundingContext(board), selectionIds: ["loose"], primarySelectionId: "loose" },
  );
  assert.ok(!("error" in selected), JSON.stringify(selected));
  assert.equal(selected.commands[0].connectorId, "loose");

  const pointed = resolveIntentOperation(
    { ...operation, lineReference: "pointer" },
    { ...groundingContext(board), hoverStrokeId: "loose" },
  );
  assert.ok(!("error" in pointed), JSON.stringify(pointed));
  assert.equal(pointed.commands[0].connectorId, "loose");
});

test("disconnected-line grounding never steals a healthy mismatched connector", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    user: node("user", "User", 0),
    client: node("client", "Client", 300),
    planner: node("planner", "Planner", 650),
    healthy: {
      id: "healthy", boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
      status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
      annotation: {
        type: "connector", source: "voice", label: "request goes to",
        start: { x: 120, y: 130 }, end: { x: 650, y: 130 },
        snappedStartStrokeId: "user", snappedEndStrokeId: "planner",
      },
    },
  } };

  const resolution = resolveIntentOperation({
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  }, groundingContext(board));
  assert.ok("error" in resolution, "a healthy User→Planner edge is not a loose line");
  assert.match(resolution.error, /no visually disconnected line/iu);
  assert.deepEqual(board.strokes.healthy.annotation, {
    type: "connector", source: "voice", label: "request goes to",
    start: { x: 120, y: 130 }, end: { x: 650, y: 130 },
    snappedStartStrokeId: "user", snappedEndStrokeId: "planner",
  });
});

test("valid noncanonical connector faces remain attached and do not duplicate", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100),
    planner: node("planner", "Planner", 600),
    edge: {
      id: "edge", boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
      status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
      annotation: {
        type: "connector", source: "gesture", label: "request goes to",
        // These are valid manual attachments on different node faces, even
        // though they are not the canonical center-to-center anchor points.
        start: { x: 160, y: 100 }, end: { x: 660, y: 160 },
        snappedStartStrokeId: "client", snappedEndStrokeId: "planner",
      },
    },
  } };

  assert.equal(
    buildSemanticIntentContext(board, [], false).edges.length,
    1,
    "an endpoint on any valid node face remains a grounded edge",
  );
  const resolution = resolveIntentOperation({
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  }, groundingContext(board));
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.alreadySatisfied, true);
  assert.deepEqual(resolution.commands, []);
});

test("undirected attachment preserves a healthy endpoint and still repairs a loose parallel line", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100),
    planner: node("planner", "Planner", 600),
    alreadyAttached: {
      id: "alreadyAttached", boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
      status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
      annotation: {
        type: "connector", source: "voice", label: "existing relation",
        start: { x: 220, y: 130 }, end: { x: 600, y: 130 },
        snappedStartStrokeId: "client", snappedEndStrokeId: "planner",
      },
    },
    loose: {
      id: "loose", boardId: BOARD_ID, userId: "u", color: "#67e8f9", thickness: 4,
      status: "committed", points: [], createdAt: "2026-08-01T00:00:02.000Z",
      annotation: {
        type: "arrow", source: "gesture", label: "response",
        // The line's tail is already attached to Planner. Symmetric wording
        // must retain that direction and attach its loose head to Client.
        start: { x: 600, y: 130 }, end: { x: 360, y: 280 },
        snappedStartStrokeId: "planner",
      },
    },
  } };

  const resolution = resolveIntentOperation({
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
    endpointOrder: "undirected",
  }, groundingContext(board));
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.alreadySatisfied, undefined);
  assert.deepEqual(resolution.commands, [{
    type: "connection.attach",
    connectorId: "loose",
    fromId: "planner",
    toId: "client",
  }]);

  const applied = applyDiagramCommand(board, resolution.commands[0], {
    boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u",
  });
  assert.equal(applied.state.strokes.loose.annotation.type, "arrow");
  assert.equal(applied.state.strokes.loose.annotation.snappedStartStrokeId, "planner");
  assert.equal(applied.state.strokes.loose.annotation.snappedEndStrokeId, "client");
  assert.equal(applied.state.strokes.alreadyAttached.status, "committed");
});

test("semantic destructive occurrences match the healthy edges advertised to the planner", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const connector = (id, label, start, end) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
    annotation: { type: "connector", source: "voice", label, start, end,
      snappedStartStrokeId: "client", snappedEndStrokeId: "planner" },
  });
  const board = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100), planner: node("planner", "Planner", 600),
    // Deliberately insert ID z before ID a. Context and grounding must share
    // canonical ID ordering rather than relying on object insertion order.
    "z-first": connector("z-first", "second by occurrence", { x: 220, y: 130 }, { x: 600, y: 130 }),
    "m-stale": connector("m-stale", "not advertised", { x: 420, y: 300 }, { x: 600, y: 130 }),
    "a-second": connector("a-second", "first by occurrence", { x: 220, y: 130 }, { x: 600, y: 130 }),
  } };
  const semanticContext = buildSemanticIntentContext(board, [], false);
  assert.deepEqual(
    semanticContext.edges.map(({ label, occurrence }) => ({ label, occurrence })),
    [
      { label: "first by occurrence", occurrence: 1 },
      { label: "second by occurrence", occurrence: 2 },
    ],
  );

  const resolution = resolveSemanticPlanAction({
    type: "delete_connection",
    connection: {
      kind: "connection",
      from: { kind: "visible_label", label: "Client", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: null,
      occurrence: 1,
    },
  }, { ...groundingContext(board), pointerAvailable: false }, new Map());
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands[0].objectIds, ["a-second"]);
  const deleted = applyDiagramCommand(board, resolution.commands[0], {
    boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u",
  });
  assert.equal(deleted.state.strokes["a-second"].status, "deleted");
  assert.equal(deleted.state.strokes["m-stale"].status, "committed");
  assert.equal(deleted.state.strokes["z-first"].status, "committed");
  const undone = applyDiagramUndo(deleted.state, deleted);
  assert.equal(undone.state.strokes["a-second"].status, "committed");
  assert.deepEqual(
    undone.state.strokes["a-second"].annotation,
    board.strokes["a-second"].annotation,
  );
  assert.deepEqual(
    undone.state.strokes["a-second"].points,
    board.strokes["a-second"].points,
  );
});

test("deterministic relation delete excludes stale bindings and rejects healthy parallels", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:00.000Z",
    annotation: { type: "flow_node", source: "voice", nodeType: "service", label,
      bounds: { x, y: 100, width: 120, height: 60 } },
  });
  const connector = (id, start) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#fff", thickness: 3,
    status: "committed", points: [], createdAt: "2026-08-01T00:00:01.000Z",
    annotation: { type: "connector", source: "voice", start, end: { x: 600, y: 130 },
      snappedStartStrokeId: "client", snappedEndStrokeId: "planner" },
  });
  const base = { ...createInitialBoardState(BOARD_ID), strokes: {
    client: node("client", "Client", 100), planner: node("planner", "Planner", 600),
    stale: connector("stale", { x: 420, y: 300 }),
    healthy: connector("healthy", { x: 220, y: 130 }),
  } };
  const operation = {
    kind: "delete_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  };
  const one = resolveIntentOperation(operation, groundingContext(base));
  assert.ok(!("error" in one), JSON.stringify(one));
  assert.deepEqual(one.commands[0].objectIds, ["healthy"]);
  const deleted = applyDiagramCommand(base, one.commands[0], {
    boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u",
  });
  assert.equal(deleted.state.strokes.healthy.status, "deleted");
  assert.equal(deleted.state.strokes.stale.status, "committed");
  const undone = applyDiagramUndo(deleted.state, deleted).state.strokes.healthy;
  assert.equal(undone.status, "committed");
  assert.deepEqual(undone.annotation, base.strokes.healthy.annotation);
  assert.deepEqual(undone.points, base.strokes.healthy.points);

  const parallel = { ...base, strokes: {
    ...base.strokes,
    healthy2: connector("healthy2", { x: 220, y: 130 }),
  } };
  const ambiguous = resolveIntentOperation(operation, groundingContext(parallel));
  assert.ok("error" in ambiguous);
  assert.match(ambiguous.error, /more than one attached connector/iu);

  const deleteAll = resolveIntentOperation(
    { ...operation, scope: "all" },
    groundingContext(parallel),
  );
  assert.ok(!("error" in deleteAll), JSON.stringify(deleteAll));
  assert.deepEqual(deleteAll.commands[0].objectIds, ["healthy", "healthy2"]);
  const allDeleted = applyDiagramCommand(parallel, deleteAll.commands[0], {
    boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u",
  });
  assert.equal(allDeleted.state.strokes.healthy.status, "deleted");
  assert.equal(allDeleted.state.strokes.healthy2.status, "deleted");
  assert.equal(allDeleted.state.strokes.stale.status, "committed");
  const allUndone = applyDiagramUndo(allDeleted.state, allDeleted);
  assert.equal(allUndone.state.strokes.healthy.status, "committed");
  assert.equal(allUndone.state.strokes.healthy2.status, "committed");
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
          start: { x: 187.49090909090907, y: 130 },
          end: { x: 432.50909090909096, y: 130 },
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

test("semantic connect safely repairs a uniquely anchored data/dataset label", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType: "database", label,
      bounds: { x, y: 100, width: 150, height: 70 },
    },
  });
  const board = {
    ...createInitialBoardState(BOARD_ID),
    strokes: {
      historical: node("historical", "Historical Dataset", 100),
      planner: node("planner", "Planner", 400),
    },
  };
  const resolution = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "Historical Data", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands.map((command) => command.type), [
    "nodes.connect",
  ]);
  assert.deepEqual(resolution.repairKinds, ["data_dataset_alias"]);
});

test("data/dataset grounding keeps exact precedence and fails closed on ambiguity", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType: "database", label,
      bounds: { x, y: 100, width: 150, height: 70 },
    },
  });
  const board = {
    ...createInitialBoardState(BOARD_ID),
    strokes: {
      historicalData: node("historicalData", "Historical Data", 100),
      historicalDataset: node("historicalDataset", "Historical Dataset", 300),
      planner: node("planner", "Planner", 600),
    },
  };
  const exact = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "Historical Data", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok(!("error" in exact), JSON.stringify(exact));
  assert.equal(exact.commands[0].fromId, "historicalData");
  assert.equal(exact.repairKinds, undefined);

  const ambiguous = resolveSemanticPlanAction(
    {
      type: "connect",
      from: {
        kind: "visible_label",
        label: "Historical Datasets",
        occurrence: null,
      },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok("error" in ambiguous);
  assert.equal(ambiguous.errorCode, "grounding_ambiguous_label");
  assert.equal(ambiguous.candidateCount, 2);

  const exactDuplicate = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "Historical Data", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    {
      ...groundingContext({
        ...board,
        strokes: {
          ...board.strokes,
          historicalData2: node(
            "historicalData2",
            "Historical Data",
            450,
          ),
        },
      }),
      pointerAvailable: false,
    },
    new Map(),
  );
  assert.ok("error" in exactDuplicate);
  assert.equal(exactDuplicate.errorCode, "grounding_ambiguous_label");
  assert.equal(exactDuplicate.candidateCount, 2);
});

test("data/dataset repair is additive-only and requires a non-alias anchor", () => {
  const node = (id, label, x) => ({
    id, boardId: BOARD_ID, userId: "u", color: "#000", thickness: 3,
    status: "committed", points: [], createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node", source: "voice", nodeType: "database", label,
      bounds: { x, y: 100, width: 150, height: 70 },
    },
  });
  const board = {
    ...createInitialBoardState(BOARD_ID),
    strokes: {
      data: node("data", "Dataset", 100),
      historical: node("historical", "Historical Dataset", 300),
      planner: node("planner", "Planner", 600),
    },
  };
  const bare = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "Data", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok("error" in bare);
  assert.equal(bare.errorCode, "grounding_missing_label");

  const destructive = resolveSemanticPlanAction(
    {
      type: "delete",
      targets: [
        {
          kind: "visible_label",
          label: "Historical Data",
          occurrence: null,
        },
      ],
    },
    { ...groundingContext(board), pointerAvailable: false },
    new Map(),
  );
  assert.ok("error" in destructive);
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
          start: { x: 187.49090909090907, y: 130 },
          end: { x: 432.50909090909096, y: 130 },
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
