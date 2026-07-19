"use strict";

// The extension-owned page is a deliberate trust-boundary relay. The Airboard
// renderer is nested inside this page, while the media/compositor hooks run in
// Meet. Messages never broadcast with a wildcard target origin.
const MARKER = "airboard-media-bridge";
const VERSION = 1;
const MEET_ORIGIN = "https://meet.google.com";
const AIRBOARD_ORIGINS = new Set([
  "https://airboard-pilot-web-634900453473.asia-south1.run.app",
  "https://airboard-pilot-web-efs77okmmq-el.a.run.app",
  "http://localhost:3000",
  "http://127.0.0.1:3100",
]);
const engine = document.getElementById("airboard-engine-frame");

engine.addEventListener("load", () => {
  chrome.storage.local.get("airboardState").then(({ airboardState }) => {
    if (typeof airboardState?.installationToken === "string") {
      engine.contentWindow?.postMessage(
        {
          bridge: "airboard-extension-auth",
          v: 1,
          type: "installation-token",
          token: airboardState.installationToken,
        },
        [...AIRBOARD_ORIGINS][0],
      );
    }
  });
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.bridge !== MARKER || data.v !== VERSION) return;
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
    engine.contentWindow?.postMessage(data, [...AIRBOARD_ORIGINS][0]);
  }
});
