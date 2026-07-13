import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateGrabStrength,
  grabStrengthFromHand,
  grabStrengthFromLandmarks,
} from "../dist/grabStrength.js";

test("open hand stays released while a closed fist produces a strong grab", () => {
  const open = estimateGrabStrength(openHandLandmarks());
  const closed = estimateGrabStrength(closedFistLandmarks());

  assert.ok(open.strength < 0.18, `open strength was ${open.strength}`);
  assert.ok(closed.strength > 0.76, `closed strength was ${closed.strength}`);
  assert.equal(open.observedFingers, 4);
  assert.equal(closed.observedFingers, 4);
  assert.ok(open.confidence > 0.9);
  assert.ok(closed.confidence > 0.9);
});

test("grab strength is invariant to hand size and camera-space translation", () => {
  const original = grabStrengthFromLandmarks(closedFistLandmarks());
  const transformed = grabStrengthFromLandmarks(
    closedFistLandmarks().map((point) => ({
      x: 0.15 + point.x * 0.52,
      y: -0.08 + point.y * 0.52,
      z: (point.z ?? 0) * 0.52,
    })),
  );

  assert.ok(Math.abs(original - transformed) < 1e-9);
});

test("partial and noisy landmarks retain a usable grab without false certainty", () => {
  const partial = closedFistLandmarks();
  // MediaPipe can temporarily lose the thumb and an entire edge finger.
  for (const index of [1, 2, 3, 4, 17, 18, 19, 20]) {
    partial[index] = undefined;
  }
  // A non-finite ring DIP should be ignored, not poison the whole estimate.
  partial[15] = { x: Number.NaN, y: 0.62 };

  const estimate = estimateGrabStrength(partial);
  assert.ok(estimate.strength > 0.68, `partial strength was ${estimate.strength}`);
  assert.equal(estimate.observedFingers, 3);
  assert.ok(estimate.confidence >= 0.55 && estimate.confidence < 0.9);

  assert.equal(grabStrengthFromLandmarks([]), 0);
  assert.equal(grabStrengthFromHand(null), 0);
});

test("an isolated curled-finger fragment cannot engage a grab by itself", () => {
  const fragment = [];
  const fist = closedFistLandmarks();
  for (const index of [0, 5, 6, 7, 8]) {
    fragment[index] = fist[index];
  }

  const estimate = estimateGrabStrength(fragment);
  assert.equal(estimate.observedFingers, 1);
  assert.ok(estimate.strength < 0.5);
  assert.ok(estimate.confidence < 0.5);
});

test("one noisy curled finger does not turn an open palm into a grab", () => {
  const noisy = openHandLandmarks();
  noisy[7] = { x: 0.43, y: 0.62 };
  noisy[8] = { x: 0.47, y: 0.68 };

  const estimate = estimateGrabStrength(noisy);
  assert.ok(estimate.strength < 0.32, `noisy open strength was ${estimate.strength}`);
  assert.ok((estimate.fingerScores.index ?? 0) > 0.6);
});

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

function point(x, y, z = 0) {
  return { x, y, z };
}
