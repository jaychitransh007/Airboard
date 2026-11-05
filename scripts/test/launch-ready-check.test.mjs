import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const baseEnv = {
  NODE_ENV: "production",
  AIRBOARD_APP_URL: "https://app.airboard.example",
  NEXT_PUBLIC_AIRBOARD_API_URL: "https://api.airboard.example",
  AIRBOARD_WS_URL: "wss://api.airboard.example/ws",
  AIRBOARD_ALLOWED_ORIGINS: "https://app.airboard.example",
  SUPABASE_URL: "https://supabase.airboard.example",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.airboard.example",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  AIRBOARD_SESSION_SIGNING_SECRET: "a-production-signing-secret-longer-than-32-bytes",
  AIRBOARD_API_TOKEN: "a-production-api-token-longer-than-32-bytes",
  AIRBOARD_CRON_SECRET: "a-production-cron-secret-longer-than-32-bytes",
  AIRBOARD_LOCAL_ENTITLEMENTS: "false",
  DEEPGRAM_API_KEY: "test-deepgram-key",
  OPENAI_API_KEY: "test-openai-key",
  RESEND_API_KEY: "test-resend-key",
  AIRBOARD_EMAIL_FROM: "Airboard <hello@airboard.example>",
  NEXT_PUBLIC_CHROME_WEB_STORE_URL:
    `https://chromewebstore.google.com/detail/airboard/${extensionId}`,
  NEXT_PUBLIC_CHROME_EXTENSION_VERSION: "0.8.0",
  NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.8.0",
  AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.8.0",
  NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID: extensionId,
  AIRBOARD_CHROME_EXTENSION_ID: extensionId,
  AIRBOARD_CHROME_EXTENSION_ENABLED: "true",
};

function launchReport(overrides = {}, scope = "chrome-public") {
  const env = { ...process.env, ...baseEnv, ...overrides };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/launch-ready-check.mjs", `--scope=${scope}`, "--json"],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.notEqual(result.status, 2, result.stderr);
  return JSON.parse(result.stdout);
}

function configurationCheck(report, id) {
  return report.checks.find((check) => check.type === "configuration" && check.id === id);
}

test("Chrome launch configuration accepts matching bounded overlap windows", () => {
  const report = launchReport({
    NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.7.9,0.8.0",
    AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.8.0,0.7.9",
  });
  for (const id of [
    "cors",
    "chrome-store-url",
    "chrome-extension-version",
    "chrome-renderer-overlap",
    "chrome-api-overlap",
    "chrome-overlap-parity",
  ]) {
    assert.equal(configurationCheck(report, id)?.passed, true, id);
  }
});

test("Chrome launch configuration defaults missing overlap variables to exact-only", () => {
  const report = launchReport({
    NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: undefined,
    AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: undefined,
  });
  assert.equal(configurationCheck(report, "chrome-renderer-overlap")?.passed, true);
  assert.equal(configurationCheck(report, "chrome-api-overlap")?.passed, true);
  assert.equal(configurationCheck(report, "chrome-overlap-parity")?.passed, true);
});

test("Chrome launch configuration rejects oversized, mismatched, and unsafe origin settings", () => {
  const oversized = Array.from({ length: 9 }, (_, index) => `0.${index}.0`).join(",");
  const oversizedReport = launchReport({
    NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: oversized,
  });
  assert.equal(configurationCheck(oversizedReport, "chrome-renderer-overlap")?.passed, false);

  const mismatchedReport = launchReport({
    NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS: "0.7.9,0.8.0",
  });
  assert.equal(configurationCheck(mismatchedReport, "chrome-overlap-parity")?.passed, false);

  const wrongOriginReport = launchReport({
    AIRBOARD_ALLOWED_ORIGINS: "https://other.airboard.example",
  });
  assert.equal(configurationCheck(wrongOriginReport, "cors")?.passed, false);

  const localOriginReport = launchReport({
    AIRBOARD_ALLOWED_ORIGINS:
      "https://app.airboard.example,HTTP://LOCALHOST:3000",
  });
  assert.equal(configurationCheck(localOriginReport, "cors")?.passed, false);

  const spoofedStoreReport = launchReport({
    NEXT_PUBLIC_CHROME_WEB_STORE_URL:
      "https://example.com/detail/airboard?next=chromewebstore.google.com",
  });
  assert.equal(configurationCheck(spoofedStoreReport, "chrome-store-url")?.passed, false);

  const mismatchedStoreReport = launchReport({
    NEXT_PUBLIC_CHROME_WEB_STORE_URL:
      "https://chromewebstore.google.com/detail/other/ponmlkjihgfedcbaponmlkjihgfedcba",
  });
  assert.equal(configurationCheck(mismatchedStoreReport, "chrome-store-url")?.passed, false);

  const malformedStoreReport = launchReport({
    NEXT_PUBLIC_CHROME_WEB_STORE_URL:
      "https://chromewebstore.google.com/detail/airboard/abcdefghijklmnop",
  });
  assert.equal(configurationCheck(malformedStoreReport, "chrome-store-url")?.passed, false);
});

test("the controlled pilot needs no email sender; wider releases do", () => {
  const withoutEmail = { RESEND_API_KEY: undefined, AIRBOARD_EMAIL_FROM: undefined };
  assert.equal(configurationCheck(launchReport(withoutEmail, "controlled-pilot"), "lifecycle-email"), undefined);
  assert.equal(configurationCheck(launchReport(withoutEmail, "standalone-ga"), "lifecycle-email").passed, false);
  assert.equal(configurationCheck(launchReport({}, "standalone-ga"), "lifecycle-email").passed, true);
});

test("the board socket URL follows the API URL unless AIRBOARD_WS_URL overrides it", () => {
  const derived = launchReport({ AIRBOARD_WS_URL: undefined });
  assert.equal(configurationCheck(derived, "websocket-url").passed, true);
  const local = launchReport({ AIRBOARD_WS_URL: undefined, NEXT_PUBLIC_AIRBOARD_API_URL: "http://localhost:4000" });
  assert.equal(configurationCheck(local, "websocket-url").passed, false);
});

test("deployed mode reads the serving API settings, its secrets and the web build values", async () => {
  const { environmentFromDeployment } = await import("../lib/deployed-env.mjs");
  const secretsRead = [];
  const env = environmentFromDeployment({
    apiEnv: [
      { name: "AIRBOARD_APP_URL", value: "https://app.airboard.example" },
      { name: "AIRBOARD_CRON_SECRET", valueFrom: { secretKeyRef: { name: "cron", key: "latest" } } },
    ],
    webSubstitutions: {
      _AIRBOARD_API_URL: "https://api.airboard.example",
      _SUPABASE_URL: "https://project.supabase.co",
      _CHROME_WEB_STORE_URL: "",
    },
    apiDockerfile: "FROM node AS builder\nENV NODE_ENV=development\nFROM node AS runtime\nENV NODE_ENV=production\n",
    readSecret: (name, key) => {
      secretsRead.push(`${name}:${key}`);
      return "a-cron-secret-longer-than-thirty-two-characters";
    },
  });
  assert.equal(env.AIRBOARD_APP_URL, "https://app.airboard.example");
  assert.equal(env.AIRBOARD_CRON_SECRET, "a-cron-secret-longer-than-thirty-two-characters");
  assert.deepEqual(secretsRead, ["cron:latest"]);
  assert.equal(env.NEXT_PUBLIC_AIRBOARD_API_URL, "https://api.airboard.example");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://project.supabase.co");
  assert.equal("NEXT_PUBLIC_CHROME_WEB_STORE_URL" in env, false, "empty build values stay unset");
  // Only the runtime stage of the Dockerfile counts.
  assert.equal(env.NODE_ENV, "production");
  const builderOnly = environmentFromDeployment({ apiEnv: [], apiDockerfile: "FROM node\nENV NODE_ENV=production\nFROM node\n", readSecret: () => "" });
  assert.equal(builderOnly.NODE_ENV, undefined);
});
