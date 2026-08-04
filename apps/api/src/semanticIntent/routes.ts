import type { FastifyInstance } from "fastify";
import { resolveExistingBoardFanIn } from "@airboard/core/existing-board-fan-in";
import { AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION } from "@airboard/core/semantic-plan";
import type { ApiConfig } from "../config";
import { VoiceTraceBuffer } from "../voiceTrace/buffer";
import { redactDiagnosticValue, redactVoiceTraceContent } from "../voiceTrace/redaction";
import type { VoiceTraceData, VoiceTraceValue } from "../voiceTrace/types";
import { createSemanticIntentProvider } from "./factory";
import { AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION } from "./openaiResponses";
import {
  mapSemanticIntentProviderError,
  SemanticIntentProviderError,
} from "./providerError";
import { parseSemanticIntentRequest } from "./protocol";
import { publicSemanticIntentConfig } from "./publicConfig";
import { clientKey, createRateLimiter } from "../security";
import type {
  SemanticIntentHttpResult,
  SemanticIntentProviderMetadata,
  SemanticIntentProviderResult,
  SemanticIntentRequest,
} from "./types";
import type { AuthService } from "../auth";
import { configuredApiTokenAllowed } from "../security";

const DETERMINISTIC_SEMANTIC_PROVIDER = "airboard-deterministic";
const EXISTING_BOARD_FAN_IN_MODEL = "existing-board-fan-in-v1";

export function registerSemanticIntentRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  traceBuffer = new VoiceTraceBuffer(),
  auth?: AuthService,
): void {
  const provider = createSemanticIntentProvider(config.semanticIntent);
  let activeRequests = 0;
  const rateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimits.intentPerMinute,
  });

  server.get("/intent/config", async () => publicSemanticIntentConfig(config.semanticIntent));

  server.post<{ Body: unknown }>("/intent/resolve", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    if (
      !configuredApiTokenAllowed(request, config.apiToken) &&
      !(auth && (await auth.authenticate(request, { allowInstallation: true }))) &&
      !config.localEntitlements
    ) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    if (!rateLimiter.allow(clientKey(request))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
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

    const deterministicFanIn = resolveExistingBoardFanIn(
      parsed.value.transcript,
      parsed.value.context,
    );
    if (deterministicFanIn.status !== "unrecognized") {
      const totalLatencyMs = Math.max(
        0,
        Math.round(performance.now() - requestStartedAt),
      );
      const metadata: SemanticIntentProviderMetadata = {
        responseId: null,
        responseModel: EXISTING_BOARD_FAN_IN_MODEL,
        providerRequestId: null,
        clientRequestId: `airboard:${parsed.value.voiceTurnId}:fan-in`,
        providerProcessingMs: 0,
        totalLatencyMs,
        usage: null,
      };
      const result: SemanticIntentHttpResult =
        deterministicFanIn.status === "resolved"
          ? {
              plan: deterministicFanIn.plan,
              provider: DETERMINISTIC_SEMANTIC_PROVIDER,
              model: EXISTING_BOARD_FAN_IN_MODEL,
              metadata,
            }
          : {
              outcome: "already_satisfied",
              plan: null,
              provider: DETERMINISTIC_SEMANTIC_PROVIDER,
              model: EXISTING_BOARD_FAN_IN_MODEL,
              metadata,
            };
      const completedLog = {
        voiceTurnId: parsed.value.voiceTurnId,
        semanticProvider: result.provider,
        semanticModel: result.model,
        semanticResolutionPath:
          deterministicFanIn.status === "resolved"
            ? "deterministic_existing_board_fan_in"
            : "deterministic_existing_board_fan_in_already_satisfied",
        semanticOutcome:
          deterministicFanIn.status === "resolved"
            ? "plan"
            : "already_satisfied",
        semanticPlan:
          deterministicFanIn.status === "resolved"
            ? semanticPlanSummary(deterministicFanIn.plan)
            : {
                resolution: "already_satisfied",
                actionCount: 0,
                actionTypes: [],
                clarificationRequired: false,
              },
        semanticMetadata: result.metadata,
      };
      request.log.info(completedLog, "semantic intent completed");
      traceBuffer.append({
        voiceTurnId: parsed.value.voiceTurnId,
        stage: "semantic.server.completed",
        data: asTraceData(completedLog),
      });
      return result;
    }

    if (!provider) {
      return reply.code(503).send({ error: "SEMANTIC_INTENT_UNAVAILABLE" });
    }
    if (activeRequests >= config.semanticIntent.maxConcurrentRequests) {
      return reply.code(429).send({ error: "SEMANTIC_INTENT_CAPACITY_REACHED" });
    }

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
        semanticPlan: semanticPlanSummary(resolution.plan),
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
    transcriptCharacters: request.transcript.length,
    boardContext: {
      selectionCount: request.context.selectionCount,
      objectCount: request.context.objects.length,
      edgeCount: request.context.edges.length,
      pointerAvailable: request.context.pointerAvailable,
      selectedNodeTypes: request.context.selected.map((object) => object.nodeType),
      objectNodeTypes: request.context.objects.map((object) => object.nodeType),
      labelledEdgeCount: request.context.edges.filter((edge) => Boolean(edge.label)).length,
      glossaryEntryCount: request.context.projectGlossary.length,
    },
    pendingClarification: request.pendingClarification
      ? {
          present: true,
          missingSlotCount: request.pendingClarification.missingSlots.length,
        }
      : { present: false, missingSlotCount: 0 },
  };
}

function asTraceData(input: Record<string, unknown>): VoiceTraceData {
  const bounded = redactDiagnosticValue(input) as Record<string, VoiceTraceValue>;
  return redactVoiceTraceContent(bounded) ?? {};
}

function semanticPlanSummary(plan: SemanticIntentProviderResult["plan"]): Record<string, unknown> {
  return {
    resolution: plan.status,
    actionCount: plan.actions.length,
    actionTypes: plan.actions.map((action) => action.type),
    clarificationRequired: plan.status === "clarification",
  };
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return Boolean(origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)));
}
