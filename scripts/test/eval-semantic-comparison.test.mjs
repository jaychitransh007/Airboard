import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  compareSemanticEvalReports,
  SEMANTIC_COMPARISON_SCHEMA_VERSION,
  semanticComparisonJUnit,
  writeSemanticComparisonReports,
} from "../lib/eval-semantic-comparison.mjs";

const FIXED_NOW = () => new Date("2026-07-30T12:00:00.000Z");

test("matching runs pass at exact regression and cost boundaries", () => {
  const baseline = reportFixture({
    coreAccuracy: 0.97,
    overallAccuracy: 0.94,
    cost: 0.01,
    criticalAccuracy: 0.96,
  });
  const candidate = reportFixture({
    coreAccuracy: 0.95,
    overallAccuracy: 0.9,
    cost: 0.011,
    criticalAccuracy: 0.93,
    model: "candidate",
  });
  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    replay: "node scripts/eval-semantic-comparison.mjs",
    now: FIXED_NOW,
  });

  assert.equal(report.schemaVersion, SEMANTIC_COMPARISON_SCHEMA_VERSION);
  assert.equal(report.status, "passed");
  assert.equal(report.compatibility.comparable, true);
  assert.equal(report.failures.length, 0);
  assert.ok(
    Math.abs(report.metrics.criticalSlices[0].absoluteDrop - 0.03) <
      1e-12,
  );
  assert.equal(check(report, "cost-per-successful-turn").status, "passed");
  assert.equal(check(report, "candidate-repetition-policy").status, "passed");
});

test("comparison rejects mismatched corpora and candidate quality regressions", () => {
  const baseline = reportFixture({
    datasetHash: "sha256:baseline",
    coreAccuracy: 0.99,
    overallAccuracy: 0.98,
    cost: 0.01,
    criticalAccuracy: 0.97,
  });
  const candidate = reportFixture({
    datasetHash: "sha256:candidate",
    coreAccuracy: 0.949,
    overallAccuracy: 0.899,
    cost: 0.01101,
    criticalAccuracy: 0.939,
    policyPassingCases: 9,
  });
  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    now: FIXED_NOW,
  });

  assert.equal(report.status, "failed");
  assert.equal(report.compatibility.comparable, false);
  assert.equal(check(report, "same-dataset-hash").status, "failed");
  assert.equal(check(report, "candidate-core-accuracy").status, "failed");
  assert.equal(check(report, "candidate-overall-accuracy").status, "failed");
  assert.equal(check(report, "candidate-repetition-policy").status, "failed");
  assert.equal(check(report, "critical-slice:status:resolved").status, "failed");
  assert.equal(check(report, "cost-per-successful-turn").status, "failed");
});

test("comparison requires identical production corpus and contract versions", () => {
  const baseline = reportFixture({});
  const candidate = reportFixture({ model: "candidate" });
  candidate.corpus.schemaVersion = "2.0";
  candidate.versions.semanticPlanContract = "1.2";
  candidate.versions.capabilityRegistry = "2.0";
  candidate.versions.prompt = "2.5";

  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    now: FIXED_NOW,
  });

  assert.equal(report.status, "failed");
  assert.equal(check(report, "same-corpus-schema").status, "failed");
  assert.equal(check(report, "same-plan-contract").status, "failed");
  assert.equal(check(report, "same-capability-registry").status, "failed");
  assert.equal(check(report, "same-prompt").status, "failed");
});

test("provider infrastructure is inconclusive instead of a quality failure", () => {
  const baseline = reportFixture({});
  const candidate = reportFixture({
    infrastructureFailures: 2,
    infrastructureRate: 0.067,
    inconclusive: true,
    policyPassingCases: 9,
  });
  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    now: FIXED_NOW,
  });

  assert.equal(report.status, "inconclusive");
  assert.equal(report.failures.length, 0);
  assert.equal(report.providerInfrastructure.inconclusive, true);
  assert.equal(report.inconclusiveReasons.length, 1);
  assert.equal(report.deferredQualityFailures.length, 1);
  assert.equal(
    check(report, "candidate-repetition-policy").status,
    "failed",
  );
  assert.match(report.inconclusiveReasons[0], /candidate provider infrastructure/u);
  const junit = semanticComparisonJUnit(report);
  assert.match(junit, /errors="1"/u);
  assert.match(junit, /failures="0"/u);
  assert.match(junit, /skipped="1"/u);
  assert.match(junit, /type="provider_infrastructure"/u);
});

test("cost is diagnostic when either artifact omits pricing", () => {
  const report = compareSemanticEvalReports({
    baseline: reportFixture({ cost: null }),
    candidate: reportFixture({ cost: 0.02 }),
    now: FIXED_NOW,
  });
  assert.equal(report.status, "passed");
  assert.equal(
    check(report, "cost-per-successful-turn").status,
    "not_observed",
  );
  assert.equal(
    report.metrics.costPerSuccessfulTurnUsd.observed,
    false,
  );
});

test("malformed artifacts fail closed without exposing case payloads", () => {
  const baseline = reportFixture({});
  const candidate = reportFixture({});
  delete candidate.summary.slices;
  candidate.results = [
    {
      caseId: "private-case",
      transcript: "customer secret",
    },
  ];
  const report = compareSemanticEvalReports({
    baseline,
    candidate,
    now: FIXED_NOW,
  });
  assert.equal(report.status, "failed");
  assert.ok(
    report.failures.some((failure) =>
      failure.includes("candidate summary.slices"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(report), /customer secret/u);
  assert.doesNotMatch(JSON.stringify(report), /private-case/u);
});

test("writer emits privacy-safe JSON, JUnit, Markdown, and HTML", async (t) => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "airboard-semantic-comparison-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPrefix = resolve(directory, "reports/semantic-comparison");
  const report = compareSemanticEvalReports({
    baseline: reportFixture({}),
    candidate: reportFixture({ model: "candidate" }),
    replay: "node replay",
    now: FIXED_NOW,
  });
  const paths = await writeSemanticComparisonReports({
    report,
    outputPrefix,
  });

  await Promise.all(Object.values(paths).map((path) => access(path)));
  const json = JSON.parse(await readFile(paths.json, "utf8"));
  assert.equal(json.status, "passed");
  assert.match(await readFile(paths.junit, "utf8"), /<testsuite/u);
  assert.match(await readFile(paths.markdown, "utf8"), /Replay: `node replay`/u);
  assert.match(await readFile(paths.html, "utf8"), /semantic model comparison/u);
});

function reportFixture({
  datasetHash = "sha256:fixture",
  caseCount = 10,
  attempts = 3,
  coreAccuracy = 0.98,
  overallAccuracy = 0.96,
  policyPassingCases = caseCount,
  cost = 0.01,
  criticalAccuracy = 0.96,
  infrastructureFailures = 0,
  infrastructureRate = 0,
  inconclusive = false,
  model = "baseline",
} = {}) {
  return {
    schemaVersion: "airboard-semantic-eval-result.v1",
    generatedAt: "2026-07-30T10:00:00.000Z",
    corpus: {
      schemaVersion: "1.0",
      kind: "metamorphic",
      caseCount,
      attempts,
      datasetHash,
    },
    versions: {
      semanticPlanContract: "1.1",
      capabilityRegistry: "1.0",
      prompt: "2.4",
      models: [model],
    },
    summary: {
      attempts: caseCount * attempts,
      passed: caseCount * attempts,
      failed: 0,
      policyPassingCases,
      totalCases: caseCount,
      coreAccuracy,
      overallAccuracy,
      infrastructureFailures,
      infrastructureRate,
      inconclusive,
      slices: [
        {
          name: "status:resolved",
          critical: true,
          total: caseCount * attempts,
          passed: Math.round(caseCount * attempts * criticalAccuracy),
          accuracy: criticalAccuracy,
        },
        {
          name: "parser:unsupported_count",
          critical: false,
          total: attempts,
          passed: attempts,
          accuracy: 1,
        },
      ],
      usage: {
        costPerSuccessfulTurnUsd: cost,
      },
    },
    results: [],
    replay: "node semantic-runner",
  };
}

function check(report, id) {
  const value = report.checks.find((entry) => entry.id === id);
  assert.ok(value, `missing check ${id}`);
  return value;
}
