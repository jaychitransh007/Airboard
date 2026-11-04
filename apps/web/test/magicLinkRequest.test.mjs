import assert from "node:assert/strict";
import test from "node:test";

import {
  PILOT_SUPPORT_EMAIL,
  magicLinkFailureMessage,
} from "../src/features/product/magicLinkRequest.ts";

test("an address the mailer refuses gets a way in instead of a raw error", () => {
  const message = magicLinkFailureMessage({
    name: "AuthApiError",
    code: "email_address_not_authorized",
    status: 400,
    message: "Email address not authorized",
  });
  assert.match(message, new RegExp(PILOT_SUPPORT_EMAIL));
  assert.doesNotMatch(message, /not authorized/i);
});

test("rate limits say how long to wait when Supabase says", () => {
  assert.equal(
    magicLinkFailureMessage({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "For security purposes, you can only request this after 42 seconds.",
    }),
    "Please wait 42 seconds before asking for another link.",
  );
  assert.match(
    magicLinkFailureMessage({ status: 429, message: "email rate limit exceeded" }),
    /Wait a minute/,
  );
});

test("invalid addresses, paused sign-ups and network failures read plainly", () => {
  assert.match(magicLinkFailureMessage({ code: "email_address_invalid" }), /doesn't look right/);
  assert.match(magicLinkFailureMessage({ code: "signup_disabled" }), /paused/);
  assert.match(magicLinkFailureMessage(new TypeError("Failed to fetch")), /connection/);
  assert.equal(
    magicLinkFailureMessage(new Error("unexpected")),
    "We couldn't send the sign-in link. Try again in a moment.",
  );
});
