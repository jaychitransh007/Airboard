import assert from "node:assert/strict";
import test from "node:test";

import { estimatePalmPresentation } from "../dist/palmPresentation.js";

// Synthetic 21-landmark hands in normalized image coordinates (y grows down).
// Only the joints the estimator reads are meaningful; the rest are filler.

function landmarkArray(entries) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [index, point] of Object.entries(entries)) {
    landmarks[Number(index)] = point;
  }
  return landmarks;
}

function openUprightPalm() {
  // Wrist at the bottom, knuckles in a spread row, straight fingers pointing up.
  const entries = {
    0: { x: 0.5, y: 0.8, z: 0 }, // wrist
  };
  const fingers = [
    { mcp: 5, pip: 6, tip: 8, x: 0.41 },
    { mcp: 9, pip: 10, tip: 12, x: 0.47 },
    { mcp: 13, pip: 14, tip: 16, x: 0.53 },
    { mcp: 17, pip: 18, tip: 20, x: 0.59 },
  ];
  for (const finger of fingers) {
    entries[finger.mcp] = { x: finger.x, y: 0.62, z: 0 };
    entries[finger.pip] = { x: finger.x, y: 0.5, z: 0 };
    entries[finger.tip] = { x: finger.x, y: 0.36, z: 0 };
  }
  return landmarkArray(entries);
}

function closedFist() {
  // Fingertips curled back toward the palm center.
  const entries = {
    0: { x: 0.5, y: 0.8, z: 0 },
  };
  const fingers = [
    { mcp: 5, pip: 6, tip: 8, x: 0.41 },
    { mcp: 9, pip: 10, tip: 12, x: 0.47 },
    { mcp: 13, pip: 14, tip: 16, x: 0.53 },
    { mcp: 17, pip: 18, tip: 20, x: 0.59 },
  ];
  for (const finger of fingers) {
    entries[finger.mcp] = { x: finger.x, y: 0.62, z: 0 };
    entries[finger.pip] = { x: finger.x, y: 0.56, z: 0 };
    entries[finger.tip] = { x: finger.x + 0.02, y: 0.66, z: 0 };
  }
  return landmarkArray(entries);
}

function foreshortenedPointingHand() {
  // Fingers aimed at the camera: the knuckle row keeps its spread, but the
  // projected finger length collapses to a fraction of the knuckle span and
  // fingertips sit barely above the knuckles in 2D.
  const entries = {
    0: { x: 0.5, y: 0.7, z: 0 },
  };
  const fingers = [
    { mcp: 5, pip: 6, tip: 8, x: 0.41 },
    { mcp: 9, pip: 10, tip: 12, x: 0.47 },
    { mcp: 13, pip: 14, tip: 16, x: 0.53 },
    { mcp: 17, pip: 18, tip: 20, x: 0.59 },
  ];
  for (const finger of fingers) {
    entries[finger.mcp] = { x: finger.x, y: 0.63, z: 0 };
    entries[finger.pip] = { x: finger.x, y: 0.615, z: -0.05 };
    entries[finger.tip] = { x: finger.x, y: 0.6, z: -0.1 };
  }
  return landmarkArray(entries);
}

function sidewaysOpenHand() {
  // Open hand rotated so the palm is edge-on: knuckle row collapses onto the
  // wrist axis, so the projected palm area is near zero.
  const entries = {
    0: { x: 0.5, y: 0.8, z: 0 },
  };
  const fingers = [
    { mcp: 5, pip: 6, tip: 8, offset: 0.0 },
    { mcp: 9, pip: 10, tip: 12, offset: 0.004 },
    { mcp: 13, pip: 14, tip: 16, offset: 0.008 },
    { mcp: 17, pip: 18, tip: 20, offset: 0.012 },
  ];
  for (const finger of fingers) {
    entries[finger.mcp] = { x: 0.5 + finger.offset, y: 0.62, z: 0 };
    entries[finger.pip] = { x: 0.5 + finger.offset, y: 0.5, z: 0 };
    entries[finger.tip] = { x: 0.5 + finger.offset, y: 0.36, z: 0 };
  }
  return landmarkArray(entries);
}

test("an open, flat, upright hand scores as a presented palm", () => {
  const estimate = estimatePalmPresentation(openUprightPalm());
  assert.ok(estimate.score >= 0.6, `expected >= 0.6, received ${estimate.score}`);
  assert.ok(estimate.opennessScore >= 0.6);
  assert.ok(estimate.flatnessScore >= 0.5);
  assert.ok(estimate.uprightScore >= 0.5);
  assert.equal(estimate.confidence, 1);
});

test("a closed fist is never a presented palm", () => {
  const estimate = estimatePalmPresentation(closedFist());
  assert.equal(estimate.score, 0);
  assert.ok(estimate.opennessScore < 0.35, `openness ${estimate.opennessScore}`);
});

test("a hand pointing at the camera fails the flatness/upright gates", () => {
  const estimate = estimatePalmPresentation(foreshortenedPointingHand());
  assert.equal(estimate.score, 0);
});

test("an edge-on open hand fails the flatness gate", () => {
  const estimate = estimatePalmPresentation(sidewaysOpenHand());
  assert.equal(estimate.score, 0);
  assert.ok(estimate.flatnessScore < 0.35, `flatness ${estimate.flatnessScore}`);
});

test("missing landmarks degrade to a zero estimate instead of throwing", () => {
  assert.equal(estimatePalmPresentation([]).score, 0);
  assert.equal(
    estimatePalmPresentation(landmarkArray({ 0: { x: 0.5, y: 0.8, z: 0 } })).score,
    0,
  );
  const withNaN = openUprightPalm();
  withNaN[8] = { x: Number.NaN, y: 0.3, z: 0 };
  const estimate = estimatePalmPresentation(withNaN);
  assert.ok(Number.isFinite(estimate.score));
});
