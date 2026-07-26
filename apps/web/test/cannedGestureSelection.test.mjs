import assert from "node:assert/strict";
import test from "node:test";

import { selectSingleCannedGesture } from "../src/features/board/cannedGestureSelection.ts";

function hand(name, score = 0.91) {
  return {
    handedness: "right",
    handednessScore: 0.99,
    landmarks: Array.from({ length: 21 }, (_, index) => ({
      x: index === 0 ? 0.42 : 0.5,
      y: index === 0 ? 0.63 : 0.5,
      z: 0,
    })),
    cannedGesture: { name, score },
  };
}

test("Victory is routed only to the Victory action", () => {
  const hands = [hand("Victory", 0.94)];

  assert.deepEqual(selectSingleCannedGesture(hands, "Victory"), {
    score: 0.94,
    point: { x: 0.42, y: 0.63 },
    trackedHands: 1,
  });
  assert.deepEqual(selectSingleCannedGesture(hands, "Open_Palm"), {
    score: 0,
    point: null,
    trackedHands: 1,
  });
});

test("Open_Palm cannot enter the Victory voice action", () => {
  const hands = [hand("Open_Palm", 0.96)];

  assert.deepEqual(selectSingleCannedGesture(hands, "Open_Palm"), {
    score: 0.96,
    point: { x: 0.42, y: 0.63 },
    trackedHands: 1,
  });
  assert.deepEqual(selectSingleCannedGesture(hands, "Victory"), {
    score: 0,
    point: null,
    trackedHands: 1,
  });
});

test("zero, partial, or multiple hands cannot activate either action", () => {
  assert.deepEqual(selectSingleCannedGesture([], "Victory"), {
    score: 0,
    point: null,
    trackedHands: 0,
  });
  assert.deepEqual(
    selectSingleCannedGesture(
      [{ ...hand("Victory"), landmarks: [{ x: 0.5, y: 0.5, z: 0 }] }],
      "Victory",
    ),
    { score: 0, point: null, trackedHands: 0 },
  );
  assert.deepEqual(
    selectSingleCannedGesture([hand("Victory"), hand("Victory")], "Victory"),
    { score: 0, point: null, trackedHands: 2 },
  );
});
