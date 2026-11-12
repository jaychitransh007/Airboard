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

export type SemanticIntentProviderResolution = {
  plan: SemanticPlan;
  metadata: SemanticIntentProviderMetadata;
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
