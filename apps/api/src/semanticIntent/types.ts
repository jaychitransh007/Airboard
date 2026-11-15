import type { SemanticPlan } from "@airboard/core/semantic-plan";

export type SemanticIntentObjectSummary = {
  label: string;
  nodeType: string;
  ordinal?: number;
  selected?: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
};

export type SemanticIntentObjectReferenceSummary = {
  label: string;
  nodeType: string;
  ordinal?: number;
};

export type SemanticIntentEdgeSummary = {
  from: SemanticIntentObjectReferenceSummary;
  to: SemanticIntentObjectReferenceSummary;
  label?: string;
  occurrence?: number;
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

export const SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES = [
  "compound_command",
  "missing_node_type",
  "ambiguous_node_type",
  "unsupported_count",
  "missing_connection_endpoint",
  "same_connection_endpoint",
  "invalid_connection_label",
  "missing_selection_target",
  "missing_label",
  "missing_direction",
  "missing_alignment",
  "ambiguous_alignment",
  "missing_distribution_axis",
  "missing_layout_direction",
  "unknown_command",
  "ambiguous_object_reference",
  "missing_object_reference",
  "unsupported_branching",
  "grounding_failed",
] as const;

export type SemanticIntentRecoverableParserIssue =
  (typeof SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES)[number];

/**
 * How the speaker got Airo's attention: the wake word, an open palm, holding
 * a shape, typing, or the short follow-up window after a command. Present
 * only when the sentence was addressed to Airo; the wake word itself is
 * stripped before the transcript reaches the planner.
 */
export const SEMANTIC_INTENT_ADDRESSED_BY = ["wake", "palm", "hold", "typed", "follow_up"] as const;
export type SemanticIntentAddressedBy = (typeof SEMANTIC_INTENT_ADDRESSED_BY)[number];

export type SemanticIntentRequest = {
  voiceTurnId: string;
  transcript: string;
  parserIssue: SemanticIntentRecoverableParserIssue;
  context: SemanticIntentContext;
  pendingClarification?: SemanticIntentPendingClarification;
  addressedBy?: SemanticIntentAddressedBy;
  model?: string;
};

export type SemanticIntentResolution = SemanticPlan;

export type SemanticIntentProviderResult = {
  plan: SemanticPlan;
  provider: string;
  model: string;
  metadata: SemanticIntentProviderMetadata;
};

/**
 * HTTP orchestration result for a supported request whose complete desired
 * relationship set is already present. This intentionally remains outside the
 * SemanticPlan 1.1 contract, where a resolved plan must contain an action.
 */
export type SemanticIntentAlreadySatisfiedResult = {
  outcome: "already_satisfied";
  plan: null;
  provider: string;
  model: string;
  metadata: SemanticIntentProviderMetadata;
};

export type SemanticIntentHttpResult =
  | SemanticIntentProviderResult
  | SemanticIntentAlreadySatisfiedResult;

export type SemanticIntentProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type SemanticIntentProviderMetadata = {
  responseId: string | null;
  responseModel: string;
  providerRequestId: string | null;
  clientRequestId: string;
  providerProcessingMs: number | null;
  totalLatencyMs: number;
  usage: SemanticIntentProviderUsage | null;
};

/**
 * Token usage with the cache and reasoning detail. Server logs only: the
 * browser checks `metadata.usage` for its exact keys, so these fields never go
 * on the wire.
 */
export type SemanticIntentProviderUsageDetail = SemanticIntentProviderUsage & {
  /** Input tokens served from the prompt cache (`input_tokens_details.cached_tokens`). */
  cachedInputTokens: number | null;
  /** `output_tokens_details.reasoning_tokens`. */
  reasoningTokens: number | null;
};

/** Server-side timing and usage detail for one planner call, logged but never sent to the browser. */
export type SemanticIntentProviderDiagnostics = {
  /** Whether the answer was read from a server-sent event stream. */
  streamed: boolean;
  /** Milliseconds from sending the request to the response headers. */
  headersMs: number | null;
  /** Milliseconds from sending the request to the finished plan tool call (streamed only). */
  itemDoneMs: number | null;
  /** Usage when it was read before the planner answered, otherwise null. */
  usage: SemanticIntentProviderUsageDetail | null;
};

export type SemanticIntentProviderResolution = {
  plan: SemanticPlan;
  metadata: SemanticIntentProviderMetadata;
  diagnostics?: SemanticIntentProviderDiagnostics;
  /**
   * A streamed answer resolves at the finished tool call, before the
   * provider's final event carries the token usage. This settles with that
   * usage (or null) once the rest of the stream is read, for logging only.
   */
  lateUsage?: Promise<SemanticIntentProviderUsageDetail | null>;
};

export type SemanticIntentRuntimeConfig = {
  provider: string;
  defaultModel: string;
  allowedModels: string[];
  endpoint: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium";
  /** OpenAI processing tier; priority answers faster at a higher token price. */
  serviceTier: "auto" | "default" | "flex" | "priority";
  timeoutMs: number;
  maxConcurrentRequests: number;
  maxTranscriptCharacters: number;
  /**
   * Read the planner answer as a stream and stop at the finished tool call
   * (AIRBOARD_INTENT_STREAM, on unless "off"). Off sends exactly the
   * non-streamed request.
   */
  stream?: boolean;
  apiKey?: string;
};

export interface SemanticIntentProvider {
  readonly id: string;
  resolve(
    request: SemanticIntentRequest,
    model: string,
    signal?: AbortSignal,
  ): Promise<SemanticIntentProviderResolution>;
}
