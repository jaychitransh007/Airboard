import type { SemanticPlan } from "@airboard/core/semantic-plan";

export type NarrativeRelationshipCue = {
  kind:
    | "authenticate"
    | "land"
    | "redirect"
    | "request"
    | "trigger"
    | "update";
  phrase: string;
  offset: number;
};

export type NarrativeRelationshipCoverage = {
  explicitRelationshipCount: number;
  cues: NarrativeRelationshipCue[];
};

export type NarrativeRelationshipCoverageGap = {
  expectedMinimum: number;
  actual: number;
};

const RELATIONSHIP_PATTERNS: ReadonlyArray<{
  kind: NarrativeRelationshipCue["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "request",
    pattern: /\bmakes?\s+(?:an?\s+)?(?:api\s+)?request(?:\s+to)?\b/giu,
  },
  {
    kind: "authenticate",
    pattern: /\bauthenticates?\b/giu,
  },
  {
    kind: "land",
    pattern: /\blands?\s+(?:to|on|at)\b/giu,
  },
  {
    kind: "trigger",
    pattern: /\bgets?\s+(?:fired|triggered|invoked)\b/giu,
  },
  {
    kind: "trigger",
    pattern: /\btriggers?\b/giu,
  },
  {
    kind: "redirect",
    pattern: /\bredirects?\b/giu,
  },
  {
    kind: "update",
    pattern: /\bupdates?\b/giu,
  },
];

/**
 * Extracts only high-precision relationship phrases that Airboard already
 * teaches the semantic planner how to map. This is a checklist, not a parser:
 * the model still resolves entities, direction, ambiguity, and existing-edge
 * reuse from board context.
 */
export function extractNarrativeRelationshipCoverage(
  transcript: string,
): NarrativeRelationshipCoverage | null {
  const cues = RELATIONSHIP_PATTERNS.flatMap(({ kind, pattern }) =>
    Array.from(transcript.matchAll(pattern), (match) => ({
      kind,
      phrase: match[0],
      offset: match.index,
    })),
  ).sort(
    (left, right) =>
      left.offset - right.offset ||
      left.phrase.length - right.phrase.length ||
      left.kind.localeCompare(right.kind),
  );

  if (cues.length === 0) {
    return null;
  }
  return {
    explicitRelationshipCount: cues.length,
    cues,
  };
}

export function validateEmptyBoardNarrativeCoverage(
  transcript: string,
  coverage: NarrativeRelationshipCoverage | null,
  plan: SemanticPlan,
  context: { objectCount: number; edgeCount: number },
): NarrativeRelationshipCoverageGap | null {
  if (
    plan.status !== "resolved" ||
    !coverage ||
    coverage.explicitRelationshipCount < 2 ||
    context.objectCount !== 0 ||
    context.edgeCount !== 0 ||
    !isExplicitDiagramNarrative(transcript)
  ) {
    return null;
  }

  const actual = plan.actions.reduce((count, action) => {
    if (action.type === "connect" || action.type === "reverse_connection") {
      return count + 1;
    }
    if (action.type === "branch") {
      return count + action.branches.length;
    }
    return count;
  }, 0);
  if (actual >= coverage.explicitRelationshipCount) {
    return null;
  }
  return {
    expectedMinimum: coverage.explicitRelationshipCount,
    actual,
  };
}

function isExplicitDiagramNarrative(transcript: string): boolean {
  return /\b(?:create|draw|make)\s+(?:me\s+)?(?:a\s+)?(?:flow\s+)?(?:diagram|workflow)\b/iu.test(
    transcript,
  );
}
