import assert from "node:assert/strict";
import test from "node:test";

import { accessWindow, planName } from "../src/features/product/planLabels.ts";

test("billing shows plan names, not entitlement codes", () => {
  assert.equal(planName("personal_trial"), "Free pilot");
  assert.equal(planName("trial_pending"), "Free pilot");
  assert.equal(planName("team"), "Team");
  assert.equal(planName(undefined), "Free pilot");
  assert.equal(planName("design_partner"), "Design partner");
});

test("access dates read as active, ended, or not started", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  assert.match(accessWindow("2026-11-07T16:51:27Z", now), /^Active until /);
  assert.match(accessWindow("2026-11-01T16:51:27Z", now), /^Ended on /);
  assert.doesNotMatch(accessWindow("2026-11-01T16:51:27Z", now), /:/);
  assert.match(accessWindow(null, now), /starts when you open your first board/);
  assert.match(accessWindow("not a date", now), /starts when you open your first board/);
});
