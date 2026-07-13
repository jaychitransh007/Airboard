import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "./buffer";
import { parseVoiceTraceAppend, parseVoiceTurnId } from "./protocol";
import { redactDiagnosticData } from "./redaction";

export function registerVoiceTraceRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  buffer = new VoiceTraceBuffer(),
): VoiceTraceBuffer {
  server.post<{ Body: unknown }>("/voice/trace", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
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
