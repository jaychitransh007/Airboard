import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERACTION_ATTRIBUTION_WINDOW_MS,
  InteractionAttributionTracker,
  createInteractionIntentKey,
  isExplicitInteractionCorrection,
} from "../src/features/board/interactionAttribution.ts";

test("attributes exact undo-stack origins inside the ten-second window", () => {
  const tracker = new InteractionAttributionTracker();
  tracker.record({
    interactionId: "voice-applied-1",
    outcome: "applied",
    occurredAtMs: 1_000,
  });

  assert.deepEqual(
    tracker.attribute({
      kind: "undo",
      originatingInteractionId: "voice-applied-1",
      followUpInteractionId: "voice-undo-0001",
      occurredAtMs: 11_000,
    }),
    {
      kind: "undo",
      originatingInteractionId: "voice-applied-1",
      followUpInteractionId: "voice-undo-0001",
      delayMs: INTERACTION_ATTRIBUTION_WINDOW_MS,
    },
  );
});

test("does not attribute undo after the window or to an unrelated stack entry", () => {
  const tracker = new InteractionAttributionTracker();
  tracker.record({
    interactionId: "voice-applied-2",
    outcome: "applied",
    occurredAtMs: 1_000,
  });

  assert.equal(
    tracker.attribute({
      kind: "undo",
      originatingInteractionId: "different-turn",
      occurredAtMs: 2_000,
    }),
    null,
  );
  assert.equal(
    tracker.attribute({
      kind: "undo",
      originatingInteractionId: "voice-applied-2",
      occurredAtMs: 11_001,
    }),
    null,
  );
});

test("retry requires a matching content-free intent fingerprint", () => {
  const tracker = new InteractionAttributionTracker();
  const intentKey = createInteractionIntentKey("  Add an API, please! ");
  tracker.record({
    interactionId: "voice-rejected-1",
    outcome: "rejected",
    occurredAtMs: 4_000,
    intentKey,
  });

  assert.equal(
    tracker.attribute({
      kind: "retry",
      followUpInteractionId: "voice-retry-other",
      occurredAtMs: 5_000,
      intentKey: createInteractionIntentKey("Delete the database"),
    }),
    null,
  );
  const attribution = tracker.attribute({
    kind: "retry",
    followUpInteractionId: "voice-retry-0001",
    occurredAtMs: 5_500,
    intentKey: createInteractionIntentKey("add an api please"),
  });
  assert.equal(attribution?.originatingInteractionId, "voice-rejected-1");
  assert.equal(attribution?.delayMs, 1_500);
  assert.equal(JSON.stringify(attribution).includes("Add an API"), false);
});

test("correction selects only the latest applied interaction", () => {
  const tracker = new InteractionAttributionTracker();
  tracker.record({
    interactionId: "voice-rejected-2",
    outcome: "rejected",
    occurredAtMs: 1_000,
    intentKey: createInteractionIntentKey("add API"),
  });
  tracker.record({
    interactionId: "voice-applied-3",
    outcome: "applied",
    occurredAtMs: 2_000,
  });

  assert.deepEqual(
    tracker.attribute({
      kind: "correction",
      followUpInteractionId: "voice-correct-1",
      occurredAtMs: 3_000,
    }),
    {
      kind: "correction",
      originatingInteractionId: "voice-applied-3",
      followUpInteractionId: "voice-correct-1",
      delayMs: 1_000,
    },
  );
});

test("each follow-up kind is emitted at most once per origin", () => {
  const tracker = new InteractionAttributionTracker();
  tracker.record({
    interactionId: "voice-applied-4",
    outcome: "applied",
    occurredAtMs: 1_000,
  });
  const input = {
    kind: "correction",
    followUpInteractionId: "voice-correct-2",
    occurredAtMs: 2_000,
  };
  assert.notEqual(tracker.attribute(input), null);
  assert.equal(tracker.attribute(input), null);
});

test("bounded storage forgets displaced interactions", () => {
  const tracker = new InteractionAttributionTracker(10_000, 1);
  tracker.record({
    interactionId: "voice-applied-5",
    outcome: "applied",
    occurredAtMs: 1_000,
  });
  tracker.record({
    interactionId: "voice-applied-6",
    outcome: "applied",
    occurredAtMs: 1_500,
  });
  assert.equal(
    tracker.attribute({
      kind: "undo",
      originatingInteractionId: "voice-applied-5",
      occurredAtMs: 2_000,
    }),
    null,
  );
});

test("explicit correction detection is narrow and content remains local", () => {
  assert.equal(isExplicitInteractionCorrection("Actually, move it left"), true);
  assert.equal(isExplicitInteractionCorrection("I meant the API node"), true);
  assert.equal(isExplicitInteractionCorrection("Make that node blue"), true);
  assert.equal(isExplicitInteractionCorrection("Add another API node"), false);
  assert.equal(isExplicitInteractionCorrection("Connect API to database"), false);
});
