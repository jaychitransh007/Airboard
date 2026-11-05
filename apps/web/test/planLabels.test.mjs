import assert from "node:assert/strict";
import test from "node:test";

import { accessState, accessWindow, planName } from "../src/features/product/planLabels.ts";

test("billing shows plan names, not entitlement codes", () => {
  assert.equal(planName("personal_trial"), "Free pilot");
  assert.equal(planName("trial_pending"), "Free pilot");
  assert.equal(planName("team"), "Team");
  assert.equal(planName(undefined), "Free pilot");
  assert.equal(planName("design_partner"), "Design partner");
});

test("access dates read as active, ended, or not started", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const trial = (status, validUntil) => ({ status, validUntil });
  assert.match(accessWindow(trial("trialing", "2026-11-07T16:51:27Z"), now), /^Active until /);
  assert.match(accessWindow(trial("trialing", "2026-11-01T16:51:27Z"), now), /^Ended on /);
  assert.doesNotMatch(accessWindow(trial("trialing", "2026-11-01T16:51:27Z"), now), /:/);
  assert.match(accessWindow(null, now), /starts when you open your first board/);
  assert.equal(accessWindow(trial("active", null), now), "Active");
  assert.equal(accessWindow(trial("expired", "not a date"), now), "Ended");
});

test("an ended pilot reads as ended, and a pending one as not started", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  // The lifecycle job marks a finished trial expired; /me now reports it.
  assert.equal(accessState({ status: "expired", validUntil: "2026-11-01T00:00:00Z" }, now), "ended");
  assert.equal(accessState({ status: "canceled", validUntil: "2026-12-01T00:00:00Z" }, now), "ended");
  // Trialing past its end, before the hourly sweep runs.
  assert.equal(accessState({ status: "trialing", validUntil: "2026-11-01T00:00:00Z" }, now), "ended");
  // A pending trial stores its sign-up time as validUntil; that is not an end.
  assert.equal(accessState({ status: "pending", validUntil: "2026-11-01T00:00:00Z" }, now), "not_started");
  assert.match(accessWindow({ status: "pending", validUntil: "2026-11-01T00:00:00Z" }, now), /starts when you open your first board/);
  assert.equal(accessState({ status: "trialing", validUntil: "2026-12-01T00:00:00Z" }, now), "active");
  assert.equal(accessState(null, now), "not_started");
});
