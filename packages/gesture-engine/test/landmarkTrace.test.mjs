import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseLandmarkTrace,
  replayLandmarkTrace,
  replayLandmarkTraceWithDiagnostics,
  segmentsAbove,
} from "../dist/landmarkTrace.js";

const FIXTURE = new URL("./fixtures/palm-grab-pointing.trace.json", import.meta.url);

test("replaying the reference trace detects each pose only in its segment", async () => {
  const trace = parseLandmarkTrace(JSON.parse(await readFile(FIXTURE, "utf8")));
  const samples = replayLandmarkTrace(trace);
  assert.equal(samples.length, trace.frames.length);

  // Palm-presentation pose: exactly one contiguous segment covering the
  // held-open-palm phase (the rising phase also scores — stillness gating is
  // the tracker's job, not the estimator's) and NOT the fist/pointing phases.
  const palmSegments = segmentsAbove(samples, (s) => s.palmScore, 0.62);
  assert.equal(palmSegments.length, 1, JSON.stringify(palmSegments));
  const palm = palmSegments[0];
  assert.ok(palm.fromMs <= 660, `palm detected from ${palm.fromMs}`);
  assert.ok(palm.toMs >= 1900 && palm.toMs < 2050, `palm held until ${palm.toMs}`);

  // Grab: exactly one segment, aligned with the fist phase.
  const grabSegments = segmentsAbove(samples, (s) => s.grabStrength, 0.68);
  assert.equal(grabSegments.length, 1, JSON.stringify(grabSegments));
  const grab = grabSegments[0];
  assert.ok(grab.fromMs >= 1950 && grab.fromMs <= 2100, `grab from ${grab.fromMs}`);
  assert.ok(grab.toMs >= 3100 && grab.toMs < 3250, `grab until ${grab.toMs}`);

  // The camera-pointing phase must trigger neither pose.
  const pointingSamples = samples.filter((s) => s.t >= 3300);
  assert.ok(pointingSamples.length > 20);
  for (const sample of pointingSamples) {
    assert.ok(sample.palmScore < 0.62, `pointing frame at ${sample.t} scored palm ${sample.palmScore}`);
    assert.ok(sample.grabStrength < 0.68, `pointing frame at ${sample.t} scored grab ${sample.grabStrength}`);
  }
});

test("parseLandmarkTrace rejects malformed traces", () => {
  assert.throws(() => parseLandmarkTrace(null));
  assert.throws(() => parseLandmarkTrace({ schemaVersion: "2.0", frames: [] }));
  assert.throws(() => parseLandmarkTrace({ schemaVersion: "1.0", frames: [{ t: "x", hands: [] }] }));
});

test("diagnostic replay reports production palm/grab actions and gate timing", async () => {
  const trace = parseLandmarkTrace(JSON.parse(await readFile(FIXTURE, "utf8")));
  const replay = replayLandmarkTraceWithDiagnostics(trace);

  assert.equal(replay.summary.frameCount, trace.frames.length);
  assert.equal(replay.summary.framesWithInvalidHands, 0);
  assert.equal(replay.summary.nonMonotonicTimestampFrames, 0);
  assert.deepEqual(
    replay.actions.map((action) => action.type),
    ["palm_acquire", "grab_acquire", "palm_release", "grab_release"],
  );
  assert.deepEqual(
    replay.actions.map((action) => action.frameOwner),
    ["palm", "grab", "grab", "grab"],
  );

  assert.equal(replay.metrics.duplicateActionCount, 0);
  assert.equal(replay.metrics.unpairedActionCount, 0);
  assert.equal(replay.metrics.palm.acquireCount, 1);
  assert.equal(replay.metrics.palm.releaseCount, 1);
  assert.equal(replay.metrics.grab.acquireCount, 1);
  assert.equal(replay.metrics.grab.releaseCount, 1);
  assert.ok(
    replay.metrics.palm.acquireTiming.maxMs >= 400 &&
      replay.metrics.palm.acquireTiming.maxMs < 450,
  );
  assert.ok(
    replay.metrics.grab.acquireTiming.maxMs >= 55 &&
      replay.metrics.grab.acquireTiming.maxMs < 90,
  );
  assert.ok(
    replay.metrics.grab.releaseTiming.maxMs >= 80 &&
      replay.metrics.grab.releaseTiming.maxMs < 120,
  );

  const grabOwnerFrame = replay.frames.find(
    (frame) => frame.transition.owner?.to === "grab",
  );
  assert.ok(grabOwnerFrame);
  assert.ok(grabOwnerFrame.suppression.palm.includes("owned_by_grab"));
  assert.deepEqual(grabOwnerFrame.transition.grab, {
    from: "idle",
    to: "acquiring",
  });
});

test("diagnostic replay fails individual bad frames closed without duplicate actions", async () => {
  const trace = parseLandmarkTrace(JSON.parse(await readFile(FIXTURE, "utf8")));
  const faulted = structuredClone(trace);
  const corruptFrame = faulted.frames[40];
  assert.ok(corruptFrame);
  const corruptHand = corruptFrame.hands[0];
  assert.ok(corruptHand);
  corruptHand.landmarks[8] = [Number.NaN, 0.2, 0];

  const regressedFrame = faulted.frames[50];
  assert.ok(regressedFrame);
  regressedFrame.t -= 200;

  const replay = replayLandmarkTraceWithDiagnostics(faulted);
  assert.equal(replay.summary.framesWithInvalidHands, 1);
  assert.equal(replay.summary.nonMonotonicTimestampFrames, 1);
  assert.equal(replay.frames[40]?.stages.validation.status, "degraded");
  assert.ok(
    replay.frames[40]?.stages.validation.codes.includes(
      "hand_0:non_finite_landmark",
    ),
  );
  assert.equal(replay.frames[50]?.stages.input.status, "degraded");
  assert.ok(
    replay.frames[50]?.stages.input.codes.includes("timestamp_regression"),
  );
  assert.equal(replay.metrics.duplicateActionCount, 0);
  assert.equal(replay.metrics.unpairedActionCount, 0);
  assert.deepEqual(
    replay.actions.map((action) => action.type),
    ["palm_acquire", "grab_acquire", "palm_release", "grab_release"],
  );
});

test("diagnostic replay suppresses ambiguous multi-hand ownership", async () => {
  const trace = parseLandmarkTrace(JSON.parse(await readFile(FIXTURE, "utf8")));
  const oneFrame = structuredClone(trace.frames[0]);
  assert.ok(oneFrame);
  oneFrame.hands.push(structuredClone(oneFrame.hands[0]));

  const replay = replayLandmarkTraceWithDiagnostics({
    schemaVersion: "1.0",
    frames: [oneFrame],
  });
  const frame = replay.frames[0];
  assert.ok(frame);
  assert.equal(frame.owner, "none");
  assert.equal(frame.selectedHandIndex, null);
  assert.deepEqual(frame.suppression.palm, ["multiple_hands"]);
  assert.deepEqual(frame.suppression.grab, ["multiple_hands"]);
  assert.equal(replay.actions.length, 0);
});
