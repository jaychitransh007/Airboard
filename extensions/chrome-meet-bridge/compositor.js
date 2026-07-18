// Airboard Meet Media Bridge — camera compositor (MAIN world, document_start).
//
// Makes the presenter's Meet camera tile the lightboard: when armed, Meet's
// own getUserMedia receives a composited stream — real camera frames with the
// Airboard neon overlay (streamed from the add-on iframe as transparent
// ImageBitmaps) drawn on top — so every participant sees the presenter behind
// the glowing board with no tab-sharing.
//
// Runs in the page's JS world because the wrapper must intercept the same
// navigator Meet calls; it therefore has no chrome.* access and speaks only
// window.postMessage with allowlisted Airboard origins.
//
// Protocol (extends the bridge marker; the isolated-world script ignores
// overlay-* types and this script ignores everything else):
//   frame -> host: overlay-hello | overlay-start | overlay-frame {id, scrim, bitmap}
//                | overlay-stop
//   host -> frame: overlay-state {armed, engaged} | overlay-ack {id}
//
// Arming persists in meet.google.com localStorage so the wrapper knows at
// getUserMedia time (which usually happens before the add-on iframe opens).
// Enabling mid-meeting requires one Meet camera off/on cycle to engage.

"use strict";

(() => {
  const MARKER = "airboard-media-bridge";
  const VERSION = 1;
  const ARMED_KEY = "airboard.camera-overlay.v1";

  const ALLOWED_ORIGINS = new Set([
    "https://airboard-pilot-web-634900453473.asia-south1.run.app",
    "https://airboard-pilot-web-efs77okmmq-el.a.run.app",
    "http://localhost:3000",
    "http://127.0.0.1:3100",
  ]);

  const MAX_IN_FLIGHT = 2;

  /** Latest overlay content shared by every pipeline. */
  const overlay = {
    bitmap: /** @type {ImageBitmap | null} */ (null),
    scrim: 0,
    active: false,
    inFlight: 0,
  };

  /** @type {{sourceWin: MessageEventSource, origin: string} | null} */
  let overlayClient = null;
  /** @type {Array<{stop(): void}>} */
  const pipelines = [];

  function isArmed() {
    try {
      return window.localStorage.getItem(ARMED_KEY) === "on";
    } catch {
      return false;
    }
  }

  function setArmed(on) {
    try {
      window.localStorage.setItem(ARMED_KEY, on ? "on" : "off");
    } catch {
      // Storage may be unavailable; arming just won't persist.
    }
  }

  function makeMessage(type, fields) {
    return Object.assign({ bridge: MARKER, v: VERSION, type }, fields);
  }

  function postToClient(message) {
    if (!overlayClient) {
      return;
    }
    try {
      overlayClient.sourceWin.postMessage(message, overlayClient.origin);
    } catch {
      // The frame may be gone; state refreshes on the next hello.
    }
  }

  function sendState() {
    postToClient(
      makeMessage("overlay-state", { armed: isArmed(), engaged: pipelines.length > 0 }),
    );
  }

  function makeCompositedStream(cameraStream) {
    const sourceTrack = cameraStream.getVideoTracks()[0];
    if (!sourceTrack) {
      return cameraStream;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([sourceTrack]);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return cameraStream;
    }

    let stopped = false;
    const draw = () => {
      if (stopped) {
        return;
      }
      if (video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (overlay.active) {
          if (overlay.scrim > 0) {
            context.fillStyle = `rgba(5, 8, 12, ${overlay.scrim})`;
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          if (overlay.bitmap) {
            context.drawImage(overlay.bitmap, 0, 0, canvas.width, canvas.height);
          }
        }
      }
      video.requestVideoFrameCallback(draw);
    };
    video.requestVideoFrameCallback(draw);
    void video.play().catch(() => {});

    const settings = sourceTrack.getSettings ? sourceTrack.getSettings() : {};
    const output = canvas.captureStream(settings.frameRate || 30);
    for (const audioTrack of cameraStream.getAudioTracks()) {
      output.addTrack(audioTrack);
    }

    const pipeline = {
      stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        sourceTrack.stop();
        video.srcObject = null;
        const index = pipelines.indexOf(pipeline);
        if (index >= 0) {
          pipelines.splice(index, 1);
        }
        sendState();
      },
    };
    pipelines.push(pipeline);
    sendState();

    // Meet stopping the composited track must release the real camera, and
    // the real camera ending must end the composited track.
    const outputTrack = output.getVideoTracks()[0];
    if (outputTrack) {
      const originalStop = outputTrack.stop.bind(outputTrack);
      outputTrack.stop = () => {
        pipeline.stop();
        originalStop();
      };
    }
    sourceTrack.addEventListener("ended", () => {
      pipeline.stop();
      if (outputTrack) {
        outputTrack.stop();
      }
    });

    return output;
  }

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices && typeof mediaDevices.getUserMedia === "function") {
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (constraints) => {
      const stream = await originalGetUserMedia(constraints);
      if (!constraints || !constraints.video || !isArmed()) {
        return stream;
      }
      try {
        return makeCompositedStream(stream);
      } catch {
        return stream;
      }
    };
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.bridge !== MARKER || data.v !== VERSION) {
      return;
    }
    if (!ALLOWED_ORIGINS.has(event.origin) || !event.source || event.source === window) {
      return;
    }
    if (data.type === "overlay-hello") {
      overlayClient = { sourceWin: event.source, origin: event.origin };
      sendState();
      return;
    }
    if (!overlayClient || event.source !== overlayClient.sourceWin) {
      return;
    }
    if (data.type === "overlay-start") {
      setArmed(true);
      overlay.active = true;
      overlay.inFlight = 0;
      sendState();
      return;
    }
    if (data.type === "overlay-frame") {
      const bitmap = data.bitmap;
      postToClient(makeMessage("overlay-ack", { id: data.id }));
      if (!overlay.active || !(bitmap instanceof ImageBitmap)) {
        if (bitmap && typeof bitmap.close === "function") {
          bitmap.close();
        }
        return;
      }
      if (overlay.bitmap) {
        overlay.bitmap.close();
      }
      overlay.bitmap = bitmap;
      overlay.scrim = Math.min(1, Math.max(0, Number(data.scrim) || 0));
      return;
    }
    if (data.type === "overlay-stop") {
      setArmed(false);
      overlay.active = false;
      if (overlay.bitmap) {
        overlay.bitmap.close();
        overlay.bitmap = null;
      }
      sendState();
    }
  });
})();
