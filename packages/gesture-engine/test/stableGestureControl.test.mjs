import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HybridGestureController,
  mapControlZonePointToCanvas,
} from "../dist/hybridGestureController.js";
import {
  PinchHysteresis,
  pinchStrengthFromDistance,
} from "../dist/pinchHysteresis.js";
import {
  acquireStickyTarget,
  findAreaTarget,
} from "../dist/targetAcquisition.js";

test("pinch hysteresis debounces engage and release across separate thresholds", () => {
  const pinch = new PinchHysteresis({
    engageThreshold: 0.7,
    releaseThreshold: 0.4,
    engageDebounceMs: 80,
    releaseDebounceMs: 70,
  });

  assert.deepEqual(pinch.update(0.8, 0), {
    phase: "closing",
    strength: 0.8,
    engaged: false,
    released: false,
  });
  assert.equal(pinch.update(0.8, 79).engaged, false);
  assert.equal(pinch.update(0.8, 80).engaged, true);

  // The signal can jitter between thresholds without changing closed state.
  assert.equal(pinch.update(0.55, 90).phase, "closed");
  assert.equal(pinch.update(0.3, 100).phase, "opening");
  assert.equal(pinch.update(0.3, 169).released, false);
  assert.equal(pinch.update(0.3, 170).released, true);
  assert.equal(pinch.snapshot().phase, "open");

  assert.equal(pinchStrengthFromDistance(0.2, 0.2, 0.8), 1);
  assert.equal(pinchStrengthFromDistance(0.8, 0.2, 0.8), 0);
});

test("area cursor acquisition prefers priority and sticky focus uses a larger release area", () => {
  const targets = [
    { id: "large", bounds: { x: 100, y: 100, width: 100, height: 100 } },
    {
      id: "port",
      bounds: { x: 96, y: 140, width: 8, height: 8 },
      priority: 10,
      capturePaddingPx: 4,
    },
    { id: "next", bounds: { x: 220, y: 100, width: 100, height: 100 } },
  ];

  assert.equal(findAreaTarget({ x: 90, y: 144 }, targets, 12)?.target.id, "port");

  // Although "next" becomes closer, the already-focused target stays latched.
  assert.equal(
    acquireStickyTarget({
      point: { x: 211, y: 150 },
      targets,
      currentTargetId: "large",
      acquireRadiusPx: 12,
      releaseRadiusPx: 24,
    })?.target.id,
    "large",
  );
  assert.equal(
    acquireStickyTarget({
      point: { x: 230, y: 150 },
      targets,
      currentTargetId: "large",
      acquireRadiusPx: 12,
      releaseRadiusPx: 24,
    })?.target.id,
    "next",
  );
});

test("hybrid controller coarsely acquires then latches one target for relative drag", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    dragGain: 0.25,
    dragDeadZonePx: 0,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    pinch: {
      engageThreshold: 0.7,
      releaseThreshold: 0.4,
      engageDebounceMs: 50,
      releaseDebounceMs: 50,
    },
  });
  const targetA = { id: "a", bounds: { x: 450, y: 210, width: 100, height: 80 } };

  let output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 0,
    targets: [targetA],
  });
  assert.deepEqual(output.cursor, { x: 500, y: 250 });
  assert.equal(output.focusedTargetId, "a");

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.9,
    timestampMs: 10,
    targets: [targetA],
  });
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.9,
    timestampMs: 60,
    targets: [targetA],
  });
  assert.equal(output.action?.type, "grab_started");
  assert.equal(output.grabbedTargetId, "a");

  // Moving 10% of the control zone moves only 2.5% of canvas width at 0.25 gain.
  const targetB = { id: "b", bounds: { x: 515, y: 210, width: 100, height: 80 } };
  output = controller.update({
    handPoint: { x: 0.55, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.9,
    timestampMs: 70,
    targets: [targetA, targetB],
  });
  assert.equal(output.action?.type, "drag_moved");
  assert.equal(output.action?.targetId, "a");
  assert.equal(output.action?.delta.x, 25);
  assert.equal(output.cursor?.x, 525);
  assert.equal(output.focusedTargetId, "a");
  assert.equal(output.grabbedTargetId, "a");

  controller.update({
    handPoint: { x: 0.55, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.2,
    timestampMs: 80,
    targets: [targetA, targetB],
  });
  output = controller.update({
    handPoint: { x: 0.55, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.2,
    timestampMs: 130,
    targets: [targetA, targetB],
  });
  assert.equal(output.action?.type, "grab_ended");
  assert.equal(output.action?.targetId, "a");
  assert.equal(output.grabbedTargetId, null);
});

test("drag smoothing damps noisy hand steps without preventing deliberate motion", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1_000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    dragGain: 1,
    dragSmoothingTimeMs: 64,
    dragDeadZonePx: 0,
    maxDragStepPx: 200,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    pinch: {
      engageThreshold: 0.7,
      releaseThreshold: 0.4,
      engageDebounceMs: 0,
      releaseDebounceMs: 0,
    },
  });
  const target = {
    id: "node",
    bounds: { x: 450, y: 200, width: 100, height: 100 },
  };

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 0,
    targets: [target],
  });
  let output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 10,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");

  output = controller.update({
    handPoint: { x: 0.6, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 26,
    targets: [target],
  });
  assert.equal(output.action?.type, "drag_moved");
  assert.ok(
    output.action.delta.x > 20 && output.action.delta.x < 25,
    `expected a damped first step, received ${output.action.delta.x}`,
  );
  assert.equal(output.action.delta.y, 0);

  output = controller.update({
    handPoint: { x: 0.6, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 282,
    targets: [target],
  });
  assert.equal(output.action?.type, "drag_moved");
  assert.ok(
    (output.action.totalDelta.x ?? 0) > 97,
    `deliberate motion must converge, received ${output.action.totalDelta.x}`,
  );
});

test("a hand kept closed grabs once the cursor reaches a target", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    pinch: {
      engageThreshold: 0.7,
      releaseThreshold: 0.4,
      engageDebounceMs: 0,
      releaseDebounceMs: 0,
    },
  });
  const target = { id: "a", bounds: { x: 450, y: 210, width: 100, height: 80 } };

  // Close the hand over empty space — no target under the cursor, so no grab.
  let output = controller.update({
    handPoint: { x: 0.1, y: 0.1 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 0,
    targets: [target],
  });
  assert.equal(output.action, null);
  assert.equal(output.pinchState, "closed");
  assert.equal(output.grabbedTargetId, null);
  assert.equal(output.requiresPinchRelease, false);

  // Keep the hand closed and move onto the target — the grab now starts without
  // forcing a full release and re-pinch.
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 20,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");
  assert.equal(output.grabbedTargetId, "a");
});

test("a hand kept closed past the reacquire grace does not latch a swept-in target", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    grabReacquireGraceMs: 400,
    pinch: { engageThreshold: 0.7, releaseThreshold: 0.4, engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "a", bounds: { x: 450, y: 210, width: 100, height: 80 } };

  // Close over empty space.
  controller.update({ handPoint: { x: 0.1, y: 0.1 }, trackingConfidence: 1, pinchStrength: 1, timestampMs: 0, targets: [target] });
  // Sweep the still-closed hand onto the target well after the grace window.
  let output = controller.update({ handPoint: { x: 0.5, y: 0.5 }, trackingConfidence: 1, pinchStrength: 1, timestampMs: 800, targets: [target] });
  assert.equal(output.action, null);
  assert.equal(output.grabbedTargetId, null);

  // Reopening and closing again over the target still grabs via the engage edge.
  controller.update({ handPoint: { x: 0.5, y: 0.5 }, trackingConfidence: 1, pinchStrength: 0, timestampMs: 820, targets: [target] });
  output = controller.update({ handPoint: { x: 0.5, y: 0.5 }, trackingConfidence: 1, pinchStrength: 1, timestampMs: 840, targets: [target] });
  assert.equal(output.action?.type, "grab_started");
});

test("a low-confidence idle frame clears the release gate instead of sticking it", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    grabConfidenceFloor: 0.55,
    pinch: { engageThreshold: 0.7, releaseThreshold: 0.4, engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "a", bounds: { x: 450, y: 210, width: 100, height: 80 } };

  controller.reset({ requirePinchRelease: true });

  // Open hand, but tracked at low grab-confidence with a spuriously high strength.
  // The gate must still clear (the frame is treated as open when idle).
  let output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.9,
    grabConfidence: 0.2,
    timestampMs: 0,
    targets: [target],
  });
  assert.equal(output.requiresPinchRelease, false);

  // A subsequent confident fist can now grab.
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    grabConfidence: 1,
    timestampMs: 20,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");
});

test("a low-confidence frame holds an in-progress grab instead of dropping it", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    areaCursorRadiusPx: 20,
    stickyReleaseRadiusPx: 40,
    grabConfidenceFloor: 0.55,
    pinch: { engageThreshold: 0.7, releaseThreshold: 0.4, engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "a", bounds: { x: 450, y: 210, width: 100, height: 80 } };

  controller.update({ handPoint: { x: 0.5, y: 0.5 }, trackingConfidence: 1, pinchStrength: 1, grabConfidence: 1, timestampMs: 0, targets: [target] });
  let output = controller.update({ handPoint: { x: 0.5, y: 0.5 }, trackingConfidence: 1, pinchStrength: 1, grabConfidence: 1, timestampMs: 20, targets: [target] });
  assert.equal(output.grabbedTargetId, "a");

  // Uncertain frame with a near-zero raw strength: the grab must be held, not dropped.
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0.05,
    grabConfidence: 0.1,
    timestampMs: 40,
    targets: [target],
  });
  assert.equal(output.grabbedTargetId, "a");
  assert.notEqual(output.action?.type, "grab_ended");
});

test("tracking loss freezes briefly, cancels once, and requires release before re-grab", () => {
  const controller = new HybridGestureController({
    canvasWidth: 800,
    canvasHeight: 400,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    trackingLossTimeoutMs: 100,
    pinch: { engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "node", bounds: { x: 350, y: 150, width: 100, height: 100 } };

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 0,
    targets: [target],
  });
  let output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 10,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");

  output = controller.update({
    handPoint: null,
    trackingConfidence: 0,
    pinchStrength: 1,
    timestampMs: 80,
    targets: [target],
  });
  assert.equal(output.trackingState, "frozen");
  assert.equal(output.grabbedTargetId, "node");
  assert.equal(output.action, null);

  output = controller.update({
    handPoint: null,
    trackingConfidence: 0,
    pinchStrength: 1,
    timestampMs: 111,
    targets: [target],
  });
  assert.equal(output.trackingState, "lost");
  assert.equal(output.action?.type, "grab_cancelled");
  assert.equal(output.grabbedTargetId, null);

  output = controller.update({
    handPoint: null,
    trackingConfidence: 0,
    pinchStrength: 1,
    timestampMs: 150,
    targets: [target],
  });
  assert.equal(output.action, null);

  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 160,
    targets: [target],
  });
  assert.equal(output.action, null);
  assert.equal(output.pinchState, "open");

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 170,
    targets: [target],
  });
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 180,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");

  assert.deepEqual(
    mapControlZonePointToCanvas(
      { x: 0.25, y: 0.5 },
      {
        canvasWidth: 800,
        canvasHeight: 400,
        controlZone: { x: 0, y: 0, width: 1, height: 1 },
        mirrorX: true,
      },
    ),
    { x: 600, y: 200 },
  );
});

test("relative drag accumulates intentional motion below the per-frame dead zone", () => {
  const controller = new HybridGestureController({
    canvasWidth: 1000,
    canvasHeight: 500,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    dragGain: 1,
    dragDeadZonePx: 5,
    pinch: { engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "node", bounds: { x: 450, y: 200, width: 100, height: 100 } };

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 0,
    targets: [target],
  });
  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 10,
    targets: [target],
  });

  let output = controller.update({
    handPoint: { x: 0.503, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 20,
    targets: [target],
  });
  assert.equal(output.action, null);

  output = controller.update({
    handPoint: { x: 0.506, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 30,
    targets: [target],
  });
  assert.equal(output.action?.type, "drag_moved");
  assert.ok(Math.abs(output.action.delta.x - 6) < 1e-9);
});

test("reset can require the hand to reopen before another grab", () => {
  const controller = new HybridGestureController({
    canvasWidth: 600,
    canvasHeight: 300,
    controlZone: { x: 0, y: 0, width: 1, height: 1 },
    mirrorX: false,
    hoverSmoothingTimeMs: 0,
    pinch: { engageDebounceMs: 0, releaseDebounceMs: 0 },
  });
  const target = { id: "node", bounds: { x: 250, y: 100, width: 100, height: 100 } };

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 0,
    targets: [target],
  });
  assert.equal(
    controller.update({
      handPoint: { x: 0.5, y: 0.5 },
      trackingConfidence: 1,
      pinchStrength: 1,
      timestampMs: 10,
      targets: [target],
    }).action?.type,
    "grab_started",
  );

  controller.reset({ requirePinchRelease: true });
  let output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 20,
    targets: [target],
  });
  assert.equal(output.action, null);

  controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 0,
    timestampMs: 30,
    targets: [target],
  });
  output = controller.update({
    handPoint: { x: 0.5, y: 0.5 },
    trackingConfidence: 1,
    pinchStrength: 1,
    timestampMs: 40,
    targets: [target],
  });
  assert.equal(output.action?.type, "grab_started");
});
