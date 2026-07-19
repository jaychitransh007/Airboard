"use strict";

const API_URL = "https://airboard-pilot-api-634900453473.asia-south1.run.app";
const APP_URL = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const DEFAULT_STATE = {
  linked: false,
  consented: false,
  entitled: false,
  preflightComplete: false,
  installationId: null,
  settings: {
    overlayEnabled: true,
    neonTheme: true,
    videoEnabled: true,
    audioEnabled: true,
    personOcclusion: true,
  },
  installationToken: null,
  lastError: null,
  lastVerifiedAt: null,
  diagnostics: {
    meetingDetected: false,
    engineMounted: false,
    armed: false,
    engaged: false,
    senderAttached: false,
    framesEncoded: 0,
    bytesSent: 0,
    lastCompositorAt: null,
  },
  policy: { allowed: true, cameraEnabled: true, voiceEnabled: true, gestureEnabled: true },
};

chrome.runtime.onInstalled.addListener((details) => {
  void initialize().then(() => {
    chrome.runtime.setUninstallURL(`${APP_URL}/app/integrations?uninstall=chrome_meet&extensionId=${chrome.runtime.id}`);
    if (details.reason === "install") {
      chrome.tabs.create({
        url: `${APP_URL}/app/integrations?setup=chrome_meet&extensionId=${chrome.runtime.id}&version=${chrome.runtime.getManifest().version}`,
      });
    } else void refreshStatus();
  });
});

chrome.runtime.onStartup.addListener(() => void refreshStatus());

chrome.runtime.onMessageExternal.addListener((message, _sender, respond) => {
  if (message?.type === "AIRBOARD_GET_STATE") {
    void currentState().then((state) => respond(publicState(state)));
    return true;
  }
  if (message?.type === "AIRBOARD_LINK" && typeof message.linkToken === "string") {
    void exchangeLink(message.linkToken)
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ ok: false, error: safeError(error) }));
    return true;
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "AIRBOARD_GET_STATE") {
    void currentState().then(respond);
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
    void saveState({
      diagnostics: {
        meetingDetected: message.meetingDetected === true,
        engineMounted: message.engineMounted === true,
        ...(typeof message.error === "string" ? { bridgeError: message.error.slice(0, 160) } : {}),
      },
      ...(typeof message.error === "string" ? { lastError: message.error.slice(0, 160) } : {}),
    });
    return false;
  }
  return false;
});

async function initialize() {
  const stored = await chrome.storage.local.get("airboardState");
  if (!stored.airboardState) await chrome.storage.local.set({ airboardState: DEFAULT_STATE });
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

async function saveState(patch) {
  const state = await currentState();
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
}

function publicState(state) {
  const { installationToken: _token, ...safe } = state;
  return safe;
}

async function exchangeLink(linkToken) {
  const response = await fetch(`${API_URL}/integrations/extension-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkToken }),
  });
  if (!response.ok) throw new Error(`LINK_EXCHANGE_${response.status}`);
  const result = await response.json();
  await saveState({ linked: true, installationToken: result.installationToken, lastError: null });
  await refreshStatus();
}

async function refreshStatus() {
  const state = await currentState();
  if (!state.installationToken) return publicState(state);
  try {
    const response = await fetch(`${API_URL}/integrations/extension/status`, {
      headers: { Authorization: `Bearer ${state.installationToken}` },
    });
    if (!response.ok) throw new Error(`STATUS_${response.status}`);
    const result = await response.json();
    const entitlement = result.entitlement;
    const active = entitlement && ["pending", "trialing", "grace", "active"].includes(entitlement.status);
    const policy = result.policy || {};
    const allowed = !Array.isArray(policy.allowed_platforms) || policy.allowed_platforms.includes("chrome_meet");
    const serverSettings = result.installation?.settings || state.settings;
    const effectiveSettings = {
      ...state.settings,
      ...serverSettings,
      overlayEnabled: serverSettings.overlayEnabled !== false && allowed,
      videoEnabled: serverSettings.videoEnabled !== false && policy.camera_enabled !== false,
      audioEnabled: serverSettings.audioEnabled !== false && policy.voice_enabled !== false,
      personOcclusion: serverSettings.personOcclusion !== false && policy.camera_enabled !== false,
    };
    return saveState({
      linked: true,
      consented: Boolean(result.installation?.consented_at),
      entitled: Boolean(active && allowed),
      installationId: result.installation?.id || state.installationId,
      installationToken: result.installationToken || state.installationToken,
      settings: effectiveSettings,
      policy: {
        allowed,
        cameraEnabled: policy.camera_enabled !== false,
        voiceEnabled: policy.voice_enabled !== false,
        gestureEnabled: policy.gesture_enabled !== false,
      },
      lastError: result.installation?.last_error_code || null,
    });
  } catch (error) {
    const code = safeError(error);
    if (code === "STATUS_401") {
      return saveState({
        linked: false,
        consented: false,
        entitled: false,
        installationId: null,
        installationToken: null,
        lastError: "INSTALLATION_RECONNECT_REQUIRED",
      });
    }
    return saveState({ lastError: code });
  }
}

async function confirmMedia() {
  const state = await currentState();
  if (!state.installationToken) throw new Error("CONNECT_AIRBOARD_FIRST");
  const response = await fetch(`${API_URL}/integrations/extension/consent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.installationToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ camera: true, microphone: true, voiceProcessing: true }),
  });
  if (!response.ok) throw new Error(`CONSENT_${response.status}`);
  await saveState({ consented: true, lastError: null });
}

async function updateSettings(settings) {
  const allowed = {};
  for (const key of Object.keys(DEFAULT_STATE.settings)) {
    if (typeof settings?.[key] === "boolean") allowed[key] = settings[key];
  }
  const state = await currentState();
  if (!state.installationToken) throw new Error("CONNECT_AIRBOARD_FIRST");
  if (!state.policy.allowed) allowed.overlayEnabled = false;
  if (!state.policy.cameraEnabled) {
    allowed.videoEnabled = false;
    allowed.personOcclusion = false;
  }
  if (!state.policy.voiceEnabled) allowed.audioEnabled = false;
  const response = await fetch(`${API_URL}/integrations/extension/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${state.installationToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(allowed),
  });
  if (!response.ok) throw new Error(`SETTINGS_${response.status}`);
  const result = await response.json();
  return saveState({ settings: result.settings || allowed, lastError: null });
}

async function processCompositorState(message) {
  const verification = message?.verification;
  await saveState({
    diagnostics: {
      armed: message?.armed === true,
      engaged: message?.engaged === true,
      senderAttached: verification?.senderAttached === true,
      framesEncoded: Math.max(0, Number(verification?.framesEncoded) || 0),
      bytesSent: Math.max(0, Number(verification?.bytesSent) || 0),
      lastCompositorAt: new Date().toISOString(),
    },
  });
  if (!verification?.senderAttached || verification.framesEncoded <= 0 || verification.bytesSent <= 0) return;
  const state = await currentState();
  if (!state.installationToken || state.preflightComplete) return;
  const response = await fetch(`${API_URL}/integrations/extension/preflight-complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.installationToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      senderAttached: true,
      framesEncoded: verification.framesEncoded,
      bytesSent: verification.bytesSent,
      extensionVersion: verification.extensionVersion,
    }),
  });
  if (response.ok) {
    await saveState({ preflightComplete: true, entitled: true, lastVerifiedAt: new Date().toISOString(), lastError: null });
  }
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN";
}
