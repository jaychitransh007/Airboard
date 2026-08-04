import {
  parseSemanticPlan,
  type SemanticPlan,
  type SemanticPlanIssueCode,
} from "@airboard/core/semantic-plan";
import type { IntentCanvasParseResult } from "./intentCanvasParser";

export type SemanticIntentConfig = {
  available: boolean;
  provider: string | null;
  defaultModel: string | null;
  allowedModels: string[];
};

export type SemanticIntentObjectSummary = {
  label: string;
  nodeType: string;
  ordinal: number;
  selected: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
};

export type SemanticIntentObjectReferenceSummary = Pick<
  SemanticIntentObjectSummary,
  "label" | "nodeType" | "ordinal"
>;

export type SemanticIntentEdgeSummary = {
  from: SemanticIntentObjectReferenceSummary;
  to: SemanticIntentObjectReferenceSummary;
  label?: string;
  /** Stable one-based position among parallel connectors with the same endpoints. */
  occurrence: number;
};

export type SemanticIntentGlossaryEntry = {
  term: string;
  nodeType?: string;
};

export type SemanticIntentContext = {
  selectionCount: number;
  selected: SemanticIntentObjectSummary[];
  objects: SemanticIntentObjectSummary[];
  edges: SemanticIntentEdgeSummary[];
  projectGlossary: SemanticIntentGlossaryEntry[];
  pointerAvailable: boolean;
};

export type SemanticIntentPendingClarification = {
  previousTranscript: string;
  question: string;
  missingSlots: string[];
};

export type SemanticIntentParserIssue =
  | "compound_command"
  | "missing_node_type"
  | "ambiguous_node_type"
  | "unsupported_count"
  | "missing_connection_endpoint"
  | "same_connection_endpoint"
  | "invalid_connection_label"
  | "missing_selection_target"
  | "missing_label"
  | "missing_direction"
  | "missing_alignment"
  | "ambiguous_alignment"
  | "missing_distribution_axis"
  | "missing_layout_direction"
  | "unknown_command"
  | "ambiguous_object_reference"
  | "missing_object_reference"
  | "unsupported_branching"
  | "grounding_failed";

export type SemanticIntentResolutionMetadata = {
  responseId: string | null;
  responseModel: string;
  providerRequestId: string | null;
  clientRequestId: string;
  providerProcessingMs: number | null;
  totalLatencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
};

export type SemanticIntentResolution =
  | {
      outcome: "plan";
      plan: SemanticPlan;
      provider: string;
      model: string;
      metadata: SemanticIntentResolutionMetadata;
    }
  | {
      outcome: "already_satisfied";
      plan: null;
      provider: string;
      model: string;
      metadata: SemanticIntentResolutionMetadata;
    };

type SemanticIntentResolutionWireBase = {
  provider: string;
  model: string;
  metadata: SemanticIntentResolutionMetadata;
};

export type ResolveSemanticIntentOptions = {
  apiBaseUrl: string;
  accessToken?: string;
  voiceTurnId: string;
  transcript: string;
  parserIssue: SemanticIntentParserIssue;
  context: SemanticIntentContext;
  pendingClarification?: SemanticIntentPendingClarification;
  model?: string;
  timeoutMs?: number;
};

export function shouldUseSemanticIntentFallback(
  result: IntentCanvasParseResult,
): result is Exclude<IntentCanvasParseResult, { status: "parsed" | "inactive" }> {
  return (
    result.status !== "parsed" &&
    result.status !== "inactive" &&
    Boolean(result.normalizedText) &&
    result.issue.code !== "activation_required" &&
    result.issue.code !== "empty_command"
  );
}

export class SemanticIntentClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly providerRequestId: string | null;

  constructor(code: string, status: number, serverMessage?: string, providerRequestId?: string) {
    super(describeSemanticIntentError(code, serverMessage));
    this.name = "SemanticIntentClientError";
    this.code = code;
    this.status = status;
    this.providerRequestId = providerRequestId?.trim() || null;
  }
}

export async function fetchSemanticIntentConfig(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SemanticIntentConfig> {
  const response = await fetchImpl(new URL("/intent/config", apiBaseUrl), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Semantic intent config request failed (${response.status}).`);
  }
  const payload = (await response.json()) as Partial<SemanticIntentConfig>;
  return {
    available: payload.available === true,
    provider: typeof payload.provider === "string" ? payload.provider : null,
    defaultModel: typeof payload.defaultModel === "string" ? payload.defaultModel : null,
    allowedModels: Array.isArray(payload.allowedModels)
      ? payload.allowedModels.filter((model): model is string => typeof model === "string")
      : [],
  };
}

export async function resolveSemanticIntent(
  options: ResolveSemanticIntentOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<SemanticIntentResolution> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_000);
  try {
    const response = await fetchImpl(new URL("/intent/resolve", options.apiBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: JSON.stringify({
        voiceTurnId: options.voiceTurnId,
        transcript: options.transcript,
        parserIssue: options.parserIssue,
        context: options.context,
        ...(options.pendingClarification
          ? { pendingClarification: options.pendingClarification }
          : {}),
        ...(options.model ? { model: options.model } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await safeJson(response);
      const code =
        payload && typeof payload.error === "string"
          ? payload.error
          : `SEMANTIC_INTENT_HTTP_${response.status}`;
      const message = payload && typeof payload.message === "string" ? payload.message.slice(0, 400) : undefined;
      const providerRequestId =
        payload && typeof payload.providerRequestId === "string"
          ? payload.providerRequestId.slice(0, 160)
          : undefined;
      throw new SemanticIntentClientError(code, response.status, message, providerRequestId);
    }
    return parseSemanticIntentResolution(await response.json());
  } catch (caught) {
    if (controller.signal.aborted) {
      throw new SemanticIntentClientError("SEMANTIC_INTENT_TIMEOUT", 504);
    }
    if (caught instanceof TypeError) {
      throw new SemanticIntentClientError("SEMANTIC_INTENT_NETWORK_ERROR", 503);
    }
    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

export function semanticIntentIssueMessage(
  issueCode: SemanticPlanIssueCode,
): string {
  switch (issueCode) {
    case "ambiguous_reference":
      return "Airo found more than one possible board command. Please be more specific.";
    case "missing_context":
      return "Airo needs a selected or clearly named object to do that.";
    case "missing_selection":
      return "Airo needs you to select the object or name it explicitly.";
    case "missing_pointer":
      return "Airo needs you to point at a board location or object first.";
    case "missing_label":
      return "Airo needs the label you want to use.";
    case "missing_source":
      return "Airo needs the source object for that connection.";
    case "missing_target":
      return "Airo needs the target object for that connection.";
    case "incomplete_request":
      return "Airo heard an incomplete request and needs one more detail.";
    case "plan_too_large":
      return "That diagram is too large for one safe preview. Split it into two requests.";
    case "unsupported_operation":
      return "That board operation is not supported yet.";
    case "not_board_command":
      return "Airo did not hear a board command.";
    case "none":
      return "Airo understood the command.";
  }
}

function parseSemanticIntentResolution(input: unknown): SemanticIntentResolution {
  if (!isRecord(input)) {
    throw new SemanticIntentClientError("INVALID_SEMANTIC_INTENT_RESPONSE", 502);
  }
  const wireBase = parseSemanticIntentWireBase(input);
  if (!wireBase) {
    throw new SemanticIntentClientError("INVALID_SEMANTIC_INTENT_RESPONSE", 502);
  }
  const alreadySatisfiedKeys = ["metadata", "model", "outcome", "plan", "provider"];
  if (
    Object.keys(input).length === alreadySatisfiedKeys.length &&
    alreadySatisfiedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    ) &&
    input.outcome === "already_satisfied" &&
    input.plan === null
  ) {
    return {
      outcome: "already_satisfied",
      plan: null,
      ...wireBase,
    };
  }
  const planKeys = ["metadata", "model", "plan", "provider"];
  if (
    Object.keys(input).length !== planKeys.length ||
    !planKeys.every((key) => Object.prototype.hasOwnProperty.call(input, key))
  ) {
    throw new SemanticIntentClientError("INVALID_SEMANTIC_INTENT_RESPONSE", 502);
  }
  const parsedPlan = parseSemanticPlan(input.plan);
  if (!parsedPlan.ok) {
    throw new SemanticIntentClientError("INVALID_SEMANTIC_INTENT_RESPONSE", 502);
  }
  return {
    outcome: "plan",
    plan: parsedPlan.value,
    ...wireBase,
  };
}

function parseSemanticIntentWireBase(
  input: Record<string, unknown>,
): SemanticIntentResolutionWireBase | null {
  const metadata = parseSemanticIntentMetadata(input.metadata);
  if (
    !metadata ||
    typeof input.provider !== "string" ||
    !input.provider.trim() ||
    typeof input.model !== "string" ||
    !input.model.trim()
  ) {
    return null;
  }
  return {
    provider: input.provider.trim(),
    model: input.model.trim(),
    metadata,
  };
}

function parseSemanticIntentMetadata(
  input: unknown,
): SemanticIntentResolutionMetadata | null {
  if (!isRecord(input)) {
    return null;
  }
  const exactKeys = [
    "clientRequestId",
    "providerProcessingMs",
    "providerRequestId",
    "responseId",
    "responseModel",
    "totalLatencyMs",
    "usage",
  ];
  if (
    Object.keys(input).length !== exactKeys.length ||
    !exactKeys.every((key) => Object.prototype.hasOwnProperty.call(input, key)) ||
    !nullableBoundedString(input.responseId, 200) ||
    typeof input.responseModel !== "string" ||
    !input.responseModel.trim() ||
    !nullableBoundedString(input.providerRequestId, 200) ||
    typeof input.clientRequestId !== "string" ||
    !input.clientRequestId.trim() ||
    !nullableNonNegativeNumber(input.providerProcessingMs) ||
    typeof input.totalLatencyMs !== "number" ||
    !Number.isFinite(input.totalLatencyMs) ||
    input.totalLatencyMs < 0
  ) {
    return null;
  }
  const usage = parseSemanticIntentUsage(input.usage);
  if (input.usage !== null && !usage) {
    return null;
  }
  return {
    responseId: input.responseId as string | null,
    responseModel: input.responseModel.trim().slice(0, 200),
    providerRequestId: input.providerRequestId as string | null,
    clientRequestId: input.clientRequestId.trim().slice(0, 240),
    providerProcessingMs: input.providerProcessingMs as number | null,
    totalLatencyMs: input.totalLatencyMs,
    usage,
  };
}

function parseSemanticIntentUsage(
  input: unknown,
): SemanticIntentResolutionMetadata["usage"] {
  if (input === null) {
    return null;
  }
  if (!isRecord(input)) {
    return null;
  }
  const keys = ["inputTokens", "outputTokens", "totalTokens"];
  if (
    Object.keys(input).length !== keys.length ||
    !keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(input, key) &&
        typeof input[key] === "number" &&
        Number.isInteger(input[key]) &&
        input[key] >= 0,
    )
  ) {
    return null;
  }
  return {
    inputTokens: input.inputTokens as number,
    outputTokens: input.outputTokens as number,
    totalTokens: input.totalTokens as number,
  };
}

function nullableBoundedString(input: unknown, maxLength: number): boolean {
  return input === null || (typeof input === "string" && input.length <= maxLength);
}

function nullableNonNegativeNumber(input: unknown): boolean {
  return input === null || (typeof input === "number" && Number.isFinite(input) && input >= 0);
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = (await response.json()) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function describeSemanticIntentError(code: string, serverMessage?: string): string {
  switch (code) {
    case "SEMANTIC_INTENT_TIMEOUT":
      return "Airo's semantic command interpretation timed out.";
    case "SEMANTIC_INTENT_UNAVAILABLE":
      return "Airo's semantic command interpretation is not configured.";
    case "SEMANTIC_INTENT_CAPACITY_REACHED":
      return "Airo's semantic command interpreter is busy.";
    case "SEMANTIC_INTENT_AUTH_FAILED":
    case "SEMANTIC_INTENT_PROVIDER_AUTH_FAILED":
      return "Airo's intent-model API key was rejected. Check the server-side provider key.";
    case "SEMANTIC_INTENT_QUOTA_EXHAUSTED":
      return "Airo's intent-model quota is exhausted. Add provider credits or switch models.";
    case "SEMANTIC_INTENT_RATE_LIMITED":
    case "SEMANTIC_INTENT_PROVIDER_RATE_LIMITED":
      return "Airo's intent model is rate-limited. Wait a moment or switch models.";
    case "SEMANTIC_INTENT_MODEL_UNAVAILABLE":
      return "The selected Airo intent model is unavailable. Choose another configured model.";
    case "SEMANTIC_INTENT_NETWORK_ERROR":
      return "Airo could not reach the semantic interpretation API.";
    case "SEMANTIC_INTENT_PROVIDER_FAILED":
      return serverMessage || "Airo's intent provider failed before returning a plan.";
    case "SEMANTIC_INTENT_PROVIDER_REQUEST_REJECTED":
      return serverMessage || "The intent provider rejected Airo's structured plan request.";
    case "SEMANTIC_INTENT_INVALID_PROVIDER_OUTPUT":
      return "Airo's intent provider returned an invalid plan. The board was not changed.";
    case "SEMANTIC_INTENT_PROVIDER_UNAVAILABLE":
      return "Airo's intent provider is temporarily unavailable.";
    default:
      return serverMessage || "Airo could not semantically interpret that command.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
