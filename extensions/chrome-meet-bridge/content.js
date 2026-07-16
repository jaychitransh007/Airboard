// Airboard Meet Media Bridge — content script on meet.google.com.
//
// The Airboard add-on runs in a cross-origin iframe that Google does not
// delegate camera permission to, so it can never capture video itself. This
// script runs in the Meet page — the origin the user already granted camera
// access to — and, only when the Airboard frame asks (an explicit click inside
// Airboard), captures the camera here and streams downscaled frames into the
// Airboard frame as transferable ImageBitmaps. Chrome's camera indicator is
// visible for the whole session; stopping in Airboard stops capture here.
//
// Protocol (mirrored by apps/web/src/features/meet/meetMediaBridge.ts):
//   frame -> host: hello | start-video {maxWidth} | frame-ack {id} | stop-video
//   host -> frame: ready | frame {id, bitmap} | ended {reason} | error {message}

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

/** @type {{sourceWin: MessageEventSource, origin: string, stream: MediaStream, video: HTMLVideoElement, inFlight: number, nextId: number, stopped: boolean} | null} */
let active = null;

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
    post(session.sourceWin, session.origin, makeMessage("ended", { reason }));
  }
}

async function startVideo(sourceWin, origin, request) {
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
  }
});

window.addEventListener("pagehide", () => stopActive("page-hidden", true));
