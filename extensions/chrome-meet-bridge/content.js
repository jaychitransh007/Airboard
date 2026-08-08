// Airboard Meet Media Bridge — content script on meet.google.com.
//
// The Airboard add-on runs in a cross-origin iframe that Google does not
// delegate camera permission to, so it can never capture video itself. This
// script runs in the Meet page — the origin the user already granted camera
// access to. On a meeting URL it mounts an invisible, extension-owned Airboard
// engine and streams downscaled camera frames plus microphone PCM into it. The
// visible result is only Meet's camera tile with the neon board composited on
// top; no Airboard main-stage activity is required.
//
// Protocol (mirrored by apps/web/src/features/meet/meetMediaBridge.ts):
//   frame -> host: hello | start-video {maxWidth} | frame-ack {id} | stop-video
//                | start-audio | audio-ack {seq} | stop-audio
//   host -> frame: ready | frame {id, bitmap} | audio-chunk {seq, sampleRate, samples}
//                | ended {reason, channel} | error {message, channel}

"use strict";

const MARKER = "airboard-media-bridge";
const VERSION = 1;

const MAX_IN_FLIGHT = 2;
const ENGINE_HOST_ID = "airboard-overlay-engine-host";
const ENGINE_RELAY_URL = chrome.runtime.getURL("engine.html");
const MEET_ORIGIN = "https://meet.google.com";
const COMPOSITOR_TEARDOWN_TIMEOUT_MS = 750;
const RELAY_ACTIVITY_TIMEOUT_MS = 30_000;
const RELAY_STALE_CONFIRMATION_MS = 5_000;
const RELAY_NONCE_PARAMETER = "airboardRelayNonce";
const RELAY_NONCE_PATTERN = /^[0-9a-f]{64}$/;
const ENGINE_RELAY_ORIGIN = ENGINE_RELAY_URL.match(
  /^(chrome-extension:\/\/[a-p]{32})\/engine\.html$/,
)?.[1];
const MEETING_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i;

if (!ENGINE_RELAY_ORIGIN) {
  throw new Error("AIRBOARD_ENGINE_RELAY_URL_INVALID");
}

/** @type {{sourceWin: MessageEventSource, origin: string, stream: MediaStream, video: HTMLVideoElement, inFlight: number, pendingIds: Set<number>, nextId: number, stopped: boolean} | null} */
let active = null;
/** @type {{sourceWin: MessageEventSource, origin: string, stream: MediaStream, reader: ReadableStreamDefaultReader | null, lastSentSeq: number, lastAckSeq: number, stopped: boolean} | null} */
let activeAudio = null;
let extensionState = {
  linked: false,
  consented: false,
  entitled: false,
  settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
};
let lastMeetContext = "";
let meetingSessionPath = "";
let meetingSessionId = null;
let engineRelayNonce = null;
let videoBlockedRelayNonce = null;
let engineRemovalPromise = null;
let videoGeneration = 0;
let audioGeneration = 0;
let lastVideoRelayActivityAt = 0;
let lastAudioRelayActivityAt = 0;
let videoRelayStaleObservedAt = 0;
let audioRelayStaleObservedAt = 0;
const pendingCompositorTeardowns = new Map();

function generateRelayNonce() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function relayNonceFromUrl(value) {
  try {
    const url = new URL(value);
    const origin = `${url.protocol}//${url.host}`;
    if (
      url.protocol !== "chrome-extension:" ||
      origin !== ENGINE_RELAY_ORIGIN ||
      url.pathname !== "/engine.html" ||
      url.search
    ) {
      return null;
    }
    const parameters = new URLSearchParams(url.hash.slice(1));
    const nonce = parameters.get(RELAY_NONCE_PARAMETER);
    return RELAY_NONCE_PATTERN.test(nonce || "") ? nonce : null;
  } catch {
    return null;
  }
}

function relayUrl(nonce) {
  const url = new URL(ENGINE_RELAY_URL);
  url.hash = new URLSearchParams({ [RELAY_NONCE_PARAMETER]: nonce }).toString();
  return url.toString();
}

function currentMeetingSessionId() {
  if (!isMeetingPage()) {
    meetingSessionPath = "";
    meetingSessionId = null;
    return null;
  }
  if (meetingSessionPath !== window.location.pathname || !meetingSessionId) {
    meetingSessionPath = window.location.pathname;
    meetingSessionId = globalThis.crypto?.randomUUID?.() ?? `meet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return meetingSessionId;
}

function reportMeetContext(error) {
  const next = JSON.stringify({
    meetingDetected: isMeetingPage(),
    meetingSessionId: currentMeetingSessionId(),
    engineMounted: Boolean(document.getElementById(ENGINE_HOST_ID)),
    error: error || null,
  });
  if (next === lastMeetContext) return;
  lastMeetContext = next;
  chrome.runtime.sendMessage({ type: "AIRBOARD_MEET_CONTEXT", ...JSON.parse(next) }).catch(() => {});
}

function isMeetingPage() {
  return MEETING_PATH.test(window.location.pathname);
}

function isTrustedEngineRelay(event) {
  const engine = document.getElementById(ENGINE_HOST_ID);
  const mountedNonce = engine ? relayNonceFromUrl(engine.src) : null;
  return Boolean(
    engine?.contentWindow &&
    event.source === engine.contentWindow &&
    event.origin === ENGINE_RELAY_ORIGIN &&
    mountedNonce &&
    mountedNonce === engineRelayNonce &&
    event.data?.relayNonce === mountedNonce,
  );
}

function requestCompositorTeardown(relayNonce, reason) {
  if (
    !RELAY_NONCE_PATTERN.test(relayNonce || "") ||
    typeof window.postMessage !== "function"
  ) {
    return Promise.resolve(false);
  }
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCompositorTeardowns.delete(requestId);
      resolve(false);
    }, COMPOSITOR_TEARDOWN_TIMEOUT_MS);
    pendingCompositorTeardowns.set(requestId, {
      relayNonce,
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
    });
    window.postMessage(
      {
        bridge: MARKER,
        v: VERSION,
        type: "overlay-teardown-request",
        relayNonce,
        requestId,
        reason,
      },
      MEET_ORIGIN,
    );
  });
}

function cancelVideoCapture(reason, notifyFrame) {
  videoGeneration += 1;
  stopActive(reason, notifyFrame);
}

function cancelAudioCapture(reason, notifyFrame) {
  audioGeneration += 1;
  stopActiveAudio(reason, notifyFrame);
}

function markCaptureRelayActivity(channel) {
  if (channel === "audio") {
    lastAudioRelayActivityAt = Date.now();
    audioRelayStaleObservedAt = 0;
  } else {
    lastVideoRelayActivityAt = Date.now();
    videoRelayStaleObservedAt = 0;
  }
}

function captureRelayIsConfirmedStale(channel, now) {
  const session = channel === "audio" ? activeAudio : active;
  if (!session) {
    if (channel === "audio") {
      audioRelayStaleObservedAt = 0;
    } else {
      videoRelayStaleObservedAt = 0;
    }
    return false;
  }
  const lastActivityAt =
    channel === "audio" ? lastAudioRelayActivityAt : lastVideoRelayActivityAt;
  if (lastActivityAt > 0 && now - lastActivityAt <= RELAY_ACTIVITY_TIMEOUT_MS) {
    if (channel === "audio") {
      audioRelayStaleObservedAt = 0;
    } else {
      videoRelayStaleObservedAt = 0;
    }
    return false;
  }
  const firstStaleAt =
    channel === "audio" ? audioRelayStaleObservedAt : videoRelayStaleObservedAt;
  if (firstStaleAt === 0) {
    if (channel === "audio") {
      audioRelayStaleObservedAt = now;
    } else {
      videoRelayStaleObservedAt = now;
    }
    return false;
  }
  return now - firstStaleAt >= RELAY_STALE_CONFIRMATION_MS;
}

function recoverDeadCaptureRelay() {
  const now = Date.now();
  if (
    captureRelayIsConfirmedStale("video", now) ||
    captureRelayIsConfirmedStale("audio", now)
  ) {
    void removeOverlayEngine("relay-unresponsive");
    return true;
  }
  return false;
}

function removeOverlayEngine(reason = "meeting-left") {
  if (engineRemovalPromise) {
    return engineRemovalPromise;
  }
  const engine = document.getElementById(ENGINE_HOST_ID);
  const relayNonce = engine ? relayNonceFromUrl(engine.src) : engineRelayNonce;
  cancelVideoCapture(reason, true);
  cancelAudioCapture(reason, true);
  if (!engine) {
    engineRelayNonce = null;
    videoBlockedRelayNonce = null;
    reportMeetContext();
    return Promise.resolve();
  }
  engineRemovalPromise = requestCompositorTeardown(relayNonce, reason)
    .catch(() => false)
    .then(() => {
      if (document.getElementById(ENGINE_HOST_ID) === engine) {
        engine.remove();
      }
      if (engineRelayNonce === relayNonce) {
        engineRelayNonce = null;
      }
      if (videoBlockedRelayNonce === relayNonce) {
        videoBlockedRelayNonce = null;
      }
      reportMeetContext();
    })
    .finally(() => {
      engineRemovalPromise = null;
      syncOverlayEngine();
    });
  return engineRemovalPromise;
}

function syncOverlayEngine() {
  if (engineRemovalPromise) {
    return;
  }
  const existing = document.getElementById(ENGINE_HOST_ID);
  const allowed =
    extensionState.linked &&
    extensionState.consented &&
    extensionState.entitled &&
    extensionState.settings?.overlayEnabled !== false &&
    (extensionState.settings?.videoEnabled !== false ||
      extensionState.settings?.audioEnabled !== false);
  if (extensionState.settings?.audioEnabled === false) {
    cancelAudioCapture("audio-disabled-by-user", true);
  }
  if (extensionState.settings?.videoEnabled === false) {
    cancelVideoCapture("video-disabled-by-user", true);
  }
  if (!isMeetingPage() || !allowed) {
    if (existing) {
      void removeOverlayEngine(!isMeetingPage() ? "meeting-left" : "video-disabled-by-user");
    } else {
      cancelVideoCapture("meeting-left", true);
      cancelAudioCapture("meeting-left", true);
      engineRelayNonce = null;
      videoBlockedRelayNonce = null;
    }
    reportMeetContext();
    return;
  }
  if (!document.documentElement) {
    return;
  }
  if (existing) {
    const mountedNonce = relayNonceFromUrl(existing.src);
    if (mountedNonce && mountedNonce === engineRelayNonce) {
      if (recoverDeadCaptureRelay()) {
        return;
      }
      if (extensionState.settings?.videoEnabled === false) {
        if (videoBlockedRelayNonce !== mountedNonce) {
          videoBlockedRelayNonce = mountedNonce;
          void requestCompositorTeardown(mountedNonce, "video-disabled-by-user");
        }
        reportMeetContext();
        return;
      }
      if (videoBlockedRelayNonce === mountedNonce) {
        // A compositor teardown is terminal for its nonce. Re-enabling video
        // gets a new relay identity so a delayed old renderer cannot re-arm it.
        void removeOverlayEngine("video-reenabled");
        return;
      }
      reportMeetContext();
      return;
    }
    void removeOverlayEngine("engine-replaced");
    return;
  }
  // A missing engine means any old WindowProxy-owned sessions are stale. A
  // fresh nonce/frame must never inherit capture started by the previous one.
  cancelVideoCapture("engine-replaced", true);
  cancelAudioCapture("engine-replaced", true);
  try {
    engineRelayNonce = generateRelayNonce();
    videoBlockedRelayNonce = null;
  } catch {
    engineRelayNonce = null;
    reportMeetContext("secure-relay-nonce-unavailable");
    return;
  }
  const engine = document.createElement("iframe");
  engine.id = ENGINE_HOST_ID;
  engine.src = relayUrl(engineRelayNonce);
  engine.title = "Airboard camera overlay engine";
  engine.setAttribute("aria-hidden", "true");
  engine.tabIndex = -1;
  Object.assign(engine.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1280px",
    height: "720px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.documentElement.appendChild(engine);
  if (extensionState.settings?.videoEnabled === false) {
    videoBlockedRelayNonce = engineRelayNonce;
    void requestCompositorTeardown(engineRelayNonce, "video-disabled-by-user");
  }
  reportMeetContext();
}

// Meet changes routes without a full page load. Keep the private engine tied
// to meeting-code URLs and release both capture channels when the user leaves.
chrome.runtime.sendMessage({ type: "AIRBOARD_GET_STATE" }, (state) => {
  if (state) extensionState = state;
  syncOverlayEngine();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AIRBOARD_STATE_CHANGED" && message.state) {
    extensionState = message.state;
    syncOverlayEngine();
  }
});
setInterval(syncOverlayEngine, 1000);

// ~85ms of audio per message at 48kHz; batches the small AudioData frames
// MediaStreamTrackProcessor yields so postMessage traffic stays low.
const AUDIO_BATCH_SAMPLES = 4096;

function makeMessage(type, fields) {
  return Object.assign(
    { bridge: MARKER, v: VERSION, type },
    fields,
    engineRelayNonce ? { relayNonce: engineRelayNonce } : {},
  );
}

function post(sourceWin, origin, message, transfer) {
  try {
    sourceWin.postMessage(message, origin, transfer);
  } catch {
    // The frame may already be gone; the pagehide/ended paths clean up.
  }
}

function stopActive(reason, notifyFrame) {
  const session = active;
  if (!session || session.stopped) {
    return;
  }
  session.stopped = true;
  active = null;
  lastVideoRelayActivityAt = 0;
  videoRelayStaleObservedAt = 0;
  session.pendingIds.clear();
  session.stream.getTracks().forEach((track) => track.stop());
  session.video.srcObject = null;
  if (notifyFrame) {
    post(session.sourceWin, session.origin, makeMessage("ended", { reason, channel: "video" }));
  }
}

function stopActiveAudio(reason, notifyFrame) {
  const session = activeAudio;
  if (!session || session.stopped) {
    return;
  }
  session.stopped = true;
  activeAudio = null;
  lastAudioRelayActivityAt = 0;
  audioRelayStaleObservedAt = 0;
  if (session.reader) {
    session.reader.cancel().catch(() => {});
  }
  session.stream.getTracks().forEach((track) => track.stop());
  if (notifyFrame) {
    post(session.sourceWin, session.origin, makeMessage("ended", { reason, channel: "audio" }));
  }
}

function isCurrentCaptureClient(sourceWin, origin, channel) {
  const engine = document.getElementById(ENGINE_HOST_ID);
  const mountedNonce = engine ? relayNonceFromUrl(engine.src) : null;
  const channelEnabled = channel === "audio"
    ? extensionState.settings?.audioEnabled !== false
    : extensionState.settings?.videoEnabled !== false;
  return Boolean(
    isMeetingPage() &&
    extensionState.linked &&
    extensionState.consented &&
    extensionState.entitled &&
    extensionState.settings?.overlayEnabled !== false &&
    channelEnabled &&
    engine?.contentWindow === sourceWin &&
    origin === ENGINE_RELAY_ORIGIN &&
    mountedNonce &&
    mountedNonce === engineRelayNonce,
  );
}

async function startAudio(sourceWin, origin) {
  if (!isCurrentCaptureClient(sourceWin, origin, "audio")) {
    post(sourceWin, origin, makeMessage("error", { message: "audio-disabled-by-user", channel: "audio" }));
    return;
  }
  if (activeAudio) {
    if (activeAudio.sourceWin === sourceWin) {
      stopActiveAudio("restarted", false);
    } else {
      post(sourceWin, origin, makeMessage("error", { message: "busy", channel: "audio" }));
      return;
    }
  }
  const generation = ++audioGeneration;

  if (typeof MediaStreamTrackProcessor !== "function") {
    post(
      sourceWin,
      origin,
      makeMessage("error", { message: "audio-capture-unsupported", channel: "audio" }),
    );
    return;
  }

  let stream;
  try {
    // meet.google.com already holds the user's microphone grant; no prompt.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    if (generation !== audioGeneration || !isCurrentCaptureClient(sourceWin, origin, "audio")) {
      return;
    }
    reportMeetContext(`microphone-unavailable: ${error && error.name}`);
    post(
      sourceWin,
      origin,
      makeMessage("error", {
        message: `microphone-unavailable: ${error && error.name}`,
        channel: "audio",
      }),
    );
    return;
  }
  if (generation !== audioGeneration || !isCurrentCaptureClient(sourceWin, origin, "audio")) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    post(sourceWin, origin, makeMessage("error", { message: "no-audio-track", channel: "audio" }));
    return;
  }

  // MediaStreamTrackProcessor reads PCM straight off the track — no
  // AudioContext, no deprecated ScriptProcessor, no worklet module to load
  // under Meet's CSP.
  let reader;
  try {
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  } catch {
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    if (generation === audioGeneration && isCurrentCaptureClient(sourceWin, origin, "audio")) {
      post(
        sourceWin,
        origin,
        makeMessage("error", { message: "audio-capture-unsupported", channel: "audio" }),
      );
    }
    return;
  }
  if (generation !== audioGeneration || !isCurrentCaptureClient(sourceWin, origin, "audio")) {
    reader.cancel().catch(() => {});
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    return;
  }
  const session = {
    sourceWin,
    origin,
    stream,
    reader,
    lastSentSeq: 0,
    lastAckSeq: 0,
    stopped: false,
  };
  activeAudio = session;
  markCaptureRelayActivity("audio");
  let seq = 1;
  let pending = [];
  let pendingSamples = 0;
  let sampleRate = 0;

  const discardPending = () => {
    pending = [];
    pendingSamples = 0;
    sampleRate = 0;
  };

  const flush = () => {
    if (session.stopped) {
      discardPending();
      return;
    }
    if (pendingSamples === 0 || sampleRate === 0) {
      return;
    }
    const merged = new Float32Array(pendingSamples);
    let offset = 0;
    for (const part of pending) {
      merged.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingSamples = 0;
    const chunkSeq = seq++;
    session.lastSentSeq = chunkSeq;
    post(
      session.sourceWin,
      session.origin,
      makeMessage("audio-chunk", { seq: chunkSeq, sampleRate, samples: merged.buffer }),
      [merged.buffer],
    );
  };

  (async () => {
    let endedNaturally = false;
    try {
      while (!session.stopped) {
        const { value, done } = await reader.read();
        if (done) {
          endedNaturally = !session.stopped;
          break;
        }
        if (session.stopped) {
          if (value) {
            value.close();
          }
          break;
        }
        sampleRate = value.sampleRate;
        const samples = new Float32Array(value.numberOfFrames);
        value.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
        value.close();
        pending.push(samples);
        pendingSamples += samples.length;
        if (pendingSamples >= AUDIO_BATCH_SAMPLES) {
          flush();
        }
      }
    } catch {
      // Reader cancellation or track end; teardown below.
    }
    if (endedNaturally && !session.stopped) {
      flush();
    } else {
      discardPending();
    }
    if (activeAudio === session) {
      stopActiveAudio("microphone-ended", true);
    }
  })();

  track.addEventListener("ended", () => {
    if (activeAudio === session) {
      stopActiveAudio("microphone-ended", true);
    }
  });
}

async function startVideo(sourceWin, origin, request) {
  if (!isCurrentCaptureClient(sourceWin, origin, "video")) {
    post(sourceWin, origin, makeMessage("error", { message: "video-disabled-by-user", channel: "video" }));
    return;
  }
  if (active) {
    if (active.sourceWin === sourceWin) {
      stopActive("restarted", false);
    } else {
      post(sourceWin, origin, makeMessage("error", { message: "busy" }));
      return;
    }
  }
  const generation = ++videoGeneration;

  let stream;
  try {
    // meet.google.com already holds the user's camera grant, so this starts
    // without a prompt; Chrome shows the camera-in-use indicator throughout.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  } catch (error) {
    if (generation !== videoGeneration || !isCurrentCaptureClient(sourceWin, origin, "video")) {
      return;
    }
    reportMeetContext(`camera-unavailable: ${error && error.name}`);
    post(
      sourceWin,
      origin,
      makeMessage("error", { message: `camera-unavailable: ${error && error.name}` }),
    );
    return;
  }
  if (generation !== videoGeneration || !isCurrentCaptureClient(sourceWin, origin, "video")) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    if (generation === videoGeneration && isCurrentCaptureClient(sourceWin, origin, "video")) {
      post(sourceWin, origin, makeMessage("error", { message: "video-start-failed" }));
    }
    return;
  }
  if (generation !== videoGeneration || !isCurrentCaptureClient(sourceWin, origin, "video")) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    return;
  }

  const session = {
    sourceWin,
    origin,
    stream,
    video,
    inFlight: 0,
    pendingIds: new Set(),
    nextId: 1,
    stopped: false,
  };
  active = session;
  markCaptureRelayActivity("video");

  const maxWidth = Math.max(160, Math.min(1280, Number(request.maxWidth) || 640));
  const [track] = stream.getVideoTracks();
  if (track) {
    track.addEventListener("ended", () => {
      if (active === session) {
        stopActive("camera-ended", true);
      }
    });
  }

  const pump = () => {
    if (session.stopped) {
      return;
    }
    if (session.inFlight < MAX_IN_FLIGHT && video.videoWidth > 0) {
      const width = Math.min(maxWidth, video.videoWidth);
      const height = Math.round((video.videoHeight * width) / video.videoWidth);
      session.inFlight += 1;
      const id = session.nextId++;
      session.pendingIds.add(id);
      createImageBitmap(video, { resizeWidth: width, resizeHeight: height })
        .then((bitmap) => {
          if (session.stopped) {
            session.pendingIds.delete(id);
            bitmap.close();
            return;
          }
          post(session.sourceWin, session.origin, makeMessage("frame", { id, bitmap }), [bitmap]);
        })
        .catch(() => {
          session.pendingIds.delete(id);
          session.inFlight = Math.max(0, session.inFlight - 1);
        });
    }
    video.requestVideoFrameCallback(pump);
  };
  video.requestVideoFrameCallback(pump);
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.bridge !== MARKER || data.v !== VERSION) {
    return;
  }
  if (
    data.type === "overlay-teardown-ack" &&
    event.source === window &&
    event.origin === MEET_ORIGIN &&
    typeof data.requestId === "string"
  ) {
    const pending = pendingCompositorTeardowns.get(data.requestId);
    if (pending && data.relayNonce === pending.relayNonce) {
      pendingCompositorTeardowns.delete(data.requestId);
      pending.resolve(true);
    }
    return;
  }
  if (!isTrustedEngineRelay(event)) {
    return;
  }
  if (data.type === "hello") {
    post(event.source, event.origin, makeMessage("ready"));
    return;
  }
  if (data.type === "start-video") {
    void startVideo(event.source, event.origin, data);
    return;
  }
  if (data.type === "frame-ack") {
    const id = Number(data.id);
    if (
      active &&
      event.source === active.sourceWin &&
      Number.isInteger(id) &&
      active.pendingIds.delete(id)
    ) {
      active.inFlight = Math.max(0, active.inFlight - 1);
      markCaptureRelayActivity("video");
    }
    return;
  }
  if (data.type === "stop-video") {
    cancelVideoCapture("stopped", false);
    return;
  }
  if (data.type === "start-audio") {
    void startAudio(event.source, event.origin);
    return;
  }
  if (data.type === "audio-ack") {
    const seq = Number(data.seq);
    if (
      activeAudio &&
      event.source === activeAudio.sourceWin &&
      Number.isInteger(seq) &&
      seq > activeAudio.lastAckSeq &&
      seq <= activeAudio.lastSentSeq
    ) {
      activeAudio.lastAckSeq = seq;
      markCaptureRelayActivity("audio");
    }
    return;
  }
  if (data.type === "stop-audio") {
    cancelAudioCapture("stopped", false);
  }
});

window.addEventListener("pagehide", () => {
  const engine = document.getElementById(ENGINE_HOST_ID);
  const relayNonce = engine ? relayNonceFromUrl(engine.src) : engineRelayNonce;
  void requestCompositorTeardown(relayNonce, "page-hidden");
  cancelVideoCapture("page-hidden", true);
  cancelAudioCapture("page-hidden", true);
  engine?.remove();
  engineRelayNonce = null;
  videoBlockedRelayNonce = null;
  reportMeetContext();
});
