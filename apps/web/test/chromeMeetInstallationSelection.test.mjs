import assert from "node:assert/strict";
import test from "node:test";

import {
  chromeMeetServerInstallationLinked,
  extensionStateForChromeMeetInstance,
  selectChromeMeetExtensionTransportId,
  selectChromeMeetInstallation,
} from "../src/features/product/chromeMeetInstallationSelection.ts";

const installations = [
  {
    id: "newer-profile",
    platform: "chrome_meet",
    status: "active",
    external_installation_id: "11111111-1111-4111-8111-111111111111",
  },
  {
    id: "current-profile",
    platform: "chrome_meet",
    status: "active",
    external_installation_id: "22222222-2222-4222-8222-222222222222",
  },
  {
    id: "revoked-profile",
    platform: "chrome_meet",
    status: "revoked",
    external_installation_id: "33333333-3333-4333-8333-333333333333",
  },
  {
    id: "zoom-installation",
    platform: "zoom",
    status: "active",
    external_installation_id: "44444444-4444-4444-8444-444444444444",
  },
];

test("setup instance identity takes precedence while the setup query is present", () => {
  const selected = selectChromeMeetInstallation(installations, {
    detectedInstallationInstanceId: "22222222-2222-4222-8222-222222222222",
    liveInstallationInstanceId: "11111111-1111-4111-8111-111111111111",
    extensionReachable: true,
  });

  assert.equal(selected?.id, "current-profile");
});

test("clearing the setup query keeps the same profile selected through live extension identity", () => {
  const duringSetup = selectChromeMeetInstallation(installations, {
    detectedInstallationInstanceId: "22222222-2222-4222-8222-222222222222",
    liveInstallationInstanceId: "22222222-2222-4222-8222-222222222222",
    extensionReachable: true,
  });
  const afterQueryClear = selectChromeMeetInstallation(installations, {
    liveInstallationInstanceId: "22222222-2222-4222-8222-222222222222",
    extensionReachable: true,
  });

  assert.equal(duringSetup?.id, "current-profile");
  assert.equal(afterQueryClear?.id, "current-profile");
});

test("a reachable extension never borrows an arbitrary installation row", () => {
  assert.equal(selectChromeMeetInstallation(installations, {
    extensionReachable: true,
  }), undefined);
  assert.equal(selectChromeMeetInstallation(installations, {
    liveInstallationInstanceId: "55555555-5555-4555-8555-555555555555",
    extensionReachable: true,
  }), undefined);
});

test("an unreachable extension falls back to the newest active Chrome installation", () => {
  const selected = selectChromeMeetInstallation(installations, {
    extensionReachable: false,
  });

  assert.equal(selected?.id, "newer-profile");
});

test("an explicit setup identity never falls back to another profile", () => {
  const selected = selectChromeMeetInstallation(installations, {
    detectedInstallationInstanceId: "55555555-5555-4555-8555-555555555555",
    extensionReachable: false,
  });

  assert.equal(selected, undefined);
});

test("only connected and degraded server rows count as linked", () => {
  assert.equal(chromeMeetServerInstallationLinked({
    platform: "chrome_meet",
    status: "pending",
    external_installation_id: "11111111-1111-4111-8111-111111111111",
  }), false);
  assert.equal(chromeMeetServerInstallationLinked({
    platform: "chrome_meet",
    status: "connected",
    external_installation_id: "11111111-1111-4111-8111-111111111111",
  }), true);
  assert.equal(chromeMeetServerInstallationLinked({
    platform: "chrome_meet",
    status: "degraded",
    external_installation_id: "11111111-1111-4111-8111-111111111111",
  }), true);
});

test("displayed extension state is scoped to the setup profile identity", () => {
  const state = {
    linked: true,
    installationInstanceId: "11111111-1111-4111-8111-111111111111",
  };

  assert.equal(extensionStateForChromeMeetInstance(
    state,
    "11111111-1111-4111-8111-111111111111",
  ), state);
  assert.equal(extensionStateForChromeMeetInstance(
    state,
    "22222222-2222-4222-8222-222222222222",
  ), null);
  assert.equal(extensionStateForChromeMeetInstance({ linked: true }, null), null);
  assert.equal(extensionStateForChromeMeetInstance(state, null), state);
});

test("a proven package transport survives setup-query clearing and server-list lag", () => {
  assert.equal(selectChromeMeetExtensionTransportId({
    detectedExtensionId: "setup-package",
    lastReachableExtensionId: "proven-package",
    selectedInstallationPackageId: "server-package",
  }), "setup-package");
  assert.equal(selectChromeMeetExtensionTransportId({
    lastReachableExtensionId: "proven-package",
    configuredExtensionId: "configured-package",
  }), "proven-package");
  assert.equal(selectChromeMeetExtensionTransportId({
    configuredExtensionId: "configured-package",
  }), "configured-package");
  assert.equal(selectChromeMeetExtensionTransportId({
    selectedInstallationPackageId: "server-package",
    fallbackInstallationPackageId: "fallback-package",
  }), "server-package");
  assert.equal(selectChromeMeetExtensionTransportId({}), null);
});
