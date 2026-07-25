import assert from "node:assert/strict";
import test from "node:test";

import { createInitialBoardState } from "@airboard/core";
import { HybridGestureController } from "@airboard/gesture-engine";

import {
  buildGestureManipulationTargets,
  estimatePrecisionResizePinch,
  parseGestureHandleTargetId,
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

function controller(areaCursorRadiusPx) {
  return new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx,
    stickyReleaseRadiusPx: areaCursorRadiusPx * 2,
    pinch: {
      engageThreshold: 0.7,
      releaseThreshold: 0.4,
      engageDebounceMs: 0,
      releaseDebounceMs: 0,
    },
  });
}

test("move and resize controllers receive disjoint target sets", () => {
  const board = selectedNodeBoard();
  const moveTargets = buildGestureManipulationTargets(board, "node", "move");
  const resizeTargets = buildGestureManipulationTargets(board, "node", "resize");

  assert.deepEqual(moveTargets.map((target) => target.id), ["node"]);
  assert.equal(resizeTargets.length, 4);
  assert.ok(resizeTargets.every((target) => target.id.startsWith("handle:node:")));
  assert.deepEqual(
    parseGestureHandleTargetId("handle:node:nw"),
    { strokeId: "node", handle: "nw" },
  );
  assert.equal(parseGestureHandleTargetId("node"), null);
});

test("a fist moves from a corner while a precision pinch resizes that corner", () => {
  const board = selectedNodeBoard();
  const moveTargets = buildGestureManipulationTargets(board, "node", "move");
  const resizeTargets = buildGestureManipulationTargets(board, "node", "resize");
  const input = {
    handPoint: { x: 0.45, y: 0.42 },
    trackingConfidence: 1,
    grabConfidence: 1,
    timestampMs: 0,
  };

  const fistMove = controller(40).update({
    ...input,
    pinchStrength: 0.95,
    targets: moveTargets,
  });
  const fistResize = controller(12).update({
    ...input,
    pinchStrength: 0,
    targets: resizeTargets,
  });
  assert.equal(fistMove.action?.type, "grab_started");
  assert.equal(fistMove.action?.targetId, "node");
  assert.equal(fistResize.action, null);

  const pinchMove = controller(40).update({
    ...input,
    pinchStrength: 0.1,
    targets: moveTargets,
  });
  const pinchResize = controller(12).update({
    ...input,
    pinchStrength: 0.95,
    targets: resizeTargets,
  });
  assert.equal(pinchMove.action, null);
  assert.equal(pinchResize.action?.type, "grab_started");
  assert.equal(pinchResize.action?.targetId, "handle:node:nw");
});

test("precision resize rejects a closed fist even when thumb and index are close", () => {
  const landmarks = Array.from({ length: 21 }, () => null);
  landmarks[4] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[8] = { x: 0.51, y: 0.5, z: 0 };
  const baseGrab = {
    strength: 0,
    confidence: 1,
    handScale: 0.2,
    observedFingers: 4,
  };

  assert.ok(
    estimatePrecisionResizePinch(landmarks, {
      ...baseGrab,
      fingerScores: { index: 0.4, middle: 0.08, ring: 0.1, pinky: 0.12 },
    }) > 0.9,
    "thumb/index pinch with three open support fingers is a resize",
  );
  assert.equal(
    estimatePrecisionResizePinch(landmarks, {
      ...baseGrab,
      strength: 0.95,
      fingerScores: { index: 0.9, middle: 0.85, ring: 0.9, pinky: 0.88 },
    }),
    0,
    "a closed hand can only move, never resize",
  );
});
