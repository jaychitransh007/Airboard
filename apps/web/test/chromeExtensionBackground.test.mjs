import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("extension accepts pending trial access, rotates credentials and persists settings", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/background.js", import.meta.url),
    "utf8",
  );
  let stored = null;
  const internalListeners = [];
  const externalListeners = [];
  const requests = [];
  const chrome = {
    runtime: {
      id: "airboard-extension-id",
      getManifest: () => ({ version: "0.8.0" }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener: (listener) => internalListeners.push(listener) },
      onMessageExternal: { addListener: (listener) => externalListeners.push(listener) },
      sendMessage: () => Promise.resolve(),
    },
    storage: {
      local: {
        async get() { return { airboardState: stored }; },
        async set(value) { stored = value.airboardState; },
      },
    },
    tabs: {
      create() {},
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
            installation: { id: "install-1", consented_at: "2026-07-19T00:00:00Z", settings: { overlayEnabled: true } },
            entitlement: { status: "pending" },
            policy: { allowed_platforms: ["chrome_meet"], camera_enabled: true, voice_enabled: true },
            installationToken: "rotated-installation-token",
          };
        },
      };
    }
    if (String(url).endsWith("/integrations/extension/settings")) {
      return { ok: true, async json() { return { settings: JSON.parse(options.body) }; } };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  vm.runInContext(source, vm.createContext({ chrome, fetch, console, Date, Promise, JSON, Math, Object }));
  stored = {
    linked: true,
    consented: false,
    entitled: false,
    installationToken: "old-installation-token",
    settings: { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true, personOcclusion: true },
  };

  const sendInternal = (message) => new Promise((resolve) => {
    assert.equal(internalListeners[0](message, {}, resolve), true);
  });
  const refreshed = await sendInternal({ type: "AIRBOARD_REFRESH_STATUS" });
  assert.equal(refreshed.entitled, true, "pending trial access is enough to mount the first-run engine");
  assert.equal(refreshed.consented, true);
  assert.equal(refreshed.settings.personOcclusion, false, "legacy depth settings cannot change the production layer order");
  assert.equal(stored.installationToken, "rotated-installation-token");

  const updated = await sendInternal({ type: "AIRBOARD_SET_SETTINGS", settings: { overlayEnabled: false } });
  assert.equal(updated.ok, true);
  assert.equal(stored.settings.overlayEnabled, false);
  assert.ok(requests.some((request) => String(request.url).endsWith("/integrations/extension/settings")));

  const externalState = await new Promise((resolve) => {
    assert.equal(externalListeners[0]({ type: "AIRBOARD_GET_STATE" }, {}, resolve), true);
  });
  assert.equal(externalState.installationToken, undefined, "the website never receives the installation credential");
});
