import assert from "node:assert/strict";
import test from "node:test";

import { selectSingleLandmarkPose } from "../src/features/board/landmarkPoseSelection.ts";

function hand(landmarks = completeLandmarks()) {
  return {
    handedness: "right",
    handednessScore: 0.95,
    landmarks,
  };
}

function completeLandmarks() {
  return Array.from({ length: 21 }, (_, index) => ({
    x: 0.2 + index * 0.01,
    y: 0.7 - index * 0.01,
    z: 0,
  }));
}

test("evaluates exactly one complete HandLandmarker hand", () => {
  let calls = 0;
  const result = selectSingleLandmarkPose([hand()], () => {
    calls += 1;
    return { score: 0.83 };
  });
  assert.equal(calls, 1);
  assert.equal(result.score, 0.83);
  assert.equal(result.trackedHands, 1);
  assert.ok(Math.abs(result.point.x - 0.31) < 1e-12);
  assert.ok(Math.abs(result.point.y - 0.59) < 1e-12);
});

test("zero, partial, or multiple hands cannot activate a pose", () => {
  const estimator = () => ({ score: 1 });
  assert.deepEqual(selectSingleLandmarkPose([], estimator), {
    score: 0,
    point: null,
    trackedHands: 0,
  });
  assert.deepEqual(
    selectSingleLandmarkPose([hand([{ x: 0.5, y: 0.5, z: 0 }])], estimator),
    { score: 0, point: null, trackedHands: 0 },
  );
  assert.deepEqual(selectSingleLandmarkPose([hand(), hand()], estimator), {
    score: 0,
    point: null,
    trackedHands: 2,
  });
});

test("invalid estimator scores fail closed and finite scores are clamped", () => {
  assert.equal(
    selectSingleLandmarkPose([hand()], () => ({ score: Number.NaN })).score,
    0,
  );
  assert.equal(selectSingleLandmarkPose([hand()], () => ({ score: 4 })).score, 1);
  assert.equal(selectSingleLandmarkPose([hand()], () => ({ score: -1 })).score, 0);
});
