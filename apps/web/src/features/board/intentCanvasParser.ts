import type { AnnotationNodeType } from "@airboard/core";
import { AIRBOARD_SEMANTIC_NODE_CAPABILITIES } from "@airboard/core/semantic-capabilities";

/**
 * A small, deterministic command grammar for the Intent Canvas.
 *
 * This module deliberately does not resolve words such as "this" or "here".
 * The interaction layer must bind those references to the focus/pointer snapshot
 * captured while the utterance was spoken.
 */

export type IntentCanvasActivationPolicy =
  | "wake_word_required"
  | "wake_word_optional"
  | "externally_activated";

export type IntentCanvasDirection = "left" | "right" | "above" | "below";

export type IntentCanvasReference =
  | { kind: "pointer" }
  | { kind: "focus" }
  | { kind: "selection" }
  | { kind: "canvas" }
  | { kind: "deictic"; pronoun: "this" | "that" };

/**
 * A label lookup, rather than a trusted board-object id. The interaction layer
 * must resolve this reference against the current board and ask for
 * clarification when zero or multiple objects match.
 */
export type IntentCanvasNamedReference = {
  kind: "named";
  /** Case-preserving text for feedback. */
  label: string;
  /** NFKC/lower-case/whitespace-normalized value for deterministic lookup. */
  normalizedLabel: string;
};

export type IntentCanvasConnectionReference =
  | Extract<IntentCanvasReference, { kind: "deictic" }>
  | IntentCanvasNamedReference;

export type IntentCanvasPlacement =
  | { direction: "here"; relativeTo: { kind: "pointer" } }
  | { direction: IntentCanvasDirection; relativeTo: IntentCanvasReference };

export type IntentCanvasAlignment =
  | { axis: "x"; anchor: "minimum" | "center" | "maximum" }
  | { axis: "y"; anchor: "minimum" | "center" | "maximum" };

export type IntentCanvasLayoutDirection =
  | "left_to_right"
  | "right_to_left"
  | "top_to_bottom"
  | "bottom_to_top"
  | "grid";

export type IntentCanvasOperation =
  | {
      kind: "create_node";
      nodeType: AnnotationNodeType;
      count: number;
      label?: string;
      placement: IntentCanvasPlacement;
    }
  | {
      kind: "connect";
      from: IntentCanvasConnectionReference;
      to: IntentCanvasConnectionReference;
      label?: string;
    }
  | { kind: "rename_object"; target: IntentCanvasConnectionReference; label: string }
  | { kind: "rename_selection"; label: string }
  | { kind: "delete_selection" }
  | { kind: "duplicate_selection" }
  | { kind: "move_selection"; direction: IntentCanvasDirection }
  | { kind: "align_selection"; alignment: IntentCanvasAlignment }
  | { kind: "distribute_selection"; axis: "x" | "y" }
  | { kind: "layout_selection"; direction: IntentCanvasLayoutDirection }
  | { kind: "undo" }
  | { kind: "cancel" };

export type IntentCanvasConfidence = {
  /** A deterministic score in the inclusive range 0..1. */
  score: number;
  band: "high" | "medium" | "low";
  basis: "exact_pattern" | "normalized_alias" | "defaulted_argument" | "no_match";
};

export type IntentCanvasActivation = {
  policy: IntentCanvasActivationPolicy;
  activated: boolean;
  explicit: boolean;
  source: "wake_word" | "external" | "none";
  wakePhrase?: string;
};

export type IntentCanvasIssueCode =
  | "activation_required"
  | "empty_command"
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
  | "unknown_command";

export type IntentCanvasIssue = {
  code: IntentCanvasIssueCode;
  message: string;
  examples?: readonly string[];
};

type IntentCanvasResultBase = {
  rawText: string;
  /** Lower-case, whitespace-normalized text after removing the wake phrase. */
  normalizedText: string;
  activation: IntentCanvasActivation;
  confidence: IntentCanvasConfidence;
};

export type ParsedIntentCanvasCommand = IntentCanvasResultBase & {
  status: "parsed";
  command: IntentCanvasOperation;
  message: string;
};

export type RejectedIntentCanvasCommand = IntentCanvasResultBase & {
  status: "inactive" | "clarification" | "unrecognized";
  issue: IntentCanvasIssue;
};

export type IntentCanvasParseResult =
  | ParsedIntentCanvasCommand
  | RejectedIntentCanvasCommand;

export type ParseIntentCanvasCommandOptions = {
  /** Defaults to wake_word_required to prevent normal meeting speech mutating the board. */
  activationPolicy?: IntentCanvasActivationPolicy;
  /** Prefix-only wake phrases. Defaults to "Airboard" and "Air board". */
  wakePhrases?: readonly string[];
};

type NodeAlias = {
  nodeType: AnnotationNodeType;
  phrases: readonly string[];
};

type NodeMatch = {
  nodeType: AnnotationNodeType;
  phrase: string;
  index: number;
  length: number;
  canonical: boolean;
};

type PlacementParse = {
  placement: IntentCanvasPlacement;
  subject: string;
  defaulted: boolean;
};

const DEFAULT_WAKE_PHRASES = ["airo", "air o", "air oh", "airboard", "air board"] as const;

const NODE_ALIASES: readonly NodeAlias[] = AIRBOARD_SEMANTIC_NODE_CAPABILITIES.map(
  ({ nodeType, terms }) => ({ nodeType, phrases: terms }),
);

const COUNT_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  the: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const SELECTION_WORDS = String.raw`(?:the\s+)?(?:selection|selected(?:\s+(?:object|objects|node|nodes|item|items))?)`;

/**
 * Canonicalizes speech-recognition punctuation and whitespace for matching.
 * Labels are extracted from a case-preserving companion string.
 */
export function normalizeIntentCanvasText(input: string): string {
  return cleanText(input).toLocaleLowerCase("en-US");
}

export function parseIntentCanvasCommand(
  input: string,
  options: ParseIntentCanvasCommandOptions = {},
): IntentCanvasParseResult {
  const rawText = input;
  const activationPolicy = options.activationPolicy ?? "wake_word_required";
  const wakePhrases = sanitizeWakePhrases(options.wakePhrases);
  const cleanedInput = cleanText(input);
  const wake = consumeWakePhrase(cleanedInput, wakePhrases);
  const activation = buildActivation(activationPolicy, wake?.phrase);
  const commandText = stripCourtesy(wake ? wake.remainder : cleanedInput);
  const normalizedText = normalizeIntentCanvasText(commandText);
  const base = { rawText, normalizedText, activation };

  if (!activation.activated) {
    return reject(base, "inactive", "activation_required", "Say “Airboard” before a board command.", [
      "Airboard, add a database here",
      "Airboard, connect this to that",
    ]);
  }

  if (!normalizedText) {
    return reject(base, "clarification", "empty_command", "What should I change on the board?", [
      "Add a service here",
      "Move the selected object left",
    ]);
  }

  if (hasCompoundMutation(normalizedText)) {
    return reject(
      base,
      "clarification",
      "compound_command",
      "Please give one board command at a time so each change can be previewed and undone safely.",
      ["Add a service here", "Connect this to that"],
    );
  }

  const meta = parseMetaCommand(commandText);
  if (meta) {
    return parsed(base, meta.command, meta.confidence, meta.message);
  }

  const create = parseCreateCommand(commandText);
  if (create) {
    return "command" in create
      ? parsed(base, create.command, create.confidence, create.message)
      : reject(base, "clarification", create.code, create.message, create.examples);
  }

  const connect = parseConnectCommand(commandText);
  if (connect) {
    return "command" in connect
      ? parsed(base, connect.command, connect.confidence, connect.message)
      : reject(base, "clarification", connect.code, connect.message, connect.examples);
  }

  const selection = parseSelectionCommand(commandText);
  if (selection) {
    return "command" in selection
      ? parsed(base, selection.command, selection.confidence, selection.message)
      : reject(base, "clarification", selection.code, selection.message, selection.examples);
  }

  return reject(
    base,
    "unrecognized",
    "unknown_command",
    "I didn’t recognize that as a board command. Try creating, connecting, moving, arranging, or undoing.",
    ["Airboard, create an API here", "Airboard, connect this to that as calls", "Airboard, undo"],
  );
}

type ParseSuccess = {
  command: IntentCanvasOperation;
  confidence: IntentCanvasConfidence;
  message: string;
};

type ParseFailure = {
  code: IntentCanvasIssueCode;
  message: string;
  examples?: readonly string[];
};

function parseMetaCommand(text: string): ParseSuccess | null {
  const normalized = normalizeIntentCanvasText(text);
  if (/^(?:undo|undo\s+(?:that|it|the\s+last\s+(?:action|change))|go\s+back)$/.test(normalized)) {
    return {
      command: { kind: "undo" },
      confidence: confidence(1, "exact_pattern"),
      message: "Undo the last board change.",
    };
  }
  if (/^(?:cancel|cancel\s+(?:that|it|the\s+command)|never\s*mind|stop\s+(?:that|the\s+command))$/.test(normalized)) {
    return {
      command: { kind: "cancel" },
      confidence: confidence(1, "exact_pattern"),
      message: "Cancel the pending board change.",
    };
  }
  return null;
}

function parseCreateCommand(text: string): ParseSuccess | ParseFailure | null {
  const match = /^(?:add|create|insert|place|make)\s+(.+)$/i.exec(text);
  if (!match?.[1]) {
    if (/^(?:add|create|insert|place|make)$/i.test(text)) {
      return {
        code: "missing_node_type",
        message: "What kind of node should I create?",
        examples: ["Create a service here", "Add a database below this"],
      };
    }
    return null;
  }

  const placementResult = parsePlacement(match[1]);
  const explicitLabel = extractExplicitLabel(placementResult.subject);
  const nodeSubject = explicitLabel ? explicitLabel.subject : placementResult.subject;
  const countResult = extractCount(nodeSubject);
  if (countResult.count < 1 || countResult.count > 20) {
    return {
      code: "unsupported_count",
      message: "Create between one and twenty nodes at a time.",
      examples: ["Create three services here"],
    };
  }

  const nodeMatches = findNodeMatches(countResult.subject);
  const distinctTypes = [...new Set(nodeMatches.map((candidate) => candidate.nodeType))];
  if (distinctTypes.length === 0) {
    return {
      code: "missing_node_type",
      message: "Name a supported node type: process, service, database, queue, user, API, decision, note, or component.",
      examples: ["Create a payment service here", "Add a queue below this"],
    };
  }
  if (distinctTypes.length > 1) {
    return {
      code: "ambiguous_node_type",
      message: "I heard more than one node type. Say one type, and use “named” for its label.",
      examples: ["Create a service named Database Writer here"],
    };
  }

  const nodeMatch = nodeMatches[0];
  if (!nodeMatch) {
    return null;
  }
  // A node term buried deep in the sentence ("make the font bigger in the
  // DOCUMENT you're sharing") is meeting dictation, not a create command —
  // deliberate commands put the shape right after the verb, allowing a short
  // modifier ("add a payment service").
  const wordsBeforeMatch = countResult.subject
    .slice(0, nodeMatch.index)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (wordsBeforeMatch > 2) {
    return {
      code: "missing_node_type",
      message: "Say the shape right after the verb, e.g. “add a document named Specs.”",
      examples: ["Add a document here", "Create a payment service here"],
    };
  }
  const inferredLabel = removeSpan(countResult.subject, nodeMatch.index, nodeMatch.length);
  // An inferred label that opens with a subordinate clause ("make a note THAT
  // we owe legal a response") is meeting-style dictation, not a diagram label.
  // Never guess a label from it — ask instead. Explicit "named/called" labels
  // are unaffected.
  const cleanedInferredLabel = cleanLabel(inferredLabel);
  if (
    !explicitLabel &&
    (/^(?:that|which|because|so|if|when|to|about|regarding|saying|says|on|of|for|with|from|in|at|by|into|onto|your|my|our|their|his|her|its|some|any|more)\b/i.test(
      cleanedInferredLabel,
    ) ||
      cleanedInferredLabel.split(/\s+/).filter(Boolean).length >= 4)
  ) {
    return {
      code: "missing_label",
      message: "Say the label explicitly so I don’t guess from a sentence.",
      examples: ["Add a note named Follow up with legal", "Create a service called Billing"],
    };
  }
  const label = cleanLabel(explicitLabel?.label ?? inferredLabel);
  const command: IntentCanvasOperation = {
    kind: "create_node",
    nodeType: nodeMatch.nodeType,
    count: countResult.count,
    placement: placementResult.placement,
    ...(label ? { label } : {}),
  };
  const basis = placementResult.defaulted
    ? "defaulted_argument"
    : nodeMatch.canonical
      ? "exact_pattern"
      : "normalized_alias";
  const score = placementResult.defaulted ? 0.91 : nodeMatch.canonical ? 0.99 : 0.96;
  return {
    command,
    confidence: confidence(score, basis),
    message: describeCreate(command),
  };
}

function parseConnectCommand(text: string): ParseSuccess | ParseFailure | null {
  if (!/^connect\b/i.test(text)) {
    return null;
  }

  const subject = text.replace(/^connect\s*/i, "").trim();
  const labelSplit = splitConnectionLabel(subject);
  if (!labelSplit.label.valid) {
    return {
      code: "invalid_connection_label",
      message: "Provide a connector label after “as” or “with label.”",
      examples: ["Connect user to API as calls", "Connect database to service with label reads"],
    };
  }

  // A source followed by two targets is a branching operation, not a single
  // binary connection with an unusually long target label. Let the semantic
  // planner expand it into one labelled edge per target.
  if (/\bto\b[\s\S]+\band\b[\s\S]+/i.test(labelSplit.endpoints)) {
    return {
      code: "compound_command",
      message: "That sounds like a branching connection. I’ll interpret each target and branch label together.",
      examples: ["Connect Decision to User One as yes and to User Two as no"],
    };
  }

  const match = /^(.+?)\s+(to|with|and)\s+(.+)$/i.exec(labelSplit.endpoints);
  if (!match?.[1] || !match[3]) {
    return {
      code: "missing_connection_endpoint",
      message: "Name or point to both endpoints, for example “connect user to API” or “connect this to that.”",
      examples: ["Connect user to API", "Connect this to that", "Connect database and payment service"],
    };
  }

  const from = parseConnectionReference(match[1]);
  const to = parseConnectionReference(match[3]);
  if (!from || !to) {
    return {
      code: "missing_connection_endpoint",
      message: "Name or point to both endpoints, for example “connect user to API” or “connect this to that.”",
      examples: ["Connect user to API", "Connect this to that"],
    };
  }

  if (connectionReferenceKey(from) === connectionReferenceKey(to)) {
    return {
      code: "same_connection_endpoint",
      message: "The connection needs two distinct endpoint references.",
      examples: ["Connect user to API", "Connect this to that"],
    };
  }

  const command: IntentCanvasOperation = {
    kind: "connect",
    from,
    to,
    ...(labelSplit.label.label ? { label: labelSplit.label.label } : {}),
  };
  const usesNamedReference = from.kind === "named" || to.kind === "named";
  const usesSeparatorAlias = match[2]!.toLocaleLowerCase("en-US") !== "to";
  const usedAlias = labelSplit.label.usedAlias || usesSeparatorAlias;
  return {
    command,
    confidence: confidence(
      usedAlias ? 0.96 : usesNamedReference ? 0.98 : 0.99,
      usedAlias ? "normalized_alias" : "exact_pattern",
    ),
    message: labelSplit.label.label
      ? `Connect ${describeConnectionReference(from)} to ${describeConnectionReference(to)} and label the connector “${labelSplit.label.label}”.`
      : `Connect ${describeConnectionReference(from)} to ${describeConnectionReference(to)}.`,
  };
}

function parseSelectionCommand(text: string): ParseSuccess | ParseFailure | null {
  const normalized = normalizeIntentCanvasText(text);

  const namedRename = /^(?:rename|relabel|change\s+the\s+name\s+of|change\s+the\s+label\s+of)\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(
    text,
  );
  if (namedRename?.[1] && namedRename[2] && !new RegExp(`^${SELECTION_WORDS}$`, "i").test(namedRename[1])) {
    const target = parseConnectionReference(namedRename[1]);
    const label = cleanLabel(namedRename[2]);
    if (!target || !label) {
      return selectionFailure("missing_label", "Name the object and provide its new label.", [
        "Change the name of Circle to User",
      ]);
    }
    return {
      command: { kind: "rename_object", target, label },
      confidence: confidence(0.98, "normalized_alias"),
      message: `Rename ${describeConnectionReference(target)} to “${label}”.`,
    };
  }

  if (/^(?:rename|relabel)\b/.test(normalized)) {
    const match = new RegExp(`^(?:rename|relabel)\\s+${SELECTION_WORDS}\\s+(?:to|as)\\s+(.+)$`, "i").exec(text);
    if (!match?.[1]) {
      return selectionFailure("missing_label", "Select an object and provide its new label.", [
        "Rename selected to Orders API",
      ]);
    }
    const label = cleanLabel(match[1]);
    if (!label) {
      return selectionFailure("missing_label", "What should the selected object be called?", [
        "Rename selected to Orders API",
      ]);
    }
    return {
      command: { kind: "rename_selection", label },
      confidence: confidence(0.99, "exact_pattern"),
      message: `Rename the selection to “${label}”.`,
    };
  }

  if (/^(?:delete|remove)\b/.test(normalized)) {
    if (!new RegExp(`^(?:delete|remove)\\s+${SELECTION_WORDS}$`, "i").test(text)) {
      return selectionFailure("missing_selection_target", "Select the object first, then say “delete selected.”", [
        "Delete selected",
      ]);
    }
    return {
      command: { kind: "delete_selection" },
      confidence: confidence(1, "exact_pattern"),
      message: "Delete the selection.",
    };
  }

  if (/^(?:duplicate|copy)\b/.test(normalized)) {
    if (!new RegExp(`^(?:duplicate|copy)\\s+${SELECTION_WORDS}$`, "i").test(text)) {
      return selectionFailure("missing_selection_target", "Select one or more objects first, then say “duplicate selected.”", [
        "Duplicate selected",
      ]);
    }
    return {
      command: { kind: "duplicate_selection" },
      confidence: confidence(1, "exact_pattern"),
      message: "Duplicate the selection.",
    };
  }

  if (/^move\b/.test(normalized)) {
    const match = new RegExp(
      `^move\\s+${SELECTION_WORDS}(?:\\s+to)?\\s+(?:the\\s+)?(left|right|up|down|above|below)$`,
      "i",
    ).exec(text);
    if (!match?.[1]) {
      return selectionFailure("missing_direction", "Select an object and say which direction to move it.", [
        "Move selected left",
        "Move the selected object down",
      ]);
    }
    const direction = normalizeDirection(match[1]);
    return {
      command: { kind: "move_selection", direction },
      confidence: confidence(0.99, "exact_pattern"),
      message: `Move the selection ${direction}.`,
    };
  }

  if (/^align\b/.test(normalized)) {
    const match = new RegExp(
      `^align\\s+${SELECTION_WORDS}(?:\\s+(?:to|on))?\\s+(?:the\\s+)?(left|right|top|bottom|horizontal|horizontally|vertical|vertically|center|middle)$`,
      "i",
    ).exec(text);
    if (!match?.[1]) {
      return selectionFailure("missing_alignment", "Choose an alignment edge or axis.", [
        "Align selected left",
        "Align selected horizontally",
      ]);
    }
    const token = match[1].toLocaleLowerCase("en-US");
    if (token === "center" || token === "middle") {
      return selectionFailure(
        "ambiguous_alignment",
        "Should the selection share a horizontal row or a vertical column?",
        ["Align selected horizontally", "Align selected vertically"],
      );
    }
    const alignment = alignmentForToken(token);
    return {
      command: { kind: "align_selection", alignment },
      confidence: confidence(0.98, "exact_pattern"),
      message: describeAlignment(alignment),
    };
  }

  if (/^distribute\b/.test(normalized)) {
    const match = new RegExp(
      `^distribute\\s+${SELECTION_WORDS}\\s+(horizontal|horizontally|vertical|vertically)$`,
      "i",
    ).exec(text);
    if (!match?.[1]) {
      return selectionFailure("missing_distribution_axis", "Distribute the selection horizontally or vertically?", [
        "Distribute selected horizontally",
      ]);
    }
    const axis = match[1].toLocaleLowerCase("en-US").startsWith("horizontal") ? "x" : "y";
    return {
      command: { kind: "distribute_selection", axis },
      confidence: confidence(0.99, "exact_pattern"),
      message: `Distribute the selection evenly along the ${axis === "x" ? "horizontal" : "vertical"} axis.`,
    };
  }

  if (/^(?:layout|lay\s+out|arrange)\b/.test(normalized)) {
    const match = new RegExp(
      `^(?:layout|lay\\s+out|arrange)\\s+${SELECTION_WORDS}(?:\\s+(?:in|from))?\\s+(?:a\\s+)?(left\\s+to\\s+right|right\\s+to\\s+left|top\\s+to\\s+bottom|bottom\\s+to\\s+top|grid)$`,
      "i",
    ).exec(text);
    if (!match?.[1]) {
      return selectionFailure("missing_layout_direction", "Choose a flow direction or a grid layout.", [
        "Layout selected left to right",
        "Arrange the selection in a grid",
      ]);
    }
    const direction = normalizeLayoutDirection(match[1]);
    return {
      command: { kind: "layout_selection", direction },
      confidence: confidence(0.98, "exact_pattern"),
      message: `Lay out the selection ${direction.replaceAll("_", " ")}.`,
    };
  }

  return null;
}

function parsePlacement(subject: string): PlacementParse {
  const patterns: readonly {
    regex: RegExp;
    build: (match: RegExpExecArray) => IntentCanvasPlacement;
  }[] = [
    {
      regex: /\s+(?:to\s+the\s+)?(left|right)\s+of\s+(this|that|the\s+selection|selected)$/i,
      build: (match) => ({
        direction: normalizeDirection(match[1] ?? "left"),
        relativeTo: referenceForToken(match[2] ?? "selected"),
      }),
    },
    {
      regex: /\s+(above|below|over|under)\s+(this|that|the\s+selection|selected)$/i,
      build: (match) => ({
        direction: normalizeDirection(match[1] ?? "above"),
        relativeTo: referenceForToken(match[2] ?? "selected"),
      }),
    },
    {
      regex: /\s+on\s+the\s+(left|right)$/i,
      build: (match) => ({
        direction: normalizeDirection(match[1] ?? "left"),
        relativeTo: { kind: "canvas" },
      }),
    },
    {
      regex: /\s+(left|right|above|below|over|under)$/i,
      build: (match) => ({
        direction: normalizeDirection(match[1] ?? "left"),
        relativeTo: { kind: "focus" },
      }),
    },
    {
      regex: /\s+here$/i,
      build: () => ({ direction: "here", relativeTo: { kind: "pointer" } }),
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(subject);
    if (match) {
      return {
        placement: pattern.build(match),
        subject: subject.slice(0, match.index).trim(),
        defaulted: false,
      };
    }
  }

  return {
    placement: { direction: "here", relativeTo: { kind: "pointer" } },
    subject: subject.trim(),
    defaulted: true,
  };
}

function extractExplicitLabel(subject: string): { subject: string; label: string } | null {
  const match = /\s+(?:called|named|labeled|labelled)\s+(.+)$/i.exec(subject);
  if (!match?.[1]) {
    return null;
  }
  return {
    subject: subject.slice(0, match.index).trim(),
    label: match[1],
  };
}

function extractCount(subject: string): { count: number; subject: string } {
  const match = /^(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+)$/i.exec(subject);
  if (!match?.[1] || !match[2]) {
    return { count: 1, subject };
  }
  const token = match[1].toLocaleLowerCase("en-US");
  return {
    count: COUNT_WORDS[token] ?? Number.parseInt(token, 10),
    subject: match[2].trim(),
  };
}

function findNodeMatches(subject: string): NodeMatch[] {
  const matches: NodeMatch[] = [];
  for (const alias of NODE_ALIASES) {
    let bestForType: NodeMatch | null = null;
    for (const phrase of [...alias.phrases].sort((left, right) => right.length - left.length)) {
      const match = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i").exec(subject);
      if (!match) {
        continue;
      }
      const candidate: NodeMatch = {
        nodeType: alias.nodeType,
        phrase,
        index: match.index,
        length: match[0].length,
        canonical: phrase === alias.nodeType,
      };
      if (!bestForType || candidate.length > bestForType.length) {
        bestForType = candidate;
      }
    }
    if (bestForType) {
      matches.push(bestForType);
    }
  }
  return matches.sort((left, right) => right.length - left.length);
}

function parseConnectionLabel(suffix: string): { valid: boolean; label?: string; usedAlias: boolean } {
  if (!suffix) {
    return { valid: true, usedAlias: false };
  }
  const match = /^(?:as|with\s+(?:the\s+)?label|labeled|labelled|and\s+label\s+it)\s+(.+)$/i.exec(suffix);
  const label = cleanLabel(match?.[1] ?? "");
  if (!match || !label) {
    return { valid: false, usedAlias: false };
  }
  return {
    valid: true,
    label,
    usedAlias: !/^as\b/i.test(suffix),
  };
}

function splitConnectionLabel(subject: string): {
  endpoints: string;
  label: ReturnType<typeof parseConnectionLabel>;
} {
  const marker = /\s+(?:as|with\s+(?:the\s+)?label|labeled|labelled|and\s+label\s+it)\b/i.exec(subject);
  if (!marker) {
    return { endpoints: subject.trim(), label: parseConnectionLabel("") };
  }
  const suffix = subject.slice(marker.index).trim();
  return {
    endpoints: subject.slice(0, marker.index).trim(),
    label: parseConnectionLabel(suffix),
  };
}

function parseConnectionReference(value: string): IntentCanvasConnectionReference | null {
  const cleaned = cleanLabel(value).replace(/^(?:the\s+)/i, "").trim();
  const normalized = normalizeIntentCanvasText(cleaned);
  if (!normalized) {
    return null;
  }
  if (normalized === "this" || normalized === "that") {
    return { kind: "deictic", pronoun: normalized };
  }
  return {
    kind: "named",
    label: cleaned,
    normalizedLabel: normalized,
  };
}

function connectionReferenceKey(reference: IntentCanvasConnectionReference): string {
  return reference.kind === "deictic"
    ? `deictic:${reference.pronoun}`
    : `named:${reference.normalizedLabel}`;
}

function describeConnectionReference(reference: IntentCanvasConnectionReference): string {
  return reference.kind === "deictic" ? reference.pronoun : `“${reference.label}”`;
}

function alignmentForToken(token: string): IntentCanvasAlignment {
  switch (token) {
    case "left":
      return { axis: "x", anchor: "minimum" };
    case "right":
      return { axis: "x", anchor: "maximum" };
    case "top":
      return { axis: "y", anchor: "minimum" };
    case "bottom":
      return { axis: "y", anchor: "maximum" };
    case "vertical":
    case "vertically":
      return { axis: "x", anchor: "center" };
    default:
      return { axis: "y", anchor: "center" };
  }
}

function describeAlignment(alignment: IntentCanvasAlignment): string {
  if (alignment.anchor === "center") {
    return alignment.axis === "x"
      ? "Align the selection in a vertical column."
      : "Align the selection in a horizontal row.";
  }
  const edge =
    alignment.axis === "x"
      ? alignment.anchor === "minimum"
        ? "left"
        : "right"
      : alignment.anchor === "minimum"
        ? "top"
        : "bottom";
  return `Align the selection to its ${edge} edge.`;
}

function normalizeLayoutDirection(value: string): IntentCanvasLayoutDirection {
  const normalized = normalizeIntentCanvasText(value).replaceAll(" ", "_");
  if (
    normalized === "left_to_right" ||
    normalized === "right_to_left" ||
    normalized === "top_to_bottom" ||
    normalized === "bottom_to_top"
  ) {
    return normalized;
  }
  return "grid";
}

function normalizeDirection(value: string): IntentCanvasDirection {
  switch (value.toLocaleLowerCase("en-US")) {
    case "up":
    case "over":
    case "above":
      return "above";
    case "down":
    case "under":
    case "below":
      return "below";
    case "right":
      return "right";
    default:
      return "left";
  }
}

function referenceForToken(value: string): IntentCanvasReference {
  const normalized = normalizeIntentCanvasText(value);
  if (normalized === "this" || normalized === "that") {
    return { kind: "deictic", pronoun: normalized };
  }
  return { kind: "selection" };
}

function describeCreate(command: Extract<IntentCanvasOperation, { kind: "create_node" }>): string {
  const displayNodeType = command.nodeType === "api" ? "API" : command.nodeType;
  const article = /^[aeiou]/i.test(displayNodeType) ? "an" : "a";
  const noun =
    command.count === 1
      ? `${article} ${displayNodeType}`
      : `${command.count} ${pluralize(command.nodeType)}`;
  const label = command.label ? ` labeled “${command.label}”` : "";
  const placement =
    command.placement.direction === "here"
      ? "at the pointer"
      : command.placement.direction === "left" || command.placement.direction === "right"
        ? `to the ${command.placement.direction} of ${describeReference(command.placement.relativeTo)}`
        : `${command.placement.direction} ${describeReference(command.placement.relativeTo)}`;
  return `Create ${noun}${label} ${placement}.`;
}

function describeReference(reference: IntentCanvasReference): string {
  switch (reference.kind) {
    case "deictic":
      return reference.pronoun;
    case "selection":
      return "the selection";
    case "canvas":
      return "the canvas center";
    case "pointer":
      return "the pointer";
    default:
      return "the current focus";
  }
}

function pluralize(nodeType: AnnotationNodeType): string {
  if (nodeType === "process") {
    return "processes";
  }
  return `${nodeType}s`;
}

function cleanLabel(value: string): string {
  return stripOuterQuotes(value)
    .replace(/\s+please$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function removeSpan(value: string, index: number, length: number): string {
  return `${value.slice(0, index)} ${value.slice(index + length)}`.replace(/\s+/g, " ").trim();
}

// Spoken commands arrive wrapped in disfluencies and courtesy — "Uh, add a
// circle", "okay, so, could you please add a user". Every board command
// starts with a verb, so leading fillers are always safe to peel. Each layer
// may end in a comma/pause punctuation, and layers stack, so strip
// iteratively until the text stabilizes.
const COURTESY_PREFIX_PATTERN =
  /^(?:(?:uh|um|erm|ah|hmm|well|yeah|yep|so|like|now|okay|ok|alright|right)(?:[,.;:\s]+|$)|please(?:\s+|$)|(?:can|could|would)\s+you\s+)/i;

function stripCourtesy(value: string): string {
  let text = value.trim();
  for (let pass = 0; pass < 8; pass += 1) {
    const next = text.replace(COURTESY_PREFIX_PATTERN, "").trim();
    if (next === text) {
      break;
    }
    text = next;
  }
  return text.replace(/\s+please$/i, "").trim();
}

function cleanText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "")
    .trim();
}

function sanitizeWakePhrases(input?: readonly string[]): readonly string[] {
  const cleaned = (input ?? DEFAULT_WAKE_PHRASES)
    .map((phrase) => normalizeIntentCanvasText(phrase))
    .filter(Boolean);
  return cleaned.length > 0 ? [...new Set(cleaned)].sort((left, right) => right.length - left.length) : DEFAULT_WAKE_PHRASES;
}

function consumeWakePhrase(text: string, wakePhrases: readonly string[]): { phrase: string; remainder: string } | null {
  for (const phrase of wakePhrases) {
    const spacedPhrase = escapeRegex(phrase).replace(/\\ /g, String.raw`\s+`);
    const match = new RegExp(`^(?:(?:hey|okay|ok)\\s+)?(${spacedPhrase})(?=$|[\\s,:;-])(?:[\\s,:;-]*)`, "i").exec(text);
    if (match?.[1]) {
      return {
        phrase: match[1],
        remainder: text.slice(match[0].length).trim(),
      };
    }
  }
  return null;
}

function buildActivation(
  policy: IntentCanvasActivationPolicy,
  wakePhrase?: string,
): IntentCanvasActivation {
  if (wakePhrase) {
    return {
      policy,
      activated: true,
      explicit: true,
      source: "wake_word",
      wakePhrase,
    };
  }
  if (policy === "externally_activated") {
    return { policy, activated: true, explicit: true, source: "external" };
  }
  if (policy === "wake_word_optional") {
    return { policy, activated: true, explicit: false, source: "none" };
  }
  return { policy, activated: false, explicit: false, source: "none" };
}

function hasCompoundMutation(normalized: string): boolean {
  return /\band\s+(?:then\s+)?(?:add|create|insert|place|make|connect|rename|relabel|delete|remove|duplicate|copy|move|align|distribute|layout|lay\s+out|arrange|undo|cancel)\b/.test(
    normalized,
  );
}

function parsed(
  base: Omit<IntentCanvasResultBase, "confidence">,
  command: IntentCanvasOperation,
  commandConfidence: IntentCanvasConfidence,
  message: string,
): ParsedIntentCanvasCommand {
  return {
    ...base,
    status: "parsed",
    confidence: commandConfidence,
    command,
    message,
  };
}

function reject(
  base: Omit<IntentCanvasResultBase, "confidence">,
  status: RejectedIntentCanvasCommand["status"],
  code: IntentCanvasIssueCode,
  message: string,
  examples?: readonly string[],
): RejectedIntentCanvasCommand {
  return {
    ...base,
    status,
    confidence: confidence(0, "no_match"),
    issue: {
      code,
      message,
      ...(examples ? { examples } : {}),
    },
  };
}

function selectionFailure(
  code: IntentCanvasIssueCode,
  message: string,
  examples?: readonly string[],
): ParseFailure {
  return { code, message, ...(examples ? { examples } : {}) };
}

function confidence(score: number, basis: IntentCanvasConfidence["basis"]): IntentCanvasConfidence {
  const bounded = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return {
    score: bounded,
    band: bounded >= 0.9 ? "high" : bounded >= 0.65 ? "medium" : "low",
    basis,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
