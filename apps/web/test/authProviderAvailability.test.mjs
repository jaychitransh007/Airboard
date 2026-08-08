import assert from "node:assert/strict";
import test from "node:test";

import { parseSupabaseAuthSettings, safeAppPath } from "../src/platform/config.ts";

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
