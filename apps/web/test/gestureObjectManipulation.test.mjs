import assert from "node:assert/strict";
import test from "node:test";

import { createInitialBoardState } from "@airboard/core";
import { HybridGestureController } from "@airboard/gesture-engine";

import {
  buildGestureMoveTargets,
  resolveResizeHandleForInput,
} from "../src/features/board/gestureObjectManipulation.ts";

function selectedNodeBoard() {
  const board = createInitialBoardState("gesture-board");
  board.strokes.node = {
    id: "node",
    boardId: board.boardId,
    userId: "user",
    color: "#fff",
    thickness: 3,
    status: "committed",
    points: [],
    createdAt: new Date().toISOString(),
    annotation: {
      type: "flow_node",
      source: "gesture",
      nodeType: "process",
      label: "Process",
      bounds: { x: 450, y: 210, width: 100, height: 80 },
    },
  };
  return board;
}

function controller() {
  return new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 40,
    stickyReleaseRadiusPx: 80,
    pinch: {
      engageThreshold: 0.7,
      releaseThreshold: 0.4,
      engageDebounceMs: 0,
      releaseDebounceMs: 0,
    },
  });
}

test("camera targeting exposes object bodies without resize handles", () => {
  const targets = buildGestureMoveTargets(selectedNodeBoard());

  assert.deepEqual(targets.map((target) => target.id), ["node"]);
  assert.ok(targets.every((target) => !target.id.startsWith("handle:")));
});

test("camera input cannot resolve a resize handle even when one is selected", () => {
  assert.equal(resolveResizeHandleForInput("air_gesture", "nw", "se"), null);
  assert.equal(resolveResizeHandleForInput("pointer", undefined, "se"), "se");
  assert.equal(resolveResizeHandleForInput("pointer", "nw", "se"), "nw");
});

test("closing a hand on empty canvas cannot begin a lasso or mutate the board", () => {
  const gesture = controller();
  const input = {
    handPoint: { x: 0.2, y: 0.2 },
    trackingConfidence: 1,
    grabConfidence: 1,
    pinchStrength: 0.95,
    targets: [],
  };

  const closed = gesture.update({ ...input, timestampMs: 0 });
  const dragged = gesture.update({
    ...input,
    handPoint: { x: 0.8, y: 0.8 },
    timestampMs: 100,
  });

  assert.equal(closed.action, null);
  assert.equal(closed.grabbedTargetId, null);
  assert.equal(dragged.action, null);
  assert.equal(dragged.grabbedTargetId, null);
});

test("closing a hand over an object can still move that object", () => {
  const targets = buildGestureMoveTargets(selectedNodeBoard());
  const output = controller().update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    grabConfidence: 1,
    pinchStrength: 0.95,
    timestampMs: 0,
    targets,
  });

  assert.equal(output.action?.type, "grab_started");
  assert.equal(output.action?.targetId, "node");
});
