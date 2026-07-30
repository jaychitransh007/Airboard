import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  aggregateQualityArtifacts,
  QUALITY_REPORT_SCHEMA_VERSION,
} from "../lib/eval-quality-report.mjs";
import {
  evaluateQualityGate,
  loadQualityGateConfig,
} from "../lib/eval-quality-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = await loadQualityGateConfig(
  resolve(ROOT, "evals/quality-gates/release.v1.json"),
);
const FIXED_NOW = () => new Date("2026-07-30T10:00:00.000Z");

test("PR aggregation is explicitly config-only and asserts no protected evidence", async () => {
  const report = await aggregateQualityArtifacts({
    qualityGateConfig: CONFIG,
    mode: "pr",
    now: FIXED_NOW,
  });
  assert.equal(report.schemaVersion, QUALITY_REPORT_SCHEMA_VERSION);
  assert.equal(report.status, "config_only");
  assert.deepEqual(report.metrics, {});
  assert.equal(report.evidence.assertion, "config_only");
  assert.equal(report.evidence.protectedMediaAvailability, "not_asserted");
  assert.equal(report.evidence.participantCoverage, "not_asserted");
  assert.equal(report.evidence.observedHours, "not_asserted");
});

test("complete release artifacts produce every provider-neutral gate metric", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeArtifacts(directory, completeArtifacts());
  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });

  assert.equal(report.status, "complete");
  assert.deepEqual(report.evidence.issues, []);
  assert.equal(report.metrics.contract.passRate, 1);
  assert.equal(report.metrics.safety.passRate, 1);
  assert.equal(report.metrics.atomicity.passRate, 1);
  assert.equal(report.metrics.undo.passRate, 1);
  assert.equal(report.metrics.semantic.coreAccuracy, 0.98);
  assert.equal(report.metrics.semantic.overallAccuracy, 0.96);
  assert.equal(report.metrics.semantic.slices.clarification.accuracy, 0.98);
  assert.equal(report.metrics.semantic.slices.compound_commands.accuracy, 0.96);
  assert.equal(report.metrics.semantic.slices.indian_english.accuracy, 0.95);
  assert.equal(report.metrics.semantic.slices.non_board_speech.accuracy, 1);
  assert.equal(report.metrics.stt.criticalTokenRecall, 0.99);
  assert.equal(report.metrics.ambient.actionCount, 0);
  assert.equal(report.metrics.ambient.observedHours, 30);
  assert.equal(report.metrics.gesture.precision, 0.98);
  assert.equal(report.metrics.gesture.criticalFalseTriggerCount, 0);
  assert.equal(report.metrics.gesture.acquireLatencyP95Ms, 100);
  assert.equal(report.metrics.gesture.releaseLatencyP95Ms, 100);
  assert.equal(report.metrics.gesture.frameProcessingP95Ms, 8);
  assert.equal(report.metrics.latency.deterministicEndToActionP95Ms, 800);
  assert.equal(report.metrics.latency.semanticEndToActionP95Ms, 2_200);
  assert.equal(
    report.diagnostics.audioSemanticEndToActionP95Ms,
    2_200,
  );
  assert.equal(report.metrics.cost.costPerSuccessUsd, 0.006);
  assert.equal(
    evaluateQualityGate({
      config: CONFIG,
      report,
      mode: "release",
    }).passed,
    true,
  );
});

test("passing harness fixtures cannot satisfy release interaction gates", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  for (const result of artifacts.interaction.results) {
    result.evidenceProvenance = {
      class: "harness-fixture",
      releaseEligible: false,
      timedInput: true,
      timedInputCount: 1,
      routeObservation: "fixture_inferred",
      outcomeObservation: "production_reducer",
      components: ["commitCommandTurn", "applyDiagramUndo"],
      reason: "Pre-grounded fixture command.",
    };
  }
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });

  assert.equal(report.status, "incomplete");
  assert.equal(report.metrics.contract, undefined);
  assert.equal(report.metrics.safety, undefined);
  assert.equal(report.metrics.atomicity, undefined);
  assert.equal(report.metrics.undo, undefined);
  assert.deepEqual(
    report.evidence.issues
      .filter(({ code }) => code === "missing_production_route_evidence")
      .map(({ path }) => path)
      .sort(),
    [
      "results[atomicity]",
      "results[contract]",
      "results[safety]",
      "results[undo]",
    ],
  );
});

test("a releaseEligible claim without observed route and outcome is rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  const claimed = artifacts.interaction.results[0];
  claimed.evidenceProvenance.routeObservation = "fixture_inferred";
  delete claimed.observed.route;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });

  assert.equal(report.status, "incomplete");
  assert.ok(
    report.evidence.issues.some(
      ({ code, source }) =>
        code === "invalid_interaction_evidence_provenance" &&
        source === "interaction",
    ),
  );
  assert.ok(
    report.evidence.issues.some(
      ({ code, path }) =>
        code === "missing_production_route_evidence" &&
        path === "results[atomicity]",
    ),
  );
});

test("release aggregation fails closed when source artifacts are absent", async (t) => {
  const directory = await temporaryDirectory(t);
  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });

  assert.equal(report.status, "incomplete");
  assert.equal(Object.keys(report.evidence.sources).length, 6);
  assert.ok(
    report.evidence.issues.some(
      ({ code, source }) =>
        code === "missing_artifact" && source === "audio",
    ),
  );
  assert.ok(
    report.evidence.issues.some(
      ({ code, path }) =>
        code === "missing_required_metric" &&
        path === "ambient.observedHours",
    ),
  );
  assert.equal(
    evaluateQualityGate({
      config: CONFIG,
      report,
      mode: "release",
    }).passed,
    false,
  );
});

test("media hours and participant coverage are never inferred from passing cases", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  delete artifacts.audio.coverage;
  delete artifacts.gesture.coverage;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.evidence.protectedMediaAvailability, "incomplete");
  assert.equal(report.evidence.participantCoverage, "incomplete");
  assert.equal(report.evidence.observedHours, "incomplete");
  assert.equal(Object.hasOwn(report.evidence.media.audio, "speakerCount"), false);
  assert.equal(
    Object.hasOwn(report.evidence.media.audio, "ambientObservedHours"),
    false,
  );
  assert.equal(
    Object.hasOwn(report.evidence.media.gesture, "participantCount"),
    false,
  );
  assert.equal(report.metrics.ambient?.observedHours, undefined);
  assert.ok(
    report.evidence.issues.some(
      ({ code, source, path }) =>
        code === "missing_release_coverage" &&
        source === "gesture" &&
        path === "coverage.participantCount",
    ),
  );
});

test("unevaluated gesture assets and missing required slices reject release evidence", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  artifacts.gesture.summary.unevaluatedAssets = 1;
  delete artifacts.gesture.metrics.slices.two_hand;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });
  assert.equal(report.status, "incomplete");
  assert.ok(
    report.evidence.issues.some(
      ({ code }) => code === "unevaluated_gesture_assets",
    ),
  );
  assert.ok(
    report.evidence.issues.some(
      ({ code, path }) =>
        code === "missing_required_slice" &&
        path === "gesture.slices.two_hand",
    ),
  );
});

test("declared browser gesture media requires accepted per-run replay evidence", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  artifacts.gesture.summary.browserEvaluatedAssets = 0;
  artifacts.gesture.summary.delegatedBrowserAssets = 48;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });
  assert.equal(report.status, "incomplete");
  assert.ok(
    report.evidence.issues.some(
      ({ code, source }) =>
        code === "incomplete_browser_gesture_evidence" &&
        source === "gesture",
    ),
  );
});

test("release evidence cannot omit browser replay completeness fields", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  delete artifacts.gesture.summary.declaredBrowserAssets;
  delete artifacts.gesture.summary.browserEvaluatedAssets;
  delete artifacts.gesture.summary.delegatedBrowserAssets;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });
  assert.equal(report.status, "incomplete");
  assert.ok(
    report.evidence.issues.some(
      ({ code }) => code === "missing_browser_gesture_evidence_summary",
    ),
  );
});

test("provider infrastructure failures remain distinct and mark the aggregate inconclusive", async (t) => {
  const directory = await temporaryDirectory(t);
  const artifacts = completeArtifacts();
  artifacts.semanticMetamorphic.summary.infrastructureFailures = 2;
  artifacts.semanticMetamorphic.summary.infrastructureRate = 0.2;
  artifacts.semanticMetamorphic.summary.inconclusive = true;
  await writeArtifacts(directory, artifacts);

  const report = await aggregateQualityArtifacts({
    artifactRoot: directory,
    qualityGateConfig: CONFIG,
    mode: "release",
    now: FIXED_NOW,
  });
  assert.equal(report.status, "inconclusive");
  assert.equal(
    report.evidence.sources.semanticMetamorphic.availability,
    "inconclusive",
  );
  assert.ok(
    report.evidence.issues.some(
      ({ code }) => code === "provider_run_inconclusive",
    ),
  );
});

function completeArtifacts() {
  return {
    interaction: {
      schemaVersion: "interaction-eval-report.v1",
      summary: {
        total: 2,
        passed: 2,
        failed: 0,
        errors: 0,
        skipped: 0,
        passRate: 1,
        deterministicEndToActionP95Ms: 800,
      },
      metadata: { datasetHash: "sha256:interaction" },
      results: [
        {
          caseId: "atomic-undo",
          status: "passed",
          capabilities: [
            "contract:exact-once",
            "contract:forbidden-mutations",
            "contract:undo-round-trip",
          ],
          evidenceProvenance: productionRouteProvenance([
            "VoiceCommandRouter",
            "commitCommandTurn",
            "applyDiagramUndo",
          ]),
          observed: {
            outcome: "applied",
            route: { channel: "voice", activation: "wake" },
            processingPath: [
              "voice",
              "deterministic_parser",
              "atomic_transaction",
            ],
          },
        },
        {
          caseId: "safety",
          status: "passed",
          capabilities: ["contract:forbidden-mutations"],
          evidenceProvenance: productionRouteProvenance([
            "VoiceCommandRouter",
          ]),
          observed: {
            outcome: "no-op",
            route: { channel: "voice", activation: "none" },
            processingPath: ["voice", "route_rejected"],
          },
        },
      ],
    },
    semanticContract: semanticReport({
      kind: "contract",
      coreAccuracy: 1,
      overallAccuracy: 1,
      slices: [
        {
          name: "status:clarification",
          accuracy: 0.98,
          critical: true,
          total: 10,
        },
      ],
    }),
    semanticMetamorphic: semanticReport({
      kind: "metamorphic",
      coreAccuracy: 0.98,
      overallAccuracy: 0.96,
      semanticEndToActionP95Ms: 2_000,
      slices: [
        {
          name: "compound_commands",
          accuracy: 0.96,
          critical: true,
          total: 30,
        },
        {
          name: "accent:indian_english",
          accuracy: 0.95,
          critical: true,
          total: 25,
        },
      ],
      usage: { costPerSuccessfulTurnUsd: 0.006 },
    }),
    semanticAmbient: {
      ...semanticReport({
        kind: "ambient-safety",
        coreAccuracy: 1,
        overallAccuracy: 1,
        slices: [
          {
            name: "safety:ambient",
            accuracy: 1,
            critical: true,
            total: 100,
          },
        ],
      }),
      results: Array.from({ length: 3 }, (_, index) => ({
        caseId: `ambient-${index}`,
        passed: true,
        plan: { status: "unsupported", actions: [] },
      })),
    },
    audio: {
      schemaVersion: "airboard-audio-stt-eval-result.v1",
      summary: { total: 100, passed: 100, failed: 0, skipped: 0 },
      aggregate: {
        criticalTokenRecall: 0.99,
        downstreamActionCorrectness: 0.96,
        coreActionCorrectness: 0.98,
        safetyActionPrecision: 1,
        hardFalseActions: 0,
        providerFailures: 0,
        providerFailureRate: 0,
        deterministicEndToActionP95Ms: 800,
        semanticEndToActionP95Ms: 2_200,
      },
      coverage: {
        speakerCount: 24,
        indianEnglishSpeakerCount: 8,
        ambientObservedHours: 30,
      },
      metadata: {
        datasetHash: "sha256:audio",
        adapters: ["live-websocket"],
        datasetSplit: "holdout",
      },
      results: [],
    },
    gesture: {
      schemaVersion: "airboard-gesture-eval-result.v1",
      datasetHash: "sha256:gesture",
      mode: "release",
      datasetSplit: "holdout",
      gateFailures: [],
      browserEvidence: {
        required: true,
        supplied: true,
        runBound: true,
      },
      summary: {
        totalAssets: 96,
        evaluatedAssets: 96,
        passedAssets: 96,
        failedAssets: 0,
        unevaluatedAssets: 0,
        declaredBrowserAssets: 48,
        browserEvaluatedAssets: 48,
        delegatedBrowserAssets: 0,
        expectedActionCount: 100,
        actualActionCount: 100,
        matchedActionCount: 98,
      },
      metrics: {
        precision: 0.98,
        recall: 0.98,
        duplicateRate: 0,
        criticalFalseTriggerCount: 0,
        acquireLatencyP95Ms: 100,
        releaseLatencyP95Ms: 100,
        frameProcessingP95Ms: 8,
        slices: Object.fromEntries(
          [
            "core_lighting",
            "low_light",
            "tracking_loss",
            "two_hand",
          ].map((id) => [
            id,
            { score: 0.96, critical: id !== "core_lighting", count: 24 },
          ]),
        ),
      },
      coverage: {
        participantCount: 24,
        minimumValidRepetitionsPerGesturePerCoreCondition: 3,
        neutralMinutesPerParticipantMinimum: 10,
      },
      results: [],
    },
  };
}

function semanticReport({
  kind,
  coreAccuracy,
  overallAccuracy,
  semanticEndToActionP95Ms,
  slices,
  usage,
}) {
  return {
    schemaVersion: "airboard-semantic-eval-result.v1",
    corpus: {
      kind,
      caseCount:
        kind === "metamorphic"
          ? 465
          : kind === "ambient-safety"
            ? 56
            : 13,
      attempts: 5,
      datasetHash: `sha256:${kind}`,
    },
    versions: {
      providers: ["fixture-provider"],
      models: ["fixture-model"],
    },
    summary: {
      attempts: 10,
      passed: 10,
      failed: 0,
      qualityAttempts: 10,
      infrastructureFailures: 0,
      infrastructureRate: 0,
      failures: [],
      coreAccuracy,
      overallAccuracy,
      slices,
      ...(semanticEndToActionP95Ms === undefined
        ? {}
        : { semanticEndToActionP95Ms }),
      ...(usage === undefined ? {} : { usage }),
    },
    results: [],
  };
}

function productionRouteProvenance(components) {
  return {
    class: "production-route",
    releaseEligible: true,
    timedInput: true,
    timedInputCount: 1,
    routeObservation: "production",
    outcomeObservation: "production",
    components,
  };
}

async function writeArtifacts(root, artifacts) {
  const paths = {
    interaction: "interactions/interaction-results.json",
    semanticContract: "semantic/semantic-contract.json",
    semanticMetamorphic: "semantic/semantic-metamorphic.json",
    semanticAmbient: "semantic/semantic-ambient-safety.json",
    audio: "audio/audio-results.json",
    gesture: "gesture/gesture-results.json",
  };
  for (const [name, relativePath] of Object.entries(paths)) {
    const path = resolve(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(artifacts[name], null, 2)}\n`);
  }
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "airboard-quality-report-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
