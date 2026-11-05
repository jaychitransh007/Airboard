const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MAX_COMPATIBLE_EXTENSION_VERSIONS = 8;

type RendererCompatibilityInput = {
  nodeEnv: string | undefined;
  extensionVersion: string;
  trustedExtensionId: string | null;
  chromeWebStoreUrl?: string | null;
  compatibleVersionsSource?: string | undefined;
};

export function rendererCompatibilityContract(input: RendererCompatibilityInput):
  | {
      ok: true;
      value: {
        bridge: "airboard-media-bridge";
        protocolVersion: 1;
        extensionVersion: string;
        compatibleExtensionVersions: string[];
        trustedExtensionId: string | null;
        chromeWebStoreUrl: string | null;
      };
    }
  | { ok: false; error: string } {
  if (input.nodeEnv === "production" && !input.trustedExtensionId) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID is required in production.",
    };
  }
  if (!EXTENSION_VERSION_PATTERN.test(input.extensionVersion)) {
    return { ok: false, error: "The renderer extension version is invalid." };
  }
  const configured = input.compatibleVersionsSource?.trim();
  const candidates = configured
    ? input.compatibleVersionsSource!.split(",").map((version) => version.trim())
    : [input.extensionVersion];
  const compatibleExtensionVersions = [...new Set(candidates)];
  if (
    candidates.some((version) => !version) ||
    compatibleExtensionVersions.length > MAX_COMPATIBLE_EXTENSION_VERSIONS ||
    compatibleExtensionVersions.some((version) => !EXTENSION_VERSION_PATTERN.test(version)) ||
    !compatibleExtensionVersions.includes(input.extensionVersion)
  ) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS must contain at most 8 semantic versions including the current extension version.",
    };
  }
  return {
    ok: true,
    value: {
      bridge: "airboard-media-bridge",
      protocolVersion: 1,
      extensionVersion: input.extensionVersion,
      compatibleExtensionVersions,
      trustedExtensionId: input.trustedExtensionId,
      chromeWebStoreUrl: input.chromeWebStoreUrl ?? null,
    },
  };
}
