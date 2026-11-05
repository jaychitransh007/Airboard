export function effectiveChromeExtensionPolicy(
  policy: unknown,
  enabled: boolean,
): unknown {
  if (enabled) return policy;
  const current = policy && typeof policy === "object" && !Array.isArray(policy)
    ? policy as Record<string, unknown>
    : {};
  const allowedPlatforms = Array.isArray(current.allowed_platforms)
    ? current.allowed_platforms.filter((platform) => platform !== "chrome_meet")
    : [];
  return {
    ...current,
    allowed_platforms: allowedPlatforms,
    chrome_extension_enabled: false,
  };
}

/**
 * Produces an explicit deny response when the organization-policy or
 * entitlement dependency cannot be read. Returning this in an otherwise valid
 * status response makes the extension stop media immediately instead of
 * extending a cached allow decision.
 */
export function failClosedChromeExtensionPolicy(policy: unknown): Record<string, unknown> {
  const current = policy && typeof policy === "object" && !Array.isArray(policy)
    ? policy as Record<string, unknown>
    : {};
  const allowedPlatforms = Array.isArray(current.allowed_platforms)
    ? current.allowed_platforms.filter((platform) => platform !== "chrome_meet")
    : [];
  return {
    ...current,
    allowed_platforms: allowedPlatforms,
    camera_enabled: false,
    voice_enabled: false,
    gesture_enabled: false,
    chrome_extension_enabled: false,
  };
}
