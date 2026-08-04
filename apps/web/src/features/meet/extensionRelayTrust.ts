const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const CHROME_EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;
const EXTENSION_RELAY_NONCE_PATTERN = /^[0-9a-f]{64}$/;

export const EXTENSION_RELAY_NONCE_PARAMETER = "airboardRelayNonce";

export function normalizeChromeExtensionId(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return CHROME_EXTENSION_ID_PATTERN.test(candidate) ? candidate : null;
}

export function chromeExtensionOrigin(extensionId: string | null): string | null {
  return extensionId ? `chrome-extension://${extensionId}` : null;
}

export const CONFIGURED_CHROME_EXTENSION_ID = normalizeChromeExtensionId(
  process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID,
);

export const CONFIGURED_CHROME_EXTENSION_ORIGIN = chromeExtensionOrigin(
  CONFIGURED_CHROME_EXTENSION_ID,
);
export const UNPACKED_EXTENSION_RELAY_ALLOWED = process.env.NODE_ENV !== "production";

export function normalizeExtensionRelayNonce(value: string | null | undefined): string | null {
  return value && EXTENSION_RELAY_NONCE_PATTERN.test(value) ? value : null;
}

export function extensionRelayNonceFromHash(hash: string): string | null {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return normalizeExtensionRelayNonce(parameters.get(EXTENSION_RELAY_NONCE_PARAMETER));
}

export function isChromeExtensionOrigin(origin: string): boolean {
  return CHROME_EXTENSION_ORIGIN_PATTERN.test(origin);
}

export type ExtensionRelayTrust = {
  configuredOrigin: string | null;
  relayNonce: string | null;
  allowNonceBoundUnpacked?: boolean;
};

/**
 * Verifies the extension-owned parent of the private Meet renderer.
 *
 * Published builds bind to the exact Web Store extension origin. Development
 * can additionally accept an unpacked build when it proves possession of the
 * 256-bit nonce that the Meet content script generated for this frame.
 */
export function isTrustedExtensionRelayMessage(
  event: { origin: string; data: unknown },
  trust: ExtensionRelayTrust,
): boolean {
  if (!isChromeExtensionOrigin(event.origin)) {
    return false;
  }
  if (trust.configuredOrigin && event.origin !== trust.configuredOrigin) {
    return false;
  }
  if (trust.configuredOrigin && !trust.relayNonce) {
    // Legacy messages are accepted only from an explicitly configured,
    // exact production extension origin. There is no wildcard fallback.
    return true;
  }
  if (!trust.configuredOrigin && trust.allowNonceBoundUnpacked !== true) {
    return false;
  }
  if (!trust.relayNonce) {
    return false;
  }
  const data = event.data as Record<string, unknown> | null;
  return data?.relayNonce === trust.relayNonce;
}

export function extensionRelayMessageFields(
  relayNonce: string | null,
): { relayNonce: string } | Record<string, never> {
  return relayNonce ? { relayNonce } : {};
}
