import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const QUALITY_REPORT_SCHEMA_VERSION =
  "airboard-quality-report.v1";

const SOURCE_DEFINITIONS = Object.freeze({
  interaction: {
    relativePath: "interactions/interaction-results.json",
    schemaVersion: "interaction-eval-report.v1",
  },
  semanticContract: {
    relativePath: "semantic/semantic-contract.json",
    schemaVersion: "airboard-semantic-eval-result.v1",
  },
  semanticMetamorphic: {
    relativePath: "semantic/semantic-metamorphic.json",
    schemaVersion: "airboard-semantic-eval-result.v1",
  },
  semanticAmbient: {
    relativePath: "semantic/semantic-ambient-safety.json",
    schemaVersion: "airboard-semantic-eval-result.v1",
  },
  audio: {
    relativePath: "audio/audio-results.json",
    schemaVersion: "airboard-audio-stt-eval-result.v1",
  },
  gesture: {
    relativePath: "gesture/gesture-results.json",
    schemaVersion: "airboard-gesture-eval-result.v1",
  },
});

const MINIMUM_AUDIO_SPEAKERS = 24;
const MINIMUM_INDIAN_ENGLISH_SPEAKERS = 8;
const MINIMUM_AMBIENT_HOURS = 30;
const MINIMUM_GESTURE_PARTICIPANTS = 24;
const MINIMUM_GESTURE_REPETITIONS = 3;
const MINIMUM_NEUTRAL_MINUTES_PER_PARTICIPANT = 10;

/**
 * Build the one provider-neutral report consumed by eval-quality-gate.mjs.
 *
 * PR mode is deliberately config-only: it makes no claim that protected media
 * or live-provider evidence exists. Release mode reads every fixed artifact,
 * promotes only explicit measurements, and records all missing evidence.
 */
export async function aggregateQualityArtifacts({
  artifactRoot,
  qualityGateConfig,
  mode = "release",
  now = () => new Date(),
} = {}) {
  if (!["pr", "release"].includes(mode)) {
    throw new TypeError(`mode must be "pr" or "release"; received ${mode}`);
  }
  if (!isRecord(qualityGateConfig?.releasePolicy)) {
    throw new TypeError("qualityGateConfig.releasePolicy is required");
  }

  const generatedAt = normalizeDate(now());
  if (mode === "pr") {
    return {
      schemaVersion: QUALITY_REPORT_SCHEMA_VERSION,
      generatedAt,
      evaluationMode: "pr",
      status: "config_only",
      metrics: {},
      evidence: {
        assertion: "config_only",
        availability: "not_asserted",
        protectedMediaAvailability: "not_asserted",
        participantCoverage: "not_asserted",
        observedHours: "not_asserted",
        sources: {},
        issues: [],
      },
      diagnostics: {
        providerInfrastructureFailures: 0,
        providerInfrastructureFailureRate: null,
      },
    };
  }

  if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") {
    throw new TypeError("artifactRoot is required in release mode");
  }

  const absoluteRoot = resolve(artifactRoot);
  const loaded = await loadSources(absoluteRoot);
  const issues = [];
  const sources = {};
  const usable = {};
  let infrastructureFailures = 0;
  let providerAttempts = 0;

  for (const [sourceId, definition] of Object.entries(SOURCE_DEFINITIONS)) {
    const source = loaded[sourceId];
    if (source.status === "missing") {
      issues.push(
        issue(
          "missing_artifact",
          sourceId,
          definition.relativePath,
          `Required release artifact is missing: ${definition.relativePath}`,
        ),
      );
      sources[sourceId] = {
        availability: "missing",
        relativePath: definition.relativePath,
        expectedSchemaVersion: definition.schemaVersion,
      };
      continue;
    }
    if (source.status === "invalid_json") {
      issues.push(
        issue(
          "invalid_artifact_json",
          sourceId,
          definition.relativePath,
          `Could not parse ${definition.relativePath}: ${source.message}`,
        ),
      );
      sources[sourceId] = {
        availability: "invalid",
        relativePath: definition.relativePath,
        expectedSchemaVersion: definition.schemaVersion,
      };
      continue;
    }

    const report = source.report;
    if (!isRecord(report) || report.schemaVersion !== definition.schemaVersion) {
      issues.push(
        issue(
          "artifact_schema_mismatch",
          sourceId,
          "schemaVersion",
          `${definition.relativePath} must use ${definition.schemaVersion}`,
        ),
      );
      sources[sourceId] = {
        availability: "invalid",
        relativePath: definition.relativePath,
        expectedSchemaVersion: definition.schemaVersion,
        observedSchemaVersion:
          isRecord(report) && typeof report.schemaVersion === "string"
            ? report.schemaVersion
            : null,
      };
      continue;
    }

    const provider = providerEvidence(report);
    infrastructureFailures += provider.failures;
    providerAttempts += provider.attempts;
    if (provider.inconclusive) {
      issues.push(
        issue(
          "provider_run_inconclusive",
          sourceId,
          "summary.infrastructureRate",
          `${definition.relativePath} is inconclusive because provider infrastructure failures exceed its policy`,
        ),
      );
    }
    sources[sourceId] = {
      availability: provider.inconclusive ? "inconclusive" : "available",
      relativePath: definition.relativePath,
      schemaVersion: report.schemaVersion,
      datasetHash: sourceDatasetHash(report),
      caseCount: sourceCaseCount(report),
      providerInfrastructureFailures: provider.failures,
      providerAttempts: provider.attempts,
    };
    validateSourceReleaseEvidence(sourceId, report, issues);
    usable[sourceId] = report;
  }

  const metrics = {};
  const diagnostics = {
    providerInfrastructureFailures: infrastructureFailures,
    providerInfrastructureFailureRate:
      providerAttempts > 0
        ? infrastructureFailures / providerAttempts
        : null,
    confusionMatrices: Object.fromEntries(
      Object.entries(usable)
        .filter(([, report]) => isRecord(report?.confusionMatrices))
        .map(([sourceId, report]) => [
          sourceId,
          report.confusionMatrices,
        ]),
    ),
  };

  aggregateInteractionMetrics(usable.interaction, metrics, issues);
  aggregateSemanticMetrics(
    {
      contract: usable.semanticContract,
      metamorphic: usable.semanticMetamorphic,
      ambient: usable.semanticAmbient,
      audio: usable.audio,
    },
    metrics,
    diagnostics,
    issues,
  );
  aggregateAudioMetrics(usable.audio, metrics, diagnostics, issues);
  aggregateGestureMetrics(usable.gesture, metrics, diagnostics, issues);

  const mediaEvidence = aggregateMediaEvidence(
    usable.audio,
    usable.gesture,
    metrics,
    issues,
  );
  validateRequiredMetrics(metrics, qualityGateConfig.releasePolicy, issues);

  const providerInconclusive =
    Object.values(sources).some(
      ({ availability }) => availability === "inconclusive",
    ) ||
    (providerAttempts > 0 &&
      infrastructureFailures / providerAttempts > 0.05);
  const status = providerInconclusive
    ? "inconclusive"
    : issues.length > 0
      ? "incomplete"
      : "complete";

  return {
    schemaVersion: QUALITY_REPORT_SCHEMA_VERSION,
    generatedAt,
    evaluationMode: "release",
    status,
    metrics,
    evidence: {
      assertion: "release_evidence",
      availability: status === "complete" ? "complete" : "incomplete",
      protectedMediaAvailability:
        mediaEvidence.audio.complete && mediaEvidence.gesture.complete
          ? "complete"
          : "incomplete",
      participantCoverage:
        mediaEvidence.audio.participantsComplete &&
        mediaEvidence.gesture.participantsComplete
          ? "complete"
          : "incomplete",
      observedHours: mediaEvidence.audio.hoursComplete
        ? "complete"
        : "incomplete",
      sources,
      media: mediaEvidence,
      issues: uniqueIssues(issues),
    },
    diagnostics,
  };
}

async function loadSources(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_DEFINITIONS).map(
        async ([sourceId, definition]) => {
          const path = resolve(root, definition.relativePath);
          try {
            return [
              sourceId,
              {
                status: "loaded",
                report: JSON.parse(await readFile(path, "utf8")),
              },
            ];
          } catch (error) {
            if (error?.code === "ENOENT") {
              return [sourceId, { status: "missing" }];
            }
            return [
              sourceId,
              {
                status: "invalid_json",
                message: error instanceof Error ? error.message : String(error),
              },
            ];
          }
        },
      ),
    ),
  );
}

function aggregateInteractionMetrics(report, metrics, issues) {
  if (!report) return;
  const results = Array.isArray(report.results) ? report.results : [];
  const evidence = interactionReleaseEvidence(results, issues);

  setObservedMetric(
    metrics,
    "contract.passRate",
    resultPassRate(evidence.contract),
    issues,
    "interaction",
    "results[production-route+contract:exact-once]",
  );
  setObservedMetric(
    metrics,
    "safety.passRate",
    resultPassRate(evidence.safety),
    issues,
    "interaction",
    "results[production-route+contract:forbidden-mutations]",
  );
  setObservedMetric(
    metrics,
    "atomicity.passRate",
    resultPassRate(evidence.atomicity),
    issues,
    "interaction",
    "results[production-route+atomic_transaction]",
  );
  setObservedMetric(
    metrics,
    "undo.passRate",
    resultPassRate(evidence.undo),
    issues,
    "interaction",
    "results[production-route+contract:undo-round-trip]",
  );

  const deterministicEndToAction = firstFinite(
    report.metrics?.deterministicEndToActionP95Ms,
    report.summary?.deterministicEndToActionP95Ms,
  );
  if (deterministicEndToAction !== null) {
    setPath(
      metrics,
      "latency.deterministicEndToActionP95Ms",
      deterministicEndToAction,
    );
  }
}

function interactionReleaseEvidence(results, issues) {
  const releaseClaims = results.filter(
    (result) => result?.evidenceProvenance?.releaseEligible === true,
  );
  for (const result of releaseClaims) {
    if (!isObservedProductionRouteResult(result)) {
      issues.push(
        issue(
          "invalid_interaction_evidence_provenance",
          "interaction",
          `results[${result.caseId ?? "unknown"}].evidenceProvenance`,
          `Interaction ${result.caseId ?? "unknown"} claims release eligibility without observed production route and outcome evidence`,
        ),
      );
    }
  }

  const observed = results.filter(isObservedProductionRouteResult);
  const categories = {
    contract: observed.filter(
      (result) =>
        result.capabilities?.includes("contract:exact-once") &&
        hasProductionComponents(result, [
          "VoiceCommandRouter",
          "commitCommandTurn",
        ]),
    ),
    safety: observed.filter(
      (result) =>
        result.capabilities?.includes("contract:forbidden-mutations") &&
        hasProductionComponents(result, ["VoiceCommandRouter"]),
    ),
    atomicity: observed.filter(
      (result) =>
        result.observed?.processingPath?.includes("atomic_transaction") &&
        hasProductionComponents(result, ["commitCommandTurn"]),
    ),
    undo: observed.filter(
      (result) =>
        result.capabilities?.includes("contract:undo-round-trip") &&
        hasProductionComponents(result, ["applyDiagramUndo"]),
    ),
  };

  for (const [category, categoryResults] of Object.entries(categories)) {
    if (categoryResults.length === 0) {
      issues.push(
        issue(
          "missing_production_route_evidence",
          "interaction",
          `results[${category}]`,
          `Release interaction evidence has no observed production-route case for ${category}`,
        ),
      );
    }
  }
  return categories;
}

function isObservedProductionRouteResult(result) {
  const provenance = result?.evidenceProvenance;
  return (
    provenance?.class === "production-route" &&
    provenance.releaseEligible === true &&
    provenance.timedInput === true &&
    Number.isInteger(provenance.timedInputCount) &&
    provenance.timedInputCount > 0 &&
    provenance.routeObservation === "production" &&
    provenance.outcomeObservation === "production" &&
    isRecord(result.observed?.route) &&
    typeof result.observed?.outcome === "string" &&
    Array.isArray(result.observed?.processingPath)
  );
}

function hasProductionComponents(result, requiredComponents) {
  const components = new Set(result?.evidenceProvenance?.components ?? []);
  return requiredComponents.every((component) => components.has(component));
}

function aggregateSemanticMetrics(
  { contract, metamorphic, ambient, audio },
  metrics,
  diagnostics,
  issues,
) {
  if (contract) {
    const interactionContract = readPath(metrics, "contract.passRate");
    const semanticContract = fractionFromSummary(contract.summary);
    if (semanticContract === null) {
      issues.push(
        issue(
          "missing_source_measurement",
          "semanticContract",
          "summary.overallAccuracy",
          "Semantic contract report has no observed pass rate",
        ),
      );
      deletePath(metrics, "contract.passRate");
    } else if (interactionContract !== undefined) {
      setPath(
        metrics,
        "contract.passRate",
        Math.min(interactionContract, semanticContract),
      );
    }
  }

  if (metamorphic) {
    setObservedMetric(
      metrics,
      "semantic.coreAccuracy",
      finiteFraction(metamorphic.summary?.coreAccuracy),
      issues,
      "semanticMetamorphic",
      "summary.coreAccuracy",
    );
    setObservedMetric(
      metrics,
      "semantic.overallAccuracy",
      finiteFraction(metamorphic.summary?.overallAccuracy),
      issues,
      "semanticMetamorphic",
      "summary.overallAccuracy",
    );
    const explicitEndToAction = firstFinite(
      metamorphic.metrics?.semanticEndToActionP95Ms,
      metamorphic.summary?.semanticEndToActionP95Ms,
    );
    if (explicitEndToAction !== null) {
      setPath(
        metrics,
        "latency.semanticEndToActionP95Ms",
        explicitEndToAction,
      );
    }
    const plannerProxy = firstFinite(
      metamorphic.summary?.semanticLatencyP95Ms,
      metamorphic.summary?.p95LatencyMs,
    );
    if (plannerProxy !== null) {
      diagnostics.semanticPlannerLatencyP95Ms = plannerProxy;
    }
    const cost = firstFinite(
      metamorphic.summary?.usage?.costPerSuccessfulTurnUsd,
      metamorphic.summary?.usage?.costPerSuccessUsd,
      metamorphic.metrics?.costPerSuccessUsd,
    );
    if (cost !== null) {
      setPath(metrics, "cost.costPerSuccessUsd", cost);
    }
  }

  const semanticSlices = new Map();
  collectSemanticSlices(semanticSlices, contract);
  collectSemanticSlices(semanticSlices, metamorphic);
  if (ambient) {
    const ambientAccuracy = finiteFraction(ambient.summary?.overallAccuracy);
    if (ambientAccuracy !== null) {
      mergeSlice(semanticSlices, "non_board_speech", {
        accuracy: ambientAccuracy,
        critical: true,
        count: finiteInteger(ambient.summary?.qualityAttempts),
      });
      const currentSafety = readPath(metrics, "safety.passRate");
      if (typeof currentSafety === "number") {
        setPath(
          metrics,
          "safety.passRate",
          Math.min(currentSafety, ambientAccuracy),
        );
      }
    }
    const ambientActionCount = sumReturnedActions(ambient.results);
    if (ambientActionCount !== null) {
      setPath(metrics, "ambient.actionCount", ambientActionCount);
    }
  }

  const audioIndianSlice = explicitSlice(
    audio?.aggregate?.slices,
    "indian_english",
    "accuracy",
  );
  if (audioIndianSlice) {
    mergeSlice(semanticSlices, "indian_english", {
      ...audioIndianSlice,
      critical: true,
    });
  }
  if (semanticSlices.size > 0) {
    setPath(metrics, "semantic.slices", Object.fromEntries(semanticSlices));
  }
}

function aggregateAudioMetrics(report, metrics, diagnostics, issues) {
  if (!report) return;
  setObservedMetric(
    metrics,
    "stt.criticalTokenRecall",
    finiteFraction(report.aggregate?.criticalTokenRecall),
    issues,
    "audio",
    "aggregate.criticalTokenRecall",
  );
  const audioSafety = finiteFraction(report.aggregate?.safetyActionPrecision);
  if (audioSafety !== null) {
    const current = readPath(metrics, "safety.passRate");
    if (typeof current === "number") {
      setPath(metrics, "safety.passRate", Math.min(current, audioSafety));
    }
  }
  const hardFalseActions = finiteInteger(report.aggregate?.hardFalseActions);
  const semanticAmbientActions = readPath(metrics, "ambient.actionCount");
  if (
    hardFalseActions !== null &&
    typeof semanticAmbientActions === "number"
  ) {
    setPath(
      metrics,
      "ambient.actionCount",
      semanticAmbientActions + hardFalseActions,
    );
  }
  const deterministicEndToAction = firstFinite(
    report.aggregate?.deterministicEndToActionP95Ms,
    report.metrics?.deterministicEndToActionP95Ms,
  );
  if (deterministicEndToAction !== null) {
    setPath(
      metrics,
      "latency.deterministicEndToActionP95Ms",
      deterministicEndToAction,
    );
  }
  const semanticEndToAction = firstFinite(
    report.aggregate?.semanticEndToActionP95Ms,
    report.metrics?.semanticEndToActionP95Ms,
  );
  if (semanticEndToAction !== null) {
    const existingSemanticEndToAction = firstFinite(
      readPath(metrics, "latency.semanticEndToActionP95Ms"),
    );
    setPath(
      metrics,
      "latency.semanticEndToActionP95Ms",
      existingSemanticEndToAction === null
        ? semanticEndToAction
        : Math.max(existingSemanticEndToAction, semanticEndToAction),
    );
    diagnostics.audioSemanticEndToActionP95Ms = semanticEndToAction;
  }
  const durationProxy = firstFinite(report.aggregate?.durationP95Ms);
  if (durationProxy !== null) {
    diagnostics.audioScenarioDurationP95Ms = durationProxy;
  }
}

function aggregateGestureMetrics(report, metrics, diagnostics, issues) {
  if (!report) return;
  for (const [sourceField, targetField] of [
    ["precision", "gesture.precision"],
    ["recall", "gesture.recall"],
    ["duplicateRate", "gesture.duplicateRate"],
    [
      "criticalFalseTriggerCount",
      "gesture.criticalFalseTriggerCount",
    ],
  ]) {
    setObservedMetric(
      metrics,
      targetField,
      sourceField.endsWith("Count")
        ? finiteInteger(report.metrics?.[sourceField])
        : finiteFraction(report.metrics?.[sourceField]),
      issues,
      "gesture",
      `metrics.${sourceField}`,
    );
  }

  const slices = {};
  for (const [sliceId, slice] of Object.entries(
    isRecord(report.metrics?.slices) ? report.metrics.slices : {},
  )) {
    const score = finiteFraction(slice?.score);
    if (safeSliceId(sliceId) && score !== null) {
      slices[sliceId] = {
        score,
        critical: slice?.critical === true,
        ...(finiteInteger(slice?.count) === null
          ? {}
          : { count: finiteInteger(slice.count) }),
      };
    }
  }
  if (Object.keys(slices).length > 0) {
    setPath(metrics, "gesture.slices", slices);
  }

  for (const field of [
    "acquireLatencyP95Ms",
    "releaseLatencyP95Ms",
    "frameProcessingP95Ms",
  ]) {
    const value = firstFinite(report.metrics?.[field]);
    if (value !== null) {
      setPath(metrics, `gesture.${field}`, value);
      diagnostics[`gesture${capitalize(field)}`] = value;
    }
  }
  if ((finiteInteger(report.summary?.unevaluatedAssets) ?? 0) > 0) {
    issues.push(
      issue(
        "unevaluated_gesture_assets",
        "gesture",
        "summary.unevaluatedAssets",
        "Release evidence contains gesture assets that were not evaluated",
      ),
    );
  }
  const declaredBrowserAssets = finiteInteger(
    report.summary?.declaredBrowserAssets,
  );
  const browserEvaluatedAssets = finiteInteger(
    report.summary?.browserEvaluatedAssets,
  );
  const delegatedBrowserAssets = finiteInteger(
    report.summary?.delegatedBrowserAssets,
  );
  if (
    declaredBrowserAssets === null ||
    browserEvaluatedAssets === null ||
    delegatedBrowserAssets === null
  ) {
    issues.push(
      issue(
        "missing_browser_gesture_evidence_summary",
        "gesture",
        "summary.declaredBrowserAssets",
        "Gesture release evidence must report declared, evaluated, and delegated browser-video asset counts",
      ),
    );
  } else if (
    delegatedBrowserAssets > 0 ||
    browserEvaluatedAssets !== declaredBrowserAssets ||
    (declaredBrowserAssets > 0 &&
      report.browserEvidence?.runBound !== true)
  ) {
    issues.push(
      issue(
        "incomplete_browser_gesture_evidence",
        "gesture",
        "summary.browserEvaluatedAssets",
        `Only ${browserEvaluatedAssets}/${declaredBrowserAssets} declared browser-video assets have accepted run-bound evidence; ${delegatedBrowserAssets} remain delegated`,
      ),
    );
  }
  if ((finiteInteger(report.summary?.failedAssets) ?? 0) > 0) {
    issues.push(
      issue(
        "failed_gesture_assets",
        "gesture",
        "summary.failedAssets",
        "Release evidence contains failed gesture assets",
      ),
    );
  }
  if ((finiteInteger(report.summary?.evaluatedAssets) ?? 0) === 0) {
    issues.push(
      issue(
        "no_evaluated_gesture_assets",
        "gesture",
        "summary.evaluatedAssets",
        "Release evidence contains no evaluated gesture assets",
      ),
    );
  }
}

function aggregateMediaEvidence(audio, gesture, metrics, issues) {
  const audioCoverage = isRecord(audio?.coverage)
    ? audio.coverage
    : isRecord(audio?.evidence)
      ? audio.evidence
      : {};
  const speakerCount = firstInteger(
    audioCoverage.speakerCount,
    audioCoverage.participantCount,
    audio?.aggregate?.speakerCount,
  );
  const indianEnglishSpeakerCount = firstInteger(
    audioCoverage.indianEnglishSpeakerCount,
    audio?.aggregate?.indianEnglishSpeakerCount,
  );
  const ambientObservedHours = firstFinite(
    audioCoverage.ambientObservedHours,
    audioCoverage.observedHours,
    audio?.aggregate?.ambientObservedHours,
  );

  requireCoverage(
    issues,
    "audio",
    "speakerCount",
    speakerCount,
    MINIMUM_AUDIO_SPEAKERS,
  );
  requireCoverage(
    issues,
    "audio",
    "indianEnglishSpeakerCount",
    indianEnglishSpeakerCount,
    MINIMUM_INDIAN_ENGLISH_SPEAKERS,
  );
  requireCoverage(
    issues,
    "audio",
    "ambientObservedHours",
    ambientObservedHours,
    MINIMUM_AMBIENT_HOURS,
  );

  const gestureCoverage = isRecord(gesture?.coverage)
    ? gesture.coverage
    : isRecord(gesture?.evidence)
      ? gesture.evidence
      : {};
  const participantCount = firstInteger(
    gestureCoverage.participantCount,
    gesture?.summary?.participantCount,
  );
  const minimumValidRepetitions = firstInteger(
    gestureCoverage.minimumValidRepetitionsPerGesturePerCoreCondition,
    gestureCoverage.validRepetitionsPerGesturePerCoreCondition,
  );
  const neutralMinutesPerParticipant = firstFinite(
    gestureCoverage.neutralMinutesPerParticipantMinimum,
    gestureCoverage.neutralMinutesPerParticipant,
  );

  requireCoverage(
    issues,
    "gesture",
    "participantCount",
    participantCount,
    MINIMUM_GESTURE_PARTICIPANTS,
  );
  requireCoverage(
    issues,
    "gesture",
    "minimumValidRepetitionsPerGesturePerCoreCondition",
    minimumValidRepetitions,
    MINIMUM_GESTURE_REPETITIONS,
  );
  requireCoverage(
    issues,
    "gesture",
    "neutralMinutesPerParticipantMinimum",
    neutralMinutesPerParticipant,
    MINIMUM_NEUTRAL_MINUTES_PER_PARTICIPANT,
  );

  if (ambientObservedHours !== null) {
    setPath(metrics, "ambient.observedHours", ambientObservedHours);
  }

  return {
    audio: {
      complete:
        speakerCount >= MINIMUM_AUDIO_SPEAKERS &&
        indianEnglishSpeakerCount >= MINIMUM_INDIAN_ENGLISH_SPEAKERS &&
        ambientObservedHours >= MINIMUM_AMBIENT_HOURS,
      participantsComplete:
        speakerCount >= MINIMUM_AUDIO_SPEAKERS &&
        indianEnglishSpeakerCount >= MINIMUM_INDIAN_ENGLISH_SPEAKERS,
      hoursComplete: ambientObservedHours >= MINIMUM_AMBIENT_HOURS,
      ...(speakerCount === null ? {} : { speakerCount }),
      ...(indianEnglishSpeakerCount === null
        ? {}
        : { indianEnglishSpeakerCount }),
      ...(ambientObservedHours === null
        ? {}
        : { ambientObservedHours }),
    },
    gesture: {
      complete:
        participantCount >= MINIMUM_GESTURE_PARTICIPANTS &&
        minimumValidRepetitions >= MINIMUM_GESTURE_REPETITIONS &&
        neutralMinutesPerParticipant >=
          MINIMUM_NEUTRAL_MINUTES_PER_PARTICIPANT,
      participantsComplete:
        participantCount >= MINIMUM_GESTURE_PARTICIPANTS,
      ...(participantCount === null ? {} : { participantCount }),
      ...(minimumValidRepetitions === null
        ? {}
        : {
            minimumValidRepetitionsPerGesturePerCoreCondition:
              minimumValidRepetitions,
          }),
      ...(neutralMinutesPerParticipant === null
        ? {}
        : {
            neutralMinutesPerParticipantMinimum:
              neutralMinutesPerParticipant,
          }),
    },
  };
}

function validateRequiredMetrics(metrics, releasePolicy, issues) {
  for (const path of releasePolicy.requiredMetrics ?? []) {
    if (readPath(metrics, path) === undefined) {
      issues.push(
        issue(
          "missing_required_metric",
          "aggregate",
          path,
          `No source artifact supplied required metric ${path}`,
        ),
      );
    }
  }
  for (const gate of releasePolicy.sliceGates ?? []) {
    const slices = readPath(metrics, gate.metric);
    for (const sliceId of gate.requiredSliceIds ?? []) {
      if (!isRecord(slices?.[sliceId])) {
        issues.push(
          issue(
            "missing_required_slice",
            "aggregate",
            `${gate.metric}.${sliceId}`,
            `No source artifact supplied required slice ${gate.metric}.${sliceId}`,
          ),
        );
      }
    }
  }
}

function collectSemanticSlices(target, report) {
  if (!Array.isArray(report?.summary?.slices)) return;
  for (const slice of report.summary.slices) {
    const id = normalizeSemanticSliceId(slice?.name);
    const accuracy = finiteFraction(slice?.accuracy);
    if (!id || accuracy === null) continue;
    mergeSlice(target, id, {
      accuracy,
      critical: slice?.critical === true,
      count: finiteInteger(slice?.total),
    });
  }
}

function normalizeSemanticSliceId(name) {
  if (typeof name !== "string" || name.length === 0) return null;
  const aliases = new Map([
    ["status:clarification", "clarification"],
    ["safety:ambient", "non_board_speech"],
    ["ambient", "non_board_speech"],
    ["non-board-speech", "non_board_speech"],
    ["compound-commands", "compound_commands"],
    ["compound_commands", "compound_commands"],
    ["accent:indian-english", "indian_english"],
    ["accent:indian_english", "indian_english"],
    ["indian-english", "indian_english"],
  ]);
  if (aliases.has(name)) return aliases.get(name);
  const normalized = name
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "");
  return safeSliceId(normalized) ? normalized : null;
}

function mergeSlice(target, id, incoming) {
  const current = target.get(id);
  const next = {
    accuracy:
      current === undefined
        ? incoming.accuracy
        : Math.min(current.accuracy, incoming.accuracy),
    critical: current?.critical === true || incoming.critical === true,
  };
  const counts = [current?.count, incoming.count].filter(Number.isInteger);
  if (counts.length > 0) next.count = counts.reduce((sum, value) => sum + value, 0);
  target.set(id, next);
}

function explicitSlice(collection, id, scoreField) {
  if (!isRecord(collection) || !isRecord(collection[id])) return null;
  const accuracy = finiteFraction(collection[id][scoreField]);
  if (accuracy === null) return null;
  return {
    accuracy,
    critical: collection[id].critical === true,
    count: finiteInteger(collection[id].count),
  };
}

function fractionFromSummary(summary) {
  const direct = firstFraction(summary?.passRate, summary?.overallAccuracy);
  if (direct !== null) return direct;
  const passed = finiteInteger(summary?.passed);
  const total = firstInteger(summary?.attempts, summary?.total);
  if (passed === null || total === null || total <= 0 || passed > total) {
    return null;
  }
  return passed / total;
}

function resultPassRate(results, predicate = () => true) {
  const selected = results.filter(
    (result) => isRecord(result) && predicate(result),
  );
  if (selected.length === 0) return null;
  return (
    selected.filter((result) => result.status === "passed").length /
    selected.length
  );
}

function sumReturnedActions(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let count = 0;
  for (const result of results) {
    if (!Array.isArray(result?.plan?.actions)) return null;
    count += result.plan.actions.length;
  }
  return count;
}

function providerEvidence(report) {
  const failures = firstInteger(
    report.summary?.infrastructureFailures,
    report.aggregate?.providerFailures,
  ) ?? 0;
  const attempts = firstInteger(
    report.summary?.attempts,
    report.summary?.total,
  ) ?? 0;
  const rate = firstFraction(
    report.summary?.infrastructureRate,
    report.aggregate?.providerFailureRate,
  );
  return {
    failures,
    attempts,
    inconclusive:
      report.inconclusive === true ||
      report.summary?.inconclusive === true ||
      (rate !== null && rate > 0.05),
  };
}

function validateSourceReleaseEvidence(sourceId, report, issues) {
  if (sourceId.startsWith("semantic")) {
    const attempts = finiteInteger(report.corpus?.attempts);
    if (attempts === null || attempts < 5) {
      issues.push(
        issue(
          "insufficient_release_repetitions",
          sourceId,
          "corpus.attempts",
          `${sourceId} must report at least five attempts per case for release evidence`,
        ),
      );
    }
    if (
      !Array.isArray(report.versions?.providers) ||
      report.versions.providers.length === 0 ||
      !Array.isArray(report.versions?.models) ||
      report.versions.models.length === 0
    ) {
      issues.push(
        issue(
          "missing_live_provider_version",
          sourceId,
          "versions",
          `${sourceId} must identify the live provider and model used for release evidence`,
        ),
      );
    }
    if (
      Array.isArray(report.summary?.failures) &&
      report.summary.failures.length > 0
    ) {
      issues.push(
        issue(
          "source_quality_gate_failed",
          sourceId,
          "summary.failures",
          `${sourceId} reports one or more semantic quality-gate failures`,
        ),
      );
    }
    return;
  }

  if (sourceId === "audio") {
    if (report.metadata?.datasetSplit !== "holdout") {
      issues.push(
        issue(
          "non_holdout_release_evidence",
          sourceId,
          "metadata.datasetSplit",
          "Audio release evidence must be evaluated on the sealed holdout split",
        ),
      );
    }
    if (
      !Array.isArray(report.metadata?.adapters) ||
      !report.metadata.adapters.includes("live-websocket")
    ) {
      issues.push(
        issue(
          "missing_live_audio_evidence",
          sourceId,
          "metadata.adapters",
          "Audio release evidence must include the live-websocket adapter",
        ),
      );
    }
    if ((finiteInteger(report.summary?.skipped) ?? 0) > 0) {
      issues.push(
        issue(
          "skipped_audio_assets",
          sourceId,
          "summary.skipped",
          "Audio release evidence cannot contain skipped assets",
        ),
      );
    }
    if (
      Array.isArray(report.gateFailures) &&
      report.gateFailures.length > 0
    ) {
      issues.push(
        issue(
          "source_quality_gate_failed",
          sourceId,
          "gateFailures",
          "Audio report contains one or more quality-gate failures",
        ),
      );
    }
    return;
  }

  if (sourceId === "gesture") {
    if (report.datasetSplit !== "holdout") {
      issues.push(
        issue(
          "non_holdout_release_evidence",
          sourceId,
          "datasetSplit",
          "Gesture release evidence must be evaluated on the sealed holdout split",
        ),
      );
    }
    if (report.mode !== "release") {
      issues.push(
        issue(
          "non_release_gesture_replay",
          sourceId,
          "mode",
          "Gesture evidence must be produced with the release replay mode",
        ),
      );
    }
    if (
      Array.isArray(report.gateFailures) &&
      report.gateFailures.length > 0
    ) {
      issues.push(
        issue(
          "source_quality_gate_failed",
          sourceId,
          "gateFailures",
          "Gesture report contains one or more quality-gate failures",
        ),
      );
    }
  }
}

function sourceDatasetHash(report) {
  for (const candidate of [
    report.datasetHash,
    report.metadata?.datasetHash,
    report.corpus?.datasetHash,
  ]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function sourceCaseCount(report) {
  return firstInteger(
    report.corpus?.caseCount,
    report.summary?.total,
    report.summary?.totalAssets,
  );
}

function requireCoverage(issues, source, field, observed, minimum) {
  if (observed === null) {
    issues.push(
      issue(
        "missing_release_coverage",
        source,
        `coverage.${field}`,
        `${source} release evidence does not report ${field}; ${minimum} is required`,
      ),
    );
  } else if (observed < minimum) {
    issues.push(
      issue(
        "insufficient_release_coverage",
        source,
        `coverage.${field}`,
        `${source} ${field} is ${observed}; at least ${minimum} is required`,
      ),
    );
  }
}

function setObservedMetric(
  metrics,
  path,
  value,
  issues,
  source,
  sourcePath,
) {
  if (value === null) {
    issues.push(
      issue(
        "missing_source_measurement",
        source,
        sourcePath,
        `${source} report has no valid observed value for ${path}`,
      ),
    );
    return;
  }
  setPath(metrics, path, value);
}

function setPath(target, path, value) {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function deletePath(target, path) {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(cursor[segment])) return;
    cursor = cursor[segment];
  }
  delete cursor[segments.at(-1)];
}

function readPath(target, path) {
  let cursor = target;
  for (const segment of path.split(".")) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function firstFinite(...values) {
  return values.find(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  ) ?? null;
}

function firstFraction(...values) {
  for (const value of values) {
    const parsed = finiteFraction(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstInteger(...values) {
  for (const value of values) {
    const parsed = finiteInteger(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function finiteFraction(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function finiteInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeSliceId(value) {
  return (
    /^[a-z0-9][a-z0-9_]{0,79}$/u.test(value ?? "") &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}

function issue(code, source, path, message) {
  return { code, source, path, message };
}

function uniqueIssues(issues) {
  const seen = new Set();
  return issues
    .filter((entry) => {
      const key = `${entry.code}\u0000${entry.source}\u0000${entry.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    );
}

function capitalize(value) {
  return `${value.slice(0, 1).toLocaleUpperCase("en-US")}${value.slice(1)}`;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new TypeError("now() must return a valid Date-compatible value");
  }
  return date.toISOString();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
