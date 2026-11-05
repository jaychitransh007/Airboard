import { shouldUseSemanticIntentFallback } from "../../apps/web/src/features/board/semanticIntent.ts";

const GRAMMAR_CORPUS_SCHEMA_VERSION = "1.0";
const GRAMMAR_GAP_CONTRACT_VERSION = "1.0";
const GRAMMAR_GAP_CONTRACT_COUNT = 28;
const EXPECTED_OUTCOMES = new Set(["parsed", "semantic_fallback"]);
const FALLBACK_STATUSES = new Set(["clarification", "unrecognized"]);

/**
 * Validate and flatten the checked-in deterministic grammar corpus.
 *
 * Known gaps deliberately live beside the legacy positive corpus, but they
 * are not prose annotations: every gap must own at least one executable
 * scenario with an explicit parser/fallback contract.
 */
export function prepareGrammarEvalCorpus(corpus) {
  const problems = [];
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) {
    throw new Error("Grammar corpus must be a JSON object.");
  }
  if (corpus.schemaVersion !== GRAMMAR_CORPUS_SCHEMA_VERSION) {
    problems.push(
      `schemaVersion must be ${GRAMMAR_CORPUS_SCHEMA_VERSION}; received ${String(corpus.schemaVersion)}`,
    );
  }
  if (!Array.isArray(corpus.cases)) {
    problems.push("cases must be an array");
  }
  if (corpus.grammarGapContractVersion !== GRAMMAR_GAP_CONTRACT_VERSION) {
    problems.push(
      `grammarGapContractVersion must be ${GRAMMAR_GAP_CONTRACT_VERSION}; received ${String(corpus.grammarGapContractVersion)}`,
    );
  }
  if (corpus.knownGapCount !== GRAMMAR_GAP_CONTRACT_COUNT) {
    problems.push(
      `grammar-gap contract ${GRAMMAR_GAP_CONTRACT_VERSION} requires knownGapCount ${GRAMMAR_GAP_CONTRACT_COUNT}; received ${String(corpus.knownGapCount)}`,
    );
  }
  if (!Array.isArray(corpus.knownGaps)) {
    problems.push("knownGaps must be an array of executable gap contracts");
  } else if (
    Number.isInteger(corpus.knownGapCount) &&
    corpus.knownGaps.length !== corpus.knownGapCount
  ) {
    problems.push(
      `knownGapCount declares ${corpus.knownGapCount}, but knownGaps contains ${corpus.knownGaps.length}`,
    );
  }

  const baseCases = Array.isArray(corpus.cases) ? corpus.cases : [];
  const knownGaps = Array.isArray(corpus.knownGaps) ? corpus.knownGaps : [];
  const allIds = new Set();
  const gapIds = new Set();

  for (const [index, testCase] of baseCases.entries()) {
    validateScenario(testCase, `/cases/${index}`, problems, false);
    addUniqueId(testCase?.id, `/cases/${index}/id`, allIds, problems);
  }

  const gapCases = [];
  for (const [gapIndex, gap] of knownGaps.entries()) {
    const path = `/knownGaps/${gapIndex}`;
    if (!gap || typeof gap !== "object" || Array.isArray(gap)) {
      problems.push(`${path} must be an executable grammar-gap object`);
      continue;
    }
    if (typeof gap.id !== "string" || !gap.id.trim()) {
      problems.push(`${path}/id must be a non-empty string`);
    } else if (gapIds.has(gap.id)) {
      problems.push(`${path}/id duplicates grammar gap ${gap.id}`);
    } else {
      gapIds.add(gap.id);
    }
    if (typeof gap.description !== "string" || !gap.description.trim()) {
      problems.push(`${path}/description must be a non-empty string`);
    }
    if (!Array.isArray(gap.scenarios) || gap.scenarios.length === 0) {
      problems.push(
        `${path}/scenarios must contain at least one executable scenario; metadata-only grammar gaps are forbidden`,
      );
      continue;
    }
    for (const [scenarioIndex, scenario] of gap.scenarios.entries()) {
      const scenarioPath = `${path}/scenarios/${scenarioIndex}`;
      validateScenario(scenario, scenarioPath, problems, true);
      addUniqueId(scenario?.id, `${scenarioPath}/id`, allIds, problems);
      gapCases.push({
        ...scenario,
        knownGapId: gap.id,
      });
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid deterministic grammar corpus:\n- ${problems.join("\n- ")}`);
  }

  return {
    baseCases,
    gapCases,
    allCases: [...baseCases, ...gapCases],
    knownGaps,
  };
}

/**
 * Fail closed if an evaluator accidentally skips even one declared scenario.
 */
export function assertAllGrammarGapScenariosExecuted(knownGaps, executedScenarioIds) {
  const executed = new Set(executedScenarioIds);
  const missing = [];
  for (const gap of knownGaps) {
    for (const scenario of gap.scenarios) {
      if (!executed.has(scenario.id)) {
        missing.push(`${gap.id}/${scenario.id}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Grammar evaluator skipped ${missing.length} executable known-gap scenario(s): ${missing.join(", ")}`,
    );
  }
}

export function compareGrammarExpectation(
  result,
  expected,
  { variantId = "original", effectiveText = "" } = {},
) {
  const outcome = expected.outcome ?? "parsed";
  if (outcome === "semantic_fallback") {
    const problems = [];
    if (!shouldUseSemanticIntentFallback(result)) {
      problems.push(
        `expected production semantic fallback, parser returned ${result.status}${
          result.status === "parsed" ? ` (${result.command.kind})` : ""
        }`,
      );
      return problems;
    }
    compareValue("parser status", result.status, expected.parserStatus, problems);
    compareValue("issue code", result.issue?.code, expected.issueCode, problems);
    if (variantId === "original") {
      compareValue(
        "prepared text",
        normalizeText(effectiveText),
        expected.preparedText === undefined ? undefined : normalizeText(expected.preparedText),
        problems,
      );
    }
    return problems;
  }

  if (result.status !== "parsed") {
    return [
      `expected ${expected.kind}, parser returned ${result.status} (${result.issue?.code ?? "no issue"})`,
    ];
  }

  const command = result.command;
  const problems = [];
  compareValue("kind", command.kind, expected.kind, problems);
  compareValue("nodeType", command.nodeType, expected.nodeType, problems);
  compareValue("count", command.count, expected.count, problems);
  compareValue("direction", command.direction, expected.direction, problems);
  compareValue("endpointOrder", command.endpointOrder, expected.endpointOrder, problems);
  compareValue("lineReference", command.lineReference, expected.lineReference, problems);
  compareValue("scope", command.scope, expected.scope, problems);
  compareValue(
    "placement.direction",
    command.placement?.direction,
    expected.placementDirection,
    problems,
  );
  compareValue("placement.relativeTo.kind", command.placement?.relativeTo?.kind, expected.relativeToKind, problems);
  compareValue("from.kind", command.from?.kind, expected.fromKind, problems);
  compareValue("from.pronoun", command.from?.pronoun, expected.fromPronoun, problems);
  compareText("from.label", command.from?.label, expected.fromLabel, problems, variantId);
  compareText(
    "from.normalizedLabel",
    command.from?.normalizedLabel,
    expected.fromNormalizedLabel,
    problems,
    variantId,
  );
  compareValue("to.kind", command.to?.kind, expected.toKind, problems);
  compareValue("to.pronoun", command.to?.pronoun, expected.toPronoun, problems);
  compareText("to.label", command.to?.label, expected.toLabel, problems, variantId);
  compareText(
    "to.normalizedLabel",
    command.to?.normalizedLabel,
    expected.toNormalizedLabel,
    problems,
    variantId,
  );
  compareValue("target.kind", command.target?.kind, expected.targetKind, problems);
  compareValue("target.pronoun", command.target?.pronoun, expected.targetPronoun, problems);
  compareText("target.label", command.target?.label, expected.targetLabel, problems, variantId);
  compareValue("alignment.axis", command.alignment?.axis, expected.alignmentAxis, problems);
  compareValue(
    "alignment.anchor",
    command.alignment?.anchor,
    expected.alignmentAnchor,
    problems,
  );
  compareValue("layout direction", command.direction, expected.layoutDirection, problems);
  compareValue("confidence basis", result.confidence?.basis, expected.confidenceBasis, problems);
  if (variantId === "original") {
    compareValue("activation source", result.activation?.source, expected.activationSource, problems);
  }
  compareText("label", command.label, expected.label, problems, variantId);
  compareText("connector label", command.label, expected.connectorLabel, problems, variantId);
  if (variantId === "original") {
    compareValue(
      "prepared text",
      normalizeText(effectiveText),
      expected.preparedText === undefined ? undefined : normalizeText(expected.preparedText),
      problems,
    );
  }
  return problems;
}

function validateScenario(scenario, path, problems, requireExplicitOutcome) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    problems.push(`${path} must be an object`);
    return;
  }
  if (typeof scenario.id !== "string" || !scenario.id.trim()) {
    problems.push(`${path}/id must be a non-empty string`);
  }
  if (typeof scenario.text !== "string" || !scenario.text.trim()) {
    problems.push(`${path}/text must be a non-empty string`);
  }
  if (!scenario.expected || typeof scenario.expected !== "object") {
    problems.push(`${path}/expected must be an object`);
    return;
  }
  const outcome = scenario.expected.outcome ?? (requireExplicitOutcome ? null : "parsed");
  if (!EXPECTED_OUTCOMES.has(outcome)) {
    problems.push(
      `${path}/expected/outcome must be explicitly parsed or semantic_fallback`,
    );
    return;
  }
  if (outcome === "parsed" && typeof scenario.expected.kind !== "string") {
    problems.push(`${path}/expected/kind is required for a parsed outcome`);
  }
  if (
    outcome === "semantic_fallback" &&
    scenario.expected.parserStatus !== undefined &&
    !FALLBACK_STATUSES.has(scenario.expected.parserStatus)
  ) {
    problems.push(
      `${path}/expected/parserStatus must be clarification or unrecognized for semantic fallback`,
    );
  }
}

function addUniqueId(id, path, ids, problems) {
  if (typeof id !== "string" || !id.trim()) {
    return;
  }
  if (ids.has(id)) {
    problems.push(`${path} duplicates scenario id ${id}`);
  } else {
    ids.add(id);
  }
}

function compareValue(path, actual, expected, problems) {
  if (expected !== undefined && actual !== expected) {
    problems.push(
      `${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function compareText(path, actual, expected, problems, variantId) {
  if (expected === undefined) return;
  if (normalizeText(actual) !== normalizeText(expected)) {
    problems.push(
      `${path} (${variantId}): expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[.?!]+$/u, "")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}
