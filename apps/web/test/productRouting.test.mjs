import assert from "node:assert/strict";
import test from "node:test";

import { isImmersiveBoardPath } from "../src/features/product/productRouting.ts";

test("live board routes exclude product navigation from the canvas viewport", () => {
  assert.equal(isImmersiveBoardPath("/app/boards/board-123"), true);
  assert.equal(isImmersiveBoardPath("/app/boards/new"), true);
  assert.equal(isImmersiveBoardPath("/app/boards/live"), true);
  assert.equal(isImmersiveBoardPath("/app/boards"), false, "the board library keeps navigation");
  assert.equal(isImmersiveBoardPath("/app/settings/profile"), false);
});
