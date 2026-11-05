import assert from "node:assert/strict";
import test from "node:test";

import {
  handPerceptionOptions,
} from "../src/features/board/gesturePerceptionConfig.ts";

test("Hand confidence controls real detector, presence, and tracking gates", () => {
  const permissive = handPerceptionOptions(0.42);
  const strict = handPerceptionOptions(0.88);
  for (const key of Object.keys(permissive)) {
    assert.equal(permissive[key], 0.42);
    assert.equal(strict[key], 0.88);
    assert.ok(strict[key] > permissive[key], `${key} is parameter-sensitive`);
  }
});

test("Hand confidence clamps invalid and out-of-range settings", () => {
  assert.deepEqual(handPerceptionOptions(Number.NaN), {
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  assert.equal(handPerceptionOptions(0).minTrackingConfidence, 0.4);
  assert.equal(handPerceptionOptions(1).minTrackingConfidence, 0.95);
});
