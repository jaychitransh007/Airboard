import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AudioAssetManifestError } from "./assets.mjs";
import { scoreAudioSttEventsWithSemantic } from "./oracle.mjs";
import { AudioSemanticProviderError } from "./semantic-adapters.mjs";
import {
  diagramSpatialConstraintErrors,
} from "../../../packages/drawing-engine/src/spatialQuality.ts";

const SCENARIO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u;
const SAFE_ANNOTATION_PATTERN = /^[^\u0000-\u001f\u007f]{1,120}$/u;
const CRITICAL_TOKEN_ROLES = new Set([
  "wake_phrase",
  "action",
  "node_type",
  "count",
  "visible_label",
]);

export async function loadAudioSttScenarioCorpus(path) {
  const absolutePath = resolve(path);
  let corpus;
  try {
    corpus = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read audio/STT scenario corpus: ${describeError(error)}`);
  }
  if (
    !isRecord(corpus) ||
    corpus.schemaVersion !== "1.0" ||
    !Array.isArray(corpus.scenarios)
  ) {
    throw new Error("Audio/STT scenario corpus must use schemaVersion 1.0.");
  }
  const seen = new Set();
  for (const scenario of corpus.scenarios) {
    validateScenario(scenario);
    if (seen.has(scenario.id)) {
      throw new Error(`Duplicate audio/STT scenario id: ${scenario.id}.`);
    }
    seen.add(scenario.id);
  }
  return { ...corpus, path: absolutePath };
}

export async function runAudioSttScenarios({
  scenarios,
  adapters,
  semanticAdapters = [],
  assetCatalog,
  requireAssets = false,
  signal,
}) {
  const adapterMap =
    adapters instanceof Map
      ? adapters
      : new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const semanticAdapterMap =
    semanticAdapters instanceof Map
      ? semanticAdapters
      : new Map(
          semanticAdapters.map((adapter) => [adapter.id, adapter]),
        );
  const results = [];
  const seenScenarioIds = new Set();

  for (const scenario of scenarios) {
    validateScenario(scenario);
    if (seenScenarioIds.has(scenario.id)) {
      throw new Error(`Duplicate audio/STT scenario id: ${scenario.id}.`);
    }
    seenScenarioIds.add(scenario.id);
    const adapter = adapterMap.get(scenario.adapter);
    if (!adapter) {
      throw new Error(`No audio/STT adapter is registered for ${scenario.adapter}.`);
    }
    const startedAt = performance.now();
    let asset = null;
    if (adapter.requiresAsset) {
      if (!scenario.assetId || !assetCatalog) {
        const message = `Live scenario ${scenario.id} has no external audio asset.`;
        if (requireAssets) throw new Error(message);
        results.push(skippedResult(scenario, adapter, startedAt, message));
        continue;
      }
      try {
        asset = await assetCatalog.load(scenario.assetId);
      } catch (error) {
        if (
          !requireAssets &&
          error instanceof AudioAssetManifestError &&
          error.code === "ASSET_UNAVAILABLE"
        ) {
          results.push(
            skippedResult(scenario, adapter, startedAt, error.message),
          );
          continue;
        }
        throw error;
      }
    }

    let failureStage = "transcription_provider";
    try {
      const { output, retryCount } = await runAdapterWithRetry(adapter, {
        scenario,
        asset,
        signal,
      });
      failureStage = "provider_output";
      if (!output || !Array.isArray(output.events)) {
        throw new Error(`Adapter ${adapter.id} returned no provider-neutral events.`);
      }
      failureStage = "interpretation";
      const assessment = await scoreAudioSttEventsWithSemantic(
        scenario,
        output.events,
        output.timing,
        semanticAdapterMap,
      );
      results.push({
        id: scenario.id,
        adapter: adapter.id,
        privacyClass: scenario.privacyClass,
        status: assessment.passed ? "passed" : "failed",
        durationMs: performance.now() - startedAt,
        assessment,
        diagnostics: {
          ...sanitizeDiagnostics(output.diagnostics),
          providerRetryCount: retryCount,
        },
      });
    } catch (error) {
      const failure = classifyEvaluationError(error, {
        adapter,
        stage: failureStage,
      });
      results.push({
        id: scenario.id,
        adapter: adapter.id,
        privacyClass: scenario.privacyClass,
        status: "failed",
        failureClass: failure.failureClass,
        failureStage: failure.failureStage,
        durationMs: performance.now() - startedAt,
        assessment: null,
        diagnostics: failure.diagnostics,
        failures: [`${failure.label}: ${describeError(error)}`],
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
  return {
    schemaVersion: "airboard-audio-stt-eval-result.v1",
    results,
    summary,
    passed: summary.failed === 0 && (!requireAssets || summary.skipped === 0),
  };
}

async function runAdapterWithRetry(adapter, argumentsValue) {
  try {
    return {
      output: await adapter.run(argumentsValue),
      retryCount: 0,
    };
  } catch (error) {
    if (
      adapter.retryTransientFailures !== true ||
      !isTransientAdapterError(error)
    ) {
      throw error;
    }
    return {
      output: await adapter.run(argumentsValue),
      retryCount: 1,
    };
  }
}

function isTransientAdapterError(error) {
  const message = describeError(error);
  return /(?:timeout|timed out|connect|socket|closed|reset|unavailable|provider|gateway|aborted)/iu.test(
    message,
  );
}

function classifyEvaluationError(error, { adapter, stage }) {
  const semanticProviderFailure =
    error instanceof AudioSemanticProviderError && error.retryable === true;
  const transcriptionProviderFailure =
    stage === "transcription_provider" &&
    (adapter.id === "live-websocket" || adapter.liveProvider === true) &&
    isTransientAdapterError(error);
  const providerInfrastructure =
    semanticProviderFailure || transcriptionProviderFailure;
  return {
    failureClass: providerInfrastructure
      ? "provider_infrastructure"
      : "quality",
    failureStage:
      error instanceof AudioSemanticProviderError
        ? providerInfrastructure
          ? "semantic_provider"
          : "semantic_output_validation"
        : stage,
    label: providerInfrastructure
      ? "provider infrastructure error"
      : "quality error",
    diagnostics:
      error instanceof AudioSemanticProviderError
        ? {
            providerErrorCode: safeDiagnosticString(error.code),
            retryable: error.retryable === true,
            ...(Number.isInteger(error.status)
              ? { providerStatus: error.status }
              : {}),
          }
        : null,
  };
}

function safeDiagnosticString(value) {
  return typeof value === "string" && SCENARIO_ID_PATTERN.test(value)
    ? value
    : "unknown";
}

function validateScenario(scenario) {
  if (
    !isRecord(scenario) ||
    typeof scenario.id !== "string" ||
    !SCENARIO_ID_PATTERN.test(scenario.id) ||
    typeof scenario.adapter !== "string" ||
    !SCENARIO_ID_PATTERN.test(scenario.adapter) ||
    !["wake", "ptt", "scoped"].includes(scenario.channel) ||
    typeof scenario.privacyClass !== "string" ||
    !SAFE_ANNOTATION_PATTERN.test(scenario.privacyClass) ||
    scenario.privacyClass !== scenario.privacyClass.trim() ||
    !isRecord(scenario.source) ||
    !isRecord(scenario.oracle)
  ) {
    throw new Error("Audio/STT corpus contains a malformed scenario.");
  }
  if (
    scenario.evaluationClass !== undefined &&
    !["core", "narrative", "safety"].includes(scenario.evaluationClass)
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid evaluationClass.`,
    );
  }
  const meetSurface = isMeetSurface(scenario.surface);
  if (
    meetSurface &&
    (scenario.transport !== "meet-bridge" ||
      scenario.adapter !== "meet-bridge-replay")
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} claims a Meet surface without the production Meet bridge replay transport.`,
    );
  }
  if (
    !meetSurface &&
    (scenario.transport === "meet-bridge" ||
      scenario.adapter === "meet-bridge-replay")
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} claims Meet bridge transport on a non-Meet surface.`,
    );
  }
  if (
    scenario.transport !== undefined &&
    !["direct", "meet-bridge"].includes(scenario.transport)
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid transport.`,
    );
  }
  if (
    scenario.processingPath !== undefined &&
    !["deterministic", "semantic", "no_route"].includes(
      scenario.processingPath,
    )
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid processingPath.`,
    );
  }
  if (
    scenario.semanticAdapter !== undefined &&
    (typeof scenario.semanticAdapter !== "string" ||
      !SCENARIO_ID_PATTERN.test(scenario.semanticAdapter))
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid semanticAdapter.`,
    );
  }
  if (
    scenario.semanticAdapter !== undefined &&
    !["resolved", "clarification", "unsupported", "already_satisfied"].includes(
      scenario.oracle.expectedSemanticStatus,
    )
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} with semantic fallback needs expectedSemanticStatus.`,
    );
  }
  if (
    scenario.assetId !== undefined &&
    (typeof scenario.assetId !== "string" || !scenario.assetId.trim())
  ) {
    throw new Error(`Audio/STT scenario ${scenario.id} has an invalid assetId.`);
  }
  if (
    scenario.oracle.criticalTokens !== undefined &&
    (!Array.isArray(scenario.oracle.criticalTokens) ||
      scenario.oracle.criticalTokens.some(
        (token) =>
          typeof token !== "string" ||
          !SAFE_ANNOTATION_PATTERN.test(token) ||
          token !== token.trim(),
      ))
  ) {
    throw new Error(`Audio/STT scenario ${scenario.id} has invalid critical tokens.`);
  }
  if (scenario.oracle.criticalTokenRoles !== undefined) {
    if (!isRecord(scenario.oracle.criticalTokenRoles)) {
      throw new Error(
        `Audio/STT scenario ${scenario.id} has invalid criticalTokenRoles.`,
      );
    }
    const criticalTokens = scenario.oracle.criticalTokens ?? [];
    for (const [role, tokens] of Object.entries(
      scenario.oracle.criticalTokenRoles,
    )) {
      if (
        !CRITICAL_TOKEN_ROLES.has(role) ||
        !Array.isArray(tokens) ||
        tokens.length === 0 ||
        tokens.some(
          (token) =>
            typeof token !== "string" ||
            !criticalTokens.includes(token),
        )
      ) {
        throw new Error(
          `Audio/STT scenario ${scenario.id} has invalid criticalTokenRoles.${role}.`,
        );
      }
    }
  }
  // Expected action names are intentionally not checked against a copied
  // allowlist. The shared oracle compares them with production parser output.
  if (
    scenario.oracle.expectedActions !== undefined &&
    (!Array.isArray(scenario.oracle.expectedActions) ||
      scenario.oracle.expectedActions.some(
        (action) =>
          typeof action !== "string" ||
          !SCENARIO_ID_PATTERN.test(action),
      ))
  ) {
    throw new Error(`Audio/STT scenario ${scenario.id} has invalid expected actions.`);
  }
  if (
    scenario.oracle.expectedFinalCount !== undefined &&
    (!Number.isInteger(scenario.oracle.expectedFinalCount) ||
      scenario.oracle.expectedFinalCount < 0)
  ) {
    throw new Error(`Audio/STT scenario ${scenario.id} has an invalid expectedFinalCount.`);
  }
  if (
    scenario.oracle.maximumRoutedActions !== undefined &&
    (!Number.isInteger(scenario.oracle.maximumRoutedActions) ||
      scenario.oracle.maximumRoutedActions < 0)
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid maximumRoutedActions.`,
    );
  }
  if (
    scenario.oracle.expectedRoutedCommandSha256 !== undefined &&
    (typeof scenario.oracle.expectedRoutedCommandSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(
        scenario.oracle.expectedRoutedCommandSha256,
      ))
  ) {
    throw new Error(
      `Audio/STT scenario ${scenario.id} has an invalid expectedRoutedCommandSha256.`,
    );
  }
  if (
    scenario.oracle.criticalTokens === undefined &&
    scenario.oracle.expectedActions === undefined &&
    scenario.oracle.expectedFinalCount === undefined &&
    scenario.oracle.maximumRoutedActions === undefined
  ) {
    throw new Error(`Audio/STT scenario ${scenario.id} has no scoring oracle.`);
  }
  for (const key of ["minimumCriticalTokenRecall", "minimumActionF1"]) {
    if (
      scenario.oracle[key] !== undefined &&
      (typeof scenario.oracle[key] !== "number" ||
        scenario.oracle[key] < 0 ||
        scenario.oracle[key] > 1)
    ) {
      throw new Error(`Audio/STT scenario ${scenario.id} has an invalid ${key}.`);
    }
  }
  if (scenario.finalState?.spatialConstraints !== undefined) {
    const spatialErrors = diagramSpatialConstraintErrors(
      scenario.finalState.spatialConstraints,
    );
    if (spatialErrors.length > 0) {
      throw new Error(
        `Audio/STT scenario ${scenario.id} has invalid finalState.spatialConstraints: ` +
        spatialErrors.join("; "),
      );
    }
  }
}

function isMeetSurface(surface) {
  return [
    "meet",
    "meet-bridge",
    "meet-main-stage",
    "meet-side-panel",
  ].includes(surface);
}

function skippedResult(scenario, adapter, startedAt, reason) {
  return {
    id: scenario.id,
    adapter: adapter.id,
    privacyClass: scenario.privacyClass,
    status: "skipped",
    durationMs: performance.now() - startedAt,
    assessment: null,
    diagnostics: { reason: "external_asset_unavailable" },
    failures: [reason],
  };
}

function sanitizeDiagnostics(value) {
  if (!isRecord(value)) return null;
  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      /transcript|audio|path|token|secret|content/iu.test(key) ||
      !["string", "number", "boolean"].includes(typeof entry)
    ) {
      continue;
    }
    safe[key] = entry;
  }
  return safe;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
