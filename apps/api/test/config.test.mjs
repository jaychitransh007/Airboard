import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.ts";

test("Chrome integration has an explicit emergency kill switch", () => {
  assert.equal(loadConfig({}).chromeExtensionEnabled, true);
  assert.equal(loadConfig({ AIRBOARD_CHROME_EXTENSION_ENABLED: "true" }).chromeExtensionEnabled, true);
  assert.equal(loadConfig({ AIRBOARD_CHROME_EXTENSION_ENABLED: "false" }).chromeExtensionEnabled, false);
  assert.equal(loadConfig({
    NODE_ENV: "production",
    AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
  }).chromeExtensionEnabled, false, "a missing production switch fails closed");
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
    AIRBOARD_CHROME_EXTENSION_ENABLED: "true",
  }), /AIRBOARD_CHROME_EXTENSION_ID is required/);
  const enabledProduction = loadConfig({
    NODE_ENV: "production",
    AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
    AIRBOARD_CHROME_EXTENSION_ENABLED: "true",
    AIRBOARD_CHROME_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
    AIRBOARD_APP_URL: "https://app.airboard.example",
    AIRBOARD_ALLOWED_ORIGINS: "https://app.airboard.example",
  });
  assert.equal(enabledProduction.chromeExtensionEnabled, true);
  assert.equal(enabledProduction.chromeExtensionId, "abcdefghijklmnopabcdefghijklmnop");
  assert.deepEqual(enabledProduction.chromeExtensionCompatibleVersions, ["0.8.0"]);
  assert.deepEqual(loadConfig({
    AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.7.9,0.8.0",
  }).chromeExtensionCompatibleVersions, ["0.7.9", "0.8.0"]);
  assert.throws(() => loadConfig({
    AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.7.9",
  }), /must contain at most 8 comma-separated semantic versions/);
  for (const allowedOrigins of [
    "https://other.airboard.example",
    "https://app.airboard.example,*",
    "https://app.airboard.example/",
  ]) {
    assert.throws(() => loadConfig({
      NODE_ENV: "production",
      AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
      AIRBOARD_CHROME_EXTENSION_ENABLED: "true",
      AIRBOARD_CHROME_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
      AIRBOARD_APP_URL: "https://app.airboard.example/path",
      AIRBOARD_ALLOWED_ORIGINS: allowedOrigins,
    }), /AIRBOARD_ALLOWED_ORIGINS must explicitly include/);
  }
  assert.throws(() => loadConfig({
    AIRBOARD_CHROME_EXTENSION_ID: "not-a-chrome-id",
  }), /32-character Chrome extension ID/);
});
