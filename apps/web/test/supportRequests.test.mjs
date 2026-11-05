import assert from "node:assert/strict";
import test from "node:test";

import {
  pilotExtensionRequest,
  pilotExtensionStorageKey,
  waitlistRequest,
  waitlistStorageKey,
} from "../src/features/product/supportRequests.ts";

// The API requires a 3–160 character subject and a 10+ character message.
function assertAcceptedByApi(request) {
  assert.ok(request.category.length >= 2 && request.category.length <= 40);
  assert.ok(request.subject.length >= 3 && request.subject.length <= 160);
  assert.ok(request.message.length >= 10);
}

test("asking to hear about a surface files a waitlist support request", () => {
  assert.deepEqual(waitlistRequest("google_meet"), {
    category: "waitlist",
    subject: "Waitlist: Airboard for Google Meet",
    message: "Please let me know when Airboard for Google Meet is available for my workspace.",
  });
  for (const surface of ["google_meet", "desktop", "zoom", "teams"]) {
    assertAcceptedByApi(waitlistRequest(surface));
  }
  assert.equal(waitlistStorageKey("desktop"), "airboard.waitlist.desktop.v1");
});

test("asking for more pilot time files a request remembered per ended pilot", () => {
  const request = pilotExtensionRequest();
  assert.equal(request.category, "pilot_extension");
  assertAcceptedByApi(request);
  // A pilot that is extended and ends again can be asked about again.
  assert.notEqual(
    pilotExtensionStorageKey("2026-10-01T00:00:00Z"),
    pilotExtensionStorageKey("2026-11-01T00:00:00Z"),
  );
  assert.equal(pilotExtensionStorageKey(undefined), "airboard.pilot-extension.unknown.v1");
});
