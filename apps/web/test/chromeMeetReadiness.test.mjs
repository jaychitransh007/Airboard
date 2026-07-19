import assert from "node:assert/strict";
import test from "node:test";

import { chromeMeetReadiness } from "../src/features/product/chromeMeetReadiness.ts";

test("first-install readiness distinguishes distribution, consent, Meet, compositor and sender", () => {
  const steps = chromeMeetReadiness({
    linked: true,
    consented: true,
    entitled: true,
    preflightComplete: false,
    diagnostics: { meetingDetected: true, engineMounted: true, engaged: true, senderAttached: false },
  }, { detected: true, serverLinked: true, serverConsented: true, serverVerified: false });
  assert.deepEqual(steps.map((step) => step.complete), [true, true, true, true, true, false]);
  assert.match(steps[5].detail, /encoded frames/i);
});

test("a server-verified installation remains verified when the extension is temporarily offline", () => {
  const steps = chromeMeetReadiness(null, {
    detected: false,
    serverLinked: true,
    serverConsented: true,
    serverVerified: true,
  });
  assert.equal(steps[0].complete, false);
  assert.equal(steps[1].complete, true);
  assert.equal(steps[2].complete, true);
  assert.equal(steps[5].complete, true);
});
