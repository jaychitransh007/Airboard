import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.ts";

const SUPABASE = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" };

test("production refuses a wildcard allowed origin", () => {
  const production = { NODE_ENV: "production", ...SUPABASE, AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40) };
  assert.throws(() => loadConfig({ ...production, AIRBOARD_ALLOWED_ORIGINS: "*" }), /exact origins/);
  assert.doesNotThrow(() => loadConfig({ ...production, AIRBOARD_ALLOWED_ORIGINS: "https://app.example" }));
});

test("production refuses to start without Supabase instead of keeping boards in memory", () => {
  const production = { NODE_ENV: "production", AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40) };
  assert.throws(() => loadConfig(production), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  assert.throws(() => loadConfig({ ...production, SUPABASE_URL: "https://project.supabase.co" }), /required in production/);
  assert.doesNotThrow(() => loadConfig({ ...production, ...SUPABASE }));
  // Local development keeps the in-memory store.
  assert.doesNotThrow(() => loadConfig({}));
});

test("email sign-in links are off in production unless switched on", () => {
  const production = { NODE_ENV: "production", ...SUPABASE, AIRBOARD_SESSION_SIGNING_SECRET: "x".repeat(40) };
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

test("the whole service has daily Airo and voice ceilings that can be tuned", () => {
  assert.deepEqual(loadConfig({}).serviceDailyUsage, { airoCommands: 5_000, voiceSeconds: 3_000 * 60 });
  const tuned = loadConfig({
    AIRBOARD_SERVICE_DAILY_AIRO_COMMANDS: "20000",
    AIRBOARD_SERVICE_DAILY_VOICE_MINUTES: "6000",
  });
  assert.deepEqual(tuned.serviceDailyUsage, { airoCommands: 20_000, voiceSeconds: 6_000 * 60 });
  assert.throws(() => loadConfig({ AIRBOARD_SERVICE_DAILY_VOICE_MINUTES: "0" }), /AIRBOARD_SERVICE_DAILY_VOICE_MINUTES/);
});
