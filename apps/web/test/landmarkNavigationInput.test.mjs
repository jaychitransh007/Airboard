import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNavigationTracker } from "../src/features/board/canvasNavigationTracker.ts";
import {
  collectLandmarkNavigationHands,
  shouldReserveLandmarkNavigation,
} from "../src/features/board/landmarkNavigationInput.ts";

const MAPPING = {
  canvasWidth: 1_000,
  canvasHeight: 600,
  sourceWidth: 1_000,
  sourceHeight: 600,
  fitMode: "cover",
  mirrorInput: true,
  sensitivity: 1,
};

function point(x, y, z = 0) {
  return { x, y, z };
}

function openHandLandmarks() {
  return [
    point(0.5, 0.9),
    point(0.43, 0.78),
    point(0.35, 0.68),
    point(0.28, 0.6),
    point(0.2, 0.55),
    point(0.42, 0.67),
    point(0.4, 0.48),
    point(0.39, 0.34),
    point(0.38, 0.2),
    point(0.5, 0.64),
    point(0.5, 0.42),
    point(0.5, 0.27),
    point(0.5, 0.12),
    point(0.58, 0.67),
    point(0.6, 0.49),
    point(0.61, 0.36),
    point(0.62, 0.23),
    point(0.66, 0.72),
    point(0.69, 0.57),
    point(0.71, 0.46),
    point(0.73, 0.35),
  ];
}

function closedFistLandmarks() {
  return [
    point(0.5, 0.9),
    point(0.43, 0.78),
    point(0.39, 0.7),
    point(0.47, 0.67),
    point(0.56, 0.69),
    point(0.42, 0.67),
    point(0.4, 0.54),
    point(0.43, 0.61),
    point(0.47, 0.68),
    point(0.5, 0.64),
    point(0.5, 0.5),
    point(0.52, 0.58),
    point(0.52, 0.68),
    point(0.58, 0.67),
    point(0.6, 0.54),
    point(0.58, 0.61),
    point(0.56, 0.69),
    point(0.66, 0.72),
    point(0.68, 0.6),
    point(0.64, 0.65),
    point(0.6, 0.72),
  ];
}

function detectedHand(landmarks, handedness) {
  return {
    handedness,
    handednessScore: 0.96,
    landmarks,
  };
}

function translate(landmarks, dx, dy = 0) {
  return landmarks.map((landmark) => ({
    ...landmark,
    x: landmark.x + dx,
    y: landmark.y + dy,
  }));
}

function pair(factory, leftOffset, rightOffset) {
  return [
    detectedHand(translate(factory(), leftOffset), "left"),
    detectedHand(translate(factory(), rightOffset), "right"),
  ];
}

test("two raw closed-hand landmark streams engage Zoom and preserve distance motion", () => {
  const tracker = new CanvasNavigationTracker();
  const initial = collectLandmarkNavigationHands(
    pair(closedFistLandmarks, -0.25, 0.15),
    MAPPING,
  );
  assert.equal(initial.length, 2);
  assert.ok(initial.every((hand) => hand.grabStrength >= 0.68));

  assert.deepEqual(tracker.update({ hands: initial, timestampMs: 0 }), {
    mode: "idle",
  });
  assert.equal(tracker.reserving, true);
  assert.deepEqual(tracker.update({ hands: initial, timestampMs: 150 }), {
    mode: "idle",
  });
  assert.equal(tracker.mode, "zoom");

  const spread = collectLandmarkNavigationHands(
    pair(closedFistLandmarks, -0.3, 0.2),
    MAPPING,
  );
  const update = tracker.update({ hands: spread, timestampMs: 200 });
  assert.equal(update.mode, "zoom");
  assert.ok(update.factor > 1.2, `zoom factor ${update.factor}`);
});

test("two raw open-hand landmark streams engage Pan and preserve shared motion", () => {
  const tracker = new CanvasNavigationTracker();
  const initial = collectLandmarkNavigationHands(
    pair(openHandLandmarks, -0.25, 0.15),
    MAPPING,
  );
  assert.equal(initial.length, 2);
  assert.ok(initial.every((hand) => hand.grabStrength <= 0.35));

  tracker.update({ hands: initial, timestampMs: 0 });
  tracker.update({ hands: initial, timestampMs: 150 });
  assert.equal(tracker.mode, "pan");

  const moved = collectLandmarkNavigationHands(
    pair(openHandLandmarks, -0.2, 0.2),
    MAPPING,
  );
  const update = tracker.update({ hands: moved, timestampMs: 200 });
  assert.equal(update.mode, "pan");
  assert.ok(update.dx < -40, `mirrored pan dx ${update.dx}`);
  assert.ok(Math.abs(update.dy) < 1e-9);
});

test("one or incomplete landmark hands cannot reserve two-hand navigation", () => {
  const one = pair(openHandLandmarks, -0.2, 0.2).slice(0, 1);
  assert.deepEqual(collectLandmarkNavigationHands(one, MAPPING), []);

  const incomplete = pair(openHandLandmarks, -0.2, 0.2);
  incomplete[1].landmarks[9] = { x: Number.NaN, y: 0.6, z: 0 };
  assert.deepEqual(collectLandmarkNavigationHands(incomplete, MAPPING), []);
});

test("two detected hands reserve the stream through mixed or ambiguous poses", () => {
  assert.equal(shouldReserveLandmarkNavigation(2, false), true);
  assert.equal(
    shouldReserveLandmarkNavigation(1, true),
    true,
    "the navigation release debounce keeps ownership after one hand drops",
  );
  assert.equal(shouldReserveLandmarkNavigation(1, false), false);
});
