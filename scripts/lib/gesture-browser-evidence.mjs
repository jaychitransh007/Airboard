import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const GESTURE_BROWSER_EVIDENCE_SCHEMA_VERSION =
  "airboard-gesture-browser-evidence.v2";

/**
 * Build a content-free record after a recorded-video browser test has passed.
 * Participant/session metadata and restricted media paths intentionally never
 * enter this record; the release aggregator joins the opaque asset id back to
 * the protected manifest in memory.
 */
export function createGestureBrowserEvidence({
  runId,
  corpusVersion,
  manifestHash,
  datasetSplit,
  assetId,
  assetHash,
  observation,
  observedAt = new Date(),
}) {
  const evidence = {
    schemaVersion: GESTURE_BROWSER_EVIDENCE_SCHEMA_VERSION,
    runId,
    corpusVersion,
    manifestHash,
    datasetSplit,
    assetId,
    assetHash,
    status: "passed",
    observedAt: normalizeDate(observedAt),
    observation: normalizeObservation(observation),
  };
  const problems = validateEvidenceShape(evidence);
  if (problems.length > 0) {
    throw new TypeError(
      `Invalid gesture browser evidence: ${problems.join("; ")}`,
    );
  }
  return evidence;
}

export async function writeGestureBrowserEvidence(directory, evidence) {
  const problems = validateEvidenceShape(evidence);
  if (problems.length > 0) {
    throw new TypeError(
      `Invalid gesture browser evidence: ${problems.join("; ")}`,
    );
  }
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new TypeError("gesture browser evidence directory is required");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const opaqueName = createHash("sha256")
    .update(evidence.assetId)
    .digest("hex");
  await writeFile(
    resolve(directory, `${opaqueName}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
}

export async function loadGestureBrowserEvidence(directory) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new TypeError("gesture browser evidence directory is required");
  }
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = resolve(directory, entry.name);
    let evidence;
    try {
      evidence = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      records.push({
        evidence: null,
        problems: [
          `invalid evidence JSON ${entry.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      });
      continue;
    }
    records.push({
      evidence,
      problems: validateEvidenceShape(evidence),
    });
  }
  return records;
}

/**
 * Re-evaluate a browser-owned asset from measurements rather than trusting a
 * Playwright pass flag or the manifest's coverage annotations.
 */
export function evaluateGestureBrowserEvidence({
  asset,
  evidence,
  runId,
  corpusVersion,
  manifestHash,
  datasetSplit,
}) {
  const problems = validateEvidenceShape(evidence);
  if (!isRecord(asset)) {
    return failedBrowserEvaluation(["browser replay asset is invalid"]);
  }
  if (evidence?.runId !== runId) {
    problems.push("evidence runId does not match this evaluation run");
  }
  if (evidence?.corpusVersion !== corpusVersion) {
    problems.push("evidence corpusVersion does not match the manifest");
  }
  if (evidence?.manifestHash !== manifestHash) {
    problems.push("evidence manifestHash does not match the manifest");
  }
  if (evidence?.datasetSplit !== datasetSplit) {
    problems.push("evidence datasetSplit does not match the selected split");
  }
  if (evidence?.assetId !== asset.id) {
    problems.push("evidence assetId does not match the manifest asset");
  }
  if (evidence?.assetHash !== asset.hash?.value) {
    problems.push("evidence assetHash does not match the manifest asset");
  }
  if (evidence?.status !== "passed") {
    problems.push("browser replay evidence does not have passed status");
  }

  const oracle = asset.annotations?.browserReplay;
  if (!isRecord(oracle)) {
    problems.push("browserReplay oracle is missing");
  }
  const expectedCounts = expectedActionCounts(
    oracle?.expectedAppliedActions,
    problems,
  );
  const actualCounts = actionCountMap(
    evidence?.observation?.appliedActions,
    "observation.appliedActions",
    problems,
  );
  const expectedTargetCounts = actionCountMap(
    oracle?.requiredTargetedGestures ?? [],
    "browserReplay.requiredTargetedGestures",
    problems,
  );
  const actualTargetCounts = actionCountMap(
    evidence?.observation?.targetedGestures,
    "observation.targetedGestures",
    problems,
  );
  const expectedActionCount = sumCounts(expectedCounts);
  const actualActionCount = sumCounts(actualCounts);
  let matchedActionCount = 0;
  let duplicateActionCount = 0;
  for (const [gesture, expected] of expectedCounts) {
    const actual = actualCounts.get(gesture) ?? 0;
    matchedActionCount += Math.min(expected, actual);
    if (actual !== expected) {
      problems.push(
        `applied action ${gesture} expected ${expected}, observed ${actual}`,
      );
    }
    duplicateActionCount += Math.max(0, actual - expected);
  }
  for (const [gesture, actual] of actualCounts) {
    if (!expectedCounts.has(gesture)) {
      problems.push(`unexpected applied action ${gesture} observed ${actual} time(s)`);
      duplicateActionCount += actual;
    }
  }

  const observation = evidence?.observation ?? {};
  requireMinimum(
    problems,
    observation.perceptionFrameCount,
    oracle?.minimumPerceptionFrames ?? 1,
    "perception frame count",
  );
  for (const stage of oracle?.requiredStages ?? []) {
    if (!observation.observedStages?.includes(stage)) {
      problems.push(`required gesture stage ${stage} was not observed`);
    }
  }
  for (const owner of oracle?.requiredOwners ?? []) {
    if (!observation.observedOwners?.includes(owner)) {
      problems.push(`required arbitration owner ${owner} was not observed`);
    }
  }
  for (const gesture of oracle?.forbiddenGestureActions ?? []) {
    if ((actualCounts.get(gesture) ?? 0) > 0) {
      problems.push(`forbidden applied gesture ${gesture} was observed`);
    }
  }
  for (const [gesture, minimum] of expectedTargetCounts) {
    const actual = actualTargetCounts.get(gesture) ?? 0;
    if (actual < minimum) {
      problems.push(
        `target observations for ${gesture} expected at least ${minimum}, observed ${actual}`,
      );
    }
  }
  requireBounds(
    problems,
    observation.boardEventCount,
    oracle?.minimumBoardEventCount,
    oracle?.maximumBoardEventCount,
    "board event count",
  );
  requireBounds(
    problems,
    observation.committedObjectCount,
    oracle?.minimumCommittedObjects,
    oracle?.maximumCommittedObjects,
    "committed object count",
  );
  for (const [field, label, minimumField, maximumField] of [
    [
      "movedObjectCount",
      "moved object count",
      "minimumMovedObjectCount",
      "maximumMovedObjectCount",
    ],
    [
      "createdObjectCount",
      "created object count",
      "minimumCreatedObjectCount",
      "maximumCreatedObjectCount",
    ],
    [
      "deletedObjectCount",
      "deleted object count",
      "minimumDeletedObjectCount",
      "maximumDeletedObjectCount",
    ],
    [
      "finalSelectionCount",
      "final selection count",
      "minimumSelectionCount",
      "maximumSelectionCount",
    ],
  ]) {
    requireBounds(
      problems,
      observation[field],
      oracle?.[minimumField],
      oracle?.[maximumField],
      label,
    );
  }
  requireMinimum(
    problems,
    observation.viewportPanDistance,
    oracle?.minimumViewportPanDistance ?? 0,
    "viewport pan distance",
  );
  requireMinimum(
    problems,
    observation.viewportScaleDelta,
    oracle?.minimumViewportScaleDelta ?? 0,
    "viewport scale delta",
  );
  if (
    typeof oracle?.expectedDiagramVisible === "boolean" &&
    observation.finalDiagramVisible !== oracle.expectedDiagramVisible
  ) {
    problems.push(
      `diagram visibility expected ${oracle.expectedDiagramVisible}, observed ${observation.finalDiagramVisible}`,
    );
  }
  requireMinimum(
    problems,
    observation.undoDepth,
    oracle?.minimumUndoDepth ?? 0,
    "undo depth",
  );
  const frameProcessingP95Ms = finiteNumber(
    observation.frameProcessingP95Ms,
  );
  if (frameProcessingP95Ms === null) {
    problems.push("frame processing p95 is missing");
  } else if (
    !Number.isFinite(oracle?.maximumFrameProcessingP95Ms)
  ) {
    problems.push("maximum frame processing p95 gate is missing");
  } else if (
    frameProcessingP95Ms > oracle.maximumFrameProcessingP95Ms
  ) {
    problems.push(
      `frame processing p95 ${frameProcessingP95Ms}ms exceeds ${oracle.maximumFrameProcessingP95Ms}ms`,
    );
  }
  for (const [field, expectedField, label] of [
    [
      "initialBoardHash",
      "expectedInitialBoardHash",
      "initial canonical board",
    ],
    [
      "finalBoardHash",
      "expectedFinalBoardHash",
      "final canonical board",
    ],
  ]) {
    const expectedHash = oracle?.[expectedField];
    const observedHash = observation[field];
    if (!isSha256(expectedHash)) {
      problems.push(`${expectedField} oracle is missing or invalid`);
    } else if (observedHash !== expectedHash) {
      problems.push(
        `${label} hash does not match the declared oracle`,
      );
    }
  }
  if (
    oracle?.requireUndoRoundTrip === true &&
    (observation.undoRoundTrip !== true ||
      observation.postUndoBoardHash !==
        observation.initialBoardHash)
  ) {
    problems.push(
      "one-step Undo did not restore the initial canonical board",
    );
  }

  const forbiddenCritical = new Set(
    asset.annotations?.criticalFalseTriggerGestures ?? [],
  );
  let criticalFalseTriggerCount =
    asset.annotations?.purpose === "neutral_safety"
      ? actualActionCount
      : 0;
  for (const gesture of forbiddenCritical) {
    criticalFalseTriggerCount += actualCounts.get(gesture) ?? 0;
  }

  return {
    passed: problems.length === 0,
    problems: unique(problems),
    hashVerified:
      evidence?.manifestHash === manifestHash &&
      evidence?.assetHash === asset.hash?.value,
    expectedActionCount,
    actualActionCount,
    matchedActionCount,
    duplicateActionCount,
    criticalFalseTriggerCount,
    actionCounts: Object.fromEntries(
      [...actualCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    perceptionFrameCount: finiteInteger(observation.perceptionFrameCount) ?? 0,
    traceEventCount: finiteInteger(observation.traceEventCount) ?? 0,
    durationMs: finiteNumber(observation.durationMs),
    boardEventCount: finiteInteger(observation.boardEventCount) ?? 0,
    committedObjectCount:
      finiteInteger(observation.committedObjectCount) ?? 0,
    movedObjectCount: finiteInteger(observation.movedObjectCount) ?? 0,
    createdObjectCount:
      finiteInteger(observation.createdObjectCount) ?? 0,
    deletedObjectCount:
      finiteInteger(observation.deletedObjectCount) ?? 0,
    viewportPanDistance: finiteNumber(observation.viewportPanDistance),
    viewportScaleDelta: finiteNumber(observation.viewportScaleDelta),
    finalDiagramVisible:
      typeof observation.finalDiagramVisible === "boolean"
        ? observation.finalDiagramVisible
        : null,
    finalSelectionCount:
      finiteInteger(observation.finalSelectionCount) ?? 0,
    undoDepth: finiteInteger(observation.undoDepth) ?? 0,
    targetedGestureCounts: Object.fromEntries(
      [...actualTargetCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    frameProcessingP95Ms,
    initialBoardHash:
      isSha256(observation.initialBoardHash)
        ? observation.initialBoardHash
        : null,
    finalBoardHash:
      isSha256(observation.finalBoardHash)
        ? observation.finalBoardHash
        : null,
    undoRoundTrip:
      typeof observation.undoRoundTrip === "boolean"
        ? observation.undoRoundTrip
        : null,
    postUndoBoardHash:
      isSha256(observation.postUndoBoardHash)
        ? observation.postUndoBoardHash
        : null,
  };
}

export function gestureManifestHash(manifestBytes) {
  return `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
}

function normalizeObservation(observation) {
  const actionCounts = new Map();
  for (const action of Array.isArray(observation?.appliedActions)
    ? observation.appliedActions
    : []) {
    const gesture =
      typeof action === "string"
        ? action
        : typeof action?.gesture === "string"
          ? action.gesture
          : null;
    if (gesture && safeIdentifier(gesture)) {
      const increment =
        isRecord(action) &&
        Number.isInteger(action.count) &&
        action.count > 0
          ? action.count
          : 1;
      actionCounts.set(
        gesture,
        (actionCounts.get(gesture) ?? 0) + increment,
      );
    }
  }
  return {
    durationMs: finiteNumber(observation?.durationMs),
    perceptionFrameCount: finiteInteger(observation?.perceptionFrameCount),
    traceEventCount: finiteInteger(observation?.traceEventCount),
    observedStages: Array.isArray(observation?.observedStages)
      ? safeStringSet(observation.observedStages)
      : null,
    observedOwners: Array.isArray(observation?.observedOwners)
      ? safeStringSet(observation.observedOwners)
      : null,
    appliedActions: Array.isArray(observation?.appliedActions)
      ? [...actionCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([gesture, count]) => ({ gesture, count }))
      : null,
    targetedGestures: Array.isArray(observation?.targetedGestures)
      ? [...actionCountMap(
          observation.targetedGestures,
          "observation.targetedGestures",
          [],
        ).entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([gesture, count]) => ({ gesture, count }))
      : null,
    frameProcessingP95Ms: finiteNumber(
      observation?.frameProcessingP95Ms,
    ),
    boardEventCount: finiteInteger(observation?.boardEventCount),
    committedObjectCount: finiteInteger(observation?.committedObjectCount),
    movedObjectCount: finiteInteger(observation?.movedObjectCount),
    createdObjectCount: finiteInteger(observation?.createdObjectCount),
    deletedObjectCount: finiteInteger(observation?.deletedObjectCount),
    viewportPanDistance: finiteNumber(observation?.viewportPanDistance),
    viewportScaleDelta: finiteNumber(observation?.viewportScaleDelta),
    finalDiagramVisible:
      typeof observation?.finalDiagramVisible === "boolean"
        ? observation.finalDiagramVisible
        : null,
    finalSelectionCount: finiteInteger(observation?.finalSelectionCount),
    undoDepth: finiteInteger(observation?.undoDepth),
    initialBoardHash: isSha256(observation?.initialBoardHash)
      ? observation.initialBoardHash
      : null,
    finalBoardHash: isSha256(observation?.finalBoardHash)
      ? observation.finalBoardHash
      : null,
    undoRoundTrip:
      typeof observation?.undoRoundTrip === "boolean"
        ? observation.undoRoundTrip
        : null,
    postUndoBoardHash: isSha256(observation?.postUndoBoardHash)
      ? observation.postUndoBoardHash
      : null,
  };
}

function validateEvidenceShape(evidence) {
  const problems = [];
  if (!isRecord(evidence)) return ["evidence must be an object"];
  if (evidence.schemaVersion !== GESTURE_BROWSER_EVIDENCE_SCHEMA_VERSION) {
    problems.push(
      `schemaVersion must be ${GESTURE_BROWSER_EVIDENCE_SCHEMA_VERSION}`,
    );
  }
  for (const field of [
    "runId",
    "corpusVersion",
    "datasetSplit",
    "assetId",
  ]) {
    if (
      typeof evidence[field] !== "string" ||
      evidence[field].length === 0 ||
      evidence[field].length > 256
    ) {
      problems.push(`${field} must be a non-empty bounded string`);
    }
  }
  for (const field of ["manifestHash", "assetHash"]) {
    const value = evidence[field];
    const pattern =
      field === "manifestHash"
        ? /^sha256:[a-f0-9]{64}$/u
        : /^[a-f0-9]{64}$/u;
    if (typeof value !== "string" || !pattern.test(value)) {
      problems.push(`${field} must be a lowercase SHA-256`);
    }
  }
  if (evidence.status !== "passed") {
    problems.push("status must be passed");
  }
  if (!isRecord(evidence.observation)) {
    problems.push("observation must be an object");
    return problems;
  }
  for (const field of [
    "perceptionFrameCount",
    "traceEventCount",
    "boardEventCount",
    "committedObjectCount",
    "movedObjectCount",
    "createdObjectCount",
    "deletedObjectCount",
    "finalSelectionCount",
    "undoDepth",
  ]) {
    if (finiteInteger(evidence.observation[field]) === null) {
      problems.push(`observation.${field} must be a non-negative integer`);
    }
  }
  if (finiteNumber(evidence.observation.durationMs) === null) {
    problems.push("observation.durationMs must be non-negative");
  }
  for (const field of ["viewportPanDistance", "viewportScaleDelta"]) {
    if (finiteNumber(evidence.observation[field]) === null) {
      problems.push(`observation.${field} must be non-negative`);
    }
  }
  if (finiteNumber(evidence.observation.frameProcessingP95Ms) === null) {
    problems.push(
      "observation.frameProcessingP95Ms must be non-negative",
    );
  }
  if (typeof evidence.observation.finalDiagramVisible !== "boolean") {
    problems.push("observation.finalDiagramVisible must be boolean");
  }
  for (const field of ["observedStages", "observedOwners"]) {
    if (
      !Array.isArray(evidence.observation[field]) ||
      !evidence.observation[field].every(safeIdentifier)
    ) {
      problems.push(`observation.${field} must contain safe identifiers`);
    }
  }
  actionCountMap(
    evidence.observation.appliedActions,
    "observation.appliedActions",
    problems,
  );
  actionCountMap(
    evidence.observation.targetedGestures,
    "observation.targetedGestures",
    problems,
  );
  for (const field of ["initialBoardHash", "finalBoardHash"]) {
    if (!isSha256(evidence.observation[field])) {
      problems.push(
        `observation.${field} must be a lowercase SHA-256`,
      );
    }
  }
  if (
    evidence.observation.undoRoundTrip !== null &&
    typeof evidence.observation.undoRoundTrip !== "boolean"
  ) {
    problems.push("observation.undoRoundTrip must be boolean or null");
  }
  if (
    evidence.observation.postUndoBoardHash !== null &&
    !isSha256(evidence.observation.postUndoBoardHash)
  ) {
    problems.push(
      "observation.postUndoBoardHash must be a lowercase SHA-256 or null",
    );
  }
  return unique(problems);
}

function expectedActionCounts(value, problems) {
  return actionCountMap(value, "browserReplay.expectedAppliedActions", problems);
}

function actionCountMap(value, label, problems) {
  const result = new Map();
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array`);
    return result;
  }
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      !safeIdentifier(entry.gesture) ||
      finiteInteger(entry.count) === null ||
      entry.count < 1
    ) {
      problems.push(`${label}[${index}] must have a gesture and positive count`);
      continue;
    }
    if (result.has(entry.gesture)) {
      problems.push(`${label} contains duplicate gesture ${entry.gesture}`);
      continue;
    }
    result.set(entry.gesture, entry.count);
  }
  return result;
}

function requireBounds(problems, actual, minimum, maximum, label) {
  if (finiteInteger(actual) === null) {
    problems.push(`${label} is not a non-negative integer`);
    return;
  }
  if (Number.isFinite(minimum) && actual < minimum) {
    problems.push(`${label} ${actual} is below ${minimum}`);
  }
  if (Number.isFinite(maximum) && actual > maximum) {
    problems.push(`${label} ${actual} exceeds ${maximum}`);
  }
}

function requireMinimum(problems, actual, minimum, label) {
  requireBounds(problems, actual, minimum, undefined, label);
}

function safeStringSet(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(safeIdentifier))].sort();
}

function safeIdentifier(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value)
  );
}

function finiteInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function sumCounts(counts) {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("observedAt must be a valid date");
  }
  return date.toISOString();
}

function failedBrowserEvaluation(problems) {
  return {
    passed: false,
    problems,
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
    movedObjectCount: 0,
    createdObjectCount: 0,
    deletedObjectCount: 0,
    viewportPanDistance: 0,
    viewportScaleDelta: 0,
    finalDiagramVisible: true,
    finalSelectionCount: 0,
    undoDepth: 0,
    targetedGestureCounts: {},
    frameProcessingP95Ms: null,
    initialBoardHash: null,
    finalBoardHash: null,
    undoRoundTrip: null,
    postUndoBoardHash: null,
  };
}

function isSha256(value) {
  return (
    typeof value === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(value)
  );
}

function unique(values) {
  return [...new Set(values)];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
