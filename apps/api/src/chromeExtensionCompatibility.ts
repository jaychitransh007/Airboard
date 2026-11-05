export const CHROME_BRIDGE_MARKER = "airboard-media-bridge";
export const CHROME_BRIDGE_PROTOCOL_VERSION = 1;
export const CHROME_EXTENSION_VERSION = "0.8.0";
export const CHROME_EXTENSION_COMPATIBLE_VERSIONS: readonly string[] = Object.freeze([
  CHROME_EXTENSION_VERSION,
]);

const CHROME_EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MAX_CHROME_EXTENSION_COMPATIBLE_VERSIONS = 8;

export type ChromeExtensionCompatibility = {
  bridge: typeof CHROME_BRIDGE_MARKER;
  protocolVersion: typeof CHROME_BRIDGE_PROTOCOL_VERSION;
  extensionVersion: string;
};

export type ChromeExtensionCompatibilityResult =
  | { ok: true; value: ChromeExtensionCompatibility | null }
  | { ok: false; error: "DEPLOYMENT_VERSION_MISMATCH" };

/**
 * Parses the status handshake without mutating installation state. A wholly
 * absent handshake identifies a pre-0.8 legacy client; partial or mismatched
 * handshakes fail closed before credential rotation.
 */
export function parseChromeExtensionCompatibilityHeaders(
  headers: Record<string, unknown>,
  compatibleVersions: readonly string[] = CHROME_EXTENSION_COMPATIBLE_VERSIONS,
): ChromeExtensionCompatibilityResult {
  const bridge = singleHeader(headers["x-airboard-bridge"]);
  const protocolVersion = singleHeader(headers["x-airboard-bridge-protocol-version"]);
  const extensionVersion = singleHeader(headers["x-airboard-extension-version"]);

  if (bridge === undefined && protocolVersion === undefined && extensionVersion === undefined) {
    return { ok: true, value: null };
  }
  if (
    bridge !== CHROME_BRIDGE_MARKER ||
    protocolVersion !== String(CHROME_BRIDGE_PROTOCOL_VERSION) ||
    !extensionVersion ||
    !compatibleVersions.includes(extensionVersion)
  ) {
    return { ok: false, error: "DEPLOYMENT_VERSION_MISMATCH" };
  }
  return {
    ok: true,
    value: {
      bridge: CHROME_BRIDGE_MARKER,
      protocolVersion: CHROME_BRIDGE_PROTOCOL_VERSION,
      extensionVersion,
    },
  };
}

/**
 * Parses the deliberately finite overlap window used during a Web Store
 * rollout. Missing configuration accepts only the current server version;
 * malformed, empty, or current-version-excluding configuration fails startup.
 */
export function parseChromeExtensionCompatibleVersions(
  source: string | undefined,
  currentVersion = CHROME_EXTENSION_VERSION,
): string[] {
  const configured = source?.trim();
  if (!configured) return [currentVersion];
  const candidates = configured.split(",").map((value) => value.trim());
  const versions = [...new Set(candidates)];
  if (
    versions.length === 0 ||
    versions.length > MAX_CHROME_EXTENSION_COMPATIBLE_VERSIONS ||
    candidates.some((version) => !version) ||
    versions.some((version) => !CHROME_EXTENSION_VERSION_PATTERN.test(version)) ||
    !versions.includes(currentVersion)
  ) {
    throw new Error(
      "AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS must contain at most 8 comma-separated semantic versions including the current extension version.",
    );
  }
  return versions;
}

export function chromeStatusHandshakeError(
  stored: StoredChromeInstallationIdentity,
  identity: ChromeInstallationIdentity | null,
  compatibility: ChromeExtensionCompatibility | null,
): "INSTALLATION_IDENTITY_REQUIRED" | "DEPLOYMENT_VERSION_MISMATCH" | null {
  if (!identity) {
    return compatibility || !isLegacyChromeInstallationIdentity(stored)
      ? "INSTALLATION_IDENTITY_REQUIRED"
      : null;
  }
  return compatibility ? null : "DEPLOYMENT_VERSION_MISMATCH";
}

function singleHeader(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  // Duplicate security-sensitive headers are never reduced to a trusted first
  // value; joining makes them fail the exact comparisons above.
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join(",").trim();
  }
  return undefined;
}
import type { ChromeInstallationIdentity } from "./chromeInstallationIdentity.ts";
import {
  isLegacyChromeInstallationIdentity,
  type StoredChromeInstallationIdentity,
} from "./chromeInstallationReconciliation.ts";
