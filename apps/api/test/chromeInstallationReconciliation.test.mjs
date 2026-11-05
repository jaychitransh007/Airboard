import assert from "node:assert/strict";
import test from "node:test";

import {
  isLegacyChromeInstallationIdentity,
  reconcileChromeInstallationIdentity,
} from "../src/chromeInstallationReconciliation.ts";

const packageId = "abcdefghijklmnopabcdefghijklmnop";
const firstInstance = "11111111-1111-4111-8111-111111111111";
const secondInstance = "22222222-2222-4222-8222-222222222222";

test("an authenticated legacy package row is claimed by one browser profile UUID", () => {
  assert.deepEqual(reconcileChromeInstallationIdentity({
    platform: "chrome_meet",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  }, { packageId, instanceId: firstInstance }), {
    ok: true,
    action: "migrate",
    externalInstallationId: firstInstance,
    externalPackageId: packageId,
  });
});

test("the migrated browser profile remains stable while a second legacy holder reconnects", () => {
  const stored = {
    platform: "chrome_meet",
    externalInstallationId: firstInstance,
    externalPackageId: packageId,
  };
  assert.equal(
    reconcileChromeInstallationIdentity(stored, { packageId, instanceId: firstInstance }).ok,
    true,
  );
  assert.deepEqual(
    reconcileChromeInstallationIdentity(stored, { packageId, instanceId: secondInstance }),
    { ok: false, error: "INSTALLATION_INSTANCE_MISMATCH" },
  );
});

test("package and platform mismatches fail closed", () => {
  assert.deepEqual(reconcileChromeInstallationIdentity({
    platform: "chrome_meet",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  }, { packageId: "ponmlkjihgfedcbaponmlkjihgfedcba", instanceId: firstInstance }), {
    ok: false,
    error: "INSTALLATION_PACKAGE_MISMATCH",
  });
  assert.deepEqual(reconcileChromeInstallationIdentity({
    platform: "zoom",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  }, { packageId, instanceId: firstInstance }), {
    ok: false,
    error: "INSTALLATION_PLATFORM_MISMATCH",
  });
});

test("only a true package-keyed Chrome row qualifies for headerless legacy rollout", () => {
  assert.equal(isLegacyChromeInstallationIdentity({
    platform: "chrome_meet",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  }), true);
  assert.equal(isLegacyChromeInstallationIdentity({
    platform: "chrome_meet",
    externalInstallationId: packageId,
    externalPackageId: null,
  }), true);
  assert.equal(isLegacyChromeInstallationIdentity({
    platform: "chrome_meet",
    externalInstallationId: firstInstance,
    externalPackageId: packageId,
  }), false);
  assert.equal(isLegacyChromeInstallationIdentity({
    platform: "zoom",
    externalInstallationId: packageId,
    externalPackageId: packageId,
  }), false);
});
