import assert from "node:assert/strict";
import test from "node:test";

import {
  HAND_POINTING_WINDOW_MS,
  HandDwellSelectTracker,
  HandPointingRecorder,
  resolveHandPointing,
} from "../src/features/board/handPointing.ts";
import {
  CAMERA_RECOVERY_MAX_ATTEMPTS,
  cameraRecoveryDelayMs,
  cameraRecoveryMessage,
  shouldRetryCameraStart,
} from "../src/features/board/cameraRecovery.ts";

test("pointing history lists distinct shapes, most recent last", () => {
  const recorder = new HandPointingRecorder();
  recorder.observe({ now: 1_000, boardPoint: { x: 10, y: 10 }, targetId: "a" });
  recorder.observe({ now: 1_100, boardPoint: { x: 11, y: 10 }, targetId: "a" });
  recorder.observe({ now: 1_200, boardPoint: { x: 50, y: 10 }, targetId: null });
  recorder.observe({ now: 1_300, boardPoint: { x: 90, y: 10 }, targetId: "b" });
  const snapshot = recorder.observe({ now: 1_400, boardPoint: { x: 20, y: 10 }, targetId: "a" });
  assert.deepEqual(snapshot.targetIds, ["b", "a"]);
  assert.deepEqual(snapshot.boardPoint, { x: 20, y: 10 });
  assert.equal(snapshot.at, 1_400);
});

test("pointing older than the window is forgotten", () => {
  const recorder = new HandPointingRecorder();
  recorder.observe({ now: 0, boardPoint: { x: 0, y: 0 }, targetId: "old" });
  const snapshot = recorder.observe({
    now: HAND_POINTING_WINDOW_MS + 1,
    boardPoint: { x: 0, y: 0 },
    targetId: "new",
  });
  assert.deepEqual(snapshot.targetIds, ["new"]);
});

test("a snapshot taken when speech started is never rewritten by later frames", () => {
  const recorder = new HandPointingRecorder();
  const atSpeechStart = recorder.observe({ now: 100, boardPoint: { x: 1, y: 2 }, targetId: "a" });
  recorder.observe({ now: 200, boardPoint: { x: 9, y: 9 }, targetId: "b" });
  assert.deepEqual(atSpeechStart.targetIds, ["a"]);
  assert.deepEqual(atSpeechStart.boardPoint, { x: 1, y: 2 });
  assert.ok(Object.isFrozen(atSpeechStart));
});

test("here, this and that resolve from the snapshot", () => {
  const recorder = new HandPointingRecorder();
  recorder.observe({ now: 100, boardPoint: { x: 1, y: 1 }, targetId: "user" });
  const snapshot = recorder.observe({ now: 200, boardPoint: { x: 300, y: 40 }, targetId: "api" });
  assert.deepEqual(resolveHandPointing(snapshot, { now: 1_000 }), {
    here: { x: 300, y: 40 },
    targetIds: ["api"],
  });
  assert.deepEqual(
    resolveHandPointing(snapshot, { now: 1_000, count: 2 }).targetIds,
    ["user", "api"],
    "“connect this to that” follows the order the hand visited them",
  );
  assert.deepEqual(resolveHandPointing(snapshot, { now: 200 + HAND_POINTING_WINDOW_MS + 1 }), {
    here: null,
    targetIds: [],
  });
});

test("a deleted shape is forgotten", () => {
  const recorder = new HandPointingRecorder();
  recorder.observe({ now: 100, boardPoint: null, targetId: "a" });
  recorder.observe({ now: 200, boardPoint: null, targetId: "b" });
  recorder.forget("a");
  assert.deepEqual(recorder.snapshot.targetIds, ["b"]);
});

test("resting the open hand on a shape adds it once, only while something is selected", () => {
  const tracker = new HandDwellSelectTracker({ dwellMs: 900, tolerancePx: 20 });
  const at = { x: 100, y: 100 };
  assert.equal(tracker.update({ now: 0, targetId: "b", screenPoint: at, eligible: true }), null);
  assert.equal(tracker.update({ now: 500, targetId: "b", screenPoint: at, eligible: true }), null);
  assert.equal(tracker.update({ now: 950, targetId: "b", screenPoint: at, eligible: true }), "b");
  assert.equal(
    tracker.update({ now: 2_000, targetId: "b", screenPoint: at, eligible: true }),
    null,
    "fires once per visit",
  );

  const idle = new HandDwellSelectTracker({ dwellMs: 900, tolerancePx: 20 });
  for (let now = 0; now <= 2_000; now += 100) {
    assert.equal(idle.update({ now, targetId: "b", screenPoint: at, eligible: false }), null);
  }
});

test("a hand passing over a shape doesn't select it", () => {
  const tracker = new HandDwellSelectTracker({ dwellMs: 900, tolerancePx: 20 });
  for (let now = 0, x = 0; now <= 2_000; now += 100, x += 30) {
    assert.equal(
      tracker.update({ now, targetId: "b", screenPoint: { x, y: 100 }, eligible: true }),
      null,
    );
  }
});

test("camera recovery backs off 1, 2, 4, 8 s and caps at 15 s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(cameraRecoveryDelayMs),
    [1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  );
  assert.ok(CAMERA_RECOVERY_MAX_ATTEMPTS >= 5);
});

test("camera recovery never retries a permission refusal", () => {
  assert.equal(shouldRetryCameraStart({ name: "NotAllowedError" }), false);
  assert.equal(shouldRetryCameraStart({ name: "SecurityError" }), false);
  assert.equal(shouldRetryCameraStart({ name: "NotReadableError" }), true, "camera busy in another app");
  assert.equal(shouldRetryCameraStart({ name: "NotFoundError" }), true, "camera unplugged");
  assert.equal(shouldRetryCameraStart(new Error("tracker")), true);
});

test("camera recovery says what stopped and when hands come back", () => {
  assert.equal(
    cameraRecoveryMessage("track_ended", 2_000),
    "The camera stopped. Restarting hands in 2 s…",
  );
  assert.match(cameraRecoveryMessage("tracker_error", 1_000), /^Hand tracking stopped/);
});

test("frames without a tracked hand let the last point go stale", () => {
  const recorder = new HandPointingRecorder();
  recorder.observe({ now: 1_000, boardPoint: { x: 5, y: 5 }, targetId: "a", tracked: true });
  // The controller keeps reporting its frozen cursor after the hand is lost.
  let snapshot = recorder.snapshot;
  for (let now = 1_100; now <= 20_000; now += 100) {
    snapshot = recorder.observe({ now, boardPoint: { x: 5, y: 5 }, targetId: "a", tracked: false });
  }
  assert.equal(snapshot.at, 1_000);
  assert.deepEqual(snapshot.targetIds, []);
  assert.deepEqual(resolveHandPointing(snapshot, { now: 20_000, maxAgeMs: 4_000 }), {
    here: null,
    targetIds: [],
  });
  // Shortly after the hand left, "here" still means where it was.
  assert.deepEqual(
    resolveHandPointing(recorder.observe({ now: 1_000, boardPoint: null, targetId: null, tracked: false }), {
      now: 2_000,
      maxAgeMs: 4_000,
    }).here,
    { x: 5, y: 5 },
  );
});
