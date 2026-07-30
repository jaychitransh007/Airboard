import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const SEMANTIC_COMPARISON_SCHEMA_VERSION =
  "airboard-semantic-comparison-result.v1";
export const SEMANTIC_EVAL_SCHEMA_VERSION =
  "airboard-semantic-eval-result.v1";

const CORE_ACCURACY_FLOOR = 0.95;
const OVERALL_ACCURACY_FLOOR = 0.9;
const MAXIMUM_CRITICAL_SLICE_DROP = 0.03;
const MAXIMUM_COST_REGRESSION = 0.1;
const MAXIMUM_INFRASTRUCTURE_RATE = 0.05;
const EPSILON = 1e-12;

export async function loadSemanticEvalReport(path) {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath, "utf8");
  let report;
  try {
    report = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${absolutePath} is not valid JSON: ${describeError(error)}`,
    );
  }
  return report;
}

export function compareSemanticEvalReports({
  baseline,
  candidate,
  replay,
  now = () => new Date(),
} = {}) {
  const inputFailures = [
    ...validateSemanticEvalReport(baseline, "baseline"),
    ...validateSemanticEvalReport(candidate, "candidate"),
  ];
  const checks = [];

  if (inputFailures.length === 0) {
    addCompatibilityChecks(checks, baseline, candidate);
    addCandidateQualityChecks(checks, candidate);
    addCriticalSliceChecks(checks, baseline, candidate);
    addCostCheck(checks, baseline, candidate);
  }

  const inconclusiveReasons = inputFailures.length
    ? []
    : providerInconclusiveReasons(baseline, candidate);
  const failedChecks = checks.filter(({ status }) => status === "failed");
  const compatibilityFailed =
    inputFailures.length > 0 ||
    failedChecks.some(
      ({ category }) => category === "compatibility",
    );
  const status =
    compatibilityFailed
      ? "failed"
      : inconclusiveReasons.length > 0
        ? "inconclusive"
        : failedChecks.length > 0
          ? "failed"
          : "passed";
  const decisiveFailedChecks =
    status === "inconclusive"
      ? failedChecks.filter(
          ({ category }) => category === "compatibility",
        )
      : failedChecks;
  const deferredFailedChecks =
    status === "inconclusive"
      ? failedChecks.filter(
          ({ category }) => category !== "compatibility",
        )
      : [];

  return {
    schemaVersion: SEMANTIC_COMPARISON_SCHEMA_VERSION,
    generatedAt: normalizeDate(now()),
    status,
    policy: {
      coreAccuracyFloor: CORE_ACCURACY_FLOOR,
      overallAccuracyFloor: OVERALL_ACCURACY_FLOOR,
      maximumCriticalSliceAbsoluteDrop:
        MAXIMUM_CRITICAL_SLICE_DROP,
      maximumCostPerSuccessfulTurnRegression:
        MAXIMUM_COST_REGRESSION,
      maximumProviderInfrastructureRate:
        MAXIMUM_INFRASTRUCTURE_RATE,
    },
    inputs: {
      baseline: summarizeInput(baseline),
      candidate: summarizeInput(candidate),
    },
    compatibility: {
      comparable:
        inputFailures.length === 0 &&
        checks
          .filter(({ category }) => category === "compatibility")
          .every(({ status: checkStatus }) => checkStatus === "passed"),
      failures: [
        ...inputFailures,
        ...checks
          .filter(
            ({ category, status: checkStatus }) =>
              category === "compatibility" && checkStatus === "failed",
          )
          .map(({ message }) => message),
      ],
    },
    providerInfrastructure: {
      baseline: summarizeProviderInfrastructure(baseline),
      candidate: summarizeProviderInfrastructure(candidate),
      inconclusive: inconclusiveReasons.length > 0,
      reasons: inconclusiveReasons,
    },
    metrics: buildMetricComparison(baseline, candidate),
    checks,
    failures: [
      ...inputFailures,
      ...decisiveFailedChecks.map(({ message }) => message),
    ],
    deferredQualityFailures: deferredFailedChecks.map(
      ({ message }) => message,
    ),
    inconclusiveReasons,
    replay: typeof replay === "string" && replay.trim() ? replay : null,
  };
}

export async function writeSemanticComparisonReports({
  report,
  outputPrefix,
}) {
  if (!isRecord(report)) {
    throw new TypeError("report is required");
  }
  if (typeof outputPrefix !== "string" || !outputPrefix.trim()) {
    throw new TypeError("outputPrefix is required");
  }
  const prefix = resolve(outputPrefix);
  await mkdir(dirname(prefix), { recursive: true });
  const paths = {
    json: `${prefix}.json`,
    junit: `${prefix}.xml`,
    markdown: `${prefix}.md`,
    html: `${prefix}.html`,
  };
  await Promise.all([
    writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(paths.junit, semanticComparisonJUnit(report), "utf8"),
    writeFile(paths.markdown, semanticComparisonMarkdown(report), "utf8"),
    writeFile(paths.html, semanticComparisonHtml(report), "utf8"),
  ]);
  return paths;
}

export function semanticComparisonJUnit(report) {
  const cases = report.checks.map((check) => ({
    name: check.id,
    status:
      report.status === "inconclusive" &&
      check.status === "failed" &&
      check.category !== "compatibility"
        ? "deferred"
        : check.status,
    message: check.message,
  }));
  for (const [index, failure] of report.compatibility.failures.entries()) {
    if (cases.some(({ message }) => message === failure)) continue;
    cases.push({
      name: `input-contract-${index + 1}`,
      status: "failed",
      message: failure,
    });
  }
  for (const [index, reason] of report.inconclusiveReasons.entries()) {
    cases.push({
      name: `provider-infrastructure-${index + 1}`,
      status: "inconclusive",
      message: reason,
    });
  }
  if (cases.length === 0) {
    cases.push({
      name: "semantic-comparison",
      status: report.status,
      message: `comparison ${report.status}`,
    });
  }
  const failures = cases.filter(({ status }) => status === "failed").length;
  const errors = cases.filter(
    ({ status }) => status === "inconclusive",
  ).length;
  const skipped = cases.filter(
    ({ status }) => status === "deferred",
  ).length;
  const body = cases
    .map(({ name, status, message }) => {
      const outcome =
        status === "failed"
          ? `<failure type="quality_or_contract" message="${xml(message)}"/>`
          : status === "inconclusive"
            ? `<error type="provider_infrastructure" message="${xml(message)}"/>`
            : status === "deferred"
              ? `<skipped message="${xml(message)}"/>`
            : "";
      return `  <testcase classname="semantic.model-comparison" name="${xml(name)}">${outcome}</testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Airboard semantic model comparison" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">
${body}
</testsuite>
`;
}

export function semanticComparisonMarkdown(report) {
  const lines = [
    "# Airboard semantic model comparison",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    "| Metric | Baseline | Candidate | Change |",
    "| --- | ---: | ---: | ---: |",
    metricRow(
      "Core accuracy",
      report.metrics.coreAccuracy,
      formatPercent,
      formatPercentagePoints,
    ),
    metricRow(
      "Overall accuracy",
      report.metrics.overallAccuracy,
      formatPercent,
      formatPercentagePoints,
    ),
    metricRow(
      "Cases meeting repetition policy",
      report.metrics.policyPassingCases,
      formatCount,
      formatCountDelta,
    ),
    metricRow(
      "Cost / successful turn",
      report.metrics.costPerSuccessfulTurnUsd,
      formatUsd,
      formatPercentDelta,
    ),
    "",
    "## Critical semantic slices",
    "",
    "| Slice | Baseline | Candidate | Absolute drop | Outcome |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const slice of report.metrics.criticalSlices) {
    lines.push(
      `| ${escapeMarkdownCell(slice.name)} | ${formatPercent(slice.baseline)} | ${formatPercent(slice.candidate)} | ${formatPercentagePoints(slice.absoluteDrop)} | ${slice.passed ? "PASS" : "FAIL"} |`,
    );
  }
  if (report.metrics.criticalSlices.length === 0) {
    lines.push("| — | — | — | — | No comparable slices |");
  }
  lines.push(
    "",
    "## Provider infrastructure",
    "",
    `- Baseline: ${formatInfrastructure(report.providerInfrastructure.baseline)}`,
    `- Candidate: ${formatInfrastructure(report.providerInfrastructure.candidate)}`,
    "",
    "## Failures",
    "",
    ...(report.failures.length
      ? report.failures.map((failure) => `- ${failure}`)
      : ["- None"]),
    "",
    "## Inconclusive reasons",
    "",
    ...(report.inconclusiveReasons.length
      ? report.inconclusiveReasons.map((reason) => `- ${reason}`)
      : ["- None"]),
    "",
    "## Deferred quality observations",
    "",
    ...(report.deferredQualityFailures.length
      ? report.deferredQualityFailures.map(
          (failure) => `- ${failure}`,
        )
      : ["- None"]),
    "",
    `Replay: \`${String(report.replay ?? "unavailable").replaceAll("`", "\\`")}\``,
    "",
  );
  return lines.join("\n");
}

export function semanticComparisonHtml(report) {
  const metricRows = [
    [
      "Core accuracy",
      report.metrics.coreAccuracy,
      formatPercent,
      formatPercentagePoints,
    ],
    [
      "Overall accuracy",
      report.metrics.overallAccuracy,
      formatPercent,
      formatPercentagePoints,
    ],
    [
      "Cases meeting repetition policy",
      report.metrics.policyPassingCases,
      formatCount,
      formatCountDelta,
    ],
    [
      "Cost / successful turn",
      report.metrics.costPerSuccessfulTurnUsd,
      formatUsd,
      formatPercentDelta,
    ],
  ]
    .map(
      ([label, metric, formatter, deltaFormatter]) =>
        `<tr><td>${html(label)}</td><td>${html(formatter(metric.baseline))}</td><td>${html(formatter(metric.candidate))}</td><td>${html(deltaFormatter(metric.delta))}</td></tr>`,
    )
    .join("");
  const sliceRows = report.metrics.criticalSlices.length
    ? report.metrics.criticalSlices
        .map(
          (slice) =>
            `<tr><td>${html(slice.name)}</td><td>${html(formatPercent(slice.baseline))}</td><td>${html(formatPercent(slice.candidate))}</td><td>${html(formatPercentagePoints(slice.absoluteDrop))}</td><td class="${slice.passed ? "passed" : "failed"}">${slice.passed ? "PASS" : "FAIL"}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5">No comparable critical slices</td></tr>';
  const failures = listHtml(report.failures);
  const inconclusive = listHtml(report.inconclusiveReasons);
  const deferred = listHtml(report.deferredQualityFailures);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Airboard semantic model comparison</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17202a}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{padding:9px;border-bottom:1px solid #d9dee3;text-align:left}code{white-space:pre-wrap}.passed{color:#08783d}.failed{color:#b42318}.inconclusive{color:#9a6700}</style>
</head>
<body>
  <h1>Airboard semantic model comparison</h1>
  <p class="${html(report.status)}"><strong>${html(report.status.toUpperCase())}</strong></p>
  <table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Change</th></tr></thead><tbody>${metricRows}</tbody></table>
  <h2>Critical semantic slices</h2>
  <table><thead><tr><th>Slice</th><th>Baseline</th><th>Candidate</th><th>Absolute drop</th><th>Outcome</th></tr></thead><tbody>${sliceRows}</tbody></table>
  <h2>Provider infrastructure</h2>
  <p>Baseline: ${html(formatInfrastructure(report.providerInfrastructure.baseline))}<br>Candidate: ${html(formatInfrastructure(report.providerInfrastructure.candidate))}</p>
  <h2>Failures</h2>${failures}
  <h2>Inconclusive reasons</h2>${inconclusive}
  <h2>Deferred quality observations</h2>${deferred}
  <p>Replay: <code>${html(report.replay ?? "unavailable")}</code></p>
</body>
</html>
`;
}

function validateSemanticEvalReport(report, label) {
  const failures = [];
  if (!isRecord(report)) {
    return [`${label} artifact must be an object`];
  }
  if (report.schemaVersion !== SEMANTIC_EVAL_SCHEMA_VERSION) {
    failures.push(
      `${label} artifact must use ${SEMANTIC_EVAL_SCHEMA_VERSION}`,
    );
  }
  if (!isRecord(report.corpus) || report.corpus.kind !== "metamorphic") {
    failures.push(`${label} artifact must be a metamorphic semantic run`);
  }
  if (
    typeof report.corpus?.datasetHash !== "string" ||
    !report.corpus.datasetHash.trim()
  ) {
    failures.push(`${label} corpus.datasetHash is required`);
  }
  if (!positiveInteger(report.corpus?.caseCount)) {
    failures.push(`${label} corpus.caseCount must be a positive integer`);
  }
  if (!positiveInteger(report.corpus?.attempts)) {
    failures.push(`${label} corpus.attempts must be a positive integer`);
  }
  if (
    typeof report.corpus?.schemaVersion !== "string" ||
    !report.corpus.schemaVersion.trim()
  ) {
    failures.push(`${label} corpus.schemaVersion is required`);
  }
  for (const field of [
    "semanticPlanContract",
    "capabilityRegistry",
    "prompt",
  ]) {
    if (
      typeof report.versions?.[field] !== "string" ||
      !report.versions[field].trim()
    ) {
      failures.push(`${label} versions.${field} is required`);
    }
  }
  if (!isRecord(report.summary)) {
    failures.push(`${label} summary is required`);
    return failures;
  }
  for (const metric of ["coreAccuracy", "overallAccuracy"]) {
    if (!fraction(report.summary[metric])) {
      failures.push(`${label} summary.${metric} must be a fraction`);
    }
  }
  if (
    !nonNegativeInteger(report.summary.policyPassingCases) ||
    report.summary.policyPassingCases > (report.corpus?.caseCount ?? -1)
  ) {
    failures.push(
      `${label} summary.policyPassingCases must be within the corpus case count`,
    );
  }
  if (
    !positiveInteger(report.summary.totalCases) ||
    report.summary.totalCases !== report.corpus?.caseCount
  ) {
    failures.push(
      `${label} summary.totalCases must equal corpus.caseCount`,
    );
  }
  if (
    !nonNegativeInteger(report.summary.attempts) ||
    report.summary.attempts !==
      (report.corpus?.caseCount ?? 0) * (report.corpus?.attempts ?? 0)
  ) {
    failures.push(
      `${label} summary.attempts must equal caseCount × attempts`,
    );
  }
  if (!nonNegativeInteger(report.summary.infrastructureFailures)) {
    failures.push(
      `${label} summary.infrastructureFailures must be a non-negative integer`,
    );
  }
  if (!fraction(report.summary.infrastructureRate)) {
    failures.push(
      `${label} summary.infrastructureRate must be a fraction`,
    );
  }
  if (!Array.isArray(report.summary.slices)) {
    failures.push(`${label} summary.slices must be an array`);
  } else {
    const names = new Set();
    let criticalSliceCount = 0;
    for (const [index, slice] of report.summary.slices.entries()) {
      if (
        !isRecord(slice) ||
        typeof slice.name !== "string" ||
        !slice.name.trim() ||
        typeof slice.critical !== "boolean" ||
        !fraction(slice.accuracy)
      ) {
        failures.push(`${label} summary.slices[${index}] is invalid`);
        continue;
      }
      if (names.has(slice.name)) {
        failures.push(
          `${label} summary.slices contains duplicate ${slice.name}`,
        );
      }
      names.add(slice.name);
      if (slice.critical === true) criticalSliceCount += 1;
    }
    if (criticalSliceCount === 0) {
      failures.push(
        `${label} summary.slices must include critical semantic slices`,
      );
    }
  }
  const cost = report.summary.usage?.costPerSuccessfulTurnUsd;
  if (cost !== null && cost !== undefined && !nonNegativeFinite(cost)) {
    failures.push(
      `${label} summary.usage.costPerSuccessfulTurnUsd must be null or non-negative`,
    );
  }
  return failures;
}

function addCompatibilityChecks(checks, baseline, candidate) {
  addCheck(
    checks,
    "same-corpus-schema",
    "compatibility",
    baseline.corpus.schemaVersion === candidate.corpus.schemaVersion,
    `corpus schema versions match (${baseline.corpus.schemaVersion})`,
    `corpus schema mismatch: baseline ${baseline.corpus.schemaVersion}, candidate ${candidate.corpus.schemaVersion}`,
  );
  addCheck(
    checks,
    "same-dataset-hash",
    "compatibility",
    baseline.corpus.datasetHash === candidate.corpus.datasetHash,
    `dataset hashes match (${baseline.corpus.datasetHash})`,
    `dataset hash mismatch: baseline ${baseline.corpus.datasetHash}, candidate ${candidate.corpus.datasetHash}`,
  );
  addCheck(
    checks,
    "same-case-count",
    "compatibility",
    baseline.corpus.caseCount === candidate.corpus.caseCount,
    `case counts match (${baseline.corpus.caseCount})`,
    `case count mismatch: baseline ${baseline.corpus.caseCount}, candidate ${candidate.corpus.caseCount}`,
  );
  addCheck(
    checks,
    "same-attempts",
    "compatibility",
    baseline.corpus.attempts === candidate.corpus.attempts,
    `attempt counts match (${baseline.corpus.attempts})`,
    `attempt count mismatch: baseline ${baseline.corpus.attempts}, candidate ${candidate.corpus.attempts}`,
  );
  for (const [id, field, label] of [
    ["same-plan-contract", "semanticPlanContract", "semantic plan contract"],
    ["same-capability-registry", "capabilityRegistry", "capability registry"],
    ["same-prompt", "prompt", "semantic prompt"],
  ]) {
    addCheck(
      checks,
      id,
      "compatibility",
      baseline.versions[field] === candidate.versions[field],
      `${label} versions match (${baseline.versions[field]})`,
      `${label} mismatch: baseline ${baseline.versions[field]}, candidate ${candidate.versions[field]}`,
    );
  }
  const baselineCritical = criticalSliceMap(baseline);
  const candidateCritical = criticalSliceMap(candidate);
  const sameCriticalSlices =
    [...baselineCritical.keys()].sort().join("\u0000") ===
    [...candidateCritical.keys()].sort().join("\u0000");
  addCheck(
    checks,
    "same-critical-slices",
    "compatibility",
    sameCriticalSlices,
    `critical slice inventories match (${baselineCritical.size})`,
    `critical slice inventory mismatch: baseline [${[...baselineCritical.keys()].sort().join(", ")}], candidate [${[...candidateCritical.keys()].sort().join(", ")}]`,
  );
}

function addCandidateQualityChecks(checks, candidate) {
  addCheck(
    checks,
    "candidate-core-accuracy",
    "quality",
    candidate.summary.coreAccuracy + EPSILON >= CORE_ACCURACY_FLOOR,
    `candidate core accuracy ${formatPercent(candidate.summary.coreAccuracy)} meets ${formatPercent(CORE_ACCURACY_FLOOR)}`,
    `candidate core accuracy ${formatPercent(candidate.summary.coreAccuracy)} is below ${formatPercent(CORE_ACCURACY_FLOOR)}`,
  );
  addCheck(
    checks,
    "candidate-overall-accuracy",
    "quality",
    candidate.summary.overallAccuracy + EPSILON >=
      OVERALL_ACCURACY_FLOOR,
    `candidate overall accuracy ${formatPercent(candidate.summary.overallAccuracy)} meets ${formatPercent(OVERALL_ACCURACY_FLOOR)}`,
    `candidate overall accuracy ${formatPercent(candidate.summary.overallAccuracy)} is below ${formatPercent(OVERALL_ACCURACY_FLOOR)}`,
  );
  addCheck(
    checks,
    "candidate-repetition-policy",
    "quality",
    candidate.summary.policyPassingCases ===
      candidate.summary.totalCases,
    `all ${candidate.summary.totalCases} candidate cases meet repetition policy`,
    `candidate repetition policy passed ${candidate.summary.policyPassingCases}/${candidate.summary.totalCases} cases`,
  );
}

function addCriticalSliceChecks(checks, baseline, candidate) {
  const baselineSlices = criticalSliceMap(baseline);
  const candidateSlices = criticalSliceMap(candidate);
  for (const [name, baselineSlice] of baselineSlices) {
    const candidateSlice = candidateSlices.get(name);
    if (!candidateSlice) continue;
    const drop = Math.max(
      0,
      baselineSlice.accuracy - candidateSlice.accuracy,
    );
    addCheck(
      checks,
      `critical-slice:${name}`,
      "regression",
      drop <= MAXIMUM_CRITICAL_SLICE_DROP + EPSILON,
      `${name} absolute drop ${formatPercentagePoints(drop)} is within ${formatPercentagePoints(MAXIMUM_CRITICAL_SLICE_DROP)}`,
      `${name} absolute drop ${formatPercentagePoints(drop)} exceeds ${formatPercentagePoints(MAXIMUM_CRITICAL_SLICE_DROP)}`,
      {
        slice: name,
        baseline: baselineSlice.accuracy,
        candidate: candidateSlice.accuracy,
        absoluteDrop: drop,
      },
    );
  }
}

function addCostCheck(checks, baseline, candidate) {
  const baselineCost =
    baseline.summary.usage?.costPerSuccessfulTurnUsd;
  const candidateCost =
    candidate.summary.usage?.costPerSuccessfulTurnUsd;
  if (
    !nonNegativeFinite(baselineCost) ||
    !nonNegativeFinite(candidateCost)
  ) {
    checks.push({
      id: "cost-per-successful-turn",
      category: "cost",
      status: "not_observed",
      message:
        "cost comparison not observed because one or both artifacts omit cost per successful turn",
      baseline: baselineCost ?? null,
      candidate: candidateCost ?? null,
      relativeChange: null,
    });
    return;
  }
  const relativeChange =
    baselineCost === 0
      ? candidateCost === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : (candidateCost - baselineCost) / baselineCost;
  addCheck(
    checks,
    "cost-per-successful-turn",
    "cost",
    relativeChange <= MAXIMUM_COST_REGRESSION + EPSILON,
    `candidate cost per successful turn changed ${formatPercentDelta(relativeChange)}, within ${formatPercent(MAXIMUM_COST_REGRESSION)}`,
    `candidate cost per successful turn regressed ${formatPercentDelta(relativeChange)}, exceeding ${formatPercent(MAXIMUM_COST_REGRESSION)}`,
    {
      baseline: baselineCost,
      candidate: candidateCost,
      relativeChange,
    },
  );
}

function addCheck(
  checks,
  id,
  category,
  passed,
  passedMessage,
  failedMessage,
  details = {},
) {
  checks.push({
    id,
    category,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
    ...details,
  });
}

function providerInconclusiveReasons(baseline, candidate) {
  const reasons = [];
  for (const [label, report] of [
    ["baseline", baseline],
    ["candidate", candidate],
  ]) {
    if (report.summary.infrastructureRate > MAXIMUM_INFRASTRUCTURE_RATE) {
      reasons.push(
        `${label} provider infrastructure failure rate ${formatPercent(report.summary.infrastructureRate)} exceeds ${formatPercent(MAXIMUM_INFRASTRUCTURE_RATE)}; model quality comparison is inconclusive`,
      );
    } else if (report.summary.inconclusive === true) {
      reasons.push(
        `${label} semantic artifact is marked inconclusive for provider infrastructure (${formatPercent(report.summary.infrastructureRate)} failure rate)`,
      );
    }
  }
  return reasons;
}

function summarizeInput(report) {
  if (!isRecord(report)) return null;
  return {
    schemaVersion:
      typeof report.schemaVersion === "string"
        ? report.schemaVersion
        : null,
    datasetHash:
      typeof report.corpus?.datasetHash === "string"
        ? report.corpus.datasetHash
        : null,
    caseCount:
      Number.isInteger(report.corpus?.caseCount)
        ? report.corpus.caseCount
        : null,
    attempts:
      Number.isInteger(report.corpus?.attempts)
        ? report.corpus.attempts
        : null,
    models: Array.isArray(report.versions?.models)
      ? report.versions.models.filter(
          (model) => typeof model === "string",
        )
      : [],
    prompt:
      typeof report.versions?.prompt === "string"
        ? report.versions.prompt
        : null,
    capabilityRegistry:
      typeof report.versions?.capabilityRegistry === "string"
        ? report.versions.capabilityRegistry
        : null,
    semanticPlanContract:
      typeof report.versions?.semanticPlanContract === "string"
        ? report.versions.semanticPlanContract
        : null,
  };
}

function summarizeProviderInfrastructure(report) {
  if (!isRecord(report?.summary)) {
    return {
      failures: null,
      attempts: null,
      rate: null,
      inconclusive: null,
    };
  }
  return {
    failures: nonNegativeInteger(report.summary.infrastructureFailures)
      ? report.summary.infrastructureFailures
      : null,
    attempts: nonNegativeInteger(report.summary.attempts)
      ? report.summary.attempts
      : null,
    rate: fraction(report.summary.infrastructureRate)
      ? report.summary.infrastructureRate
      : null,
    inconclusive:
      report.summary.inconclusive === true ||
      (fraction(report.summary.infrastructureRate) &&
        report.summary.infrastructureRate >
          MAXIMUM_INFRASTRUCTURE_RATE),
  };
}

function buildMetricComparison(baseline, candidate) {
  if (!isRecord(baseline?.summary) || !isRecord(candidate?.summary)) {
    return {
      coreAccuracy: emptyMetric(),
      overallAccuracy: emptyMetric(),
      policyPassingCases: emptyMetric(),
      costPerSuccessfulTurnUsd: emptyMetric(),
      criticalSlices: [],
    };
  }
  const baselineCost =
    baseline.summary.usage?.costPerSuccessfulTurnUsd ?? null;
  const candidateCost =
    candidate.summary.usage?.costPerSuccessfulTurnUsd ?? null;
  const relativeCostChange =
    nonNegativeFinite(baselineCost) &&
    nonNegativeFinite(candidateCost)
      ? baselineCost === 0
        ? candidateCost === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : (candidateCost - baselineCost) / baselineCost
      : null;
  const baselineSlices = criticalSliceMap(baseline);
  const candidateSlices = criticalSliceMap(candidate);
  return {
    coreAccuracy: metric(
      baseline.summary.coreAccuracy,
      candidate.summary.coreAccuracy,
    ),
    overallAccuracy: metric(
      baseline.summary.overallAccuracy,
      candidate.summary.overallAccuracy,
    ),
    policyPassingCases: metric(
      baseline.summary.policyPassingCases,
      candidate.summary.policyPassingCases,
    ),
    costPerSuccessfulTurnUsd: {
      baseline: baselineCost,
      candidate: candidateCost,
      delta: relativeCostChange,
      observed: relativeCostChange !== null,
    },
    criticalSlices: [...baselineSlices.entries()]
      .filter(([name]) => candidateSlices.has(name))
      .map(([name, baselineSlice]) => {
        const candidateSlice = candidateSlices.get(name);
        const drop = Math.max(
          0,
          baselineSlice.accuracy - candidateSlice.accuracy,
        );
        return {
          name,
          baseline: baselineSlice.accuracy,
          candidate: candidateSlice.accuracy,
          delta: candidateSlice.accuracy - baselineSlice.accuracy,
          absoluteDrop: drop,
          passed:
            drop <= MAXIMUM_CRITICAL_SLICE_DROP + EPSILON,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function criticalSliceMap(report) {
  return new Map(
    (report?.summary?.slices ?? [])
      .filter(
        (slice) =>
          isRecord(slice) &&
          slice.critical === true &&
          typeof slice.name === "string" &&
          fraction(slice.accuracy),
      )
      .map((slice) => [slice.name, slice]),
  );
}

function metric(baseline, candidate) {
  return {
    baseline,
    candidate,
    delta:
      typeof baseline === "number" && typeof candidate === "number"
        ? candidate - baseline
        : null,
  };
}

function emptyMetric() {
  return { baseline: null, candidate: null, delta: null };
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("now() must return a valid date");
  }
  return date.toISOString();
}

function metricRow(label, value, formatter, deltaFormatter) {
  return `| ${label} | ${formatter(value.baseline)} | ${formatter(value.candidate)} | ${deltaFormatter(value.delta)} |`;
}

function formatInfrastructure(value) {
  if (value.rate === null) return "unavailable";
  return `${value.failures}/${value.attempts} failures (${formatPercent(value.rate)})${value.inconclusive ? " — inconclusive" : ""}`;
}

function formatPercent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : "—";
}

function formatPercentagePoints(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)} pp`;
}

function formatPercentDelta(value) {
  if (value === Number.POSITIVE_INFINITY) return "+∞";
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(6)}` : "—";
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : "—";
}

function formatCountDelta(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
}

function listHtml(values) {
  const entries = values.length ? values : ["None"];
  return `<ul>${entries.map((value) => `<li>${html(value)}</li>`).join("")}</ul>`;
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function fraction(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function html(value) {
  return xml(value);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
