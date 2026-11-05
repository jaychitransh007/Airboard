import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGestureBrowserEvidence,
  evaluateGestureBrowserEvidence,
  gestureManifestHash,
  loadGestureBrowserEvidence,
  writeGestureBrowserEvidence,
} from "../lib/gesture-browser-evidence.mjs";
import {
  buildEvaluationReport,
  main as runGestureEvaluation,
} from "../eval-gesture-replay.mjs";

const RUN_ID = "release-fixture-run";
const ASSET_HASH = "a".repeat(64);
const INITIAL_BOARD_HASH = `sha256:${"b".repeat(64)}`;
const FINAL_BOARD_HASH = `sha256:${"c".repeat(64)}`;
const MANIFEST_BYTES = Buffer.from('{"corpusVersion":"gesture-test-v1"}');
const MANIFEST_HASH = gestureManifestHash(MANIFEST_BYTES);

test("browser evidence is run/hash bound and excludes participant or media data", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "airboard-gesture-browser-evidence-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const evidence = validEvidence();
  await writeGestureBrowserEvidence(directory, evidence);
  const records = await loadGestureBrowserEvidence(directory);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].problems, []);
  assert.deepEqual(records[0].evidence, evidence);
  const serialized = JSON.stringify(records[0].evidence);
  assert.equal(serialized.includes("participant-"), false);
  assert.equal(serialized.includes(".y4m"), false);
  assert.equal(serialized.includes("storageKey"), false);
  assert.equal(serialized.includes("landmark"), false);

  await assert.rejects(
    writeGestureBrowserEvidence(directory, evidence),
    /EEXIST/u,
    "a retry cannot silently replace evidence from a prior execution",
  );
  assert.throws(
    () =>
      createGestureBrowserEvidence({
        runId: RUN_ID,
        corpusVersion: "gesture-test-v1",
        manifestHash: MANIFEST_HASH,
        datasetSplit: "holdout",
        assetId: "video-holdout-01",
        assetHash: ASSET_HASH,
        observation: {},
      }),
    /observation\.(?:perceptionFrameCount|durationMs|appliedActions)/u,
    "missing measurements cannot normalize into a passing safety record",
  );
});

test("aggregator independently rejects stale, wrong-hash, missing, and duplicate actions", () => {
  const asset = browserAsset();
  const valid = evaluateGestureBrowserEvidence({
    asset,
    evidence: validEvidence(),
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(valid.passed, true);
  assert.deepEqual(valid.problems, []);
  assert.equal(valid.expectedActionCount, 2);
  assert.equal(valid.actualActionCount, 2);
  assert.equal(valid.matchedActionCount, 2);

  const wrongOutcome = structuredClone(validEvidence());
  wrongOutcome.observation.movedObjectCount = 0;
  const outcomeRejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: wrongOutcome,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(outcomeRejected.passed, false);
  assert.match(
    outcomeRejected.problems.join("\n"),
    /moved object count 0 is below 1/u,
  );

  const stale = structuredClone(validEvidence());
  stale.runId = "previous-run";
  stale.assetHash = "b".repeat(64);
  stale.observation.appliedActions = [
    { gesture: "undo", count: 1 },
  ];
  const rejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: stale,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(rejected.passed, false);
  assert.match(rejected.problems.join("\n"), /runId/u);
  assert.match(rejected.problems.join("\n"), /assetHash/u);
  assert.match(rejected.problems.join("\n"), /expected 2, observed 0/u);
  assert.match(rejected.problems.join("\n"), /unexpected applied action undo/u);

  const missingTarget = structuredClone(validEvidence());
  missingTarget.observation.targetedGestures = [];
  const missingTargetRejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: missingTarget,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(missingTargetRejected.passed, false);
  assert.match(
    missingTargetRejected.problems.join("\n"),
    /target observations for manipulation expected at least 2, observed 0/u,
  );

  const slowFrames = structuredClone(validEvidence());
  slowFrames.observation.frameProcessingP95Ms = 40;
  const slowFramesRejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: slowFrames,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(slowFramesRejected.passed, false);
  assert.match(
    slowFramesRejected.problems.join("\n"),
    /frame processing p95 40ms exceeds 33\.34ms/u,
  );

  const wrongFinalState = structuredClone(validEvidence());
  wrongFinalState.observation.finalBoardHash = `sha256:${"d".repeat(64)}`;
  const wrongFinalStateRejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: wrongFinalState,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(wrongFinalStateRejected.passed, false);
  assert.match(
    wrongFinalStateRejected.problems.join("\n"),
    /final (?:canonical )?board hash/ui,
  );

  const brokenUndo = structuredClone(validEvidence());
  brokenUndo.observation.undoRoundTrip = false;
  brokenUndo.observation.postUndoBoardHash = FINAL_BOARD_HASH;
  const brokenUndoRejected = evaluateGestureBrowserEvidence({
    asset,
    evidence: brokenUndo,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  assert.equal(brokenUndoRejected.passed, false);
  assert.match(
    brokenUndoRejected.problems.join("\n"),
    /Undo .*initial canonical board/u,
  );
});

test("neutral footage cannot turn annotations into false safety coverage", () => {
  const asset = browserAsset({
    purpose: "neutral_safety",
    validRepetitions: 0,
    expectedAppliedActions: [],
    forbiddenGestureActions: ["undo"],
    maximumBoardEventCount: 0,
  });
  const evidence = validEvidence({
    appliedActions: ["undo"],
    boardEventCount: 1,
    movedObjectCount: 0,
    finalSelectionCount: 0,
  });
  const evaluation = evaluateGestureBrowserEvidence({
    asset,
    evidence,
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.criticalFalseTriggerCount, 1);
  assert.match(evaluation.problems.join("\n"), /forbidden applied gesture undo/u);
  assert.match(evaluation.problems.join("\n"), /board event count 1 exceeds 0/u);
});

test("gesture coverage counts browser assets only after accepted run evidence", () => {
  const asset = {
    ...browserAsset(),
    assetClass: "restricted_raw_media",
    participantId: "participant-hidden-from-report",
    privacy: { classification: "restricted_raw_media" },
    annotations: {
      ...browserAsset().annotations,
      evaluationOwner: "browser_video_replay",
      sliceTags: ["core_lighting"],
    },
  };
  const manifest = {
    corpusVersion: "gesture-test-v1",
    requiredSlices: {
      shippedGestures: ["manipulation_grab"],
      coreConditions: ["standalone-normal-light"],
    },
  };
  const delegated = buildEvaluationReport({
    manifest,
    manifestBytes: MANIFEST_BYTES,
    release: false,
    datasetSplit: "holdout",
    results: [
      {
        asset,
        report: null,
        browserEvaluation: null,
        processingDurationMs: null,
        faultResults: [],
        problems: [],
        hashVerified: false,
      },
    ],
  });
  assert.equal(delegated.summary.delegatedBrowserAssets, 1);
  assert.equal(delegated.coverage.participantCount, 0);
  assert.equal(delegated.coverage.evaluatedHumanAssetCount, 0);
  assert.equal(delegated.metrics.slices.core_lighting, undefined);

  const browserEvaluation = evaluateGestureBrowserEvidence({
    asset,
    evidence: validEvidence(),
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
  });
  const evaluated = buildEvaluationReport({
    manifest,
    manifestBytes: MANIFEST_BYTES,
    release: true,
    datasetSplit: "holdout",
    results: [
      {
        asset,
        report: null,
        browserEvaluation,
        processingDurationMs: null,
        faultResults: [],
        problems: browserEvaluation.problems,
        hashVerified: browserEvaluation.hashVerified,
      },
    ],
  });
  assert.equal(evaluated.summary.browserEvaluatedAssets, 1);
  assert.equal(evaluated.summary.delegatedBrowserAssets, 0);
  assert.equal(evaluated.coverage.participantCount, 1);
  assert.equal(
    evaluated.coverage.minimumValidRepetitionsPerGesturePerCoreCondition,
    2,
  );
  assert.equal(evaluated.metrics.slices.core_lighting.score, 1);
  assert.equal(
    JSON.stringify(evaluated).includes("participant-hidden-from-report"),
    false,
  );
});

test("release runner consumes browser evidence and emits no delegated coverage", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "airboard-gesture-browser-runner-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceManifest = JSON.parse(
    await readFile(
      new URL("../../evals/gesture/corpus.v1.json", import.meta.url),
      "utf8",
    ),
  );
  const manifest = {
    ...sourceManifest,
    corpusVersion: "gesture-browser-runner-v1",
    assets: [
      {
        id: "video-holdout-01",
        assetClass: "restricted_raw_media",
        artifactType: "video",
        contentType: "video/x-y4m",
        storageKey: "restricted/video-holdout-01.y4m",
        externalReference: {
          uri: "restricted://gesture/video-holdout-01",
        },
        datasetSplit: "holdout",
        participantId: "participant-never-emitted",
        meetingSessionId: "session-never-emitted",
        hash: { algorithm: "sha256", value: ASSET_HASH },
        byteLength: 100,
        privacy: {
          classification: "restricted_raw_biometric",
          containsRawMedia: true,
          containsBiometricData: true,
        },
        consent: {
          status: "granted",
          scope: ["offline_gesture_evaluation", "benchmark_retention"],
          evidence: "restricted-consent-record",
        },
        annotations: {
          ...browserAsset().annotations,
          evaluationOwner: "browser_video_replay",
          sliceTags: ["core_lighting"],
        },
      },
    ],
  };
  const manifestPath = join(directory, "manifest.json");
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(manifestPath, manifestBytes);
  const evidenceDirectory = join(directory, "evidence");
  const evidence = createGestureBrowserEvidence({
    ...validEvidence(),
    corpusVersion: manifest.corpusVersion,
    manifestHash: gestureManifestHash(manifestBytes),
  });
  await writeGestureBrowserEvidence(evidenceDirectory, evidence);

  const outputDirectory = join(directory, "reports");
  const previousOutput = process.env.AIRBOARD_EVAL_OUTPUT_DIR;
  const previousExitCode = process.exitCode;
  process.env.AIRBOARD_EVAL_OUTPUT_DIR = outputDirectory;
  process.exitCode = undefined;
  try {
    await runGestureEvaluation([
      "--manifest",
      manifestPath,
      "--dataset-split",
      "holdout",
      "--browser-evidence-dir",
      evidenceDirectory,
      "--run-id",
      RUN_ID,
      "--release",
    ]);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = previousExitCode;
    if (previousOutput === undefined) {
      delete process.env.AIRBOARD_EVAL_OUTPUT_DIR;
    } else {
      process.env.AIRBOARD_EVAL_OUTPUT_DIR = previousOutput;
    }
  }
  const report = JSON.parse(
    await readFile(
      join(outputDirectory, "gesture", "gesture-results.json"),
      "utf8",
    ),
  );
  assert.equal(report.summary.declaredBrowserAssets, 1);
  assert.equal(report.summary.browserEvaluatedAssets, 1);
  assert.equal(report.summary.delegatedBrowserAssets, 0);
  assert.equal(report.coverage.participantCount, 1);
  assert.equal(JSON.stringify(report).includes("participant-never-emitted"), false);
  assert.equal(JSON.stringify(report).includes("session-never-emitted"), false);
  assert.equal(JSON.stringify(report).includes(".y4m"), false);
});

function validEvidence(overrides = {}) {
  return createGestureBrowserEvidence({
    runId: RUN_ID,
    corpusVersion: "gesture-test-v1",
    manifestHash: MANIFEST_HASH,
    datasetSplit: "holdout",
    assetId: "video-holdout-01",
    assetHash: ASSET_HASH,
    observedAt: new Date("2026-07-30T10:00:00.000Z"),
    observation: {
      durationMs: 2_000,
      perceptionFrameCount: 20,
      traceEventCount: 50,
      observedStages: [
        "perception_health",
        "arbitration_owner",
        "action",
      ],
      observedOwners: ["grab"],
      appliedActions: ["move_commit", "move_commit"],
      targetedGestures: [{ gesture: "manipulation", count: 2 }],
      frameProcessingP95Ms: 8,
      boardEventCount: 2,
      committedObjectCount: 1,
      movedObjectCount: 1,
      createdObjectCount: 0,
      deletedObjectCount: 0,
      viewportPanDistance: 0,
      viewportScaleDelta: 0,
      finalDiagramVisible: true,
      finalSelectionCount: 1,
      undoDepth: 1,
      initialBoardHash: INITIAL_BOARD_HASH,
      finalBoardHash: FINAL_BOARD_HASH,
      undoRoundTrip: true,
      postUndoBoardHash: INITIAL_BOARD_HASH,
      ...overrides,
    },
  });
}

function browserAsset(overrides = {}) {
  const {
    purpose,
    validRepetitions = 2,
    expectedAppliedActions = [{ gesture: "move_commit", count: 2 }],
    forbiddenGestureActions = [],
    maximumBoardEventCount = 2,
  } = overrides;
  return {
    id: "video-holdout-01",
    hash: { algorithm: "sha256", value: ASSET_HASH },
    annotations: {
      gesture: "manipulation_grab",
      condition: "standalone-normal-light",
      validRepetitions,
      ...(purpose ? { purpose } : {}),
      browserReplay: {
        runDurationMs: 2_000,
        minimumPerceptionFrames: 10,
        requiredStages: [
          "perception_health",
          "arbitration_owner",
          "action",
        ],
        requiredOwners: ["grab"],
        requiredTargetedGestures:
          purpose === "neutral_safety"
            ? []
            : [{ gesture: "manipulation", count: 2 }],
        forbiddenGestureActions,
        expectedAppliedActions,
        maximumFrameProcessingP95Ms: 33.34,
        expectedInitialBoardHash: INITIAL_BOARD_HASH,
        expectedFinalBoardHash: FINAL_BOARD_HASH,
        requireUndoRoundTrip: purpose !== "neutral_safety",
        minimumBoardEventCount: purpose === "neutral_safety" ? 0 : 1,
        maximumBoardEventCount,
        minimumCommittedObjects: purpose === "neutral_safety" ? 0 : 1,
        maximumCommittedObjects: purpose === "neutral_safety" ? 0 : 1,
        minimumMovedObjectCount: purpose === "neutral_safety" ? 0 : 1,
        maximumMovedObjectCount: purpose === "neutral_safety" ? 0 : 1,
        minimumUndoDepth: purpose === "neutral_safety" ? 0 : 1,
      },
    },
  };
}
