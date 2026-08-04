import assert from "node:assert/strict";
import test from "node:test";

import { loadTranscriptionConfig } from "../src/config.ts";
import {
  acceptDeepgramFinal,
  buildDeepgramFluxConfigureMessage,
  buildDeepgramFluxUrl,
  translateDeepgramFluxMessage,
} from "../src/transcription/deepgramFluxProtocol.ts";
import { publicTranscriptionConfig } from "../src/transcription/publicConfig.ts";
import {
  parseTranscriptionControlMessage,
  resolveTranscriptionConfigure,
  resolveTranscriptionStart,
} from "../src/transcription/protocol.ts";

test("loads provider and model configuration without exposing the server API key", () => {
  const config = loadTranscriptionConfig({
    AIRBOARD_TRANSCRIPTION_PROVIDER: "deepgram",
    AIRBOARD_TRANSCRIPTION_MODEL: "flux-general-multi",
    AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS: "flux-general-en, flux-general-multi",
    AIRBOARD_TRANSCRIPTION_KEYTERMS: "Airo, API, database",
    DEEPGRAM_API_KEY: "server-secret",
  });

  assert.equal(config.apiKey, "server-secret");
  const publicConfig = publicTranscriptionConfig(config);
  assert.deepEqual(publicConfig, {
    available: true,
    provider: "deepgram",
    defaultModel: "flux-general-multi",
    allowedModels: ["flux-general-en", "flux-general-multi"],
    dynamicKeyterms: true,
  });
  assert.equal(JSON.stringify(publicConfig).includes("server-secret"), false);

  const defaults = loadTranscriptionConfig({});
  assert.ok(defaults.defaultKeyterms.includes("Airo add a circle here"));
  assert.ok(defaults.defaultKeyterms.includes("connect User to API"));
});

test("rejects inconsistent model and turn-threshold environment configuration", () => {
  assert.throws(
    () =>
      loadTranscriptionConfig({
        AIRBOARD_TRANSCRIPTION_MODEL: "flux-general-multi",
        AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS: "flux-general-en",
      }),
    /must be included/,
  );
  assert.throws(
    () =>
      loadTranscriptionConfig({
        AIRBOARD_TRANSCRIPTION_EOT_THRESHOLD: "0.6",
        AIRBOARD_TRANSCRIPTION_EAGER_EOT_THRESHOLD: "0.7",
      }),
    /less than or equal/,
  );
  assert.throws(
    () =>
      loadTranscriptionConfig({
        AIRBOARD_TRANSCRIPTION_ALLOWED_MODELS: "flux-general-en,nova-3",
      }),
    /Flux adapter only supports/,
  );
});

test("parses canonical and migration-compatible client messages", () => {
  assert.deepEqual(
    parseTranscriptionControlMessage(
      JSON.stringify({
        type: "transcription.start",
        sampleRate: 16000,
        language: "en",
        model: "flux-general-multi",
        keyterms: ["Airo", "API"],
      }),
    ),
    {
      ok: true,
      value: {
        type: "transcription.start",
        sampleRate: 16000,
        language: "en",
        model: "flux-general-multi",
        keyterms: ["Airo", "API"],
      },
    },
  );
  assert.deepEqual(
    parseTranscriptionControlMessage(
      JSON.stringify({
        type: "transcription.configure",
        keyterms: ["Planner", "Golden Dataset", "Historical Dataset"],
      }),
    ),
    {
      ok: true,
      value: {
        type: "transcription.configure",
        keyterms: ["Planner", "Golden Dataset", "Historical Dataset"],
      },
    },
  );
  assert.equal(
    parseTranscriptionControlMessage(
      JSON.stringify({ type: "transcription.configure" }),
    ).ok,
    false,
  );
  assert.deepEqual(
    parseTranscriptionControlMessage(
      JSON.stringify({ type: "start", config: { sampleRateHz: 48000 } }),
    ),
    { ok: true, value: { type: "transcription.start", sampleRate: 48000 } },
  );
  assert.equal(
    parseTranscriptionControlMessage(
      JSON.stringify({ type: "transcription.start", sampleRate: 22050 }),
    ).ok,
    false,
  );
  const oversizedKeyterms = Array.from({ length: 11 }, (_, index) =>
    `${index}-${"x".repeat(96)}`,
  );
  const oversized = parseTranscriptionControlMessage(
    JSON.stringify({
      type: "transcription.start",
      sampleRate: 16000,
      keyterms: oversizedKeyterms,
    }),
  );
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, "KEYTERM_BUDGET_EXCEEDED");
});

test("resolves only allowed models and merges domain keyterms case-insensitively", () => {
  const config = loadTranscriptionConfig({
    AIRBOARD_TRANSCRIPTION_KEYTERMS: "Airo,API",
  });
  const resolved = resolveTranscriptionStart(
    {
      type: "transcription.start",
      sampleRate: 16000,
      model: "flux-general-en",
      keyterms: ["airo", "database"],
    },
    config,
  );
  assert.deepEqual(resolved, {
    ok: true,
    value: {
      sampleRate: 16000,
      model: "flux-general-en",
      keyterms: ["Airo", "API", "database"],
    },
  });

  const rejected = resolveTranscriptionStart(
    { type: "transcription.start", sampleRate: 16000, model: "unapproved" },
    config,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "MODEL_NOT_ALLOWED");

  const configured = resolveTranscriptionConfigure(
    {
      type: "transcription.configure",
      keyterms: ["Planner", "Golden Dataset", "Historical Dataset"],
    },
    config,
  );
  assert.equal(configured.ok, true);
  assert.deepEqual(configured.value, [
    "Airo",
    "API",
    "Planner",
    "Golden Dataset",
    "Historical Dataset",
  ]);
});

test("keeps the wake head while prioritizing live board labels over a large static tail", () => {
  const config = loadTranscriptionConfig({
    AIRBOARD_TRANSCRIPTION_KEYTERMS: Array.from(
      { length: 100 },
      (_, index) => `static-${index}`,
    ).join(","),
  });
  const resolved = resolveTranscriptionStart(
    {
      type: "transcription.start",
      sampleRate: 16000,
      keyterms: ["Planner", "Golden Dataset", "Historical Dataset"],
    },
    config,
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value.keyterms.slice(0, 11), [
    "static-0",
    "static-1",
    "static-2",
    "static-3",
    "static-4",
    "static-5",
    "static-6",
    "static-7",
    "Planner",
    "Golden Dataset",
    "Historical Dataset",
  ]);
  assert.equal(resolved.value.keyterms.length, 100);
});

test("builds a Flux V2 URL and Configure message with repeated keyterms", () => {
  const options = {
    sampleRate: 16000,
    model: "flux-general-multi",
    language: "en",
    keyterms: ["Airo", "payment service"],
  };
  const tuning = { eotThreshold: 0.7, eagerEotThreshold: 0.4, eotTimeoutMs: 1200 };
  const url = new URL(buildDeepgramFluxUrl("wss://api.deepgram.com", options, tuning));
  assert.equal(url.pathname, "/v2/listen");
  assert.equal(url.searchParams.get("model"), "flux-general-multi");
  assert.equal(url.searchParams.get("encoding"), "linear16");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["Airo", "payment service"]);
  assert.deepEqual(url.searchParams.getAll("language_hint"), ["en"]);

  assert.deepEqual(buildDeepgramFluxConfigureMessage(options, tuning), {
    type: "Configure",
    thresholds: {
      eot_threshold: 0.7,
      eot_timeout_ms: 1200,
      eager_eot_threshold: 0.4,
    },
    keyterms: ["Airo", "payment service"],
    language_hints: ["en"],
  });
});

test("translates Flux updates and final turns with stable deduplication keys", () => {
  assert.deepEqual(
    translateDeepgramFluxMessage(
      JSON.stringify({ type: "Connected", request_id: "request-1", sequence_id: 0 }),
    ),
    {
      connected: true,
      configured: false,
      events: [{ type: "status", status: "connected", requestId: "request-1" }],
    },
  );
  assert.equal(
    translateDeepgramFluxMessage(JSON.stringify({ type: "ConfigureSuccess" })).configured,
    true,
  );
  assert.deepEqual(
    translateDeepgramFluxMessage(
      JSON.stringify({
        type: "ConfigureFailure",
        code: "INVALID_THRESHOLD",
        description: "Threshold configuration is invalid.",
      }),
    ).events,
    [
      {
        type: "error",
        code: "INVALID_THRESHOLD",
        message: "Threshold configuration is invalid.",
        fatal: false,
      },
    ],
  );

  const partial = translateDeepgramFluxMessage(
    JSON.stringify({
      type: "TurnInfo",
      event: "Update",
      turn_index: 3,
      transcript: "Airo add a",
      words: [{ confidence: 0.8 }, { confidence: 1 }],
    }),
  );
  assert.deepEqual(partial.events, [
    {
      type: "partial",
      transcript: "Airo add a",
      turnIndex: 3,
      confidence: 0.9,
      providerEvent: "Update",
    },
  ]);

  const final = translateDeepgramFluxMessage(
    JSON.stringify({
      type: "TurnInfo",
      event: "EndOfTurn",
      turn_index: 3,
      sequence_id: 9,
      transcript: "Airo add a circle",
      end_of_turn_confidence: 0.93,
    }),
  );
  assert.equal(final.finalDedupeKey, "turn:3");
  assert.equal(final.events[0].type, "final");

  const sequenceFallback = translateDeepgramFluxMessage(
    JSON.stringify({
      type: "TurnInfo",
      event: "EndOfTurn",
      sequence_id: 10,
      transcript: "Airo add a database",
    }),
  );
  assert.equal(sequenceFallback.finalDedupeKey, "sequence:10");

  const seen = new Set();
  assert.equal(acceptDeepgramFinal(seen, "turn:3"), true);
  assert.equal(acceptDeepgramFinal(seen, "turn:3"), false);
  assert.equal(acceptDeepgramFinal(seen, "turn:4"), true);
});
