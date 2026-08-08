export type ChromeInstallationIdentity = {
  packageId: string;
  instanceId: string;
};

export type ChromeInstallationIdentityResult =
  | { ok: true; value: ChromeInstallationIdentity }
  | { ok: false; error: "EXTENSION_ID_REQUIRED" | "INSTALLATION_INSTANCE_ID_REQUIRED" };

const CHROME_EXTENSION_ID = /^[a-p]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Chrome's runtime ID addresses the published package and is shared by every
 * install. The instance UUID is generated once by each browser profile and is
 * the only value suitable for an installation uniqueness key.
 */
export function parseChromeInstallationIdentity(input: unknown): ChromeInstallationIdentityResult {
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const packageId = typeof body.extensionId === "string" ? body.extensionId.trim() : "";
  if (!CHROME_EXTENSION_ID.test(packageId)) {
    return { ok: false, error: "EXTENSION_ID_REQUIRED" };
  }
  const instanceId = typeof body.installationInstanceId === "string"
    ? body.installationInstanceId.trim()
    : "";
  if (!UUID.test(instanceId)) {
    return { ok: false, error: "INSTALLATION_INSTANCE_ID_REQUIRED" };
  }
  return { ok: true, value: { packageId, instanceId } };
}

export function normalizeChromeExtensionPackageId(
  value: string | undefined,
): string | undefined {
  const candidate = value?.trim() ?? "";
  return CHROME_EXTENSION_ID.test(candidate) ? candidate : undefined;
}

export function chromeExtensionPackageAllowed(
  packageId: string | null | undefined,
  configuredPackageId: string | undefined,
): boolean {
  return configuredPackageId === undefined || packageId === configuredPackageId;
}
