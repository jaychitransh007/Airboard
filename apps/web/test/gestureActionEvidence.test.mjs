import assert from "node:assert/strict";
import test from "node:test";

import {
  GestureActionEvidenceTracker,
  holdToEditActionEvidence,
} from "../src/features/board/gestureActionEvidence.ts";

test("navigation evidence emits exactly once per engaged session", () => {
  const tracker = new GestureActionEvidenceTracker();

  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: false,
      updateMode: "idle",
    }),
    null,
  );
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "pan",
    }),
    "navigation_pan",
  );
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "pan",
    }),
    null,
  );
  assert.equal(
    tracker.observeNavigation({
      reserving: false,
      engaged: false,
      updateMode: "idle",
    }),
    null,
  );
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "pan",
    }),
    "navigation_pan",
  );
});

test("navigation cannot emit a second mode until the session is reset", () => {
  const tracker = new GestureActionEvidenceTracker();
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "zoom",
    }),
    "navigation_zoom",
  );
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "pan",
    }),
    null,
  );
  tracker.reset();
  assert.equal(
    tracker.observeNavigation({
      reserving: true,
      engaged: true,
      updateMode: "zoom",
    }),
    "navigation_zoom",
  );
});

test("hold-to-edit evidence exists only when scoped editing actually opens", () => {
  assert.equal(holdToEditActionEvidence(null), null);
  assert.equal(
    holdToEditActionEvidence({ type: "released" }),
    null,
  );
  assert.equal(
    holdToEditActionEvidence({
      type: "scope",
      strokeId: "opaque-target",
    }),
    "hold_to_edit_scope",
  );
});
