import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { installationTokenMatches } from "../src/installationCredential.ts";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");

test("installation rotation accepts current and unexpired previous credentials", () => {
  const row = {
    status: "connected",
    token_hash: "current",
    previous_token_hash: "previous",
    previous_token_expires_at: "2026-08-02T12:05:00.000Z",
  };
  assert.equal(installationTokenMatches(row, "current", NOW), true);
  assert.equal(installationTokenMatches(row, "previous", NOW), true);
  assert.equal(installationTokenMatches(row, "unknown", NOW), false);
});

test("expired previous and revoked installation credentials fail closed", () => {
  assert.equal(installationTokenMatches({
    status: "connected",
    token_hash: "current",
    previous_token_hash: "previous",
    previous_token_expires_at: "2026-08-02T11:59:59.000Z",
  }, "previous", NOW), false);
  assert.equal(installationTokenMatches({
    status: "revoked",
    token_hash: "current",
    previous_token_hash: null,
    previous_token_expires_at: null,
  }, "current", NOW), false);
});

test("general authentication requires an explicit installation capability opt-in", async () => {
  const source = await readFile(new URL("../src/auth.ts", import.meta.url), "utf8");
  assert.match(source, /options:\s*\{ allowInstallation\?: boolean \} = \{\}/);
  assert.match(source, /if \(!options\.allowInstallation\) return null/);
});
