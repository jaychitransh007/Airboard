import assert from "node:assert/strict";
import test from "node:test";

import { HoldToEditTracker } from "../src/features/board/holdToEditTracker.ts";
import { UndoGestureTracker } from "../src/features/board/undoGestureTracker.ts";
import {
  chooseDockGestureTarget,
  DockGestureActivationTracker,
} from "../src/features/board/dockGestureActivation.ts";

const P = { x: 0.5, y: 0.4 };

test("dock choose accepts a close that began before entering and fires once", () => {
  const tracker = new DockGestureActivationTracker();
  assert.equal(tracker.activate(null, true), null, "closed before reaching a tool");
  assert.equal(tracker.activate("flow", true), "flow", "first reached tool activates");
  assert.equal(tracker.activate("system", true), null, "same close cannot activate a neighbor");
  tracker.release();
  assert.equal(tracker.activate("system", true), "system", "reopening arms another choice");
});

test("dock choose uses padded hit areas and resolves overlap by nearest center", () => {
  const targets = [
    {
      id: "flow",
      bounds: { left: 0, top: 0, width: 40, height: 40 },
    },
    {
      id: "system",
      bounds: { left: 45, top: 0, width: 40, height: 40 },
    },
  ];
  assert.equal(
    chooseDockGestureTarget({ x: 43, y: 20 }, targets, 10),
    "system",
  );
  assert.equal(
    chooseDockGestureTarget(
      { x: 20, y: 20 },
      [{ ...targets[0], disabled: true }],
      10,
    ),
    null,
  );
});

test("hold-to-edit scopes after holding an element still", () => {
  const tracker = new HoldToEditTracker();
  const grab = (x, now) => ({
    interaction: { strokeId: "s1", point: { x, y: 100 } },
    now,
    scopedActiveForStroke: false,
  });
  assert.equal(tracker.update(grab(100, 0)), null);
  assert.equal(tracker.update(grab(104, 300)), null, "within tolerance");
  assert.deepEqual(tracker.update(grab(104, 650)), { type: "scope", strokeId: "s1" });
});

test("hold-to-edit never scopes a moving drag", () => {
  const tracker = new HoldToEditTracker();
  const at = (x, now) => ({
    interaction: { strokeId: "s1", point: { x, y: 100 } },
    now,
    scopedActiveForStroke: false,
  });
  tracker.update(at(100, 0));
  tracker.update(at(140, 200)); // moved 40px — a drag
  assert.equal(tracker.update(at(140, 900)), null, "a drag stays a drag");
});

test("hold-to-edit emits released when the grab ends, and re-arms per grab", () => {
  const tracker = new HoldToEditTracker();
  const grab = (now) => ({
    interaction: { strokeId: "s2", point: { x: 50, y: 50 } },
    now,
    scopedActiveForStroke: false,
  });
  tracker.update(grab(0));
  assert.deepEqual(tracker.update(grab(700)), { type: "scope", strokeId: "s2" });
  assert.deepEqual(
    tracker.update({ interaction: null, now: 800, scopedActiveForStroke: false }),
    { type: "released" },
  );
  assert.equal(
    tracker.update({ interaction: null, now: 900, scopedActiveForStroke: false }),
    null,
    "released fires once",
  );
});

test("hold-to-edit does not re-fire while the element is already scoped", () => {
  const tracker = new HoldToEditTracker();
  const grab = (now, scoped) => ({
    interaction: { strokeId: "s3", point: { x: 10, y: 10 } },
    now,
    scopedActiveForStroke: scoped,
  });
  tracker.update(grab(0, false));
  assert.deepEqual(tracker.update(grab(700, false)), { type: "scope", strokeId: "s3" });
  assert.equal(tracker.update(grab(1_400, true)), null);
});

test("a single presented palm swiped left emits one undo", () => {
  const tracker = new UndoGestureTracker();
  const frame = (x, timestampMs) => ({
    score: 0.9,
    point: { x, y: 0.45 },
    timestampMs,
    suppressed: false,
  });
  assert.equal(tracker.update(frame(0.2, 0)), null);
  assert.equal(
    tracker.update(frame(0.3, 80)),
    "tracking",
    "directional open-palm motion reserves Undo",
  );
  assert.equal(
    tracker.update(frame(0.42, 180)),
    "undo",
    "raw camera motion right is a visible swipe left after mirroring",
  );
});

test("one motion-blurred open-palm score dropout preserves the swipe origin", () => {
  const tracker = new UndoGestureTracker();
  const frame = (x, timestampMs, score = 0.9, point = { x, y: 0.45 }) => ({
    score,
    point,
    timestampMs,
    suppressed: false,
  });

  assert.equal(tracker.update(frame(0.2, 0)), null);
  assert.equal(tracker.update(frame(0.25, 60)), null);
  assert.equal(tracker.update(frame(0.25, 93, 0, null)), null);
  assert.equal(tracker.update(frame(0.32, 126)), "tracking");
  assert.equal(tracker.update(frame(0.43, 190)), "undo");
});

test("open-palm score hysteresis preserves motion but requires recovery to fire", () => {
  const tracker = new UndoGestureTracker();
  const frame = (x, timestampMs, score) => ({
    score,
    point: { x, y: 0.45 },
    timestampMs,
    suppressed: false,
  });

  assert.equal(tracker.update(frame(0.2, 0, 0.9)), null);
  assert.equal(tracker.update(frame(0.3, 80, 0.55)), "tracking");
  assert.equal(tracker.update(frame(0.42, 180, 0.55)), "tracking");
  assert.equal(tracker.update(frame(0.44, 210, 0.9)), "undo");
});

test("undo swipe rejects vertical motion, suppression, and repeat firing", () => {
  const vertical = new UndoGestureTracker();
  vertical.update({
    score: 0.9,
    point: { x: 0.2, y: 0.2 },
    timestampMs: 0,
    suppressed: false,
  });
  assert.equal(
    vertical.update({
      score: 0.9,
      point: { x: 0.45, y: 0.42 },
      timestampMs: 180,
      suppressed: false,
    }),
    null,
    "diagonal motion is not undo",
  );

  const tracker = new UndoGestureTracker();
  const frame = (x, timestampMs, suppressed = false) => ({
    score: 0.9,
    point: { x, y: 0.45 },
    timestampMs,
    suppressed,
  });
  tracker.update(frame(0.2, 0, true));
  assert.equal(tracker.update(frame(0.45, 180, true)), null, "two-hand/navigation suppresses undo");
  tracker.update(frame(0.2, 300));
  assert.equal(tracker.update(frame(0.45, 480)), "undo");
  assert.equal(tracker.update(frame(0.7, 600)), null, "latched palm cannot undo twice");
  tracker.update({ score: 0.1, point: null, timestampMs: 700, suppressed: false });
  tracker.update({ score: 0.1, point: null, timestampMs: 900, suppressed: false });
  tracker.update(frame(0.2, 1_800));
  assert.equal(tracker.update(frame(0.45, 2_000)), "undo", "release and cooldown re-arm");
});

test("still open-palm jitter never triggers Undo", () => {
  const tracker = new UndoGestureTracker();
  const frame = (x, y, timestampMs) => ({
    score: 0.9,
    point: { x, y },
    timestampMs,
    suppressed: false,
  });
  assert.equal(tracker.update(frame(0.5, 0.45, 0)), null);
  assert.equal(tracker.update(frame(0.48, 0.46, 120)), null);
  assert.equal(tracker.update(frame(0.51, 0.44, 300)), null);
});
