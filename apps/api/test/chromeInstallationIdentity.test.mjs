import assert from "node:assert/strict";
import test from "node:test";

import {
  chromeExtensionPackageAllowed,
  parseChromeInstallationIdentity,
} from "../src/chromeInstallationIdentity.ts";

const packageId = "abcdefghijklmnopabcdefghijklmnop";

test("Chrome package identity is separated from each browser-profile installation", () => {
  const first = parseChromeInstallationIdentity({
    extensionId: packageId,
    installationInstanceId: "11111111-1111-4111-8111-111111111111",
  });
  const second = parseChromeInstallationIdentity({
    extensionId: packageId,
    installationInstanceId: "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.value.packageId, second.value.packageId);
  assert.notEqual(first.value.instanceId, second.value.instanceId);
});

test("installation linking rejects missing, malformed, or swapped identifiers", () => {
  assert.deepEqual(parseChromeInstallationIdentity({
    extensionId: "not-a-chrome-package-id",
    installationInstanceId: "11111111-1111-4111-8111-111111111111",
  }), { ok: false, error: "EXTENSION_ID_REQUIRED" });
  assert.deepEqual(parseChromeInstallationIdentity({
    extensionId: packageId,
    installationInstanceId: packageId,
  }), { ok: false, error: "INSTALLATION_INSTANCE_ID_REQUIRED" });
  assert.deepEqual(parseChromeInstallationIdentity({ extensionId: packageId }), {
    ok: false,
    error: "INSTALLATION_INSTANCE_ID_REQUIRED",
  });
});

test("production package binding accepts only the reviewed extension ID", () => {
  assert.equal(chromeExtensionPackageAllowed(packageId, undefined), true);
  assert.equal(chromeExtensionPackageAllowed(packageId, packageId), true);
  assert.equal(chromeExtensionPackageAllowed(
    "ponmlkjihgfedcbaponmlkjihgfedcba",
    packageId,
  ), false);
  assert.equal(chromeExtensionPackageAllowed(null, packageId), false);
});
