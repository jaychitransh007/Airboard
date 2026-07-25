import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidates = [
        new URL(`${specifier}.ts`, context.parentURL),
        ...(specifier.endsWith(".js")
          ? [new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)]
          : []),
      ];
      for (const candidate of candidates) {
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { VoiceTraceBuffer } = await import("../src/voiceTrace/buffer.ts");
const { parseVoiceTraceAppend } = await import("../src/voiceTrace/protocol.ts");
const { redactDiagnosticData, redactDiagnosticValue, redactVoiceTraceContent } = await import(
  "../src/voiceTrace/redaction.ts"
);
const { registerVoiceTraceRoutes } = await import("../src/voiceTrace/routes.ts");

test("keeps token-usage counters while redacting credential tokens", () => {
  assert.deepEqual(
    redactDiagnosticData({
      inputTokens: 240,
      outputTokens: 80,
      totalTokens: 320,
      accessToken: "secret-access-token",
      token: "secret-token",
    }),
    {
      inputTokens: 240,
      outputTokens: 80,
      totalTokens: 320,
      accessToken: "[REDACTED]",
      token: "[REDACTED]",
    },
  );
});

test("preserves nested branch references in bounded model-output diagnostics", () => {
  const plan = {
    actions: [
      {
        type: "branch",
        branches: [
          {
            to: { kind: "visible_label", label: "User Two", occurrence: 1 },
            label: "no",
          },
        ],
      },
    ],
  };
  assert.deepEqual(redactDiagnosticValue(plan), plan);
});

test("removes customer speech and board labels from operational voice traces", () => {
  assert.deepEqual(
    redactVoiceTraceContent({
      transcript: "Airo add a payment service",
      confidence: 0.94,
      plan: {
        actions: [
          {
            type: "branch",
            label: "Private customer name",
            to: { kind: "visible_label", label: "Ledger" },
          },
        ],
      },
      metrics: { latencyMs: 120 },
    }),
    {
      transcript: "[CONTENT_REDACTED]",
      confidence: 0.94,
      plan: {
        actions: [
          {
            type: "branch",
            label: "[CONTENT_REDACTED]",
            to: { kind: "visible_label", label: "[CONTENT_REDACTED]" },
          },
        ],
      },
      metrics: { latencyMs: 120 },
    },
  );
});

test("accepts the bounded client trace envelope and rejects raw audio or secrets", () => {
  const parsed = parseVoiceTraceAppend({
    voiceTurnId: "voice-turn-1234",
    stage: "stt_final",
    occurredAt: "2026-07-12T03:00:00.000Z",
    data: {
      transcript: "Airo add a condition block",
      confidence: 0.94,
      alternatives: ["Airo add a conditional block"],
    },
  });
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      voiceTurnId: "voice-turn-1234",
      stage: "stt_final",
      occurredAt: "2026-07-12T03:00:00.000Z",
      data: {
        transcript: "Airo add a condition block",
        confidence: 0.94,
        alternatives: ["Airo add a conditional block"],
      },
    },
  });

  for (const input of [
    {
      voiceTurnId: "voice-turn-1234",
      stage: "capture_metadata",
      data: { audioBytes: "base64-audio" },
    },
    {
      voiceTurnId: "voice-turn-1234",
      stage: "semantic_request",
      data: { authorization: "Bearer secret" },
    },
  ]) {
    const rejected = parseVoiceTraceAppend(input);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "VOICE_TRACE_SENSITIVE_DATA_REJECTED");
  }
});

test("keeps append order while bounding events per turn and total turns", () => {
  const buffer = new VoiceTraceBuffer(2, 2);
  buffer.append({ voiceTurnId: "voice-turn-0001", stage: "stt_final" });
  buffer.append({ voiceTurnId: "voice-turn-0001", stage: "parser_outcome" });
  const third = buffer.append({ voiceTurnId: "voice-turn-0001", stage: "semantic_request" });
  assert.equal(third.sequence, 3);
  assert.deepEqual(
    buffer.get("voice-turn-0001").events.map(({ sequence }) => sequence),
    [2, 3],
  );
  assert.equal(buffer.get("voice-turn-0001").droppedEvents, 1);

  buffer.append({ voiceTurnId: "voice-turn-0002", stage: "stt_final" });
  buffer.append({ voiceTurnId: "voice-turn-0003", stage: "stt_final" });
  assert.equal(buffer.get("voice-turn-0001"), null);
  assert.equal(buffer.get("voice-turn-0002").events[0].sequence, 1);
});

test("exposes same-origin append and local diagnostic retrieval routes", async (t) => {
  const server = Fastify({ logger: false });
  const buffer = new VoiceTraceBuffer();
  registerVoiceTraceRoutes(
    server,
    { allowedOrigins: ["http://localhost:3000"], rateLimits: { voiceTracePerMinute: 240 } },
    buffer,
  );
  t.after(() => server.close());

  const forbidden = await server.inject({
    method: "POST",
    url: "/voice/trace",
    headers: { origin: "https://untrusted.test" },
    payload: { voiceTurnId: "voice-turn-1234", stage: "stt_final", data: {} },
  });
  assert.equal(forbidden.statusCode, 403);

  const accepted = await server.inject({
    method: "POST",
    url: "/voice/trace",
    headers: { origin: "http://localhost:3000" },
    payload: {
      voiceTurnId: "voice-turn-1234",
      stage: "stt_final",
      occurredAt: "2026-07-12T03:00:00Z",
      data: { transcript: "Airo add a decision" },
    },
  });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), {
    accepted: true,
    voiceTurnId: "voice-turn-1234",
    sequence: 1,
  });

  const diagnostic = await server.inject({
    method: "GET",
    url: "/voice/trace/voice-turn-1234",
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(diagnostic.statusCode, 200);
  assert.equal(diagnostic.json().events[0].stage, "stt_final");
  assert.equal(diagnostic.json().events[0].data.transcript, "[CONTENT_REDACTED]");
  assert.equal(diagnostic.json().droppedEvents, 0);

  const missing = await server.inject({
    method: "GET",
    url: "/voice/trace/voice-turn-9999",
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(missing.statusCode, 404);
});
