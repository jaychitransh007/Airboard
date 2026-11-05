import { CONFIGURED_CHROME_EXTENSION_ID } from "../../../../src/features/meet/extensionRelayTrust.ts";
import {
  CHROME_EXTENSION_VERSION,
  CHROME_WEB_STORE_URL,
} from "../../../../src/platform/distribution.ts";
import { rendererCompatibilityContract } from "./contract.ts";

export const dynamic = "force-static";

/**
 * Public, credential-free release handshake used before packaging the Chrome
 * extension. It prevents publishing an extension against an older renderer.
 */
export function GET() {
  const contract = rendererCompatibilityContract({
    nodeEnv: process.env.NODE_ENV,
    extensionVersion: CHROME_EXTENSION_VERSION,
    trustedExtensionId: CONFIGURED_CHROME_EXTENSION_ID,
    chromeWebStoreUrl: CHROME_WEB_STORE_URL,
    compatibleVersionsSource:
      process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS,
  });
  return contract.ok
    ? Response.json(contract.value)
    : Response.json({ error: contract.error }, { status: 503 });
}
