export type ChromeMeetInstallationIdentity = {
  platform: string;
  status: string;
  external_installation_id: string | null;
};

export type ChromeMeetExtensionIdentity = {
  installationInstanceId?: string | null;
};

type SelectionOptions = {
  detectedInstallationInstanceId?: string | null;
  liveInstallationInstanceId?: string | null;
  extensionReachable: boolean;
};

/**
 * Selects the server row that belongs to the Chrome profile represented by the
 * current setup URL or the live extension. A reachable extension without an
 * instance identity fails closed instead of borrowing another profile's row.
 */
export function selectChromeMeetInstallation<T extends ChromeMeetInstallationIdentity>(
  installations: readonly T[],
  options: SelectionOptions,
): T | undefined {
  const active = installations.filter((installation) =>
    installation.platform === "chrome_meet" && installation.status !== "revoked");
  const detectedInstanceId = options.detectedInstallationInstanceId || null;
  if (detectedInstanceId) {
    return active.find((installation) => installation.external_installation_id === detectedInstanceId);
  }

  const liveInstanceId = options.liveInstallationInstanceId || null;
  if (liveInstanceId) {
    return active.find((installation) => installation.external_installation_id === liveInstanceId);
  }

  // The API returns newest installations first. That is a useful historical
  // fallback only while no local extension can identify the current profile.
  return options.extensionReachable ? undefined : active[0];
}

export function chromeMeetServerInstallationLinked(
  installation: ChromeMeetInstallationIdentity | undefined,
): boolean {
  return installation?.status === "connected" || installation?.status === "degraded";
}

/**
 * A setup URL names one browser-profile instance. Live state from any other
 * profile (or an older extension with no instance ID) must never contribute to
 * that setup page's readiness or connected state.
 */
export function extensionStateForChromeMeetInstance<T extends ChromeMeetExtensionIdentity>(
  state: T | null,
  detectedInstallationInstanceId?: string | null,
): T | null {
  const liveInstanceId = state?.installationInstanceId;
  if (!state || !liveInstanceId) return null;
  if (detectedInstallationInstanceId && liveInstanceId !== detectedInstallationInstanceId) {
    return null;
  }
  return state;
}

type ExtensionTransportOptions = {
  detectedExtensionId?: string | null;
  lastReachableExtensionId?: string | null;
  configuredExtensionId?: string | null;
  selectedInstallationPackageId?: string | null;
  fallbackInstallationPackageId?: string | null;
};

/** Keeps a proven transport address through setup-query clearing and API lag. */
export function selectChromeMeetExtensionTransportId(
  options: ExtensionTransportOptions,
): string | null {
  return options.detectedExtensionId ||
    options.lastReachableExtensionId ||
    options.configuredExtensionId ||
    options.selectedInstallationPackageId ||
    options.fallbackInstallationPackageId ||
    null;
}
