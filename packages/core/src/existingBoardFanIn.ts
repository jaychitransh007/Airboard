import {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  type SemanticObjectReference,
  type SemanticPlan,
} from "./semanticPlan.ts";

export type ExistingBoardFanInObject = {
  label: string;
  nodeType: string;
  ordinal?: number;
};

export type ExistingBoardFanInEdge = {
  from: { label: string };
  to: { label: string };
  label?: string;
};

export type ExistingBoardFanInContext = {
  selectionCount: number;
  selected: ExistingBoardFanInObject[];
  objects: ExistingBoardFanInObject[];
  edges: ExistingBoardFanInEdge[];
};

export type ExistingBoardFanInResolution =
  | {
      status: "resolved";
      plan: SemanticPlan;
    }
  | {
      status: "already_satisfied";
      recipientLabel: string;
      sourceLabels: string[];
      relationLabel: string;
    }
  | {
      status: "unrecognized";
    };

/**
 * High-precision deterministic handling for an existing-board relationship:
 *
 *   "Planner gets additional context from Golden Dataset and Historical Dataset"
 *
 * The recipient construction reverses the spoken "from" order into one edge
 * per source. It never creates an object. A single corrupted source phrase may
 * be repaired only in a closed, uniquely grounded board context with lexical
 * evidence and at least one other exact source match.
 */
export function resolveExistingBoardFanIn(
  input: string,
  context: ExistingBoardFanInContext,
): ExistingBoardFanInResolution {
  if (context.objects.length < 3 || explicitlyCreatesObject(input)) {
    return { status: "unrecognized" };
  }
  const normalizedInput = normalizeUtterance(input);
  const match =
    /^(?:so\s+)?(.+?)\s+(?:(?:will|would|should|can)\s+)?(?:get|gets|receive|receives|accept|accepts)\s+(.+?)\s+from\s+(.+)$/iu.exec(
      normalizedInput,
    );
  if (!match) {
    return { status: "unrecognized" };
  }

  const [, recipientText, firstPayloadText, sourceTail] = match;
  const recipient = resolveRecipient(recipientText!, context);
  if (!recipient) {
    return { status: "unrecognized" };
  }
  const sourceClauses = parseSourceClauses(sourceTail!, firstPayloadText!);
  if (!sourceClauses || sourceClauses.sources.length < 2) {
    return { status: "unrecognized" };
  }

  const candidateSources = context.objects.filter(
    (object) => !sameObject(object, recipient),
  );
  const resolvedSources = resolveSources(sourceClauses.sources, candidateSources);
  if (!resolvedSources) {
    return { status: "unrecognized" };
  }

  const relationLabel = canonicalRelationLabel(sourceClauses.payload);
  if (!relationLabel) {
    return { status: "unrecognized" };
  }
  const actions = resolvedSources
    .filter(
      (source) =>
        !context.edges.some(
          (edge) =>
            sameLabel(edge.from.label, source.label) &&
            sameLabel(edge.to.label, recipient.label) &&
            sameLabel(edge.label ?? "", relationLabel),
        ),
    )
    .map((source) => ({
      type: "connect" as const,
      from: visibleReference(source.label),
      to: visibleReference(recipient.label),
      label: relationLabel,
    }));
  if (actions.length === 0) {
    return {
      status: "already_satisfied",
      recipientLabel: recipient.label,
      sourceLabels: resolvedSources.map((source) => source.label),
      relationLabel,
    };
  }

  return {
    status: "resolved",
    plan: {
      version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
      status: "resolved",
      issueCode: "none",
      clarificationQuestion: null,
      missingSlots: [],
      actions,
    },
  };
}

/**
 * Compatibility helper for callers that only consume actionable plans.
 *
 * New orchestration code should use `resolveExistingBoardFanIn` so an
 * idempotent request is not mistaken for an unrecognized command and sent to a
 * semantic provider.
 */
export function parseExistingBoardFanIn(
  input: string,
  context: ExistingBoardFanInContext,
): SemanticPlan | null {
  const resolution = resolveExistingBoardFanIn(input, context);
  return resolution.status === "resolved" ? resolution.plan : null;
}

type SourceClauses = {
  payload: string;
  sources: string[];
};

function parseSourceClauses(
  sourceTail: string,
  firstPayload: string,
): SourceClauses | null {
  const repeated =
    /^(.+?)\s*,?\s+and\s+(another|the\s+same)\s+(.+?)\s+from\s+(.+)$/iu.exec(
      sourceTail.trim(),
    );
  if (repeated) {
    return {
      // "another X" makes the second, more recent payload phrase the
      // authoritative shared relation label.
      payload: repeated[3]!,
      sources: [repeated[1]!, repeated[4]!],
    };
  }
  const sources = sourceTail
    .split(/\s*,\s*|\s+(?:and|as well as)\s+/iu)
    .map((value) => value.trim())
    .filter(Boolean);
  return sources.length >= 2 ? { payload: firstPayload, sources } : null;
}

function resolveRecipient(
  value: string,
  context: ExistingBoardFanInContext,
): ExistingBoardFanInObject | null {
  const lookup = normalizeReference(value);
  if (["this", "it", "that", "this one", "that one"].includes(lookup)) {
    return context.selectionCount === 1 && context.selected.length === 1
      ? context.selected[0]!
      : null;
  }
  return uniqueExactObject(value, context.objects);
}

function resolveSources(
  sourceTexts: readonly string[],
  candidates: readonly ExistingBoardFanInObject[],
): ExistingBoardFanInObject[] | null {
  const resolved: Array<ExistingBoardFanInObject | null> = sourceTexts.map(
    (sourceText) => uniqueExactObject(sourceText, candidates),
  );
  const exactMatches = resolved.filter(
    (value): value is ExistingBoardFanInObject => value !== null,
  );
  if (new Set(exactMatches.map((object) => object.label)).size !== exactMatches.length) {
    return null;
  }
  const unmatchedIndexes = resolved.flatMap((value, index) => (value ? [] : [index]));
  if (unmatchedIndexes.length === 0) {
    return resolved as ExistingBoardFanInObject[];
  }

  const used = new Set(exactMatches);

  // STT frequently alternates the bounded morphology "data" / "dataset" /
  // "datasets". Repair it only when another source clause matched exactly and
  // the complete canonical token sequence identifies one unused visible
  // object. A shared word alone is intentionally insufficient.
  if (exactMatches.length >= 1) {
    for (const unmatchedIndex of unmatchedIndexes) {
      const canonicalMatch = uniqueCanonicalEquivalentObject(
        sourceTexts[unmatchedIndex]!,
        candidates.filter((candidate) => !used.has(candidate)),
      );
      if (canonicalMatch) {
        resolved[unmatchedIndex] = canonicalMatch;
        used.add(canonicalMatch);
      }
    }
  }

  const stillUnmatchedIndexes = resolved.flatMap((value, index) =>
    value ? [] : [index],
  );
  if (stillUnmatchedIndexes.length === 0) {
    return resolved as ExistingBoardFanInObject[];
  }

  const remainingCandidates = candidates.filter((candidate) => !used.has(candidate));
  const isClosedUniqueRepair =
    stillUnmatchedIndexes.length === 1 &&
    exactMatches.length >= 1 &&
    sourceTexts.length === candidates.length &&
    remainingCandidates.length === 1;
  if (!isClosedUniqueRepair) {
    return null;
  }
  const unmatchedIndex = stillUnmatchedIndexes[0]!;
  const residual = remainingCandidates[0]!;
  if (!hasLexicalRepairEvidence(sourceTexts[unmatchedIndex]!, residual.label)) {
    return null;
  }
  resolved[unmatchedIndex] = residual;
  return resolved as ExistingBoardFanInObject[];
}

function uniqueExactObject(
  value: string,
  objects: readonly ExistingBoardFanInObject[],
): ExistingBoardFanInObject | null {
  const lookup = normalizeReference(value);
  const matches = objects.filter(
    (object) => normalizeReference(object.label) === lookup,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function uniqueCanonicalEquivalentObject(
  value: string,
  objects: readonly ExistingBoardFanInObject[],
): ExistingBoardFanInObject | null {
  const lookup = canonicalReferenceKey(value);
  const matches = objects.filter(
    (object) => canonicalReferenceKey(object.label) === lookup,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function canonicalReferenceKey(value: string): string {
  return normalizeReference(value)
    .split(/\s+/u)
    .map((token) =>
      token === "data" || token === "dataset" || token === "datasets"
        ? "data"
        : token,
    )
    .join(" ");
}

function hasLexicalRepairEvidence(spoken: string, visible: string): boolean {
  const spokenTokens = repairTokens(spoken);
  const visibleTokens = repairTokens(visible);
  return [...spokenTokens].some((token) => visibleTokens.has(token));
}

function repairTokens(value: string): Set<string> {
  return new Set(
    normalizeReference(value)
      .split(/\s+/u)
      .map((token) => (token === "dataset" || token === "datasets" ? "data" : token))
      .filter((token) => token.length >= 3),
  );
}

function canonicalRelationLabel(value: string): string | null {
  const label = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/^(?:(?:another|the|an|a)\s+)+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return label && label.length <= 80 ? label : null;
}

function normalizeUtterance(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\b(?:uh+|um+)\b/giu, " ")
    .replace(
      /^(?:(?:okay|ok|well|i\s+mean|please|kindly|thanks\s*,?\s+could\s+you|could\s+you\s+please|would\s+you\s+please|can\s+you\s+please|would\s+you\s+mind|if\s+you\s+would|at\s+your\s+convenience|when\s+convenient)\s*,?\s*)+/iu,
      "",
    )
    .replace(/^(?:okay\s*,?\s*)?so\s*,?\s*/iu, "")
    .replace(/[.!?]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeReference(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/^(?:(?:the|a|an|another)\s+)+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameLabel(left: string, right: string): boolean {
  return normalizeReference(left) === normalizeReference(right);
}

function sameObject(
  left: ExistingBoardFanInObject,
  right: ExistingBoardFanInObject,
): boolean {
  return (
    sameLabel(left.label, right.label) &&
    left.nodeType === right.nodeType &&
    left.ordinal === right.ordinal
  );
}

function visibleReference(label: string): SemanticObjectReference {
  return { kind: "visible_label", label, occurrence: null };
}

function explicitlyCreatesObject(value: string): boolean {
  return /\b(?:add|create|insert|make|build|draw)\s+(?:a|an|the|new|another)\b/iu.test(
    value,
  );
}
