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
const { computeVoiceMetrics } = await import("../src/voiceTrace/metrics.ts");
const { registerVoiceTraceRoutes } = await import("../src/voiceTrace/routes.ts");

const ORIGIN = "http://localhost:3000";

function turn(voiceTurnId, stages) {
  const base = Date.parse("2026-07-13T10:00:00.000Z");
  return {
    voiceTurnId,
    droppedEvents: 0,
    events: stages.map(([stage, data, offsetMs], index) => ({
      voiceTurnId,
      stage,
      occurredAt: new Date(base + (offsetMs ?? index * 10)).toISOString(),
      data,
      sequence: index + 1,
      receivedAt: new Date(base + (offsetMs ?? index * 10)).toISOString(),
    })),
  };
}

test("computes success rate over attempts only, ignoring wake-only turns", () => {
  const metrics = computeVoiceMetrics([
    turn("t1", [
      ["stt_final", { transcript: "airo add a circle" }, 0],
      ["wake_classification", { wakePhrase: "Airo", command: "add a circle" }, 5],
      ["action_applied", { actionCount: 1 }, 450],
      ["turn_completed", { outcome: "applied" }, 460],
    ]),
    turn("t2", [
      ["stt_final", { transcript: "airo do something odd" }, 0],
      ["turn_completed", { outcome: "rejected" }, 100],
    ]),
    turn("t3", [
      ["stt_final", { transcript: "airo" }, 0],
      ["turn_completed", { outcome: "wake_only" }, 20],
    ]),
    turn("t4", [
      ["stt_final", { transcript: "add a user" }, 0],
      ["wake_classification", { wakePhrase: "push-to-talk", command: "add a user" }, 4],
      ["action_applied", { actionCount: 1 }, 900],
      ["turn_completed", { outcome: "applied" }, 910],
    ]),
  ]);

  assert.equal(metrics.turns, 4);
  assert.equal(metrics.completedTurns, 4);
  assert.deepEqual(metrics.outcomes, { applied: 2, rejected: 1, wake_only: 1 });
  // 2 applied out of 3 attempts (wake_only excluded).
  assert.ok(Math.abs(metrics.successRate - 2 / 3) < 1e-9);
  assert.deepEqual(metrics.channels, { "wake-word": 1, "push-to-talk": 1 });
  assert.equal(metrics.latency.endToActionMs.samples, 2);
  assert.equal(metrics.latency.endToActionMs.p50, 450);
  assert.equal(metrics.latency.endToActionMs.p95, 900);
});

test("semantic latency comes from the client-measured round trip", () => {
  const metrics = computeVoiceMetrics([
    turn("t1", [
      ["semantic_result", { status: "resolved", totalLatencyMs: 1200 }, 0],
      ["turn_completed", { outcome: "applied" }, 10],
    ]),
    turn("t2", [
      ["semantic_result", { status: "resolved", totalLatencyMs: 800 }, 0],
      ["turn_completed", { outcome: "applied" }, 10],
    ]),
  ]);
  assert.equal(metrics.latency.semanticMs.samples, 2);
  assert.equal(metrics.latency.semanticMs.p50, 800);
  assert.equal(metrics.latency.semanticMs.p95, 1200);
});

test("no attempts → successRate is null, not a fake 100%", () => {
  const metrics = computeVoiceMetrics([
    turn("t1", [["turn_completed", { outcome: "wake_only" }, 0]]),
  ]);
  assert.equal(metrics.successRate, null);
});

test("GET /voice/metrics aggregates the live buffer and is origin-gated", async () => {
  const server = Fastify();
  const buffer = new VoiceTraceBuffer();
  registerVoiceTraceRoutes(server, { allowedOrigins: [ORIGIN], rateLimits: { voiceTracePerMinute: 240 } }, buffer);

  buffer.append({
    voiceTurnId: "turn-e2e-000001",
    stage: "stt_final",
    occurredAt: "2026-07-13T10:00:00.000Z",
    data: { transcript: "airo add a circle" },
  });
  buffer.append({
    voiceTurnId: "turn-e2e-000001",
    stage: "action_applied",
    occurredAt: "2026-07-13T10:00:00.600Z",
    data: { actionCount: 1 },
  });
  buffer.append({
    voiceTurnId: "turn-e2e-000001",
    stage: "turn_completed",
    occurredAt: "2026-07-13T10:00:00.610Z",
    data: { outcome: "applied" },
  });

  const denied = await server.inject({ method: "GET", url: "/voice/metrics" });
  assert.equal(denied.statusCode, 403);

  const response = await server.inject({
    method: "GET",
    url: "/voice/metrics",
    headers: { origin: ORIGIN },
  });
  assert.equal(response.statusCode, 200);
  const metrics = response.json();
  assert.equal(metrics.turns, 1);
  assert.equal(metrics.outcomes.applied, 1);
  assert.equal(metrics.successRate, 1);
  assert.equal(metrics.latency.endToActionMs.p50, 600);

  await server.close();
});
