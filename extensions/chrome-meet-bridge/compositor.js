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
  /** Track ids of composited output video, for self-view identification. */
  const outputTrackIds = new Set();
  /** @type {ReturnType<typeof setInterval> | null} */
  let selfViewTimer = null;

  // --- Self-view counter-flip ---------------------------------------------
  // Meet force-mirrors the presenter's own tile, which would show the baked
  // overlay text backwards to the presenter alone. The tile that carries OUR
  // output track is found by track identity (robust to Meet DOM changes) and
  // its net horizontal flip is neutralized while the overlay is active, so
  // the presenter sees the exact transmitted frame.

  function netFlippedX(element) {
    let flipped = false;
    let node = element;
    while (node && node.nodeType === 1) {
      const transform = getComputedStyle(node).transform;
      if (transform && transform !== "none") {
        try {
          if (new DOMMatrixReadOnly(transform).a < 0) {
            flipped = !flipped;
          }
        } catch {
          // Unparseable transform; ignore.
        }
      }
      node = node.parentElement;
    }
    return flipped;
  }

  function isOurOutputVideo(video) {
    const stream = video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== "function") {
      return false;
    }
    try {
      return stream.getVideoTracks().some((track) => outputTrackIds.has(track.id));
    } catch {
      return false;
    }
  }

  function syncSelfViewMirror() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      const marked = video.dataset.airboardUnmirrored === "1";
      if (!isOurOutputVideo(video)) {
        if (marked) {
          video.style.transform = "";
          delete video.dataset.airboardUnmirrored;
        }
        continue;
      }
      // Measure Meet's own net flip with our correction removed, then apply
      // or clear the counter-flip in the same synchronous block (no flicker).
      const previous = video.style.transform;
      video.style.transform = "";
      const flippedByMeet = netFlippedX(video);
      if (overlay.active && flippedByMeet) {
        video.style.transform = "scaleX(-1)";
        video.dataset.airboardUnmirrored = "1";
      } else {
        if (!marked && previous) {
          video.style.transform = previous;
        } else {
          delete video.dataset.airboardUnmirrored;
        }
      }
    }
  }

  function updateSelfViewWatcher() {
    const shouldRun = pipelines.length > 0;
    if (shouldRun && selfViewTimer === null) {
      selfViewTimer = setInterval(syncSelfViewMirror, 1000);
    } else if (!shouldRun && selfViewTimer !== null) {
      clearInterval(selfViewTimer);
      selfViewTimer = null;
      syncSelfViewMirror();
    }
  }

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
        if (overlay.active) {
          // Lightboard production frame: gestures and board content are
          // authored in mirror space (selfie mapping), so the camera is
          // mirrored to match — hands align with the shapes they touch and
          // overlay text reads correctly for every viewer.
          context.save();
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          context.restore();
          if (overlay.scrim > 0) {
            context.fillStyle = `rgba(5, 8, 12, ${overlay.scrim})`;
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          if (overlay.bitmap) {
            context.drawImage(overlay.bitmap, 0, 0, canvas.width, canvas.height);
          }
        } else {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
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

    let outputTrackId = null;
    const pipeline = {
      stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        sourceTrack.stop();
        video.srcObject = null;
        if (outputTrackId) {
          outputTrackIds.delete(outputTrackId);
        }
        const index = pipelines.indexOf(pipeline);
        if (index >= 0) {
          pipelines.splice(index, 1);
        }
        updateSelfViewWatcher();
        sendState();
      },
    };
    pipelines.push(pipeline);
    sendState();

    // Meet stopping the composited track must release the real camera, and
    // the real camera ending must end the composited track.
    const outputTrack = output.getVideoTracks()[0];
    if (outputTrack) {
      outputTrackId = outputTrack.id;
      outputTrackIds.add(outputTrackId);
      const originalStop = outputTrack.stop.bind(outputTrack);
      outputTrack.stop = () => {
        pipeline.stop();
        originalStop();
      };
    }
    updateSelfViewWatcher();
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
      syncSelfViewMirror();
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
      syncSelfViewMirror();
      sendState();
    }
  });
})();
