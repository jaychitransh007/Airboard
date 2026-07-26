import assert from "node:assert/strict";
import test from "node:test";

import {
  estimatePalmPresentation,
  estimateVictoryPresentation,
} from "@airboard/gesture-engine";

import { selectSingleLandmarkPose } from "../src/features/board/landmarkPoseSelection.ts";
import { UndoGestureTracker } from "../src/features/board/undoGestureTracker.ts";
import { VictoryVoiceGestureTracker } from "../src/features/board/victoryVoiceGestureTracker.ts";

function landmarkArray(entries) {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.6,
    z: 0,
  }));
  for (const [index, point] of Object.entries(entries)) {
    landmarks[Number(index)] = point;
  }
  return landmarks;
}

function openPalm() {
  const entries = {
    0: { x: 0.5, y: 0.8, z: 0 },
    1: { x: 0.43, y: 0.75, z: 0 },
    2: { x: 0.4, y: 0.7, z: 0 },
    3: { x: 0.37, y: 0.65, z: 0 },
    4: { x: 0.34, y: 0.6, z: 0 },
  };
  for (const [mcp, pip, dip, tip, x] of [
    [5, 6, 7, 8, 0.41],
    [9, 10, 11, 12, 0.47],
    [13, 14, 15, 16, 0.53],
    [17, 18, 19, 20, 0.59],
  ]) {
    entries[mcp] = { x, y: 0.62, z: 0 };
    entries[pip] = { x, y: 0.5, z: 0 };
    entries[dip] = { x, y: 0.43, z: 0 };
    entries[tip] = { x, y: 0.36, z: 0 };
  }
  return landmarkArray(entries);
}

function victoryHand() {
  return landmarkArray({
    0: { x: 0.5, y: 0.84, z: 0 },
    1: { x: 0.43, y: 0.77, z: 0 },
    2: { x: 0.4, y: 0.72, z: 0 },
    3: { x: 0.38, y: 0.67, z: 0 },
    4: { x: 0.36, y: 0.62, z: 0 },
    5: { x: 0.43, y: 0.64, z: 0 },
    6: { x: 0.4, y: 0.51, z: 0 },
    7: { x: 0.38, y: 0.4, z: 0 },
    8: { x: 0.36, y: 0.29, z: 0 },
    9: { x: 0.48, y: 0.62, z: 0 },
    10: { x: 0.49, y: 0.48, z: 0 },
    11: { x: 0.51, y: 0.36, z: 0 },
    12: { x: 0.54, y: 0.25, z: 0 },
    13: { x: 0.54, y: 0.64, z: 0 },
    14: { x: 0.55, y: 0.58, z: 0 },
    15: { x: 0.56, y: 0.64, z: 0 },
    16: { x: 0.55, y: 0.7, z: 0 },
    17: { x: 0.6, y: 0.67, z: 0 },
    18: { x: 0.61, y: 0.61, z: 0 },
    19: { x: 0.62, y: 0.67, z: 0 },
    20: { x: 0.61, y: 0.73, z: 0 },
  });
}

function detectedHand(landmarks) {
  return {
    handedness: "right",
    handednessScore: 0.96,
    landmarks,
  };
}

function translate(landmarks, dx, dy = 0) {
  return landmarks.map((point) => ({
    ...point,
    x: point.x + dx,
    y: point.y + dy,
  }));
}

function rotate(landmarks, angle, center = { x: 0.5, y: 0.58 }) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return landmarks.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      ...point,
      x: center.x + dx * cosine - dy * sine,
      y: center.y + dx * sine + dy * cosine,
    };
  });
}

test("raw rotated open-palm landmarks followed by a visible left swipe emit one Undo", () => {
  const tracker = new UndoGestureTracker();
  const base = rotate(openPalm(), Math.PI / 2);
  const update = (dx, timestampMs) => {
    const pose = selectSingleLandmarkPose(
      [detectedHand(translate(base, dx))],
      estimatePalmPresentation,
    );
    assert.ok(pose.score >= 0.68, `open-palm score ${pose.score}`);
    return tracker.update({
      score: pose.score,
      point: pose.point,
      timestampMs,
      suppressed: false,
    });
  };

  assert.equal(update(0, 0), null);
  assert.equal(update(0.1, 80), "tracking");
  assert.equal(update(0.22, 180), "undo");
  assert.equal(update(0.3, 260), null, "the same held palm cannot fire twice");
});

test("raw rotated Victory landmarks held still activate and release Voice once", () => {
  const tracker = new VictoryVoiceGestureTracker();
  const base = rotate(victoryHand(), -Math.PI / 3);
  const update = (timestampMs, landmarks = base) => {
    const pose = selectSingleLandmarkPose(
      landmarks ? [detectedHand(landmarks)] : [],
      estimateVictoryPresentation,
    );
    return tracker.update({
      score: pose.score,
      point: pose.point,
      timestampMs,
      suppressed: false,
    });
  };

  assert.equal(update(0), null);
  assert.equal(update(200), null);
  assert.equal(update(399), null);
  assert.equal(update(400), "activate");
  assert.equal(update(700), null, "a held V cannot activate twice");
  assert.equal(update(800, null), null);
  assert.equal(update(1_150, null), "release");
});

test("Open Palm and Victory landmark definitions are mutually exclusive", () => {
  const palm = openPalm();
  const victory = victoryHand();

  assert.ok(estimatePalmPresentation(palm).score >= 0.68);
  assert.equal(estimateVictoryPresentation(palm).score, 0);
  assert.ok(estimateVictoryPresentation(victory).score >= 0.72);
  assert.equal(estimatePalmPresentation(victory).score, 0);
});
