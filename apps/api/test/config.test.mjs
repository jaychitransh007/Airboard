import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.ts";

const SUPABASE = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" };

test("Chrome integration has an explicit emergency kill switch", () => {
  assert.equal(loadConfig({}).chromeExtensionEnabled, true);
  assert.equal(loadConfig({ AIRBOARD_CHROME_EXTENSION_ENABLED: "true" }).chromeExtensionEnabled, true);
  assert.equal(loadConfig({ AIRBOARD_CHROME_EXTENSION_ENABLED: "false" }).chromeExtensionEnabled, false);
  assert.equal(loadConfig({
    NODE_ENV: "production",
    ...SUPABASE,
    AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
  }).chromeExtensionEnabled, false, "a missing production switch fails closed");
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    ...SUPABASE,
    AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
    AIRBOARD_CHROME_EXTENSION_ENABLED: "true",
  }), /AIRBOARD_CHROME_EXTENSION_ID is required/);
  const enabledProduction = loadConfig({
    NODE_ENV: "production",
    ...SUPABASE,
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
      ...SUPABASE,
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

test("production refuses a wildcard allowed origin", () => {
  const production = { NODE_ENV: "production", ...SUPABASE, AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40), AIRBOARD_CHROME_EXTENSION_ENABLED: "false" };
  assert.throws(() => loadConfig({ ...production, AIRBOARD_ALLOWED_ORIGINS: "*" }), /exact origins/);
  assert.doesNotThrow(() => loadConfig({ ...production, AIRBOARD_ALLOWED_ORIGINS: "https://app.example" }));
});

test("production refuses to start without Supabase instead of keeping boards in memory", () => {
  const production = { NODE_ENV: "production", AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40), AIRBOARD_CHROME_EXTENSION_ENABLED: "false" };
  assert.throws(() => loadConfig(production), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  assert.throws(() => loadConfig({ ...production, SUPABASE_URL: "https://project.supabase.co" }), /required in production/);
  assert.doesNotThrow(() => loadConfig({ ...production, ...SUPABASE }));
  // Local development keeps the in-memory store.
  assert.doesNotThrow(() => loadConfig({}));
});

test("email sign-in links are off in production unless switched on", () => {
  const production = { NODE_ENV: "production", ...SUPABASE, AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40), AIRBOARD_CHROME_EXTENSION_ENABLED: "false" };
  assert.equal(loadConfig(production).emailSignInEnabled, false);
  assert.equal(loadConfig({ ...production, AIRBOARD_EMAIL_SIGN_IN_ENABLED: "true" }).emailSignInEnabled, true);
  // Local development keeps them; the local mailer captures every message.
  assert.equal(loadConfig({}).emailSignInEnabled, true);
  assert.equal(loadConfig({ AIRBOARD_EMAIL_SIGN_IN_ENABLED: "false" }).emailSignInEnabled, false);
});


test("daily allowances and board socket caps have defaults and can be tuned", () => {
  const defaults = loadConfig({});
  assert.deepEqual(defaults.dailyUsage, { airoCommands: 500, voiceSeconds: 240 * 60 });
  assert.deepEqual(defaults.boardSockets, { perParticipant: 3, perCaller: 30, perSession: 50 });

  const tuned = loadConfig({
    AIRBOARD_DAILY_AIRO_COMMANDS: "1000",
    AIRBOARD_DAILY_VOICE_MINUTES: "60",
    AIRBOARD_BOARD_SOCKETS_PER_CALLER: "10",
  });
  assert.deepEqual(tuned.dailyUsage, { airoCommands: 1000, voiceSeconds: 3600 });
  assert.equal(tuned.boardSockets.perCaller, 10);
  assert.throws(() => loadConfig({ AIRBOARD_DAILY_VOICE_MINUTES: "0" }), /AIRBOARD_DAILY_VOICE_MINUTES/);
});
