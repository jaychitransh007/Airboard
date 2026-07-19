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
//                | start-audio | stop-audio
//   host -> frame: ready | frame {id, bitmap} | audio-chunk {seq, sampleRate, samples}
//                | ended {reason, channel} | error {message, channel}

"use strict";

const MARKER = "airboard-media-bridge";
const VERSION = 1;

// Frames are only ever streamed to these Airboard origins.
const ALLOWED_ORIGINS = new Set([
  "https://airboard-pilot-web-634900453473.asia-south1.run.app",
  "https://airboard-pilot-web-efs77okmmq-el.a.run.app",
  "http://localhost:3000",
  "http://127.0.0.1:3100",
]);

const MAX_IN_FLIGHT = 2;
const ENGINE_HOST_ID = "airboard-overlay-engine-host";
const MEETING_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i;

/** @type {{sourceWin: MessageEventSource, origin: string, stream: MediaStream, video: HTMLVideoElement, inFlight: number, nextId: number, stopped: boolean} | null} */
let active = null;
/** @type {{sourceWin: MessageEventSource, origin: string, stream: MediaStream, reader: ReadableStreamDefaultReader | null, stopped: boolean} | null} */
let activeAudio = null;
let extensionState = {
  linked: false,
  consented: false,
  entitled: false,
  settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
};
let lastMeetContext = "";

function reportMeetContext(error) {
  const next = JSON.stringify({
    meetingDetected: isMeetingPage(),
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

function removeOverlayEngine() {
  document.getElementById(ENGINE_HOST_ID)?.remove();
  stopActive("meeting-left", true);
  stopActiveAudio("meeting-left", true);
  reportMeetContext();
}

function syncOverlayEngine() {
  const existing = document.getElementById(ENGINE_HOST_ID);
  const allowed =
    extensionState.linked &&
    extensionState.consented &&
    extensionState.entitled &&
    extensionState.settings?.overlayEnabled !== false;
  if (!isMeetingPage() || !allowed) {
    if (existing) {
      removeOverlayEngine();
    }
    reportMeetContext();
    return;
  }
  if (existing || !document.documentElement) {
    return;
  }
  const engine = document.createElement("iframe");
  engine.id = ENGINE_HOST_ID;
  engine.src = chrome.runtime.getURL("engine.html");
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
  return Object.assign({ bridge: MARKER, v: VERSION, type }, fields);
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
  if (session.reader) {
    session.reader.cancel().catch(() => {});
  }
  session.stream.getTracks().forEach((track) => track.stop());
  if (notifyFrame) {
    post(session.sourceWin, session.origin, makeMessage("ended", { reason, channel: "audio" }));
  }
}

async function startAudio(sourceWin, origin) {
  if (!extensionState.consented || extensionState.settings?.audioEnabled === false) {
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

  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    post(sourceWin, origin, makeMessage("error", { message: "no-audio-track", channel: "audio" }));
    return;
  }

  // MediaStreamTrackProcessor reads PCM straight off the track — no
  // AudioContext, no deprecated ScriptProcessor, no worklet module to load
  // under Meet's CSP.
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const session = { sourceWin, origin, stream, reader, stopped: false };
  activeAudio = session;
  let seq = 1;
  let pending = [];
  let pendingSamples = 0;
  let sampleRate = 0;

  const flush = () => {
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
    post(
      session.sourceWin,
      session.origin,
      makeMessage("audio-chunk", { seq: seq++, sampleRate, samples: merged.buffer }),
      [merged.buffer],
    );
  };

  (async () => {
    try {
      while (!session.stopped) {
        const { value, done } = await reader.read();
        if (done || session.stopped) {
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
    flush();
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
  if (!extensionState.consented || extensionState.settings?.videoEnabled === false) {
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
    reportMeetContext(`camera-unavailable: ${error && error.name}`);
    post(
      sourceWin,
      origin,
      makeMessage("error", { message: `camera-unavailable: ${error && error.name}` }),
    );
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
    post(sourceWin, origin, makeMessage("error", { message: "video-start-failed" }));
    return;
  }

  const session = { sourceWin, origin, stream, video, inFlight: 0, nextId: 1, stopped: false };
  active = session;

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
      createImageBitmap(video, { resizeWidth: width, resizeHeight: height })
        .then((bitmap) => {
          if (session.stopped) {
            bitmap.close();
            return;
          }
          post(session.sourceWin, session.origin, makeMessage("frame", { id, bitmap }), [bitmap]);
        })
        .catch(() => {
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
  if (!ALLOWED_ORIGINS.has(event.origin) || !event.source || event.source === window) {
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
    if (active && event.source === active.sourceWin) {
      active.inFlight = Math.max(0, active.inFlight - 1);
    }
    return;
  }
  if (data.type === "stop-video") {
    if (active && event.source === active.sourceWin) {
      stopActive("stopped", false);
    }
    return;
  }
  if (data.type === "start-audio") {
    void startAudio(event.source, event.origin);
    return;
  }
  if (data.type === "stop-audio") {
    if (activeAudio && event.source === activeAudio.sourceWin) {
      stopActiveAudio("stopped", false);
    }
  }
});

window.addEventListener("pagehide", () => {
  document.getElementById(ENGINE_HOST_ID)?.remove();
  stopActive("page-hidden", true);
  stopActiveAudio("page-hidden", true);
  reportMeetContext();
});
