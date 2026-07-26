import assert from "node:assert/strict";
import test from "node:test";

import { estimateVictoryPresentation } from "../dist/victoryPresentation.js";

function landmarkArray(entries) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
  for (const [index, point] of Object.entries(entries)) {
    landmarks[Number(index)] = point;
  }
  return landmarks;
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

function openPalm() {
  const hand = victoryHand();
  for (const [mcp, pip, dip, tip, x] of [
    [5, 6, 7, 8, 0.41],
    [9, 10, 11, 12, 0.47],
    [13, 14, 15, 16, 0.53],
    [17, 18, 19, 20, 0.59],
  ]) {
    hand[mcp] = { x, y: 0.64, z: 0 };
    hand[pip] = { x, y: 0.51, z: 0 };
    hand[dip] = { x, y: 0.4, z: 0 };
    hand[tip] = { x, y: 0.29, z: 0 };
  }
  return hand;
}

function pointingHand() {
  const hand = victoryHand();
  hand[10] = { x: 0.49, y: 0.58, z: 0 };
  hand[11] = { x: 0.5, y: 0.64, z: 0 };
  hand[12] = { x: 0.5, y: 0.7, z: 0 };
  return hand;
}

function closedFist() {
  const hand = victoryHand();
  for (const [mcp, pip, dip, tip, x] of [
    [5, 6, 7, 8, 0.43],
    [9, 10, 11, 12, 0.49],
    [13, 14, 15, 16, 0.55],
    [17, 18, 19, 20, 0.61],
  ]) {
    hand[mcp] = { x, y: 0.64, z: 0 };
    hand[pip] = { x, y: 0.58, z: 0 };
    hand[dip] = { x: x + 0.01, y: 0.64, z: 0 };
    hand[tip] = { x, y: 0.7, z: 0 };
  }
  return hand;
}

function snapContact() {
  const hand = victoryHand();
  hand[4] = {
    x: hand[12].x + 0.003,
    y: hand[12].y + 0.003,
    z: hand[12].z,
  };
  return hand;
}

function transform(landmarks, { angle = 0, scale = 1, mirror = false } = {}) {
  const center = { x: 0.5, y: 0.58 };
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return landmarks.map((point) => {
    const sourceX = mirror ? center.x - (point.x - center.x) : point.x;
    const dx = (sourceX - center.x) * scale;
    const dy = (point.y - center.y) * scale;
    return {
      x: center.x + dx * cosine - dy * sine,
      y: center.y + dx * sine + dy * cosine,
      z: (point.z ?? 0) * scale,
    };
  });
}

test("Victory requires two raised and two folded fingers", () => {
  const estimate = estimateVictoryPresentation(victoryHand());
  assert.ok(estimate.score >= 0.72, `score ${estimate.score}`);
  assert.ok(estimate.raisedFingerScore >= 0.56);
  assert.ok(estimate.foldedFingerScore >= 0.5);
  assert.ok(estimate.separationScore >= 0.18);
  assert.ok(estimate.thumbClearanceScore >= 0.15);
  assert.ok(estimate.confidence >= 0.7);
});

test("Victory definition is stable across scale, mirroring, and rotation", () => {
  const baseline = estimateVictoryPresentation(victoryHand()).score;
  for (const variant of [
    transform(victoryHand(), { scale: 0.7 }),
    transform(victoryHand(), { scale: 1.25 }),
    transform(victoryHand(), { mirror: true }),
    transform(victoryHand(), { angle: Math.PI / 2 }),
    transform(victoryHand(), { angle: -Math.PI / 3, mirror: true }),
  ]) {
    const score = estimateVictoryPresentation(variant).score;
    assert.ok(score >= 0.72, `variant score ${score}`);
    assert.ok(Math.abs(score - baseline) <= 0.08, `baseline ${baseline}, variant ${score}`);
  }
});

test("open palm, pointing, fist, and snap contact do not enter Victory", () => {
  assert.equal(estimateVictoryPresentation(openPalm()).score, 0);
  assert.equal(estimateVictoryPresentation(pointingHand()).score, 0);
  assert.equal(estimateVictoryPresentation(closedFist()).score, 0);
  const snap = estimateVictoryPresentation(snapContact());
  assert.equal(snap.score, 0);
  assert.ok(
    snap.thumbClearanceScore < 0.15,
    `thumb clearance ${snap.thumbClearanceScore}`,
  );
});

test("malformed or incomplete landmarks fail closed", () => {
  assert.deepEqual(estimateVictoryPresentation([]), {
    score: 0,
    raisedFingerScore: 0,
    foldedFingerScore: 0,
    separationScore: 0,
    thumbClearanceScore: 0,
    confidence: 0,
  });
  const invalid = victoryHand();
  invalid[8] = { x: Number.NaN, y: 0.3, z: 0 };
  assert.equal(estimateVictoryPresentation(invalid).score, 0);
});
