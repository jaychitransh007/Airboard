import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  createInitialBoardState,
} from "@airboard/core";
import { createObjectFromPlacement } from "../src/features/board/gestureAnnotationMode.ts";

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
