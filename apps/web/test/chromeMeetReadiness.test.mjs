import assert from "node:assert/strict";
import test from "node:test";

import { chromeMeetReadiness } from "../src/features/product/chromeMeetReadiness.ts";

test("first-install readiness distinguishes distribution, consent, Meet, compositor and sender", () => {
  const steps = chromeMeetReadiness({
    linked: true,
    consented: true,
    entitled: true,
    preflightComplete: false,
    statusFresh: true,
    verifiedMeetingSessionId: "meet-session-1",
    verificationExpiresAt: "2026-08-02T12:01:00.000Z",
    diagnostics: {
      meetingDetected: true,
      engineMounted: true,
      engaged: true,
      senderAttached: false,
      meetingSessionId: "meet-session-1",
    },
  }, {
    detected: true,
    serverLinked: true,
    serverConsented: true,
    serverVerified: false,
    nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
  });
  assert.deepEqual(steps.map((step) => step.complete), [true, true, true, true, true, false]);
  assert.match(steps[5].detail, /encoded frames/i);
});

test("historical server verification never marks an offline installation currently ready", () => {
  const steps = chromeMeetReadiness(null, {
    detected: false,
    serverLinked: true,
    serverConsented: true,
    serverVerified: true,
  });
  assert.equal(steps[0].complete, false);
  assert.equal(steps[1].complete, true);
  assert.equal(steps[2].complete, true);
  assert.equal(steps[5].complete, false);
  assert.match(steps[5].detail, /previous meeting/i);
});

test("outgoing video is ready only for a fresh verification from the active meeting session", () => {
  const nowMs = Date.parse("2026-08-02T12:00:00.000Z");
  const steps = chromeMeetReadiness({
    linked: true,
    consented: true,
    entitled: true,
    preflightComplete: true,
    statusFresh: true,
    verifiedMeetingSessionId: "meet-session-current",
    verificationExpiresAt: "2026-08-02T12:00:15.000Z",
    diagnostics: {
      meetingDetected: true,
      engineMounted: true,
      engaged: true,
      senderAttached: true,
      framesEncoded: 12,
      bytesSent: 34_000,
      meetingSessionId: "meet-session-current",
    },
  }, {
    detected: true,
    serverLinked: true,
    serverConsented: true,
    serverVerified: true,
    nowMs,
  });
  assert.deepEqual(steps.map((step) => step.complete), [true, true, true, true, true, true]);
});

test("expired or cross-session sender evidence fails closed", () => {
  const base = {
    linked: true,
    consented: true,
    entitled: true,
    preflightComplete: true,
    statusFresh: true,
    verifiedMeetingSessionId: "meet-session-old",
    verificationExpiresAt: "2026-08-02T11:59:59.000Z",
    diagnostics: {
      meetingDetected: true,
      engineMounted: true,
      engaged: true,
      senderAttached: true,
      framesEncoded: 12,
      bytesSent: 34_000,
      meetingSessionId: "meet-session-current",
    },
  };
  const steps = chromeMeetReadiness(base, {
    detected: true,
    serverLinked: true,
    serverConsented: true,
    serverVerified: true,
    nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
  });
  assert.equal(steps[5].complete, false);
});
