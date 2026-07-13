import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "./buffer";
import { clientKey, createRateLimiter } from "../security";
import { computeVoiceMetrics } from "./metrics";
import { parseVoiceTraceAppend, parseVoiceTurnId } from "./protocol";
import { redactDiagnosticData } from "./redaction";

export function registerVoiceTraceRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  buffer = new VoiceTraceBuffer(),
): VoiceTraceBuffer {
  const traceLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimits.voiceTracePerMinute,
  });
  server.post<{ Body: unknown }>("/voice/trace", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    if (!traceLimiter.allow(clientKey(request))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const parsed = parseVoiceTraceAppend(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error.code, message: parsed.error.message });
    }
    const event = buffer.append(parsed.value);
    request.log.info(
      {
        voiceTurnId: event.voiceTurnId,
        voiceStage: event.stage,
        voiceSequence: event.sequence,
        voiceData: redactDiagnosticData(event.data),
      },
      "voice trace stage appended",
    );
    return reply.code(202).send({
      accepted: true,
      voiceTurnId: event.voiceTurnId,
      sequence: event.sequence,
    });
  });

  // The product's headline voice metrics, aggregated from the trace buffer.
  // Same origin gate as the raw traces; returns definitions with the numbers
  // so a dashboard (or a human) never has to guess what "success" means.
  server.get("/voice/metrics", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    return computeVoiceMetrics(buffer.snapshotTurns());
  });

  server.get<{ Params: { voiceTurnId: string } }>(
    "/voice/trace/:voiceTurnId",
    async (request, reply) => {
      if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
        return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
      }
      const voiceTurnId = parseVoiceTurnId(request.params.voiceTurnId);
      if (!voiceTurnId) {
        return reply.code(400).send({ error: "INVALID_VOICE_TURN_ID" });
      }
      const snapshot = buffer.get(voiceTurnId);
      if (!snapshot) {
        return reply.code(404).send({ error: "VOICE_TRACE_NOT_FOUND" });
      }
      return snapshot;
    },
  );

  return buffer;
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return Boolean(origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)));
}
