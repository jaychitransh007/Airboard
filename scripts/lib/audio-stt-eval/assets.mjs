import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { parsePcm16Wav } from "./wav.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPAQUE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CRITICAL_TOKEN_ROLES = new Set([
  "wake_phrase",
  "action",
  "node_type",
  "count",
  "visible_label",
]);

export class AudioAssetManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AudioAssetManifestError";
    this.code = code;
  }
}

export async function loadAudioAssetManifest(
  manifestPath,
  {
    mediaRoot,
    requireAssets = false,
  } = {},
) {
  const absoluteManifestPath = resolve(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  } catch (error) {
    throw assetError(
      "ASSET_MANIFEST_UNREADABLE",
      `Could not read the external audio asset manifest: ${describeError(error)}`,
    );
  }
  const assets = validateManifest(manifest);
  if (requireAssets && assets.length === 0) {
    throw assetError(
      "ASSETS_REQUIRED",
      "External audio assets are required, but the manifest declares none.",
    );
  }
  if (requireAssets && !mediaRoot) {
    throw assetError(
      "ASSET_ROOT_REQUIRED",
      "External audio assets are required, but AIRBOARD_EVAL_MEDIA_ROOT is not set.",
    );
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return {
    schemaVersion: manifest.schemaVersion,
    corpusVersion:
      typeof manifest.corpusVersion === "string"
        ? manifest.corpusVersion
        : null,
    declaredCount: assets.length,
    requireAssets,
    coverageForResults(results) {
      const evaluatedIds = new Set(
        (Array.isArray(results) ? results : [])
          .filter((result) => result?.assessment)
          .map(({ id }) =>
            typeof id === "string" && id.startsWith("asset:")
              ? id.slice("asset:".length)
              : null,
          )
          .filter(Boolean),
      );
      const evaluated = assets.filter((asset) =>
        evaluatedIds.has(asset.id),
      );
      const speakers = new Set(
        evaluated.map(({ participantId }) => participantId).filter(Boolean),
      );
      const indianEnglishSpeakers = new Set(
        evaluated
          .filter(({ accent }) => accent === "en-IN")
          .map(({ participantId }) => participantId)
          .filter(Boolean),
      );
      const ambientObservedHours =
        evaluated
          .filter(({ purpose }) => purpose === "ambient_safety")
          .reduce(
            (sum, asset) => sum + nonNegativeNumber(asset.durationSeconds),
            0,
          ) / 3_600;
      return {
        evaluatedAssetCount: evaluated.length,
        speakerCount: speakers.size,
        indianEnglishSpeakerCount: indianEnglishSpeakers.size,
        ambientObservedHours,
      };
    },
    listEvaluationScenarios() {
      return assets
        .filter((asset) => isRecord(asset.sttEvaluation))
        .map((asset) => externalScenario(asset));
    },
    async load(assetId) {
      const asset = byId.get(assetId);
      if (!asset) {
        throw assetError("ASSET_UNKNOWN", `External audio asset ${assetId} is not declared.`);
      }
      if (!mediaRoot) {
        throw assetError(
          "ASSET_UNAVAILABLE",
          `External audio asset ${assetId} is not mounted.`,
        );
      }
      return loadAsset(asset, resolve(mediaRoot));
    },
  };
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== "1.0") {
    throw assetError("ASSET_MANIFEST_INVALID", "Audio asset manifest schemaVersion must be 1.0.");
  }
  const policy = manifest.storagePolicy;
  if (
    !isRecord(policy) ||
    policy.rawMediaInGit !== false ||
    policy.encryptedAtRest !== true ||
    policy.restrictedAccess !== true ||
    policy.ciArtifactUpload !== false ||
    policy.customerContentAllowed !== false
  ) {
    throw assetError(
      "ASSET_PRIVACY_POLICY_INVALID",
      "Audio assets require restricted encrypted storage, no raw media in Git or CI artifacts, and no customer content.",
    );
  }
  if (!Array.isArray(manifest.assets)) {
    throw assetError("ASSET_MANIFEST_INVALID", "Audio asset manifest must contain an assets array.");
  }

  const seen = new Set();
  for (const asset of manifest.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.id !== "string" ||
      !OPAQUE_ID_PATTERN.test(asset.id)
    ) {
      throw assetError("ASSET_ENTRY_INVALID", "Every external audio asset needs an opaque id.");
    }
    if (seen.has(asset.id)) {
      throw assetError("ASSET_ENTRY_DUPLICATE", `Duplicate external audio asset id: ${asset.id}.`);
    }
    seen.add(asset.id);
    if (
      typeof asset.storageKey !== "string" ||
      !asset.storageKey.trim() ||
      isAbsolute(asset.storageKey) ||
      /[\u0000-\u001f\u007f]/u.test(asset.storageKey)
    ) {
      throw assetError(
        "ASSET_STORAGE_KEY_INVALID",
        `External audio asset ${asset.id} needs a relative storageKey.`,
      );
    }
    const hash = asset.sha256 ?? asset.hash?.value;
    if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
      throw assetError(
        "ASSET_HASH_INVALID",
        `External audio asset ${asset.id} needs a lowercase SHA-256 hash.`,
      );
    }
    const privacyClass = asset.privacyClass ?? asset.privacy?.classification;
    if (typeof privacyClass !== "string" || !privacyClass.trim()) {
      throw assetError(
        "ASSET_PRIVACY_CLASS_INVALID",
        `External audio asset ${asset.id} needs a privacy classification.`,
      );
    }
    const consentStatus = asset.consentStatus ?? asset.consent?.status;
    if (!["granted", "not_applicable"].includes(consentStatus)) {
      throw assetError(
        "ASSET_CONSENT_INVALID",
        `External audio asset ${asset.id} lacks a valid consent status.`,
      );
    }
    if (asset.sttEvaluation !== undefined) {
      validateExternalEvaluation(
        asset.id,
        asset.sttEvaluation,
        asset.surface,
      );
    }
  }
  return manifest.assets;
}

function validateExternalEvaluation(assetId, evaluation, surface) {
  if (
    !isRecord(evaluation) ||
    !["wake", "ptt", "scoped"].includes(evaluation.channel) ||
    !["deterministic", "semantic", "no_route"].includes(
      evaluation.processingPath,
    ) ||
    !isRecord(evaluation.oracle)
  ) {
    throw assetError(
      "ASSET_EVALUATION_INVALID",
      `External audio asset ${assetId} has an invalid sttEvaluation contract.`,
    );
  }
  const meetSurface = isMeetSurface(surface);
  const expectedTransport = meetSurface ? "meet-bridge" : "direct";
  if (evaluation.transport !== expectedTransport) {
    throw assetError(
      "ASSET_EVALUATION_INVALID",
      `External audio asset ${assetId} on ${meetSurface ? "a Meet" : "a non-Meet"} surface must declare sttEvaluation.transport=${expectedTransport}.`,
    );
  }
  if (
    evaluation.evaluationClass !== undefined &&
    !["core", "narrative", "safety"].includes(evaluation.evaluationClass)
  ) {
    throw assetError(
      "ASSET_EVALUATION_INVALID",
      `External audio asset ${assetId} has an invalid evaluationClass.`,
    );
  }
  if (
    evaluation.processingPath === "semantic" &&
    !["resolved", "clarification", "unsupported", "already_satisfied"].includes(
      evaluation.oracle.expectedSemanticStatus,
    )
  ) {
    throw assetError(
      "ASSET_EVALUATION_INVALID",
      `External audio asset ${assetId} semantic evaluation needs expectedSemanticStatus.`,
    );
  }
  const criticalTokens = Array.isArray(evaluation.oracle.criticalTokens)
    ? evaluation.oracle.criticalTokens
    : [];
  const roles = evaluation.oracle.criticalTokenRoles;
  if (roles !== undefined) {
    if (!isRecord(roles)) {
      throw assetError(
        "ASSET_EVALUATION_INVALID",
        `External audio asset ${assetId} criticalTokenRoles must be an object.`,
      );
    }
    for (const [role, tokens] of Object.entries(roles)) {
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
        throw assetError(
          "ASSET_EVALUATION_INVALID",
          `External audio asset ${assetId} has invalid criticalTokenRoles.${role}.`,
        );
      }
    }
  }
}

async function loadAsset(asset, mediaRoot) {
  let root;
  let path;
  try {
    root = await realpath(mediaRoot);
    const unresolvedPath = resolve(root, asset.storageKey);
    assertInsideRoot(root, unresolvedPath, asset.id);
    path = await realpath(unresolvedPath);
    assertInsideRoot(root, path, asset.id);
  } catch (caught) {
    if (caught instanceof AudioAssetManifestError) {
      throw caught;
    }
    throw assetError(
      "ASSET_UNAVAILABLE",
      `External audio asset ${asset.id} is unavailable from the restricted mount.`,
    );
  }

  let content;
  try {
    content = await readFile(path);
  } catch {
    throw assetError(
      "ASSET_UNAVAILABLE",
      `External audio asset ${asset.id} could not be read from the restricted mount.`,
    );
  }
  const expectedHash = asset.sha256 ?? asset.hash.value;
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (actualHash !== expectedHash) {
    throw assetError(
      "ASSET_HASH_MISMATCH",
      `External audio asset ${asset.id} failed SHA-256 verification.`,
    );
  }
  return {
    id: asset.id,
    sha256: actualHash,
    privacyClass: asset.privacyClass ?? asset.privacy.classification,
    wav: parsePcm16Wav(content),
  };
}

function externalScenario(asset) {
  const evaluation = asset.sttEvaluation;
  return {
    id: `asset:${asset.id}`,
    adapter:
      evaluation.transport === "meet-bridge"
        ? "meet-bridge-replay"
        : "live-websocket",
    transport: evaluation.transport,
    assetId: asset.id,
    privacyClass: asset.privacyClass ?? asset.privacy.classification,
    ...(typeof evaluation.evaluationClass === "string"
      ? { evaluationClass: evaluation.evaluationClass }
      : {}),
    channel: evaluation.channel,
    processingPath: evaluation.processingPath,
    ...(evaluation.processingPath === "semantic"
      ? { semanticAdapter: "live-api" }
      : {}),
    source: {
      ...(typeof evaluation.model === "string" ? { model: evaluation.model } : {}),
      ...(typeof evaluation.language === "string" ? { language: evaluation.language } : {}),
      ...(Array.isArray(evaluation.keyterms) ? { keyterms: evaluation.keyterms } : {}),
    },
    ...(typeof asset.accent === "string"
      ? { accent: asset.accent }
      : {}),
    ...(typeof asset.participantId === "string"
      ? { participantId: asset.participantId }
      : {}),
    ...(typeof asset.microphone === "string"
      ? { microphone: asset.microphone }
      : {}),
    ...(typeof asset.distance === "string"
      ? { distance: asset.distance }
      : {}),
    ...(Array.isArray(asset.conditions)
      ? { conditions: [...asset.conditions] }
      : {}),
    ...(typeof asset.lengthClass === "string"
      ? { lengthClass: asset.lengthClass }
      : {}),
    ...(typeof asset.surface === "string"
      ? { surface: asset.surface }
      : {}),
    ...(typeof asset.purpose === "string"
      ? { purpose: asset.purpose }
      : {}),
    ...(typeof asset.datasetSplit === "string"
      ? { datasetSplit: asset.datasetSplit }
      : {}),
    ...(isRecord(evaluation.context)
      ? { context: evaluation.context }
      : {}),
    ...(isRecord(evaluation.finalState)
      ? { finalState: evaluation.finalState }
      : {}),
    oracle: evaluation.oracle,
  };
}

function isMeetSurface(surface) {
  return [
    "meet",
    "meet-bridge",
    "meet-main-stage",
    "meet-side-panel",
  ].includes(surface);
}

function assertInsideRoot(root, candidate, assetId) {
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw assetError(
      "ASSET_PATH_ESCAPE",
      `External audio asset ${assetId} escapes AIRBOARD_EVAL_MEDIA_ROOT.`,
    );
  }
}

function assetError(code, message) {
  return new AudioAssetManifestError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
