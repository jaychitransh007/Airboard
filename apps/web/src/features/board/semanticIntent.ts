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

/**
 * How the speaker got Airo's attention for this sentence. Production strips
 * the wake word before the planner sees the text, and palm-activated speech
 * never had one, so without this the planner can't tell a request narrated
 * to Airo from the room talking among itself.
 * - wake: said "Airo" first. palm: held an open palm. hold: held a shape
 *   (hold-to-edit). typed: typed into the Airo box. follow_up: spoke inside
 *   the short window after an applied command, with no wake word.
 */
export const SEMANTIC_INTENT_ADDRESSED_BY = ["wake", "palm", "hold", "typed", "follow_up"] as const;
export type SemanticIntentAddressedBy = (typeof SEMANTIC_INTENT_ADDRESSED_BY)[number];

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
  /** Set whenever the sentence was addressed to Airo; see SemanticIntentAddressedBy. */
  addressedBy?: SemanticIntentAddressedBy;
  model?: string;
  /** Per attempt. Defaults to semanticIntentTimeoutMs(transcript length). */
  timeoutMs?: number;
  /** Attempts in all, including the first. Defaults to 2: one retry on a failure the planner never ran. */
  maxAttempts?: number;
  /** Test seam for the wait before a retry. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The browser's wait for one planning attempt. A long narrated flow makes a
 * long plan, which takes the model longer to write, so the budget grows with
 * the transcript: 6 s for a short command, up to 21 s for 2,000 characters.
 * It stays one second above the server's own budget for the same text, so the
 * server's answer (or its timeout error) always arrives first.
 */
export function semanticIntentTimeoutMs(transcriptLength: number): number {
  return Math.min(21_000, 6_000 + Math.max(0, transcriptLength - 240) * 9);
}

/** The longest Retry-After worth waiting for before retrying a command. */
const SEMANTIC_INTENT_MAX_RETRY_WAIT_MS = 3_000;
/** Pause before retrying a failure that gave no Retry-After. */
const SEMANTIC_INTENT_DEFAULT_RETRY_WAIT_MS = 400;

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
  /** How long the server asked us to wait, when it said. */
  readonly retryAfterMs: number | null;

  constructor(
    code: string,
    status: number,
    serverMessage?: string,
    providerRequestId?: string,
    retryAfterMs?: number | null,
  ) {
    super(describeSemanticIntentError(code, serverMessage));
    this.name = "SemanticIntentClientError";
    this.code = code;
    this.status = status;
    this.providerRequestId = providerRequestId?.trim() || null;
    this.retryAfterMs = retryAfterMs ?? null;
  }

  /**
   * True for a failure that should pass on its own (a timeout, a network
   * blip, a server error, a short rate limit or cool-down), as opposed to one
   * that needs someone to act (no access, daily limit, bad key or model).
   */
  get temporary(): boolean {
    return isTemporarySemanticIntentFailure(this.code, this.status, this.retryAfterMs);
  }
}

const PERMANENT_SEMANTIC_INTENT_CODES = new Set([
  "SEMANTIC_INTENT_UNAVAILABLE",
  "SEMANTIC_INTENT_QUOTA_EXHAUSTED",
  "SEMANTIC_INTENT_AUTH_FAILED",
  "SEMANTIC_INTENT_PROVIDER_AUTH_FAILED",
  "SEMANTIC_INTENT_MODEL_UNAVAILABLE",
  "SEMANTIC_INTENT_PROVIDER_REQUEST_REJECTED",
  "DAILY_AIRO_LIMIT",
  "SERVICE_AIRO_LIMIT",
  "ACTIVE_ENTITLEMENT_REQUIRED",
]);

function isTemporarySemanticIntentFailure(code: string, status: number, retryAfterMs: number | null): boolean {
  if (code === "SEMANTIC_INTENT_COOLING_DOWN") return true;
  // Older servers answered a cool-down with this code plus a wait.
  if (code === "SEMANTIC_INTENT_UNAVAILABLE") return retryAfterMs !== null;
  if (PERMANENT_SEMANTIC_INTENT_CODES.has(code)) return false;
  if (status === 429) return code !== "RATE_LIMITED" || retryAfterMs !== null;
  return status >= 500 || code === "SEMANTIC_INTENT_TIMEOUT" || code === "SEMANTIC_INTENT_NETWORK_ERROR";
}

/**
 * Failures where the planner certainly did not run the request, so asking
 * again neither charges the Airo allowance twice nor pays for a second model
 * call: the request never got an answer from the network, the server refused
 * it before charging (cool-down, rate limit with a stated wait), the model
 * provider itself turned it away with a stated wait, or the edge in front of
 * the API answered (no Airboard error code).
 *
 * A timeout is not one of these: the server may still be planning (and
 * billing) after the browser gives up, so a retry would run the same command
 * twice. Neither is a provider failure or bad provider output, which the
 * provider has already been paid for.
 */
function semanticIntentRetrySafe(error: SemanticIntentClientError): boolean {
  if (error.code === "SEMANTIC_INTENT_NETWORK_ERROR") return true;
  if (error.code === "SEMANTIC_INTENT_COOLING_DOWN") return true;
  if (error.code === "SEMANTIC_INTENT_UNAVAILABLE") return error.retryAfterMs !== null;
  if (error.code === "RATE_LIMITED" || error.code === "SEMANTIC_INTENT_RATE_LIMITED") {
    return error.retryAfterMs !== null;
  }
  // No Airboard error code: a load balancer or proxy answered for the API.
  return (
    error.code === `SEMANTIC_INTENT_HTTP_${error.status}` &&
    (error.status === 502 || error.status === 503 || error.status === 504)
  );
}

/** Whether one quick retry is worth it, and after how long. */
function semanticIntentRetryWaitMs(error: unknown): number | null {
  if (!(error instanceof SemanticIntentClientError) || !error.temporary) return null;
  if (!semanticIntentRetrySafe(error)) return null;
  if (error.retryAfterMs !== null) {
    return error.retryAfterMs <= SEMANTIC_INTENT_MAX_RETRY_WAIT_MS ? error.retryAfterMs : null;
  }
  // A 429 without a stated wait could last a minute; don't stall the presenter on it.
  if (error.status === 429) return null;
  return SEMANTIC_INTENT_DEFAULT_RETRY_WAIT_MS;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

export type LoadSemanticIntentConfigOptions = {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  /** Stops the retries; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Waits between attempts; the last one repeats until it works or is aborted. */
  delaysMs?: readonly number[];
  /** Attempts in all; unlimited by default. */
  maxAttempts?: number;
  /** Called after each failed attempt, for a quiet status line or a trace. */
  onAttemptFailed?: (error: unknown, attempt: number, nextDelayMs: number) => void;
  /** Test seam for the wait between attempts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Loads the planner settings, retrying with backoff (1, 2, 4, 8, 15, then
 * every 30 s) until it works or the signal aborts. A board opened during a
 * blip otherwise keeps Airo's planner off until a reload. An answer of
 * "not available" is a real answer and ends the retries.
 */
export async function loadSemanticIntentConfigWithRetry(
  options: LoadSemanticIntentConfigOptions,
): Promise<SemanticIntentConfig> {
  const delays = options.delaysMs?.length ? options.delaysMs : [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
  const sleep = options.sleep ?? abortableSleep;
  for (let attempt = 1; ; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      return await fetchSemanticIntentConfig(options.apiBaseUrl, options.fetchImpl ?? fetch);
    } catch (caught) {
      options.signal?.throwIfAborted();
      if (options.maxAttempts !== undefined && attempt >= options.maxAttempts) throw caught;
      const delay = delays[Math.min(attempt - 1, delays.length - 1)]!;
      options.onAttemptFailed?.(caught, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Asks the planner for a plan. A temporary failure the planner certainly did
 * not run (no answer from the network, an edge error, or a rate limit or
 * cool-down of 3 s or less) is retried once, so a single hiccup doesn't throw
 * away a spoken command. A timeout or provider failure is not retried, since
 * the first request may already have been charged and billed.
 */
export async function resolveSemanticIntent(
  options: ResolveSemanticIntentOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<SemanticIntentResolution> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await resolveSemanticIntentOnce(options, fetchImpl);
    } catch (caught) {
      const wait = attempt < maxAttempts ? semanticIntentRetryWaitMs(caught) : null;
      if (wait === null) throw caught;
      await sleep(wait);
    }
  }
}

async function resolveSemanticIntentOnce(
  options: ResolveSemanticIntentOptions,
  fetchImpl: typeof fetch,
): Promise<SemanticIntentResolution> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? semanticIntentTimeoutMs(options.transcript.length),
  );
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
        ...(options.addressedBy ? { addressedBy: options.addressedBy } : {}),
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
      throw new SemanticIntentClientError(
        code,
        response.status,
        message,
        providerRequestId,
        readRetryAfterMs(response, payload),
      );
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
      return "That's more than Airo can draw in one go. Describe the first part, then the rest.";
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

function readRetryAfterMs(response: Response, payload: Record<string, unknown> | null): number | null {
  if (payload && typeof payload.retryAfterMs === "number" && Number.isFinite(payload.retryAfterMs) && payload.retryAfterMs >= 0) {
    return payload.retryAfterMs;
  }
  const header = response.headers?.get?.("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
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
    case "SEMANTIC_INTENT_COOLING_DOWN":
      return "Airo's planner is pausing for a few seconds after repeated failures. Built-in commands still work.";
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
    case "ACTIVE_ENTITLEMENT_REQUIRED":
      return "Your pilot access has ended, so Airo can't interpret new requests. Typed commands and pointer edits still work.";
    case "RATE_LIMITED":
      return "Airo is receiving a lot of requests. Wait a moment and try again.";
    case "DAILY_AIRO_LIMIT":
      return "You've reached today's Airo limit. Built-in commands still work, and the limit resets at midnight UTC.";
    case "SERVICE_AIRO_LIMIT":
      return "Airo has reached today's limit for everyone in the pilot. Built-in commands still work, and Airo is back at midnight UTC.";
    default:
      return serverMessage || "Airo could not semantically interpret that command.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
