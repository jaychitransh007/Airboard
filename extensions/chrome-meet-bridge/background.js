"use strict";

const API_URL = "https://airboard-pilot-api-634900453473.asia-south1.run.app";
const APP_URL = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const STATUS_ALARM = "airboard-installation-status";
const STATUS_REFRESH_MINUTES = 5;
const STATUS_FRESHNESS_MS = 15 * 60 * 1000;
const LIVE_VERIFICATION_FRESHNESS_MS = 15 * 1000;
const BRIDGE_PROTOCOL_VERSION = 1;
let refreshInFlight = null;
let initializationInFlight = null;
let stateMutationQueue = Promise.resolve();
const DEFAULT_STATE = {
  linked: false,
  consented: false,
  entitled: false,
  preflightComplete: false,
  installationId: null,
  installationInstanceId: null,
  extensionVersion: null,
  settings: {
    overlayEnabled: true,
    neonTheme: true,
    videoEnabled: true,
    audioEnabled: true,
    personOcclusion: false,
  },
  installationToken: null,
  tokenExpiresAt: null,
  statusCheckedAt: null,
  statusValidUntil: null,
  verifiedMeetingSessionId: null,
  verificationExpiresAt: null,
  lastError: null,
  lastVerifiedAt: null,
  diagnostics: {
    meetingDetected: false,
    engineMounted: false,
    armed: false,
    engaged: false,
    senderAttached: false,
    framesComposited: 0,
    framesEncoded: 0,
    bytesSent: 0,
    lastCompositeAt: 0,
    lastSenderVerifiedAt: 0,
    lastCompositorAt: null,
    meetingSessionId: null,
  },
  policy: { allowed: false, cameraEnabled: false, voiceEnabled: false, gestureEnabled: false },
};

chrome.runtime.onInstalled.addListener((details) => {
  void initialize().then(async () => {
    configureStatusAlarm();
    const state = await currentState();
    chrome.runtime.setUninstallURL(integrationUrl("uninstall", state.installationInstanceId));
    if (details.reason === "install") {
      chrome.tabs.create({
        url: integrationUrl("setup", state.installationInstanceId),
      });
    } else void refreshStatus();
  });
});

chrome.runtime.onStartup.addListener(() => {
  configureStatusAlarm();
  void refreshStatus();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name === STATUS_ALARM) void refreshStatus();
});

void initialize().then(configureStatusAlarm);

chrome.runtime.onMessageExternal.addListener((message, _sender, respond) => {
  if (message?.type === "AIRBOARD_GET_STATE") {
    void currentState().then((state) => respond(publicState(state)));
    return true;
  }
  if (message?.type === "AIRBOARD_LINK" && typeof message.linkToken === "string") {
    void currentState()
      .then((state) => {
        if (
          typeof message.installationInstanceId !== "string" ||
          message.installationInstanceId !== state.installationInstanceId
        ) {
          throw new Error("INSTALLATION_INSTANCE_MISMATCH");
        }
        return exchangeLink(message.linkToken);
      })
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ ok: false, error: safeError(error) }));
    return true;
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "AIRBOARD_GET_STATE") {
    void currentState().then((state) => respond(publicState(state)));
    return true;
  }
  if (message?.type === "AIRBOARD_SET_SETTINGS") {
    void updateSettings(message.settings)
      .then((state) => respond({ ok: true, ...state }))
      .catch((error) => respond({ ok: false, error: safeError(error) }));
    return true;
  }
  if (message?.type === "AIRBOARD_CONFIRM_MEDIA") {
    void confirmMedia().then(() => respond({ ok: true })).catch((error) => respond({ ok: false, error: safeError(error) }));
    return true;
  }
  if (message?.type === "AIRBOARD_REFRESH_STATUS") {
    void refreshStatus().then(respond);
    return true;
  }
  if (message?.type === "AIRBOARD_COMPOSITOR_STATE") {
    void processCompositorState(message.state);
    return false;
  }
  if (message?.type === "AIRBOARD_MEET_CONTEXT") {
    void processMeetContext(message);
    return false;
  }
  return false;
});

function initialize() {
  if (initializationInFlight) return initializationInFlight;
  initializationInFlight = initializeOnce().finally(() => {
    initializationInFlight = null;
  });
  return initializationInFlight;
}

async function initializeOnce() {
  const stored = await chrome.storage.local.get("airboardState");
  const runtimeVersion = chrome.runtime.getManifest().version;
  if (
    stored.airboardState?.installationInstanceId &&
    stored.airboardState?.extensionVersion === runtimeVersion
  ) return;
  const versionChanged = Boolean(
    stored.airboardState && stored.airboardState.extensionVersion !== runtimeVersion,
  );
  await chrome.storage.local.set({
    airboardState: {
      ...DEFAULT_STATE,
      ...stored.airboardState,
      installationInstanceId:
        stored.airboardState?.installationInstanceId ?? crypto.randomUUID(),
      extensionVersion: runtimeVersion,
      ...(versionChanged
        ? {
            entitled: false,
            preflightComplete: false,
            statusCheckedAt: null,
            statusValidUntil: null,
            verifiedMeetingSessionId: null,
            verificationExpiresAt: null,
          }
        : {}),
    },
  });
}

function integrationUrl(mode, installationInstanceId) {
  const params = new URLSearchParams({
    [mode]: "chrome_meet",
    extensionId: chrome.runtime.id,
    installationInstanceId,
  });
  if (mode === "setup") {
    params.set("version", chrome.runtime.getManifest().version);
  }
  return `${APP_URL}/app/integrations?${params.toString()}`;
}

function configureStatusAlarm() {
  chrome.alarms?.create?.(STATUS_ALARM, { periodInMinutes: STATUS_REFRESH_MINUTES });
}

async function currentState() {
  await initialize();
  const { airboardState } = await chrome.storage.local.get("airboardState");
  return {
    ...DEFAULT_STATE,
    ...airboardState,
    settings: { ...DEFAULT_STATE.settings, ...airboardState?.settings },
    diagnostics: { ...DEFAULT_STATE.diagnostics, ...airboardState?.diagnostics },
    policy: { ...DEFAULT_STATE.policy, ...airboardState?.policy },
  };
}

function saveState(patchOrUpdater) {
  const mutation = stateMutationQueue.then(async () => {
    const state = await currentState();
    const patch =
      typeof patchOrUpdater === "function" ? patchOrUpdater(state) : patchOrUpdater;
    const next = {
      ...state,
      ...patch,
      settings: patch.settings ? { ...state.settings, ...patch.settings } : state.settings,
      diagnostics: patch.diagnostics ? { ...state.diagnostics, ...patch.diagnostics } : state.diagnostics,
      policy: patch.policy ? { ...state.policy, ...patch.policy } : state.policy,
    };
    await chrome.storage.local.set({ airboardState: next });
    chrome.runtime.sendMessage({ type: "AIRBOARD_STATE_CHANGED", state: publicState(next) }).catch(() => {});
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          chrome.tabs.sendMessage(tab.id, { type: "AIRBOARD_STATE_CHANGED", state: publicState(next) }).catch(() => {});
        }
      }
    });
    return publicState(next);
  });

  // A failed storage write rejects its caller, but must not poison later
  // mutations. Every subsequent update still starts after this one settles.
  stateMutationQueue = mutation.catch(() => undefined);
  return mutation;
}

function publicState(state) {
  const { installationToken: _token, ...safe } = state;
  const statusFresh =
    timestampInFuture(state.statusValidUntil) && timestampInFuture(state.tokenExpiresAt);
  return {
    ...safe,
    entitled: state.entitled === true && statusFresh,
    statusFresh,
  };
}

function timestampInFuture(value) {
  return typeof value === "string" && new Date(value).getTime() > Date.now();
}

async function processMeetContext(message) {
  const detected = message.meetingDetected === true;
  const nextSessionId =
    detected && typeof message.meetingSessionId === "string"
      ? message.meetingSessionId.slice(0, 160)
      : null;
  const engineMounted = message.engineMounted === true;
  await saveState((state) => {
    const sessionChanged = state.diagnostics.meetingSessionId !== nextSessionId;
    const resetLiveVerification = sessionChanged || !detected || !engineMounted;
    return {
      ...(resetLiveVerification
        ? {
            preflightComplete: false,
            verifiedMeetingSessionId: null,
            verificationExpiresAt: null,
          }
        : {}),
      diagnostics: {
        meetingDetected: detected,
        meetingSessionId: nextSessionId,
        engineMounted,
        ...(resetLiveVerification
          ? {
              armed: false,
              engaged: false,
              senderAttached: false,
              framesEncoded: 0,
              bytesSent: 0,
              lastCompositorAt: null,
            }
          : {}),
        ...(typeof message.error === "string" ? { bridgeError: message.error.slice(0, 160) } : {}),
      },
      ...(typeof message.error === "string" ? { lastError: message.error.slice(0, 160) } : {}),
    };
  });
}

async function exchangeLink(linkToken) {
  const response = await fetch(`${API_URL}/integrations/extension-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkToken }),
  });
  if (!response.ok) throw new Error(`LINK_EXCHANGE_${response.status}`);
  const result = await response.json();
  await saveState({
    linked: true,
    installationToken: result.installationToken,
    tokenExpiresAt: result.expiresAt || null,
    statusCheckedAt: null,
    statusValidUntil: null,
    entitled: false,
    lastError: null,
  });
  await refreshStatus();
}

function refreshStatus() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshStatusOnce().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshStatusOnce() {
  const state = await currentState();
  if (!state.installationToken) return publicState(state);
  const requestToken = state.installationToken;
  const extensionVersion = chrome.runtime.getManifest().version;
  try {
    const response = await fetch(`${API_URL}/integrations/extension/status`, {
      headers: {
        Authorization: `Bearer ${requestToken}`,
        "X-Airboard-Extension-Id": chrome.runtime.id,
        "X-Airboard-Installation-Instance-Id": state.installationInstanceId,
        "X-Airboard-Bridge": "airboard-media-bridge",
        "X-Airboard-Bridge-Protocol-Version": String(BRIDGE_PROTOCOL_VERSION),
        "X-Airboard-Extension-Version": extensionVersion,
      },
    });
    if (!response.ok) {
      // Authentication failures always revoke the local capability, regardless
      // of the API's more specific JSON error code.
      if (response.status === 401) throw new Error("STATUS_401");
      const failure = typeof response.json === "function"
        ? await response.json().catch(() => null)
        : null;
      throw new Error(
        typeof failure?.error === "string" ? failure.error : `STATUS_${response.status}`,
      );
    }
    const result = await response.json();
    const compatibility = result.compatibility;
    if (
      compatibility?.bridge !== "airboard-media-bridge" ||
      compatibility.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
      compatibility.extensionVersion !== extensionVersion
    ) {
      throw new Error("DEPLOYMENT_VERSION_MISMATCH");
    }
    if (
      result.installation?.external_installation_id !== state.installationInstanceId ||
      result.installation?.external_package_id !== chrome.runtime.id
    ) {
      throw new Error("INSTALLATION_INSTANCE_MISMATCH");
    }
    const now = Date.now();
    const policy = result.policy;
    const policyContractValid =
      policy !== null &&
      typeof policy === "object" &&
      !Array.isArray(policy) &&
      Array.isArray(policy.allowed_platforms) &&
      typeof policy.camera_enabled === "boolean" &&
      typeof policy.voice_enabled === "boolean" &&
      typeof policy.gesture_enabled === "boolean";
    const consented = Boolean(result.installation?.consented_at);
    if (!policyContractValid) {
      return saveState((current) => {
        if (current.installationToken !== requestToken) return {};
        return {
          linked: true,
          consented,
          entitled: false,
          installationId: result.installation?.id || current.installationId,
          installationToken: result.installationToken || current.installationToken,
          tokenExpiresAt: result.tokenExpiresAt || current.tokenExpiresAt,
          statusCheckedAt: new Date(now).toISOString(),
          statusValidUntil: null,
          settings: {
            ...current.settings,
            overlayEnabled: false,
            videoEnabled: false,
            audioEnabled: false,
            personOcclusion: false,
          },
          policy: {
            allowed: false,
            cameraEnabled: false,
            voiceEnabled: false,
            gestureEnabled: false,
          },
          preflightComplete: false,
          verifiedMeetingSessionId: null,
          verificationExpiresAt: null,
          lastError: "POLICY_CONTRACT_INVALID",
        };
      });
    }
    const entitlement = result.entitlement;
    const entitlementUnexpired =
      !entitlement?.valid_until || new Date(entitlement.valid_until).getTime() > now;
    const active =
      entitlement &&
      ["pending", "trialing", "grace", "active"].includes(entitlement.status) &&
      (entitlement.status === "pending" || entitlementUnexpired);
    const allowed = policy.allowed_platforms.includes("chrome_meet");
    const entitled = Boolean(active && allowed);
    return saveState((current) => {
      // Ignore a response authenticated with a credential that has since been
      // replaced by a link or another successful rotation.
      if (current.installationToken !== requestToken) return {};
      const serverSettings = result.installation?.settings || current.settings;
      const effectiveSettings = {
        ...current.settings,
        ...serverSettings,
        overlayEnabled: serverSettings.overlayEnabled !== false && allowed,
        videoEnabled: serverSettings.videoEnabled !== false && policy.camera_enabled !== false,
        audioEnabled: serverSettings.audioEnabled !== false && policy.voice_enabled !== false,
        // Retained in persisted schemas for backward compatibility, but the
        // production composite is always camera -> scrim -> complete diagram.
        personOcclusion: false,
      };
      return {
        linked: true,
        consented,
        entitled,
        installationId: result.installation?.id || current.installationId,
        installationToken: result.installationToken || current.installationToken,
        tokenExpiresAt: result.tokenExpiresAt || current.tokenExpiresAt,
        statusCheckedAt: new Date(now).toISOString(),
        statusValidUntil: new Date(now + STATUS_FRESHNESS_MS).toISOString(),
        settings: effectiveSettings,
        policy: {
          allowed,
          cameraEnabled: policy.camera_enabled !== false,
          voiceEnabled: policy.voice_enabled !== false,
          gestureEnabled: policy.gesture_enabled !== false,
        },
        lastError: result.installation?.last_error_code || null,
        ...(!entitled || !consented
          ? {
              preflightComplete: false,
              verifiedMeetingSessionId: null,
              verificationExpiresAt: null,
            }
          : {}),
      };
    });
  } catch (error) {
    const code = safeError(error);
    if (
      code === "STATUS_401" ||
      code === "INSTALLATION_INSTANCE_MISMATCH" ||
      code === "INSTALLATION_PACKAGE_MISMATCH" ||
      code === "INSTALLATION_PLATFORM_MISMATCH" ||
      code === "INSTALLATION_IDENTITY_REQUIRED" ||
      code === "INSTALLATION_IDENTITY_MIGRATION_CONFLICT"
    ) {
      return saveState((current) =>
        current.installationToken === requestToken
          ? {
              linked: false,
              consented: false,
              entitled: false,
              installationId: null,
              installationToken: null,
              tokenExpiresAt: null,
              statusCheckedAt: null,
              statusValidUntil: null,
              preflightComplete: false,
              verifiedMeetingSessionId: null,
              verificationExpiresAt: null,
              lastError: code === "STATUS_401"
                ? "INSTALLATION_RECONNECT_REQUIRED"
                : code,
            }
          : {},
      );
    }
    if (code === "DEPLOYMENT_VERSION_MISMATCH") {
      return saveState((current) =>
        current.installationToken === requestToken
          ? {
              entitled: false,
              preflightComplete: false,
              statusCheckedAt: null,
              statusValidUntil: null,
              verifiedMeetingSessionId: null,
              verificationExpiresAt: null,
              lastError: code,
            }
          : {},
      );
    }
    return saveState((current) => {
      if (current.installationToken !== requestToken) return {};
      if (!timestampInFuture(current.statusValidUntil) || !timestampInFuture(current.tokenExpiresAt)) {
        return {
          entitled: false,
          preflightComplete: false,
          verifiedMeetingSessionId: null,
          verificationExpiresAt: null,
          lastError: "INSTALLATION_STATUS_STALE",
        };
      }
      return { lastError: code };
    });
  }
}

async function confirmMedia() {
  const state = await currentState();
  if (!state.installationToken) throw new Error("CONNECT_AIRBOARD_FIRST");
  const requestToken = state.installationToken;
  const response = await fetch(`${API_URL}/integrations/extension/consent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ camera: true, microphone: true, voiceProcessing: true }),
  });
  if (!response.ok) throw new Error(`CONSENT_${response.status}`);
  await saveState((current) =>
    current.installationToken === requestToken
      ? { consented: true, lastError: null }
      : {},
  );
}

async function updateSettings(settings) {
  const allowed = {};
  for (const key of Object.keys(DEFAULT_STATE.settings)) {
    if (typeof settings?.[key] === "boolean") allowed[key] = settings[key];
  }
  const state = await currentState();
  if (!state.installationToken) throw new Error("CONNECT_AIRBOARD_FIRST");
  const requestToken = state.installationToken;
  if (!state.policy.allowed) allowed.overlayEnabled = false;
  if (!state.policy.cameraEnabled) {
    allowed.videoEnabled = false;
    allowed.personOcclusion = false;
  }
  if (!state.policy.voiceEnabled) allowed.audioEnabled = false;
  const response = await fetch(`${API_URL}/integrations/extension/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(allowed),
  });
  if (!response.ok) throw new Error(`SETTINGS_${response.status}`);
  const result = await response.json();
  return saveState((current) =>
    current.installationToken === requestToken
      ? { settings: result.settings || allowed, lastError: null }
      : {},
  );
}

async function processCompositorState(message) {
  const verification = message?.verification;
  const now = Date.now();
  const senderAttached = verification?.senderAttached === true;
  const framesComposited = Math.max(0, Number(verification?.framesComposited) || 0);
  const framesEncoded = Math.max(0, Number(verification?.framesEncoded) || 0);
  const bytesSent = Math.max(0, Number(verification?.bytesSent) || 0);
  const lastCompositeAt = Math.max(0, Number(verification?.lastCompositeAt) || 0);
  const lastSenderVerifiedAt = Math.max(0, Number(verification?.lastVerifiedAt) || 0);
  const freshTimestamp = (value, reference = now) =>
    value > 0 &&
    value <= reference + 1_000 &&
    reference - value <= LIVE_VERIFICATION_FRESHNESS_MS;
  let attempt = null;
  await saveState((state) => {
    const meetingSessionId = state.diagnostics.meetingSessionId;
    const liveVerified = Boolean(
      meetingSessionId &&
      state.diagnostics.meetingDetected &&
      state.diagnostics.engineMounted &&
      state.consented &&
      state.entitled &&
      state.policy.allowed &&
      state.policy.cameraEnabled !== false &&
      state.settings.overlayEnabled !== false &&
      state.settings.videoEnabled !== false &&
      message?.engaged === true &&
      senderAttached &&
      framesComposited > 0 &&
      framesEncoded > 0 &&
      bytesSent > 0 &&
      freshTimestamp(lastCompositeAt) &&
      freshTimestamp(lastSenderVerifiedAt) &&
      lastSenderVerifiedAt >= lastCompositeAt,
    );
    if (
      liveVerified &&
      state.installationToken &&
      timestampInFuture(state.statusValidUntil) &&
      timestampInFuture(state.tokenExpiresAt) &&
      !(state.preflightComplete && state.verifiedMeetingSessionId === meetingSessionId)
    ) {
      attempt = {
        installationId: state.installationId,
        installationToken: state.installationToken,
        meetingSessionId,
      };
    }
    return {
      ...(liveVerified
        ? {
            verifiedMeetingSessionId: meetingSessionId,
            verificationExpiresAt: new Date(now + LIVE_VERIFICATION_FRESHNESS_MS).toISOString(),
            lastVerifiedAt: new Date(now).toISOString(),
          }
        : {
            preflightComplete: false,
            verificationExpiresAt: null,
          }),
      diagnostics: {
        armed: message?.armed === true,
        engaged: message?.engaged === true,
        senderAttached,
        framesComposited,
        framesEncoded,
        bytesSent,
        lastCompositeAt,
        lastSenderVerifiedAt,
        lastCompositorAt: new Date(now).toISOString(),
      },
    };
  });
  if (!attempt) return;
  const response = await fetch(`${API_URL}/integrations/extension/preflight-complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${attempt.installationToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      senderAttached: true,
      framesComposited,
      framesEncoded,
      bytesSent,
      lastCompositeAt,
      lastVerifiedAt: lastSenderVerifiedAt,
      extensionVersion: verification.extensionVersion,
      meetingSessionId: attempt.meetingSessionId,
    }),
  });
  if (response.ok) {
    await saveState((state) => {
      const sameInstallation = attempt.installationId
        ? state.installationId === attempt.installationId
        : state.installationToken === attempt.installationToken;
      const stillLive = Boolean(
        sameInstallation &&
        state.diagnostics.meetingSessionId === attempt.meetingSessionId &&
        state.diagnostics.meetingDetected &&
        state.diagnostics.engineMounted &&
        state.diagnostics.engaged &&
        state.diagnostics.senderAttached &&
        state.diagnostics.framesComposited > 0 &&
        state.diagnostics.framesEncoded > 0 &&
        state.diagnostics.bytesSent > 0 &&
        freshTimestamp(state.diagnostics.lastCompositeAt, Date.now()) &&
        freshTimestamp(state.diagnostics.lastSenderVerifiedAt, Date.now()) &&
        state.diagnostics.lastSenderVerifiedAt >= state.diagnostics.lastCompositeAt &&
        state.consented &&
        state.entitled &&
        state.policy.allowed &&
        state.policy.cameraEnabled !== false &&
        state.settings.overlayEnabled !== false &&
        state.settings.videoEnabled !== false &&
        timestampInFuture(state.statusValidUntil) &&
        timestampInFuture(state.tokenExpiresAt),
      );
      return stillLive
        ? {
            preflightComplete: true,
            verifiedMeetingSessionId: attempt.meetingSessionId,
            verificationExpiresAt: new Date(Date.now() + LIVE_VERIFICATION_FRESHNESS_MS).toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            lastError: null,
          }
        : {};
    });
  } else {
    await saveState((state) => {
      const sameInstallation = attempt.installationId
        ? state.installationId === attempt.installationId
        : state.installationToken === attempt.installationToken;
      return sameInstallation &&
        state.diagnostics.meetingSessionId === attempt.meetingSessionId
        ? { preflightComplete: false, lastError: `PREFLIGHT_${response.status}` }
        : {};
    });
  }
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN";
}
