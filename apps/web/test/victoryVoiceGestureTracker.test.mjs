import assert from "node:assert/strict";
import test from "node:test";

import { VictoryVoiceGestureTracker } from "../src/features/board/victoryVoiceGestureTracker.ts";

const POINT = { x: 0.48, y: 0.4 };

const frame = (timestampMs, overrides = {}) => ({
  score: 0.9,
  point: POINT,
  timestampMs,
  suppressed: false,
  ...overrides,
});

test("a stable Victory pose activates one voice turn after 400 ms", () => {
  const tracker = new VictoryVoiceGestureTracker();

  assert.equal(tracker.update(frame(0)), null);
  assert.equal(tracker.reserving, true);
  assert.equal(tracker.update(frame(200)), null);
  assert.equal(tracker.update(frame(399)), null);
  assert.equal(tracker.update(frame(400)), "activate");
  assert.equal(tracker.engaged, true);

  assert.equal(tracker.update(frame(700)), null, "a held V cannot fire twice");
  assert.equal(tracker.update(frame(1_500)), null, "latching outlives cooldown");
});

test("movement restarts the stable-hold clock", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  assert.equal(
    tracker.update(frame(250, { point: { x: 0.6, y: 0.4 } })),
    null,
  );
  assert.equal(tracker.update(frame(600, { point: { x: 0.6, y: 0.4 } })), null);
  assert.equal(
    tracker.update(frame(650, { point: { x: 0.6, y: 0.4 } })),
    "activate",
  );
});

test("confidence hysteresis tolerates a weak frame but never activates on one", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  assert.equal(tracker.update(frame(250, { score: 0.6 })), null);
  assert.equal(tracker.reserving, true, "hysteresis preserves the candidate");
  assert.equal(
    tracker.update(frame(400, { score: 0.6 })),
    null,
    "confidence must recover before activation",
  );
  assert.equal(tracker.update(frame(430)), "activate");

  const dropped = new VictoryVoiceGestureTracker();
  dropped.update(frame(0));
  dropped.update(frame(250, { score: 0.3 }));
  assert.equal(dropped.reserving, false, "falling below release cancels the hold");
  assert.equal(dropped.update(frame(500)), null, "recovery begins a new hold");
  assert.equal(dropped.update(frame(899)), null);
  assert.equal(dropped.update(frame(900)), "activate");
});

test("one motion-blurred classifier dropout does not erase a valid hold", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  tracker.update(frame(180));
  assert.equal(
    tracker.update(frame(213, { score: 0, point: null })),
    null,
  );
  assert.equal(tracker.reserving, true);
  assert.equal(tracker.update(frame(246)), null);
  assert.equal(tracker.update(frame(400)), "activate");
});

test("suppression and an ambiguous hand count cannot arm Victory", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0, { suppressed: true }));
  assert.equal(tracker.update(frame(500, { suppressed: true })), null);
  assert.equal(tracker.reserving, false);

  tracker.update(frame(600, { point: null }));
  assert.equal(tracker.update(frame(1_100, { point: null })), null);
  assert.equal(tracker.reserving, false);

  assert.equal(tracker.update(frame(1_200)), null);
  assert.equal(tracker.update(frame(1_600)), "activate");
});

test("suppression releases an already-active voice gate", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  assert.equal(tracker.update(frame(400)), "activate");
  assert.equal(tracker.update(frame(500, { suppressed: true })), null);
  assert.equal(
    tracker.update(frame(720, { suppressed: true })),
    "release",
  );
  assert.equal(tracker.engaged, false);
});

test("sustained release and cooldown are both required before re-arming", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  assert.equal(tracker.update(frame(400)), "activate");

  tracker.update(frame(500, { score: 0.2, point: null }));
  tracker.update(frame(650, { score: 0.2, point: null }));
  assert.equal(tracker.engaged, true, "release debounce has not elapsed");
  assert.equal(
    tracker.update(frame(720, { score: 0.2, point: null })),
    null,
  );
  assert.equal(
    tracker.update(frame(740, { score: 0.2, point: null })),
    "release",
  );
  assert.equal(tracker.engaged, false);

  tracker.update(frame(800));
  tracker.update(frame(1_250));
  assert.equal(tracker.reserving, false, "cooldown blocks early candidates");

  assert.equal(tracker.update(frame(1_300)), null);
  assert.equal(tracker.update(frame(1_700)), "activate");
});

test("reset clears a partial or latched activation immediately", () => {
  const tracker = new VictoryVoiceGestureTracker();

  tracker.update(frame(0));
  assert.equal(tracker.reserving, true);
  tracker.reset();
  assert.equal(tracker.reserving, false);
  assert.equal(tracker.engaged, false);
  assert.equal(tracker.update(frame(500)), null);
  assert.equal(tracker.update(frame(900)), "activate");
});
