import assert from "node:assert/strict";
import test from "node:test";

import { estimatePalmPresentation } from "@airboard/gesture-engine";

import { selectSingleLandmarkPose } from "../src/features/board/landmarkPoseSelection.ts";
import { PalmVoiceGestureTracker } from "../src/features/board/palmVoiceGestureTracker.ts";

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

test("raw rotated open-palm swipe motion cannot activate a command gesture", () => {
  const tracker = new PalmVoiceGestureTracker();
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
  assert.equal(update(0.1, 80), null);
  assert.equal(update(0.22, 180), null);
  assert.equal(update(0.3, 260), null);
  assert.equal(tracker.engaged, false);
});

test("raw rotated open-palm landmarks held still activate and release Voice once", () => {
  const tracker = new PalmVoiceGestureTracker();
  const base = rotate(openPalm(), -Math.PI / 3);
  const update = (timestampMs, landmarks = base) => {
    const pose = selectSingleLandmarkPose(
      landmarks ? [detectedHand(landmarks)] : [],
      estimatePalmPresentation,
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
  assert.equal(update(700), null, "a held palm cannot activate twice");
  assert.equal(update(800, null), null);
  assert.equal(update(1_150, null), "release");
});
