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
// window.postMessage with the exact extension-owned relay iframe.
//
// Protocol (extends the bridge marker; the isolated-world script ignores
// overlay-* types and this script ignores everything else):
//   frame -> host: overlay-hello | overlay-start | overlay-frame {id, scrim, bitmap}
//                | overlay-heartbeat | overlay-stop
//   host -> frame: overlay-state {armed, engaged} | overlay-ack {id}
//
// Arming persists in meet.google.com localStorage so the wrapper knows at
// getUserMedia time (which usually happens before the add-on iframe opens).
// Existing Meet senders are retrofitted in place when the overlay is enabled.

"use strict";

(() => {
  const MARKER = "airboard-media-bridge";
  const VERSION = 1;
  const ARMED_KEY = "airboard.camera-overlay.v1";
  const EXTENSION_VERSION = "0.8.0";
  const MEET_ORIGIN = "https://meet.google.com";

  const MAX_IN_FLIGHT = 2;
  const RELAY_WATCHDOG_INTERVAL_MS = 500;
  const RELAY_ACTIVITY_TIMEOUT_MS = 30_000;
  const RELAY_STALE_CONFIRMATION_MS = 2_000;
  const COMPOSITE_FRESHNESS_MS = 5_000;
  const OUTBOUND_VERIFICATION_FRESHNESS_MS = 15_000;
  const ENGINE_HOST_ID = "airboard-overlay-engine-host";
  const RELAY_NONCE_PARAMETER = "airboardRelayNonce";
  const RELAY_NONCE_PATTERN = /^[0-9a-f]{64}$/;

  /** Latest overlay content shared by every pipeline. */
  const overlay = {
    bitmap: /** @type {ImageBitmap | null} */ (null),
    scrim: 0,
    active: false,
    inFlight: 0,
    framesComposited: 0,
    lastCompositeAt: 0,
  };

  /** @type {{sourceWin: MessageEventSource, origin: string, relayNonce: string} | null} */
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
  const senderOperations = new Map();
  const senderBaselines = new Map();
  const senderExternalVersions = new Map();
  const senderExternalIntents = new Map();
  const senderLatestSuccessfulIntents = new Map();
  let nativeReplaceTrack = null;
  let verificationTimer = null;
  let overlayGeneration = 0;
  let overlayStartedAt = 0;
  let teardownPromise = null;
  let blockedRelayNonce = null;
  let lastRelayActivityAt = 0;
  let relayStaleObservedAt = 0;
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
        void retrofitSender(sender, overlayGeneration);
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
      const sender = this;
      let previousTrack = null;
      try {
        previousTrack = sender.track || null;
      } catch {
        previousTrack = null;
      }
      const previousInfo = previousTrack ? outputTrackInfo.get(previousTrack.id) ?? null : null;
      const version = (senderExternalVersions.get(sender) ?? 0) + 1;
      senderExternalVersions.set(sender, version);

      // Keep the native API contract: invoke immediately and return the exact
      // value (or synchronous throw) supplied by Chrome. The side-channel
      // intent lets Airboard's queued operations yield to this newer user/Meet
      // selection without changing replaceTrack's observable behavior.
      let result;
      try {
        result = originalReplaceTrack.apply(sender, args);
      } catch (error) {
        senderExternalIntents.set(sender, {
          version,
          targetTrack: args[0] ?? null,
          succeeded: false,
          settled: Promise.resolve(),
        });
        void enqueueSenderOperation(sender, async () => rememberSender(sender));
        throw error;
      }
      const intent = {
        version,
        targetTrack: args[0] ?? null,
        succeeded: false,
        settled: null,
      };
      intent.settled = Promise.resolve(result)
        .then(() => {
          intent.succeeded = true;
          const previousSuccessful = senderLatestSuccessfulIntents.get(sender);
          if (!previousSuccessful || previousSuccessful.version < version) {
            senderLatestSuccessfulIntents.set(sender, intent);
          }
          void enqueueSenderOperation(sender, async () => {
            await enforceLatestExternalSelection(sender);
            releaseOutputIfDetached(previousTrack, previousInfo);
            rememberSender(sender);
          });
        })
        .catch(() => {
          void enqueueSenderOperation(sender, async () => rememberSender(sender));
        });
      senderExternalIntents.set(sender, intent);
      return result;
    };
  }

  async function readOutboundSenderStats(sender) {
    if (typeof sender.getStats !== "function") {
      return null;
    }
    let framesEncoded = 0;
    let bytesSent = 0;
    let found = false;
    try {
      const report = await sender.getStats();
      report.forEach((stat) => {
        if (stat.type === "outbound-rtp" && (stat.kind === "video" || stat.mediaType === "video")) {
          found = true;
          framesEncoded += Number(stat.framesEncoded) || 0;
          bytesSent += Number(stat.bytesSent) || 0;
        }
      });
    } catch {
      return null;
    }
    return found ? { framesEncoded, bytesSent } : null;
  }

  function resetOutboundVerification() {
    senderBaselines.clear();
    outboundVerification.senderAttached = false;
    outboundVerification.framesEncoded = 0;
    outboundVerification.bytesSent = 0;
    outboundVerification.lastVerifiedAt = 0;
  }

  async function establishSenderBaseline(sender, trackId, generation) {
    const stats = await readOutboundSenderStats(sender);
    let currentTrackId = null;
    try {
      currentTrackId = sender.track?.id || null;
    } catch {
      return;
    }
    if (
      !stats ||
      !overlay.active ||
      generation !== overlayGeneration ||
      currentTrackId !== trackId
    ) {
      return;
    }
    const compositeCheckpointAt =
      overlay.lastCompositeAt >= overlayStartedAt ? overlay.lastCompositeAt : 0;
    senderBaselines.set(sender, {
      generation,
      trackId,
      ...stats,
      progressFramesEncoded: stats.framesEncoded,
      progressBytesSent: stats.bytesSent,
      compositeCheckpointAt,
    });
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
    let causalProgressObserved = false;
    let topologyReset = false;
    for (const sender of attached) {
      const stats = await readOutboundSenderStats(sender);
      if (!stats) {
        continue;
      }
      let trackId = null;
      try {
        trackId = sender.track?.id || null;
      } catch {
        continue;
      }
      const baseline = senderBaselines.get(sender);
      if (
        !trackId ||
        !baseline ||
        baseline.generation !== overlayGeneration ||
        baseline.trackId !== trackId ||
        stats.framesEncoded < baseline.framesEncoded ||
        stats.bytesSent < baseline.bytesSent
      ) {
        const compositeCheckpointAt =
          overlay.lastCompositeAt >= overlayStartedAt ? overlay.lastCompositeAt : 0;
        senderBaselines.set(sender, {
          generation: overlayGeneration,
          trackId,
          ...stats,
          progressFramesEncoded: stats.framesEncoded,
          progressBytesSent: stats.bytesSent,
          compositeCheckpointAt,
        });
        topologyReset = true;
        continue;
      }
      framesEncoded += stats.framesEncoded - baseline.framesEncoded;
      bytesSent += stats.bytesSent - baseline.bytesSent;
      if (
        baseline.compositeCheckpointAt >= overlayStartedAt &&
        stats.framesEncoded > baseline.progressFramesEncoded &&
        stats.bytesSent > baseline.progressBytesSent
      ) {
        causalProgressObserved = true;
      }

      // Every sample becomes the next causal checkpoint. A future verification
      // can advance only if RTP counters move after a composite that was already
      // present at this checkpoint; cumulative totals alone never refresh it.
      baseline.progressFramesEncoded = stats.framesEncoded;
      baseline.progressBytesSent = stats.bytesSent;
      if (overlay.lastCompositeAt >= overlayStartedAt) {
        baseline.compositeCheckpointAt = overlay.lastCompositeAt;
      }
    }
    outboundVerification.framesEncoded = framesEncoded;
    outboundVerification.bytesSent = bytesSent;
    const compositeFresh = Boolean(
      overlay.active &&
      overlay.framesComposited > 0 &&
      overlay.lastCompositeAt >= overlayStartedAt &&
      Date.now() - overlay.lastCompositeAt <= COMPOSITE_FRESHNESS_MS,
    );
    if (
      attached.length > 0 &&
      framesEncoded > 0 &&
      bytesSent > 0 &&
      compositeFresh &&
      causalProgressObserved
    ) {
      outboundVerification.lastVerifiedAt = Date.now();
    } else if (
      attached.length === 0 ||
      topologyReset ||
      !overlay.active ||
      (outboundVerification.lastVerifiedAt > 0 &&
        Date.now() - outboundVerification.lastVerifiedAt > OUTBOUND_VERIFICATION_FRESHNESS_MS)
    ) {
      outboundVerification.lastVerifiedAt = 0;
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
    return Object.assign(
      { bridge: MARKER, v: VERSION, type },
      fields,
      overlayClient?.relayNonce ? { relayNonce: overlayClient.relayNonce } : {},
    );
  }

  function currentRelayIdentity() {
    const engine = document.getElementById(ENGINE_HOST_ID);
    if (!engine?.contentWindow) {
      return null;
    }
    try {
      const relayUrl = new URL(engine.src);
      const relayNonce = new URLSearchParams(relayUrl.hash.slice(1)).get(
        RELAY_NONCE_PARAMETER,
      );
      const relayOrigin = `${relayUrl.protocol}//${relayUrl.host}`;
      if (!(
        /^chrome-extension:\/\/[a-p]{32}$/.test(relayOrigin) &&
        relayUrl.pathname === "/engine.html" &&
        !relayUrl.search &&
        RELAY_NONCE_PATTERN.test(relayNonce || "")
      )) {
        return null;
      }
      return { sourceWin: engine.contentWindow, origin: relayOrigin, relayNonce };
    } catch {
      return null;
    }
  }

  function isTrustedEngineRelay(event) {
    const identity = currentRelayIdentity();
    return Boolean(
      identity &&
      event.source === identity.sourceWin &&
      event.origin === identity.origin &&
      event.data?.relayNonce === identity.relayNonce,
    );
  }

  function isTrustedContentTeardown(event) {
    const identity = currentRelayIdentity();
    return Boolean(
      identity &&
      event.source === window &&
      event.origin === MEET_ORIGIN &&
      event.data?.type === "overlay-teardown-request" &&
      event.data?.relayNonce === identity.relayNonce &&
      typeof event.data?.requestId === "string" &&
      event.data.requestId.length > 0 &&
      event.data.requestId.length <= 160,
    );
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
      outputTrackInfo.set(outputTrackId, {
        sourceTrack,
        outputTrack,
        pipeline,
        stopOutput: originalStop,
      });
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

  function enqueueSenderOperation(sender, operation) {
    const previous = senderOperations.get(sender) ?? Promise.resolve();
    const tracked = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (senderOperations.get(sender) === tracked) {
          senderOperations.delete(sender);
        }
      });
    senderOperations.set(sender, tracked);
    return tracked;
  }

  function stopComposedOutput(composed) {
    const outputTrack = composed?.stream?.getVideoTracks?.()[0];
    if (outputTrack && typeof outputTrack.stop === "function") {
      outputTrack.stop();
    } else {
      composed?.pipeline?.stop(true);
    }
  }

  function readSenderTrack(sender) {
    try {
      return sender.track || null;
    } catch {
      return null;
    }
  }

  function releaseOutputIfDetached(track, info) {
    if (!track || !info) return;
    const stillAttached = [...observedSenders].some((sender) => readSenderTrack(sender) === track);
    if (stillAttached) return;
    info.pipeline.stop(true);
    info.stopOutput();
  }

  async function awaitLatestExternalSettlement(sender) {
    while (true) {
      const intent = senderExternalIntents.get(sender);
      if (!intent) return;
      await intent.settled;
      if (senderExternalIntents.get(sender) === intent) return;
    }
  }

  async function enforceLatestExternalSelection(sender) {
    while (nativeReplaceTrack) {
      await awaitLatestExternalSettlement(sender);
      const intent = senderLatestSuccessfulIntents.get(sender);
      if (!intent) return true;
      const version = senderExternalVersions.get(sender) ?? 0;
      // If the newest request failed, `intent` deliberately remains the last
      // successful browser selection rather than adopting the rejected target.
      if (readSenderTrack(sender) === intent.targetTrack) return true;
      try {
        await nativeReplaceTrack.call(sender, intent.targetTrack);
      } catch {
        return false;
      }
      if ((senderExternalVersions.get(sender) ?? 0) === version) {
        return readSenderTrack(sender) === intent.targetTrack;
      }
    }
    return false;
  }

  async function restoreSenderNow(sender, expectedInfo = null) {
    if (!nativeReplaceTrack) return false;
    await awaitLatestExternalSettlement(sender);
    const currentTrack = readSenderTrack(sender);
    const currentInfo = currentTrack ? outputTrackInfo.get(currentTrack.id) ?? null : null;
    const info = expectedInfo ?? currentInfo;
    if (expectedInfo && currentInfo !== expectedInfo) {
      releaseOutputIfDetached(expectedInfo.outputTrack, expectedInfo);
      return true;
    }
    if (!info) return true;
    const externalVersion = senderExternalVersions.get(sender) ?? 0;
    try {
      await nativeReplaceTrack.call(sender, info.sourceTrack);
    } catch {
      // Keep a live passthrough output attached and retry on the watchdog tick.
      // Stopping it here would blank Meet's camera after a failed restoration.
      return false;
    }
    if ((senderExternalVersions.get(sender) ?? 0) !== externalVersion) {
      await awaitLatestExternalSettlement(sender);
      const latestSuccessful = senderLatestSuccessfulIntents.get(sender);
      if (latestSuccessful && latestSuccessful.version > externalVersion) {
        await enforceLatestExternalSelection(sender);
      }
    }
    senderBaselines.delete(sender);
    info.pipeline.stop(true);
    info.stopOutput();
    return true;
  }

  function retrofitSender(sender, generation = overlayGeneration) {
    return enqueueSenderOperation(sender, async () => {
      if (!overlay.active || generation !== overlayGeneration || !nativeReplaceTrack) return;
      await awaitLatestExternalSettlement(sender);
      const track = readSenderTrack(sender);
      if (!track || track.kind === "audio") return;
      if (outputTrackIds.has(track.id)) {
        await establishSenderBaseline(sender, track.id, generation);
        return;
      }
      const composed = makeCompositedStream(new MediaStream([track]), { stopSource: false });
      const outputTrack = composed.stream.getVideoTracks()[0];
      if (!composed.pipeline || !outputTrack) return;
      if (!overlay.active || generation !== overlayGeneration) {
        stopComposedOutput(composed);
        return;
      }
      const externalVersion = senderExternalVersions.get(sender) ?? 0;
      try {
        await nativeReplaceTrack.call(sender, outputTrack);
      } catch {
        stopComposedOutput(composed);
        return;
      }
      if ((senderExternalVersions.get(sender) ?? 0) !== externalVersion) {
        await awaitLatestExternalSettlement(sender);
        const latestSuccessful = senderLatestSuccessfulIntents.get(sender);
        if (latestSuccessful && latestSuccessful.version > externalVersion) {
          await enforceLatestExternalSelection(sender);
          stopComposedOutput(composed);
          return;
        }
      }
      if (readSenderTrack(sender) !== outputTrack) {
        stopComposedOutput(composed);
        return;
      }
      const info = outputTrackInfo.get(outputTrack.id) ?? null;
      if (!overlay.active || generation !== overlayGeneration) {
        await restoreSenderNow(sender, info);
        return;
      }
      await establishSenderBaseline(sender, outputTrack.id, generation);
      if (!overlay.active || generation !== overlayGeneration) {
        await restoreSenderNow(sender, info);
        return;
      }
      sendState();
    });
  }

  async function retrofitObservedSenders(generation = overlayGeneration) {
    await Promise.all([...observedSenders].map((sender) => retrofitSender(sender, generation)));
  }

  async function restoreObservedSenders() {
    if (!nativeReplaceTrack) return;
    await Promise.all(
      [...observedSenders].map((sender) =>
        enqueueSenderOperation(sender, () => restoreSenderNow(sender))),
    );
    sendState();
  }

  function closeOverlayBitmap() {
    if (overlay.bitmap) {
      overlay.bitmap.close();
      overlay.bitmap = null;
    }
    overlay.scrim = 0;
  }

  function markRelayActivity() {
    lastRelayActivityAt = Date.now();
    relayStaleObservedAt = 0;
  }

  function teardownOverlay(options = {}) {
    if (options.blockRelayNonce) {
      blockedRelayNonce = options.blockRelayNonce;
    }
    if (options.clearClient) {
      overlayClient = null;
    }
    if (teardownPromise) {
      return teardownPromise;
    }
    overlayGeneration += 1;
    setArmed(false);
    overlay.active = false;
    lastRelayActivityAt = 0;
    relayStaleObservedAt = 0;
    closeOverlayBitmap();
    resetOutboundVerification();
    syncSelfViewMirror();
    sendState();
    teardownPromise = (async () => {
      // A retrofit already inside replaceTrack must finish (and observe the new
      // generation) before restoration is scanned, otherwise stop can miss it.
      await Promise.allSettled([...senderOperations.values()]);
      await restoreObservedSenders();
    })().finally(() => {
      teardownPromise = null;
      sendState();
    });
    return teardownPromise;
  }

  function relayMatchesClient(client) {
    const identity = currentRelayIdentity();
    return Boolean(
      client &&
      identity &&
      client.sourceWin === identity.sourceWin &&
      client.origin === identity.origin &&
      client.relayNonce === identity.relayNonce,
    );
  }

  function activateOverlay(client) {
    const activate = () => {
      if (
        overlayClient !== client ||
        blockedRelayNonce === client.relayNonce ||
        !relayMatchesClient(client)
      ) {
        return;
      }
      overlayGeneration += 1;
      overlayStartedAt = Date.now();
      markRelayActivity();
      setArmed(true);
      overlay.active = true;
      overlay.inFlight = 0;
      overlay.framesComposited = 0;
      overlay.lastCompositeAt = 0;
      closeOverlayBitmap();
      resetOutboundVerification();
      syncSelfViewMirror();
      sendState();
      void retrofitObservedSenders(overlayGeneration);
    };
    if (teardownPromise) {
      void teardownPromise.then(activate, activate);
    } else {
      activate();
    }
  }

  function acknowledgeContentTeardown(data) {
    window.postMessage(
      {
        bridge: MARKER,
        v: VERSION,
        type: "overlay-teardown-ack",
        relayNonce: data.relayNonce,
        requestId: data.requestId,
      },
      MEET_ORIGIN,
    );
  }

  setInterval(() => {
    if (overlayClient && !relayMatchesClient(overlayClient)) {
      const staleNonce = overlayClient.relayNonce;
      void teardownOverlay({ blockRelayNonce: staleNonce, clearClient: true });
      return;
    }
    if (!overlayClient && (overlay.active || isArmed())) {
      void teardownOverlay();
      return;
    }
    if (overlay.active && overlayClient) {
      const now = Date.now();
      const relayActivityStale =
        lastRelayActivityAt <= 0 ||
        now - lastRelayActivityAt > RELAY_ACTIVITY_TIMEOUT_MS;
      if (!relayActivityStale) {
        relayStaleObservedAt = 0;
      } else if (relayStaleObservedAt === 0) {
        // Timer callbacks can arrive in a burst after a backgrounded tab wakes.
        // Require another stale observation after a short grace period so a
        // queued frame can prove liveness before teardown becomes terminal.
        relayStaleObservedAt = now;
      } else if (now - relayStaleObservedAt >= RELAY_STALE_CONFIRMATION_MS) {
        const staleNonce = overlayClient.relayNonce;
        void teardownOverlay({ blockRelayNonce: staleNonce, clearClient: true });
        return;
      }
    }
    if (!overlay.active && !teardownPromise) {
      const attachedOutputRemains = [...observedSenders].some((sender) => {
        try {
          return Boolean(sender.track && outputTrackIds.has(sender.track.id));
        } catch {
          return false;
        }
      });
      if (attachedOutputRemains) {
        void teardownOverlay();
      }
    }
  }, RELAY_WATCHDOG_INTERVAL_MS);

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
    if (isTrustedContentTeardown(event)) {
      const staleNonce = data.relayNonce;
      void teardownOverlay({ blockRelayNonce: staleNonce, clearClient: true })
        .then(() => acknowledgeContentTeardown(data), () => acknowledgeContentTeardown(data));
      return;
    }
    if (!isTrustedEngineRelay(event)) {
      return;
    }
    if (data.type === "overlay-hello") {
      if (blockedRelayNonce === data.relayNonce) {
        return;
      }
      const nextClient = {
        sourceWin: event.source,
        origin: event.origin,
        relayNonce: data.relayNonce,
      };
      if (overlayClient && !relayMatchesClient(overlayClient)) {
        const staleNonce = overlayClient.relayNonce;
        void teardownOverlay({ blockRelayNonce: staleNonce, clearClient: true }).then(() => {
          if (relayMatchesClient(nextClient)) {
            blockedRelayNonce = null;
            overlayClient = nextClient;
            sendState();
          }
        });
      } else {
        blockedRelayNonce = null;
        overlayClient = nextClient;
        markRelayActivity();
        sendState();
      }
      return;
    }
    if (
      !overlayClient ||
      event.source !== overlayClient.sourceWin ||
      event.origin !== overlayClient.origin ||
      data.relayNonce !== overlayClient.relayNonce ||
      blockedRelayNonce === data.relayNonce
    ) {
      return;
    }
    if (data.type === "overlay-start") {
      markRelayActivity();
      activateOverlay(overlayClient);
      return;
    }
    if (data.type === "overlay-heartbeat") {
      if (overlay.active) {
        markRelayActivity();
      }
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
      markRelayActivity();
      overlay.bitmap = bitmap;
      overlay.scrim = Math.min(1, Math.max(0, Number(data.scrim) || 0));
      return;
    }
    if (data.type === "overlay-stop") {
      void teardownOverlay();
    }
  });
})();
