import { randomUUID } from "node:crypto";

import {
  parseSemanticPlan,
} from "../../../packages/core/src/semanticPlan.ts";

export class AudioSemanticProviderError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "AudioSemanticProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function createFakeSemanticAdapter() {
  return {
    id: "fake",
    async resolve({ scenario }) {
      return fixtureResolution(
        scenario.source?.fakeSemanticPlan,
        "fake",
        "fixture",
      );
    },
  };
}

export function createRecordedSemanticAdapter() {
  return {
    id: "recorded-replay",
    async resolve({ scenario }) {
      const fixture = scenario.source?.semanticProviderResponse;
      if (isAlreadySatisfiedPayload(fixture)) {
        return {
          outcome: "already_satisfied",
          plan: null,
          provider: cleanString(fixture.provider) ?? "recorded",
          model: cleanString(fixture.model) ?? "recorded-fixture",
          latencyMs: 0,
          metadata: sanitizeMetadata(fixture.metadata),
          retryCount: 0,
        };
      }
      const plan = fixture?.plan ?? scenario.source?.semanticPlan;
      return fixtureResolution(
        plan,
        typeof fixture?.provider === "string"
          ? fixture.provider
          : "recorded",
        typeof fixture?.model === "string"
          ? fixture.model
          : "recorded-fixture",
        fixture?.metadata,
      );
    },
  };
}

export function createLiveSemanticApiAdapter({
  apiBaseUrl = "http://127.0.0.1:4000",
  origin = "http://localhost:3000",
  model,
  timeoutMs = 20_000,
  accessToken,
  apiToken,
  fetchImpl = fetch,
} = {}) {
  const endpoint = new URL(
    "/intent/resolve",
    normalizeBaseUrl(apiBaseUrl),
  );
  return {
    id: "live-api",
    async resolve(request) {
      let firstFailure = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const resolution = await requestSemanticPlan({
            endpoint,
            origin,
            model,
            timeoutMs,
            accessToken,
            apiToken,
            fetchImpl,
            request,
          });
          return {
            ...resolution,
            retryCount: attempt,
            ...(firstFailure
              ? { firstFailureCode: firstFailure.code }
              : {}),
          };
        } catch (error) {
          if (
            attempt === 0 &&
            error instanceof AudioSemanticProviderError &&
            error.retryable
          ) {
            firstFailure = error;
            continue;
          }
          throw error;
        }
      }
      throw firstFailure;
    },
  };
}

async function requestSemanticPlan({
  endpoint,
  origin,
  model,
  timeoutMs,
  accessToken,
  apiToken,
  fetchImpl,
  request,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const headers = {
      "Content-Type": "application/json",
      Origin: origin,
    };
    const bearerToken = accessToken ?? apiToken;
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          voiceTurnId:
            request.interactionId ??
            `audio-eval-${randomUUID()}`,
          transcript: request.transcript,
          parserIssue: request.parserIssue,
          context: request.context,
          ...(request.pendingClarification
            ? { pendingClarification: request.pendingClarification }
            : {}),
          ...(model ? { model } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AudioSemanticProviderError(
          "timeout",
          `Semantic provider exceeded ${timeoutMs}ms.`,
          { retryable: true },
        );
      }
      throw new AudioSemanticProviderError(
        "provider_unavailable",
        "Semantic provider could not be reached.",
        { retryable: true },
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      const code =
        cleanString(payload?.error) ??
        cleanString(payload?.code) ??
        `HTTP_${response.status}`;
      throw new AudioSemanticProviderError(
        code,
        `Semantic provider returned HTTP ${response.status}.`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }
    if (isAlreadySatisfiedPayload(payload)) {
      return {
        outcome: "already_satisfied",
        plan: null,
        provider: cleanString(payload.provider) ?? "api",
        model: cleanString(payload.model) ?? model ?? "server-default",
        latencyMs: performance.now() - startedAt,
        metadata: sanitizeMetadata(payload.metadata),
        retryCount: 0,
      };
    }
    const parsed = parseSemanticPlan(
      isRecord(payload?.plan) ? payload.plan : payload,
    );
    if (!parsed.ok) {
      throw new AudioSemanticProviderError(
        "invalid_provider_output",
        `Semantic provider plan is invalid at ${parsed.error.path}: ${parsed.error.message}`,
      );
    }
    return {
      outcome: "plan",
      plan: parsed.value,
      provider: cleanString(payload?.provider) ?? "api",
      model:
        cleanString(payload?.model) ??
        model ??
        "server-default",
      latencyMs: performance.now() - startedAt,
      metadata: sanitizeMetadata(payload?.metadata),
      retryCount: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fixtureResolution(plan, provider, model, metadata = null) {
  const parsed = parseSemanticPlan(plan);
  if (!parsed.ok) {
    throw new AudioSemanticProviderError(
      "invalid_recorded_plan",
      `Recorded semantic plan is invalid at ${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  return {
    outcome: "plan",
    plan: parsed.value,
    provider,
    model,
    latencyMs: 0,
    metadata: sanitizeMetadata(metadata),
    retryCount: 0,
  };
}

function isAlreadySatisfiedPayload(value) {
  if (!isRecord(value)) return false;
  const keys = ["metadata", "model", "outcome", "plan", "provider"];
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    value.outcome === "already_satisfied" &&
    value.plan === null &&
    cleanString(value.provider) !== null &&
    cleanString(value.model) !== null &&
    isRecord(value.metadata)
  );
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new AudioSemanticProviderError(
      "malformed_provider_response",
      "Semantic provider returned malformed JSON.",
    );
  }
}

function sanitizeMetadata(value) {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage)
    ? {
        inputTokens: nonNegativeNumber(value.usage.inputTokens),
        outputTokens: nonNegativeNumber(value.usage.outputTokens),
        totalTokens: nonNegativeNumber(value.usage.totalTokens),
      }
    : null;
  return {
    providerProcessingMs: nullableNonNegativeNumber(
      value.providerProcessingMs,
    ),
    totalLatencyMs: nullableNonNegativeNumber(value.totalLatencyMs),
    usage,
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("Semantic API URL must use HTTP or HTTPS.");
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

function cleanString(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nullableNonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
