import {
  INTERACTION_EVAL_REPORT_SCHEMA_VERSION,
  summarizeResults,
} from "./interaction-eval-corpus.mjs";

export function buildInteractionEvalReport(input, options = {}) {
  const source = Array.isArray(input) ? { results: input } : input ?? {};
  const results = Array.isArray(source.results)
    ? source.results.map(withEvidenceProvenance)
    : [];
  const report = {
    schemaVersion:
      source.schemaVersion === INTERACTION_EVAL_REPORT_SCHEMA_VERSION
        ? source.schemaVersion
        : INTERACTION_EVAL_REPORT_SCHEMA_VERSION,
    ...(source.corpusSchemaVersion
      ? { corpusSchemaVersion: source.corpusSchemaVersion }
      : {}),
    ...(source.capabilityRegistryVersion
      ? { capabilityRegistryVersion: source.capabilityRegistryVersion }
      : {}),
    generatedAt:
      options.generatedAt ??
      source.generatedAt ??
      new Date().toISOString(),
    summary: summarizeResults(results),
    ...(source.coverage ? { coverage: source.coverage } : {}),
    ...(source.confusionMatrices
      ? { confusionMatrices: source.confusionMatrices }
      : {}),
    results,
  };
  if (options.metadata || source.metadata) {
    report.metadata = { ...(source.metadata ?? {}), ...(options.metadata ?? {}) };
  }
  return report;
}

function withEvidenceProvenance(result) {
  if (result?.evidenceProvenance) return result;
  return {
    ...result,
    evidenceProvenance: {
      class: "unspecified",
      releaseEligible: false,
      timedInput: false,
      timedInputCount: 0,
      routeObservation: "unobserved",
      outcomeObservation: "unobserved",
      components: [],
      reason:
        "The result did not declare evidence provenance and is diagnostic only.",
    },
  };
}

export function emitJsonReport(input, options = {}) {
  const report = buildInteractionEvalReport(input, options);
  return `${JSON.stringify(report, null, options.pretty === false ? 0 : 2)}\n`;
}
