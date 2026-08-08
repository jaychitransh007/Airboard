import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("extension accepts pending trial access, rotates credentials and persists settings", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/background.js", import.meta.url),
    "utf8",
  );
  let stored = {
    linked: true,
    consented: false,
    entitled: false,
    installationToken: "old-installation-token",
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    settings: { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true, personOcclusion: true },
  };
  const internalListeners = [];
  const externalListeners = [];
  const installedListeners = [];
  const openedTabs = [];
  const requests = [];
  let uninstallUrl = null;
  const chrome = {
    runtime: {
      id: "airboard-extension-id",
      getManifest: () => ({ version: "0.8.0" }),
      onInstalled: { addListener: (listener) => installedListeners.push(listener) },
      onStartup: { addListener() {} },
      onMessage: { addListener: (listener) => internalListeners.push(listener) },
      onMessageExternal: { addListener: (listener) => externalListeners.push(listener) },
      sendMessage: () => Promise.resolve(),
      setUninstallURL: (url) => { uninstallUrl = url; },
    },
    storage: {
      local: {
        async get() { return { airboardState: stored }; },
        async set(value) { stored = value.airboardState; },
      },
    },
    tabs: {
      create(options) { openedTabs.push(options); },
      query(_query, callback) { callback([]); },
      sendMessage: () => Promise.resolve(),
    },
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith("/integrations/extension/status")) {
      return {
        ok: true,
        async json() {
          return {
            installation: {
              id: "install-1",
              external_installation_id: "11111111-1111-4111-8111-111111111111",
              external_package_id: "airboard-extension-id",
              consented_at: "2026-07-19T00:00:00Z",
              settings: { overlayEnabled: true },
            },
            entitlement: { status: "pending" },
            policy: {
              allowed_platforms: ["chrome_meet"],
              camera_enabled: true,
              voice_enabled: true,
              gesture_enabled: true,
            },
            installationToken: "rotated-installation-token",
            tokenExpiresAt: "2099-01-01T00:00:00.000Z",
            compatibility: {
              bridge: "airboard-media-bridge",
              protocolVersion: 1,
              extensionVersion: "0.8.0",
            },
          };
        },
      };
    }
    if (String(url).endsWith("/integrations/extension/settings")) {
      return { ok: true, async json() { return { settings: JSON.parse(options.body) }; } };
    }
    if (String(url).endsWith("/integrations/extension/preflight-complete")) {
      return { ok: true, async json() { return { verified: true }; } };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  vm.runInContext(source, vm.createContext({
    chrome,
    fetch,
    console,
    Date,
    Promise,
    JSON,
    Math,
    Object,
    URLSearchParams,
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
  }));
  installedListeners[0]({ reason: "install" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(uninstallUrl, /installationInstanceId=11111111-1111-4111-8111-111111111111/);
  assert.match(openedTabs[0].url, /installationInstanceId=11111111-1111-4111-8111-111111111111/);
  const sendInternal = (message) => new Promise((resolve) => {
    assert.equal(internalListeners[0](message, {}, resolve), true);
  });
  const refreshed = await sendInternal({ type: "AIRBOARD_REFRESH_STATUS" });
  assert.equal(refreshed.entitled, true, "pending trial access is enough to mount the first-run engine");
  assert.equal(refreshed.consented, true);
  assert.equal(refreshed.installationInstanceId, "11111111-1111-4111-8111-111111111111");
  const statusRequest = requests.find((request) => String(request.url).endsWith("/integrations/extension/status"));
  assert.equal(statusRequest.options.headers["X-Airboard-Extension-Id"], "airboard-extension-id");
  assert.equal(statusRequest.options.headers["X-Airboard-Bridge"], "airboard-media-bridge");
  assert.equal(
    statusRequest.options.headers["X-Airboard-Installation-Instance-Id"],
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(statusRequest.options.headers["X-Airboard-Bridge-Protocol-Version"], "1");
  assert.equal(statusRequest.options.headers["X-Airboard-Extension-Version"], "0.8.0");
  assert.equal(refreshed.settings.personOcclusion, false, "legacy depth settings cannot change the production layer order");
  assert.equal(stored.installationToken, "rotated-installation-token");

  internalListeners[0]({
    type: "AIRBOARD_MEET_CONTEXT",
    meetingDetected: true,
    meetingSessionId: "meeting-session-1",
    engineMounted: true,
  }, {}, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  internalListeners[0]({
    type: "AIRBOARD_COMPOSITOR_STATE",
    state: {
      armed: true,
      engaged: true,
      verification: {
        extensionVersion: "0.8.0",
        senderAttached: true,
        framesComposited: 0,
        framesEncoded: 10,
        bytesSent: 24_000,
        lastCompositeAt: 0,
        lastVerifiedAt: 0,
      },
    },
  }, {}, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.preflightComplete, false, "cumulative sender totals alone never pass preflight");
  assert.equal(
    requests.some((request) => String(request.url).endsWith("/integrations/extension/preflight-complete")),
    false,
  );

  const liveEvidenceAt = Date.now();
  internalListeners[0]({
    type: "AIRBOARD_COMPOSITOR_STATE",
    state: {
      armed: true,
      engaged: true,
      verification: {
        extensionVersion: "0.8.0",
        senderAttached: true,
        framesComposited: 3,
        framesEncoded: 10,
        bytesSent: 24_000,
        lastCompositeAt: liveEvidenceAt,
        lastVerifiedAt: liveEvidenceAt,
      },
    },
  }, {}, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.preflightComplete, true);
  assert.equal(stored.verifiedMeetingSessionId, "meeting-session-1");
  const preflight = requests.find((request) => String(request.url).endsWith("/integrations/extension/preflight-complete"));
  const preflightBody = JSON.parse(preflight.options.body);
  assert.equal(preflightBody.meetingSessionId, "meeting-session-1");
  assert.equal(preflightBody.framesComposited, 3);
  assert.equal(preflightBody.lastCompositeAt, liveEvidenceAt);
  assert.equal(preflightBody.lastVerifiedAt, liveEvidenceAt);

  internalListeners[0]({
    type: "AIRBOARD_MEET_CONTEXT",
    meetingDetected: true,
    meetingSessionId: "meeting-session-1",
    engineMounted: false,
  }, {}, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.preflightComplete, false, "unmounting the live engine invalidates readiness");
  assert.equal(stored.verificationExpiresAt, null);
  assert.ok(stored.lastVerifiedAt, "historical verification remains display-only");

  const updated = await sendInternal({ type: "AIRBOARD_SET_SETTINGS", settings: { overlayEnabled: false } });
  assert.equal(updated.ok, true);
  assert.equal(stored.settings.overlayEnabled, false);
  assert.ok(requests.some((request) => String(request.url).endsWith("/integrations/extension/settings")));

  const externalState = await new Promise((resolve) => {
    assert.equal(externalListeners[0]({ type: "AIRBOARD_GET_STATE" }, {}, resolve), true);
  });
  assert.equal(externalState.installationToken, undefined, "the website never receives the installation credential");
  assert.equal(externalState.installationInstanceId, "11111111-1111-4111-8111-111111111111");

  const mismatchedLink = await new Promise((resolve) => {
    assert.equal(externalListeners[0]({
      type: "AIRBOARD_LINK",
      linkToken: "one-time-link-token",
      installationInstanceId: "22222222-2222-4222-8222-222222222222",
    }, {}, resolve), true);
  });
  assert.equal(mismatchedLink.ok, false);
  assert.equal(mismatchedLink.error, "INSTALLATION_INSTANCE_MISMATCH");
});

test("background state mutations are serialized and merge against the latest committed state", async () => {
  const harness = await createMutationHarness();

  const tokenMutation = harness.saveState({
    installationToken: "rotated-installation-token",
    tokenExpiresAt: "2099-02-01T00:00:00.000Z",
  });
  await harness.waitForWrites(1);

  const settingsMutation = harness.saveState({ settings: { overlayEnabled: false } });
  const diagnosticsMutation = harness.saveState({
    diagnostics: {
      meetingDetected: true,
      engineMounted: true,
      meetingSessionId: "concurrent-session",
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.writesStarted(), 1, "only one storage write may be active at a time");
  assert.equal(harness.maxActiveWrites(), 1);

  harness.releaseNextWrite();
  await tokenMutation;
  await harness.waitForWrites(2);
  harness.releaseNextWrite();
  await settingsMutation;
  await harness.waitForWrites(3);
  harness.releaseNextWrite();
  await diagnosticsMutation;

  const stored = harness.stored();
  assert.equal(stored.installationToken, "rotated-installation-token");
  assert.equal(stored.tokenExpiresAt, "2099-02-01T00:00:00.000Z");
  assert.equal(stored.settings.overlayEnabled, false);
  assert.equal(stored.settings.audioEnabled, true, "nested settings fields survive an overlapping patch");
  assert.equal(stored.diagnostics.meetingDetected, true);
  assert.equal(stored.diagnostics.engineMounted, true);
  assert.equal(stored.diagnostics.meetingSessionId, "concurrent-session");
  assert.equal(harness.maxActiveWrites(), 1);
});

test("a failed state write does not poison the mutation queue", async () => {
  const harness = await createMutationHarness();
  harness.failNextWrite();

  const failedMutation = harness.saveState({ lastError: "not-committed" });
  const recoveryMutation = harness.saveState({
    linked: false,
    diagnostics: { bridgeError: "recovered" },
  });

  await assert.rejects(failedMutation, /STORAGE_WRITE_FAILED/);
  await harness.waitForWrites(2);
  harness.releaseNextWrite();
  await recoveryMutation;

  assert.equal(harness.stored().lastError, null);
  assert.equal(harness.stored().linked, false);
  assert.equal(harness.stored().diagnostics.bridgeError, "recovered");
  assert.equal(harness.maxActiveWrites(), 1);
});

test("a stale status response cannot clear a concurrently replaced credential", async () => {
  let resolveStatus;
  let markStatusStarted;
  const statusStarted = new Promise((resolve) => { markStatusStarted = resolve; });
  const harness = await createMutationHarness(async (url) => {
    assert.match(String(url), /\/integrations\/extension\/status$/);
    markStatusStarted();
    return new Promise((resolve) => { resolveStatus = resolve; });
  });

  const staleRefresh = harness.refreshStatus();
  await statusStarted;
  const credentialReplacement = harness.saveState({
    installationId: "replacement-installation",
    installationToken: "replacement-installation-token",
    tokenExpiresAt: "2099-03-01T00:00:00.000Z",
  });
  await harness.waitForWrites(1);
  harness.releaseNextWrite();
  await credentialReplacement;

  resolveStatus({ ok: false, status: 401 });
  await harness.waitForWrites(2);
  harness.releaseNextWrite();
  await staleRefresh;

  assert.equal(harness.stored().installationId, "replacement-installation");
  assert.equal(harness.stored().installationToken, "replacement-installation-token");
  assert.equal(harness.stored().linked, true);
  assert.equal(harness.stored().lastError, null);
});

test("a JSON installation-auth 401 clears the credential and requires reconnect", async () => {
  const harness = await createMutationHarness(async () => ({
    ok: false,
    status: 401,
    async json() { return { error: "INSTALLATION_TOKEN_REVOKED" }; },
  }));

  const refresh = harness.refreshStatus();
  await harness.waitForWrites(1);
  harness.releaseNextWrite();
  const state = await refresh;

  assert.equal(harness.stored().linked, false);
  assert.equal(harness.stored().installationToken, null);
  assert.equal(harness.stored().tokenExpiresAt, null);
  assert.equal(harness.stored().statusValidUntil, null);
  assert.equal(harness.stored().lastError, "INSTALLATION_RECONNECT_REQUIRED");
  assert.equal(state.linked, false);
  assert.equal(state.statusFresh, false);
});

test("repeated early deployment mismatch responses fail closed without consuming the credential", async () => {
  const requests = [];
  const harness = await createMutationHarness(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: false,
      status: 409,
      async json() { return { error: "DEPLOYMENT_VERSION_MISMATCH" }; },
    };
  });

  for (let refreshNumber = 1; refreshNumber <= 2; refreshNumber += 1) {
    const refresh = harness.refreshStatus();
    await harness.waitForWrites(refreshNumber);
    harness.releaseNextWrite();
    await refresh;
  }

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.match(String(request.url), /\/integrations\/extension\/status$/);
    assert.equal(request.options.headers["X-Airboard-Bridge-Protocol-Version"], "1");
    assert.equal(request.options.headers["X-Airboard-Extension-Version"], "0.8.0");
  }
  assert.equal(harness.stored().installationToken, "initial-installation-token");
  assert.equal(harness.stored().linked, true);
  assert.equal(harness.stored().entitled, false);
  assert.equal(harness.stored().statusValidUntil, null);
  assert.equal(harness.stored().lastError, "DEPLOYMENT_VERSION_MISMATCH");
});

test("a successful status response with a missing policy contract fails closed", async () => {
  const harness = await createMutationHarness(async () => ({
    ok: true,
    async json() {
      return {
        installation: {
          id: "install-1",
          external_installation_id: "11111111-1111-4111-8111-111111111111",
          external_package_id: "airboard-extension-id",
          consented_at: "2026-08-03T00:00:00.000Z",
          settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
        },
        entitlement: { status: "active", valid_until: "2099-01-01T00:00:00.000Z" },
        compatibility: {
          bridge: "airboard-media-bridge",
          protocolVersion: 1,
          extensionVersion: "0.8.0",
        },
      };
    },
  }));

  const refresh = harness.refreshStatus();
  await harness.waitForWrites(1);
  harness.releaseNextWrite();
  const state = await refresh;

  assert.equal(state.entitled, false);
  assert.equal(state.statusFresh, false);
  assert.equal(harness.stored().policy.allowed, false);
  assert.equal(harness.stored().policy.cameraEnabled, false);
  assert.equal(harness.stored().policy.voiceEnabled, false);
  assert.equal(harness.stored().policy.gestureEnabled, false);
  assert.equal(harness.stored().settings.overlayEnabled, false);
  assert.equal(harness.stored().settings.videoEnabled, false);
  assert.equal(harness.stored().settings.audioEnabled, false);
  assert.equal(harness.stored().preflightComplete, false);
  assert.equal(harness.stored().lastError, "POLICY_CONTRACT_INVALID");
});

test("an extension upgrade preserves identity and credential but invalidates cached readiness", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/background.js", import.meta.url),
    "utf8",
  );
  let stored = {
    linked: true,
    consented: true,
    entitled: true,
    preflightComplete: true,
    installationInstanceId: "11111111-1111-4111-8111-111111111111",
    extensionVersion: "0.7.0",
    installationToken: "preserved-installation-token",
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    statusCheckedAt: "2026-08-02T00:00:00.000Z",
    statusValidUntil: "2099-01-01T00:00:00.000Z",
    verifiedMeetingSessionId: "old-session",
    verificationExpiresAt: "2099-01-01T00:00:00.000Z",
  };
  const chrome = {
    runtime: {
      id: "airboard-extension-id",
      getManifest: () => ({ version: "0.8.0" }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      onMessageExternal: { addListener() {} },
      sendMessage: () => Promise.resolve(),
      setUninstallURL() {},
    },
    storage: {
      local: {
        async get() { return { airboardState: stored }; },
        async set(value) { stored = value.airboardState; },
      },
    },
    tabs: {
      query(_query, callback) { callback([]); },
      sendMessage: () => Promise.resolve(),
    },
  };
  vm.runInContext(source, vm.createContext({
    chrome,
    fetch: async () => { throw new Error("Unexpected request"); },
    console,
    Date,
    Promise,
    JSON,
    Math,
    Object,
    URLSearchParams,
    crypto: { randomUUID: () => "22222222-2222-4222-8222-222222222222" },
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stored.extensionVersion, "0.8.0");
  assert.equal(stored.installationInstanceId, "11111111-1111-4111-8111-111111111111");
  assert.equal(stored.installationToken, "preserved-installation-token");
  assert.equal(stored.linked, true);
  assert.equal(stored.consented, true);
  assert.equal(stored.entitled, false);
  assert.equal(stored.preflightComplete, false);
  assert.equal(stored.statusCheckedAt, null);
  assert.equal(stored.statusValidUntil, null);
  assert.equal(stored.verifiedMeetingSessionId, null);
  assert.equal(stored.verificationExpiresAt, null);
});

async function createMutationHarness(
  fetchImplementation = async () => { throw new Error("Unexpected request"); },
) {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/background.js", import.meta.url),
    "utf8",
  );
  let stored = {
    linked: true,
    installationInstanceId: "11111111-1111-4111-8111-111111111111",
    extensionVersion: "0.8.0",
    installationToken: "initial-installation-token",
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    statusValidUntil: "2099-01-01T00:00:00.000Z",
    lastError: null,
    settings: {
      overlayEnabled: true,
      neonTheme: true,
      videoEnabled: true,
      audioEnabled: true,
      personOcclusion: false,
    },
    diagnostics: {
      meetingDetected: false,
      engineMounted: false,
      armed: false,
      engaged: false,
      senderAttached: false,
      framesEncoded: 0,
      bytesSent: 0,
      lastCompositorAt: null,
      meetingSessionId: null,
    },
  };
  let activeWrites = 0;
  let peakActiveWrites = 0;
  let writesStarted = 0;
  let rejectNextWrite = false;
  const pendingWrites = [];
  const chrome = {
    runtime: {
      id: "airboard-extension-id",
      getManifest: () => ({ version: "0.8.0" }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      onMessageExternal: { addListener() {} },
      sendMessage: () => Promise.resolve(),
      setUninstallURL() {},
    },
    storage: {
      local: {
        async get() { return { airboardState: stored }; },
        set(value) {
          writesStarted += 1;
          activeWrites += 1;
          peakActiveWrites = Math.max(peakActiveWrites, activeWrites);
          if (rejectNextWrite) {
            rejectNextWrite = false;
            activeWrites -= 1;
            return Promise.reject(new Error("STORAGE_WRITE_FAILED"));
          }
          return new Promise((resolve) => {
            pendingWrites.push(() => {
              stored = value.airboardState;
              activeWrites -= 1;
              resolve();
            });
          });
        },
      },
    },
    tabs: {
      create() {},
      query(_query, callback) { callback([]); },
      sendMessage: () => Promise.resolve(),
    },
  };
  const context = vm.createContext({
    chrome,
    fetch: fetchImplementation,
    console,
    Date,
    Promise,
    JSON,
    Math,
    Object,
    URLSearchParams,
    crypto: { randomUUID: () => "22222222-2222-4222-8222-222222222222" },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  return {
    saveState: vm.runInContext("saveState", context),
    refreshStatus: vm.runInContext("refreshStatus", context),
    stored: () => stored,
    writesStarted: () => writesStarted,
    maxActiveWrites: () => peakActiveWrites,
    failNextWrite() { rejectNextWrite = true; },
    releaseNextWrite() {
      const release = pendingWrites.shift();
      assert.ok(release, "expected a pending storage write");
      release();
    },
    async waitForWrites(expected) {
      for (let attempt = 0; attempt < 20 && writesStarted < expected; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(writesStarted, expected);
    },
  };
}
