import assert from "node:assert/strict";
import test from "node:test";

import {
  CHROME_BRIDGE_MARKER,
  CHROME_BRIDGE_PROTOCOL_VERSION,
  CHROME_EXTENSION_COMPATIBLE_VERSIONS,
  CHROME_EXTENSION_VERSION,
  chromeStatusHandshakeError,
  parseChromeExtensionCompatibleVersions,
  parseChromeExtensionCompatibilityHeaders,
} from "../src/chromeExtensionCompatibility.ts";

const compatibleHeaders = {
  "x-airboard-bridge": CHROME_BRIDGE_MARKER,
  "x-airboard-bridge-protocol-version": String(CHROME_BRIDGE_PROTOCOL_VERSION),
  "x-airboard-extension-version": CHROME_EXTENSION_VERSION,
};

test("accepts the exact Chrome deployment handshake", () => {
  assert.deepEqual(parseChromeExtensionCompatibilityHeaders(compatibleHeaders), {
    ok: true,
    value: {
      bridge: CHROME_BRIDGE_MARKER,
      protocolVersion: CHROME_BRIDGE_PROTOCOL_VERSION,
      extensionVersion: CHROME_EXTENSION_VERSION,
    },
  });
});

test("accepts only versions in an explicit rolling-upgrade overlap set", () => {
  const previousHeaders = {
    ...compatibleHeaders,
    "x-airboard-extension-version": "0.7.9",
  };
  assert.deepEqual(
    parseChromeExtensionCompatibilityHeaders(previousHeaders, ["0.7.9", CHROME_EXTENSION_VERSION]),
    {
      ok: true,
      value: {
        bridge: CHROME_BRIDGE_MARKER,
        protocolVersion: CHROME_BRIDGE_PROTOCOL_VERSION,
        extensionVersion: "0.7.9",
      },
    },
  );
  assert.deepEqual(parseChromeExtensionCompatibilityHeaders(previousHeaders), {
    ok: false,
    error: "DEPLOYMENT_VERSION_MISMATCH",
  });
  assert.deepEqual(CHROME_EXTENSION_COMPATIBLE_VERSIONS, [CHROME_EXTENSION_VERSION]);
});

test("compatible-version configuration is finite and fail closed", () => {
  assert.deepEqual(parseChromeExtensionCompatibleVersions(undefined), [CHROME_EXTENSION_VERSION]);
  assert.deepEqual(
    parseChromeExtensionCompatibleVersions(`0.7.9, ${CHROME_EXTENSION_VERSION},0.7.9`),
    ["0.7.9", CHROME_EXTENSION_VERSION],
  );
  for (const value of [
    " ",
    "latest,0.8.0",
    "0.7.9",
    "0.8.0,",
    "0.1.0,0.2.0,0.3.0,0.4.0,0.5.0,0.6.0,0.7.0,0.7.9,0.8.0",
  ]) {
    if (value === " ") {
      assert.deepEqual(parseChromeExtensionCompatibleVersions(value), [CHROME_EXTENSION_VERSION]);
    } else {
      assert.throws(() => parseChromeExtensionCompatibleVersions(value));
    }
  }
});

test("identifies a wholly absent pre-handshake client", () => {
  assert.deepEqual(parseChromeExtensionCompatibilityHeaders({}), { ok: true, value: null });
});

test("partial, skewed, and duplicate handshakes fail closed", () => {
  for (const headers of [
    { "x-airboard-extension-version": CHROME_EXTENSION_VERSION },
    { ...compatibleHeaders, "x-airboard-extension-version": "0.7.0" },
    { ...compatibleHeaders, "x-airboard-bridge-protocol-version": "2" },
    { ...compatibleHeaders, "x-airboard-bridge": [CHROME_BRIDGE_MARKER, CHROME_BRIDGE_MARKER] },
  ]) {
    assert.deepEqual(parseChromeExtensionCompatibilityHeaders(headers), {
      ok: false,
      error: "DEPLOYMENT_VERSION_MISMATCH",
    });
  }
});

test("headerless rollout is limited to a true legacy row", () => {
  const packageId = "abcdefghijklmnopabcdefghijklmnop";
  const instanceId = "11111111-1111-4111-8111-111111111111";
  const compatibility = parseChromeExtensionCompatibilityHeaders(compatibleHeaders).value;
  const legacy = {
    platform: "chrome_meet",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  };
  const migrated = {
    ...legacy,
    externalInstallationId: instanceId,
  };
  const identity = { packageId, instanceId };

  assert.equal(chromeStatusHandshakeError(legacy, null, null), null);
  assert.equal(
    chromeStatusHandshakeError(migrated, null, null),
    "INSTALLATION_IDENTITY_REQUIRED",
  );
  assert.equal(
    chromeStatusHandshakeError(legacy, identity, null),
    "DEPLOYMENT_VERSION_MISMATCH",
  );
  assert.equal(
    chromeStatusHandshakeError(legacy, null, compatibility),
    "INSTALLATION_IDENTITY_REQUIRED",
  );
  assert.equal(chromeStatusHandshakeError(legacy, identity, compatibility), null);
});
