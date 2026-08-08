import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  applyDiagramCommand,
  createInitialBoardState,
} from "@airboard/core";
import {
  createObjectFromPlacement,
  updateLineEndpoint,
} from "../src/features/board/gestureAnnotationMode.ts";

const toolForNode = {
  process: "flow",
  service: "service",
  database: "database",
  queue: "queue",
  user: "user",
  api: "api",
  decision: "decision",
  note: "note",
  terminator: "terminator",
  io: "io",
  document: "document",
  circle: "circle",
  custom: "box",
};

test("every catalog placement uses the registry node type and canonical default size", () => {
  const boardState = createInitialBoardState("board-1");
  for (const capability of AIRBOARD_SEMANTIC_NODE_CAPABILITIES) {
    const result = createObjectFromPlacement({
      tool: toolForNode[capability.nodeType],
      start: { x: 300, y: 200 },
      boardState,
      color: "#2563eb",
      timestampMs: 1,
    });
    assert.ok(result, capability.nodeType);
    assert.equal(result.annotation.nodeType, capability.nodeType);
    assert.deepEqual(
      {
        width: result.annotation.bounds.width,
        height: result.annotation.bounds.height,
      },
      capability.visual.defaultSize,
      capability.nodeType,
    );
    assert.equal(result.annotation.label, capability.defaultLabel);
  }
});

test("manual arrow endpoints use the same node snapping contract as connectors", () => {
  const boardState = applyDiagramCommand(
    createInitialBoardState("board-1"),
    {
      type: "node.create",
      nodeId: "client",
      nodeType: "service",
      label: "Client",
      center: { x: 160, y: 130 },
    },
    { boardSessionId: "board-1", actorParticipantId: "p1", userId: "u" },
  ).state;
  const arrow = {
    type: "arrow",
    source: "gesture",
    start: { x: 20, y: 20 },
    end: { x: 40, y: 40 },
  };
  const snapped = updateLineEndpoint({
    annotation: arrow,
    endpoint: "start",
    point: { x: 160, y: 130 },
    boardState,
    autoSnapConnectors: true,
  });
  assert.equal(snapped.snappedStartStrokeId, "client");
  assert.notDeepEqual(snapped.start, { x: 160, y: 130 });

  const released = updateLineEndpoint({
    annotation: snapped,
    endpoint: "start",
    point: { x: 500, y: 500 },
    boardState,
    autoSnapConnectors: true,
  });
  assert.equal(released.snappedStartStrokeId, undefined);
  assert.deepEqual(released.start, { x: 500, y: 500 });
});
