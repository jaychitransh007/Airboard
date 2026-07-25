import assert from "node:assert/strict";
import test from "node:test";

import {
  SnapGestureTracker,
  snapLandmarkFrameConfidence,
} from "../src/features/board/snapGestureTracker.ts";

function hand({
  handedness = "Right",
  middleX = 0.5,
  contact = false,
  pinch = false,
  fist = false,
  snapCurl = false,
} = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.64, z: 0 };
  points[6] = { x: 0.42, y: 0.5, z: 0 };
  points[8] = {
    x: pinch ? 0.51 : 0.4,
    y: pinch ? 0.4 : fist ? 0.63 : 0.3,
    z: 0,
  };
  points[9] = { x: 0.5, y: 0.62, z: 0 };
  points[10] = { x: 0.5, y: 0.49, z: 0 };
  points[12] = { x: middleX, y: fist || snapCurl ? 0.62 : 0.36, z: 0 };
  points[13] = { x: 0.56, y: 0.64, z: 0 };
  points[14] = { x: 0.57, y: 0.51, z: 0 };
  points[16] = { x: 0.58, y: fist || snapCurl ? 0.64 : 0.32, z: 0 };
  points[17] = { x: 0.63, y: 0.67, z: 0 };
  points[18] = { x: 0.65, y: 0.54, z: 0 };
  points[20] = { x: 0.67, y: fist || snapCurl ? 0.68 : 0.38, z: 0 };
  points[4] = fist
    ? { x: middleX + 0.01, y: 0.64, z: 0 }
    : contact
      ? { x: middleX + 0.005, y: points[12].y + 0.005, z: 0 }
      : pinch
        ? { x: 0.505, y: 0.405, z: 0 }
        : { x: 0.31, y: 0.47, z: 0 };
  return { handedness, confidence: 0.98, landmarks: points };
}

function withThumb(source, x, y) {
  source.landmarks[4] = { x, y, z: 0 };
  return source;
}

function shiftHand(source, dx, dy) {
  source.landmarks = source.landmarks.map((point) => ({
    ...point,
    x: point.x + dx,
    y: point.y + dy,
  }));
  return source;
}

function frame(hands, timestampMs, suppressed = false) {
  return { hands, timestampMs, suppressed };
}

for (const handedness of ["Left", "Right"]) {
  test(`${handedness.toLowerCase()} visual snap triggers after contact and fast release`, () => {
    const tracker = new SnapGestureTracker();
    assert.equal(
      tracker.update(frame([hand({ handedness, contact: true })], 0)),
      "tracking",
    );
    assert.equal(
      tracker.update(frame([hand({ handedness, contact: true })], 40)),
      "tracking",
    );
    assert.equal(
      tracker.update(frame([hand({ handedness, middleX: 0.59, contact: false })], 140)),
      "snap",
    );
  });
}

test("slow release and jitter do not snap", () => {
  const slow = new SnapGestureTracker();
  slow.update(frame([hand({ contact: true })], 0));
  slow.update(frame([hand({ contact: true })], 40));
  assert.equal(slow.update(frame([hand({ middleX: 0.59 })], 600)), null);

  const jitter = new SnapGestureTracker();
  jitter.update(frame([hand({ contact: true })], 0));
  jitter.update(frame([hand({ contact: true })], 40));
  assert.equal(jitter.update(frame([hand({ middleX: 0.505 })], 120)), "tracking");
  assert.equal(jitter.update(frame([hand({ middleX: 0.505 })], 520)), null);
});

test("real-camera transition frames and a naturally curled snap pose remain armed", () => {
  const tracker = new SnapGestureTracker();
  assert.equal(
    tracker.update(frame([hand({ contact: true, snapCurl: true })], 0)),
    "tracking",
  );
  assert.equal(
    tracker.update(frame([hand({ contact: true, snapCurl: true })], 34)),
    "tracking",
  );
  assert.equal(
    tracker.update(
      frame(
        [withThumb(hand({ middleX: 0.52, snapCurl: true }), 0.43, 0.55)],
        68,
      ),
    ),
    "tracking",
  );
  assert.equal(
    tracker.update(frame([hand({ middleX: 0.62, snapCurl: true })], 118)),
    "snap",
  );
});

test("real snap triggers when MediaPipe keeps occluded fingertips in contact", () => {
  const tracker = new SnapGestureTracker();
  assert.equal(tracker.update(frame([hand({ contact: true })], 0)), "tracking");
  assert.equal(tracker.update(frame([hand({ contact: true })], 40)), "tracking");
  assert.equal(
    tracker.update(frame([hand({ contact: true, middleX: 0.57 })], 110)),
    "snap",
  );
});

test("armed snap survives a brief motion-blur tracking gap", () => {
  const tracker = new SnapGestureTracker();
  tracker.update(frame([hand({ contact: true })], 0));
  tracker.update(frame([hand({ contact: true })], 40));
  assert.equal(tracker.update(frame([], 74)), "tracking");
  assert.equal(
    tracker.update(frame([hand({ contact: false, middleX: 0.59 })], 125)),
    "snap",
  );
});

test("moving the whole contacting hand does not look like a snap", () => {
  const tracker = new SnapGestureTracker();
  tracker.update(frame([hand({ contact: true })], 0));
  tracker.update(frame([hand({ contact: true })], 40));
  assert.equal(
    tracker.update(frame([shiftHand(hand({ contact: true }), 0.12, -0.08)], 100)),
    "tracking",
  );
});

test("handedness label flicker does not discard one continuously tracked hand", () => {
  const tracker = new SnapGestureTracker();
  tracker.update(frame([hand({ handedness: "Right", contact: true })], 0));
  tracker.update(frame([hand({ handedness: "Left", contact: true })], 35));
  assert.equal(
    tracker.update(frame([hand({ handedness: "Right", middleX: 0.59 })], 120)),
    "snap",
  );
});

test("precision pinch, fist, conflicts, two hands, and tracking loss are rejected", () => {
  for (const rejected of [
    [hand({ contact: true, pinch: true })],
    [hand({ contact: true, fist: true })],
    [hand({ contact: true }), hand({ contact: true, handedness: "Left" })],
  ]) {
    const tracker = new SnapGestureTracker();
    tracker.update(frame(rejected, 0));
    tracker.update(frame(rejected, 40));
    assert.equal(tracker.update(frame([hand({ middleX: 0.59 })], 120)), null);
  }
  const suppressed = new SnapGestureTracker();
  suppressed.update(frame([hand({ contact: true })], 0, true));
  suppressed.update(frame([hand({ contact: true })], 40, true));
  assert.equal(suppressed.update(frame([hand({ middleX: 0.59 })], 120)), null);

  const lost = new SnapGestureTracker();
  lost.update(frame([hand({ contact: true })], 0));
  lost.update(frame([], 40));
  assert.equal(lost.update(frame([hand({ middleX: 0.59 })], 120)), null);
});

test("cooldown and neutral reset prevent repeated toggles", () => {
  const tracker = new SnapGestureTracker();
  tracker.update(frame([hand({ contact: true })], 0));
  tracker.update(frame([hand({ contact: true })], 40));
  assert.equal(tracker.update(frame([hand({ middleX: 0.59 })], 120)), "snap");
  tracker.update(frame([hand({ contact: true })], 200));
  tracker.update(frame([hand({ contact: true })], 240));
  assert.equal(tracker.update(frame([hand({ middleX: 0.59 })], 320)), null);
  tracker.update(frame([hand()], 1_050));
  tracker.update(frame([hand()], 1_090));
  tracker.update(frame([hand({ contact: true })], 1_140));
  tracker.update(frame([hand({ contact: true })], 1_180));
  assert.equal(tracker.update(frame([hand({ middleX: 0.59 })], 1_260)), "snap");
});

test("landmark confidence uses finite hand geometry rather than handedness certainty", () => {
  const valid = hand().landmarks;
  assert.equal(snapLandmarkFrameConfidence(valid), 1);
  const invalid = valid.map((point) => ({ ...point }));
  invalid[12].x = Number.NaN;
  assert.equal(snapLandmarkFrameConfidence(invalid), 0);
  assert.equal(snapLandmarkFrameConfidence(valid.slice(0, 20)), 0);
});
