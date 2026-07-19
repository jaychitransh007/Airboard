import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "./buffer";
import { clientKey, createRateLimiter } from "../security";
import { computeVoiceMetrics } from "./metrics";
import { parseVoiceTraceAppend, parseVoiceTurnId } from "./protocol";
import { redactDiagnosticData } from "./redaction";
import type { AuthService } from "../auth";
import { configuredApiTokenAllowed } from "../security";

export function registerVoiceTraceRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  buffer = new VoiceTraceBuffer(),
  auth?: AuthService,
): VoiceTraceBuffer {
  const ownersByTurn = new Map<string, string>();
  const traceLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimits.voiceTracePerMinute,
  });
  server.post<{ Body: unknown }>("/voice/trace", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    const context = auth ? await auth.authenticate(request) : null;
    if (!(await diagnosticAccessAllowed(request, config, auth, context))) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    if (!traceLimiter.allow(clientKey(request))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const parsed = parseVoiceTraceAppend(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error.code, message: parsed.error.message });
    }
    const ownerKey = context?.organizationId ?? "local-development";
    const existingOwner = ownersByTurn.get(parsed.value.voiceTurnId);
    if (existingOwner && existingOwner !== ownerKey) {
      return reply.code(404).send({ error: "VOICE_TRACE_NOT_FOUND" });
    }
    ownersByTurn.set(parsed.value.voiceTurnId, ownerKey);
    if (ownersByTurn.size > 256) {
      const oldest = ownersByTurn.keys().next().value as string | undefined;
      if (oldest) ownersByTurn.delete(oldest);
    }
    const event = buffer.append(parsed.value);
    if (context && auth?.client) {
      const { error } = await auth.client.from("voice_trace_events").insert({
        organization_id: context.organizationId,
        profile_id: context.profileId,
        voice_turn_id: event.voiceTurnId,
        sequence: event.sequence,
        stage: event.stage,
        occurred_at: event.occurredAt,
        received_at: event.receivedAt,
        data: redactDiagnosticData(event.data),
      });
      if (error) {
        request.log.warn({ voiceTurnId: event.voiceTurnId }, "durable voice trace append failed");
      }
    }
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
    const context = auth ? await auth.authenticate(request) : null;
    if (!(await diagnosticAccessAllowed(request, config, auth, context))) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const ownerKey = context?.organizationId ?? "local-development";
    return computeVoiceMetrics(
      buffer
        .snapshotTurns()
        .filter((turn) => !auth || ownersByTurn.get(turn.voiceTurnId) === ownerKey),
    );
  });

  server.get<{ Params: { voiceTurnId: string } }>(
    "/voice/trace/:voiceTurnId",
    async (request, reply) => {
      if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
        return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
      }
      const context = auth ? await auth.authenticate(request) : null;
      if (!(await diagnosticAccessAllowed(request, config, auth, context))) {
        return reply.code(401).send({ error: "AUTH_REQUIRED" });
      }
      const voiceTurnId = parseVoiceTurnId(request.params.voiceTurnId);
      if (!voiceTurnId) {
        return reply.code(400).send({ error: "INVALID_VOICE_TURN_ID" });
      }
      const ownerKey = context?.organizationId ?? "local-development";
      if (auth && ownersByTurn.get(voiceTurnId) !== ownerKey) {
        return reply.code(404).send({ error: "VOICE_TRACE_NOT_FOUND" });
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

async function diagnosticAccessAllowed(
  request: Parameters<typeof configuredApiTokenAllowed>[0],
  config: ApiConfig,
  auth?: AuthService,
  existingContext?: Awaited<ReturnType<AuthService["authenticate"]>>,
): Promise<boolean> {
  return (
    !auth ||
    configuredApiTokenAllowed(request, config.apiToken) ||
    Boolean(existingContext ?? (auth && (await auth.authenticate(request)))) ||
    config.localEntitlements
  );
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return Boolean(origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)));
}
