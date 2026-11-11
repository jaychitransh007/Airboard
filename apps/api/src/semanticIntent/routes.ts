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
  isSemanticIntentProviderOutage,
  mapSemanticIntentProviderError,
  SemanticIntentProviderError,
} from "./providerError";
import { parseSemanticIntentRequest } from "./protocol";
import { publicSemanticIntentConfig } from "./publicConfig";
import { clientKey, configuredApiTokenAllowed, createCircuitBreaker, originAllowed } from "../security";
import { createSharedRateLimiter } from "../sharedRateLimit";
import type {
  SemanticIntentHttpResult,
  SemanticIntentProviderMetadata,
  SemanticIntentProviderResult,
  SemanticIntentRequest,
} from "./types";
import type { AuthService } from "../auth";
import { createDailyUsage } from "../dailyUsage";

const DETERMINISTIC_SEMANTIC_PROVIDER = "airboard-deterministic";
const EXISTING_BOARD_FAN_IN_MODEL = "existing-board-fan-in-v1";

/** How long a spoken turn, once charged, is not charged again. */
const CHARGED_TURN_WINDOW_MS = 5 * 60_000;
const CHARGED_TURN_MAX_KEYS = 10_000;

/** Keys seen in the last `windowMs`, oldest dropped first past `maxKeys`. */
export function createRecentKeys(windowMs: number, maxKeys: number, now: () => number = Date.now) {
  const seenAt = new Map<string, number>();
  const prune = () => {
    const cutoff = now() - windowMs;
    for (const [key, at] of seenAt) {
      if (at > cutoff && seenAt.size <= maxKeys) break;
      seenAt.delete(key);
    }
  };
  return {
    has(key: string): boolean {
      prune();
      return seenAt.has(key);
    },
    remember(key: string): void {
      seenAt.delete(key);
      seenAt.set(key, now());
      prune();
    },
  };
}

export function registerSemanticIntentRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  traceBuffer = new VoiceTraceBuffer(),
  auth?: AuthService,
): void {
  const provider = createSemanticIntentProvider(config.semanticIntent);
  let activeRequests = 0;
  const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  const rateLimiter = createSharedRateLimiter({
    bucket: "intent",
    windowMs: 60_000,
    max: config.rateLimits.intentPerMinute,
    client: auth?.client ?? null,
    keySecret: config.sessionSigningSecret,
    onError: (error) => server.log.warn({ err: error }, "shared Airo rate limit could not be counted"),
  });
  const usage = createDailyUsage(
    auth?.client ?? null,
    config.dailyUsage,
    (error) => server.log.warn({ err: error }, "daily Airo allowance could not be counted"),
    {
      ...(config.serviceDailyUsage ? { service: config.serviceDailyUsage } : {}),
      onServiceLimitReached: () =>
        server.log.warn({ limit: config.serviceDailyUsage?.airoCommands }, "the service's daily Airo limit is reached"),
    },
  );

  const chargedTurns = createRecentKeys(CHARGED_TURN_WINDOW_MS, CHARGED_TURN_MAX_KEYS);

  server.get("/intent/config", async () => publicSemanticIntentConfig(config.semanticIntent));

  server.post<{ Body: unknown }>("/intent/resolve", async (request, reply) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
    }
    const operator = configuredApiTokenAllowed(request, config.apiToken);
    const context =
      !operator && auth ? await auth.authenticate(request) : null;
    if (!operator && !context && !config.localEntitlements) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    if (
      !(await rateLimiter.allow(
        clientKey(request, {
          profileId: context?.profileId,
          trustedProxyHops: config.trustedProxyHops,
        }),
      ))
    ) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    // Signing in is free (magic links auto-provision an account), so model
    // spend additionally requires the caller's organization to hold an
    // active, trialing, or grace entitlement.
    if (
      context &&
      auth &&
      !config.localEntitlements &&
      !(await auth.activeEntitlement(context.organizationId))
    ) {
      return reply.code(402).send({ error: "ACTIVE_ENTITLEMENT_REQUIRED" });
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
    // During a provider outage, answer at once; the app falls back to its
    // built-in command grammar.
    // The cool-down is temporary, so it has its own code: the app says
    // "back in a few seconds", not "not configured".
    const breakerWaitMs = breaker.retryAfterMs();
    if (breakerWaitMs !== null) {
      reply.header("Retry-After", Math.max(1, Math.ceil(breakerWaitMs / 1_000)));
      return reply.code(503).send({
        error: "SEMANTIC_INTENT_COOLING_DOWN",
        message: "Airo's planner is pausing after repeated failures and will be back shortly.",
        retryAfterMs: breakerWaitMs,
      });
    }

    // Claim a provider slot before charging, so a request refused as busy
    // costs no one's allowance.
    if (activeRequests >= config.semanticIntent.maxConcurrentRequests) {
      return reply.code(429).send({ error: "SEMANTIC_INTENT_CAPACITY_REACHED" });
    }
    activeRequests += 1;

    // A person's daily allowance and the service's daily total hold across
    // instances, so neither one account nor many can run up the model bill.
    // Built-in commands never reach here.
    // The app retries a command at most once, and only when the planner
    // certainly did not run it; even so, the same spoken turn is charged at
    // most once in a short window.
    const chargeKey = context ? `${context.profileId}:${parsed.value.voiceTurnId}` : null;
    const alreadyCharged = chargeKey !== null && chargedTurns.has(chargeKey);
    const allowance =
      context && !alreadyCharged
        ? await usage.consume(context.profileId, "airo_commands", 1)
        : "allowed";
    if (chargeKey !== null && !alreadyCharged && allowance === "allowed") {
      chargedTurns.remember(chargeKey);
    }
    if (allowance !== "allowed") {
      activeRequests = Math.max(0, activeRequests - 1);
      return reply.code(429).send(
        allowance === "exhausted"
          ? {
              error: "DAILY_AIRO_LIMIT",
              message: "You've reached today's Airo limit. Built-in commands still work, and the limit resets at midnight UTC.",
            }
          : {
              error: "SERVICE_AIRO_LIMIT",
              message: "Airo has reached today's limit for everyone in the pilot. Built-in commands still work, and Airo is back at midnight UTC.",
            },
      );
    }

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      semanticIntentTimeoutForTranscript(config.semanticIntent.timeoutMs, parsed.value.transcript.length),
    );
    try {
      const resolution = await provider.resolve(parsed.value, model, abortController.signal);
      breaker.recordSuccess();
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
      if (isSemanticIntentProviderOutage(normalizedError)) breaker.recordFailure();
      else breaker.recordSuccess();
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

/**
 * The model writes a longer plan for a longer narration, so the wait grows
 * with the transcript: the configured budget for a short command, plus 9 ms a
 * character past 240, up to 20 s (or the configured budget if that is
 * larger). The browser waits one second longer than this for the same text.
 */
export function semanticIntentTimeoutForTranscript(baseTimeoutMs: number, transcriptLength: number): number {
  return Math.min(
    Math.max(baseTimeoutMs, 20_000),
    baseTimeoutMs + Math.max(0, transcriptLength - 240) * 9,
  );
}

function semanticRequestLog(request: SemanticIntentRequest, model: string): Record<string, unknown> {
  return {
    voiceTurnId: request.voiceTurnId,
    addressedBy: request.addressedBy ?? null,
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

