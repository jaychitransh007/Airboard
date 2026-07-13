import assert from "node:assert/strict";
import test from "node:test";

import { PalmGateTracker } from "../src/features/board/palmGateTracker.ts";
import { HoldToEditTracker } from "../src/features/board/holdToEditTracker.ts";

const P = { x: 0.5, y: 0.4 };

test("palm gate engages only after the pose holds still for the debounce", () => {
  const tracker = new PalmGateTracker();
  const base = { score: 0.8, point: P, gateOpen: false, suppressed: false };
  assert.equal(tracker.update({ ...base, timestampMs: 0 }), null, "first frame arms");
  assert.equal(tracker.update({ ...base, timestampMs: 100 }), null, "too early");
  assert.equal(tracker.update({ ...base, timestampMs: 300 }), "engage");
});

test("palm gate never engages while moving — drift re-arms the debounce", () => {
  const tracker = new PalmGateTracker();
  const base = { score: 0.8, gateOpen: false, suppressed: false };
  tracker.update({ ...base, point: { x: 0.2, y: 0.4 }, timestampMs: 0 });
  tracker.update({ ...base, point: { x: 0.4, y: 0.4 }, timestampMs: 150 }); // drift > radius
  assert.equal(
    tracker.update({ ...base, point: { x: 0.4, y: 0.4 }, timestampMs: 300 }),
    null,
    "clock restarted at the drift",
  );
  assert.equal(tracker.update({ ...base, point: { x: 0.4, y: 0.4 }, timestampMs: 440 }), "engage");
});

test("palm gate release requires sustained sub-threshold score (hysteresis)", () => {
  const tracker = new PalmGateTracker();
  const open = { point: P, gateOpen: true, suppressed: false };
  // In the hysteresis band: no release.
  assert.equal(tracker.update({ ...open, score: 0.5, timestampMs: 0 }), null);
  // Below release score, but not yet sustained.
  assert.equal(tracker.update({ ...open, score: 0.2, timestampMs: 10 }), null);
  assert.equal(tracker.update({ ...open, score: 0.2, timestampMs: 100 }), null);
  // A strong pose frame cancels the countdown.
  assert.equal(tracker.update({ ...open, score: 0.7, point: P, timestampMs: 150 }), null);
  assert.equal(tracker.update({ ...open, score: 0.1, timestampMs: 200 }), null);
  assert.equal(tracker.update({ ...open, score: 0.1, timestampMs: 460 }), "release");
});

test("palm gate is suppressed while another gate outranks it", () => {
  const tracker = new PalmGateTracker();
  const base = { score: 0.9, point: P, gateOpen: false, suppressed: true };
  tracker.update({ ...base, timestampMs: 0 });
  assert.equal(tracker.update({ ...base, timestampMs: 500 }), null, "suppressed");
  assert.equal(
    tracker.update({ ...base, suppressed: false, timestampMs: 600 }),
    "engage",
    "engages immediately once unsuppressed (candidate never dropped)",
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
