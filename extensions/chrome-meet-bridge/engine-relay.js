"use strict";

// The extension-owned page is a deliberate trust-boundary relay. The Airboard
// renderer is nested inside this page, while the media/compositor hooks run in
// Meet. Messages never broadcast with a wildcard target origin.
const MARKER = "airboard-media-bridge";
const VERSION = 1;
const MEET_ORIGIN = "https://meet.google.com";
const RELAY_NONCE_PARAMETER = "airboardRelayNonce";
const RELAY_NONCE_PATTERN = /^[0-9a-f]{64}$/;
const AIRBOARD_ORIGINS = new Set([
  "https://airboard-pilot-web-634900453473.asia-south1.run.app",
  "https://airboard-pilot-web-efs77okmmq-el.a.run.app",
  "http://localhost:3000",
  "http://127.0.0.1:3100",
]);
const engine = document.getElementById("airboard-engine-frame");
const relayNonce = new URLSearchParams(window.location.hash.slice(1)).get(
  RELAY_NONCE_PARAMETER,
);

if (!RELAY_NONCE_PATTERN.test(relayNonce || "")) {
  throw new Error("AIRBOARD_RELAY_NONCE_INVALID");
}

const configuredEngineSrc = engine.dataset?.engineSrc ?? engine.getAttribute("data-engine-src");
const engineUrl = new URL(configuredEngineSrc);
const engineOrigin = engineUrl.origin;

if (!AIRBOARD_ORIGINS.has(engineOrigin)) {
  throw new Error("AIRBOARD_ENGINE_ORIGIN_NOT_ALLOWED");
}

engineUrl.hash = new URLSearchParams({ [RELAY_NONCE_PARAMETER]: relayNonce }).toString();

function postInstallationToken(airboardState) {
  engine.contentWindow?.postMessage(
    {
      bridge: "airboard-extension-auth",
      v: 1,
      type: "installation-token",
      relayNonce,
      token:
        typeof airboardState?.installationToken === "string"
          ? airboardState.installationToken
          : null,
    },
    engineOrigin,
  );
}

engine.addEventListener("load", () => {
  chrome.storage.local.get("airboardState").then(({ airboardState }) => {
    postInstallationToken(airboardState);
  });
});
engine.src = engineUrl.toString();

// Status refresh rotates the scoped installation credential. Keep the
// already-running renderer synchronized so opening the popup mid-meeting does
// not strand board, transcription, or semantic requests on the old token.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.airboardState) {
    postInstallationToken(changes.airboardState.newValue);
  }
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    data?.bridge === "airboard-extension-auth" &&
    data.v === 1 &&
    data.type === "installation-token-request" &&
    data.relayNonce === relayNonce &&
    AIRBOARD_ORIGINS.has(event.origin) &&
    event.source === engine.contentWindow
  ) {
    chrome.storage.local.get("airboardState").then(({ airboardState }) => {
      postInstallationToken(airboardState);
    });
    return;
  }
  if (
    !data ||
    data.bridge !== MARKER ||
    data.v !== VERSION ||
    data.relayNonce !== relayNonce
  ) return;
  if (AIRBOARD_ORIGINS.has(event.origin) && event.source === engine.contentWindow) {
    const transfer = [];
    if (data.bitmap instanceof ImageBitmap) transfer.push(data.bitmap);
    if (data.samples instanceof ArrayBuffer) transfer.push(data.samples);
    window.parent.postMessage(data, MEET_ORIGIN, transfer);
    return;
  }
  if (event.origin === MEET_ORIGIN && event.source === window.parent) {
    if (data.type === "overlay-state") {
      chrome.runtime.sendMessage({ type: "AIRBOARD_COMPOSITOR_STATE", state: data });
    }
    engine.contentWindow?.postMessage(data, engineOrigin);
  }
});
