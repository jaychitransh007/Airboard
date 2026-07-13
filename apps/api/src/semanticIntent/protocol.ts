import { parseVoiceTurnId } from "../voiceTrace/protocol";
import {
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
  type SemanticIntentContext,
  type SemanticIntentEdgeSummary,
  type SemanticIntentGlossaryEntry,
  type SemanticIntentObjectReferenceSummary,
  type SemanticIntentObjectSummary,
  type SemanticIntentPendingClarification,
  type SemanticIntentRequest,
  type SemanticIntentRuntimeConfig,
} from "./types";

const MAX_CONTEXT_OBJECTS = 80;
const MAX_SELECTED_OBJECTS = 20;
const MAX_CONTEXT_EDGES = 160;
const MAX_PROJECT_GLOSSARY_ENTRIES = 100;
const MAX_LABEL_CHARACTERS = 120;
const MAX_NODE_TYPE_CHARACTERS = 40;
const MAX_DIALOGUE_CHARACTERS = 500;
const MAX_MISSING_SLOTS = 12;
const MAX_MISSING_SLOT_CHARACTERS = 80;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export type SemanticIntentProtocolError = {
  code: string;
  message: string;
};

export type SemanticIntentParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SemanticIntentProtocolError };

export function parseSemanticIntentRequest(
  input: unknown,
  config: Pick<SemanticIntentRuntimeConfig, "allowedModels" | "defaultModel" | "maxTranscriptCharacters">,
): SemanticIntentParseResult<SemanticIntentRequest> {
  if (!isRecord(input)) {
    return error("INVALID_REQUEST", "The semantic intent request must be a JSON object.");
  }

  const voiceTurnId = parseVoiceTurnId(input.voiceTurnId);
  if (!voiceTurnId) {
    return error(
      "INVALID_VOICE_TURN_ID",
      "voiceTurnId must be an 8 to 128 character safe diagnostic identifier.",
    );
  }

  const transcript = cleanBoundedString(input.transcript, config.maxTranscriptCharacters);
  if (!transcript) {
    return error("INVALID_TRANSCRIPT", "A non-empty voice transcript is required.");
  }
  if (CONTROL_CHARACTERS.test(transcript)) {
    return error("INVALID_TRANSCRIPT", "The voice transcript contains unsupported control characters.");
  }
  if (
    typeof input.parserIssue !== "string" ||
    !(SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES as readonly string[]).includes(
      input.parserIssue,
    )
  ) {
    return error(
      "SEMANTIC_FALLBACK_NOT_ALLOWED",
      "Semantic fallback requires an activated, non-empty command that the deterministic parser could not safely resolve.",
    );
  }

  const context = parseContext(input.context);
  if (!context.ok) {
    return context;
  }


  const pendingClarification = parsePendingClarification(input.pendingClarification);
  if (!pendingClarification.ok) {
    return pendingClarification;
  }

  if (
    input.model !== undefined &&
    (typeof input.model !== "string" || !input.model.trim())
  ) {
    return error("INVALID_MODEL", "model must be a non-empty string when provided.");
  }
  const requestedModel = cleanOptionalString(input.model);
  const model = requestedModel ?? config.defaultModel;
  if (!config.allowedModels.includes(model)) {
    return error("MODEL_NOT_ALLOWED", `Model ${model} is not enabled for semantic intent.`);
  }

  return {
    ok: true,
    value: {
      voiceTurnId,
      transcript,
      parserIssue: input.parserIssue as SemanticIntentRequest["parserIssue"],
      context: context.value,
      ...(pendingClarification.value
        ? { pendingClarification: pendingClarification.value }
        : {}),
      ...(requestedModel ? { model } : {}),
    },
  };
}

function parseContext(input: unknown): SemanticIntentParseResult<SemanticIntentContext> {
  if (!isRecord(input)) {
    return error("INVALID_CONTEXT", "Semantic intent context is required.");
  }
  if (
    typeof input.selectionCount !== "number" ||
    !Number.isInteger(input.selectionCount) ||
    input.selectionCount < 0 ||
    input.selectionCount > MAX_SELECTED_OBJECTS
  ) {
    return error("INVALID_CONTEXT", "selectionCount is outside the supported range.");
  }
  if (typeof input.pointerAvailable !== "boolean") {
    return error("INVALID_CONTEXT", "pointerAvailable must be a boolean.");
  }
  const selected = parseObjectSummaries(input.selected, MAX_SELECTED_OBJECTS);
  if (!selected.ok) {
    return selected;
  }
  const objects = parseObjectSummaries(input.objects, MAX_CONTEXT_OBJECTS);
  if (!objects.ok) {
    return objects;
  }
  const edges = parseEdges(input.edges ?? []);
  if (!edges.ok) {
    return edges;
  }
  const projectGlossary = parseProjectGlossary(input.projectGlossary ?? []);
  if (!projectGlossary.ok) {
    return projectGlossary;
  }
  if (input.selectionCount !== selected.value.length) {
    return error("INVALID_CONTEXT", "selectionCount must match the selected object summaries.");
  }
  return {
    ok: true,
    value: {
      selectionCount: input.selectionCount,
      selected: selected.value,
      objects: objects.value,
      edges: edges.value,
      projectGlossary: projectGlossary.value,
      pointerAvailable: input.pointerAvailable,
    },
  };
}

function parseObjectSummaries(
  input: unknown,
  limit: number,
): SemanticIntentParseResult<SemanticIntentContext["objects"]> {
  if (!Array.isArray(input) || input.length > limit) {
    return error("INVALID_CONTEXT", `Object summaries must contain at most ${limit} entries.`);
  }
  const result: SemanticIntentObjectSummary[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      return error("INVALID_CONTEXT", "Every object summary must be an object.");
    }
    const label = cleanBoundedString(item.label, MAX_LABEL_CHARACTERS);
    const nodeType = cleanBoundedString(item.nodeType, MAX_NODE_TYPE_CHARACTERS);
    if (!label || !nodeType || CONTROL_CHARACTERS.test(label) || CONTROL_CHARACTERS.test(nodeType)) {
      return error("INVALID_CONTEXT", "Every object summary needs a safe label and node type.");
    }
    const ordinal = parseOptionalOrdinal(item.ordinal);
    if (ordinal === false) {
      return error("INVALID_CONTEXT", "Object ordinal must be an integer between 1 and 1000.");
    }
    if (item.selected !== undefined && typeof item.selected !== "boolean") {
      return error("INVALID_CONTEXT", "Object selected must be a boolean when provided.");
    }
    const position = parseOptionalPoint(item.position);
    if (position === false) {
      return error("INVALID_CONTEXT", "Object position contains invalid coordinates.");
    }
    const size = parseOptionalSize(item.size);
    if (size === false) {
      return error("INVALID_CONTEXT", "Object size contains invalid dimensions.");
    }
    result.push({
      label,
      nodeType,
      ...(ordinal ? { ordinal } : {}),
      ...(typeof item.selected === "boolean" ? { selected: item.selected } : {}),
      ...(position ? { position } : {}),
      ...(size ? { size } : {}),
    });
  }
  return { ok: true, value: result };
}

function parseEdges(input: unknown): SemanticIntentParseResult<SemanticIntentEdgeSummary[]> {
  if (!Array.isArray(input) || input.length > MAX_CONTEXT_EDGES) {
    return error("INVALID_CONTEXT", `Edge summaries must contain at most ${MAX_CONTEXT_EDGES} entries.`);
  }
  const edges: SemanticIntentEdgeSummary[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      return error("INVALID_CONTEXT", "Every edge summary must be an object.");
    }
    const from = parseObjectReferenceSummary(item.from);
    const to = parseObjectReferenceSummary(item.to);
    if (!from || !to) {
      return error("INVALID_CONTEXT", "Every edge summary needs valid from and to references.");
    }
    const label =
      item.label === undefined ? null : cleanBoundedString(item.label, MAX_LABEL_CHARACTERS);
    if (item.label !== undefined && (!label || CONTROL_CHARACTERS.test(label))) {
      return error("INVALID_CONTEXT", "Edge labels must be safe bounded strings.");
    }
    edges.push({ from, to, ...(label ? { label } : {}) });
  }
  return { ok: true, value: edges };
}

function parseObjectReferenceSummary(input: unknown): SemanticIntentObjectReferenceSummary | null {
  if (!isRecord(input)) {
    return null;
  }
  const label = cleanBoundedString(input.label, MAX_LABEL_CHARACTERS);
  const nodeType = cleanBoundedString(input.nodeType, MAX_NODE_TYPE_CHARACTERS);
  const ordinal = parseOptionalOrdinal(input.ordinal);
  if (!label || !nodeType || ordinal === false) {
    return null;
  }
  return { label, nodeType, ...(ordinal ? { ordinal } : {}) };
}

function parseProjectGlossary(input: unknown): SemanticIntentParseResult<SemanticIntentGlossaryEntry[]> {
  if (!Array.isArray(input) || input.length > MAX_PROJECT_GLOSSARY_ENTRIES) {
    return error(
      "INVALID_CONTEXT",
      `Project glossary must contain at most ${MAX_PROJECT_GLOSSARY_ENTRIES} entries.`,
    );
  }
  const entries: SemanticIntentGlossaryEntry[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      return error("INVALID_CONTEXT", "Every project glossary entry must be an object.");
    }
    const term = cleanBoundedString(item.term, MAX_LABEL_CHARACTERS);
    const nodeType =
      item.nodeType === undefined
        ? null
        : cleanBoundedString(item.nodeType, MAX_NODE_TYPE_CHARACTERS);
    if (
      !term ||
      CONTROL_CHARACTERS.test(term) ||
      (item.nodeType !== undefined && (!nodeType || CONTROL_CHARACTERS.test(nodeType)))
    ) {
      return error("INVALID_CONTEXT", "Project glossary entries must contain safe bounded text.");
    }
    entries.push({ term, ...(nodeType ? { nodeType } : {}) });
  }
  return { ok: true, value: entries };
}

function parsePendingClarification(
  input: unknown,
): SemanticIntentParseResult<SemanticIntentPendingClarification | null> {
  if (input === undefined || input === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(input)) {
    return error("INVALID_CLARIFICATION_CONTEXT", "pendingClarification must be an object.");
  }
  const previousTranscript = cleanBoundedString(input.previousTranscript, MAX_DIALOGUE_CHARACTERS);
  const question = cleanBoundedString(input.question, MAX_DIALOGUE_CHARACTERS);
  if (
    !previousTranscript ||
    !question ||
    CONTROL_CHARACTERS.test(previousTranscript) ||
    CONTROL_CHARACTERS.test(question)
  ) {
    return error(
      "INVALID_CLARIFICATION_CONTEXT",
      "pendingClarification requires a safe previousTranscript and question.",
    );
  }
  if (!Array.isArray(input.missingSlots) || input.missingSlots.length > MAX_MISSING_SLOTS) {
    return error(
      "INVALID_CLARIFICATION_CONTEXT",
      `pendingClarification missingSlots must contain at most ${MAX_MISSING_SLOTS} entries.`,
    );
  }
  const missingSlots: string[] = [];
  for (const slot of input.missingSlots) {
    const value = cleanBoundedString(slot, MAX_MISSING_SLOT_CHARACTERS);
    if (!value || CONTROL_CHARACTERS.test(value)) {
      return error("INVALID_CLARIFICATION_CONTEXT", "A clarification missing slot is invalid.");
    }
    missingSlots.push(value);
  }
  return { ok: true, value: { previousTranscript, question, missingSlots } };
}

function parseOptionalOrdinal(input: unknown): number | null | false {
  if (input === undefined) {
    return null;
  }
  return typeof input === "number" && Number.isInteger(input) && input >= 1 && input <= 1_000
    ? input
    : false;
}

function parseOptionalPoint(input: unknown): { x: number; y: number } | null | false {
  if (input === undefined) {
    return null;
  }
  if (!isRecord(input) || !isBoundedNumber(input.x) || !isBoundedNumber(input.y)) {
    return false;
  }
  return { x: input.x, y: input.y };
}

function parseOptionalSize(
  input: unknown,
): { width: number; height: number } | null | false {
  if (input === undefined) {
    return null;
  }
  if (
    !isRecord(input) ||
    !isBoundedNumber(input.width) ||
    !isBoundedNumber(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    return false;
  }
  return { width: input.width, height: input.height };
}

function isBoundedNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input) && Math.abs(input) <= 1_000_000;
}

function cleanBoundedString(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return value && value.length <= maxLength ? value : null;
}

function cleanOptionalString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(code: string, message: string): SemanticIntentParseResult<never> {
  return { ok: false, error: { code, message } };
}
