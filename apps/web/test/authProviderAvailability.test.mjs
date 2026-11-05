import assert from "node:assert/strict";
import test from "node:test";

import { parseApiAuthProviders, parseSupabaseAuthSettings, safeAppPath, signInOptions } from "../src/platform/config.ts";

test("maps enabled Supabase social providers and email signup", () => {
  assert.deepEqual(
    parseSupabaseAuthSettings({
      disable_signup: false,
      external: { google: true, azure: true },
    }),
    { google: true, microsoft: true, emailMagicLink: true },
  );
});

test("fails closed for absent social provider configuration", () => {
  assert.deepEqual(parseSupabaseAuthSettings({ external: {} }), {
    google: false,
    microsoft: false,
    emailMagicLink: true,
  });
});

test("preserves an extension setup return path without allowing an open redirect", () => {
  assert.equal(safeAppPath(null), "/app");
  assert.equal(
    safeAppPath("/app/integrations?setup=chrome_meet&extensionId=abcdefghijklmnopabcdefghijklmnop&installationInstanceId=11111111-1111-4111-8111-111111111111&version=0.8.0"),
    "/app/integrations?setup=chrome_meet&extensionId=abcdefghijklmnopabcdefghijklmnop&installationInstanceId=11111111-1111-4111-8111-111111111111&version=0.8.0",
  );
  assert.equal(safeAppPath("https://attacker.example/path"), "/app");
  assert.equal(safeAppPath("//attacker.example/path"), "/app");
});

test("reads sign-in options from the API, which knows whether email can be delivered", () => {
  assert.deepEqual(
    parseApiAuthProviders({ providers: { google: true, microsoft: false, emailMagicLink: false } }),
    { google: true, microsoft: false, emailMagicLink: false },
  );
  assert.equal(parseApiAuthProviders({ readOnly: false }), null, "an older API without providers falls back");
  assert.equal(parseApiAuthProviders(null), null);
});

test("with email sign-in off, the page offers Google alone", () => {
  assert.deepEqual(signInOptions({ google: true, microsoft: false, emailMagicLink: false }), {
    intro: "Continue with your Google account.",
    showDivider: false,
    showEmailForm: false,
  });
  assert.deepEqual(signInOptions({ google: true, microsoft: false, emailMagicLink: true }), {
    intro: "Use your work identity or a secure email link.",
    showDivider: true,
    showEmailForm: true,
  });
});

