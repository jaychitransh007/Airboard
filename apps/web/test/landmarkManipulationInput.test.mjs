import assert from "node:assert/strict";
import test from "node:test";

import { HybridGestureController } from "@airboard/gesture-engine";

import { selectLandmarkManipulationSignal } from "../src/features/board/landmarkManipulationInput.ts";

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

function hand(landmarks = closedFistLandmarks(), handednessScore = 0.96) {
  return {
    handedness: "right",
    handednessScore,
    landmarks,
  };
}

test("raw closed-hand landmarks flow into the Move controller as one grab", () => {
  const signal = selectLandmarkManipulationSignal(
    [hand()],
    "right",
    MAPPING,
  );
  assert.ok(signal);
  assert.ok(signal.grabStrength > 0.76, `grab ${signal.grabStrength}`);
  assert.ok(signal.grabConfidence > 0.9);
  assert.equal(signal.trackingConfidence, 1);

  const controller = new HybridGestureController({
    canvasWidth: MAPPING.canvasWidth,
    canvasHeight: MAPPING.canvasHeight,
    mirrorX: true,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 40,
    stickyReleaseRadiusPx: 80,
    pinch: {
      engageThreshold: 0.68,
      releaseThreshold: 0.38,
      engageDebounceMs: 0,
      releaseDebounceMs: 0,
    },
  });
  const output = controller.update({
    handPoint: signal.point,
    trackingConfidence: signal.trackingConfidence,
    pinchStrength: signal.grabStrength,
    grabConfidence: signal.grabConfidence,
    timestampMs: 0,
    targets: [
      {
        id: "node",
        bounds: { x: 350, y: 300, width: 300, height: 200 },
      },
    ],
  });

  assert.equal(output.action?.type, "grab_started");
  assert.equal(output.action?.targetId, "node");
});

test("uncertain handedness cannot freeze an otherwise valid hand pointer", () => {
  const signal = selectLandmarkManipulationSignal(
    [hand(openHandLandmarks(), 0.12)],
    "right",
    MAPPING,
  );
  assert.ok(signal);
  assert.ok(signal.grabStrength < 0.18, "the test hand is an open palm");
  assert.equal(
    signal.trackingConfidence,
    1,
    "left/right label certainty is not landmark tracking quality",
  );

  const controller = new HybridGestureController({
    canvasWidth: MAPPING.canvasWidth,
    canvasHeight: MAPPING.canvasHeight,
    mirrorX: true,
    minTrackingConfidence: 0.6,
    hoverSmoothingTimeMs: 0,
  });
  const output = controller.update({
    handPoint: signal.point,
    trackingConfidence: signal.trackingConfidence,
    pinchStrength: signal.grabStrength,
    grabConfidence: signal.grabConfidence,
    timestampMs: 0,
    targets: [],
  });

  assert.equal(output.trackingState, "tracked");
  assert.ok(output.cursor, "the air cursor must replace the last mouse position");
});

test("missing or non-finite palm anchors fail closed", () => {
  assert.equal(
    selectLandmarkManipulationSignal([], "right", MAPPING),
    null,
  );
  const invalid = closedFistLandmarks();
  invalid[13] = { x: 0.5, y: Number.NaN, z: 0 };
  assert.equal(
    selectLandmarkManipulationSignal([hand(invalid)], "right", MAPPING),
    null,
  );
});
