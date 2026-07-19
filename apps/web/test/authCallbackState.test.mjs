import assert from "node:assert/strict";
import test from "node:test";

import { authCallbackFailure } from "../src/features/product/authCallbackState.ts";

test("maps an expired Supabase confirmation to a recoverable resend path", () => {
  const params = new URLSearchParams({ error: "access_denied", error_code: "otp_expired" });
  assert.deepEqual(authCallbackFailure(params), {
    title: "This confirmation link has expired.",
    detail: "Email confirmation links are time-limited and can be used only once. Request a new secure link to continue.",
    actionHref: "/signup?reason=confirmation_link_expired",
    actionLabel: "Email me a new link",
  });
});

test("leaves successful PKCE callbacks in the session-exchange state", () => {
  assert.equal(authCallbackFailure(new URLSearchParams({ code: "pkce-code" })), null);
});

test("fails closed with a fresh-link action for unknown provider errors", () => {
  const failure = authCallbackFailure(new URLSearchParams({ error: "access_denied" }));
  assert.equal(failure?.actionHref, "/login?reason=authentication_failed");
});
