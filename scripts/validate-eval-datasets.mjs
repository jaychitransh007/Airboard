#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const release = process.argv.includes("--release");
const mediaRoot = process.env.AIRBOARD_EVAL_MEDIA_ROOT
  ? resolve(process.env.AIRBOARD_EVAL_MEDIA_ROOT)
  : null;
const LANDMARK_RELEASE_COVERAGE_GESTURES = new Set([
  "manipulation_grab",
]);
const REQUIRED_AUDIO_CHANNELS = Object.freeze(["wake", "ptt", "scoped"]);
const REQUIRED_AUDIO_EVALUATION_CLASSES = Object.freeze([
  "core",
  "narrative",
  "safety",
]);
const REQUIRED_AUDIO_PROCESSING_PATHS = Object.freeze([
  "deterministic",
  "semantic",
  "no_route",
]);
const REQUIRED_AUDIO_CRITICAL_TOKEN_ROLES = Object.freeze([
  "wake_phrase",
  "action",
  "node_type",
  "count",
  "visible_label",
]);

main().catch((error) => {
  console.error(
    `Dataset validation could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});

async function main() {
  const audioManifest = await readJson("evals/audio/corpus.v1.json");
  const splits = await readJson("evals/datasets/participant-splits.v1.json");
  const gestureManifest = await readJson("evals/gesture/corpus.v1.json");
  const qualityGates = await readJson("evals/quality-gates/release.v1.json");
  const failures = [];
  const warnings = [];

  validatePolicy(audioManifest, failures);
  validateGesturePolicy(gestureManifest, qualityGates, failures);
  validateSplits(splits, failures, [
    ...(audioManifest.assets ?? []),
    ...(gestureManifest.assets ?? []),
  ]);
  await validateAssets(
    audioManifest.assets ?? [],
    failures,
    warnings,
    { requireMounted: release, mediaKind: "audio" },
  );
  await validateAssets(
    gestureManifest.assets ?? [],
    failures,
    warnings,
    { requireMounted: release, mediaKind: "gesture" },
  );
  await rejectRawMediaInGit(failures);

  if (release) {
    validateReleaseCoverage(
      audioManifest,
      gestureManifest,
      splits,
      failures,
    );
  } else if ((audioManifest.assets ?? []).length === 0) {
    warnings.push(
      "Audio corpus has no consented assets yet; PR gates cover protocol/manifest safety only.",
    );
  }

  console.log(
    `Airboard dataset validation: ${failures.length === 0 ? "PASS" : "FAIL"} (${release ? "release" : "PR"} policy)`,
  );
  for (const warning of warnings) console.log(`  WARN ${warning}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

function validatePolicy(manifest, failures) {
  if (manifest?.schemaVersion !== "1.0") failures.push("audio schemaVersion must be 1.0");
  const policy = manifest?.storagePolicy ?? {};
  if (policy.rawMediaInGit !== false) failures.push("rawMediaInGit must be false");
  if (policy.encryptedAtRest !== true) failures.push("encryptedAtRest must be true");
  if (policy.restrictedAccess !== true) failures.push("restrictedAccess must be true");
  if (policy.ciArtifactUpload !== false) failures.push("ciArtifactUpload must be false");
  if (policy.customerContentAllowed !== false) failures.push("customerContentAllowed must be false");
  const required = manifest?.requiredSlices ?? {};
  if (required.minimumSpeakers !== 24) {
    failures.push("audio minimumSpeakers must remain 24");
  }
  if (required.minimumIndianEnglishSpeakers < 1) {
    failures.push("audio must keep Indian English as a mandatory primary slice");
  }
  if (required.minimumAmbientHours !== 30) {
    failures.push("audio minimumAmbientHours must remain 30");
  }
  for (const [field, expected] of [
    ["channels", REQUIRED_AUDIO_CHANNELS],
    ["evaluationClasses", REQUIRED_AUDIO_EVALUATION_CLASSES],
    ["processingPaths", REQUIRED_AUDIO_PROCESSING_PATHS],
    ["criticalTokenRoles", REQUIRED_AUDIO_CRITICAL_TOKEN_ROLES],
  ]) {
    if (!sameStringSet(required[field], expected)) {
      failures.push(
        `audio requiredSlices.${field} must contain exactly ${expected.join(", ")}`,
      );
    }
  }
}

function validateGesturePolicy(manifest, qualityGates, failures) {
  if (manifest?.schemaVersion !== "1.0") {
    failures.push("gesture schemaVersion must be 1.0");
  }
  if (manifest?.rawMediaPolicy !== "reference_only") {
    failures.push("gesture rawMediaPolicy must be reference_only");
  }
  const required = manifest?.requiredSlices ?? {};
  if (required.minimumParticipants !== 24) {
    failures.push("gesture minimumParticipants must remain 24");
  }
  if (required.validRepetitionsPerGesturePerCoreCondition !== 3) {
    failures.push(
      "gesture valid repetitions per gesture/core condition must remain 3",
    );
  }
  if (required.neutralMinutesPerParticipant !== 10) {
    failures.push("gesture neutral minutes per participant must remain 10");
  }
  for (const key of [
    "shippedGestures",
    "coreConditions",
    "criticalFalseTriggerGestures",
    "qualitySlices",
  ]) {
    if (!Array.isArray(required[key]) || required[key].length === 0) {
      failures.push(`gesture requiredSlices.${key} must be non-empty`);
    }
  }
  const requiredQualitySlices =
    qualityGates?.releasePolicy?.sliceGates?.find(
      ({ metric }) => metric === "gesture.slices",
    )?.requiredSliceIds ?? [];
  if (
    JSON.stringify([...(required.qualitySlices ?? [])].sort()) !==
    JSON.stringify([...requiredQualitySlices].sort())
  ) {
    failures.push(
      "gesture requiredSlices.qualitySlices must match the release quality-gate slice IDs",
    );
  }
}

function validateSplits(manifest, failures, assets) {
  const participants = manifest?.participants ?? [];
  const participantSplit = new Map();
  const sessionSplit = new Map();
  for (const entry of participants) {
    if (!["development", "regression", "holdout"].includes(entry.split)) {
      failures.push(`participant ${entry.participantId ?? "unknown"} has invalid split`);
      continue;
    }
    checkExclusive(participantSplit, entry.participantId, entry.split, "participant", failures);
    for (const sessionId of entry.meetingSessionIds ?? []) {
      checkExclusive(sessionSplit, sessionId, entry.split, "meeting session", failures);
    }
  }
  const deleted = new Set((manifest?.deletions ?? []).map((entry) => entry.participantId));
  for (const participantId of deleted) {
    if (participants.some((entry) => entry.participantId === participantId)) {
      failures.push(`deleted participant ${participantId} remains in a dataset split`);
    }
    if (assets.some((asset) => asset.participantId === participantId)) {
      failures.push(
        `deleted participant ${participantId} remains in a dataset asset manifest`,
      );
    }
  }
}

function checkExclusive(map, key, split, label, failures) {
  if (typeof key !== "string" || !key) {
    failures.push(`${label} split key is missing`);
    return;
  }
  const prior = map.get(key);
  if (prior && prior !== split) {
    failures.push(`${label} ${key} leaks across ${prior} and ${split}`);
  }
  map.set(key, split);
}

async function validateAssets(
  assets,
  failures,
  warnings,
  { requireMounted, mediaKind },
) {
  const assetIds = new Set();
  for (const asset of assets) {
    if (typeof asset.id !== "string" || !asset.id) {
      failures.push(`${mediaKind} asset needs a non-empty id`);
    } else if (assetIds.has(asset.id)) {
      failures.push(`${mediaKind} corpus contains duplicate asset id ${asset.id}`);
    } else {
      assetIds.add(asset.id);
    }
    if (mediaKind === "audio" && asset.sttEvaluation) {
      const meetSurface = isMeetSurface(asset.surface);
      const expectedTransport = meetSurface ? "meet-bridge" : "direct";
      if (asset.sttEvaluation.transport !== expectedTransport) {
        failures.push(
          `audio asset ${asset.id ?? "unknown"} on ${meetSurface ? "a Meet" : "a non-Meet"} surface must declare sttEvaluation.transport=${expectedTransport}`,
        );
      }
    }
    const hash = asset.sha256 ?? asset.hash?.value;
    if (!/^[a-f0-9]{64}$/u.test(hash ?? "")) {
      failures.push(`asset ${asset.id ?? "unknown"} needs a SHA-256`);
    }
    const classification =
      asset.privacyClass ?? asset.privacy?.classification;
    if (typeof classification !== "string" || !classification) {
      failures.push(`asset ${asset.id ?? "unknown"} needs a privacy classification`);
    }
    const consentStatus = asset.consent?.status ?? asset.consentStatus;
    if (!["granted", "not_applicable"].includes(consentStatus)) {
      failures.push(`asset ${asset.id ?? "unknown"} lacks valid consent status`);
    }
    if (consentStatus === "granted") {
      const consentScope = asset.consent?.scope ?? asset.consentScope ?? [];
      for (const requiredScope of [
        "benchmark_retention",
        "provider_processing",
      ]) {
        if (
          mediaKind === "audio" &&
          !consentScope.includes(requiredScope)
        ) {
          failures.push(
            `audio asset ${asset.id ?? "unknown"} consent lacks ${requiredScope}`,
          );
        }
      }
    }
    if (asset.repositoryPath) {
      const path = resolve(root, asset.repositoryPath);
      const content = await readFile(path);
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== hash) {
        failures.push(`asset ${asset.id} hash mismatch`);
      }
    } else if (asset.storageKey) {
      if (isAbsolute(asset.storageKey)) {
        failures.push(`restricted asset ${asset.id} storageKey must be relative`);
        continue;
      }
      if (!mediaRoot) {
        const message = `restricted asset ${asset.id} not mounted (AIRBOARD_EVAL_MEDIA_ROOT)`;
        if (requireMounted) failures.push(message);
        else warnings.push(message);
      } else {
        try {
          const canonicalRoot = await realpath(mediaRoot);
          const unresolvedPath = resolve(canonicalRoot, asset.storageKey);
          assertInsideMediaRoot(canonicalRoot, unresolvedPath, asset.id);
          const path = await realpath(unresolvedPath);
          assertInsideMediaRoot(canonicalRoot, path, asset.id);
          const content = await readFile(path);
          const actualHash = createHash("sha256").update(content).digest("hex");
          if (actualHash !== hash) failures.push(`restricted asset ${asset.id} hash mismatch`);
        } catch (error) {
          failures.push(
            error instanceof DatasetPathEscapeError
              ? error.message
              : `restricted asset ${asset.id} is unavailable`,
          );
        }
      }
    }
  }
}

async function rejectRawMediaInGit(failures) {
  const forbidden = new Set([
    ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".pcm",
    ".mp4", ".mov", ".avi", ".webm", ".mkv", ".y4m",
  ]);
  for (const path of await walk(resolve(root, "evals"))) {
    if (forbidden.has(extname(path).toLocaleLowerCase("en-US"))) {
      failures.push(`raw media must not be committed under evals: ${path.slice(root.length + 1)}`);
    }
  }
}

function validateReleaseCoverage(
  audioManifest,
  gestureManifest,
  splits,
  failures,
) {
  const assets = audioManifest.assets ?? [];
  const participants = splits.participants ?? [];
  const speakers = new Set(assets.map((asset) => asset.participantId).filter(Boolean));
  const indianEnglish = new Set(
    assets
      .filter((asset) => asset.accent === "en-IN")
      .map((asset) => asset.participantId)
      .filter(Boolean),
  );
  const ambientHours =
    assets
      .filter((asset) => asset.purpose === "ambient_safety")
      .reduce((sum, asset) => sum + Number(asset.durationSeconds ?? 0), 0) / 3_600;
  const required = audioManifest.requiredSlices;
  if (speakers.size < required.minimumSpeakers) {
    failures.push(`release needs ${required.minimumSpeakers} speakers; found ${speakers.size}`);
  }
  if (indianEnglish.size < required.minimumIndianEnglishSpeakers) {
    failures.push(
      `release needs ${required.minimumIndianEnglishSpeakers} Indian-English speakers; found ${indianEnglish.size}`,
    );
  }
  if (ambientHours < required.minimumAmbientHours) {
    failures.push(
      `release needs ${required.minimumAmbientHours} ambient hours; found ${ambientHours.toFixed(2)}`,
    );
  }
  for (const split of ["development", "regression", "holdout"]) {
    if (!participants.some((entry) => entry.split === split)) {
      failures.push(`release dataset has no ${split} participants`);
    }
  }
  for (const participantId of speakers) {
    if (!participants.some((entry) => entry.participantId === participantId)) {
      failures.push(
        `audio participant ${participantId} has no participant-held-out split`,
      );
    }
  }
  for (const asset of audioManifest.assets ?? []) {
    validateHumanAnnotation(asset, "audio", failures);
    validateAssetSplit(asset, participants, "audio", failures);
    if (asset.language !== "en") {
      failures.push(`audio asset ${asset.id} must declare language en`);
    }
    if (
      typeof asset.accent !== "string" ||
      typeof asset.microphone !== "string" ||
      typeof asset.distance !== "string" ||
      typeof asset.lengthClass !== "string" ||
      typeof asset.surface !== "string" ||
      !Array.isArray(asset.conditions) ||
      asset.conditions.length === 0
    ) {
      failures.push(
        `audio asset ${asset.id} lacks accent/microphone/distance/conditions/length/surface slice metadata`,
      );
    }
    if (
      !isRecord(asset.sttEvaluation?.context) ||
      !isRecord(asset.sttEvaluation?.finalState)
    ) {
      failures.push(
        `audio asset ${asset.id} lacks a grounded context and finalState oracle`,
      );
    }
    if (
      !["deterministic", "semantic", "no_route"].includes(
        asset.sttEvaluation?.processingPath,
      )
    ) {
      failures.push(
        `audio asset ${asset.id} lacks an expected production processingPath`,
      );
    }
    const expectedTransport = isMeetSurface(asset.surface)
      ? "meet-bridge"
      : "direct";
    if (asset.sttEvaluation?.transport !== expectedTransport) {
      failures.push(
        `audio asset ${asset.id} must use ${expectedTransport} transport for surface ${asset.surface}`,
      );
    }
    if (
      asset.sttEvaluation?.processingPath === "semantic" &&
      !["resolved", "clarification", "unsupported"].includes(
        asset.sttEvaluation?.oracle?.expectedSemanticStatus,
      )
    ) {
      failures.push(
        `semantic audio asset ${asset.id} lacks expectedSemanticStatus`,
      );
    }
    validateAudioEvaluationOracle(asset, failures);
    if (
      asset.purpose === "ambient_safety" &&
      !(Number(asset.durationSeconds) > 0)
    ) {
      failures.push(
        `ambient audio asset ${asset.id} needs a positive durationSeconds`,
      );
    }
  }
  requireAudioSliceCoverage(audioManifest, failures);

  const splitCounts = Object.fromEntries(
    ["development", "regression", "holdout"].map((split) => [
      split,
      participants.filter((entry) => entry.split === split).length,
    ]),
  );
  const splitTotal = participants.length;
  if (splitTotal > 0) {
    const expectedPercent = {
      development: 60,
      regression: 20,
      holdout: 20,
    };
    for (const [split, expected] of Object.entries(expectedPercent)) {
      const actual = (splitCounts[split] / splitTotal) * 100;
      const tolerance = 100 / splitTotal;
      if (Math.abs(actual - expected) > tolerance) {
        failures.push(
          `${split} split is ${actual.toFixed(1)}%; expected ${expected}% within one participant`,
        );
      }
    }
  }

  validateGestureReleaseCoverage(gestureManifest, participants, failures);
}

function validateGestureReleaseCoverage(manifest, participants, failures) {
  const assets = manifest.assets ?? [];
  const required = manifest.requiredSlices ?? {};
  const humanAssets = assets.filter((asset) => asset.participantId);
  const evaluatedHumanAssets = humanAssets.filter((asset) =>
    isExecutableGestureAsset(asset),
  );
  const participantIds = new Set(
    evaluatedHumanAssets.map((asset) => asset.participantId),
  );
  for (const asset of humanAssets) {
    if (!isExecutableGestureAsset(asset)) {
      failures.push(
        `gesture asset ${asset.id} cannot contribute coverage: only manipulation_grab may use a consented derived landmark_trace; other gestures and neutral safety require browser-owned relative video/x-y4m replay`,
      );
    }
    validateBrowserReplayOracle(asset, failures);
  }
  if (participantIds.size < required.minimumParticipants) {
    failures.push(
      `gesture release needs ${required.minimumParticipants} participants; found ${participantIds.size}`,
    );
  }
  for (const participantId of participantIds) {
    if (!participants.some((entry) => entry.participantId === participantId)) {
      failures.push(
        `gesture participant ${participantId} has no participant-held-out split`,
      );
    }
    const neutralSeconds = evaluatedHumanAssets
      .filter(
        (asset) =>
          asset.participantId === participantId &&
          asset.annotations?.purpose === "neutral_safety",
      )
      .reduce(
        (sum, asset) => sum + Number(asset.annotations?.durationSeconds ?? 0),
        0,
      );
    if (
      neutralSeconds <
      Number(required.neutralMinutesPerParticipant ?? 0) * 60
    ) {
      failures.push(
        `gesture participant ${participantId} needs ${required.neutralMinutesPerParticipant} neutral minutes; found ${(neutralSeconds / 60).toFixed(1)}`,
      );
    }
    if (
      !evaluatedHumanAssets.some(
        (asset) =>
          asset.participantId === participantId &&
          asset.artifactType === "video" &&
          asset.contentType === "video/x-y4m" &&
          typeof asset.storageKey === "string" &&
          asset.storageKey.toLowerCase().endsWith(".y4m") &&
          asset.annotations?.evaluationOwner ===
            "browser_video_replay" &&
          isRecord(asset.annotations?.browserReplay),
      )
    ) {
      failures.push(
        `gesture participant ${participantId} needs a browser-owned recorded-video replay asset`,
      );
    }
  }
  for (const asset of humanAssets) {
    validateHumanAnnotation(asset, "gesture", failures);
    validateAssetSplit(asset, participants, "gesture", failures);
  }

  for (const gesture of required.shippedGestures ?? []) {
    for (const condition of required.coreConditions ?? []) {
      for (const participantId of participantIds) {
        const repetitions = evaluatedHumanAssets
          .filter(
            (asset) =>
              asset.participantId === participantId &&
              asset.annotations?.gesture === gesture &&
              asset.annotations?.condition === condition,
          )
          .reduce(
            (sum, asset) =>
              sum + Number(asset.annotations?.validRepetitions ?? 0),
            0,
          );
        if (
          repetitions <
          Number(required.validRepetitionsPerGesturePerCoreCondition ?? 0)
        ) {
          failures.push(
            `gesture ${gesture}/${condition}/${participantId} has ${repetitions} valid repetitions`,
          );
        }
      }
    }
  }
  for (const sliceId of required.qualitySlices ?? []) {
    if (
      !evaluatedHumanAssets.some(
        (asset) =>
          asset.participantId &&
          asset.annotations?.sliceTags?.includes(sliceId),
      ) &&
      !(
        sliceId === "core_lighting" &&
        evaluatedHumanAssets.some(
          (asset) =>
            asset.participantId &&
            asset.annotations?.condition === "standalone-normal-light",
        )
      ) &&
      !(
        sliceId === "low_light" &&
        evaluatedHumanAssets.some(
          (asset) =>
            asset.participantId &&
            asset.annotations?.condition === "standalone-low-light",
        )
      )
    ) {
      failures.push(`gesture release has no evaluated fixture for slice ${sliceId}`);
    }
  }
}

function isExecutableGestureAsset(asset) {
  if (
    asset?.artifactType === "landmark_trace" &&
    asset.assetClass === "derived" &&
    asset.annotations?.purpose !== "neutral_safety" &&
    LANDMARK_RELEASE_COVERAGE_GESTURES.has(asset.annotations?.gesture)
  ) {
    return (
      (typeof asset.repositoryPath === "string" &&
        asset.repositoryPath.length > 0) ||
      (typeof asset.storageKey === "string" &&
        asset.storageKey.length > 0 &&
        !isAbsolute(asset.storageKey))
    );
  }
  return (
    asset?.assetClass === "restricted_raw_media" &&
    asset.artifactType === "video" &&
    asset.contentType === "video/x-y4m" &&
    typeof asset.storageKey === "string" &&
    asset.storageKey.length > 0 &&
    asset.storageKey.toLowerCase().endsWith(".y4m") &&
    !isAbsolute(asset.storageKey) &&
    asset.annotations?.evaluationOwner === "browser_video_replay" &&
    isRecord(asset.annotations?.browserReplay)
  );
}

function validateBrowserReplayOracle(asset, failures) {
  if (asset.annotations?.evaluationOwner !== "browser_video_replay") return;
  const replay = asset.annotations.browserReplay;
  const expected = replay?.expectedAppliedActions;
  const validExpected =
    Array.isArray(expected) &&
    expected.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.gesture === "string" &&
        /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(entry.gesture) &&
        Number.isInteger(entry.count) &&
        entry.count > 0,
    ) &&
    new Set(expected.map(({ gesture }) => gesture)).size === expected.length;
  if (!validExpected) {
    failures.push(
      `gesture browser asset ${asset.id} needs unique expectedAppliedActions gesture/count entries`,
    );
    return;
  }
  if (
    !(Number(replay.runDurationMs) > 0) ||
    !Number.isInteger(replay.minimumPerceptionFrames) ||
    replay.minimumPerceptionFrames < 1
  ) {
    failures.push(
      `gesture browser asset ${asset.id} needs positive runDurationMs and minimumPerceptionFrames`,
    );
  }
  if (
    !(Number(replay.maximumFrameProcessingP95Ms) > 0) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      replay.expectedInitialBoardHash ?? "",
    ) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      replay.expectedFinalBoardHash ?? "",
    ) ||
    typeof replay.requireUndoRoundTrip !== "boolean"
  ) {
    failures.push(
      `gesture browser asset ${asset.id} needs a frame-processing budget, canonical initial/final board hashes, and explicit Undo policy`,
    );
  }
  const targeted = replay.requiredTargetedGestures;
  const validTargeted =
    Array.isArray(targeted) &&
    targeted.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.gesture === "string" &&
        /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(entry.gesture) &&
        Number.isInteger(entry.count) &&
        entry.count > 0,
    ) &&
    new Set(targeted.map(({ gesture }) => gesture)).size ===
      targeted.length;
  if (!validTargeted) {
    failures.push(
      `gesture browser asset ${asset.id} needs unique requiredTargetedGestures gesture/count entries`,
    );
  }
  if (
    asset.annotations?.gesture === "manipulation_grab" &&
    (!targeted?.some(({ gesture }) => gesture === "manipulation") ||
      replay.requireUndoRoundTrip !== true)
  ) {
    failures.push(
      `manipulation browser asset ${asset.id} must observe its target and pass a one-step Undo round trip`,
    );
  }
  if (
    asset.annotations?.gesture === "hold_to_edit" &&
    !targeted?.some(
      ({ gesture }) => gesture === "hold_to_edit_scope",
    )
  ) {
    failures.push(
      `hold-to-edit browser asset ${asset.id} must observe its scoped target`,
    );
  }
  const expectedCount = expected.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const repetitions = Number(asset.annotations?.validRepetitions ?? 0);
  if (repetitions > 0 && expectedCount < repetitions) {
    failures.push(
      `gesture browser asset ${asset.id} expects ${expectedCount} actions for ${repetitions} claimed repetitions`,
    );
  }
  const numericOutcomeFields = [
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
  ];
  for (const field of numericOutcomeFields) {
    if (
      replay[field] !== undefined &&
      (!Number.isFinite(replay[field]) || replay[field] < 0)
    ) {
      failures.push(
        `gesture browser asset ${asset.id} has invalid ${field}`,
      );
    }
  }
  for (const [minimum, maximum] of [
    ["minimumBoardEventCount", "maximumBoardEventCount"],
    ["minimumCommittedObjects", "maximumCommittedObjects"],
    ["minimumMovedObjectCount", "maximumMovedObjectCount"],
    ["minimumCreatedObjectCount", "maximumCreatedObjectCount"],
    ["minimumDeletedObjectCount", "maximumDeletedObjectCount"],
    ["minimumSelectionCount", "maximumSelectionCount"],
  ]) {
    if (
      Number.isFinite(replay[minimum]) &&
      Number.isFinite(replay[maximum]) &&
      replay[minimum] > replay[maximum]
    ) {
      failures.push(
        `gesture browser asset ${asset.id} has ${minimum} above ${maximum}`,
      );
    }
  }
  const gesture = asset.annotations?.gesture;
  if (
    gesture === "manipulation_grab" &&
    !(
      replay.minimumMovedObjectCount > 0 ||
      replay.minimumCreatedObjectCount > 0 ||
      replay.minimumDeletedObjectCount > 0
    )
  ) {
    failures.push(
      `manipulation browser asset ${asset.id} needs a non-zero board-object outcome`,
    );
  }
  if (
    gesture === "navigation_pan_zoom" &&
    !(
      replay.minimumViewportPanDistance > 0 ||
      replay.minimumViewportScaleDelta > 0
    )
  ) {
    failures.push(
      `navigation browser asset ${asset.id} needs a non-zero viewport outcome`,
    );
  }
  if (
    gesture === "visibility_snap" &&
    typeof replay.expectedDiagramVisible !== "boolean"
  ) {
    failures.push(
      `visibility browser asset ${asset.id} needs expectedDiagramVisible`,
    );
  }
  if (
    gesture === "undo_swipe" &&
    !(replay.minimumBoardEventCount > 0)
  ) {
    failures.push(
      `undo browser asset ${asset.id} needs a non-zero board-event outcome`,
    );
  }
  if (
    asset.annotations?.purpose === "neutral_safety" &&
    (expectedCount !== 0 || replay.maximumBoardEventCount !== 0)
  ) {
    failures.push(
      `neutral gesture browser asset ${asset.id} must expect zero applied actions and zero board events`,
    );
  }
  const setup = replay.setup;
  if (setup !== undefined && !isRecord(setup)) {
    failures.push(`gesture browser asset ${asset.id} setup must be an object`);
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
      failures.push(
        `gesture browser asset ${asset.id} setup transcripts must be bounded Airo wake commands`,
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
      failures.push(
        `gesture browser asset ${asset.id} setup viewport is invalid`,
      );
    }
    if (
      setup.diagramVisible !== undefined &&
      typeof setup.diagramVisible !== "boolean"
    ) {
      failures.push(
        `gesture browser asset ${asset.id} setup diagramVisible must be boolean`,
      );
    }
  }
}

class DatasetPathEscapeError extends Error {}

function assertInsideMediaRoot(rootPath, candidatePath, assetId) {
  const pathFromRoot = relative(rootPath, candidatePath);
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new DatasetPathEscapeError(
      `asset ${assetId} escapes AIRBOARD_EVAL_MEDIA_ROOT`,
    );
  }
}

function requireAudioSliceCoverage(manifest, failures) {
  const assets = manifest.assets ?? [];
  const required = manifest.requiredSlices ?? {};
  const fields = [
    ["microphones", "microphone"],
    ["distances", "distance"],
    ["lengths", "lengthClass"],
    ["surfaces", "surface"],
  ];
  for (const [requiredField, assetField] of fields) {
    for (const value of required[requiredField] ?? []) {
      if (!assets.some((asset) => asset[assetField] === value)) {
        failures.push(
          `audio release has no asset for ${assetField}=${value}`,
        );
      }
    }
  }
  for (const condition of required.conditions ?? []) {
    if (
      !assets.some(
        (asset) =>
          Array.isArray(asset.conditions) &&
          asset.conditions.includes(condition),
      )
    ) {
      failures.push(`audio release has no asset for condition=${condition}`);
    }
  }
  for (const channel of required.channels ?? []) {
    if (
      !assets.some(
        (asset) => asset.sttEvaluation?.channel === channel,
      )
    ) {
      failures.push(`audio release has no evaluated channel=${channel}`);
    }
  }
  for (const evaluationClass of required.evaluationClasses ?? []) {
    if (
      !assets.some(
        (asset) =>
          asset.sttEvaluation?.evaluationClass === evaluationClass,
      )
    ) {
      failures.push(
        `audio release has no evaluationClass=${evaluationClass}`,
      );
    }
  }
  for (const processingPath of required.processingPaths ?? []) {
    if (
      !assets.some(
        (asset) =>
          asset.sttEvaluation?.processingPath === processingPath,
      )
    ) {
      failures.push(
        `audio release has no production processingPath=${processingPath}`,
      );
    }
  }
  for (const role of required.criticalTokenRoles ?? []) {
    if (
      !assets.some((asset) =>
        Array.isArray(
          asset.sttEvaluation?.oracle?.criticalTokenRoles?.[role],
        ) &&
        asset.sttEvaluation.oracle.criticalTokenRoles[role].length > 0,
      )
    ) {
      failures.push(
        `audio release has no command-critical token evidence for role=${role}`,
      );
    }
  }
  if (
    !assets.some(
      (asset) =>
        asset.sttEvaluation?.processingPath === "semantic" &&
        asset.sttEvaluation?.oracle?.expectedSemanticStatus === "resolved" &&
        Array.isArray(asset.sttEvaluation?.oracle?.expectedActions) &&
        asset.sttEvaluation.oracle.expectedActions.length > 0,
    )
  ) {
    failures.push(
      "audio release has no resolved semantic scenario with a positive downstream action",
    );
  }
}

function validateAudioEvaluationOracle(asset, failures) {
  const evaluation = asset.sttEvaluation;
  const oracle = evaluation?.oracle;
  if (!isRecord(evaluation) || !isRecord(oracle)) return;
  const criticalTokens = Array.isArray(oracle.criticalTokens)
    ? oracle.criticalTokens
    : [];
  const expectedActions = Array.isArray(oracle.expectedActions)
    ? oracle.expectedActions
    : [];
  if (
    evaluation.evaluationClass !== "safety" &&
    criticalTokens.length === 0
  ) {
    failures.push(
      `audio asset ${asset.id} has no command-critical token oracle`,
    );
  }
  if (
    evaluation.evaluationClass === "core" &&
    expectedActions.length === 0
  ) {
    failures.push(
      `core audio asset ${asset.id} has no expected downstream action`,
    );
  }
  if (
    evaluation.evaluationClass === "safety" &&
    (expectedActions.length !== 0 ||
      oracle.maximumRoutedActions !== 0)
  ) {
    failures.push(
      `safety audio asset ${asset.id} must forbid routed actions explicitly`,
    );
  }
  if (
    asset.purpose === "ambient_safety" &&
    evaluation.evaluationClass !== "safety"
  ) {
    failures.push(
      `ambient audio asset ${asset.id} must use evaluationClass=safety`,
    );
  }
  const roles = oracle.criticalTokenRoles;
  if (roles !== undefined && !isRecord(roles)) {
    failures.push(
      `audio asset ${asset.id} criticalTokenRoles must be an object`,
    );
    return;
  }
  for (const [role, tokens] of Object.entries(roles ?? {})) {
    if (
      !REQUIRED_AUDIO_CRITICAL_TOKEN_ROLES.includes(role) ||
      !Array.isArray(tokens) ||
      tokens.length === 0 ||
      tokens.some(
        (token) =>
          typeof token !== "string" ||
          !criticalTokens.includes(token),
      )
    ) {
      failures.push(
        `audio asset ${asset.id} has invalid criticalTokenRoles.${role}`,
      );
    }
  }
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value) => typeof value === "string") &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

function validateAssetSplit(asset, participants, mediaKind, failures) {
  const participant = participants.find(
    (entry) => entry.participantId === asset.participantId,
  );
  if (!participant) return;
  if (asset.datasetSplit !== participant.split) {
    failures.push(
      `${mediaKind} asset ${asset.id} split ${asset.datasetSplit ?? "missing"} does not match participant split ${participant.split}`,
    );
  }
  if (
    typeof asset.meetingSessionId !== "string" ||
    !participant.meetingSessionIds?.includes(asset.meetingSessionId)
  ) {
    failures.push(
      `${mediaKind} asset ${asset.id} meeting session is absent from its participant-held-out split`,
    );
  }
}

function validateHumanAnnotation(asset, mediaKind, failures) {
  const annotatorIds = asset.annotation?.annotatorIds ?? [];
  if (
    !Array.isArray(annotatorIds) ||
    new Set(annotatorIds.filter(Boolean)).size < 2
  ) {
    failures.push(
      `${mediaKind} asset ${asset.id ?? "unknown"} needs two independent annotators`,
    );
  }
  if (
    asset.annotation?.agreement === "disagreed" &&
    asset.annotation?.adjudication?.status !== "completed"
  ) {
    failures.push(
      `${mediaKind} asset ${asset.id ?? "unknown"} disagreement is not adjudicated`,
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMeetSurface(surface) {
  return [
    "meet",
    "meet-bridge",
    "meet-main-stage",
    "meet-side-panel",
  ].includes(surface);
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}
