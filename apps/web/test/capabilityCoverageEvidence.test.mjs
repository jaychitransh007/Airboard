import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
  applyDiagramCommand,
  createInitialBoardState,
} from "@airboard/core";
import {
  resolveIntentOperation,
  resolveSemanticPlanAction,
} from "../src/features/board/intentPipeline.ts";
import {
  parseIntentCanvasCommand,
} from "../src/features/board/intentCanvasParser.ts";

const BOARD_ID = "capability-evidence";
const commandContext = {
  boardSessionId: BOARD_ID,
  actorParticipantId: "participant",
  userId: "user",
};

test("grounds every shipped node type and applies its final graph", () => {
  for (const capability of AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.nodes) {
    let board = createInitialBoardState(`${BOARD_ID}-${capability.nodeType}`);
    const resolution = resolveSemanticPlanAction(
      {
        type: "create",
        nodeType: capability.nodeType,
        label: capability.defaultLabel,
        handle: `created_${capability.nodeType}`,
        placement: { kind: "pointer" },
      },
      groundingContext(board),
      new Map(),
    );
    assert.ok(
      !("error" in resolution),
      `${capability.nodeType}: ${JSON.stringify(resolution)}`,
    );
    assert.equal(resolution.commands.length, 1, capability.nodeType);
    const command = resolution.commands[0];
    assert.equal(command.type, "node.create");
    assert.equal(command.nodeType, capability.nodeType);
    board = applyDiagramCommand(board, command, commandContext).state;
    const committed = Object.values(board.strokes).filter(
      (stroke) =>
        stroke.status === "committed" &&
        stroke.annotation?.nodeType === capability.nodeType,
    );
    assert.equal(committed.length, 1, capability.nodeType);
    assert.deepEqual(committed[0].annotation.bounds, {
      x: 450 - capability.visual.defaultSize.width / 2,
      y: 300 - capability.visual.defaultSize.height / 2,
      ...capability.visual.defaultSize,
    });
  }
});

test("grounds ordinal decision branches and applies their final graph", () => {
  let board = createInitialBoardState(BOARD_ID);
  for (const node of [
    {
      id: "decision",
      nodeType: "decision",
      label: "Approved?",
      bounds: { x: 100, y: 100, width: 120, height: 88 },
    },
    {
      id: "user-one",
      nodeType: "user",
      label: "User One",
      bounds: { x: 400, y: 60, width: 128, height: 104 },
    },
    {
      id: "user-two",
      nodeType: "user",
      label: "User Two",
      bounds: { x: 400, y: 260, width: 128, height: 104 },
    },
  ]) {
    board = applyDiagramCommand(
      board,
      {
        type: "node.create",
        nodeId: node.id,
        nodeType: node.nodeType,
        label: node.label,
        bounds: node.bounds,
        source: "voice",
      },
      commandContext,
    ).state;
  }

  const resolution = resolveSemanticPlanAction(
    {
      type: "branch",
      from: { kind: "type_ordinal", nodeType: "decision", ordinal: 1 },
      branches: [
        {
          to: { kind: "type_ordinal", nodeType: "user", ordinal: 1 },
          label: "yes",
        },
        {
          to: { kind: "type_ordinal", nodeType: "user", ordinal: 2 },
          label: "no",
        },
      ],
    },
    groundingContext(board),
    new Map(),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.equal(resolution.commands.length, 2);
  for (const command of resolution.commands) {
    board = applyDiagramCommand(board, command, commandContext).state;
  }

  const connectors = Object.values(board.strokes)
    .filter(
      (stroke) =>
        stroke.status === "committed" &&
        stroke.annotation?.type === "connector",
    )
    .map((stroke) => ({
      from: stroke.annotation.snappedStartStrokeId,
      to: stroke.annotation.snappedEndStrokeId,
      label: stroke.annotation.label,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  assert.deepEqual(connectors, [
    { from: "decision", to: "user-two", label: "no" },
    { from: "decision", to: "user-one", label: "yes" },
  ]);
});

test("grounds distribution and applies deterministic final geometry", () => {
  let board = createInitialBoardState(BOARD_ID);
  for (const [id, x] of [
    ["a", 0],
    ["b", 250],
    ["c", 600],
  ]) {
    board = applyDiagramCommand(
      board,
      {
        type: "node.create",
        nodeId: id,
        nodeType: "process",
        label: id.toUpperCase(),
        bounds: { x, y: 100, width: 100, height: 60 },
      },
      commandContext,
    ).state;
  }

  const resolution = resolveSemanticPlanAction(
    {
      type: "distribute",
      targets: ["A", "B", "C"].map((label) => ({
        kind: "visible_label",
        label,
        occurrence: null,
      })),
      axis: "horizontal",
    },
    groundingContext(board),
    new Map(),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands, [
    {
      type: "objects.align",
      objectIds: ["a", "b", "c"],
      alignment: "distribute-x",
    },
  ]);
  board = applyDiagramCommand(
    board,
    resolution.commands[0],
    commandContext,
  ).state;
  assert.deepEqual(
    ["a", "b", "c"].map(
      (id) => board.strokes[id].annotation.bounds.x,
    ),
    [0, 300, 600],
  );
});

test("plan handles ground to committed objects and apply their final state", () => {
  let board = applyDiagramCommand(
    createInitialBoardState(BOARD_ID),
    {
      type: "node.create",
      nodeId: "created-in-plan",
      nodeType: "service",
      label: "Service",
      bounds: { x: 100, y: 100, width: 152, height: 80 },
    },
    commandContext,
  ).state;
  const resolution = resolveSemanticPlanAction(
    {
      type: "rename",
      target: { kind: "plan_handle", handle: "created" },
      label: "Checkout",
    },
    groundingContext(board),
    new Map([["created", ["created-in-plan"]]]),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  board = applyDiagramCommand(
    board,
    resolution.commands[0],
    commandContext,
  ).state;
  assert.equal(
    board.strokes["created-in-plan"].annotation.label,
    "Checkout",
  );
});

test("grounds selection and applies its final non-board state", () => {
  const board = applyDiagramCommand(
    createInitialBoardState(BOARD_ID),
    {
      type: "node.create",
      nodeId: "select-me",
      nodeType: "service",
      label: "Checkout",
      bounds: { x: 100, y: 100, width: 152, height: 80 },
    },
    commandContext,
  ).state;
  const resolution = resolveSemanticPlanAction(
    {
      type: "select",
      targets: [
        { kind: "visible_label", label: "Checkout", occurrence: null },
      ],
      mode: "replace",
    },
    groundingContext(board),
    new Map(),
  );
  assert.ok(!("error" in resolution), JSON.stringify(resolution));
  assert.deepEqual(resolution.commands, []);
  assert.deepEqual(resolution.selectionAfter, ["select-me"]);
  assert.equal(board.strokes["select-me"].status, "committed");
});

test("cancel remains an immediate no-mutation terminal result", () => {
  const board = createInitialBoardState(BOARD_ID);
  const before = structuredClone(board);
  const parsed = parseIntentCanvasCommand("never mind", {
    activationPolicy: "externally_activated",
  });
  assert.equal(parsed.status, "parsed");
  assert.deepEqual(parsed.command, { kind: "cancel" });
  assert.deepEqual(
    resolveIntentOperation(parsed.command, groundingContext(board)),
    { error: "This command is handled immediately." },
  );
  assert.deepEqual(board, before);
});

function groundingContext(boardState) {
  return {
    boardState,
    pointer: { x: 450, y: 300 },
    pointerAvailable: true,
    canvasWidth: 900,
    canvasHeight: 600,
    selectionIds: [],
    primarySelectionId: null,
    hoverStrokeId: null,
    strokeColor: "#111111",
  };
}
