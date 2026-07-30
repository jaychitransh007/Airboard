import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GestureTraceJournal,
  coordinateGestureFrame,
  coordinateRawLandmarkFrame,
  createRawLandmarkCanvasMapping,
  reportGestureInferenceFailure,
} from "../src/features/board/gestureFrameCoordinator.ts";

function stages(winner = "manipulation") {
  return {
    navigation: { update: () => winner === "navigation" },
    snap: { update: () => winner === "snap" },
    undo: { update: () => winner === "undo" },
    voice: { observe: () => undefined },
    manipulation: { run: () => undefined },
  };
}

test("coordinates production arbitration and emits content-free stages", () => {
  const journal = new GestureTraceJournal();
  const result = coordinateGestureFrame({
    interactionId: "gesture-eval-1",
    timestampMs: 1234,
    handsDetected: 1,
    inferenceMs: 7.5,
    stages: stages("undo"),
    report: journal.append,
  });

  assert.equal(result.owner, "undo");
  assert.deepEqual(
    journal.snapshot().map((event) => event.stage),
    ["perception_health", "arbitration_owner"],
  );
  assert.deepEqual(journal.snapshot()[0].data, {
    status: "ok",
    handsDetected: 1,
    inferenceMs: 7.5,
  });
  assert.equal(
    JSON.stringify(journal.snapshot()).includes("landmark"),
    false,
    "raw landmarks are never journaled",
  );
});

test("inference exceptions are visible and cancel the interaction", () => {
  const journal = new GestureTraceJournal();
  reportGestureInferenceFailure(
    {
      interactionId: "gesture-eval-2",
      timestampMs: 2000,
      report: journal.append,
    },
    new RangeError("model failure"),
  );
  assert.deepEqual(
    journal.snapshot().map((event) => event.stage),
    ["perception_health", "cancellation"],
  );
  assert.deepEqual(journal.snapshot()[0].data, {
    status: "error",
    code: "HAND_LANDMARK_INFERENCE_FAILED",
    errorName: "RangeError",
  });
});

test("journal is bounded and returns defensive snapshots", () => {
  const journal = new GestureTraceJournal(2);
  for (let index = 0; index < 3; index += 1) {
    journal.append({
      interactionId: "gesture-eval-3",
      frameAtMs: index,
      stage: "transition",
      data: { index },
    });
  }
  const snapshot = journal.snapshot();
  assert.deepEqual(snapshot.map((event) => event.frameAtMs), [1, 2]);
  snapshot[0].data.index = 99;
  assert.equal(journal.snapshot()[0].data.index, 1);
  assert.deepEqual(journal.summary(), {
    totalEvents: 3,
    retainedEvents: 2,
    droppedEvents: 1,
    stageCounts: { transition: 3 },
    observedOwners: [],
    appliedActionCounts: {},
    targetedGestureCounts: {},
    inferenceSampleCount: 0,
    inferenceP95Ms: null,
  });
});

test("bounded journal summary retains early actions, targets, owners, and inference timing", () => {
  const journal = new GestureTraceJournal(1);
  for (const event of [
    {
      interactionId: "gesture-eval-4",
      frameAtMs: 1,
      stage: "perception_health",
      data: { status: "ok", inferenceMs: 9 },
    },
    {
      interactionId: "gesture-eval-4",
      frameAtMs: 2,
      stage: "arbitration_owner",
      data: { owner: "grab" },
    },
    {
      interactionId: "gesture-eval-4",
      frameAtMs: 3,
      stage: "target",
      data: { gesture: "manipulation", targetId: "opaque-id" },
    },
    {
      interactionId: "gesture-eval-4",
      frameAtMs: 4,
      stage: "action",
      data: { gesture: "move_commit", applied: true },
    },
  ]) {
    journal.append(event);
  }

  assert.deepEqual(journal.summary(), {
    totalEvents: 4,
    retainedEvents: 1,
    droppedEvents: 3,
    stageCounts: {
      perception_health: 1,
      arbitration_owner: 1,
      target: 1,
      action: 1,
    },
    observedOwners: ["grab"],
    appliedActionCounts: { move_commit: 1 },
    targetedGestureCounts: { manipulation: 1 },
    inferenceSampleCount: 1,
    inferenceP95Ms: 9,
  });
  journal.clear();
  assert.equal(journal.summary().totalEvents, 0);
});

test("live and injected landmarks execute the same production frame stages", () => {
  for (const source of [
    "live_hand_landmarker",
    "eval_landmark_injection",
  ]) {
    const order = [];
    const journal = new GestureTraceJournal();
    const result = coordinateRawLandmarkFrame({
      interactionId: `gesture-${source}`,
      source,
      timestampMs: 3100,
      inferenceMs: 6.25,
      hands: [{ id: "opaque-hand" }],
      geometry: {
        canvasWidth: 900,
        canvasHeight: 600,
        sourceWidth: 1280,
        sourceHeight: 720,
        sensitivity: 0.8,
      },
      gestureModeEnabled: true,
      diagramVisible: true,
      processPipeline: ({ mapping }) => {
        order.push("pipeline");
        assert.deepEqual(mapping, {
          canvasWidth: 900,
          canvasHeight: 600,
          sourceWidth: 1280,
          sourceHeight: 720,
          fitMode: "cover",
          mirrorInput: true,
          sensitivity: 0.8,
        });
        return { gesture: "marker" };
      },
      observeFrame: () => order.push("observe"),
      prepareGesture: () => {
        order.push("prepare");
        return { prepared: true };
      },
      processHiddenFrame: () => order.push("hidden"),
      createStages: ({ gestureContext, setManipulationResult }) => {
        order.push("stages");
        assert.equal(gestureContext.prepared, true);
        return {
          navigation: {
            update: () => {
              order.push("navigation");
              return false;
            },
          },
          snap: {
            update: () => {
              order.push("snap");
              return false;
            },
          },
          undo: {
            update: () => {
              order.push("undo");
              return false;
            },
          },
          voice: {
            observe: () => order.push("voice"),
          },
          manipulation: {
            run: () => {
              order.push("manipulation");
              setManipulationResult({ state: "hover" });
            },
          },
        };
      },
      applyFrame: () => order.push("apply"),
      report: journal.append,
    });

    assert.deepEqual(order, [
      "pipeline",
      "observe",
      "prepare",
      "stages",
      "navigation",
      "snap",
      "undo",
      "voice",
      "manipulation",
      "apply",
    ]);
    assert.equal(result.owner, "manipulation");
    assert.deepEqual(result.manipulationResult, { state: "hover" });
    assert.equal(
      journal.snapshot()[0].data.frameSource,
      source,
      "content-free evidence identifies which provider supplied the frame",
    );
  }
});

test("raw-landmark mapping fails safe for invalid media dimensions", () => {
  assert.deepEqual(
    createRawLandmarkCanvasMapping({
      canvasWidth: 0,
      canvasHeight: Number.NaN,
      sourceWidth: 0,
      sourceHeight: Number.POSITIVE_INFINITY,
      sensitivity: Number.NaN,
    }),
    {
      canvasWidth: 1,
      canvasHeight: 1,
      sourceWidth: 1,
      sourceHeight: 1,
      fitMode: "cover",
      mirrorInput: true,
      sensitivity: 1,
    },
  );
});

test("Airboard live detection and eval injection adopt one raw-frame processor", async () => {
  const source = await readFile(
    new URL(
      "../src/features/board/AirboardPrototype.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    source.match(/pipelineRef\.current\.process\(\{/g)?.length,
    1,
    "raw landmark callers must not duplicate GesturePipeline advancement",
  );
  assert.match(source, /source: "live_hand_landmarker"/);
  assert.match(source, /source: "eval_landmark_injection"/);
  assert.match(
    source,
    /rawLandmarkFrameProcessorRef\.current = processRawLandmarkFrame/,
  );
  assert.match(source, /processRawLandmarkFrame\(\{\s*hands,\s*timestampMs,/);
});
