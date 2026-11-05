import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  headlessMeetVoiceRetryDelayMs,
  shouldRetryHeadlessMeetSpeechConfig,
  shouldRetryHeadlessMeetVoiceAfterEnd,
  shouldStartHeadlessMeetVoice,
} from "../src/features/board/headlessMeetVoice.ts";

const ready = {
  headlessMeetOverlay: true,
  bridgeReady: true,
  authenticationReady: true,
  credential: "installation-token",
  speechSupported: true,
  speechEngine: "realtime",
  hasActiveSession: false,
  requestedCredential: null,
};

test("headless Meet voice waits for its scoped installation credential", () => {
  assert.equal(
    shouldStartHeadlessMeetVoice({
      ...ready,
      authenticationReady: false,
      credential: null,
    }),
    false,
  );
  assert.equal(shouldStartHeadlessMeetVoice(ready), true);
});

test("headless Meet voice starts at most once per credential and can retry safely", () => {
  assert.equal(
    shouldStartHeadlessMeetVoice({
      ...ready,
      requestedCredential: "installation-token",
    }),
    false,
  );
  assert.equal(
    shouldStartHeadlessMeetVoice({
      ...ready,
      credential: "rotated-installation-token",
      requestedCredential: "installation-token",
    }),
    true,
  );
  assert.equal(
    shouldStartHeadlessMeetVoice({ ...ready, hasActiveSession: true }),
    false,
  );
});

test("headless voice reconnect backoff is bounded", () => {
  assert.deepEqual(
    [-3, 0, 1, 2, 5, 20].map(headlessMeetVoiceRetryDelayMs),
    [1_000, 1_000, 2_000, 4_000, 30_000, 30_000],
  );
});

test("headless voice retries unexpected ends but preserves intentional aborts", () => {
  assert.equal(shouldRetryHeadlessMeetVoiceAfterEnd(true, "error"), true);
  assert.equal(shouldRetryHeadlessMeetVoiceAfterEnd(true, "closed"), true);
  assert.equal(shouldRetryHeadlessMeetVoiceAfterEnd(true, "stopped"), true);
  assert.equal(shouldRetryHeadlessMeetVoiceAfterEnd(true, "aborted"), false);
  assert.equal(shouldRetryHeadlessMeetVoiceAfterEnd(false, "stopped"), false);
});

test("headless config refetch retries transient failures but not permanent HTTP responses", () => {
  for (const error of [
    new TypeError("fetch failed"),
    new SyntaxError("Unexpected token"),
    new Error("Realtime transcription config request failed (408)."),
    new Error("Realtime transcription config request failed (429)."),
    new Error("Realtime transcription config request failed (503)."),
  ]) {
    assert.equal(shouldRetryHeadlessMeetSpeechConfig(error), true);
  }
  for (const status of [400, 401, 403, 404, 409]) {
    assert.equal(
      shouldRetryHeadlessMeetSpeechConfig(
        new Error(`Realtime transcription config request failed (${status}).`),
      ),
      false,
    );
  }
});

test("the renderer wires authentication gating and releases its bridge on unmount", async () => {
  const source = await readFile(
    new URL("../src/features/board/AirboardPrototype.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /authenticationReady:\s*syncAuthenticationReady/);
  const cleanupStart = source.indexOf(
    "Signal any in-flight startCamera to release what it acquires after its await.",
  );
  assert.notEqual(cleanupStart, -1);
  const cleanup = source.slice(cleanupStart, cleanupStart + 1_200);
  assert.match(cleanup, /meetBridgeSessionRef\.current\?\.stop\(\)/);
  assert.match(cleanup, /activeSpeechSession\?\.abort\(\)/);
  assert.match(cleanup, /cancelHeadlessSpeechConfigRetry\(\)/);
  assert.match(
    source,
    /shouldRetryHeadlessMeetVoiceAfterEnd\([\s\S]{0,100}headlessMeetOverlay,[\s\S]{0,100}reason/,
    "an unexpected provider stop must enter the headless reconnect path",
  );
  assert.match(
    source,
    /shouldRetryHeadlessMeetSpeechConfig\(error\)[\s\S]{0,300}scheduleHeadlessSpeechConfigRetry\(\)/,
    "transient config failures must schedule a headless refetch",
  );
});
