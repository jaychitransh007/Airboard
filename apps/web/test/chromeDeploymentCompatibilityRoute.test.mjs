import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/meet/overlay-engine/compatibility/route.ts";
import { rendererCompatibilityContract } from "../app/meet/overlay-engine/compatibility/contract.ts";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

test("renderer exposes the release contract used by extension packaging", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  const contract = await response.json();
  assert.equal(contract.bridge, "airboard-media-bridge");
  assert.equal(contract.protocolVersion, 1);
  assert.equal(contract.extensionVersion, "0.8.0");
  assert.deepEqual(contract.compatibleExtensionVersions, ["0.8.0"]);
  assert.equal(contract.trustedExtensionId, null);
  assert.equal(contract.chromeWebStoreUrl, null);
});

test("production compatibility rejects a missing trusted Web Store ID", () => {
  assert.deepEqual(rendererCompatibilityContract({
    nodeEnv: "production",
    extensionVersion: "0.8.0",
    trustedExtensionId: null,
  }), {
    ok: false,
    error: "NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID is required in production.",
  });
});

test("renderer advertises only an explicit capability-compatible overlap window", () => {
  assert.deepEqual(rendererCompatibilityContract({
    nodeEnv: "production",
    extensionVersion: "0.8.0",
    compatibleVersionsSource: "0.7.9,0.8.0,0.7.9",
    trustedExtensionId: extensionId,
  }), {
    ok: true,
    value: {
      bridge: "airboard-media-bridge",
      protocolVersion: 1,
      extensionVersion: "0.8.0",
      compatibleExtensionVersions: ["0.7.9", "0.8.0"],
      trustedExtensionId: extensionId,
      chromeWebStoreUrl: null,
    },
  });
  for (const compatibleVersionsSource of [
    "latest,0.8.0",
    "0.7.9",
    "0.8.0,",
    "0.1.0,0.2.0,0.3.0,0.4.0,0.5.0,0.6.0,0.7.0,0.7.9,0.8.0",
  ]) {
    assert.equal(rendererCompatibilityContract({
      nodeEnv: "production",
      extensionVersion: "0.8.0",
      compatibleVersionsSource,
      trustedExtensionId: extensionId,
    }).ok, false);
  }
});
