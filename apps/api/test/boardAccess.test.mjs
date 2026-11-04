import assert from "node:assert/strict";
import test from "node:test";

import { boardAccessFilter } from "../src/boardAccess.ts";

test("private boards are limited to their owner; shared boards to members", () => {
  assert.equal(
    boardAccessFilter("33333333-3333-4333-8333-333333333333"),
    "visibility.neq.private,owner_profile_id.eq.33333333-3333-4333-8333-333333333333",
  );
});

test("a malformed profile id cannot widen the filter", () => {
  assert.throws(() => boardAccessFilter("x,visibility.eq.private"), /INVALID_PROFILE_ID/);
  assert.throws(() => boardAccessFilter(""), /INVALID_PROFILE_ID/);
});
