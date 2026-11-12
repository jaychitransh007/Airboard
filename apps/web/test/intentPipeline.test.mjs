import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramCommand,
  applyDiagramUndo,
  boardDiagramGraph,
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


const SEED_CONTEXT = { boardSessionId: BOARD_ID, actorParticipantId: "p1", userId: "u" };

/** A board seeded the way Airo draws: node.create with fixed ids and bounds, then nodes.connect. */
function seededBoard(nodes, connectors = []) {
  let state = createInitialBoardState(BOARD_ID);
  for (const { id, label, nodeType = "service", bounds } of nodes) {
    state = applyDiagramCommand(state, { type: "node.create", nodeId: id, nodeType, label, bounds }, SEED_CONTEXT).state;
  }
  for (const { id, from, to, label } of connectors) {
    state = applyDiagramCommand(state, {
      type: "nodes.connect",
      connectorId: id,
      fromId: from,
      toId: to,
      ...(label ? { label } : {}),
    }, SEED_CONTEXT).state;
  }
  return state;
}

function node(id, label, x, extra = {}) {
  return { id, label, bounds: { x, y: 100, width: 120, height: 60 }, ...extra };
}

function attachedEdges(state) {
  return boardDiagramGraph(state).edges
    .filter((edge) => edge.attached)
    .map(({ id, from, to, label }) => ({ id, from, to, label }));
}

test("committed objects and board clears ARE content staleness", () => {
  const base = createInitialBoardState(BOARD_ID);
  // In-flight ink only touches activeStrokes — not content yet.
  const inking = {
    ...base,
    activeStrokes: {
      s1: {
        id: "s1", boardId: BOARD_ID, userId: "u1", color: "#000", thickness: 3,
        status: "active", points: [{ x: 1, y: 1, t: 0 }], createdAt: new Date().toISOString(),
      },
    },
  };
  assert.equal(boardContentChanged(base, inking), false);

  const shaped = applyDiagramCommand(base, {
    type: "node.create", nodeId: "v2", nodeType: "service", label: "API", center: { x: 100, y: 100 },
  }, SEED_CONTEXT).state;
  assert.equal("strokes" in shaped, false);
  assert.equal(boardContentChanged(base, shaped), true);

  const cleared = applyBoardEvent(shaped, {
    ...envelope(),
    type: "board.cleared",
  });
  assert.equal(boardContentChanged(shaped, cleared), true);
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
  const board = seededBoard([
    { id: "n1", label: "No", nodeType: "custom", bounds: { x: 100, y: 100, width: 200, height: 100 } },
  ]);
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
  const board = seededBoard(
    [node("a", "API", 100), node("b", "Database", 400)],
    [{ id: "edge", from: "a", to: "b" }],
  );
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

test("attaching an existing line: every line is bound, so it is already joined or refused", () => {
  const board = seededBoard(
    [node("client", "Client", 100), node("planner", "Planner", 600), node("user", "User", 0, { bounds: { x: 0, y: 400, width: 120, height: 60 } })],
    [{ id: "back", from: "planner", to: "user", label: "responds" }],
  );
  const operation = {
    kind: "attach_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  };

  // "Connect the existing disconnected line from Client to Planner".
  const none = resolveIntentOperation(operation, groundingContext(board));
  assert.deepEqual(none, { error: "No visually disconnected line can be safely attached to those two objects." });

  const selected = resolveIntentOperation(
    { ...operation, endpointOrder: "directed", lineReference: "selected" },
    { ...groundingContext(board), selectionIds: ["back"], primarySelectionId: "back" },
  );
  assert.deepEqual(selected, {
    error: "The selected object is not one uniquely attachable disconnected line. Select the intended line and try again.",
  });
  const pointed = resolveIntentOperation(
    { ...operation, endpointOrder: "directed", lineReference: "pointer" },
    groundingContext(board),
  );
  assert.deepEqual(pointed, {
    error: "The pointed object is not one uniquely attachable disconnected line. Point at the intended line and try again.",
  });

  // A healthy Planner → User line is never taken for a Client → Planner one.
  assert.deepEqual(attachedEdges(board), [{ id: "back", from: "planner", to: "user", label: "responds" }]);

  // An existing join is already what was asked for, in the stated direction
  // or (undirected wording) the other way round.
  const joined = seededBoard(
    [node("client", "Client", 100), node("planner", "Planner", 600)],
    [{ id: "edge", from: "client", to: "planner" }],
  );
  const satisfied = resolveIntentOperation(operation, groundingContext(joined));
  assert.deepEqual(satisfied, { commands: [], selectionAfter: ["client", "planner"], alreadySatisfied: true });
  const reversedWording = resolveIntentOperation(
    { ...operation, from: operation.to, to: operation.from, endpointOrder: "undirected" },
    groundingContext(joined),
  );
  assert.equal(reversedWording.alreadySatisfied, true);
  const directedOtherWay = resolveIntentOperation(
    { ...operation, from: operation.to, to: operation.from, endpointOrder: "directed" },
    groundingContext(joined),
  );
  assert.deepEqual(directedOtherWay, { error: "No visually disconnected line can be safely attached to those two objects." });
});

test("semantic connect relabels the one existing line instead of drawing a second", () => {
  const board = seededBoard(
    [node("client", "Client", 300), node("planner", "Planner", 650)],
    [{ id: "edge", from: "client", to: "planner", label: "calls" }],
  );
  const semantic = resolveSemanticPlanAction({
    type: "connect",
    from: { kind: "visible_label", label: "Client", occurrence: null },
    to: { kind: "visible_label", label: "Planner", occurrence: null },
    label: "request goes to",
  }, { ...groundingContext(board), pointerAvailable: false }, new Map());
  assert.ok(!("error" in semantic), JSON.stringify(semantic));
  assert.deepEqual(semantic.commands, [{ type: "scene.rename", elementId: "edge", label: "request goes to" }]);
});

test("semantic destructive occurrences match the edges advertised to the planner", () => {
  const board = seededBoard(
    [node("client", "Client", 100), node("planner", "Planner", 600)],
    // Deliberately insert ID z before ID a. Context and grounding must share
    // canonical ID ordering rather than relying on object insertion order.
    [
      { id: "z-first", from: "client", to: "planner", label: "second by occurrence" },
      { id: "a-second", from: "client", to: "planner", label: "first by occurrence" },
    ],
  );
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
  assert.deepEqual(resolution.commands, [{ type: "scene.delete", elementIds: ["a-second"] }]);
  const deleted = applyDiagramCommand(board, resolution.commands[0], SEED_CONTEXT);
  assert.equal(deleted.state.elements["a-second"].status, "deleted");
  assert.equal(deleted.state.elements["z-first"].status, "active");
  const undone = applyDiagramUndo(deleted.state, deleted);
  assert.equal(undone.state.elements["a-second"].status, "active");
  assert.deepEqual(attachedEdges(undone.state), attachedEdges(board));
});

test("deterministic relation delete takes the one connector and rejects parallels", () => {
  const base = seededBoard(
    [node("client", "Client", 100), node("planner", "Planner", 600)],
    [{ id: "healthy", from: "client", to: "planner" }],
  );
  const operation = {
    kind: "delete_connection",
    from: { kind: "named", label: "Client", normalizedLabel: "client" },
    to: { kind: "named", label: "Planner", normalizedLabel: "planner" },
  };
  const one = resolveIntentOperation(operation, groundingContext(base));
  assert.ok(!("error" in one), JSON.stringify(one));
  assert.deepEqual(one.commands[0].objectIds, ["healthy"]);
  const deleted = applyDiagramCommand(base, one.commands[0], SEED_CONTEXT);
  assert.equal(deleted.state.elements.healthy.status, "deleted");
  const undone = applyDiagramUndo(deleted.state, deleted).state;
  assert.equal(undone.elements.healthy.status, "active");
  assert.deepEqual(attachedEdges(undone), attachedEdges(base));

  const parallel = applyDiagramCommand(base, {
    type: "nodes.connect", connectorId: "healthy2", fromId: "client", toId: "planner",
  }, SEED_CONTEXT).state;
  const ambiguous = resolveIntentOperation(operation, groundingContext(parallel));
  assert.ok("error" in ambiguous);
  assert.match(ambiguous.error, /more than one attached connector/iu);

  const deleteAll = resolveIntentOperation(
    { ...operation, scope: "all" },
    groundingContext(parallel),
  );
  assert.ok(!("error" in deleteAll), JSON.stringify(deleteAll));
  assert.deepEqual(deleteAll.commands[0].objectIds, ["healthy", "healthy2"]);
  const allDeleted = applyDiagramCommand(parallel, deleteAll.commands[0], SEED_CONTEXT);
  assert.equal(allDeleted.state.elements.healthy.status, "deleted");
  assert.equal(allDeleted.state.elements.healthy2.status, "deleted");
  const allUndone = applyDiagramUndo(allDeleted.state, allDeleted);
  assert.equal(allUndone.state.elements.healthy.status, "active");
  assert.equal(allUndone.state.elements.healthy2.status, "active");
});

test("REGRESSION: reverses the existing edge, adds only the missing edge, and undoes both together", () => {
  const board = seededBoard(
    [
      node("user1", "User 1", 100, { nodeType: "user" }),
      node("user2", "User 2", 400, { nodeType: "user" }),
      node("database", "Database", 700, { nodeType: "database" }),
    ],
    [{ id: "calls", from: "user1", to: "user2", label: "calls" }],
  );
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
    "scene.connector.reverse",
  ]);
  let state = board;
  let undoEvents = [];
  let result = applyDiagramCommand(state, reversed.commands[0], SEED_CONTEXT);
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
  result = applyDiagramCommand(state, connected.commands[0], SEED_CONTEXT);
  state = result.state;
  undoEvents = [...result.undoEvents, ...undoEvents];

  const edges = attachedEdges(state);
  assert.deepEqual(edges.filter((edge) => edge.id === "calls"), [{ id: "calls", from: "user2", to: "user1", label: "calls" }]);
  assert.equal(edges.filter((edge) => edge.from === "user2" && edge.to === "database" && edge.label === "updates").length, 1);
  assert.equal(
    describeSemanticPlan([reverseAction, connectAction]),
    "Reverse User One → User Two and add User Two → Database.",
  );

  const undone = applyDiagramUndo(state, { undoEvents });
  assert.deepEqual(
    attachedEdges(undone.state),
    attachedEdges(board),
    "the original direction is restored and the added edge is removed by the same undo batch",
  );
});

test("semantic connect performs a minimum graph diff instead of adding duplicates", () => {
  const board = seededBoard(
    [node("a", "User 2", 100), node("b", "Database", 400)],
    [{ id: "edge", from: "a", to: "b", label: "updates" }],
  );
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

function datasetNode(id, label, x) {
  return { id, label, nodeType: "database", bounds: { x, y: 100, width: 150, height: 70 } };
}

test("semantic connect safely repairs a uniquely anchored data/dataset label", () => {
  const board = seededBoard([
    datasetNode("historical", "Historical Dataset", 100),
    datasetNode("planner", "Planner", 400),
  ]);
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

test("data/dataset grounding keeps exact precedence and best-guesses ambiguity", () => {
  const nodes = [
    datasetNode("historicalData", "Historical Data", 100),
    datasetNode("historicalDataset", "Historical Dataset", 300),
    datasetNode("planner", "Planner", 600),
  ];
  const board = seededBoard(nodes);
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
  // "Datasets" is the plural of the visible "Dataset", so the partial-name
  // match finds Historical Dataset instead of refusing (gap 6).
  assert.ok(!("error" in ambiguous), JSON.stringify(ambiguous));
  assert.equal(ambiguous.commands[0].fromId, "historicalDataset");
  assert.deepEqual(ambiguous.repairKinds, ["best_guess_reference"]);

  const exactDuplicate = resolveSemanticPlanAction(
    {
      type: "connect",
      from: { kind: "visible_label", label: "Historical Data", occurrence: null },
      to: { kind: "visible_label", label: "Planner", occurrence: null },
      label: "additional context",
    },
    {
      ...groundingContext(seededBoard([...nodes, datasetNode("historicalData2", "Historical Data", 450)])),
      pointerAvailable: false,
    },
    new Map(),
  );
  assert.ok(!("error" in exactDuplicate), JSON.stringify(exactDuplicate));
  assert.ok(["historicalData", "historicalData2"].includes(exactDuplicate.commands[0].fromId));
  assert.deepEqual(exactDuplicate.repairKinds, ["best_guess_reference"]);
});

test("data/dataset repair is additive-only and requires a non-alias anchor", () => {
  const board = seededBoard([
    datasetNode("data", "Dataset", 100),
    datasetNode("historical", "Historical Dataset", 300),
    datasetNode("planner", "Planner", 600),
  ]);
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
  // "Data" matches nothing (the alias needs a non-alias anchor word), so it
  // is a shape the speaker expects to exist: it is created, then connected.
  assert.ok(!("error" in bare), JSON.stringify(bare));
  assert.deepEqual(bare.commands.map(({ type }) => type), ["node.create", "nodes.connect"]);
  assert.equal(bare.commands[0].label, "Data");
  assert.equal(bare.commands[1].fromId, bare.commands[0].nodeId);
  assert.equal(bare.commands[1].toId, "planner");
  assert.deepEqual(bare.repairKinds, ["created_missing_object"]);

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
  let board = seededBoard(
    [
      node("user1", "User 1", 100, { nodeType: "user" }),
      node("user2", "User 2", 400, { nodeType: "user" }),
      node("database", "Database", 700, { nodeType: "database" }),
    ],
    [{ id: "request", from: "user1", to: "user2", label: "request" }],
  );
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
      board = applyDiagramCommand(board, command, SEED_CONTEXT).state;
    }
  }

  assert.deepEqual(commandTypes, ["scene.connector.reverse", "nodes.connect"]);
  const edges = attachedEdges(board);
  assert.deepEqual(edges.filter((edge) => edge.id === "request"), [{ id: "request", from: "user2", to: "user1", label: "request" }]);
  assert.equal(
    edges.filter((edge) => edge.from === "user1" && edge.to === "database" && edge.label === "updates").length,
    1,
  );
});

test("grounds recolor into restyle commands and select_all into pure selection", () => {
  const board = seededBoard([
    { id: "a", label: "API", bounds: { x: 100, y: 100, width: 120, height: 60 } },
    { id: "b", label: "Ledger", bounds: { x: 100, y: 100, width: 120, height: 60 } },
  ]);

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

  const gone = applyDiagramCommand(board, { type: "scene.delete", elementIds: ["b"] }, SEED_CONTEXT).state;
  const remaining = resolveIntentOperation({ kind: "select_all" }, groundingContext(gone));
  assert.deepEqual(remaining.selectionAfter, ["a"], "deleted objects are never selected");

  const empty = resolveIntentOperation(
    { kind: "select_all" },
    groundingContext(createInitialBoardState(BOARD_ID)),
  );
  assert.ok("error" in empty, "empty board fails closed");
});
