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
  const EXTENSION_VERSION = "0.8.0";

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
    framesComposited: 0,
    lastCompositeAt: 0,
  };

  /** @type {{sourceWin: MessageEventSource, origin: string} | null} */
  let overlayClient = null;
  /** @type {Array<{stop(): void}>} */
  const pipelines = [];
  /** Track ids of composited output video, for self-view identification. */
  const outputTrackIds = new Set();
  const outputTrackInfo = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  let selfViewTimer = null;
  /** RTP senders observed through Meet's real peer connections. */
  const observedSenders = new Set();
  const replacementPending = new Set();
  let nativeReplaceTrack = null;
  let verificationTimer = null;
  const outboundVerification = {
    senderAttached: false,
    framesEncoded: 0,
    bytesSent: 0,
    lastVerifiedAt: 0,
  };

  // --- Real outbound-track verification ---------------------------------
  // The compositor being engaged only proves that Meet requested our wrapped
  // camera. Intercept sender attachment at document_start and inspect WebRTC
  // outbound stats so the Airboard frame can distinguish "prepared" from
  // "the composited track is really being encoded by this Meet client".

  function rememberSender(sender) {
    if (sender && typeof sender === "object") {
      observedSenders.add(sender);
      if (overlay.active) {
        void retrofitSender(sender);
      }
    }
  }

  const peerConnectionPrototype = window.RTCPeerConnection?.prototype;
  if (peerConnectionPrototype) {
    const originalAddTrack = peerConnectionPrototype.addTrack;
    if (typeof originalAddTrack === "function") {
      peerConnectionPrototype.addTrack = function (...args) {
        const sender = originalAddTrack.apply(this, args);
        rememberSender(sender);
        return sender;
      };
    }
    const originalAddTransceiver = peerConnectionPrototype.addTransceiver;
    if (typeof originalAddTransceiver === "function") {
      peerConnectionPrototype.addTransceiver = function (...args) {
        const transceiver = originalAddTransceiver.apply(this, args);
        rememberSender(transceiver?.sender);
        return transceiver;
      };
    }
  }

  const senderPrototype = window.RTCRtpSender?.prototype;
  if (senderPrototype && typeof senderPrototype.replaceTrack === "function") {
    const originalReplaceTrack = senderPrototype.replaceTrack;
    nativeReplaceTrack = originalReplaceTrack;
    senderPrototype.replaceTrack = function (...args) {
      const result = originalReplaceTrack.apply(this, args);
      Promise.resolve(result).then(() => rememberSender(this)).catch(() => {});
      return result;
    };
  }

  async function refreshOutboundVerification() {
    const attached = [...observedSenders].filter((sender) => {
      try {
        return sender.track && outputTrackIds.has(sender.track.id);
      } catch {
        return false;
      }
    });
    outboundVerification.senderAttached = attached.length > 0;
    let framesEncoded = 0;
    let bytesSent = 0;
    for (const sender of attached) {
      if (typeof sender.getStats !== "function") {
        continue;
      }
      try {
        const report = await sender.getStats();
        report.forEach((stat) => {
          if (stat.type === "outbound-rtp" && (stat.kind === "video" || stat.mediaType === "video")) {
            framesEncoded += Number(stat.framesEncoded) || 0;
            bytesSent += Number(stat.bytesSent) || 0;
          }
        });
      } catch {
        // Stats can be unavailable during renegotiation; retry next tick.
      }
    }
    outboundVerification.framesEncoded = framesEncoded;
    outboundVerification.bytesSent = bytesSent;
    if (attached.length > 0 && framesEncoded > 0 && bytesSent > 0) {
      outboundVerification.lastVerifiedAt = Date.now();
    }
    sendState();
  }

  function updateVerificationWatcher() {
    const shouldRun = pipelines.length > 0;
    if (shouldRun && verificationTimer === null) {
      void refreshOutboundVerification();
      verificationTimer = setInterval(() => void refreshOutboundVerification(), 1000);
    } else if (!shouldRun && verificationTimer !== null) {
      clearInterval(verificationTimer);
      verificationTimer = null;
      outboundVerification.senderAttached = false;
      sendState();
    }
  }

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
      // First-install default: Airboard owns the outgoing camera composite as
      // soon as Meet asks for a video track. An explicit future setting of
      // "off" remains authoritative.
      // Media replacement is inert until the consented extension engine sends
      // overlay-start. A remembered explicit "on" survives normal Meet reloads.
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
      makeMessage("overlay-state", {
        armed: isArmed(),
        engaged: pipelines.length > 0,
        verification: {
          extensionVersion: EXTENSION_VERSION,
          framesComposited: overlay.framesComposited,
          lastCompositeAt: overlay.lastCompositeAt,
          senderAttached: outboundVerification.senderAttached,
          framesEncoded: outboundVerification.framesEncoded,
          bytesSent: outboundVerification.bytesSent,
          lastVerifiedAt: outboundVerification.lastVerifiedAt,
        },
      }),
    );
  }

  function makeCompositedStream(cameraStream, options = {}) {
    const sourceTrack = cameraStream.getVideoTracks()[0];
    if (!sourceTrack) {
      return { stream: cameraStream, pipeline: null };
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([sourceTrack]);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return { stream: cameraStream, pipeline: null };
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
            overlay.framesComposited += 1;
            overlay.lastCompositeAt = Date.now();
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
      stop(preserveSource = false) {
        if (stopped) {
          return;
        }
        stopped = true;
        if (!preserveSource && options.stopSource !== false) {
          sourceTrack.stop();
        }
        video.srcObject = null;
        if (outputTrackId) {
          outputTrackIds.delete(outputTrackId);
          outputTrackInfo.delete(outputTrackId);
        }
        const index = pipelines.indexOf(pipeline);
        if (index >= 0) {
          pipelines.splice(index, 1);
        }
        updateSelfViewWatcher();
        updateVerificationWatcher();
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
      outputTrackInfo.set(outputTrackId, { sourceTrack, pipeline, stopOutput: originalStop });
      outputTrack.stop = () => {
        pipeline.stop();
        originalStop();
      };
    }
    updateSelfViewWatcher();
    updateVerificationWatcher();
    sourceTrack.addEventListener("ended", () => {
      pipeline.stop();
      if (outputTrack) {
        outputTrack.stop();
      }
    });

    return { stream: output, pipeline };
  }

  async function retrofitSender(sender) {
    if (!overlay.active || !nativeReplaceTrack || replacementPending.has(sender)) return;
    let track;
    try {
      track = sender.track;
    } catch {
      return;
    }
    if (!track || track.kind === "audio" || outputTrackIds.has(track.id)) return;
    replacementPending.add(sender);
    let composed = null;
    try {
      composed = makeCompositedStream(new MediaStream([track]), { stopSource: false });
      const outputTrack = composed.stream.getVideoTracks()[0];
      if (!composed.pipeline || !outputTrack) return;
      await nativeReplaceTrack.call(sender, outputTrack);
      sendState();
    } catch {
      composed?.pipeline?.stop(true);
    } finally {
      replacementPending.delete(sender);
    }
  }

  async function retrofitObservedSenders() {
    await Promise.all([...observedSenders].map((sender) => retrofitSender(sender)));
  }

  async function restoreObservedSenders() {
    if (!nativeReplaceTrack) return;
    const restorations = [];
    for (const sender of observedSenders) {
      let info;
      try {
        info = sender.track ? outputTrackInfo.get(sender.track.id) : null;
      } catch {
        info = null;
      }
      if (!info) continue;
      restorations.push(
        Promise.resolve(nativeReplaceTrack.call(sender, info.sourceTrack))
          .catch(() => undefined)
          .finally(() => {
            info.pipeline.stop(true);
            info.stopOutput();
          }),
      );
    }
    await Promise.all(restorations);
    sendState();
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
        return makeCompositedStream(stream).stream;
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
      overlay.framesComposited = 0;
      overlay.lastCompositeAt = 0;
      outboundVerification.framesEncoded = 0;
      outboundVerification.bytesSent = 0;
      outboundVerification.lastVerifiedAt = 0;
      syncSelfViewMirror();
      sendState();
      void retrofitObservedSenders();
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
      void restoreObservedSenders();
      if (overlay.bitmap) {
        overlay.bitmap.close();
        overlay.bitmap = null;
      }
      syncSelfViewMirror();
      sendState();
    }
  });
})();
