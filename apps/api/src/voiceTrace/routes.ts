import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "./buffer";
import { clientKey, configuredApiTokenAllowed, originAllowed } from "../security";
import { createSharedRateLimiter } from "../sharedRateLimit";
import { parseVoiceTraceAppend } from "./protocol";
import { redactDiagnosticData, redactVoiceTraceContent } from "./redaction";
import type { AuthService } from "../auth";

export function registerVoiceTraceRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  buffer = new VoiceTraceBuffer(),
  auth?: AuthService,
): VoiceTraceBuffer {
  const traceLimiter = createSharedRateLimiter({
    bucket: "voice_trace",
    windowMs: 60_000,
    max: config.rateLimits.voiceTracePerMinute,
    client: auth?.client ?? null,
    keySecret: config.sessionSigningSecret,
    onError: (error) => server.log.warn({ err: error }, "shared voice trace rate limit could not be counted"),
  });
  server.post<{ Body: unknown }>("/voice/trace", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    const context = auth
      ? await auth.authenticate(request, { allowInstallation: true })
      : null;
    if (!(await diagnosticAccessAllowed(request, config, auth, context))) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    if (
      !(await traceLimiter.allow(
        clientKey(request, {
          profileId: context?.profileId,
          trustedProxyHops: config.trustedProxyHops,
        }),
      ))
    ) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const parsed = parseVoiceTraceAppend(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error.code, message: parsed.error.message });
    }
    const sanitizedData = redactVoiceTraceContent(parsed.value.data);
    const event = buffer.append({
      ...parsed.value,
      ...(sanitizedData ? { data: sanitizedData } : {}),
    });
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

