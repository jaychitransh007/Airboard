import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateQualityGate,
  loadQualityGateConfig,
  QualityGateConfigError,
  validateQualityGateConfig,
} from "../lib/eval-quality-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG_PATH = resolve(
  ROOT,
  "evals/quality-gates/release.v1.json",
);
const BASELINE_ARTIFACT_PATH = resolve(
  ROOT,
  "evals/quality-gates/blessed-baseline.v2.json",
);
const CONFIG = await loadQualityGateConfig(CONFIG_PATH);
const BASELINE_ARTIFACT = JSON.parse(
  await readFile(BASELINE_ARTIFACT_PATH, "utf8"),
);

test("versioned policy validates and PR config-only mode makes no evidence claim", () => {
  assert.deepEqual(validateQualityGateConfig(CONFIG), {
    valid: true,
    problems: [],
  });

  const result = evaluateQualityGate({
    config: CONFIG,
    mode: "pr",
  });
  assert.equal(result.passed, true);
  assert.equal(result.status, "config_validated");
  assert.equal(result.evaluationPerformed, false);
  assert.equal(result.evidenceAvailability, "not_asserted");
  assert.equal(result.reportProvided, false);
  assert.equal(
    result.baselineArtifactSha256,
    CONFIG.blessedBaseline.artifactSha256,
  );
  assert.equal(
    result.baselineMetricsSha256,
    CONFIG.blessedBaseline.metricsSha256,
  );
  assert.equal(result.summary.failed, 0);
  assert.ok(result.gates.every(({ status }) => status === "skipped"));
});

test("blessed baseline artifact is versioned, non-evidentiary, and loader-bound", async (t) => {
  assert.equal(
    CONFIG.blessedBaseline.provenance.evidenceArtifact,
    "blessed-baseline.v2.json",
  );
  assert.equal(
    CONFIG.blessedBaseline.provenance.assertsMediaAvailability,
    false,
  );
  assert.equal(
    CONFIG.blessedBaseline.provenance.assertsEvaluationEvidence,
    false,
  );
  assert.equal(
    BASELINE_ARTIFACT.baselineVersion,
    CONFIG.blessedBaseline.version,
  );
  assert.equal(
    BASELINE_ARTIFACT.configurationBinding.configVersion,
    CONFIG.configVersion,
  );

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "airboard-baseline-artifact-"),
  );
  try {
    await t.test("exact copied artifact loads", async () => {
      const path = await writeConfigFixture(
        temporaryRoot,
        "exact",
        CONFIG,
        BASELINE_ARTIFACT,
      );
      const loaded = await loadQualityGateConfig(path);
      assert.equal(loaded.blessedBaseline.version, CONFIG.blessedBaseline.version);
    });

    await t.test("artifact content tampering is rejected", async () => {
      const artifact = structuredClone(BASELINE_ARTIFACT);
      artifact.baselineVersion = "airboard-blessed-baseline.tampered";
      const path = await writeConfigFixture(
        temporaryRoot,
        "artifact-tamper",
        CONFIG,
        artifact,
      );
      await assert.rejects(
        () => loadQualityGateConfig(path),
        (error) =>
          error instanceof QualityGateConfigError &&
          error.problems.some((problem) => /artifact digest/u.test(problem)),
      );
    });

    await t.test("config version mismatch is rejected by artifact binding", async () => {
      const config = structuredClone(CONFIG);
      config.configVersion = "release.v1-tampered";
      const path = await writeConfigFixture(
        temporaryRoot,
        "config-version-tamper",
        config,
        BASELINE_ARTIFACT,
      );
      await assert.rejects(
        () => loadQualityGateConfig(path),
        (error) =>
          error instanceof QualityGateConfigError &&
          error.problems.some((problem) => /configVersion/u.test(problem)),
      );
    });

    await t.test("release policy mismatch is rejected by artifact binding", async () => {
      const config = structuredClone(CONFIG);
      config.releasePolicy.absoluteGates.find(
        ({ id }) => id === "semantic-core-accuracy",
      ).threshold = 0.96;
      const path = await writeConfigFixture(
        temporaryRoot,
        "policy-tamper",
        config,
        BASELINE_ARTIFACT,
      );
      await assert.rejects(
        () => loadQualityGateConfig(path),
        (error) =>
          error instanceof QualityGateConfigError &&
          error.problems.some((problem) => /releasePolicySha256/u.test(problem)),
      );
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("blessed metric shape passes every release gate", () => {
  const result = releaseResult(passingReport());
  assert.equal(result.passed, true);
  assert.equal(result.status, "passed");
  assert.equal(result.summary.failed, 0);
  assert.ok(result.summary.passed > 20);
  assert.equal(result.reportCoverage, "complete");
  assert.equal(result.evidenceAvailability, "not_asserted");
});

test("generic evaluator accepts a flat dotted-path metric report", () => {
  const nested = passingReport();
  const result = releaseResult({
    ...nested,
    metrics: flattenMetrics(nested.metrics),
  });
  assert.equal(result.passed, true);
  assert.equal(result.summary.failed, 0);
});

test("ambiguous mixed metric representations fail closed instead of shadowing values", async (t) => {
  await t.test("flat scalar cannot shadow a nested regression", () => {
    const report = passingReport();
    report.metrics.contract.passRate = 0;
    report.metrics["contract.passRate"] = 1;
    const result = releaseResult(report);
    assert.equal(result.passed, false);
    assert.equal(
      gate(result, "report-representation").code,
      "ambiguous_metric_representation",
    );
  });

  await t.test("nested slices cannot hide a bad dotted extra slice", () => {
    const report = passingReport();
    report.metrics["semantic.slices.hidden_bad.accuracy"] = 0;
    const result = releaseResult(report);
    assert.equal(result.passed, false);
    assert.equal(
      gate(result, "report-representation").code,
      "ambiguous_metric_representation",
    );
  });
});

test("seeded headline regressions trip every absolute release gate", async (t) => {
  const faults = [
    ["contract.passRate", 0.999, "contract-pass-rate"],
    ["safety.passRate", 0.999, "safety-pass-rate"],
    ["atomicity.passRate", 0.999, "atomicity-pass-rate"],
    ["undo.passRate", 0.999, "undo-pass-rate"],
    ["semantic.coreAccuracy", 0.949, "semantic-core-accuracy"],
    ["semantic.overallAccuracy", 0.899, "semantic-overall-accuracy"],
    ["gesture.precision", 0.949, "gesture-precision"],
    ["gesture.recall", 0.899, "gesture-recall"],
    ["gesture.duplicateRate", 0.01, "gesture-duplicate-rate"],
    [
      "gesture.criticalFalseTriggerCount",
      1,
      "gesture-critical-false-triggers",
    ],
    [
      "gesture.acquireLatencyP95Ms",
      500.01,
      "gesture-acquire-latency-p95",
    ],
    [
      "gesture.releaseLatencyP95Ms",
      300.01,
      "gesture-release-latency-p95",
    ],
    [
      "gesture.frameProcessingP95Ms",
      33.35,
      "gesture-frame-processing-p95",
    ],
    ["stt.criticalTokenRecall", 0.969, "stt-critical-token-recall"],
    [
      "latency.deterministicEndToActionP95Ms",
      1_000,
      "deterministic-end-to-action-p95",
    ],
    [
      "latency.semanticEndToActionP95Ms",
      2_500,
      "semantic-end-to-action-p95",
    ],
    ["ambient.actionCount", 1, "ambient-action-count"],
    ["ambient.observedHours", 29.99, "ambient-observed-hours"],
  ];

  for (const [path, value, expectedGate] of faults) {
    await t.test(path, () => {
      const report = passingReport();
      setPath(report.metrics, path, value);
      const result = releaseResult(report);
      assert.equal(result.passed, false);
      assert.equal(gate(result, expectedGate).status, "failed");
    });
  }
});

test("seeded slice regressions enforce floors, required slices, and extra slices", async (t) => {
  await t.test("semantic floor", () => {
    const report = passingReport();
    report.metrics.semantic.slices.compound_commands.accuracy = 0.849;
    const result = releaseResult(report);
    assert.equal(
      gate(result, "semantic-slice-floor:compound_commands").code,
      "slice_floor_regression",
    );
  });

  await t.test("gesture floor", () => {
    const report = passingReport();
    report.metrics.gesture.slices.core_lighting.score = 0.849;
    const result = releaseResult(report);
    assert.equal(
      gate(result, "gesture-slice-floor:core_lighting").code,
      "slice_floor_regression",
    );
  });

  await t.test("required non-critical slice cannot be omitted", () => {
    const report = passingReport();
    delete report.metrics.semantic.slices.compound_commands;
    const result = releaseResult(report);
    assert.equal(
      gate(result, "semantic-slice-floor:compound_commands").code,
      "missing_required_slice",
    );
  });

  await t.test("reported extra slices cannot hide below the floor", () => {
    const report = passingReport();
    report.metrics.gesture.slices.new_device = { score: 0.7 };
    const result = releaseResult(report);
    assert.equal(
      gate(result, "gesture-slice-floor:new_device").code,
      "slice_floor_regression",
    );
  });
});

test("cost and critical-slice comparison budgets include their exact boundary", async (t) => {
  await t.test("cost allows exactly ten percent and rejects more", () => {
    const baseline = CONFIG.blessedBaseline.metrics.cost.costPerSuccessUsd;
    const boundary = passingReport();
    boundary.metrics.cost.costPerSuccessUsd = baseline * 1.1;
    assert.equal(
      gate(
        releaseResult(boundary),
        "cost-per-success-regression",
      ).status,
      "passed",
    );

    const regression = passingReport();
    regression.metrics.cost.costPerSuccessUsd = baseline * 1.101;
    const result = releaseResult(regression);
    assert.equal(result.passed, false);
    assert.equal(
      gate(result, "cost-per-success-regression").code,
      "baseline_regression",
    );
  });

  await t.test("semantic critical slice allows three points and rejects more", () => {
    const baseline =
      CONFIG.blessedBaseline.metrics.semantic.slices.clarification.accuracy;
    const boundary = passingReport();
    boundary.metrics.semantic.slices.clarification.accuracy = baseline - 0.03;
    assert.equal(
      gate(
        releaseResult(boundary),
        "semantic-critical-slice-regression:clarification",
      ).status,
      "passed",
    );

    const regression = passingReport();
    regression.metrics.semantic.slices.clarification.accuracy =
      baseline - 0.0301;
    assert.equal(
      gate(
        releaseResult(regression),
        "semantic-critical-slice-regression:clarification",
      ).code,
      "critical_slice_regression",
    );
  });

  await t.test("gesture critical slice rejects a greater-than-three-point drop", () => {
    const report = passingReport();
    const baseline =
      CONFIG.blessedBaseline.metrics.gesture.slices.two_hand.score;
    report.metrics.gesture.slices.two_hand.score = baseline - 0.031;
    assert.equal(
      gate(
        releaseResult(report),
        "gesture-critical-slice-regression:two_hand",
      ).code,
      "critical_slice_regression",
    );
  });
});

test("critical-slice regression follows dynamic candidate declarations and fails closed without a baseline", async (t) => {
  await t.test("newly critical known slice is compared to its blessed score", () => {
    const report = passingReport();
    const baseline =
      CONFIG.blessedBaseline.metrics.semantic.slices.compound_commands
        .accuracy;
    report.metrics.semantic.slices.compound_commands = {
      accuracy: baseline - 0.0301,
      critical: true,
    };
    const result = releaseResult(report);
    const dynamicGate = gate(
      result,
      "semantic-critical-slice-regression:compound_commands",
    );
    assert.equal(dynamicGate.code, "critical_slice_regression");
    assert.deepEqual(dynamicGate.criticalSources, ["candidate"]);
  });

  await t.test("new critical slice without blessed reference is blocking", () => {
    const report = passingReport();
    report.metrics.semantic.slices.new_critical_slice = {
      accuracy: 0.99,
      critical: true,
    };
    const result = releaseResult(report);
    assert.equal(result.passed, false);
    const dynamicGate = gate(
      result,
      "semantic-critical-slice-regression:new_critical_slice",
    );
    assert.equal(dynamicGate.code, "missing_blessed_critical_slice");
    assert.deepEqual(dynamicGate.criticalSources, ["candidate"]);
  });

  await t.test("missing blessed reference also fails closed in PR mode", () => {
    const report = {
      schemaVersion: "airboard-quality-report.v1",
      metrics: {
        semantic: {
          slices: {
            newly_critical: {
              accuracy: 1,
              critical: true,
            },
          },
        },
      },
    };
    const result = evaluateQualityGate({
      config: CONFIG,
      report,
      mode: "pr",
    });
    assert.equal(result.passed, false);
    assert.equal(
      gate(
        result,
        "semantic-critical-slice-regression:newly_critical",
      ).code,
      "missing_blessed_critical_slice",
    );
  });
});

test("release mode fails closed on missing reports, metrics, and critical slices", async (t) => {
  await t.test("no report", () => {
    const result = evaluateQualityGate({
      config: CONFIG,
      mode: "release",
    });
    assert.equal(result.passed, false);
    assert.equal(result.evidenceAvailability, "not_asserted");
    assert.equal(result.reportAvailability, "missing");
    assert.ok(result.summary.failed >= 18);
    assert.ok(
      result.gates.some(
        ({ code }) => code === "missing_required_metric",
      ),
    );
  });

  await t.test("required metric missing", () => {
    const report = passingReport();
    delete report.metrics.stt.criticalTokenRecall;
    const result = releaseResult(report);
    assert.equal(result.passed, false);
    assert.equal(
      gate(result, "required:stt.criticalTokenRecall").code,
      "missing_required_metric",
    );
  });

  await t.test("critical slice missing", () => {
    const report = passingReport();
    delete report.metrics.gesture.slices.tracking_loss;
    const result = releaseResult(report);
    assert.equal(result.passed, false);
    assert.equal(
      gate(
        result,
        "gesture-critical-slice-regression:tracking_loss",
      ).code,
      "missing_critical_slice",
    );
  });
});

test("malformed candidate metrics fail instead of becoming skipped", () => {
  const report = passingReport();
  report.metrics.semantic.coreAccuracy = "0.99";
  report.metrics.ambient.actionCount = 0.5;
  report.metrics.gesture.slices.low_light.score = Number.NaN;
  const result = releaseResult(report);
  assert.equal(result.passed, false);
  assert.equal(gate(result, "semantic-core-accuracy").code, "invalid_metric");
  assert.equal(gate(result, "ambient-action-count").code, "invalid_metric");
  assert.equal(
    gate(result, "gesture-slice-floor:low_light").code,
    "invalid_metric",
  );
});

test("config validation rejects weakened or incomplete safety policy", async (t) => {
  await t.test("weakened core threshold", () => {
    const config = structuredClone(CONFIG);
    config.releasePolicy.absoluteGates.find(
      ({ id }) => id === "semantic-core-accuracy",
    ).threshold = 0.94;
    assert.throws(
      () =>
        evaluateQualityGate({
          config,
          report: passingReport(),
          mode: "release",
        }),
      (error) =>
        error instanceof QualityGateConfigError &&
        error.problems.some((problem) => /weakens required/u.test(problem)),
    );
  });

  await t.test("noncritical pinned slice removed from required coverage", () => {
    const config = structuredClone(CONFIG);
    config.releasePolicy.sliceGates
      .find(({ id }) => id === "semantic-slice-floor")
      .requiredSliceIds =
      config.releasePolicy.sliceGates
        .find(({ id }) => id === "semantic-slice-floor")
        .requiredSliceIds.filter(
          (sliceId) => sliceId !== "compound_commands",
        );
    const validation = validateQualityGateConfig(config);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.problems.some((problem) =>
        /must require pinned slice compound_commands/u.test(problem),
      ),
    );
  });

  await t.test("critical identities cannot be edited out of the gate", () => {
    const config = structuredClone(CONFIG);
    config.releasePolicy.baselineGates.find(
      ({ id }) => id === "gesture-critical-slice-regression",
    ).criticalSliceIds = ["low_light"];
    const validation = validateQualityGateConfig(config);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.problems.some((problem) =>
        /must match pinned critical slices/u.test(problem),
      ),
    );
  });

  await t.test("baseline values cannot be rebased under the same version", () => {
    const config = structuredClone(CONFIG);
    config.blessedBaseline.metrics.cost.costPerSuccessUsd = 100;
    config.blessedBaseline.metricsSha256 = canonicalSha256(
      config.blessedBaseline.metrics,
    );
    const validation = validateQualityGateConfig(config);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.problems.some((problem) => /must use pinned digest/u.test(problem)),
    );
  });

  await t.test("baseline media claim", () => {
    const config = structuredClone(CONFIG);
    config.blessedBaseline.provenance.assertsMediaAvailability = true;
    assert.equal(validateQualityGateConfig(config).valid, false);
  });
});

test("empty and partial PR reports remain explicitly non-evidentiary", async (t) => {
  await t.test("empty report remains config-only", () => {
    const result = evaluateQualityGate({
      config: CONFIG,
      mode: "pr",
      report: {
        schemaVersion: "airboard-quality-report.v1",
        metrics: {},
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.status, "config_validated");
    assert.equal(result.evaluationPerformed, false);
    assert.equal(result.evidenceAvailability, "not_asserted");
    assert.equal(result.reportAvailability, "supplied");
    assert.equal(result.reportCoverage, "none");
  });

  await t.test("partial report evaluates present metrics without an evidence claim", () => {
    const result = evaluateQualityGate({
      config: CONFIG,
      mode: "pr",
      report: {
        schemaVersion: "airboard-quality-report.v1",
        metrics: {
          "contract.passRate": 1,
        },
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.status, "passed");
    assert.equal(result.evaluationPerformed, true);
    assert.equal(result.evidenceAvailability, "not_asserted");
    assert.equal(result.reportCoverage, "partial");
  });
});

test("CLI supports config-only PR validation and release pass/fail exit codes", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "airboard-quality-gate-"),
  );
  try {
    const passPath = join(temporaryRoot, "passing.json");
    const failPath = join(temporaryRoot, "regression.json");
    const outputPath = join(temporaryRoot, "result.json");
    await writeFile(passPath, JSON.stringify(passingReport()));
    const regression = passingReport();
    regression.metrics.gesture.duplicateRate = 0.01;
    await writeFile(failPath, JSON.stringify(regression));

    const pr = runCli(["--mode", "pr"]);
    assert.equal(pr.status, 0, pr.stderr || pr.stdout);
    assert.match(pr.stdout, /media availability not asserted/u);

    const pass = runCli([
      "--mode",
      "release",
      "--report",
      passPath,
      "--output",
      outputPath,
    ]);
    assert.equal(pass.status, 0, pass.stderr || pass.stdout);
    assert.match(pass.stdout, /quality gate: PASS/u);

    const fail = runCli([
      "--mode=release",
      `--report=${failPath}`,
    ]);
    assert.equal(fail.status, 1, fail.stderr || fail.stdout);
    assert.match(fail.stdout, /gesture-duplicate-rate/u);

    const missing = runCli(["--mode", "release"]);
    assert.equal(missing.status, 1, missing.stderr || missing.stdout);
    assert.match(missing.stdout, /missing/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function passingReport() {
  return {
    schemaVersion: "airboard-quality-report.v1",
    runId: "synthetic-quality-control",
    metrics: structuredClone(CONFIG.blessedBaseline.metrics),
  };
}

function releaseResult(report) {
  return evaluateQualityGate({
    config: CONFIG,
    report,
    mode: "release",
  });
}

function gate(result, id) {
  const found = result.gates.find((candidate) => candidate.id === id);
  assert.ok(found, `missing gate result ${id}`);
  return found;
}

function setPath(object, path, value) {
  const segments = path.split(".");
  const leaf = segments.pop();
  let target = object;
  for (const segment of segments) {
    target = target[segment];
  }
  target[leaf] = value;
}

function flattenMetrics(value, prefix = "", output = {}) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry)
    ) {
      flattenMetrics(entry, path, output);
    } else {
      output[path] = entry;
    }
  }
  return output;
}

function canonicalSha256(value) {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    )
    .join(",")}}`;
}

function runCli(args) {
  return spawnSync(
    process.execPath,
    ["scripts/eval-quality-gate.mjs", ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
}

async function writeConfigFixture(root, name, config, artifact) {
  const directory = join(root, name);
  const configPath = join(directory, "release.v1.json");
  await mkdir(directory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(
    join(directory, config.blessedBaseline.artifactPath),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  return configPath;
}
