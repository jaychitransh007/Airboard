import assert from "node:assert/strict";
import test from "node:test";

import { wrappedFocusIndex } from "../src/platform/modalFocus.ts";

test("Tab wraps around a dialog's controls and pulls stray focus back in", () => {
  // Three controls: Tab from the last goes to the first, Shift+Tab from the first to the last.
  assert.equal(wrappedFocusIndex(3, 2, false), 0);
  assert.equal(wrappedFocusIndex(3, 0, true), 2);
  // In the middle the browser's own order is already right.
  assert.equal(wrappedFocusIndex(3, 1, false), null);
  assert.equal(wrappedFocusIndex(3, 1, true), null);
  // Focus outside the dialog comes back to its first (or, backwards, last) control.
  assert.equal(wrappedFocusIndex(3, -1, false), 0);
  assert.equal(wrappedFocusIndex(3, -1, true), 2);
  assert.equal(wrappedFocusIndex(0, -1, false), null);
});
