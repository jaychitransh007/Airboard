import assert from "node:assert/strict";
import test from "node:test";

import { createBoardSceneElement, createInitialBoardState } from "@airboard/core";
import { HybridGestureController } from "@airboard/gesture-engine";

import {
  buildGestureMoveTargets,
  isHandTargetableSceneElement,
  resolveHandConnectorEnds,
} from "../src/features/board/gestureObjectManipulation.ts";

function selectedNodeBoard() {
  const board = createInitialBoardState("gesture-board");
  board.elements.node = createBoardSceneElement({
    id: "node",
    boardId: board.boardId,
    kind: "shape",
    shapeKind: "process",
    transform: { x: 450, y: 210, width: 100, height: 80, rotation: 0 },
  });
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

function sceneShape(board, id, x, y, extra = {}) {
  board.elements[id] = createBoardSceneElement({
    id,
    boardId: board.boardId,
    kind: "shape",
    shapeKind: "square",
    transform: { x, y, width: 100, height: 80, rotation: 0 },
    ...extra,
  });
  return board.elements[id];
}

test("hands target v2 scene elements made by commands, the toolbar and the dock", () => {
  const board = selectedNodeBoard();
  sceneShape(board, "api", 100, 100);
  board.elements.note = createBoardSceneElement({
    id: "note",
    boardId: board.boardId,
    kind: "sticky",
    transform: { x: 700, y: 100, width: 160, height: 160, rotation: 0 },
  });
  board.elements.link = createBoardSceneElement({
    id: "link",
    boardId: board.boardId,
    kind: "connector",
    transform: { x: 200, y: 140, width: 500, height: 1, rotation: 0 },
    start: { point: { x: 200, y: 140 }, binding: { elementId: "api", anchor: "auto" }, decoration: "none" },
    end: { point: { x: 700, y: 140 }, binding: { elementId: "note", anchor: "auto" }, decoration: "solid_arrow" },
  });
  // Sections are containers a closed hand would grab by accident.
  board.elements.section = createBoardSceneElement({
    id: "section",
    boardId: board.boardId,
    kind: "section",
    transform: { x: 0, y: 0, width: 1000, height: 600, rotation: 0 },
  });

  const ids = buildGestureMoveTargets(board).map((target) => target.id);
  assert.deepEqual([...new Set(ids)].sort(), ["api", "link", "node", "note"]);
  assert.equal(ids.filter((id) => id === "node").length, 1);
  assert.equal(isHandTargetableSceneElement(board, board.elements.node), true);
  assert.equal(isHandTargetableSceneElement(board, board.elements.api), true);
  assert.equal(isHandTargetableSceneElement(board, board.elements.section), false);
  assert.equal(isHandTargetableSceneElement(board, board.elements.missing), false);
});

test("members of a hidden or collapsed section are not hand targets", () => {
  const board = createInitialBoardState("gesture-board");
  for (const [id, extra] of [["hidden-section", { visible: false }], ["collapsed-section", { collapsed: true }]]) {
    board.elements[id] = createBoardSceneElement({
      id,
      boardId: board.boardId,
      kind: "section",
      transform: { x: 0, y: 0, width: 1000, height: 600, rotation: 0 },
      ...extra,
    });
  }
  sceneShape(board, "in-hidden", 100, 100, { sectionId: "hidden-section" });
  sceneShape(board, "in-collapsed", 300, 100, { sectionId: "collapsed-section" });
  sceneShape(board, "loose", 500, 100);
  assert.deepEqual(buildGestureMoveTargets(board).map((target) => target.id), ["loose"]);
});

test("hidden or deleted scene elements are not hand targets", () => {
  const board = createInitialBoardState("gesture-board");
  sceneShape(board, "hidden", 100, 100, { visible: false });
  sceneShape(board, "gone", 300, 100);
  board.elements.gone = { ...board.elements.gone, status: "deleted" };
  assert.deepEqual(buildGestureMoveTargets(board), []);
});

test("closing a hand over a toolbar shape grabs it", () => {
  const board = createInitialBoardState("gesture-board");
  sceneShape(board, "api", 450, 210);
  const output = controller().update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    grabConfidence: 1,
    pinchStrength: 0.95,
    timestampMs: 0,
    targets: buildGestureMoveTargets(board),
  });
  assert.equal(output.action?.type, "grab_started");
  assert.equal(output.action?.targetId, "api");
});

test("a connector dragged from shape A to shape B attaches A→B", () => {
  const board = createInitialBoardState("gesture-board");
  sceneShape(board, "a", 100, 100);
  sceneShape(board, "b", 500, 100);
  const ends = resolveHandConnectorEnds(board, {
    mode: "drag",
    from: { x: 150, y: 140 },
    to: { x: 540, y: 150 },
  });
  assert.equal(ends.start.binding?.elementId, "a");
  assert.equal(ends.end.binding?.elementId, "b");
  assert.deepEqual(ends.start.point, { x: 200, y: 140 }, "start sits on A's edge facing B");
  assert.deepEqual(ends.end.point, { x: 500, y: 140 });
});

test("a connector released between two shapes joins them in reading order", () => {
  const board = createInitialBoardState("gesture-board");
  sceneShape(board, "right", 500, 100);
  sceneShape(board, "left", 100, 100);
  const ends = resolveHandConnectorEnds(board, {
    mode: "drop",
    from: { x: 350, y: 140 },
    to: { x: 350, y: 140 },
  });
  assert.equal(ends.start.binding?.elementId, "left");
  assert.equal(ends.end.binding?.elementId, "right");
});

test("a connector released over a shape ends there, starting from its nearest neighbour", () => {
  const board = createInitialBoardState("gesture-board");
  sceneShape(board, "a", 100, 100);
  sceneShape(board, "b", 500, 100);
  sceneShape(board, "far", 2_000, 2_000);
  const ends = resolveHandConnectorEnds(board, {
    mode: "drop",
    from: { x: 540, y: 140 },
    to: { x: 540, y: 140 },
  });
  assert.equal(ends.start.binding?.elementId, "a");
  assert.equal(ends.end.binding?.elementId, "b");
});

test("a connector dropped on empty board stays a loose line where the hand let go", () => {
  const board = createInitialBoardState("gesture-board");
  const ends = resolveHandConnectorEnds(board, {
    mode: "drop",
    from: { x: 300, y: 300 },
    to: { x: 300, y: 300 },
  });
  assert.equal(ends.start.binding, undefined);
  assert.equal(ends.end.binding, undefined);
  assert.deepEqual(ends.start.point, { x: 210, y: 300 });
  assert.deepEqual(ends.end.point, { x: 390, y: 300 });
});
