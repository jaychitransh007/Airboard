import {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  type SemanticObjectReference,
  type SemanticPlan,
  type SemanticPlanAction,
} from "@airboard/core/semantic-plan";

const SPOKEN_NUMBER_TOKENS: Readonly<Record<string, string>> = {
  zero: "0",
  one: "1",
  first: "1",
  two: "2",
  second: "2",
  three: "3",
  third: "3",
  four: "4",
  fourth: "4",
  five: "5",
  fifth: "5",
  six: "6",
  sixth: "6",
  seven: "7",
  seventh: "7",
  eight: "8",
  eighth: "8",
  nine: "9",
  ninth: "9",
  ten: "10",
  tenth: "10",
  eleven: "11",
  eleventh: "11",
  twelve: "12",
  twelfth: "12",
  thirteen: "13",
  thirteenth: "13",
  fourteen: "14",
  fourteenth: "14",
  fifteen: "15",
  fifteenth: "15",
  sixteen: "16",
  sixteenth: "16",
  seventeen: "17",
  seventeenth: "17",
  eighteen: "18",
  eighteenth: "18",
  nineteen: "19",
  nineteenth: "19",
  twenty: "20",
  twentieth: "20",
};

/**
 * Canonical lookup form shared by semantic grounding and deterministic
 * desired-state parsing. This deliberately equates spoken and written numbers:
 * "User Two", "user 2", and "the second user" can address the same label.
 */
export function normalizeSpokenNumberAliases(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/^the\s+/u, "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => SPOKEN_NUMBER_TOKENS[token] ?? token)
    .join(" ");
  const leadingOrdinal = /^(\d+)\s+(.+)$/u.exec(normalized);
  return leadingOrdinal
    ? `${leadingOrdinal[2]} ${leadingOrdinal[1]}`
    : normalized;
}

/**
 * Deterministic repair for a common diagram-edit discourse pattern:
 *
 *   "Currently A calls B, but B should call A, and then B updates C."
 *
 * The current-state clause is context, not an instruction. The returned plan
 * therefore contains only the desired graph delta: reverse A→B, then ensure
 * B→C exists. General narrative requests still use the semantic provider.
 */
export function parseDesiredGraphCorrection(input: string): SemanticPlan | null {
  const flowingCorrection = parseFlowingRelationshipCorrection(input);
  if (flowingCorrection) {
    return flowingCorrection;
  }

  const match =
    /^(?:(?:diagram\s+)?connectors?\s+from\s+(.+?)\s+to\s+(.+?)\s*[.!?]\s*)?currently\s*,?\s*(.+?)\s+(?:is\s+making\s+(?:the\s+)?call\s+to|calls?)\s+(.+?)\s*,?\s+but\s+(.+?)\s+should\s+(?:be\s+making\s+(?:the\s+)?call\s+to|call)\s+(.+?)\s*,?\s+and\s+then\s+(.+?)\s+updates?\s+(?:the\s+)?(.+?)\s*[.!?]*$/iu.exec(
      input.trim(),
    );
  if (!match) {
    return null;
  }

  const [
    ,
    statedDesiredFrom,
    statedDesiredTo,
    currentFromValue,
    currentToValue,
    desiredFromValue,
    desiredToValue,
    updateFromValue,
    updateToValue,
  ] = match;
  const values = [
    currentFromValue,
    currentToValue,
    desiredFromValue,
    desiredToValue,
    updateFromValue,
    updateToValue,
  ];
  if (values.some((value) => !safeReferenceText(value))) {
    return null;
  }

  const currentFrom = canonicalDisplayLabel(currentFromValue!);
  const currentTo = canonicalDisplayLabel(currentToValue!);
  const desiredFrom = canonicalDisplayLabel(desiredFromValue!);
  const desiredTo = canonicalDisplayLabel(desiredToValue!);
  const updateFrom = canonicalDisplayLabel(updateFromValue!);
  const updateTo = canonicalDisplayLabel(updateToValue!);

  if (
    !sameReference(currentFrom, desiredTo) ||
    !sameReference(currentTo, desiredFrom) ||
    !sameReference(desiredFrom, updateFrom)
  ) {
    return null;
  }
  if (
    statedDesiredFrom &&
    statedDesiredTo &&
    (!sameReference(statedDesiredFrom, desiredFrom) ||
      !sameReference(statedDesiredTo, desiredTo))
  ) {
    return null;
  }

  return {
    version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions: [
      {
        type: "reverse_connection",
        connection: {
          kind: "connection",
          from: visibleReference(currentFrom),
          to: visibleReference(currentTo),
          label: null,
          occurrence: null,
        },
        label: "calls",
      },
      {
        type: "connect",
        from: visibleReference(updateFrom),
        to: visibleReference(updateTo),
        label: "updates",
      },
    ],
  };
}

function parseFlowingRelationshipCorrection(input: string): SemanticPlan | null {
  const currentStateIndex = input.search(/\bcurrently\b/iu);
  if (currentStateIndex < 0) {
    return null;
  }
  // Everything before "currently" is board-description context. Ignoring it
  // makes repeated words and half-finished shape descriptions harmless.
  const discourse = input.slice(currentStateIndex).trim();
  const match =
    /^currently\s*,?\s*(?:the\s+)?(.+?)\s+(?:is\s+flowing|flows?)\s+from\s+(.+?)\s+to\s+(.+?)\s*[.!?]\s*(?:it|this|the\s+flow|the\s+connection|the\s+request)\s+should\s+be\s+reversed\s*[.!?]\s*(?:the\s+)?(.+?)\s+should\s+(?:be\s+)?flow(?:ing)?\s+from\s+(.+?)\s+to\s+(.+?)(?:\s*,?\s+and\s+then\s+(.+?)\s+updates?\s+(?:the\s+)?(.+?))?\s*[.!?]*$/iu.exec(
      discourse,
    );
  if (!match) {
    return null;
  }

  const [
    ,
    currentRelationshipValue,
    currentFromValue,
    currentToValue,
    desiredRelationshipValue,
    desiredFromValue,
    desiredToValue,
    updateActorValue,
    updateTargetValue,
  ] = match;
  const requiredValues = [
    currentRelationshipValue,
    currentFromValue,
    currentToValue,
    desiredRelationshipValue,
    desiredFromValue,
    desiredToValue,
  ];
  if (requiredValues.some((value) => !safeReferenceText(value))) {
    return null;
  }
  if (
    normalizeSpokenNumberAliases(currentRelationshipValue!) !==
    normalizeSpokenNumberAliases(desiredRelationshipValue!)
  ) {
    return null;
  }

  const currentFrom = canonicalDisplayLabel(currentFromValue!);
  const currentTo = canonicalDisplayLabel(currentToValue!);
  const desiredFrom = canonicalDisplayLabel(desiredFromValue!);
  const desiredTo = canonicalDisplayLabel(desiredToValue!);
  if (
    !sameReference(currentFrom, desiredTo) ||
    !sameReference(currentTo, desiredFrom)
  ) {
    return null;
  }

  const actions: SemanticPlanAction[] = [
    {
      type: "reverse_connection",
      connection: {
        kind: "connection",
        from: visibleReference(currentFrom),
        to: visibleReference(currentTo),
        label: null,
        occurrence: null,
      },
      label: canonicalRelationshipLabel(desiredRelationshipValue!),
    },
  ];

  if (updateTargetValue) {
    if (
      !safeReferenceText(updateTargetValue) ||
      (updateActorValue && !safeReferenceText(updateActorValue))
    ) {
      return null;
    }
    const updateActor = isSequencePronoun(
      updateActorValue,
      desiredRelationshipValue!,
    )
      ? desiredTo
      : canonicalDisplayLabel(updateActorValue!);
    actions.push({
      type: "connect",
      from: visibleReference(updateActor),
      to: visibleReference(canonicalDisplayLabel(updateTargetValue)),
      label: "updates",
    });
  }

  return {
    version: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    status: "resolved",
    issueCode: "none",
    clarificationQuestion: null,
    missingSlots: [],
    actions,
  };
}

function visibleReference(label: string): SemanticObjectReference {
  return { kind: "visible_label", label, occurrence: null };
}

function isSequencePronoun(
  value: string | undefined,
  relationship: string,
): boolean {
  if (!value) return true;
  const normalized = normalizeSpokenNumberAliases(value);
  return (
    normalized === "it" ||
    normalized === "this" ||
    normalized === "that" ||
    normalized === normalizeSpokenNumberAliases(relationship) ||
    normalized === `the ${normalizeSpokenNumberAliases(relationship)}`
  );
}

function canonicalRelationshipLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^the\s+/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function sameReference(left: string, right: string): boolean {
  return normalizeSpokenNumberAliases(left) === normalizeSpokenNumberAliases(right);
}

function safeReferenceText(value: string | undefined): value is string {
  if (!value) return false;
  const cleaned = value.trim();
  return (
    cleaned.length >= 1 &&
    cleaned.length <= 120 &&
    !/[\u0000-\u001F\u007F]/u.test(cleaned)
  );
}

function canonicalDisplayLabel(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/^the\s+/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((token) => {
      const lower = token.toLocaleLowerCase("en-US");
      if (lower === "api") return "API";
      if (lower === "db") return "DB";
      if (/^\d+$/u.test(token)) return token;
      return `${token.charAt(0).toLocaleUpperCase("en-US")}${token
        .slice(1)
        .toLocaleLowerCase("en-US")}`;
    })
    .join(" ");
}
