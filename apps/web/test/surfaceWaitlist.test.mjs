import assert from "node:assert/strict";
import test from "node:test";

import { waitlistRequest, waitlistStorageKey } from "../src/features/product/surfaceWaitlist.ts";

test("asking to hear about a surface files a waitlist support request", () => {
  assert.deepEqual(waitlistRequest("google_meet"), {
    category: "waitlist",
    subject: "Waitlist: Airboard for Google Meet",
    message: "Please let me know when Airboard for Google Meet is available for my workspace.",
  });
  // The API requires a 3–160 character subject and a 10+ character message.
  for (const surface of ["google_meet", "desktop", "zoom", "teams"]) {
    const request = waitlistRequest(surface);
    assert.ok(request.subject.length >= 3 && request.subject.length <= 160);
    assert.ok(request.message.length >= 10);
  }
  assert.equal(waitlistStorageKey("desktop"), "airboard.waitlist.desktop.v1");
});
