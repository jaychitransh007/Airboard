import assert from "node:assert/strict";
import test from "node:test";

import { authCallbackFailure, authCallbackPathFromHome } from "../src/features/product/authCallbackState.ts";

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

test("a sign-in that lands on the home page is forwarded to the callback", () => {
  assert.equal(authCallbackPathFromHome({}), null);
  assert.equal(authCallbackPathFromHome({ utm_source: "mail" }), null);
  assert.equal(authCallbackPathFromHome({ code: "abc" }), "/auth/callback?code=abc");
  assert.equal(
    authCallbackPathFromHome({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" }),
    "/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
});
