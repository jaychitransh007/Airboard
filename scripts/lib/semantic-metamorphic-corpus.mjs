import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
  AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA,
  AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS,
  SEMANTIC_PLAN_ISSUE_CODES,
  SEMANTIC_PLAN_MISSING_SLOTS,
  SEMANTIC_PLAN_RESOLUTION_STATUSES,
} from "../../packages/core/src/semanticPlan.ts";
import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
} from "../../packages/core/src/semanticCapabilities.ts";
import {
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
} from "../../apps/api/src/semanticIntent/types.ts";
import {
  AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
} from "../../apps/api/src/semanticIntent/contract.ts";

export const SEMANTIC_METAMORPHIC_SCHEMA_VERSION =
  "airboard-semantic-metamorphic.v1";
export const SEMANTIC_METAMORPHIC_MIN_SCENARIOS = 600;
export const SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS = 500;
export const SEMANTIC_SOURCE_MIN_CASES = 30;

const REQUIRED_SOURCE_REFERENCE_TYPES = Object.freeze([
  "current_selection",
  "pointer",
  "visible_label",
  "type_ordinal",
  "plan_handle",
  "connection",
]);
const REQUIRED_SOURCE_RISK_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "destructive",
]);
const REQUIRED_SOURCE_CONTEXT_CLASSES = Object.freeze([
  "empty_board",
  "sparse_board",
  "dense_board",
  "selection",
  "pointer",
  "parallel_edges",
  "pending_clarification",
  "glossary",
  "stale_or_missing_context",
]);

const REQUIRED_INVARIANTS = Object.freeze([
  "casing",
  "courtesy",
  "disfluency",
  "board-order",
  "irrelevant-object",
  "opaque-id",
]);

const VALID_STATUSES = new Set(SEMANTIC_PLAN_RESOLUTION_STATUSES);
const VALID_ISSUE_CODES = new Set(SEMANTIC_PLAN_ISSUE_CODES);
const VALID_MISSING_SLOTS = new Set(SEMANTIC_PLAN_MISSING_SLOTS);
const VALID_PARSER_ISSUES = new Set(
  SEMANTIC_INTENT_RECOVERABLE_PARSER_ISSUES,
);
const VALID_ACTION_TYPES = new Set(
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.actions.map(
    ({ actionType }) => actionType,
  ),
);
const VALID_NODE_TYPES = new Set(
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.nodes.map(({ nodeType }) => nodeType),
);
const NODE_CAPABILITIES = new Map(
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.nodes.map((capability) => [
    capability.nodeType,
    capability,
  ]),
);

const CASING_VARIANTS = Object.freeze([
  ["lowercase", (text) => text.toLocaleLowerCase("en")],
  ["uppercase", (text) => text.toLocaleUpperCase("en")],
  ["title-case", titleCase],
  ["sentence-case", sentenceCase],
  ["alternating-case", alternatingCase],
]);

const COURTESY_VARIANTS = Object.freeze([
  ["please", (text) => insertAfterWakePhrase(text, "please, ")],
  [
    "could-you-please",
    (text) => insertAfterWakePhrase(text, "could you please "),
  ],
  [
    "would-you-please",
    (text) => insertAfterWakePhrase(text, "would you please "),
  ],
  [
    "when-convenient",
    (text) => insertAfterWakePhrase(text, "when convenient, "),
  ],
  ["kindly", (text) => insertAfterWakePhrase(text, "kindly ")],
  [
    "thanks-could-you",
    (text) => insertAfterWakePhrase(text, "thanks, could you "),
  ],
  [
    "can-you-please",
    (text) => insertAfterWakePhrase(text, "can you please "),
  ],
  [
    "would-you-mind",
    (text) => insertAfterWakePhrase(text, "would you mind "),
  ],
  [
    "if-you-would",
    (text) => insertAfterWakePhrase(text, "if you would, "),
  ],
  [
    "at-your-convenience",
    (text) => insertAfterWakePhrase(text, "at your convenience, "),
  ],
]);

const DISFLUENCY_VARIANTS = Object.freeze([
  ["um", (text) => insertAfterWakePhrase(text, "um, ")],
  ["uh", (text) => insertAfterWakePhrase(text, "uh, ")],
  ["okay-so", (text) => insertAfterWakePhrase(text, "okay, so, ")],
  ["well", (text) => insertAfterWakePhrase(text, "well, ")],
  ["i-mean", (text) => insertAfterWakePhrase(text, "I mean, ")],
  ["repeated-filler", (text) => insertAfterWakePhrase(text, "um, um, ")],
]);

const BOARD_ORDER_VARIANTS = Object.freeze([
  ["reverse", (values) => [...values].reverse()],
  ["rotate-left", (values) => rotate(values, 1)],
  ["rotate-right", (values) => rotate(values, -1)],
  ["ends-first", interleaveEnds],
  [
    "semantic-descending",
    (values) =>
      [...values].sort((left, right) =>
        stableStringify(right).localeCompare(stableStringify(left)),
      ),
  ],
]);

const IRRELEVANT_OBJECT_VARIANTS = Object.freeze([
  {
    id: "document",
    nodeType: "document",
    label: "Fixture Release Notes",
    position: { x: 84, y: 84 },
  },
  {
    id: "note",
    nodeType: "note",
    label: "Fixture Parking Lot",
    position: { x: 940, y: 92 },
  },
  {
    id: "terminator",
    nodeType: "terminator",
    label: "Fixture Archive",
    position: { x: 88, y: 680 },
  },
  {
    id: "io",
    nodeType: "io",
    label: "Fixture Export",
    position: { x: 920, y: 680 },
  },
  {
    id: "custom",
    nodeType: "custom",
    label: "Fixture Unrelated Box",
    position: { x: 1160, y: 380 },
  },
]);

const OPAQUE_ID_VARIANTS = Object.freeze([
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
]);

export const SEMANTIC_METAMORPHIC_INVARIANTS = Object.freeze({
  casing: CASING_VARIANTS.map(([id]) => id),
  courtesy: COURTESY_VARIANTS.map(([id]) => id),
  disfluency: DISFLUENCY_VARIANTS.map(([id]) => id),
  "board-order": BOARD_ORDER_VARIANTS.map(([id]) => id),
  "irrelevant-object": IRRELEVANT_OBJECT_VARIANTS.map(({ id }) => id),
  "opaque-id": [...OPAQUE_ID_VARIANTS],
});

/**
 * Expand the live semantic seed corpus into deterministic, runner-compatible
 * cases. Pending clarification answers intentionally skip courtesy and filler
 * rewrites because their transcript is a literal slot value.
 */
export function expandSemanticMetamorphicCorpus(sourceCorpus, options = {}) {
  const sourceValidation = validateSemanticSourceCorpus(sourceCorpus, options);
  if (!sourceValidation.valid) {
    throw validationError("Invalid source semantic corpus", sourceValidation);
  }

  const cases = [];
  for (const sourceCase of sourceCorpus.cases) {
    cases.push(buildScenario(sourceCase, "baseline", "source"));
    for (const [variant, transform] of CASING_VARIANTS) {
      cases.push(
        buildScenario(sourceCase, "casing", variant, (scenario) => {
          scenario.transcript = transform(scenario.transcript);
        }),
      );
    }
    if (sourceCase.pendingClarification === undefined) {
      for (const [variant, transform] of COURTESY_VARIANTS) {
        cases.push(
          buildScenario(sourceCase, "courtesy", variant, (scenario) => {
            scenario.transcript = transform(scenario.transcript);
          }),
        );
      }
      for (const [variant, transform] of DISFLUENCY_VARIANTS) {
        cases.push(
          buildScenario(sourceCase, "disfluency", variant, (scenario) => {
            scenario.transcript = transform(scenario.transcript);
          }),
        );
      }
    }
    for (const [variant, reorder] of BOARD_ORDER_VARIANTS) {
      cases.push(
        buildScenario(sourceCase, "board-order", variant, (scenario) => {
          scenario.context = reorderBoardContext(scenario.context, reorder, variant);
        }),
      );
    }
    for (const fixtureObject of IRRELEVANT_OBJECT_VARIANTS) {
      cases.push(
        buildScenario(
          sourceCase,
          "irrelevant-object",
          fixtureObject.id,
          (scenario) => {
            const object = createIrrelevantObject(
              scenario.context.objects,
              fixtureObject,
            );
            scenario.context.objects = [...scenario.context.objects, object];
            scenario.metamorphic.fixtureObject = {
              label: object.label,
              nodeType: object.nodeType,
              ordinal: object.ordinal,
            };
          },
        ),
      );
    }
    for (const namespace of OPAQUE_ID_VARIANTS) {
      cases.push(
        buildScenario(sourceCase, "opaque-id", namespace, (scenario) => {
          applyOpaqueFixtureIds(scenario, namespace);
        }),
      );
    }
  }

  const invariantCounts = countBy(cases.map(({ metamorphic }) => metamorphic.invariant));
  return {
    schemaVersion: "1.0",
    description:
      "Deterministic metamorphic expansion of the production Airboard semantic voice-intent corpus.",
    metamorphic: {
      schemaVersion: SEMANTIC_METAMORPHIC_SCHEMA_VERSION,
      sourceSchemaVersion: sourceCorpus.schemaVersion,
      semanticPromptVersion:
        AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
      semanticPlanContractVersion: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
      capabilityRegistryVersion:
        AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
      generatedDeterministically: true,
      sourceCaseCount: sourceCorpus.cases.length,
      scenarioCount: cases.length,
      maxTranscriptCharacters:
        options.maxTranscriptCharacters ??
        SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS,
      invariantCounts,
    },
    cases,
  };
}

export async function loadAndExpandSemanticMetamorphicCorpus(
  sourcePath,
  options = {},
) {
  const sourceCorpus = JSON.parse(await readFile(sourcePath, "utf8"));
  const corpus = expandSemanticMetamorphicCorpus(sourceCorpus, options);
  const validation = assertValidSemanticMetamorphicCorpus(corpus, {
    ...options,
    sourceCorpus,
  });
  return { sourceCorpus, corpus, validation };
}

/**
 * Cross-check the production JSON schema, constants, and capability registry.
 */
export function validateProductionSemanticContract() {
  const errors = [];
  const actionSchemas =
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA?.$defs?.action?.anyOf ?? [];
  const schemaActionTypes = actionSchemas
    .map((actionSchema) => actionSchema?.properties?.type?.enum?.[0])
    .filter((value) => typeof value === "string")
    .sort();
  const registryActionTypes = [...VALID_ACTION_TYPES].sort();
  if (!sameJson(schemaActionTypes, registryActionTypes)) {
    errors.push(
      issue(
        "contract.action-registry",
        "/$defs/action",
        `Plan schema actions (${schemaActionTypes.join(", ")}) differ from capability registry actions (${registryActionTypes.join(", ")})`,
      ),
    );
  }

  const schemaStatuses = [
    ...(AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA?.properties?.status?.enum ?? []),
  ].sort();
  const productionStatuses = [...SEMANTIC_PLAN_RESOLUTION_STATUSES].sort();
  if (!sameJson(schemaStatuses, productionStatuses)) {
    errors.push(
      issue(
        "contract.statuses",
        "/properties/status",
        "Plan schema statuses differ from production status constants",
      ),
    );
  }
  if (
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA?.properties?.version?.enum?.[0] !==
    AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION
  ) {
    errors.push(
      issue(
        "contract.version",
        "/properties/version",
        "Plan schema version differs from the production contract version",
      ),
    );
  }
  if (
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA?.properties?.actions?.maxItems !==
    AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS
  ) {
    errors.push(
      issue(
        "contract.action-limit",
        "/properties/actions/maxItems",
        "Plan schema action limit differs from the production constant",
      ),
    );
  }

  const ordinalReferenceSchema =
    AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA?.$defs?.objectReference?.anyOf?.find(
      (schema) =>
        schema?.properties?.kind?.enum?.[0] === "type_ordinal",
    );
  const schemaNodeTypes = [
    ...(ordinalReferenceSchema?.properties?.nodeType?.enum ?? []),
  ].sort();
  const registryNodeTypes = [...VALID_NODE_TYPES].sort();
  if (!sameJson(schemaNodeTypes, registryNodeTypes)) {
    errors.push(
      issue(
        "contract.node-registry",
        "/$defs/objectReference",
        "Plan schema node types differ from the capability registry",
      ),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    semanticPlanContractVersion: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
    capabilityRegistryVersion: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
    statuses: productionStatuses,
    actionTypes: registryActionTypes,
    nodeTypes: registryNodeTypes,
  };
}

export function validateSemanticSourceCorpus(sourceCorpus, options = {}) {
  const errors = [...validateProductionSemanticContract().errors];
  const maxTranscriptCharacters =
    options.maxTranscriptCharacters ??
    SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS;
  if (
    !isRecord(sourceCorpus) ||
    sourceCorpus.schemaVersion !== "1.0" ||
    !Array.isArray(sourceCorpus.cases)
  ) {
    errors.push(
      issue(
        "source.shape",
        "/",
        "Source must be a semantic voice-intent corpus with schemaVersion 1.0",
      ),
    );
    return { valid: false, errors, caseCount: 0 };
  }
  if (
    sourceCorpus.semanticPromptVersion !==
    AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION
  ) {
    errors.push(
      issue(
        "source.prompt-version",
        "/semanticPromptVersion",
        `Semantic corpus must target production prompt ${AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION}`,
      ),
    );
  }

  const seenIds = new Set();
  for (const [index, sourceCase] of sourceCorpus.cases.entries()) {
    validateSemanticCase(sourceCase, `/cases/${index}`, {
      errors,
      maxTranscriptCharacters,
      seenIds,
    });
  }
  const coverage = analyzeSemanticSourceCoverage(sourceCorpus.cases);
  if (sourceCorpus.cases.length < SEMANTIC_SOURCE_MIN_CASES) {
    errors.push(
      issue(
        "source.minimum-independent-cases",
        "/cases",
        `Expected at least ${SEMANTIC_SOURCE_MIN_CASES} independently authored semantic seeds before metamorphic expansion, received ${sourceCorpus.cases.length}`,
      ),
    );
  }
  requireCoverageMembers(
    coverage.actionTypes,
    [...VALID_ACTION_TYPES],
    "source.action-coverage",
    "/cases",
    "registered action",
    errors,
  );
  requireCoverageMembers(
    coverage.statuses,
    [...VALID_STATUSES],
    "source.status-coverage",
    "/cases",
    "resolution status",
    errors,
  );
  requireCoverageMembers(
    coverage.referenceTypes,
    REQUIRED_SOURCE_REFERENCE_TYPES,
    "source.reference-coverage",
    "/cases",
    "reference type",
    errors,
  );
  requireCoverageMembers(
    coverage.riskLevels,
    REQUIRED_SOURCE_RISK_LEVELS,
    "source.risk-coverage",
    "/cases",
    "risk level",
    errors,
  );
  requireCoverageMembers(
    coverage.contextClasses,
    REQUIRED_SOURCE_CONTEXT_CLASSES,
    "source.context-coverage",
    "/cases",
    "board-context class",
    errors,
  );
  return {
    valid: errors.length === 0,
    errors,
    caseCount: sourceCorpus.cases.length,
    coverage,
  };
}

export function analyzeSemanticSourceCoverage(cases) {
  const actionTypes = new Set();
  const statuses = new Set();
  const referenceTypes = new Set();
  const riskLevels = new Set();
  const contextClasses = new Set();
  for (const semanticCase of cases) {
    if (!isRecord(semanticCase)) continue;
    const expected = isRecord(semanticCase.expected)
      ? semanticCase.expected
      : {};
    const context = isRecord(semanticCase.context)
      ? semanticCase.context
      : {};
    const actions = Object.entries(expected.actionTypeCounts ?? {})
      .filter(([, count]) => Number(count) > 0)
      .map(([actionType]) => actionType);
    actions.forEach((actionType) => actionTypes.add(actionType));
    if (typeof expected.status === "string") {
      statuses.add(expected.status);
    }
    deriveReferenceTypes(semanticCase, actions).forEach((value) =>
      referenceTypes.add(value),
    );
    riskLevels.add(deriveRiskLevel(semanticCase, actions));
    deriveContextClasses(semanticCase).forEach((value) =>
      contextClasses.add(value),
    );
  }
  return {
    independentCaseCount: cases.length,
    actionTypes: [...actionTypes].sort(),
    statuses: [...statuses].sort(),
    referenceTypes: [...referenceTypes].sort(),
    riskLevels: [...riskLevels].sort(),
    contextClasses: [...contextClasses].sort(),
  };
}

function deriveReferenceTypes(semanticCase, actions) {
  const values = new Set();
  const context = semanticCase.context ?? {};
  const transcript = normalizeCoverageText(semanticCase.transcript);
  if (Number(context.selectionCount) > 0) {
    values.add("current_selection");
  }
  if (
    context.pointerAvailable === true &&
    /\b(?:here|there|pointer|cursor|pointing|under my hand)\b/u.test(
      transcript,
    )
  ) {
    values.add("pointer");
  }
  if (
    (context.objects ?? []).some((object) =>
      transcript.includes(normalizeCoverageText(object.label)),
    )
  ) {
    values.add("visible_label");
  }
  if (
    /\b(?:first|second|third|fourth|fifth|[1-9](?:st|nd|rd|th)?)\b/u.test(
      transcript,
    )
  ) {
    values.add("type_ordinal");
  }
  if (
    actions.includes("create") &&
    actions.some((action) =>
      ["connect", "branch", "group"].includes(action),
    )
  ) {
    values.add("plan_handle");
  }
  if (
    actions.some((action) =>
      ["reverse_connection", "delete_connection"].includes(action),
    )
  ) {
    values.add("connection");
  }
  return values;
}

function deriveRiskLevel(semanticCase, actions) {
  if (
    semanticCase.expected?.status === "resolved" &&
    actions.some((action) =>
      ["delete", "delete_connection"].includes(action),
    )
  ) {
    return "destructive";
  }
  if (
    actions.includes("reverse_connection") ||
    (semanticCase.expected?.status === "clarification" &&
      /\b(?:delete|remove|disconnect|reverse)\b/u.test(
        normalizeCoverageText(semanticCase.transcript),
      ))
  ) {
    return "high";
  }
  if (
    semanticCase.expected?.status === "unsupported" ||
    actions.some((action) =>
      ["select", "undo", "cancel"].includes(action),
    )
  ) {
    return "low";
  }
  return "medium";
}

function deriveContextClasses(semanticCase) {
  const context = semanticCase.context ?? {};
  const objects = Array.isArray(context.objects) ? context.objects : [];
  const edges = Array.isArray(context.edges) ? context.edges : [];
  const classes = new Set();
  if (objects.length === 0) classes.add("empty_board");
  if (objects.length >= 1 && objects.length <= 4) {
    classes.add("sparse_board");
  }
  if (objects.length >= 8) classes.add("dense_board");
  if (Number(context.selectionCount) > 0) classes.add("selection");
  if (context.pointerAvailable === true) classes.add("pointer");
  if (semanticCase.pendingClarification) {
    classes.add("pending_clarification");
  }
  if ((context.projectGlossary ?? []).length > 0) classes.add("glossary");
  const endpointKeys = edges.map((edge) =>
    stableStringify({ from: edge?.from, to: edge?.to }),
  );
  if (new Set(endpointKeys).size < endpointKeys.length) {
    classes.add("parallel_edges");
  }
  if (
    ["missing_context", "missing_source", "missing_target"].includes(
      semanticCase.expected?.issueCode,
    )
  ) {
    classes.add("stale_or_missing_context");
  }
  return classes;
}

function requireCoverageMembers(
  observed,
  required,
  code,
  path,
  label,
  errors,
) {
  for (const value of required) {
    if (!observed.includes(value)) {
      errors.push(
        issue(
          code,
          path,
          `Source corpus has no independent seed for ${label} ${value}`,
        ),
      );
    }
  }
}

function normalizeCoverageText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en");
}

export function validateSemanticMetamorphicCorpus(corpus, options = {}) {
  const errors = [];
  const sourceCorpus = options.sourceCorpus;
  const sourceValidation = validateSemanticSourceCorpus(
    sourceCorpus,
    options,
  );
  errors.push(...sourceValidation.errors);
  const minimumScenarios =
    options.minimumScenarios ?? SEMANTIC_METAMORPHIC_MIN_SCENARIOS;
  const maxTranscriptCharacters =
    options.maxTranscriptCharacters ??
    SEMANTIC_METAMORPHIC_MAX_TRANSCRIPT_CHARACTERS;

  if (
    !isRecord(corpus) ||
    corpus.schemaVersion !== "1.0" ||
    !Array.isArray(corpus.cases)
  ) {
    errors.push(
      issue(
        "corpus.shape",
        "/",
        "Metamorphic corpus must remain compatible with semantic runner schemaVersion 1.0",
      ),
    );
    return validationResult(corpus, errors, minimumScenarios);
  }
  if (
    corpus.metamorphic?.schemaVersion !==
    SEMANTIC_METAMORPHIC_SCHEMA_VERSION
  ) {
    errors.push(
      issue(
        "corpus.metamorphic-version",
        "/metamorphic/schemaVersion",
        `Expected ${SEMANTIC_METAMORPHIC_SCHEMA_VERSION}`,
      ),
    );
  }
  if (
    corpus.metamorphic?.semanticPlanContractVersion !==
    AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION
  ) {
    errors.push(
      issue(
        "corpus.contract-version",
        "/metamorphic/semanticPlanContractVersion",
        "Metamorphic corpus does not target the production semantic plan contract",
      ),
    );
  }
  if (
    corpus.metamorphic?.semanticPromptVersion !==
    AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION
  ) {
    errors.push(
      issue(
        "corpus.prompt-version",
        "/metamorphic/semanticPromptVersion",
        "Metamorphic corpus does not target the production semantic prompt",
      ),
    );
  }
  if (
    corpus.metamorphic?.capabilityRegistryVersion !==
    AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version
  ) {
    errors.push(
      issue(
        "corpus.capability-version",
        "/metamorphic/capabilityRegistryVersion",
        "Metamorphic corpus does not target the production capability registry",
      ),
    );
  }
  if (
    corpus.metamorphic?.generatedDeterministically !== true ||
    corpus.metamorphic?.maxTranscriptCharacters !== maxTranscriptCharacters
  ) {
    errors.push(
      issue(
        "corpus.generation-policy",
        "/metamorphic",
        "Metamorphic corpus must declare deterministic generation and the active transcript limit",
      ),
    );
  }
  if (corpus.cases.length < minimumScenarios) {
    errors.push(
      issue(
        "corpus.minimum-scenarios",
        "/cases",
        `Expected at least ${minimumScenarios} stable scenarios, received ${corpus.cases.length}`,
      ),
    );
  }
  const distinctRequestCount = new Set(
    corpus.cases.map((scenario) =>
      stableStringify({
        transcript: scenario.transcript,
        parserIssue: scenario.parserIssue,
        context: scenario.context,
        ...(scenario.pendingClarification
          ? { pendingClarification: scenario.pendingClarification }
          : {}),
      }),
    ),
  ).size;
  if (distinctRequestCount < minimumScenarios) {
    errors.push(
      issue(
        "corpus.minimum-distinct-requests",
        "/cases",
        `Expected at least ${minimumScenarios} distinct runner inputs, received ${distinctRequestCount}`,
      ),
    );
  }

  const sourceById = new Map(
    Array.isArray(sourceCorpus?.cases)
      ? sourceCorpus.cases.map((sourceCase) => [sourceCase.id, sourceCase])
      : [],
  );
  const seenIds = new Set();
  const invariantCounts = {};
  for (const [index, scenario] of corpus.cases.entries()) {
    const path = `/cases/${index}`;
    validateSemanticCase(scenario, path, {
      errors,
      maxTranscriptCharacters,
      seenIds,
    });
    const metadata = scenario?.metamorphic;
    if (
      !isRecord(metadata) ||
      typeof metadata.sourceCaseId !== "string" ||
      typeof metadata.invariant !== "string" ||
      typeof metadata.variant !== "string"
    ) {
      errors.push(
        issue(
          "scenario.metadata",
          `${path}/metamorphic`,
          "Scenario must identify its source case, invariant, and variant",
        ),
      );
      continue;
    }
    invariantCounts[metadata.invariant] =
      (invariantCounts[metadata.invariant] ?? 0) + 1;
    const sourceCase = sourceById.get(metadata.sourceCaseId);
    if (!sourceCase) {
      errors.push(
        issue(
          "scenario.source",
          `${path}/metamorphic/sourceCaseId`,
          `Unknown source case ${metadata.sourceCaseId}`,
        ),
      );
      continue;
    }
    if (!sameJson(scenario.expected, sourceCase.expected)) {
      errors.push(
        issue(
          "scenario.expectation-invariant",
          `${path}/expected`,
          "Metamorphic transformation changed the source expectation",
        ),
      );
    }
    if (
      metadata.expectationFingerprint !==
      expectationFingerprint(sourceCase.expected)
    ) {
      errors.push(
        issue(
          "scenario.expectation-fingerprint",
          `${path}/metamorphic/expectationFingerprint`,
          "Expectation fingerprint does not match the production source case",
        ),
      );
    }
    const rebuilt = rebuildScenario(sourceCase, metadata.invariant, metadata.variant);
    if (!rebuilt) {
      errors.push(
        issue(
          "scenario.variant",
          `${path}/metamorphic`,
          `Unknown invariant variant ${metadata.invariant}/${metadata.variant}`,
        ),
      );
    } else if (!sameJson(rebuilt, scenario)) {
      errors.push(
        issue(
          "scenario.determinism",
          path,
          "Scenario differs from the deterministic invariant transformation",
        ),
      );
    }
  }

  for (const invariant of REQUIRED_INVARIANTS) {
    if (!invariantCounts[invariant]) {
      errors.push(
        issue(
          "corpus.invariant-coverage",
          "/cases",
          `No scenario covers required invariant ${invariant}`,
        ),
      );
    }
  }
  if (
    corpus.metamorphic?.scenarioCount !== corpus.cases.length ||
    corpus.metamorphic?.sourceCaseCount !== sourceById.size ||
    !sameJson(corpus.metamorphic?.invariantCounts, invariantCounts)
  ) {
    errors.push(
      issue(
        "corpus.summary",
        "/metamorphic",
        "Metamorphic corpus summary does not match materialized scenarios",
      ),
    );
  }

  return validationResult(corpus, errors, minimumScenarios, invariantCounts);
}

export function assertValidSemanticMetamorphicCorpus(corpus, options = {}) {
  const validation = validateSemanticMetamorphicCorpus(corpus, options);
  if (!validation.valid) {
    throw validationError("Invalid semantic metamorphic corpus", validation);
  }
  return validation;
}

function buildScenario(
  sourceCase,
  invariant,
  variant,
  transform = () => {},
) {
  const scenario = structuredClone(sourceCase);
  scenario.id = scenarioId(sourceCase.id, invariant, variant);
  scenario.metamorphic = {
    sourceCaseId: sourceCase.id,
    invariant,
    variant,
    expectationFingerprint: expectationFingerprint(sourceCase.expected),
  };
  transform(scenario);
  return scenario;
}

function rebuildScenario(sourceCase, invariant, variant) {
  if (invariant === "baseline" && variant === "source") {
    return buildScenario(sourceCase, invariant, variant);
  }
  const casing = CASING_VARIANTS.find(([id]) => id === variant);
  if (invariant === "casing" && casing) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      scenario.transcript = casing[1](scenario.transcript);
    });
  }
  const courtesy = COURTESY_VARIANTS.find(([id]) => id === variant);
  if (
    invariant === "courtesy" &&
    courtesy &&
    sourceCase.pendingClarification === undefined
  ) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      scenario.transcript = courtesy[1](scenario.transcript);
    });
  }
  const disfluency = DISFLUENCY_VARIANTS.find(([id]) => id === variant);
  if (
    invariant === "disfluency" &&
    disfluency &&
    sourceCase.pendingClarification === undefined
  ) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      scenario.transcript = disfluency[1](scenario.transcript);
    });
  }
  const boardOrder = BOARD_ORDER_VARIANTS.find(([id]) => id === variant);
  if (invariant === "board-order" && boardOrder) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      scenario.context = reorderBoardContext(
        scenario.context,
        boardOrder[1],
        variant,
      );
    });
  }
  const irrelevant = IRRELEVANT_OBJECT_VARIANTS.find(
    ({ id }) => id === variant,
  );
  if (invariant === "irrelevant-object" && irrelevant) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      const object = createIrrelevantObject(
        scenario.context.objects,
        irrelevant,
      );
      scenario.context.objects = [...scenario.context.objects, object];
      scenario.metamorphic.fixtureObject = {
        label: object.label,
        nodeType: object.nodeType,
        ordinal: object.ordinal,
      };
    });
  }
  if (invariant === "opaque-id" && OPAQUE_ID_VARIANTS.includes(variant)) {
    return buildScenario(sourceCase, invariant, variant, (scenario) => {
      applyOpaqueFixtureIds(scenario, variant);
    });
  }
  return null;
}

function validateSemanticCase(
  semanticCase,
  path,
  { errors, maxTranscriptCharacters, seenIds },
) {
  if (!isRecord(semanticCase)) {
    errors.push(issue("case.shape", path, "Semantic case must be an object"));
    return;
  }
  if (
    typeof semanticCase.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(semanticCase.id)
  ) {
    errors.push(
      issue("case.id", `${path}/id`, "Case ID has an invalid stable format"),
    );
  } else if (seenIds.has(semanticCase.id)) {
    errors.push(
      issue("case.duplicate-id", `${path}/id`, `Duplicate case ID ${semanticCase.id}`),
    );
  } else {
    seenIds.add(semanticCase.id);
  }
  if (
    typeof semanticCase.transcript !== "string" ||
    semanticCase.transcript.length === 0 ||
    semanticCase.transcript.length > maxTranscriptCharacters
  ) {
    errors.push(
      issue(
        "case.transcript",
        `${path}/transcript`,
        `Transcript must contain 1-${maxTranscriptCharacters} characters`,
      ),
    );
  }
  if (!VALID_PARSER_ISSUES.has(semanticCase.parserIssue)) {
    errors.push(
      issue(
        "case.parser-issue",
        `${path}/parserIssue`,
        `Unknown production parser issue ${String(semanticCase.parserIssue)}`,
      ),
    );
  }
  validateContext(semanticCase.context, `${path}/context`, errors);
  validatePendingClarification(
    semanticCase.pendingClarification,
    `${path}/pendingClarification`,
    errors,
  );
  validateExpected(semanticCase.expected, `${path}/expected`, errors);
}

function validateContext(context, path, errors) {
  if (
    !isRecord(context) ||
    !Number.isInteger(context.selectionCount) ||
    context.selectionCount < 0 ||
    !Array.isArray(context.selected) ||
    !Array.isArray(context.objects) ||
    !Array.isArray(context.edges) ||
    !Array.isArray(context.projectGlossary) ||
    typeof context.pointerAvailable !== "boolean"
  ) {
    errors.push(
      issue("case.context", path, "Semantic board context is malformed"),
    );
    return;
  }
  if (context.selectionCount !== context.selected.length) {
    errors.push(
      issue(
        "case.selection-count",
        `${path}/selectionCount`,
        "selectionCount must equal selected summaries length",
      ),
    );
  }
  for (const [index, object] of [
    ...context.objects.map((value, itemIndex) => [itemIndex, value]),
    ...context.selected.map((value, itemIndex) => [
      `selected/${itemIndex}`,
      value,
    ]),
  ]) {
    if (
      !isRecord(object) ||
      typeof object.label !== "string" ||
      !object.label.trim() ||
      !VALID_NODE_TYPES.has(object.nodeType) ||
      (object.ordinal !== undefined &&
        (!Number.isInteger(object.ordinal) || object.ordinal < 1))
    ) {
      errors.push(
        issue(
          "case.context-object",
          `${path}/${typeof index === "number" ? `objects/${index}` : index}`,
          "Context object must have a label, registered node type, and valid ordinal",
        ),
      );
    }
  }
  for (const [index, edge] of context.edges.entries()) {
    if (
      !isRecord(edge) ||
      !validContextReference(edge.from) ||
      !validContextReference(edge.to)
    ) {
      errors.push(
        issue(
          "case.context-edge",
          `${path}/edges/${index}`,
          "Context edge endpoints must use registered node summaries",
        ),
      );
    }
  }
  for (const [index, glossary] of context.projectGlossary.entries()) {
    if (
      !isRecord(glossary) ||
      typeof glossary.term !== "string" ||
      !glossary.term.trim() ||
      (glossary.nodeType !== undefined &&
        !VALID_NODE_TYPES.has(glossary.nodeType))
    ) {
      errors.push(
        issue(
          "case.context-glossary",
          `${path}/projectGlossary/${index}`,
          "Project glossary entry is malformed",
        ),
      );
    }
  }
}

function validatePendingClarification(pending, path, errors) {
  if (pending === undefined) return;
  if (
    !isRecord(pending) ||
    typeof pending.previousTranscript !== "string" ||
    typeof pending.question !== "string" ||
    !Array.isArray(pending.missingSlots) ||
    pending.missingSlots.some((slot) => !VALID_MISSING_SLOTS.has(slot))
  ) {
    errors.push(
      issue(
        "case.pending-clarification",
        path,
        "Pending clarification does not match the production slot contract",
      ),
    );
  }
}

function validateExpected(expected, path, errors) {
  if (!isRecord(expected) || !VALID_STATUSES.has(expected.status)) {
    errors.push(
      issue(
        "case.expected-status",
        `${path}/status`,
        `Expected status must be one of ${[...VALID_STATUSES].join(", ")}`,
      ),
    );
    return;
  }
  if (
    expected.issueCode !== undefined &&
    !VALID_ISSUE_CODES.has(expected.issueCode)
  ) {
    errors.push(
      issue(
        "case.expected-issue",
        `${path}/issueCode`,
        `Expected issueCode is not in the production plan contract`,
      ),
    );
  }
  if (
    expected.status === "resolved" &&
    expected.issueCode !== undefined &&
    expected.issueCode !== "none"
  ) {
    errors.push(
      issue(
        "case.resolved-issue",
        `${path}/issueCode`,
        "Resolved expectation may only use issueCode none",
      ),
    );
  }
  if (
    expected.status !== "resolved" &&
    (expected.issueCode === undefined || expected.issueCode === "none")
  ) {
    errors.push(
      issue(
        "case.nonresolved-issue",
        `${path}/issueCode`,
        `${expected.status} expectation requires a specific non-none issueCode`,
      ),
    );
  }
  const counts = expected.actionTypeCounts ?? {};
  if (
    !isRecord(counts) ||
    Object.entries(counts).some(
      ([type, count]) =>
        !VALID_ACTION_TYPES.has(type) ||
        !Number.isInteger(count) ||
        count < 0,
    )
  ) {
    errors.push(
      issue(
        "case.expected-actions",
        `${path}/actionTypeCounts`,
        "Expected action counts must use registered action types",
      ),
    );
    return;
  }
  const totalActions = Object.values(counts).reduce(
    (total, count) => total + count,
    0,
  );
  if (totalActions > AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS) {
    errors.push(
      issue(
        "case.expected-action-limit",
        `${path}/actionTypeCounts`,
        `Expected actions exceed production limit ${AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS}`,
      ),
    );
  }
  if (expected.status === "resolved" && totalActions === 0) {
    errors.push(
      issue(
        "case.resolved-actions",
        path,
        "Resolved expectation must contain at least one action",
      ),
    );
  }
  if (expected.status !== "resolved" && totalActions !== 0) {
    errors.push(
      issue(
        "case.nonresolved-actions",
        path,
        `${expected.status} expectation cannot contain actions`,
      ),
    );
  }
  if (expected.actionDetails !== undefined) {
    if (
      !Array.isArray(expected.actionDetails) ||
      expected.actionDetails.length === 0 ||
      expected.actionDetails.some(
        (detail) =>
          !isRecord(detail) ||
          !VALID_ACTION_TYPES.has(detail.type),
      )
    ) {
      errors.push(
        issue(
          "case.expected-action-details",
          `${path}/actionDetails`,
          "Expected action details must be partial objects using registered action types",
        ),
      );
    } else {
      const detailCounts = countBy(
        expected.actionDetails.map(({ type }) => type),
      );
      for (const [type, count] of Object.entries(detailCounts)) {
        if (count > (counts[type] ?? 0)) {
          errors.push(
            issue(
              "case.expected-action-details",
              `${path}/actionDetails`,
              `Action details declare ${count} ${type} action(s), but actionTypeCounts declares ${counts[type] ?? 0}`,
            ),
          );
        }
      }
    }
  }
  if (
    expected.createdNodeTypes !== undefined &&
    (!Array.isArray(expected.createdNodeTypes) ||
      expected.createdNodeTypes.some((type) => !VALID_NODE_TYPES.has(type)))
  ) {
    errors.push(
      issue(
        "case.expected-node-types",
        `${path}/createdNodeTypes`,
        "Expected created nodes must use registered node types",
      ),
    );
  }
  if (
    expected.missingSlotsIncludes !== undefined &&
    (!Array.isArray(expected.missingSlotsIncludes) ||
      expected.missingSlotsIncludes.some(
        (slot) => !VALID_MISSING_SLOTS.has(slot),
      ))
  ) {
    errors.push(
      issue(
        "case.expected-missing-slots",
        `${path}/missingSlotsIncludes`,
        "Expected missing slots must use the production plan contract",
      ),
    );
  }
  if (
    expected.selectionCount !== undefined &&
    (!Number.isInteger(expected.selectionCount) ||
      expected.selectionCount < 0)
  ) {
    errors.push(
      issue(
        "case.expected-selection",
        `${path}/selectionCount`,
        "Expected selectionCount must be a non-negative integer",
      ),
    );
  }
  validateFinalStateExpectation(
    expected.finalState,
    `${path}/finalState`,
    expected.status,
    errors,
  );
}

function validateFinalStateExpectation(finalState, path, status, errors) {
  if (finalState === undefined) return;
  if (
    !isRecord(finalState) ||
    !Number.isInteger(finalState.nodeCountDelta) ||
    !Number.isInteger(finalState.edgeCountDelta)
  ) {
    errors.push(
      issue(
        "case.expected-final-state",
        path,
        "Final-state expectation requires integer nodeCountDelta and edgeCountDelta",
      ),
    );
    return;
  }
  if (
    status !== "resolved" &&
    (finalState.nodeCountDelta !== 0 || finalState.edgeCountDelta !== 0)
  ) {
    errors.push(
      issue(
        "case.expected-safe-noop",
        path,
        `${status} final-state expectation must forbid node and edge count changes`,
      ),
    );
  }

  for (const field of [
    "requiredNodes",
    "forbiddenNodes",
    "requiredDeletedNodes",
  ]) {
    const constraints = finalState[field];
    if (
      constraints !== undefined &&
      (!Array.isArray(constraints) ||
        constraints.some((constraint) => !validNodeConstraint(constraint)))
    ) {
      errors.push(
        issue(
          "case.expected-node-constraint",
          `${path}/${field}`,
          `${field} must contain visible-label or registered-node-type constraints`,
        ),
      );
    }
  }
  for (const field of [
    "requiredEdges",
    "forbiddenEdges",
    "requiredDeletedEdges",
  ]) {
    const constraints = finalState[field];
    if (
      constraints !== undefined &&
      (!Array.isArray(constraints) ||
        constraints.some((constraint) => !validEdgeConstraint(constraint)))
    ) {
      errors.push(
        issue(
          "case.expected-edge-constraint",
          `${path}/${field}`,
          `${field} must contain grounded endpoint constraints with optional label and occurrence`,
        ),
      );
    }
  }
}

function validNodeConstraint(constraint) {
  if (!isRecord(constraint)) return false;
  const hasLabel =
    typeof constraint.label === "string" && constraint.label.trim().length > 0;
  const hasNodeType =
    typeof constraint.nodeType === "string" &&
    VALID_NODE_TYPES.has(constraint.nodeType);
  return (
    (hasLabel || hasNodeType) &&
    (constraint.label === undefined || hasLabel) &&
    (constraint.nodeType === undefined || hasNodeType) &&
    (constraint.ordinal === undefined ||
      (Number.isInteger(constraint.ordinal) && constraint.ordinal > 0)) &&
    (constraint.x === undefined ||
      (typeof constraint.x === "number" &&
        Number.isFinite(constraint.x))) &&
    (constraint.y === undefined ||
      (typeof constraint.y === "number" &&
        Number.isFinite(constraint.y))) &&
    (constraint.positionTolerance === undefined ||
      (typeof constraint.positionTolerance === "number" &&
        Number.isFinite(constraint.positionTolerance) &&
        constraint.positionTolerance >= 0))
  );
}

function validEdgeConstraint(constraint) {
  return (
    isRecord(constraint) &&
    validNodeConstraint(constraint.from) &&
    validNodeConstraint(constraint.to) &&
    (constraint.label === undefined ||
      (typeof constraint.label === "string" &&
        constraint.label.trim().length > 0)) &&
    (constraint.occurrence === undefined ||
      (Number.isInteger(constraint.occurrence) &&
        constraint.occurrence > 0))
  );
}

function reorderBoardContext(context, reorder, variant) {
  const reordered = {
    ...structuredClone(context),
    selected: reorder(context.selected ?? []),
    objects: reorder(context.objects ?? []),
    edges: reorder(context.edges ?? []),
    projectGlossary: reorder(context.projectGlossary ?? []),
  };
  const keys = Object.keys(reordered);
  const orderedKeys =
    variant === "reverse"
      ? keys.reverse()
      : variant === "rotate-left"
        ? rotate(keys, 1)
        : variant === "rotate-right"
          ? rotate(keys, -1)
          : variant === "ends-first"
            ? interleaveEnds(keys)
            : [...keys].sort().reverse();
  return Object.fromEntries(orderedKeys.map((key) => [key, reordered[key]]));
}

function createIrrelevantObject(existingObjects, fixtureObject) {
  const capability = NODE_CAPABILITIES.get(fixtureObject.nodeType);
  const maximumOrdinal = existingObjects
    .filter(({ nodeType }) => nodeType === fixtureObject.nodeType)
    .reduce(
      (maximum, object) =>
        Math.max(maximum, Number.isInteger(object.ordinal) ? object.ordinal : 0),
      0,
    );
  return {
    label: fixtureObject.label,
    nodeType: fixtureObject.nodeType,
    ordinal: maximumOrdinal + 1,
    selected: false,
    position: { ...fixtureObject.position },
    size: { ...capability.visual.defaultSize },
  };
}

function applyOpaqueFixtureIds(scenario, namespace) {
  const prefix = `metamorphic-fixture-${namespace}`;
  const idsByReference = new Map();
  const objectId = (object, index) => {
    const reference = referenceKey(object);
    if (!idsByReference.has(reference)) {
      idsByReference.set(
        reference,
        `${prefix}-object-${slug(object.label)}-${object.ordinal ?? index + 1}`,
      );
    }
    return idsByReference.get(reference);
  };
  scenario.context.boardId = `${prefix}-board`;
  scenario.context.objects = scenario.context.objects.map((object, index) => ({
    ...object,
    id: objectId(object, index),
  }));
  scenario.context.selected = scenario.context.selected.map((object, index) => ({
    ...object,
    id: objectId(object, index),
  }));
  scenario.context.edges = scenario.context.edges.map((edge, index) => ({
    ...edge,
    id: `${prefix}-edge-${index + 1}`,
    from: {
      ...edge.from,
      id:
        idsByReference.get(referenceKey(edge.from)) ??
        `${prefix}-reference-${slug(edge.from.label)}-${edge.from.ordinal ?? 1}`,
    },
    to: {
      ...edge.to,
      id:
        idsByReference.get(referenceKey(edge.to)) ??
        `${prefix}-reference-${slug(edge.to.label)}-${edge.to.ordinal ?? 1}`,
    },
  }));
  scenario.context.projectGlossary = scenario.context.projectGlossary.map(
    (entry, index) => ({
      ...entry,
      id: `${prefix}-glossary-${index + 1}`,
    }),
  );
  if (scenario.pendingClarification) {
    scenario.pendingClarification.clarificationId =
      `${prefix}-clarification`;
  }
  scenario.transportCorrelationId = `${prefix}-turn`;
  scenario.metamorphic.syntheticIdNamespace = prefix;
}

function insertAfterWakePhrase(text, insertion) {
  const match = text.match(
    /^(\s*(?:(?:hey|okay|ok)\s+)?(?:airo|airboard|arrow)\b[\s,]*)([\s\S]*)$/iu,
  );
  return match ? `${match[1]}${insertion}${match[2]}` : `${insertion}${text}`;
}

function titleCase(text) {
  return text
    .toLocaleLowerCase("en")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en"));
}

function sentenceCase(text) {
  const lower = text.toLocaleLowerCase("en");
  const index = lower.search(/\p{L}/u);
  return index < 0
    ? lower
    : `${lower.slice(0, index)}${lower[index].toLocaleUpperCase("en")}${lower.slice(index + 1)}`;
}

function alternatingCase(text) {
  let uppercase = true;
  return [...text]
    .map((character) => {
      if (!/\p{L}/u.test(character)) return character;
      const output = uppercase
        ? character.toLocaleUpperCase("en")
        : character.toLocaleLowerCase("en");
      uppercase = !uppercase;
      return output;
    })
    .join("");
}

function rotate(values, offset) {
  if (values.length < 2) return [...values];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function interleaveEnds(values) {
  const result = [];
  let left = 0;
  let right = values.length - 1;
  while (left <= right) {
    result.push(values[right]);
    if (left !== right) result.push(values[left]);
    left += 1;
    right -= 1;
  }
  return result;
}

function scenarioId(sourceCaseId, invariant, variant) {
  return `${sourceCaseId}--meta-${invariant}-${variant}`;
}

function expectationFingerprint(expected) {
  return createHash("sha256")
    .update(stableStringify(expected))
    .digest("hex")
    .slice(0, 20);
}

function validContextReference(reference) {
  return (
    isRecord(reference) &&
    typeof reference.label === "string" &&
    reference.label.trim().length > 0 &&
    VALID_NODE_TYPES.has(reference.nodeType) &&
    (reference.ordinal === undefined ||
      (Number.isInteger(reference.ordinal) && reference.ordinal > 0))
  );
}

function referenceKey(reference) {
  return `${reference.label}\u0000${reference.nodeType}\u0000${reference.ordinal ?? ""}`;
}

function validationResult(
  corpus,
  errors,
  minimumScenarios,
  invariantCounts = countBy(
    Array.isArray(corpus?.cases)
      ? corpus.cases.map((scenario) => scenario?.metamorphic?.invariant)
      : [],
  ),
) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
  const transcriptLengths = cases
    .map(({ transcript }) =>
      typeof transcript === "string" ? transcript.length : 0,
    );
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      scenarioCount: cases.length,
      distinctRequestCount: new Set(
        cases.map((scenario) =>
          stableStringify({
            transcript: scenario?.transcript,
            parserIssue: scenario?.parserIssue,
            context: scenario?.context,
            ...(scenario?.pendingClarification
              ? { pendingClarification: scenario.pendingClarification }
              : {}),
          }),
        ),
      ).size,
      minimumScenarios,
      sourceCaseCount: corpus?.metamorphic?.sourceCaseCount ?? 0,
      maxTranscriptCharacters:
        transcriptLengths.length > 0 ? Math.max(...transcriptLengths) : 0,
      invariantCounts,
      semanticPromptVersion:
        AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION,
      semanticPlanContractVersion: AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION,
      capabilityRegistryVersion:
        AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
      productionActionTypeCount: VALID_ACTION_TYPES.size,
      productionNodeTypeCount: VALID_NODE_TYPES.size,
      expectedStatuses: countBy(
        cases.map((scenario) => scenario?.expected?.status),
      ),
      expectedActionTypes: countExpectedActionTypes(cases),
    },
  };
}

function countExpectedActionTypes(cases) {
  const counts = {};
  for (const scenario of cases) {
    for (const [actionType, count] of Object.entries(
      scenario?.expected?.actionTypeCounts ?? {},
    )) {
      counts[actionType] = (counts[actionType] ?? 0) + count;
    }
  }
  return counts;
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    if (typeof value === "string") counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

function issue(code, path, message) {
  return { code, path, message };
}

function validationError(message, validation) {
  const error = new Error(
    `${message}:\n${validation.errors
      .map(({ path, message: detail }) => `- ${path}: ${detail}`)
      .join("\n")}`,
  );
  error.name = "SemanticMetamorphicValidationError";
  error.validation = validation;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
