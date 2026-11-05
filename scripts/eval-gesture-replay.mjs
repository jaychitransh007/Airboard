#!/usr/bin/env node

/**
 * Offline gesture replay evaluation.
 *
 * Verifies corpus provenance/privacy metadata and content hashes, replays each
 * landmark trace through the gesture engine's diagnostic layer, checks
 * annotated production actions and timing gates, then injects deterministic
 * faults to prove degraded frames fail closed without duplicate actions.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseLandmarkTrace,
  replayLandmarkTraceWithDiagnostics,
} from "../packages/gesture-engine/src/landmarkTrace.ts";
import {
  evaluateGestureBrowserEvidence,
  gestureManifestHash,
  loadGestureBrowserEvidence,
} from "./lib/gesture-browser-evidence.mjs";
import { buildConfusionMatrix } from "./lib/confusion-matrix.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_MANIFEST = resolve(
  REPOSITORY_ROOT,
  "evals/gesture/corpus.v1.json",
);
const ASSET_CLASSES = new Set([
  "synthetic",
  "derived",
  "restricted_raw_media",
]);
const ACTION_TYPES = new Set([
  "palm_acquire",
  "palm_release",
  "grab_acquire",
  "grab_release",
]);
const LANDMARK_RELEASE_COVERAGE_GESTURES = new Set([
  "manipulation_grab",
]);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.browserEvidenceDirectory && !options.datasetSplit) {
    throw new Error(
      "--dataset-split is required with --browser-evidence-dir",
    );
  }
  const manifestPath = resolve(
    process.cwd(),
    options.manifest ?? DEFAULT_MANIFEST,
  );
  const mediaRoot =
    options.mediaRoot ??
    process.env.AIRBOARD_EVAL_MEDIA_ROOT ??
    null;
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateManifest(manifest, manifestPath);
  const manifestHash = gestureManifestHash(manifestBytes);
  const browserEvidence = await prepareBrowserEvidence({
    directory: options.browserEvidenceDirectory,
    runId: options.runId,
  });

  const selectedAssets = options.datasetSplit
    ? manifest.assets.filter(
        (asset) => asset.datasetSplit === options.datasetSplit,
      )
    : manifest.assets;
  if (selectedAssets.length === 0) {
    throw new Error(
      options.datasetSplit
        ? `Gesture manifest has no ${options.datasetSplit} assets`
        : "Gesture manifest has no evaluation assets",
    );
  }
  const results = [];
  for (const asset of selectedAssets) {
    const metadataProblems = validateAssetMetadata(asset);
    if (asset.assetClass === "restricted_raw_media") {
      const evidence = browserEvidence.byAssetId.get(asset.id);
      const browserEvaluation =
        asset.annotations?.evaluationOwner === "browser_video_replay" &&
        options.browserEvidenceDirectory
          ? evidence
            ? evaluateGestureBrowserEvidence({
                asset,
                evidence,
                runId: options.runId,
                corpusVersion: manifest.corpusVersion,
                manifestHash,
                datasetSplit: options.datasetSplit,
              })
            : {
                passed: false,
                problems: [
                  `missing browser replay evidence for run ${options.runId}`,
                ],
                hashVerified: false,
                expectedActionCount: 0,
                actualActionCount: 0,
                matchedActionCount: 0,
                duplicateActionCount: 0,
                criticalFalseTriggerCount: 0,
                actionCounts: {},
                perceptionFrameCount: 0,
                traceEventCount: 0,
                durationMs: null,
                boardEventCount: 0,
                committedObjectCount: 0,
                undoDepth: 0,
              }
          : null;
      results.push({
        asset,
        report: null,
        browserEvaluation,
        faultResults: [],
        problems: [
          ...metadataProblems,
          ...(browserEvaluation?.problems ?? []),
        ],
        hashVerified: browserEvaluation?.hashVerified ?? false,
      });
      continue;
    }

    const assetPath = asset.repositoryPath
      ? resolveRepositoryPath(asset.repositoryPath)
      : await resolveRestrictedAssetPath(asset.storageKey, mediaRoot);
    const bytes = await readFile(assetPath);
    const fileStats = await stat(assetPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const problems = [...metadataProblems];
    if (digest !== asset.hash.value) {
      problems.push(
        `SHA-256 mismatch: manifest ${asset.hash.value}, file ${digest}`,
      );
    }
    if (fileStats.size !== asset.byteLength) {
      problems.push(
        `byteLength mismatch: manifest ${asset.byteLength}, file ${fileStats.size}`,
      );
    }

    if (asset.artifactType !== "landmark_trace") {
      results.push({
        asset,
        report: null,
        faultResults: [],
        problems,
        hashVerified: digest === asset.hash.value,
      });
      continue;
    }

    const trace = parseLandmarkTrace(JSON.parse(bytes.toString("utf8")));
    const processingStartedAt = performance.now();
    const report = replayLandmarkTraceWithDiagnostics(trace);
    const processingDurationMs = performance.now() - processingStartedAt;
    problems.push(...evaluateAnnotatedReplay(report, asset.annotations));
    const faultResults = runSeededFaultChecks({
      trace,
      baseline: report,
      faultConfig: manifest.faultChecks,
    });
    for (const faultResult of faultResults) {
      problems.push(
        ...faultResult.problems.map(
          (problem) => `${faultResult.trial}: ${problem}`,
        ),
      );
    }
    results.push({
      asset,
      report,
      processingDurationMs,
      faultResults,
      problems,
      hashVerified: digest === asset.hash.value,
    });
  }

  printResults(manifest, manifestPath, results);
  const evaluationReport = buildEvaluationReport({
    manifest,
    manifestBytes,
    results,
    release: options.release,
    datasetSplit: options.datasetSplit,
    browserEvidenceSupplied: Boolean(options.browserEvidenceDirectory),
    evidenceProblems: [
      ...browserEvidence.problems,
      ...unexpectedBrowserEvidenceProblems(
        browserEvidence.byAssetId,
        selectedAssets,
      ),
    ],
  });
  await writeEvaluationReports(evaluationReport);
  for (const failure of evaluationReport.gateFailures) {
    console.log(`GATE FAIL: ${failure}`);
  }
  if (
    results.some((result) => result.problems.length > 0) ||
    evaluationReport.gateFailures.length > 0 ||
    (options.release &&
      (evaluationReport.summary.unevaluatedAssets > 0 ||
        evaluationReport.summary.delegatedBrowserAssets > 0))
  ) {
    process.exitCode = 1;
  }
}

function validateManifest(manifest, manifestPath) {
  if (
    manifest?.schemaVersion !== "1.0" ||
    typeof manifest.corpusVersion !== "string" ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0
  ) {
    throw new Error(`${manifestPath} is not a gesture corpus manifest (schema 1.0)`);
  }
  if (manifest.rawMediaPolicy !== "reference_only") {
    throw new Error("gesture corpus rawMediaPolicy must be reference_only");
  }
  const assetIds = new Set();
  for (const asset of manifest.assets) {
    if (typeof asset?.id !== "string" || !asset.id) {
      throw new Error("gesture corpus assets require non-empty ids");
    }
    if (assetIds.has(asset.id)) {
      throw new Error(`gesture corpus contains duplicate asset id ${asset.id}`);
    }
    assetIds.add(asset.id);
  }
  for (const assetClass of ASSET_CLASSES) {
    if (!isRecord(manifest.assetClassPolicies?.[assetClass])) {
      throw new Error(`manifest is missing the ${assetClass} asset-class policy`);
    }
  }
  if (
    manifest.faultChecks?.schemaVersion !== "1.0" ||
    !Number.isInteger(manifest.faultChecks.seed) ||
    !Number.isInteger(manifest.faultChecks.faultsPerTrial) ||
    manifest.faultChecks.faultsPerTrial < 1 ||
    !Array.isArray(manifest.faultChecks.trials)
  ) {
    throw new Error("manifest faultChecks must use schemaVersion 1.0 and a fixed seed");
  }
}

async function prepareBrowserEvidence({ directory, runId }) {
  if (!directory) {
    return { byAssetId: new Map(), problems: [] };
  }
  if (typeof runId !== "string" || !runId) {
    throw new Error("--run-id is required with --browser-evidence-dir");
  }
  const records = await loadGestureBrowserEvidence(directory);
  const byAssetId = new Map();
  const problems = [];
  for (const record of records) {
    problems.push(...record.problems);
    const assetId = record.evidence?.assetId;
    if (typeof assetId !== "string" || !assetId) continue;
    if (byAssetId.has(assetId)) {
      problems.push(`duplicate browser replay evidence for asset ${assetId}`);
      continue;
    }
    byAssetId.set(assetId, record.evidence);
  }
  return { byAssetId, problems };
}

function unexpectedBrowserEvidenceProblems(byAssetId, selectedAssets) {
  const expectedIds = new Set(
    selectedAssets
      .filter(
        (asset) =>
          asset.assetClass === "restricted_raw_media" &&
          asset.annotations?.evaluationOwner === "browser_video_replay",
      )
      .map(({ id }) => id),
  );
  return [...byAssetId.keys()]
    .filter((assetId) => !expectedIds.has(assetId))
    .map(
      (assetId) =>
        `browser replay evidence references an unexpected asset ${assetId}`,
    );
}

function validateAssetMetadata(asset) {
  const problems = [];
  if (!isRecord(asset) || typeof asset.id !== "string" || !asset.id) {
    return ["asset id is missing"];
  }
  if (!ASSET_CLASSES.has(asset.assetClass)) {
    problems.push(`unsupported assetClass ${JSON.stringify(asset.assetClass)}`);
  }
  if (
    asset.hash?.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(asset.hash?.value ?? "")
  ) {
    problems.push("asset must declare a lowercase SHA-256 hash");
  }
  if (
    typeof asset.privacy?.classification !== "string" ||
    typeof asset.privacy?.containsRawMedia !== "boolean" ||
    typeof asset.privacy?.containsBiometricData !== "boolean"
  ) {
    problems.push("privacy classification/raw-media/biometric flags are required");
  }
  if (
    typeof asset.consent?.status !== "string" ||
    !Array.isArray(asset.consent?.scope) ||
    asset.consent.scope.length === 0 ||
    !asset.consent.scope.every((scope) => typeof scope === "string" && scope)
  ) {
    problems.push("consent status and non-empty scope are required");
  }

  if (asset.assetClass === "synthetic") {
    if (asset.consent?.status !== "not_applicable") {
      problems.push("synthetic assets must use consent status not_applicable");
    }
    if (
      asset.privacy?.containsRawMedia ||
      asset.privacy?.containsBiometricData
    ) {
      problems.push("synthetic assets cannot claim raw media or biometric data");
    }
    if (typeof asset.repositoryPath !== "string") {
      problems.push("synthetic assets require a repositoryPath");
    }
  } else if (asset.assetClass === "derived") {
    if (asset.consent?.status !== "granted") {
      problems.push("derived assets require granted evaluation consent");
    }
    if (asset.privacy?.containsRawMedia) {
      problems.push("derived assets must not embed raw media");
    }
    const hasRepositoryPath =
      typeof asset.repositoryPath === "string" &&
      asset.repositoryPath.length > 0;
    const hasStorageKey =
      typeof asset.storageKey === "string" &&
      asset.storageKey.length > 0;
    if (
      hasRepositoryPath === hasStorageKey ||
      !Array.isArray(asset.sourceAssetIds) ||
      asset.sourceAssetIds.length === 0
    ) {
      problems.push(
        "derived assets require exactly one repositoryPath or restricted storageKey, plus sourceAssetIds",
      );
    }
    if (hasStorageKey && isAbsolute(asset.storageKey)) {
      problems.push("derived restricted storageKey must be relative");
    }
    if (
      typeof asset.participantId === "string" &&
      asset.participantId &&
      (asset.annotations?.purpose === "neutral_safety" ||
        !LANDMARK_RELEASE_COVERAGE_GESTURES.has(
          asset.annotations?.gesture,
        ))
    ) {
      problems.push(
        "derived landmark replay can claim human release coverage only for manipulation_grab; other shipped gestures and neutral safety require browser-owned Y4M evidence",
      );
    }
  } else if (asset.assetClass === "restricted_raw_media") {
    if ("repositoryPath" in asset) {
      problems.push("restricted raw media must never have a repositoryPath");
    }
    if (
      !isRecord(asset.externalReference) ||
      typeof asset.externalReference.uri !== "string"
    ) {
      problems.push("restricted raw media requires an externalReference");
    }
    if (asset.consent?.status !== "granted") {
      problems.push("restricted raw media requires explicit granted consent");
    }
    if (!asset.privacy?.containsRawMedia) {
      problems.push("restricted raw media must set containsRawMedia");
    }
    if (
      asset.annotations?.evaluationOwner === "browser_video_replay" &&
      (asset.artifactType !== "video" ||
        asset.contentType !== "video/x-y4m" ||
        typeof asset.storageKey !== "string" ||
        !asset.storageKey ||
        !asset.storageKey.toLowerCase().endsWith(".y4m") ||
        isAbsolute(asset.storageKey) ||
        !isRecord(asset.annotations.browserReplay))
    ) {
      problems.push(
        "browser-owned raw video requires a Chromium-compatible video/x-y4m asset, a relative .y4m storageKey, and browserReplay annotations",
      );
    }
    if (asset.annotations?.evaluationOwner === "browser_video_replay") {
      const expected =
        asset.annotations?.browserReplay?.expectedAppliedActions;
      if (
        !Array.isArray(expected) ||
        !expected.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.gesture === "string" &&
            /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(entry.gesture) &&
            Number.isInteger(entry.count) &&
            entry.count > 0,
        ) ||
        new Set(expected?.map(({ gesture }) => gesture)).size !==
          expected?.length
      ) {
        problems.push(
          "browserReplay.expectedAppliedActions must contain unique gesture/count entries",
        );
      }
      const expectedCount = Array.isArray(expected)
        ? expected.reduce(
            (sum, entry) =>
              sum + (Number.isInteger(entry?.count) ? entry.count : 0),
            0,
          )
        : 0;
      if (
        Number(asset.annotations?.validRepetitions ?? 0) > 0 &&
        expectedCount <
          Number(asset.annotations.validRepetitions)
      ) {
        problems.push(
          "browserReplay expected action count cannot be lower than validRepetitions",
        );
      }
      if (
        asset.annotations?.purpose === "neutral_safety" &&
        expectedCount !== 0
      ) {
        problems.push(
          "neutral-safety browser replay must expect zero applied actions",
        );
      }
      const replay = asset.annotations?.browserReplay;
      const targeted = replay?.requiredTargetedGestures;
      if (
        !Array.isArray(targeted) ||
        !targeted.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.gesture === "string" &&
            /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(entry.gesture) &&
            Number.isInteger(entry.count) &&
            entry.count > 0,
        ) ||
        new Set(targeted?.map(({ gesture }) => gesture)).size !==
          targeted?.length
      ) {
        problems.push(
          "browserReplay.requiredTargetedGestures must contain unique gesture/count entries",
        );
      }
      if (
        !(Number(replay?.maximumFrameProcessingP95Ms) > 0) ||
        !/^sha256:[a-f0-9]{64}$/u.test(
          replay?.expectedInitialBoardHash ?? "",
        ) ||
        !/^sha256:[a-f0-9]{64}$/u.test(
          replay?.expectedFinalBoardHash ?? "",
        ) ||
        typeof replay?.requireUndoRoundTrip !== "boolean"
      ) {
        problems.push(
          "browserReplay requires a frame budget, canonical board hashes, and explicit Undo policy",
        );
      }
      if (
        asset.annotations?.gesture === "manipulation_grab" &&
        (!targeted?.some(
          ({ gesture }) => gesture === "manipulation",
        ) ||
          replay?.requireUndoRoundTrip !== true)
      ) {
        problems.push(
          "manipulation browser replay must observe its target and require an Undo round trip",
        );
      }
      if (
        asset.annotations?.gesture === "hold_to_edit" &&
        !targeted?.some(
          ({ gesture }) => gesture === "hold_to_edit_scope",
        )
      ) {
        problems.push(
          "hold-to-edit browser replay must observe its scoped target",
        );
      }
      for (const field of [
        "minimumBoardEventCount",
        "maximumBoardEventCount",
        "minimumCommittedObjects",
        "maximumCommittedObjects",
        "minimumMovedObjectCount",
        "maximumMovedObjectCount",
        "minimumCreatedObjectCount",
        "maximumCreatedObjectCount",
        "minimumDeletedObjectCount",
        "maximumDeletedObjectCount",
        "minimumViewportPanDistance",
        "minimumViewportScaleDelta",
        "minimumSelectionCount",
        "maximumSelectionCount",
        "minimumUndoDepth",
      ]) {
        if (
          replay?.[field] !== undefined &&
          (!Number.isFinite(replay[field]) || replay[field] < 0)
        ) {
          problems.push(`browserReplay ${field} must be non-negative`);
        }
      }
      const setup = asset.annotations?.browserReplay?.setup;
      if (setup !== undefined && !isRecord(setup)) {
        problems.push("browserReplay.setup must be an object");
      } else if (isRecord(setup)) {
        if (
          setup.deterministicWakeTranscripts !== undefined &&
          (!Array.isArray(setup.deterministicWakeTranscripts) ||
            !setup.deterministicWakeTranscripts.every(
              (transcript) =>
                typeof transcript === "string" &&
                transcript.length > 0 &&
                transcript.length <= 500 &&
                /^airo(?:\b|[,;:])/iu.test(transcript.trim()),
            ))
        ) {
          problems.push(
            "browserReplay setup transcripts must be non-empty <=500-character Airo wake commands",
          );
        }
        if (
          setup.viewport !== undefined &&
          (!isRecord(setup.viewport) ||
            !["x", "y", "scale"].every((field) =>
              Number.isFinite(setup.viewport[field]),
            ) ||
            setup.viewport.scale <= 0)
        ) {
          problems.push(
            "browserReplay setup viewport requires finite x/y and positive scale",
          );
        }
        if (
          setup.diagramVisible !== undefined &&
          typeof setup.diagramVisible !== "boolean"
        ) {
          problems.push(
            "browserReplay setup diagramVisible must be boolean",
          );
        }
      }
    }
  }
  return problems;
}

function resolveRepositoryPath(repositoryPath) {
  if (typeof repositoryPath !== "string" || !repositoryPath) {
    throw new Error("tracked corpus asset is missing repositoryPath");
  }
  const assetPath = resolve(REPOSITORY_ROOT, repositoryPath);
  const pathFromRoot = relative(REPOSITORY_ROOT, assetPath);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot.startsWith(sep)
  ) {
    throw new Error(`corpus asset escapes the repository: ${repositoryPath}`);
  }
  return assetPath;
}

async function resolveRestrictedAssetPath(storageKey, mediaRoot) {
  if (typeof storageKey !== "string" || !storageKey || !mediaRoot) {
    throw new Error(
      "Restricted derived gesture traces require AIRBOARD_EVAL_MEDIA_ROOT and a relative storageKey",
    );
  }
  const root = await realpath(resolve(mediaRoot));
  const unresolved = resolve(root, storageKey);
  assertInsideRoot(root, unresolved);
  const resolvedPath = await realpath(unresolved);
  assertInsideRoot(root, resolvedPath);
  return resolvedPath;
}

function assertInsideRoot(root, candidate) {
  const child = relative(root, candidate);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error("Restricted gesture asset escapes AIRBOARD_EVAL_MEDIA_ROOT");
  }
}

function evaluateAnnotatedReplay(report, annotations) {
  const problems = [];
  if (!isRecord(annotations) || !Array.isArray(annotations.expectedActions)) {
    return ["landmark trace is missing expectedActions annotations"];
  }
  const expectedActions = annotations.expectedActions;
  if (report.actions.length !== expectedActions.length) {
    problems.push(
      `expected ${expectedActions.length} actions, received ${report.actions.length}`,
    );
  }
  expectedActions.forEach((expected, index) => {
    const actual = report.actions[index];
    if (!ACTION_TYPES.has(expected?.type)) {
      problems.push(`expectedActions[${index}] has invalid type`);
      return;
    }
    if (!actual) {
      problems.push(`missing ${expected.type}`);
      return;
    }
    if (actual.type !== expected.type) {
      problems.push(
        `action ${index}: expected ${expected.type}, received ${actual.type}`,
      );
    }
    if (
      !isRecord(expected.windowMs) ||
      actual.t < expected.windowMs.from ||
      actual.t > expected.windowMs.to
    ) {
      problems.push(
        `${expected.type} at ${actual.t}ms is outside ${expected.windowMs?.from}..${expected.windowMs?.to}ms`,
      );
    }
  });

  for (const range of annotations.negativeRanges ?? []) {
    const forbiddenOwners = new Set(range.forbiddenOwners ?? []);
    const violations = report.frames.filter(
      (frame) =>
        frame.t >= range.fromMs &&
        frame.t <= range.toMs &&
        forbiddenOwners.has(frame.owner),
    );
    if (violations.length > 0) {
      problems.push(
        `${range.label} has ${violations.length} forbidden owner frame(s)`,
      );
    }
  }

  const gates = annotations.qualityGates;
  if (!isRecord(gates)) {
    return [...problems, "landmark trace is missing qualityGates"];
  }
  if (report.metrics.duplicateActionCount > gates.maximumDuplicateActions) {
    problems.push(
      `duplicate actions ${report.metrics.duplicateActionCount} exceed ${gates.maximumDuplicateActions}`,
    );
  }
  if (report.metrics.unpairedActionCount > gates.maximumUnpairedActions) {
    problems.push(
      `unpaired actions ${report.metrics.unpairedActionCount} exceed ${gates.maximumUnpairedActions}`,
    );
  }
  for (const gesture of ["palm", "grab"]) {
    checkTimingGate(
      problems,
      `${gesture} acquire`,
      report.metrics[gesture].acquireTiming.maxMs,
      gates.maximumAcquireLatencyMs?.[gesture],
    );
    checkTimingGate(
      problems,
      `${gesture} release`,
      report.metrics[gesture].releaseTiming.maxMs,
      gates.maximumReleaseLatencyMs?.[gesture],
    );
  }
  if (report.summary.framesWithInvalidHands > 0) {
    problems.push(
      `baseline contains ${report.summary.framesWithInvalidHands} invalid hand frame(s)`,
    );
  }
  if (report.summary.nonMonotonicTimestampFrames > 0) {
    problems.push(
      `baseline contains ${report.summary.nonMonotonicTimestampFrames} non-monotonic timestamp frame(s)`,
    );
  }
  return problems;
}

function checkTimingGate(problems, label, actual, maximum) {
  if (!Number.isFinite(maximum)) {
    problems.push(`${label} maximum latency gate is missing`);
  } else if (!Number.isFinite(actual)) {
    problems.push(`${label} timing has no samples`);
  } else if (actual > maximum) {
    problems.push(`${label} latency ${actual}ms exceeds ${maximum}ms`);
  }
}

function runSeededFaultChecks({ trace, baseline, faultConfig }) {
  const random = seededRandom(faultConfig.seed);
  return faultConfig.trials.map((trial) => {
    const faulted = structuredClone(trace);
    const indexes = chooseFaultIndexes(
      faulted.frames.length,
      faultConfig.faultsPerTrial,
      random,
    );
    for (const index of indexes) {
      injectFault(faulted, trial, index, random);
    }
    const report = replayLandmarkTraceWithDiagnostics(faulted);
    const problems = [];
    if (
      report.metrics.duplicateActionCount >
      faultConfig.maximumDuplicateActions
    ) {
      problems.push(
        `duplicate actions ${report.metrics.duplicateActionCount} exceed ${faultConfig.maximumDuplicateActions}`,
      );
    }
    if (
      report.metrics.unpairedActionCount >
      faultConfig.maximumUnpairedActions
    ) {
      problems.push(
        `unpaired actions ${report.metrics.unpairedActionCount} exceed ${faultConfig.maximumUnpairedActions}`,
      );
    }
    const baselineTypes = baseline.actions.map((action) => action.type);
    const faultTypes = report.actions.map((action) => action.type);
    if (JSON.stringify(faultTypes) !== JSON.stringify(baselineTypes)) {
      problems.push(
        `action sequence changed: expected ${baselineTypes.join(", ")}, received ${faultTypes.join(", ") || "none"}`,
      );
    }
    if (!faultWasDiagnosed(trial, report, indexes)) {
      problems.push("injected fault was not visible in frame-stage diagnostics");
    }
    return { trial, indexes, report, problems };
  });
}

function chooseFaultIndexes(frameCount, count, random) {
  if (frameCount < count * 2 + 1) {
    throw new Error("gesture trace is too short for spaced seeded faults");
  }
  const usableFrames = frameCount - 2;
  const bucketSize = usableFrames / count;
  return Array.from({ length: count }, (_, bucket) => {
    const bucketStart = 1 + Math.floor(bucket * bucketSize);
    const bucketEnd = Math.max(
      bucketStart,
      Math.floor((bucket + 1) * bucketSize),
    );
    return Math.min(
      frameCount - 2,
      bucketStart + Math.floor(random() * (bucketEnd - bucketStart + 1)),
    );
  });
}

function injectFault(trace, trial, frameIndex, random) {
  const frame = trace.frames[frameIndex];
  if (!frame) {
    return;
  }
  if (trial === "hand_dropout") {
    frame.hands = [];
    return;
  }
  if (trial === "landmark_non_finite") {
    const hand = frame.hands[0];
    if (!hand || hand.landmarks.length === 0) {
      return;
    }
    const landmarkIndex = Math.min(
      hand.landmarks.length - 1,
      4 + Math.floor(random() * 17),
    );
    const point = hand.landmarks[landmarkIndex];
    if (point) {
      point[0] = Number.NaN;
    }
    return;
  }
  if (trial === "timestamp_regression") {
    frame.t -= 100;
    return;
  }
  throw new Error(`unsupported seeded fault trial ${JSON.stringify(trial)}`);
}

function faultWasDiagnosed(trial, report, indexes) {
  if (trial === "hand_dropout") {
    return indexes.every(
      (index) =>
        report.frames[index]?.handCount === 0 &&
        report.frames[index]?.stages.validation.status === "skipped",
    );
  }
  if (trial === "landmark_non_finite") {
    return indexes.every(
      (index) =>
        report.frames[index]?.stages.validation.status === "degraded" &&
        report.frames[index]?.hands.some((hand) =>
          hand.issues.includes("non_finite_landmark"),
        ),
    );
  }
  if (trial === "timestamp_regression") {
    return indexes.every((index) =>
      report.frames[index]?.stages.input.codes.includes("timestamp_regression"),
    );
  }
  return false;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function buildEvaluationReport({
  manifest,
  manifestBytes,
  results,
  release,
  datasetSplit,
  evidenceProblems = [],
  browserEvidenceSupplied = false,
}) {
  let truePositiveActions = 0;
  let expectedActionCount = 0;
  let actualActionCount = 0;
  let duplicateActionCount = 0;
  let criticalFalseTriggerCount = 0;
  const sliceSamples = new Map();
  const processingSamplesMs = [];
  const acquireSamplesMs = [];
  const releaseSamplesMs = [];
  const evaluatedHumanAssets = [];
  const gestureConfusionPairs = [];

  const safeResults = results.map((result) => {
    const browser = result.browserEvaluation;
    const expected = result.asset.annotations?.expectedActions ?? [];
    const actual = result.report?.actions ?? [];
    const expectedCount = browser?.expectedActionCount ?? expected.length;
    const actualCount = browser?.actualActionCount ?? actual.length;
    const expectedActionTypes = browser
      ? expandCountedActions(
          result.asset.annotations?.browserReplay?.expectedAppliedActions,
        )
      : expected.map(({ type }) => type);
    const actualActionTypes = browser
      ? expandActionCountRecord(browser.actionCounts)
      : actual.map(({ type }) => type);
    gestureConfusionPairs.push(
      ...pairGestureActionTypes(expectedActionTypes, actualActionTypes),
    );
    const matched =
      browser?.matchedActionCount ??
      countMatchedGestureActions(expected, actual);
    const precision =
      actualCount === 0
        ? expectedCount === 0
          ? 1
          : 0
        : matched / actualCount;
    const recall = expectedCount === 0 ? 1 : matched / expectedCount;
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);
    expectedActionCount += expectedCount;
    actualActionCount += actualCount;
    truePositiveActions += matched;
    duplicateActionCount +=
      browser?.duplicateActionCount ??
      result.report?.metrics.duplicateActionCount ??
      0;
    if (result.asset.annotations?.purpose === "neutral_safety") {
      criticalFalseTriggerCount +=
        browser?.criticalFalseTriggerCount ?? actualCount;
    }
    if (result.report) {
      for (const gesture of ["palm", "grab"]) {
        acquireSamplesMs.push(
          ...(result.report.metrics[gesture]?.acquireTiming.samplesMs ?? []),
        );
        releaseSamplesMs.push(
          ...(result.report.metrics[gesture]?.releaseTiming.samplesMs ?? []),
        );
      }
      if (
        landmarkTraceProvidesReleaseCoverage(result.asset) &&
        typeof result.asset.participantId === "string" &&
        result.asset.participantId
      ) {
        evaluatedHumanAssets.push(result.asset);
      }
    }
    if (
      browser?.passed &&
      typeof result.asset.participantId === "string" &&
      result.asset.participantId
    ) {
      evaluatedHumanAssets.push(result.asset);
    }
    if (
      Number.isFinite(result.processingDurationMs) &&
      (result.report?.summary.frameCount ?? 0) > 0
    ) {
      processingSamplesMs.push(
        result.processingDurationMs / result.report.summary.frameCount,
      );
    }
    if (Number.isFinite(browser?.frameProcessingP95Ms)) {
      processingSamplesMs.push(browser.frameProcessingP95Ms);
    }
    if (
      browser ||
      (result.report &&
        (!result.asset.participantId ||
          landmarkTraceProvidesReleaseCoverage(result.asset)))
    ) {
      for (const sliceId of gestureSliceIds(result.asset.annotations)) {
        const samples = sliceSamples.get(sliceId) ?? [];
        samples.push({
          score: f1,
          critical: result.asset.annotations?.criticalSlice === true,
        });
        sliceSamples.set(sliceId, samples);
      }
    }
    const status =
      result.asset.assetClass === "restricted_raw_media"
        ? browser
          ? result.problems.length === 0 && browser.passed
            ? "passed"
            : "failed"
          : result.asset.annotations?.evaluationOwner ===
              "browser_video_replay"
            ? "delegated_browser_replay"
            : "unevaluated_reference"
        : result.problems.length === 0
          ? "passed"
          : "failed";
    return {
      id: result.asset.id,
      assetClass: result.asset.assetClass,
      privacyClassification: result.asset.privacy?.classification ?? null,
      status,
      evaluationOwner:
        result.asset.annotations?.evaluationOwner ===
        "browser_video_replay"
          ? "browser_video_replay"
          : "landmark_replay",
      hashVerified: result.hashVerified,
      expectedActionCount: expectedCount,
      actualActionCount: actualCount,
      matchedActionCount: matched,
      precision,
      recall,
      f1,
      frameCount:
        result.report?.summary.frameCount ??
        browser?.perceptionFrameCount ??
        0,
      traceDurationMs:
        result.report?.summary.durationMs ?? browser?.durationMs ?? 0,
      processingDurationMs: result.processingDurationMs ?? null,
      duplicateActionCount:
        browser?.duplicateActionCount ??
        result.report?.metrics.duplicateActionCount ??
        0,
      unpairedActionCount:
        result.report?.metrics.unpairedActionCount ?? 0,
      actions: browser
        ? Object.entries(browser.actionCounts).map(([gesture, count]) => ({
            type: gesture,
            count,
          }))
        : actual.map(({ type, t, latencyMs, frameOwner }) => ({
            type,
            t,
            latencyMs,
            frameOwner,
          })),
      browserObservation: browser
        ? {
            perceptionFrameCount: browser.perceptionFrameCount,
            traceEventCount: browser.traceEventCount,
            boardEventCount: browser.boardEventCount,
            committedObjectCount: browser.committedObjectCount,
            movedObjectCount: browser.movedObjectCount,
            createdObjectCount: browser.createdObjectCount,
            deletedObjectCount: browser.deletedObjectCount,
            viewportPanDistance: browser.viewportPanDistance,
            viewportScaleDelta: browser.viewportScaleDelta,
            finalDiagramVisible: browser.finalDiagramVisible,
            finalSelectionCount: browser.finalSelectionCount,
            undoDepth: browser.undoDepth,
            targetedGestureCounts: browser.targetedGestureCounts,
            frameProcessingP95Ms: browser.frameProcessingP95Ms,
            initialBoardHash: browser.initialBoardHash,
            finalBoardHash: browser.finalBoardHash,
            undoRoundTrip: browser.undoRoundTrip,
            postUndoBoardHash: browser.postUndoBoardHash,
          }
        : null,
      faultChecks: result.faultResults.map(({ trial, problems }) => ({
        trial,
        passed: problems.length === 0,
        problems,
      })),
      problems: result.problems,
    };
  });

  const precision =
    actualActionCount === 0
      ? expectedActionCount === 0
        ? 1
        : 0
      : truePositiveActions / actualActionCount;
  const recall =
    expectedActionCount === 0
      ? 1
      : truePositiveActions / expectedActionCount;
  const slices = Object.fromEntries(
    [...sliceSamples.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, samples]) => [
        id,
        {
          score:
            samples.reduce((sum, sample) => sum + sample.score, 0) /
            samples.length,
          critical: samples.some((sample) => sample.critical),
          count: samples.length,
        },
      ]),
  );
  const unevaluatedAssets = safeResults.filter(
    ({ status }) => status === "unevaluated_reference",
  ).length;
  const delegatedAssets = safeResults.filter(
    ({ status }) => status === "delegated_browser_replay",
  ).length;
  const declaredBrowserAssets = safeResults.filter(
    ({ evaluationOwner }) => evaluationOwner === "browser_video_replay",
  ).length;
  const failedAssets = safeResults.filter(
    ({ status }) => status === "failed",
  ).length;
  const duplicateRate =
    actualActionCount === 0
      ? 0
      : duplicateActionCount / actualActionCount;
  const gateFailures = [...evidenceProblems];
  if (precision < 0.95) {
    gateFailures.push(
      `gesture precision ${(precision * 100).toFixed(2)}% is below 95.00%`,
    );
  }
  if (recall < 0.9) {
    gateFailures.push(
      `gesture recall ${(recall * 100).toFixed(2)}% is below 90.00%`,
    );
  }
  if (duplicateRate >= 0.01) {
    gateFailures.push(
      `gesture duplicate rate ${(duplicateRate * 100).toFixed(2)}% must be below 1.00%`,
    );
  }
  if (criticalFalseTriggerCount !== 0) {
    gateFailures.push(
      `critical gesture false triggers must be zero; observed ${criticalFalseTriggerCount}`,
    );
  }
  for (const [sliceId, slice] of Object.entries(slices)) {
    if (slice.score < 0.85) {
      gateFailures.push(
        `gesture slice ${sliceId} ${(slice.score * 100).toFixed(2)}% is below 85.00%`,
      );
    }
  }
  if (release && delegatedAssets > 0) {
    gateFailures.push(
      `${delegatedAssets} browser-owned recorded-video asset(s) have no run-bound browser evidence`,
    );
  }
  const participantIds = new Set(
    evaluatedHumanAssets.map(({ participantId }) => participantId),
  );
  const minimumValidRepetitionsPerGesturePerCoreCondition =
    minimumGestureRepetitions(
      evaluatedHumanAssets,
      participantIds,
      manifest.requiredSlices,
    );
  const neutralMinutesPerParticipantMinimum =
    minimumNeutralMinutes(evaluatedHumanAssets, participantIds);
  return {
    schemaVersion: "airboard-gesture-eval-result.v1",
    corpusVersion: manifest.corpusVersion,
    datasetHash: gestureManifestHash(manifestBytes),
    generatedAt: new Date().toISOString(),
    mode: release ? "release" : "offline",
    datasetSplit: datasetSplit ?? null,
    gateFailures,
    summary: {
      totalAssets: safeResults.length,
      evaluatedAssets:
        safeResults.length - unevaluatedAssets - delegatedAssets,
      delegatedBrowserAssets: delegatedAssets,
      declaredBrowserAssets,
      browserEvaluatedAssets: safeResults.filter(
        ({ status, evaluationOwner }) =>
          status === "passed" &&
          evaluationOwner === "browser_video_replay",
      ).length,
      passedAssets: safeResults.filter(({ status }) => status === "passed")
        .length,
      failedAssets,
      unevaluatedAssets,
      expectedActionCount,
      actualActionCount,
      matchedActionCount: truePositiveActions,
      participantCount: participantIds.size,
    },
    metrics: {
      precision,
      recall,
      duplicateRate,
      duplicateActionCount,
      criticalFalseTriggerCount,
      acquireLatencyP95Ms: percentile(acquireSamplesMs, 0.95),
      releaseLatencyP95Ms: percentile(releaseSamplesMs, 0.95),
      frameProcessingP95Ms: percentile(processingSamplesMs, 0.95),
      slices,
    },
    confusionMatrices: {
      gestureAction: buildConfusionMatrix(gestureConfusionPairs),
    },
    coverage: {
      participantCount: participantIds.size,
      minimumValidRepetitionsPerGesturePerCoreCondition,
      neutralMinutesPerParticipantMinimum,
      evaluatedHumanAssetCount: evaluatedHumanAssets.length,
    },
    browserEvidence: {
      required: declaredBrowserAssets > 0,
      supplied: browserEvidenceSupplied,
      runBound:
        declaredBrowserAssets === 0 ||
        (delegatedAssets === 0 &&
          safeResults
            .filter(
              ({ evaluationOwner }) =>
                evaluationOwner === "browser_video_replay",
            )
            .every(({ status }) => status === "passed")),
    },
    results: safeResults,
    replay: `${browserEvidenceSupplied ? 'AIRBOARD_GESTURE_BROWSER_EVIDENCE_DIR=<evidence-dir> AIRBOARD_EVAL_RUN_ID=<run-id> ' : ""}node scripts/eval-gesture-replay.mjs${release ? " --release" : ""}${datasetSplit ? ` --dataset-split ${datasetSplit}` : ""}${browserEvidenceSupplied ? ' --browser-evidence-dir "$AIRBOARD_GESTURE_BROWSER_EVIDENCE_DIR" --run-id "$AIRBOARD_EVAL_RUN_ID"' : ""}`,
  };
}

function expandCountedActions(actions) {
  return (actions ?? []).flatMap(({ gesture, count }) =>
    Array.from(
      { length: Number.isSafeInteger(count) && count > 0 ? count : 0 },
      () => gesture,
    ),
  );
}

function expandActionCountRecord(counts) {
  return Object.entries(counts ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([gesture, count]) =>
      Array.from(
        { length: Number.isSafeInteger(count) && count > 0 ? count : 0 },
        () => gesture,
      ),
    );
}

function pairGestureActionTypes(expectedTypes, actualTypes) {
  const remainingActual = [...actualTypes];
  const pairs = [];
  const unmatchedExpected = [];
  for (const expected of expectedTypes) {
    const matchingIndex = remainingActual.indexOf(expected);
    if (matchingIndex >= 0) {
      remainingActual.splice(matchingIndex, 1);
      pairs.push({ expected, actual: expected });
    } else {
      unmatchedExpected.push(expected);
    }
  }
  const pairCount = Math.max(
    unmatchedExpected.length,
    remainingActual.length,
  );
  for (let index = 0; index < pairCount; index += 1) {
    pairs.push({
      expected: unmatchedExpected[index] ?? "no_event",
      actual: remainingActual[index] ?? "no_event",
    });
  }
  return pairs;
}

function landmarkTraceProvidesReleaseCoverage(asset) {
  return (
    asset?.assetClass === "derived" &&
    asset.artifactType === "landmark_trace" &&
    asset.annotations?.purpose !== "neutral_safety" &&
    LANDMARK_RELEASE_COVERAGE_GESTURES.has(asset.annotations?.gesture)
  );
}

function gestureSliceIds(annotations) {
  const ids = new Set();
  const conditionAliases = {
    "standalone-normal-light": "core_lighting",
    "standalone-low-light": "low_light",
  };
  if (typeof annotations?.condition === "string") {
    const alias = conditionAliases[annotations.condition];
    if (alias) ids.add(alias);
  }
  for (const value of annotations?.sliceTags ?? []) {
    if (
      typeof value === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/u.test(value)
    ) {
      ids.add(value);
    }
  }
  return ids;
}

function minimumGestureRepetitions(
  assets,
  participantIds,
  requiredSlices,
) {
  if (participantIds.size === 0) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const participantId of participantIds) {
    for (const gesture of requiredSlices?.shippedGestures ?? []) {
      for (const condition of requiredSlices?.coreConditions ?? []) {
        const repetitions = assets
          .filter(
            (asset) =>
              asset.participantId === participantId &&
              asset.annotations?.gesture === gesture &&
              asset.annotations?.condition === condition,
          )
          .reduce(
            (sum, asset) =>
              sum +
              (Number.isFinite(asset.annotations?.validRepetitions)
                ? asset.annotations.validRepetitions
                : 0),
            0,
          );
        minimum = Math.min(minimum, repetitions);
      }
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function minimumNeutralMinutes(assets, participantIds) {
  if (participantIds.size === 0) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const participantId of participantIds) {
    const seconds = assets
      .filter(
        (asset) =>
          asset.participantId === participantId &&
          asset.annotations?.purpose === "neutral_safety",
      )
      .reduce(
        (sum, asset) =>
          sum +
          (Number.isFinite(asset.annotations?.durationSeconds)
            ? asset.annotations.durationSeconds
            : 0),
        0,
      );
    minimum = Math.min(minimum, seconds / 60);
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function countMatchedGestureActions(expected, actual) {
  const remaining = new Set(actual.map((_, index) => index));
  let matched = 0;
  for (const expectedAction of expected) {
    const index = actual.findIndex(
      (actualAction, candidateIndex) =>
        remaining.has(candidateIndex) &&
        actualAction.type === expectedAction.type &&
        isRecord(expectedAction.windowMs) &&
        actualAction.t >= expectedAction.windowMs.from &&
        actualAction.t <= expectedAction.windowMs.to,
    );
    if (index >= 0) {
      remaining.delete(index);
      matched += 1;
    }
  }
  return matched;
}

async function writeEvaluationReports(report) {
  const root = process.env.AIRBOARD_EVAL_OUTPUT_DIR;
  if (!root) return;
  const outputDirectory = resolve(root, "gesture");
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputDirectory, "gesture-results.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(
      resolve(outputDirectory, "gesture-results.xml"),
      gestureJunit(report),
    ),
    writeFile(
      resolve(outputDirectory, "gesture-results.md"),
      gestureMarkdown(report),
    ),
    writeFile(
      resolve(outputDirectory, "gesture-results.html"),
      gestureHtml(report),
    ),
  ]);
  console.log(`Reports: ${outputDirectory}`);
}

function gestureJunit(report) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Airboard gesture replay" tests="${report.results.length + report.gateFailures.length}" failures="${report.summary.failedAssets + report.gateFailures.length}" skipped="${report.summary.unevaluatedAssets + (report.summary.delegatedBrowserAssets ?? 0)}">`,
  ];
  for (const result of report.results) {
    lines.push(
      `  <testcase classname="gesture-replay" name="${xml(result.id)}">`,
    );
    if (result.status === "failed") {
      lines.push(
        `    <failure message="gesture quality gate">${xml(result.problems.join("; "))}</failure>`,
      );
    } else if (result.status === "unevaluated_reference") {
      lines.push(
        '    <skipped message="Raw media remains in restricted storage and requires browser/device replay"/>',
      );
    } else if (result.status === "delegated_browser_replay") {
      lines.push(
        '    <skipped message="Evidence is owned by the recorded-video browser replay"/>',
      );
    }
    lines.push("  </testcase>");
  }
  report.gateFailures.forEach((failure, index) => {
    lines.push(
      `  <testcase classname="gesture-replay.release-gate" name="aggregate-${index + 1}"><failure message="quality gate">${xml(failure)}</failure></testcase>`,
    );
  });
  lines.push(
    `  <system-out>${xml(JSON.stringify({ confusionMatrices: report.confusionMatrices }, null, 2))}</system-out>`,
  );
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

function gestureMarkdown(report) {
  const lines = [
    "# Airboard gesture replay evaluation",
    "",
    `Dataset: \`${report.datasetHash}\`  `,
    `Replay: \`${report.replay}\``,
    "",
    `Precision: **${(report.metrics.precision * 100).toFixed(2)}%**; recall: **${(report.metrics.recall * 100).toFixed(2)}%**; duplicate rate: **${(report.metrics.duplicateRate * 100).toFixed(2)}%**; critical false triggers: **${report.metrics.criticalFalseTriggerCount}**.`,
    "",
    "## Gate failures",
    "",
    ...(report.gateFailures.length
      ? report.gateFailures.map((failure) => `- ${failure}`)
      : ["- None"]),
    "",
    "| Status | Asset | Precision | Recall | Duplicates |",
    "| --- | --- | ---: | ---: | ---: |",
    ...report.results.map(
      (result) =>
        `| ${result.status.toUpperCase()} | ${result.id} | ${result.precision.toFixed(3)} | ${result.recall.toFixed(3)} | ${result.duplicateActionCount} |`,
    ),
  ];
  appendGestureConfusionMarkdown(lines, report.confusionMatrices);
  return `${lines.join("\n")}\n`;
}

function gestureHtml(report) {
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${xml(result.status.toUpperCase())}</td><td>${xml(result.id)}</td><td>${result.precision.toFixed(3)}</td><td>${result.recall.toFixed(3)}</td><td>${result.duplicateActionCount}</td></tr>`,
    )
    .join("");
  const confusion = renderGestureConfusionHtml(report.confusionMatrices);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Airboard gesture evaluation</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}</style></head>
<body><h1>Airboard gesture replay evaluation</h1><p>Precision ${(report.metrics.precision * 100).toFixed(2)}%; recall ${(report.metrics.recall * 100).toFixed(2)}%; duplicates ${(report.metrics.duplicateRate * 100).toFixed(2)}%; critical false triggers ${report.metrics.criticalFalseTriggerCount}.</p><p>Dataset <code>${xml(report.datasetHash)}</code>.</p><h2>Gate failures</h2><ul>${(report.gateFailures.length ? report.gateFailures : ["None"]).map((failure) => `<li>${xml(failure)}</li>`).join("")}</ul>${confusion}<table><thead><tr><th>Status</th><th>Asset</th><th>Precision</th><th>Recall</th><th>Duplicates</th></tr></thead><tbody>${rows}</tbody></table></body></html>
`;
}

function appendGestureConfusionMarkdown(lines, matrices) {
  for (const [name, matrix] of Object.entries(matrices ?? {})) {
    if (!Array.isArray(matrix?.labels) || !matrix.matrix) continue;
    lines.push(
      "",
      `## Confusion matrix: ${name}`,
      "",
      `| Expected \\ Actual | ${matrix.labels.join(" | ")} |`,
      `| --- | ${matrix.labels.map(() => "---:").join(" | ")} |`,
    );
    for (const expected of matrix.labels) {
      lines.push(
        `| ${expected} | ${matrix.labels
          .map((actual) => matrix.matrix[expected]?.[actual] ?? 0)
          .join(" | ")} |`,
      );
    }
  }
}

function renderGestureConfusionHtml(matrices) {
  return Object.entries(matrices ?? {})
    .filter(([, matrix]) => Array.isArray(matrix?.labels) && matrix.matrix)
    .map(
      ([name, matrix]) =>
        `<section><h2>Confusion matrix: ${xml(name)}</h2><table><thead><tr><th>Expected \\ Actual</th>${matrix.labels.map((label) => `<th>${xml(label)}</th>`).join("")}</tr></thead><tbody>${matrix.labels.map((expected) => `<tr><th>${xml(expected)}</th>${matrix.labels.map((actual) => `<td>${matrix.matrix[expected]?.[actual] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`,
    )
    .join("");
}

function percentile(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseArguments(args) {
  const options = {
    manifest: null,
    release: false,
    browserEvidenceDirectory: null,
    runId: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--release") {
      options.release = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name === "--manifest") {
      const value = inlineValue ?? args[++index];
      if (!value) throw new Error("--manifest requires a path");
      options.manifest = value;
      continue;
    }
    if (name === "--media-root") {
      const value = inlineValue ?? args[++index];
      if (!value) throw new Error("--media-root requires a path");
      options.mediaRoot = value;
      continue;
    }
    if (name === "--browser-evidence-dir") {
      const value = inlineValue ?? args[++index];
      if (!value) throw new Error("--browser-evidence-dir requires a path");
      options.browserEvidenceDirectory = resolve(process.cwd(), value);
      continue;
    }
    if (name === "--run-id") {
      const value = inlineValue ?? args[++index];
      if (!value) throw new Error("--run-id requires a value");
      options.runId = value;
      continue;
    }
    if (name === "--dataset-split") {
      const value = inlineValue ?? args[++index];
      if (!["development", "regression", "holdout"].includes(value)) {
        throw new Error(
          "--dataset-split must be development, regression, or holdout",
        );
      }
      options.datasetSplit = value;
      continue;
    }
    if (!argument.startsWith("-") && options.manifest === null) {
      options.manifest = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printResults(manifest, manifestPath, results) {
  console.log(`Airboard gesture replay evaluation (${manifest.corpusVersion})`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Raw-media policy: ${manifest.rawMediaPolicy}`);

  for (const result of results) {
    const { asset, report, faultResults, problems } = result;
    const displayStatus =
      asset.assetClass === "restricted_raw_media" &&
      asset.annotations?.evaluationOwner === "browser_video_replay" &&
      !result.browserEvaluation
        ? "DELEGATED"
        : problems.length === 0
          ? "PASS"
          : "FAIL";
    console.log(`\n${displayStatus} ${asset.id}`);
    console.log(
      `  class/privacy: ${asset.assetClass} / ${asset.privacy.classification}`,
    );
    console.log(
      `  consent scope: ${asset.consent.status} (${asset.consent.scope.join(", ")})`,
    );
    if (asset.assetClass === "restricted_raw_media") {
      console.log("  storage: external reference only (raw media not read by aggregator)");
      if (result.browserEvaluation) {
        console.log(
          `  browser evidence: ${result.browserEvaluation.passed ? "accepted" : "REJECTED"} / hash ${result.browserEvaluation.hashVerified ? "verified" : "FAILED"} / ${result.browserEvaluation.actualActionCount} applied action(s)`,
        );
      } else if (
        asset.annotations?.evaluationOwner === "browser_video_replay"
      ) {
        console.log("  browser evidence: delegated; no run record supplied");
      }
      for (const problem of problems) {
        console.log(`    - ${problem}`);
      }
      continue;
    }
    console.log(
      `  SHA-256: ${result.hashVerified ? "verified" : "FAILED"} ${asset.hash.value}`,
    );
    if (report) {
      console.log(
        `  replay: ${report.summary.frameCount} frames / ${report.summary.durationMs}ms / ${report.actions.length} actions`,
      );
      console.log(
        `  actions: ${report.actions
          .map(
            (action) =>
              `${action.type}@${action.t}ms (${action.latencyMs}ms gate, owner=${action.frameOwner})`,
          )
          .join(", ")}`,
      );
      console.log(
        `  action gates: ${report.metrics.duplicateActionCount} duplicate / ${report.metrics.unpairedActionCount} unpaired`,
      );
      const ownerTransitions = report.frames
        .filter((frame) => frame.transition.owner !== null)
        .map(
          (frame) =>
            `${frame.transition.owner.from}->${frame.transition.owner.to}@${frame.t}ms`,
        );
      console.log(`  ownership: ${ownerTransitions.join(", ")}`);
    }
    for (const faultResult of faultResults) {
      console.log(
        `  fault ${faultResult.trial} seed frames [${faultResult.indexes.join(", ")}]: ${
          faultResult.problems.length === 0 ? "pass" : "FAIL"
        }`,
      );
    }
    for (const problem of problems) {
      console.log(`    - ${problem}`);
    }
  }

  const failureCount = results.reduce(
    (sum, result) => sum + result.problems.length,
    0,
  );
  console.log(
    `\nResult: ${failureCount === 0 ? "PASS" : "FAIL"} — ${failureCount} problem(s).`,
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const direct =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  main().catch((error) => {
    console.error(
      `Gesture replay evaluation could not start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 2;
  });
}
