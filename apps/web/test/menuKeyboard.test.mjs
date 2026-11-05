import assert from "node:assert/strict";
import test from "node:test";

import { menuFocusIndex } from "../src/platform/menuKeyboard.ts";

test("arrow keys step through a menu and wrap; Home and End jump to the ends", () => {
  assert.equal(menuFocusIndex(4, 0, "ArrowDown"), 1);
  assert.equal(menuFocusIndex(4, 3, "ArrowDown"), 0);
  assert.equal(menuFocusIndex(4, 0, "ArrowUp"), 3);
  assert.equal(menuFocusIndex(4, 2, "ArrowRight"), 3);
  assert.equal(menuFocusIndex(4, 2, "ArrowLeft"), 1);
  assert.equal(menuFocusIndex(4, 2, "Home"), 0);
  assert.equal(menuFocusIndex(4, 1, "End"), 3);
  // From outside the menu, Down enters at the top and Up at the bottom.
  assert.equal(menuFocusIndex(4, -1, "ArrowDown"), 0);
  assert.equal(menuFocusIndex(4, -1, "ArrowUp"), 3);
  assert.equal(menuFocusIndex(4, 1, "Enter"), null);
  assert.equal(menuFocusIndex(0, -1, "ArrowDown"), null);
});
