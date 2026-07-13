import type { FastifyInstance } from "fastify";
import { AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION } from "@airboard/core/semantic-plan";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "../voiceTrace/buffer";
import { redactDiagnosticText, redactDiagnosticValue } from "../voiceTrace/redaction";
import type { VoiceTraceData, VoiceTraceValue } from "../voiceTrace/types";
import { createSemanticIntentProvider } from "./factory";
import { AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION } from "./openaiResponses";
import {
  mapSemanticIntentProviderError,
  SemanticIntentProviderError,
} from "./providerError";
import { parseSemanticIntentRequest } from "./protocol";
import { publicSemanticIntentConfig } from "./publicConfig";
import type { SemanticIntentProviderResult, SemanticIntentRequest } from "./types";

export function registerSemanticIntentRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  traceBuffer = new VoiceTraceBuffer(),
): void {
  const provider = createSemanticIntentProvider(config.semanticIntent);
  let activeRequests = 0;

  server.get("/intent/config", async () => publicSemanticIntentConfig(config.semanticIntent));

  server.post<{ Body: unknown }>("/intent/resolve", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    if (!provider) {
      return reply.code(503).send({ error: "SEMANTIC_INTENT_UNAVAILABLE" });
    }
    if (activeRequests >= config.semanticIntent.maxConcurrentRequests) {
      return reply.code(429).send({ error: "SEMANTIC_INTENT_CAPACITY_REACHED" });
    }

    const parsed = parseSemanticIntentRequest(request.body, config.semanticIntent);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error.code, message: parsed.error.message });
    }

    const model = parsed.value.model ?? config.semanticIntent.defaultModel;
    const requestStartedAt = performance.now();
    const requestedLog = semanticRequestLog(parsed.value, model);
    request.log.info(requestedLog, "semantic intent requested");
    traceBuffer.append({
      voiceTurnId: parsed.value.voiceTurnId,
      stage: "semantic.server.requested",
      data: asTraceData(requestedLog),
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.semanticIntent.timeoutMs);
    activeRequests += 1;
    try {
      const resolution = await provider.resolve(parsed.value, model, abortController.signal);
      const result: SemanticIntentProviderResult = {
        plan: resolution.plan,
        provider: provider.id,
        model,
        metadata: resolution.metadata,
      };
      const completedLog = {
        voiceTurnId: parsed.value.voiceTurnId,
        semanticProvider: provider.id,
        semanticModel: model,
        semanticPlan: redactDiagnosticValue(resolution.plan),
        semanticMetadata: resolution.metadata,
      };
      request.log.info(completedLog, "semantic intent completed");
      traceBuffer.append({
        voiceTurnId: parsed.value.voiceTurnId,
        stage: "semantic.server.completed",
        data: asTraceData(completedLog),
      });
      return result;
    } catch (caught) {
      const normalizedError =
        abortController.signal.aborted &&
        !(caught instanceof SemanticIntentProviderError && caught.kind === "timeout")
          ? new SemanticIntentProviderError("timeout", "Semantic intent request timed out.", {
              cause: caught,
            })
          : caught;
      const mapped = mapSemanticIntentProviderError(normalizedError);
      const providerError =
        normalizedError instanceof SemanticIntentProviderError ? normalizedError : null;
      const failureLog = {
        err: normalizedError,
        voiceTurnId: parsed.value.voiceTurnId,
        semanticProvider: provider.id,
        semanticModel: model,
        semanticErrorCode: mapped.code,
        semanticLatencyMs: Math.max(0, Math.round(performance.now() - requestStartedAt)),
        providerRequestId: providerError?.providerRequestId ?? null,
        providerStatus: providerError?.upstreamStatus ?? null,
        providerCode: providerError?.providerCode ?? null,
      };
      request.log.warn(failureLog, "semantic intent failed");
      traceBuffer.append({
        voiceTurnId: parsed.value.voiceTurnId,
        stage: "semantic.server.failed",
        data: asTraceData({
          semanticProvider: provider.id,
          semanticModel: model,
          semanticErrorCode: mapped.code,
          semanticLatencyMs: failureLog.semanticLatencyMs,
          providerRequestId: failureLog.providerRequestId,
          providerStatus: failureLog.providerStatus,
          providerCode: failureLog.providerCode,
        }),
      });
      if (mapped.retryAfterMs !== undefined) {
        reply.header("Retry-After", Math.max(1, Math.ceil(mapped.retryAfterMs / 1_000)));
      }
      return reply.code(mapped.status).send({
        error: mapped.code,
        message: mapped.message,
        ...(providerError?.providerRequestId
          ? { providerRequestId: providerError.providerRequestId }
          : {}),
        ...(mapped.retryAfterMs !== undefined ? { retryAfterMs: mapped.retryAfterMs } : {}),
      });
    } finally {
      clearTimeout(timeout);
      activeRequests = Math.max(0, activeRequests - 1);
    }
  });
}

function semanticRequestLog(request: SemanticIntentRequest, model: string): Record<string, unknown> {
  return {
    voiceTurnId: request.voiceTurnId,
    semanticModel: model,
    semanticPlanContractVersion: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    semanticPromptVersion: AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
    parserIssue: request.parserIssue,
    transcript: redactDiagnosticText(request.transcript),
    boardContext: {
      selectionCount: request.context.selectionCount,
      objectCount: request.context.objects.length,
      edgeCount: request.context.edges.length,
      pointerAvailable: request.context.pointerAvailable,
      selected: request.context.selected.map((object) => ({
        label: redactDiagnosticText(object.label, 120),
        nodeType: object.nodeType,
        ordinal: object.ordinal ?? null,
        selected: object.selected ?? false,
        position: object.position ?? null,
        size: object.size ?? null,
      })),
      objects: request.context.objects.map((object) => ({
        label: redactDiagnosticText(object.label, 120),
        nodeType: object.nodeType,
        ordinal: object.ordinal ?? null,
        selected: object.selected ?? false,
        position: object.position ?? null,
        size: object.size ?? null,
      })),
      edges: request.context.edges.map((edge) => ({
        from: {
          label: redactDiagnosticText(edge.from.label, 120),
          nodeType: edge.from.nodeType,
          ordinal: edge.from.ordinal ?? null,
        },
        to: {
          label: redactDiagnosticText(edge.to.label, 120),
          nodeType: edge.to.nodeType,
          ordinal: edge.to.ordinal ?? null,
        },
        label: edge.label ? redactDiagnosticText(edge.label, 120) : null,
      })),
      projectGlossary: request.context.projectGlossary.map((entry) => ({
        term: redactDiagnosticText(entry.term, 120),
        nodeType: entry.nodeType ?? null,
      })),
    },
    pendingClarification: request.pendingClarification
      ? redactDiagnosticValue(request.pendingClarification)
      : null,
  };
}

function asTraceData(input: Record<string, unknown>): VoiceTraceData {
  return redactDiagnosticValue(input) as Record<string, VoiceTraceValue>;
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return Boolean(origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)));
}
