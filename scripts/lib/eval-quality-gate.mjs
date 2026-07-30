import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const QUALITY_GATE_CONFIG_SCHEMA =
  "airboard-quality-gate-config.v1";
export const BLESSED_BASELINE_ARTIFACT_SCHEMA =
  "airboard-blessed-baseline-artifact.v1";
export const QUALITY_REPORT_SCHEMA = "airboard-quality-report.v1";
export const QUALITY_GATE_RESULT_SCHEMA =
  "airboard-quality-gate-result.v1";

const NUMBER_EPSILON = 1e-12;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const PATH_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const UNSAFE_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const SUPPORTED_OPERATORS = new Set(["eq", "gte", "lte", "gt", "lt"]);
const SUPPORTED_BASELINE_KINDS = new Set([
  "relative_max",
  "critical_slice_absolute_drop",
]);
const FRACTION_METRICS = new Set([
  "contract.passRate",
  "safety.passRate",
  "atomicity.passRate",
  "undo.passRate",
  "semantic.coreAccuracy",
  "semantic.overallAccuracy",
  "gesture.precision",
  "gesture.recall",
  "gesture.duplicateRate",
  "stt.criticalTokenRecall",
]);
const INTEGER_METRICS = new Set([
  "gesture.criticalFalseTriggerCount",
  "ambient.actionCount",
]);
const BLESSED_BASELINE_DIGESTS = new Map([
  [
    "airboard-blessed-baseline.v1",
    "1f64952cd0119aea548bd2a1dfc4bbd28431aad1b70f51ba0195c5d0fe2148cb",
  ],
  [
    "airboard-blessed-baseline.v2",
    "ffe21393e153ff0113625056684533a668f65b247c56844dd63845e313228ddc",
  ],
]);
const BLESSED_BASELINE_ARTIFACT_PINS = new Map([
  [
    "airboard-blessed-baseline.v2",
    {
      artifactPath: "blessed-baseline.v2.json",
      artifactSha256:
        "b1b69bc1c92aae1defb07acb9adf257ad401c4372e47c32c2e865e3a70e813a3",
    },
  ],
]);

const REQUIRED_ABSOLUTE_GATES = [
  gateContract("contract-pass-rate", "contract.passRate", "gte", 1),
  gateContract("safety-pass-rate", "safety.passRate", "gte", 1),
  gateContract("atomicity-pass-rate", "atomicity.passRate", "gte", 1),
  gateContract("undo-pass-rate", "undo.passRate", "gte", 1),
  gateContract(
    "semantic-core-accuracy",
    "semantic.coreAccuracy",
    "gte",
    0.95,
  ),
  gateContract(
    "semantic-overall-accuracy",
    "semantic.overallAccuracy",
    "gte",
    0.9,
  ),
  gateContract("gesture-precision", "gesture.precision", "gte", 0.95),
  gateContract("gesture-recall", "gesture.recall", "gte", 0.9),
  gateContract(
    "gesture-duplicate-rate",
    "gesture.duplicateRate",
    "lt",
    0.01,
  ),
  gateContract(
    "gesture-critical-false-triggers",
    "gesture.criticalFalseTriggerCount",
    "eq",
    0,
  ),
  gateContract(
    "gesture-acquire-latency-p95",
    "gesture.acquireLatencyP95Ms",
    "lte",
    500,
  ),
  gateContract(
    "gesture-release-latency-p95",
    "gesture.releaseLatencyP95Ms",
    "lte",
    300,
  ),
  gateContract(
    "gesture-frame-processing-p95",
    "gesture.frameProcessingP95Ms",
    "lte",
    33.34,
  ),
  gateContract(
    "stt-critical-token-recall",
    "stt.criticalTokenRecall",
    "gte",
    0.97,
  ),
  gateContract(
    "deterministic-end-to-action-p95",
    "latency.deterministicEndToActionP95Ms",
    "lt",
    1_000,
  ),
  gateContract(
    "semantic-end-to-action-p95",
    "latency.semanticEndToActionP95Ms",
    "lt",
    2_500,
  ),
  gateContract(
    "ambient-action-count",
    "ambient.actionCount",
    "eq",
    0,
  ),
  gateContract(
    "ambient-observed-hours",
    "ambient.observedHours",
    "gte",
    30,
  ),
];

const REQUIRED_SLICE_GATES = [
  {
    id: "semantic-slice-floor",
    metric: "semantic.slices",
    scoreField: "accuracy",
    operator: "gte",
    threshold: 0.85,
    requiredSliceIds: [
      "clarification",
      "compound_commands",
      "indian_english",
      "non_board_speech",
    ],
  },
  {
    id: "gesture-slice-floor",
    metric: "gesture.slices",
    scoreField: "score",
    operator: "gte",
    threshold: 0.85,
    requiredSliceIds: [
      "core_lighting",
      "low_light",
      "tracking_loss",
      "two_hand",
    ],
  },
];

const REQUIRED_BASELINE_GATES = [
  {
    id: "cost-per-success-regression",
    kind: "relative_max",
    metric: "cost.costPerSuccessUsd",
    maximumRegression: 0.1,
  },
  {
    id: "semantic-critical-slice-regression",
    kind: "critical_slice_absolute_drop",
    metric: "semantic.slices",
    scoreField: "accuracy",
    criticalField: "critical",
    criticalSliceIds: [
      "clarification",
      "indian_english",
      "non_board_speech",
    ],
    maximumRegression: 0.03,
  },
  {
    id: "gesture-critical-slice-regression",
    kind: "critical_slice_absolute_drop",
    metric: "gesture.slices",
    scoreField: "score",
    criticalField: "critical",
    criticalSliceIds: ["low_light", "tracking_loss", "two_hand"],
    maximumRegression: 0.03,
  },
];

const REQUIRED_RELEASE_METRICS = new Set([
  ...REQUIRED_ABSOLUTE_GATES.map(({ metric }) => metric),
  ...REQUIRED_SLICE_GATES.map(({ metric }) => metric),
  ...REQUIRED_BASELINE_GATES.map(({ metric }) => metric),
]);

export class QualityGateConfigError extends Error {
  constructor(problems) {
    super(
      `Quality-gate config is invalid:\n${problems
        .map((problem) => `- ${problem}`)
        .join("\n")}`,
    );
    this.name = "QualityGateConfigError";
    this.code = "QUALITY_GATE_CONFIG_INVALID";
    this.problems = problems;
  }
}

export async function loadQualityGateConfig(path) {
  const absolutePath = resolve(path);
  let config;
  try {
    config = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new QualityGateConfigError([
      `could not read ${absolutePath}: ${describeError(error)}`,
    ]);
  }
  assertValidQualityGateConfig(config);
  await assertBlessedBaselineArtifact(config, absolutePath);
  return config;
}

async function assertBlessedBaselineArtifact(config, configPath) {
  const baseline = config.blessedBaseline;
  const artifactPath = resolve(dirname(configPath), baseline.artifactPath);
  let artifact;
  try {
    artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  } catch (error) {
    throw new QualityGateConfigError([
      `could not read blessed baseline artifact ${artifactPath}: ${describeError(
        error,
      )}`,
    ]);
  }

  const problems = [];
  const artifactDigest = canonicalSha256(artifact);
  if (artifactDigest === null) {
    problems.push(
      "blessed baseline artifact must contain only canonical JSON values",
    );
  } else if (artifactDigest !== baseline.artifactSha256) {
    problems.push(
      `blessed baseline artifact digest ${artifactDigest} does not match configured ${baseline.artifactSha256}`,
    );
  }

  const pin = BLESSED_BASELINE_ARTIFACT_PINS.get(baseline.version);
  if (
    !pin ||
    pin.artifactPath !== baseline.artifactPath ||
    pin.artifactSha256 !== artifactDigest
  ) {
    problems.push(
      `blessed baseline artifact is not pinned for ${baseline.version}`,
    );
  }
  if (!isRecord(artifact)) {
    problems.push("blessed baseline artifact must be an object");
  } else {
    if (artifact.schemaVersion !== BLESSED_BASELINE_ARTIFACT_SCHEMA) {
      problems.push(
        `blessed baseline artifact schemaVersion must be ${BLESSED_BASELINE_ARTIFACT_SCHEMA}`,
      );
    }
    if (artifact.baselineVersion !== baseline.version) {
      problems.push(
        `blessed baseline artifact version ${String(
          artifact.baselineVersion,
        )} does not match configured ${baseline.version}`,
      );
    }
    if (artifact.metricsSha256 !== baseline.metricsSha256) {
      problems.push(
        "blessed baseline artifact metricsSha256 does not match the configured baseline",
      );
    }
    const artifactMetricsDigest = canonicalSha256(artifact.metrics);
    if (artifactMetricsDigest !== baseline.metricsSha256) {
      problems.push(
        `blessed baseline artifact metrics do not match digest ${baseline.metricsSha256}`,
      );
    }
    if (artifactMetricsDigest !== canonicalSha256(baseline.metrics)) {
      problems.push(
        "blessed baseline artifact metrics do not match the configured inline reference",
      );
    }
    if (
      canonicalSha256(artifact.provenance) !==
      canonicalSha256(baseline.provenance)
    ) {
      problems.push(
        "blessed baseline artifact provenance does not match the configured provenance",
      );
    }

    const binding = artifact.configurationBinding;
    if (!isRecord(binding)) {
      problems.push(
        "blessed baseline artifact configurationBinding must be an object",
      );
    } else {
      if (binding.configVersion !== config.configVersion) {
        problems.push(
          `blessed baseline artifact configVersion ${String(
            binding.configVersion,
          )} does not match ${config.configVersion}`,
        );
      }
      if (binding.reportSchemaVersion !== config.reportSchemaVersion) {
        problems.push(
          `blessed baseline artifact reportSchemaVersion ${String(
            binding.reportSchemaVersion,
          )} does not match ${config.reportSchemaVersion}`,
        );
      }
      const policyDigest = canonicalSha256(config.releasePolicy);
      if (binding.releasePolicySha256 !== policyDigest) {
        problems.push(
          `blessed baseline artifact releasePolicySha256 must match configured policy digest ${policyDigest}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new QualityGateConfigError(problems);
  }
}

export function validateQualityGateConfig(config) {
  const problems = [];
  if (!isRecord(config)) {
    return {
      valid: false,
      problems: ["config must be a JSON object"],
    };
  }
  if (config.schemaVersion !== QUALITY_GATE_CONFIG_SCHEMA) {
    problems.push(`schemaVersion must be ${QUALITY_GATE_CONFIG_SCHEMA}`);
  }
  if (!isNonEmptyString(config.configVersion)) {
    problems.push("configVersion must be a non-empty string");
  }
  if (config.reportSchemaVersion !== QUALITY_REPORT_SCHEMA) {
    problems.push(`reportSchemaVersion must be ${QUALITY_REPORT_SCHEMA}`);
  }

  const baseline = config.blessedBaseline;
  if (!isRecord(baseline)) {
    problems.push("blessedBaseline must be an object");
  } else {
    if (!isNonEmptyString(baseline.version)) {
      problems.push("blessedBaseline.version must be a non-empty string");
    }
    if (!/^[a-f0-9]{64}$/u.test(baseline.metricsSha256 ?? "")) {
      problems.push(
        "blessedBaseline.metricsSha256 must be a lowercase SHA-256 digest",
      );
    }
    if (
      !/^[a-z0-9][a-z0-9._-]*\.json$/u.test(
        baseline.artifactPath ?? "",
      )
    ) {
      problems.push(
        "blessedBaseline.artifactPath must be a safe sibling JSON filename",
      );
    }
    if (!/^[a-f0-9]{64}$/u.test(baseline.artifactSha256 ?? "")) {
      problems.push(
        "blessedBaseline.artifactSha256 must be a lowercase SHA-256 digest",
      );
    }
    if (!isRecord(baseline.metrics)) {
      problems.push("blessedBaseline.metrics must be an object");
    } else {
      for (const problem of metricRepresentationProblems(baseline.metrics)) {
        problems.push(`blessedBaseline.metrics ${problem}`);
      }
      const actualDigest = canonicalSha256(baseline.metrics);
      if (actualDigest === null) {
        problems.push(
          "blessedBaseline.metrics must contain only canonical JSON values",
        );
      } else if (baseline.metricsSha256 !== actualDigest) {
        problems.push(
          `blessedBaseline.metricsSha256 must match canonical metrics digest ${actualDigest}`,
        );
      }
      const pinnedDigest = BLESSED_BASELINE_DIGESTS.get(baseline.version);
      if (!pinnedDigest) {
        problems.push(
          `blessedBaseline.version ${String(
            baseline.version,
          )} is not pinned by this evaluator`,
        );
      } else if (baseline.metricsSha256 !== pinnedDigest) {
        problems.push(
          `blessedBaseline.version ${baseline.version} must use pinned digest ${pinnedDigest}`,
        );
      }
    }
    const artifactPin = BLESSED_BASELINE_ARTIFACT_PINS.get(
      baseline.version,
    );
    if (!artifactPin) {
      problems.push(
        `blessedBaseline.version ${String(
          baseline.version,
        )} has no pinned reference artifact`,
      );
    } else {
      if (baseline.artifactPath !== artifactPin.artifactPath) {
        problems.push(
          `blessedBaseline.version ${baseline.version} must use artifact ${artifactPin.artifactPath}`,
        );
      }
      if (baseline.artifactSha256 !== artifactPin.artifactSha256) {
        problems.push(
          `blessedBaseline.version ${baseline.version} must use pinned artifact digest ${artifactPin.artifactSha256}`,
        );
      }
    }
    if (!isRecord(baseline.provenance)) {
      problems.push("blessedBaseline.provenance must be an object");
    } else {
      if (baseline.provenance.kind !== "versioned_policy_reference") {
        problems.push(
          "blessedBaseline.provenance.kind must be versioned_policy_reference",
        );
      }
      if (
        baseline.provenance.evidenceArtifact !== baseline.artifactPath
      ) {
        problems.push(
          "blessedBaseline.provenance.evidenceArtifact must match artifactPath",
        );
      }
      if (baseline.provenance.assertsMediaAvailability !== false) {
        problems.push(
          "blessedBaseline.provenance.assertsMediaAvailability must be false",
        );
      }
      if (baseline.provenance.assertsEvaluationEvidence !== false) {
        problems.push(
          "blessedBaseline.provenance.assertsEvaluationEvidence must be false",
        );
      }
    }
  }

  const policy = config.releasePolicy;
  if (!isRecord(policy)) {
    problems.push("releasePolicy must be an object");
    return { valid: problems.length === 0, problems };
  }

  validateRequiredMetrics(policy.requiredMetrics, problems);
  validateGateArrays(policy, problems);
  if (isRecord(baseline?.metrics)) {
    validateBaselineInputs(policy, baseline.metrics, problems);
  }

  return { valid: problems.length === 0, problems };
}

export function assertValidQualityGateConfig(config) {
  const validation = validateQualityGateConfig(config);
  if (!validation.valid) {
    throw new QualityGateConfigError(validation.problems);
  }
  return config;
}

/**
 * Evaluate a provider-neutral, normalized metric report.
 *
 * `report.metrics` may be nested objects or a flat map of dotted paths.
 * Slice collections may be objects, arrays with `id`, or flat dotted entries.
 * Release mode fails on absent metrics/slices. PR mode may omit the report
 * entirely, in which case this validates policy only and makes no evidence or
 * media-availability claim.
 */
export function evaluateQualityGate({
  config,
  report = null,
  mode = "release",
}) {
  assertValidQualityGateConfig(config);
  if (!["pr", "release"].includes(mode)) {
    throw new TypeError(`mode must be "pr" or "release"; received ${mode}`);
  }

  const common = {
    schemaVersion: QUALITY_GATE_RESULT_SCHEMA,
    mode,
    configVersion: config.configVersion,
    baselineVersion: config.blessedBaseline.version,
    baselineArtifactPath: config.blessedBaseline.artifactPath,
    baselineArtifactSha256: config.blessedBaseline.artifactSha256,
    baselineMetricsSha256: config.blessedBaseline.metricsSha256,
    expectedReportSchemaVersion: config.reportSchemaVersion,
    reportSchemaVersion: isRecord(report) ? report.schemaVersion ?? null : null,
    reportProvided: report !== null && report !== undefined,
  };

  if ((report === null || report === undefined) && mode === "pr") {
    const gates = skippedPolicyGates(
      config.releasePolicy,
      "config_only",
      mode,
    );
    return finishResult(common, gates, {
      status: "config_validated",
      evaluationPerformed: false,
      evidenceAvailability: "not_asserted",
      reportAvailability: "not_supplied",
      reportCoverage: "none",
    });
  }

  if (report === null || report === undefined) {
    const gates = [
      ...missingRequiredMetricResults(config.releasePolicy.requiredMetrics),
      ...skippedPolicyGates(
        config.releasePolicy,
        "report_missing",
        mode,
      ),
    ];
    return finishResult(common, gates, {
      status: "failed",
      evaluationPerformed: false,
      evidenceAvailability: "not_asserted",
      reportAvailability: "missing",
      reportCoverage: "none",
    });
  }

  if (!isRecord(report) || !isRecord(report.metrics)) {
    return finishResult(
      common,
      [
        failedGate({
          id: "report-shape",
          group: "report",
          code: "invalid_report",
          message: "report must be an object with a metrics object",
        }),
        ...skippedPolicyGates(
          config.releasePolicy,
          "invalid_report",
          mode,
        ),
      ],
      {
        status: "failed",
        evaluationPerformed: false,
        evidenceAvailability: "not_asserted",
        reportAvailability: "invalid",
        reportCoverage: "invalid",
      },
    );
  }

  const representationProblems = metricRepresentationProblems(report.metrics);
  if (representationProblems.length > 0) {
    return finishResult(
      common,
      [
        failedGate({
          id: "report-representation",
          group: "report",
          code: "ambiguous_metric_representation",
          message: `report metrics mix overlapping nested/dotted representations: ${representationProblems.join(
            "; ",
          )}`,
        }),
        ...skippedPolicyGates(
          config.releasePolicy,
          "ambiguous_report",
          mode,
        ),
      ],
      {
        status: "failed",
        evaluationPerformed: false,
        evidenceAvailability: "not_asserted",
        reportAvailability: "invalid",
        reportCoverage: "invalid",
      },
    );
  }

  const gates = [];
  if (report.schemaVersion !== config.reportSchemaVersion) {
    gates.push(
      failedGate({
        id: "report-schema",
        group: "report",
        code: "report_schema_mismatch",
        expected: config.reportSchemaVersion,
        observed: report.schemaVersion ?? null,
        message: `report schema must be ${config.reportSchemaVersion}`,
      }),
    );
  }

  if (mode === "release") {
    for (const path of config.releasePolicy.requiredMetrics) {
      if (!metricOrCollectionExists(report.metrics, path)) {
        gates.push(missingRequiredMetricResult(path));
      }
    }
  }

  for (const gate of config.releasePolicy.absoluteGates) {
    gates.push(evaluateAbsoluteGate(gate, report.metrics, mode));
  }
  for (const gate of config.releasePolicy.sliceGates) {
    gates.push(...evaluateSliceGate(gate, report.metrics, mode));
  }
  for (const gate of config.releasePolicy.baselineGates) {
    gates.push(
      ...evaluateBaselineGate(
        gate,
        report.metrics,
        config.blessedBaseline.metrics,
        mode,
      ),
    );
  }

  const failed = gates.some(({ status }) => status === "failed");
  const evaluatedCount = gates.filter(
    ({ status: gateStatus }) => gateStatus !== "skipped",
  ).length;
  const reportCoverage = releaseReportCoverage(
    config.releasePolicy,
    report.metrics,
  );
  if (mode === "pr" && !failed && evaluatedCount === 0) {
    return finishResult(common, gates, {
      status: "config_validated",
      evaluationPerformed: false,
      evidenceAvailability: "not_asserted",
      reportAvailability: "supplied",
      reportCoverage,
    });
  }
  return finishResult(common, gates, {
    status: failed ? "failed" : "passed",
    evaluationPerformed: evaluatedCount > 0,
    evidenceAvailability: "not_asserted",
    reportAvailability: "supplied",
    reportCoverage,
  });
}

function validateRequiredMetrics(requiredMetrics, problems) {
  if (!Array.isArray(requiredMetrics)) {
    problems.push("releasePolicy.requiredMetrics must be an array");
    return;
  }
  const seen = new Set();
  for (const [index, path] of requiredMetrics.entries()) {
    if (!isMetricPath(path)) {
      problems.push(`releasePolicy.requiredMetrics[${index}] is not a safe path`);
      continue;
    }
    if (seen.has(path)) {
      problems.push(`releasePolicy.requiredMetrics repeats ${path}`);
    }
    seen.add(path);
  }
  for (const path of REQUIRED_RELEASE_METRICS) {
    if (!seen.has(path)) {
      problems.push(`releasePolicy.requiredMetrics must include ${path}`);
    }
  }
}

function validateGateArrays(policy, problems) {
  for (const key of ["absoluteGates", "sliceGates", "baselineGates"]) {
    if (!Array.isArray(policy[key])) {
      problems.push(`releasePolicy.${key} must be an array`);
    }
  }
  if (
    !Array.isArray(policy.absoluteGates) ||
    !Array.isArray(policy.sliceGates) ||
    !Array.isArray(policy.baselineGates)
  ) {
    return;
  }

  const ids = new Set();
  for (const [index, gate] of policy.absoluteGates.entries()) {
    validateGateIdentity(gate, `absoluteGates[${index}]`, ids, problems);
    if (!isRecord(gate)) continue;
    if (!isMetricPath(gate.metric)) {
      problems.push(`absoluteGates[${index}].metric is not a safe path`);
    }
    if (!SUPPORTED_OPERATORS.has(gate.operator)) {
      problems.push(`absoluteGates[${index}].operator is unsupported`);
    }
    if (!Number.isFinite(gate.threshold)) {
      problems.push(`absoluteGates[${index}].threshold must be finite`);
    }
  }
  for (const [index, gate] of policy.sliceGates.entries()) {
    validateGateIdentity(gate, `sliceGates[${index}]`, ids, problems);
    if (!isRecord(gate)) continue;
    if (!isMetricPath(gate.metric)) {
      problems.push(`sliceGates[${index}].metric is not a safe path`);
    }
    if (!PATH_SEGMENT_PATTERN.test(gate.scoreField ?? "")) {
      problems.push(`sliceGates[${index}].scoreField is invalid`);
    }
    if (!SUPPORTED_OPERATORS.has(gate.operator)) {
      problems.push(`sliceGates[${index}].operator is unsupported`);
    }
    if (!Number.isFinite(gate.threshold)) {
      problems.push(`sliceGates[${index}].threshold must be finite`);
    }
    if (
      !Array.isArray(gate.requiredSliceIds) ||
      gate.requiredSliceIds.length === 0
    ) {
      problems.push(
        `sliceGates[${index}].requiredSliceIds must be a non-empty array`,
      );
    } else {
      const sliceIds = new Set();
      for (const sliceId of gate.requiredSliceIds) {
        if (!SAFE_ID_PATTERN.test(sliceId ?? "")) {
          problems.push(
            `sliceGates[${index}] has invalid required slice ${String(sliceId)}`,
          );
        } else if (sliceIds.has(sliceId)) {
          problems.push(
            `sliceGates[${index}] repeats required slice ${sliceId}`,
          );
        }
        sliceIds.add(sliceId);
      }
    }
  }
  for (const [index, gate] of policy.baselineGates.entries()) {
    validateGateIdentity(gate, `baselineGates[${index}]`, ids, problems);
    if (!isRecord(gate)) continue;
    if (!SUPPORTED_BASELINE_KINDS.has(gate.kind)) {
      problems.push(`baselineGates[${index}].kind is unsupported`);
    }
    if (!isMetricPath(gate.metric)) {
      problems.push(`baselineGates[${index}].metric is not a safe path`);
    }
    if (
      !Number.isFinite(gate.maximumRegression) ||
      gate.maximumRegression < 0
    ) {
      problems.push(
        `baselineGates[${index}].maximumRegression must be non-negative and finite`,
      );
    }
    if (gate.kind === "critical_slice_absolute_drop") {
      if (!PATH_SEGMENT_PATTERN.test(gate.scoreField ?? "")) {
        problems.push(`baselineGates[${index}].scoreField is invalid`);
      }
      if (!PATH_SEGMENT_PATTERN.test(gate.criticalField ?? "")) {
        problems.push(`baselineGates[${index}].criticalField is invalid`);
      }
      if (
        !Array.isArray(gate.criticalSliceIds) ||
        gate.criticalSliceIds.length === 0 ||
        new Set(gate.criticalSliceIds).size !== gate.criticalSliceIds.length ||
        gate.criticalSliceIds.some(
          (sliceId) => !SAFE_ID_PATTERN.test(sliceId ?? ""),
        )
      ) {
        problems.push(
          `baselineGates[${index}].criticalSliceIds must be a non-empty unique list of safe ids`,
        );
      }
    }
  }

  for (const required of REQUIRED_ABSOLUTE_GATES) {
    validateAbsolutePolicyContract(policy.absoluteGates, required, problems);
  }
  for (const required of REQUIRED_SLICE_GATES) {
    validateSlicePolicyContract(policy.sliceGates, required, problems);
  }
  for (const required of REQUIRED_BASELINE_GATES) {
    validateBaselinePolicyContract(policy.baselineGates, required, problems);
  }
}

function validateGateIdentity(gate, label, ids, problems) {
  if (!isRecord(gate)) {
    problems.push(`${label} must be an object`);
    return;
  }
  if (!SAFE_ID_PATTERN.test(gate.id ?? "")) {
    problems.push(`${label}.id is invalid`);
    return;
  }
  if (ids.has(gate.id)) problems.push(`gate id ${gate.id} is duplicated`);
  ids.add(gate.id);
}

function validateAbsolutePolicyContract(gates, required, problems) {
  const gate = gates.find(({ id }) => id === required.id);
  if (!gate) {
    problems.push(`release policy is missing gate ${required.id}`);
    return;
  }
  if (gate.metric !== required.metric || gate.operator !== required.operator) {
    problems.push(
      `${required.id} must evaluate ${required.metric} with ${required.operator}`,
    );
    return;
  }
  if (!isAtLeastAsStrict(gate.operator, gate.threshold, required.threshold)) {
    problems.push(
      `${required.id} threshold ${gate.threshold} weakens required ${required.threshold}`,
    );
  }
  if (
    FRACTION_METRICS.has(gate.metric) &&
    (gate.threshold < 0 || gate.threshold > 1)
  ) {
    problems.push(`${required.id} threshold must be from 0 to 1`);
  }
}

function validateSlicePolicyContract(gates, required, problems) {
  const gate = gates.find(({ id }) => id === required.id);
  if (!gate) {
    problems.push(`release policy is missing gate ${required.id}`);
    return;
  }
  if (
    gate.metric !== required.metric ||
    gate.scoreField !== required.scoreField ||
    gate.operator !== required.operator
  ) {
    problems.push(
      `${required.id} must evaluate ${required.metric}.${required.scoreField} with ${required.operator}`,
    );
  }
  if (!isAtLeastAsStrict("gte", gate.threshold, required.threshold)) {
    problems.push(
      `${required.id} threshold ${gate.threshold} weakens required ${required.threshold}`,
    );
  }
  if (gate.threshold < 0 || gate.threshold > 1) {
    problems.push(`${required.id} threshold must be from 0 to 1`);
  }
  const configuredSliceIds = new Set(gate.requiredSliceIds ?? []);
  for (const sliceId of required.requiredSliceIds) {
    if (!configuredSliceIds.has(sliceId)) {
      problems.push(`${required.id} must require pinned slice ${sliceId}`);
    }
  }
}

function validateBaselinePolicyContract(gates, required, problems) {
  const gate = gates.find(({ id }) => id === required.id);
  if (!gate) {
    problems.push(`release policy is missing gate ${required.id}`);
    return;
  }
  for (const key of ["kind", "metric", "scoreField", "criticalField"]) {
    if (required[key] !== undefined && gate[key] !== required[key]) {
      problems.push(`${required.id}.${key} must be ${required[key]}`);
    }
  }
  if (gate.maximumRegression > required.maximumRegression) {
    problems.push(
      `${required.id} maximumRegression ${gate.maximumRegression} weakens required ${required.maximumRegression}`,
    );
  }
  if (required.criticalSliceIds) {
    const configured = new Set(gate.criticalSliceIds ?? []);
    if (
      configured.size !== required.criticalSliceIds.length ||
      required.criticalSliceIds.some((sliceId) => !configured.has(sliceId))
    ) {
      problems.push(
        `${required.id}.criticalSliceIds must match pinned critical slices ${required.criticalSliceIds.join(
          ", ",
        )}`,
      );
    }
  }
}

function validateBaselineInputs(policy, baselineMetrics, problems) {
  for (const gate of policy.absoluteGates ?? []) {
    const reading = readNumericMetric(baselineMetrics, gate.metric);
    if (!reading.found || !reading.valid) {
      problems.push(`blessed baseline is missing numeric ${gate.metric}`);
      continue;
    }
    const domainProblem = metricDomainProblem(gate.metric, reading.value);
    if (domainProblem) {
      problems.push(`blessed baseline ${gate.metric} ${domainProblem}`);
    } else if (!compare(reading.value, gate.operator, gate.threshold)) {
      problems.push(
        `blessed baseline ${gate.metric} does not pass gate ${gate.id}`,
      );
    }
  }

  for (const gate of policy.sliceGates ?? []) {
    const slices = readSliceCollection(baselineMetrics, gate.metric);
    if (!slices.found || !slices.valid) {
      problems.push(`blessed baseline is missing slice collection ${gate.metric}`);
      continue;
    }
    for (const sliceId of gate.requiredSliceIds ?? []) {
      const score = sliceScore(slices.entries.get(sliceId), gate.scoreField);
      if (!score.found || !score.valid) {
        problems.push(
          `blessed baseline is missing numeric ${gate.metric}.${sliceId}.${gate.scoreField}`,
        );
      } else if (
        score.value < 0 ||
        score.value > 1 ||
        !compare(score.value, gate.operator, gate.threshold)
      ) {
        problems.push(
          `blessed baseline ${gate.metric}.${sliceId}.${gate.scoreField} does not pass ${gate.id}`,
        );
      }
    }
  }

  for (const gate of policy.baselineGates ?? []) {
    if (gate.kind === "relative_max") {
      const reading = readNumericMetric(baselineMetrics, gate.metric);
      if (!reading.found || !reading.valid || reading.value <= 0) {
        problems.push(
          `blessed baseline ${gate.metric} must be a positive finite number`,
        );
      }
      continue;
    }
    if (gate.kind === "critical_slice_absolute_drop") {
      const slices = readSliceCollection(baselineMetrics, gate.metric);
      if (!slices.found || !slices.valid) {
        problems.push(
          `blessed baseline is missing slice collection ${gate.metric}`,
        );
        continue;
      }
      const criticalIds = new Set(gate.criticalSliceIds ?? []);
      const sliceFloor = policy.sliceGates?.find(
        ({ metric }) => metric === gate.metric,
      );
      for (const [sliceId, entry] of slices.entries) {
        if (
          !isRecord(entry) ||
          entry[gate.criticalField] !== criticalIds.has(sliceId)
        ) {
          problems.push(
            `blessed baseline ${gate.metric}.${sliceId}.${gate.criticalField} must match pinned critical identity`,
          );
        }
      }
      for (const sliceId of criticalIds) {
        const score = sliceScore(slices.entries.get(sliceId), gate.scoreField);
        if (!score.found || !score.valid || score.value < 0 || score.value > 1) {
          problems.push(
            `blessed baseline critical slice ${gate.metric}.${sliceId}.${gate.scoreField} must be a fraction`,
          );
        }
        if (!sliceFloor?.requiredSliceIds?.includes(sliceId)) {
          problems.push(
            `${sliceFloor?.id ?? gate.metric} must require critical slice ${sliceId}`,
          );
        }
      }
    }
  }
}

function evaluateAbsoluteGate(gate, metrics, mode) {
  const reading = readNumericMetric(metrics, gate.metric);
  if (!reading.found) {
    return skippedGate(gate, "absolute", "metric_missing", mode);
  }
  if (!reading.valid) {
    return failedGate({
      ...gate,
      group: "absolute",
      code: "invalid_metric",
      observed: reading.raw,
      message: `${gate.metric} must be a finite number`,
    });
  }
  const domainProblem = metricDomainProblem(gate.metric, reading.value);
  if (domainProblem) {
    return failedGate({
      ...gate,
      group: "absolute",
      code: "invalid_metric",
      observed: reading.value,
      message: `${gate.metric} ${domainProblem}`,
    });
  }
  const passed = compare(reading.value, gate.operator, gate.threshold);
  return {
    id: gate.id,
    group: "absolute",
    metric: gate.metric,
    status: passed ? "passed" : "failed",
    code: passed ? "threshold_met" : "threshold_regression",
    observed: reading.value,
    operator: gate.operator,
    threshold: gate.threshold,
    message: `${gate.metric} ${formatComparison(
      reading.value,
      gate.operator,
      gate.threshold,
      passed,
    )}`,
  };
}

function evaluateSliceGate(gate, metrics, mode) {
  const collection = readSliceCollection(metrics, gate.metric);
  if (!collection.found) {
    return [skippedGate(gate, "slice", "metric_missing", mode)];
  }
  if (!collection.valid) {
    return [
      failedGate({
        ...gate,
        group: "slice",
        code: "invalid_slice_collection",
        message: `${gate.metric} must be an object, an id-keyed array, or flat dotted slice metrics`,
      }),
    ];
  }

  const results = [];
  const requiredIds = new Set(gate.requiredSliceIds);
  if (mode === "release") {
    for (const sliceId of requiredIds) {
      if (!collection.entries.has(sliceId)) {
        results.push(
          failedGate({
            id: `${gate.id}:${sliceId}`,
            parentGateId: gate.id,
            group: "slice",
            metric: `${gate.metric}.${sliceId}.${gate.scoreField}`,
            code: "missing_required_slice",
            message: `required release slice ${gate.metric}.${sliceId} is missing`,
          }),
        );
      }
    }
  }

  for (const [sliceId, entry] of collection.entries) {
    const score = sliceScore(entry, gate.scoreField);
    const id = `${gate.id}:${sliceId}`;
    const metric = `${gate.metric}.${sliceId}.${gate.scoreField}`;
    if (!score.found || !score.valid || score.value < 0 || score.value > 1) {
      results.push(
        failedGate({
          id,
          parentGateId: gate.id,
          group: "slice",
          metric,
          code: "invalid_metric",
          observed: score.raw,
          message: `${metric} must be a fraction from 0 to 1`,
        }),
      );
      continue;
    }
    const passed = compare(score.value, gate.operator, gate.threshold);
    results.push({
      id,
      parentGateId: gate.id,
      group: "slice",
      metric,
      required: requiredIds.has(sliceId),
      status: passed ? "passed" : "failed",
      code: passed ? "threshold_met" : "slice_floor_regression",
      observed: score.value,
      operator: gate.operator,
      threshold: gate.threshold,
      message: `${metric} ${formatComparison(
        score.value,
        gate.operator,
        gate.threshold,
        passed,
      )}`,
    });
  }
  return results.length > 0
    ? results
    : [skippedGate(gate, "slice", "no_slices", mode)];
}

function evaluateBaselineGate(gate, metrics, baselineMetrics, mode) {
  if (gate.kind === "relative_max") {
    return [
      evaluateRelativeBaselineGate(gate, metrics, baselineMetrics, mode),
    ];
  }
  return evaluateCriticalSliceBaselineGate(
    gate,
    metrics,
    baselineMetrics,
    mode,
  );
}

function evaluateRelativeBaselineGate(gate, metrics, baselineMetrics, mode) {
  const candidate = readNumericMetric(metrics, gate.metric);
  if (!candidate.found) {
    return skippedGate(gate, "baseline", "metric_missing", mode);
  }
  const baseline = readNumericMetric(baselineMetrics, gate.metric);
  if (
    !candidate.valid ||
    candidate.value < 0 ||
    !baseline.valid ||
    baseline.value <= 0
  ) {
    return failedGate({
      ...gate,
      group: "baseline",
      code: "invalid_metric",
      observed: candidate.raw,
      baseline: baseline.raw,
      message: `${gate.metric} and its blessed baseline must be non-negative finite numbers with a positive baseline`,
    });
  }
  const regression = (candidate.value - baseline.value) / baseline.value;
  const passed = regression <= gate.maximumRegression + NUMBER_EPSILON;
  return {
    id: gate.id,
    group: "baseline",
    metric: gate.metric,
    status: passed ? "passed" : "failed",
    code: passed ? "regression_within_budget" : "baseline_regression",
    observed: candidate.value,
    baseline: baseline.value,
    regression,
    maximumRegression: gate.maximumRegression,
    message: `${gate.metric} relative regression ${formatPercent(
      regression,
    )} is ${passed ? "within" : "above"} ${formatPercent(
      gate.maximumRegression,
    )}`,
  };
}

function evaluateCriticalSliceBaselineGate(
  gate,
  metrics,
  baselineMetrics,
  mode,
) {
  const candidate = readSliceCollection(metrics, gate.metric);
  if (!candidate.found) {
    return [skippedGate(gate, "baseline", "metric_missing", mode)];
  }
  if (!candidate.valid) {
    return [
      failedGate({
        ...gate,
        group: "baseline",
        code: "invalid_slice_collection",
        message: `${gate.metric} is not a valid slice collection`,
      }),
    ];
  }
  const baseline = readSliceCollection(baselineMetrics, gate.metric);
  if (!baseline.found || !baseline.valid) {
    return [
      failedGate({
        ...gate,
        group: "baseline",
        code: "invalid_blessed_slice_collection",
        message: `blessed baseline ${gate.metric} is not a valid slice collection`,
      }),
    ];
  }
  const configuredCriticalIds = new Set(gate.criticalSliceIds);
  const baselineCriticalIds = markedCriticalSliceIds(
    baseline.entries,
    gate.criticalField,
  );
  const candidateCriticalIds = markedCriticalSliceIds(
    candidate.entries,
    gate.criticalField,
  );
  const criticalIds = [
    ...new Set([
      ...configuredCriticalIds,
      ...baselineCriticalIds,
      ...candidateCriticalIds,
    ]),
  ].sort();
  const results = [];
  for (const sliceId of criticalIds) {
    const baselineEntry = baseline.entries.get(sliceId);
    const candidateEntry = candidate.entries.get(sliceId);
    const id = `${gate.id}:${sliceId}`;
    const metric = `${gate.metric}.${sliceId}.${gate.scoreField}`;
    const criticalSources = [
      ...(configuredCriticalIds.has(sliceId) ? ["configured"] : []),
      ...(baselineCriticalIds.has(sliceId) ? ["baseline"] : []),
      ...(candidateCriticalIds.has(sliceId) ? ["candidate"] : []),
    ];
    if (baselineEntry === undefined) {
      results.push(
        failedGate({
          id,
          parentGateId: gate.id,
          group: "baseline",
          metric,
          code: "missing_blessed_critical_slice",
          observed: sliceScore(candidateEntry, gate.scoreField).raw,
          criticalSources,
          message: `critical candidate slice ${gate.metric}.${sliceId} has no blessed baseline`,
        }),
      );
      continue;
    }
    if (candidateEntry === undefined) {
      results.push(
        mode === "release"
          ? failedGate({
              id,
              parentGateId: gate.id,
              group: "baseline",
              metric,
              code: "missing_critical_slice",
              criticalSources,
              message: `critical comparison slice ${gate.metric}.${sliceId} is missing`,
            })
          : skippedGate(
              { id, metric },
              "baseline",
              "critical_slice_missing",
              mode,
              gate.id,
            ),
      );
      continue;
    }
    const observed = sliceScore(candidateEntry, gate.scoreField);
    const blessed = sliceScore(baselineEntry, gate.scoreField);
    if (
      !observed.valid ||
      observed.value < 0 ||
      observed.value > 1 ||
      !blessed.valid
    ) {
      results.push(
        failedGate({
          id,
          parentGateId: gate.id,
          group: "baseline",
          metric,
          code: "invalid_metric",
          observed: observed.raw,
          baseline: blessed.raw,
          message: `${metric} and its blessed baseline must be fractions`,
        }),
      );
      continue;
    }
    const regression = blessed.value - observed.value;
    const passed = regression <= gate.maximumRegression + NUMBER_EPSILON;
    results.push({
      id,
      parentGateId: gate.id,
      group: "baseline",
      metric,
      status: passed ? "passed" : "failed",
      code: passed
        ? "regression_within_budget"
        : "critical_slice_regression",
      observed: observed.value,
      baseline: blessed.value,
      criticalSources,
      regression,
      maximumRegression: gate.maximumRegression,
      message: `${metric} absolute drop ${formatPercentagePoints(
        regression,
      )} is ${passed ? "within" : "above"} ${formatPercentagePoints(
        gate.maximumRegression,
      )}`,
    });
  }
  return results;
}

function markedCriticalSliceIds(entries, criticalField) {
  return new Set(
    [...entries]
      .filter(([, entry]) => entry?.[criticalField] === true)
      .map(([sliceId]) => sliceId),
  );
}

function finishResult(
  common,
  gates,
  {
    status,
    evaluationPerformed,
    evidenceAvailability,
    reportAvailability,
    reportCoverage,
  },
) {
  const summary = {
    total: gates.length,
    passed: gates.filter(({ status: gateStatus }) => gateStatus === "passed")
      .length,
    failed: gates.filter(({ status: gateStatus }) => gateStatus === "failed")
      .length,
    skipped: gates.filter(({ status: gateStatus }) => gateStatus === "skipped")
      .length,
  };
  return {
    ...common,
    status,
    passed: status !== "failed",
    evaluationPerformed,
    evidenceAvailability,
    reportAvailability,
    reportCoverage,
    gates,
    summary,
  };
}

function missingRequiredMetricResults(paths) {
  return paths.map(missingRequiredMetricResult);
}

function missingRequiredMetricResult(path) {
  return failedGate({
    id: `required:${path}`,
    group: "required",
    metric: path,
    code: "missing_required_metric",
    message: `required release metric ${path} is missing`,
  });
}

function skippedPolicyGates(policy, reason, mode) {
  return [
    ...policy.absoluteGates.map((gate) =>
      skippedGate(gate, "absolute", reason, mode),
    ),
    ...policy.sliceGates.map((gate) =>
      skippedGate(gate, "slice", reason, mode),
    ),
    ...policy.baselineGates.map((gate) =>
      skippedGate(gate, "baseline", reason, mode),
    ),
  ];
}

function skippedGate(
  gate,
  group,
  code,
  mode,
  parentGateId = undefined,
) {
  return {
    id: gate.id,
    ...(parentGateId ? { parentGateId } : {}),
    group,
    metric: gate.metric,
    status: "skipped",
    code,
    message:
      mode === "release"
        ? `${gate.metric} could not be evaluated for release`
        : `${gate.metric} was not asserted in PR mode`,
  };
}

function failedGate(fields) {
  return {
    status: "failed",
    ...fields,
  };
}

function metricRepresentationProblems(metrics) {
  if (!isRecord(metrics)) return [];
  const keys = Object.keys(metrics);
  const keySet = new Set(keys);
  const rootKeys = new Set(keys.filter((key) => !key.includes(".")));
  const problems = new Set();

  for (const key of keys.filter((candidate) => candidate.includes("."))) {
    const segments = key.split(".");
    if (rootKeys.has(segments[0])) {
      problems.add(
        `${JSON.stringify(key)} overlaps nested root ${JSON.stringify(
          segments[0],
        )}`,
      );
    }
    for (let length = 2; length < segments.length; length += 1) {
      const prefix = segments.slice(0, length).join(".");
      if (keySet.has(prefix)) {
        problems.add(
          `${JSON.stringify(key)} overlaps dotted parent ${JSON.stringify(
            prefix,
          )}`,
        );
      }
    }
  }

  inspectNestedKeys(metrics, "", true, problems);
  return [...problems];
}

function inspectNestedKeys(value, path, atRoot, problems) {
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!atRoot && key.includes(".")) {
      problems.add(
        `${JSON.stringify(path ? `${path}.${key}` : key)} contains a dotted key inside nested metrics`,
      );
    }
    if (!atRoot || !key.includes(".")) {
      inspectNestedKeys(entry, path ? `${path}.${key}` : key, false, problems);
    }
  }
}

function releaseReportCoverage(policy, metrics) {
  let expected = policy.requiredMetrics.length;
  let observed = policy.requiredMetrics.filter((path) =>
    metricOrCollectionExists(metrics, path),
  ).length;
  for (const gate of policy.sliceGates) {
    expected += gate.requiredSliceIds.length;
    const collection = readSliceCollection(metrics, gate.metric);
    if (!collection.valid) continue;
    observed += gate.requiredSliceIds.filter((sliceId) =>
      collection.entries.has(sliceId),
    ).length;
  }
  if (observed === 0) return "none";
  return observed === expected ? "complete" : "partial";
}

function readNumericMetric(metrics, path) {
  const reading = readRawMetric(metrics, path);
  return {
    ...reading,
    valid:
      reading.found &&
      typeof reading.value === "number" &&
      Number.isFinite(reading.value),
    raw: reading.value,
  };
}

function readRawMetric(metrics, path) {
  if (Object.hasOwn(metrics, path)) {
    return { found: true, value: metrics[path] };
  }
  let value = metrics;
  for (const segment of path.split(".")) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) {
      return { found: false, value: undefined };
    }
    value = value[segment];
  }
  return { found: true, value };
}

function metricOrCollectionExists(metrics, path) {
  if (readRawMetric(metrics, path).found) return true;
  const prefix = `${path}.`;
  return Object.keys(metrics).some((key) => key.startsWith(prefix));
}

function readSliceCollection(metrics, path) {
  const direct = readRawMetric(metrics, path);
  if (direct.found) {
    if (Array.isArray(direct.value)) {
      const entries = new Map();
      for (const entry of direct.value) {
        if (
          !isRecord(entry) ||
          !SAFE_ID_PATTERN.test(entry.id ?? "") ||
          entries.has(entry.id)
        ) {
          return { found: true, valid: false, entries: new Map() };
        }
        const { id, ...value } = entry;
        entries.set(id, value);
      }
      return { found: true, valid: true, entries };
    }
    if (!isRecord(direct.value)) {
      return { found: true, valid: false, entries: new Map() };
    }
    const entries = new Map();
    for (const [sliceId, entry] of Object.entries(direct.value)) {
      if (!SAFE_ID_PATTERN.test(sliceId)) {
        return { found: true, valid: false, entries: new Map() };
      }
      entries.set(sliceId, entry);
    }
    return { found: true, valid: true, entries };
  }

  const prefix = `${path}.`;
  const entries = new Map();
  for (const [key, value] of Object.entries(metrics)) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length).split(".");
    const [sliceId, field] = remainder;
    if (
      remainder.length < 1 ||
      remainder.length > 2 ||
      !SAFE_ID_PATTERN.test(sliceId ?? "") ||
      (field !== undefined && !PATH_SEGMENT_PATTERN.test(field))
    ) {
      return { found: true, valid: false, entries: new Map() };
    }
    if (field === undefined) {
      entries.set(sliceId, value);
      continue;
    }
    const prior = entries.get(sliceId);
    if (prior !== undefined && !isRecord(prior)) {
      return { found: true, valid: false, entries: new Map() };
    }
    entries.set(sliceId, { ...(prior ?? {}), [field]: value });
  }
  return {
    found: entries.size > 0,
    valid: entries.size > 0,
    entries,
  };
}

function sliceScore(entry, scoreField) {
  const raw = typeof entry === "number" ? entry : entry?.[scoreField];
  return {
    found: raw !== undefined,
    valid: typeof raw === "number" && Number.isFinite(raw),
    value: raw,
    raw,
  };
}

function metricDomainProblem(metric, value) {
  if (FRACTION_METRICS.has(metric) && (value < 0 || value > 1)) {
    return "must be a fraction from 0 to 1";
  }
  if (INTEGER_METRICS.has(metric) && (!Number.isInteger(value) || value < 0)) {
    return "must be a non-negative integer";
  }
  if (
    !FRACTION_METRICS.has(metric) &&
    !INTEGER_METRICS.has(metric) &&
    value < 0
  ) {
    return "must be non-negative";
  }
  return null;
}

function compare(observed, operator, threshold) {
  switch (operator) {
    case "eq":
      return observed === threshold;
    case "gte":
      return observed >= threshold;
    case "lte":
      return observed <= threshold;
    case "gt":
      return observed > threshold;
    case "lt":
      return observed < threshold;
    default:
      return false;
  }
}

function isAtLeastAsStrict(operator, configured, required) {
  if (!Number.isFinite(configured)) return false;
  switch (operator) {
    case "gte":
    case "gt":
      return configured >= required;
    case "lte":
    case "lt":
      return configured <= required;
    case "eq":
      return configured === required;
    default:
      return false;
  }
}

function isMetricPath(path) {
  if (typeof path !== "string" || path.length > 200) return false;
  const segments = path.split(".");
  return (
    segments.length > 1 &&
    segments.every(
      (segment) =>
        PATH_SEGMENT_PATTERN.test(segment) &&
        !UNSAFE_PATH_SEGMENTS.has(segment),
    )
  );
}

function gateContract(id, metric, operator, threshold) {
  return { id, metric, operator, threshold };
}

function formatComparison(observed, operator, threshold, passed) {
  return `${operator} ${threshold}: observed ${observed} (${passed ? "pass" : "fail"})`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPercentagePoints(value) {
  return `${(value * 100).toFixed(2)} percentage points`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function canonicalSha256(value) {
  try {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!isRecord(value)) {
    throw new TypeError("canonical JSON contains an unsupported value");
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    )
    .join(",")}}`;
}
