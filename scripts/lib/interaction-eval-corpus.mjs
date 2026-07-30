import { readFile } from "node:fs/promises";

import {
  AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
} from "../../packages/core/dist/semanticCapabilities.js";
import {
  INTERACTION_EVAL_CASE_SCHEMA_VERSION,
  INTERACTION_EVAL_RESULT_SCHEMA_VERSION,
  evaluateInteractionCase,
} from "./interaction-eval-harness.mjs";

export const INTERACTION_EVAL_CORPUS_SCHEMA_VERSION =
  "interaction-eval-corpus.v1";
export const INTERACTION_EVAL_REPORT_SCHEMA_VERSION =
  "interaction-eval-report.v1";

export const INTERACTION_EVAL_CONTRACT_CAPABILITIES = Object.freeze([
  "contract:exact-once",
  "contract:forbidden-mutations",
  "contract:undo-round-trip",
  "interaction:clarification",
  "interaction:no-op",
  "state:non-board",
]);

const INTERACTION_CHANNELS = new Set([
  "api",
  "gesture",
  "keyboard",
  "pointer",
  "stylus",
  "catalog",
  "lifecycle",
  "remote",
  "multimodal",
  "replay",
  "touchpad",
  "typed",
  "voice",
]);

const INTERACTION_MODALITIES = new Set([
  "voice",
  "typed",
  "gesture",
  "pointer",
  "touchpad",
  "stylus",
  "keyboard",
  "catalog",
  "lifecycle",
  "remote",
  "multimodal",
]);

const INTERACTION_SURFACES = new Set([
  "standalone",
  "meet",
  "desktop",
  "browser",
  "replay",
]);

const INTERACTION_RISK_LEVELS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "destructive",
]);

const INTERACTION_OUTCOMES = new Set([
  "applied",
  "clarification",
  "error",
  "no-op",
  "rejected",
]);

export function capabilityCatalogFromRegistry(
  registry = AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY,
) {
  const actionCapabilities = Array.isArray(registry?.actions)
    ? registry.actions.map(({ actionType }) => `action:${actionType}`)
    : [];
  const nodeCapabilities = Array.isArray(registry?.nodes)
    ? registry.nodes.map(({ nodeType }) => `node:${nodeType}`)
    : [];
  return [...new Set([
    ...actionCapabilities,
    ...nodeCapabilities,
    ...INTERACTION_EVAL_CONTRACT_CAPABILITIES,
  ])].sort();
}

/**
 * Validate case shape, capability references, duplicate IDs, and declared
 * corpus coverage. The return value is report-friendly and never throws.
 */
export function validateInteractionCorpus(corpus, options = {}) {
  const errors = [];
  const warnings = [];
  const registry =
    options.capabilityRegistry ?? AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY;
  const knownCapabilities = new Set([
    ...capabilityCatalogFromRegistry(registry),
    ...(options.additionalCapabilities ?? []),
  ]);
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];

  if (!isRecord(corpus)) {
    errors.push(issue("corpus.type", "/", "Corpus must be an object"));
  } else {
    if (corpus.schemaVersion !== INTERACTION_EVAL_CORPUS_SCHEMA_VERSION) {
      errors.push(
        issue(
          "corpus.schema-version",
          "/schemaVersion",
          `Expected ${INTERACTION_EVAL_CORPUS_SCHEMA_VERSION}`,
        ),
      );
    }
    if (
      corpus.caseSchemaVersion !== undefined &&
      corpus.caseSchemaVersion !== INTERACTION_EVAL_CASE_SCHEMA_VERSION
    ) {
      errors.push(
        issue(
          "corpus.case-schema-version",
          "/caseSchemaVersion",
          `Expected ${INTERACTION_EVAL_CASE_SCHEMA_VERSION}`,
        ),
      );
    }
    if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
      errors.push(
        issue("corpus.cases", "/cases", "Corpus must contain at least one case"),
      );
    }
    if (
      corpus.capabilityRegistryVersion !== undefined &&
      registry?.version !== undefined &&
      corpus.capabilityRegistryVersion !== registry.version
    ) {
      errors.push(
        issue(
          "corpus.registry-version",
          "/capabilityRegistryVersion",
          `Corpus targets capability registry ${corpus.capabilityRegistryVersion}, current registry is ${registry.version}`,
        ),
      );
    }
  }

  const caseIds = new Set();
  const capabilityCases = new Map();
  const channelCases = new Map();
  const tagCases = new Map();
  for (const [index, evalCase] of cases.entries()) {
    const path = `/cases/${index}`;
    for (const validationIssue of validateInteractionCase(evalCase, path)) {
      errors.push(validationIssue);
    }
    if (!isRecord(evalCase)) continue;
    if (typeof evalCase.id === "string") {
      if (caseIds.has(evalCase.id)) {
        errors.push(
          issue(
            "case.duplicate-id",
            `${path}/id`,
            `Duplicate interaction eval case ID: ${evalCase.id}`,
          ),
        );
      }
      caseIds.add(evalCase.id);
    }
    for (const capability of Array.isArray(evalCase.capabilities)
      ? evalCase.capabilities
      : []) {
      addCoverage(capabilityCases, capability, evalCase.id);
      if (
        !options.allowUnknownCapabilities &&
        !knownCapabilities.has(capability)
      ) {
        errors.push(
          issue(
            "case.unknown-capability",
            `${path}/capabilities`,
            `Unknown capability reference: ${capability}`,
          ),
        );
      }
    }
    if (typeof evalCase.interaction?.channel === "string") {
      addCoverage(channelCases, evalCase.interaction.channel, evalCase.id);
    }
    for (const tag of Array.isArray(evalCase.tags) ? evalCase.tags : []) {
      addCoverage(tagCases, tag, evalCase.id);
    }
  }

  const coverageConfig = isRecord(corpus?.coverage) ? corpus.coverage : {};
  const requiredCapabilities = new Set(
    options.requireRegistryCoverage
      ? capabilityCatalogFromRegistry(registry)
      : options.requiredCapabilities ??
          coverageConfig.requiredCapabilities ??
          [],
  );
  const minCasesPerCapability =
    options.minCasesPerCapability ??
    coverageConfig.minCasesPerCapability ??
    1;
  for (const capability of requiredCapabilities) {
    const count = capabilityCases.get(capability)?.length ?? 0;
    const minimum = minimumFor(capability, minCasesPerCapability);
    if (count < minimum) {
      errors.push(
        issue(
          "coverage.capability",
          "/coverage/requiredCapabilities",
          `${capability} has ${count} case(s); ${minimum} required`,
        ),
      );
    }
  }

  const requiredChannels =
    options.requiredChannels ?? coverageConfig.requiredChannels ?? [];
  for (const channel of requiredChannels) {
    if (!channelCases.has(channel)) {
      errors.push(
        issue(
          "coverage.channel",
          "/coverage/requiredChannels",
          `No case covers interaction channel ${channel}`,
        ),
      );
    }
  }
  const requiredTags = options.requiredTags ?? coverageConfig.requiredTags ?? [];
  for (const tag of requiredTags) {
    if (!tagCases.has(tag)) {
      errors.push(
        issue(
          "coverage.tag",
          "/coverage/requiredTags",
          `No case has required tag ${tag}`,
        ),
      );
    }
  }

  const uncoveredKnownCapabilities = [...knownCapabilities].filter(
    (capability) => !capabilityCases.has(capability),
  );
  if (options.warnOnUncoveredCapabilities) {
    for (const capability of uncoveredKnownCapabilities) {
      warnings.push(
        issue(
          "coverage.uncovered-known-capability",
          "/cases",
          `Known capability has no case: ${capability}`,
        ),
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    coverage: {
      caseCount: cases.length,
      capabilities: coverageEntries(capabilityCases, requiredCapabilities),
      channels: coverageEntries(channelCases, new Set(requiredChannels)),
      tags: coverageEntries(tagCases, new Set(requiredTags)),
      requiredCapabilityCount: requiredCapabilities.size,
      coveredRequiredCapabilityCount: [...requiredCapabilities].filter(
        (capability) =>
          (capabilityCases.get(capability)?.length ?? 0) >=
          minimumFor(capability, minCasesPerCapability),
      ).length,
      uncoveredKnownCapabilities,
    },
  };
}

export function assertValidInteractionCorpus(corpus, options = {}) {
  const validation = validateInteractionCorpus(corpus, options);
  if (!validation.valid) {
    const error = new Error(
      `Invalid interaction eval corpus:\n${validation.errors
        .map(({ path, message }) => `- ${path}: ${message}`)
        .join("\n")}`,
    );
    error.name = "InteractionEvalCorpusValidationError";
    error.validation = validation;
    throw error;
  }
  return validation;
}

export async function loadInteractionCorpus(path, options = {}) {
  const corpus = JSON.parse(await readFile(path, "utf8"));
  const validation = assertValidInteractionCorpus(corpus, options);
  return { corpus, validation };
}

/**
 * Run a corpus with any executor that returns an interaction observation.
 */
export async function runInteractionCorpus(corpus, executor, options = {}) {
  if (typeof executor !== "function") {
    throw new TypeError("Interaction corpus executor must be a function");
  }
  const validation = assertValidInteractionCorpus(
    corpus,
    options.validation,
  );
  const selectedIds = options.caseIds ? new Set(options.caseIds) : null;
  const selectedCases = corpus.cases.filter(
    (evalCase) => !selectedIds || selectedIds.has(evalCase.id),
  );
  if (selectedIds) {
    const missing = [...selectedIds].filter(
      (caseId) => !corpus.cases.some((evalCase) => evalCase.id === caseId),
    );
    if (missing.length) {
      throw new Error(`Unknown interaction eval case(s): ${missing.join(", ")}`);
    }
  }

  const results = [];
  for (const evalCase of selectedCases) {
    const startedAt = performance.now();
    try {
      const observation = await executor(evalCase);
      results.push(
        evaluateInteractionCase(evalCase, {
          ...observation,
          durationMs:
            observation?.durationMs ?? Math.max(0, performance.now() - startedAt),
        }, options.evaluation),
      );
    } catch (error) {
      results.push(createErrorResult(evalCase, error, performance.now() - startedAt));
      if (options.failFast) break;
    }
  }

  return {
    schemaVersion: INTERACTION_EVAL_REPORT_SCHEMA_VERSION,
    corpusSchemaVersion: corpus.schemaVersion,
    capabilityRegistryVersion:
      corpus.capabilityRegistryVersion ??
      AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY.version,
    summary: summarizeResults(results),
    coverage: validation.coverage,
    results,
  };
}

export function summarizeResults(results) {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    durationMs: 0,
  };
  for (const result of results) {
    if (result.status === "passed") summary.passed += 1;
    else if (result.status === "failed") summary.failed += 1;
    else if (result.status === "error") summary.errors += 1;
    else if (result.status === "skipped") summary.skipped += 1;
    summary.durationMs += Number.isFinite(result.durationMs)
      ? result.durationMs
      : 0;
  }
  summary.passRate =
    summary.total === 0 ? 0 : summary.passed / summary.total;
  return summary;
}

function validateInteractionCase(evalCase, path) {
  if (!isRecord(evalCase)) {
    return [issue("case.type", path, "Interaction eval case must be an object")];
  }
  const errors = [];
  if (evalCase.schemaVersion !== INTERACTION_EVAL_CASE_SCHEMA_VERSION) {
    errors.push(
      issue(
        "case.schema-version",
        `${path}/schemaVersion`,
        `Expected ${INTERACTION_EVAL_CASE_SCHEMA_VERSION}`,
      ),
    );
  }
  if (!isNonEmptyString(evalCase.id)) {
    errors.push(issue("case.id", `${path}/id`, "Case ID is required"));
  } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(evalCase.id)) {
    errors.push(
      issue(
        "case.id-format",
        `${path}/id`,
        "Case ID must use lowercase letters, digits, dots, underscores, or hyphens",
      ),
    );
  }
  if (!isNonEmptyString(evalCase.title)) {
    errors.push(issue("case.title", `${path}/title`, "Case title is required"));
  }
  if (!isNonEmptyString(evalCase.corpusVersion)) {
    errors.push(
      issue(
        "case.corpus-version",
        `${path}/corpusVersion`,
        "Corpus version is required",
      ),
    );
  }
  if (!INTERACTION_MODALITIES.has(evalCase.modality)) {
    errors.push(
      issue("case.modality", `${path}/modality`, "Known modality is required"),
    );
  }
  if (!INTERACTION_SURFACES.has(evalCase.surface)) {
    errors.push(
      issue("case.surface", `${path}/surface`, "Known surface is required"),
    );
  }
  if (!INTERACTION_RISK_LEVELS.has(evalCase.riskLevel)) {
    errors.push(
      issue(
        "case.risk-level",
        `${path}/riskLevel`,
        "Known risk level is required",
      ),
    );
  }
  if (
    typeof evalCase.datasetAssetHash !== "string" ||
    !/^(?:sha256:[a-f0-9]{64}|none)$/.test(evalCase.datasetAssetHash)
  ) {
    errors.push(
      issue(
        "case.dataset-asset-hash",
        `${path}/datasetAssetHash`,
        "Dataset asset hash must be none or sha256:<64 lowercase hex>",
      ),
    );
  }
  if (
    !Array.isArray(evalCase.capabilities) ||
    evalCase.capabilities.length === 0 ||
    evalCase.capabilities.some(
      (capability) =>
        !isNonEmptyString(capability) ||
        !/^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/.test(capability),
    )
  ) {
    errors.push(
      issue(
        "case.capabilities",
        `${path}/capabilities`,
        "At least one capability is required",
      ),
    );
  }
  if (
    Array.isArray(evalCase.capabilities) &&
    new Set(evalCase.capabilities).size !== evalCase.capabilities.length
  ) {
    errors.push(
      issue(
        "case.duplicate-capability",
        `${path}/capabilities`,
        "Capability references must be unique within a case",
      ),
    );
  }
  if (
    !isRecord(evalCase.interaction) ||
    !INTERACTION_CHANNELS.has(evalCase.interaction.channel) ||
    !Object.prototype.hasOwnProperty.call(evalCase.interaction, "input")
  ) {
    errors.push(
      issue(
        "case.interaction",
        `${path}/interaction`,
        "Interaction requires channel and input",
      ),
    );
  }
  if (
    !isRecord(evalCase.expected) ||
    !INTERACTION_OUTCOMES.has(evalCase.expected.outcome)
  ) {
    errors.push(
      issue(
        "case.expected",
        `${path}/expected`,
        "Expected outcome is required",
      ),
    );
  }
  return errors;
}

function createErrorResult(evalCase, error, durationMs) {
  const normalizedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        }
      : { name: "Error", message: String(error) };
  return {
    schemaVersion: INTERACTION_EVAL_RESULT_SCHEMA_VERSION,
    caseId: evalCase.id,
    title: evalCase.title,
    status: "error",
    durationMs: Math.max(0, durationMs),
    capabilities: [...(evalCase.capabilities ?? [])],
    checks: [],
    evidenceProvenance: {
      class: "executor-error",
      releaseEligible: false,
      timedInput: false,
      timedInputCount: 0,
      routeObservation: "unobserved",
      outcomeObservation: "unobserved",
      components: [],
      reason:
        "The interaction executor failed before production-route evidence could be observed.",
    },
    error: normalizedError,
  };
}

function coverageEntries(coverageMap, required = new Set()) {
  return Object.fromEntries(
    [...new Set([...coverageMap.keys(), ...required])]
      .sort()
      .map((key) => [
        key,
        {
          count: coverageMap.get(key)?.length ?? 0,
          caseIds: coverageMap.get(key) ?? [],
          required: required.has(key),
        },
      ]),
  );
}

function addCoverage(map, key, caseId) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(caseId);
}

function minimumFor(capability, config) {
  if (Number.isInteger(config)) return Math.max(0, config);
  if (isRecord(config) && Number.isInteger(config[capability])) {
    return Math.max(0, config[capability]);
  }
  if (isRecord(config) && Number.isInteger(config.default)) {
    return Math.max(0, config.default);
  }
  return 1;
}

function issue(code, path, message) {
  return { code, path, message };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
