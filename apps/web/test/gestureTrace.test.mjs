import assert from "node:assert/strict";
import test from "node:test";
import { createGestureTraceReporter } from "../src/features/board/gestureTrace.ts";

test("gesture traces retain every local event but sample identical durable frame stages", () => {
  const observed = [];
  const posted = [];
  const report = createGestureTraceReporter({
    observe: (event) => observed.push(event),
    post: (interactionId, stage, data) =>
      posted.push({ interactionId, stage, data }),
    sampleIntervalMs: 1_000,
  });
  for (const frameAtMs of [0, 16, 32, 1_001]) {
    report({
      interactionId: "gesture-interaction-1",
      frameAtMs,
      stage: "perception_health",
      data: { handsDetected: 1, status: "ok" },
    });
  }

  assert.equal(observed.length, 4);
  assert.equal(posted.length, 2);
  assert.deepEqual(
    posted.map(({ stage }) => stage),
    ["gesture_perception_health", "gesture_perception_health"],
  );
});

test("owner changes and safety events post immediately", () => {
  const posted = [];
  const report = createGestureTraceReporter({
    observe: () => undefined,
    post: (interactionId, stage, data) =>
      posted.push({ interactionId, stage, data }),
  });
  report({
    interactionId: "gesture-interaction-2",
    frameAtMs: 10,
    stage: "arbitration_owner",
    data: { owner: "manipulation" },
  });
  report({
    interactionId: "gesture-interaction-2",
    frameAtMs: 20,
    stage: "arbitration_owner",
    data: { owner: "undo" },
  });
  report({
    interactionId: "gesture-interaction-2",
    frameAtMs: 21,
    stage: "cancellation",
    data: { reason: "camera_stopped" },
  });

  assert.deepEqual(
    posted.map(({ stage }) => stage),
    [
      "gesture_arbitration_owner",
      "gesture_arbitration_owner",
      "gesture_cancellation",
    ],
  );
});
