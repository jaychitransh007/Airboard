export type SemanticIntentProviderErrorKind =
  | "quota_exhausted"
  | "rate_limited"
  | "timeout"
  | "authentication_failed"
  | "model_unavailable"
  | "invalid_request"
  | "invalid_output"
  | "provider_unavailable";

export type SemanticIntentHttpError = {
  status: number;
  code: string;
  message: string;
  retryAfterMs?: number;
};

export class SemanticIntentProviderError extends Error {
  readonly kind: SemanticIntentProviderErrorKind;
  readonly upstreamStatus: number | undefined;
  readonly providerCode: string | undefined;
  readonly providerRequestId: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: SemanticIntentProviderErrorKind,
    message: string,
    details: {
      cause?: unknown;
      upstreamStatus?: number;
      providerCode?: string;
      providerRequestId?: string;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = "SemanticIntentProviderError";
    this.kind = kind;
    this.upstreamStatus = details.upstreamStatus;
    this.providerCode = details.providerCode;
    this.providerRequestId = details.providerRequestId;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export function mapSemanticIntentProviderError(input: unknown): SemanticIntentHttpError {
  if (!(input instanceof SemanticIntentProviderError)) {
    return {
      status: 502,
      code: "SEMANTIC_INTENT_PROVIDER_FAILED",
      message: "The semantic intent provider failed unexpectedly.",
    };
  }
  switch (input.kind) {
    case "quota_exhausted":
      return {
        status: 503,
        code: "SEMANTIC_INTENT_QUOTA_EXHAUSTED",
        message: "Airo's semantic planner quota is exhausted.",
      };
    case "rate_limited":
      return {
        status: 429,
        code: "SEMANTIC_INTENT_RATE_LIMITED",
        message: "Airo's semantic planner is temporarily rate limited.",
        ...(input.retryAfterMs !== undefined ? { retryAfterMs: input.retryAfterMs } : {}),
      };
    case "timeout":
      return {
        status: 504,
        code: "SEMANTIC_INTENT_TIMEOUT",
        message: "Airo's semantic planner timed out.",
      };
    case "authentication_failed":
      return {
        status: 503,
        code: "SEMANTIC_INTENT_PROVIDER_AUTH_FAILED",
        message: "Airo's semantic planner credentials were rejected.",
      };
    case "model_unavailable":
      return {
        status: 503,
        code: "SEMANTIC_INTENT_MODEL_UNAVAILABLE",
        message: "The configured semantic planning model is unavailable.",
      };
    case "invalid_request":
      return {
        status: 502,
        code: "SEMANTIC_INTENT_PROVIDER_REQUEST_REJECTED",
        message: "The semantic provider rejected Airboard's planning request.",
      };
    case "invalid_output":
      return {
        status: 502,
        code: "SEMANTIC_INTENT_INVALID_PROVIDER_OUTPUT",
        message: "The semantic provider returned an invalid diagram plan.",
      };
    case "provider_unavailable":
      return {
        status: 502,
        code: "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE",
        message: "The semantic planning provider is currently unavailable.",
      };
  }
}

export function classifyOpenAiProviderError(
  upstreamStatus: number,
  providerCode: string | undefined,
): SemanticIntentProviderErrorKind {
  const code = providerCode?.trim().toLowerCase();
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") {
    return "quota_exhausted";
  }
  if (upstreamStatus === 429 || code === "rate_limit_exceeded") {
    return "rate_limited";
  }
  if (upstreamStatus === 401 || upstreamStatus === 403 || code === "invalid_api_key") {
    return "authentication_failed";
  }
  if (
    code === "model_not_found" ||
    code === "invalid_model" ||
    code === "unsupported_model" ||
    (upstreamStatus === 404 && code?.includes("model"))
  ) {
    return "model_unavailable";
  }
  if (upstreamStatus >= 400 && upstreamStatus < 500) {
    return "invalid_request";
  }
  return "provider_unavailable";
}
