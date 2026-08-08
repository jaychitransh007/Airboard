import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("real Meet compositor reports its output track and outbound RTP encoding", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/compositor.js", import.meta.url),
    "utf8",
  );
  const messageHandlers = [];
  const intervalCallbacks = [];
  const clientMessages = [];
  const mainWindowMessages = [];
  const videoFrameCallbacks = [];
  const outboundStats = { framesEncoded: 42, bytesSent: 123456 };
  let now = 1_000_000;
  let nextTrackId = 1;

  class FakeTrack {
    constructor(id = `track-${nextTrackId++}`) {
      this.id = id;
      this.readyState = "live";
    }
    stop() {
      this.readyState = "ended";
    }
    getSettings() {
      return { frameRate: 30 };
    }
    addEventListener() {}
  }

  class FakeStream {
    constructor(tracks = []) {
      this.tracks = tracks;
    }
    getVideoTracks() {
      return this.tracks.filter((track) => !track.audio);
    }
    getAudioTracks() {
      return this.tracks.filter((track) => track.audio);
    }
    getTracks() {
      return [...this.tracks];
    }
    addTrack(track) {
      this.tracks.push(track);
    }
  }

  class FakeSender {
    constructor(track) {
      this.track = track;
      this.deferNext = false;
      this.rejectNext = false;
      this.resolveDeferred = null;
    }
    replaceTrack(track) {
      if (this.rejectNext) {
        this.rejectNext = false;
        return Promise.reject(new Error("replace failed"));
      }
      if (this.deferNext) {
        this.deferNext = false;
        return new Promise((resolve) => {
          this.resolveDeferred = () => {
            this.track = track;
            this.resolveDeferred = null;
            resolve();
          };
        });
      }
      this.track = track;
      return Promise.resolve();
    }
    getStats() {
      return Promise.resolve(
        new Map([
          [
            "outbound",
            {
              type: "outbound-rtp",
              kind: "video",
              framesEncoded: outboundStats.framesEncoded,
              bytesSent: outboundStats.bytesSent,
            },
          ],
        ]),
      );
    }
  }

  class FakePeerConnection {
    addTrack(track) {
      return new FakeSender(track);
    }
    addTransceiver(track) {
      return { sender: new FakeSender(track) };
    }
  }

  class FakeBitmap {
    closed = false;
    close() { this.closed = true; }
  }

  const storage = new Map();
  const relayOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  let relayNonce = "ab".repeat(32);
  let relayMounted = true;
  const client = {
    postMessage(message) {
      clientMessages.push(message);
    },
  };
  const relayFrame = {
    src: `${relayOrigin}/engine.html#airboardRelayNonce=${relayNonce}`,
    contentWindow: client,
  };
  const cameraTrack = new FakeTrack("camera-source");
  const cameraStream = new FakeStream([cameraTrack]);
  const fakeContext = {
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage() {},
    fillRect() {},
    set fillStyle(_value) {},
  };
  const fakeWindow = {
    RTCPeerConnection: FakePeerConnection,
    RTCRtpSender: FakeSender,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener(type, handler) {
      if (type === "message") messageHandlers.push(handler);
    },
    postMessage(message, origin) {
      mainWindowMessages.push({ message, origin });
    },
  };
  const context = vm.createContext({
    window: fakeWindow,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => cameraStream,
      },
    },
    document: {
      getElementById(id) {
        return id === "airboard-overlay-engine-host" && relayMounted ? relayFrame : null;
      },
      createElement(tag) {
        if (tag === "video") {
          return {
            muted: false,
            playsInline: false,
            srcObject: null,
            videoWidth: 640,
            videoHeight: 360,
            play: async () => {},
            requestVideoFrameCallback(callback) { videoFrameCallbacks.push(callback); },
          };
        }
        return {
          width: 0,
          height: 0,
          getContext: () => fakeContext,
          captureStream: () => new FakeStream([new FakeTrack("airboard-output")]),
        };
      },
      querySelectorAll: () => [],
    },
    MediaStream: FakeStream,
    ImageBitmap: FakeBitmap,
    DOMMatrixReadOnly: class {
      a = 1;
    },
    getComputedStyle: () => ({ transform: "none" }),
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval() {},
    console,
    Date: { now: () => now },
    Promise,
    Number,
    Map,
    Set,
    URL,
    URLSearchParams,
  });
  vm.runInContext(source, context);

  const post = (type, fields = {}) =>
    messageHandlers[0]({
      data: {
        bridge: "airboard-media-bridge",
        v: 1,
        type,
        ...fields,
        relayNonce,
      },
      origin: relayOrigin,
      source: client,
    });
  messageHandlers[0]({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-hello",
      relayNonce,
    },
    origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba",
    source: client,
  });
  assert.equal(clientMessages.length, 0, "a mismatched extension origin is rejected");
  messageHandlers[0]({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-hello",
      relayNonce: "cd".repeat(32),
    },
    origin: relayOrigin,
    source: client,
  });
  assert.equal(clientMessages.length, 0, "a mismatched frame nonce is rejected");
  post("overlay-hello");
  assert.equal(clientMessages.at(-1).armed, false, "camera overlay waits for explicit media consent");
  assert.equal(clientMessages.at(-1).relayNonce, relayNonce);

  // Meet may already own its camera track when the user completes extension
  // setup. Airboard must retrofit that live sender without a camera toggle.
  const output = await context.navigator.mediaDevices.getUserMedia({ video: true });
  const peer = new fakeWindow.RTCPeerConnection();
  const sender = peer.addTrack(output.getVideoTracks()[0], output);
  assert.equal(sender.track.id, "camera-source");
  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(clientMessages.at(-1).armed, true, "explicit overlay start arms the compositor");
  assert.equal(sender.track.id, "airboard-output", "an existing Meet sender is upgraded in place");
  post("overlay-frame", { id: 1, bitmap: new FakeBitmap(), scrim: 0.4 });
  videoFrameCallbacks.shift()?.();
  for (const callback of intervalCallbacks) {
    callback();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const beforeDelta = clientMessages.filter((message) => message.type === "overlay-state").at(-1);
  assert.equal(beforeDelta.verification.framesEncoded, 0);
  assert.equal(beforeDelta.verification.bytesSent, 0);
  assert.equal(beforeDelta.verification.lastVerifiedAt, 0, "pre-overlay RTP totals are only a baseline");

  outboundStats.framesEncoded += 5;
  outboundStats.bytesSent += 1_000;
  for (const callback of intervalCallbacks) {
    callback();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const latest = clientMessages.filter((message) => message.type === "overlay-state").at(-1);
  assert.equal(latest.verification.extensionVersion, "0.8.0");
  assert.equal(latest.verification.senderAttached, true);
  assert.equal(latest.verification.framesEncoded, 5);
  assert.equal(latest.verification.bytesSent, 1_000);
  assert.ok(latest.verification.lastVerifiedAt > 0);

  const verifiedAtWithProgress = latest.verification.lastVerifiedAt;
  now += 16_001;
  videoFrameCallbacks.shift()?.();
  for (const callback of intervalCallbacks) {
    callback();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stalled = clientMessages.filter((message) => message.type === "overlay-state").at(-1);
  assert.equal(
    stalled.verification.lastVerifiedAt,
    0,
    "fresh composites cannot keep verification fresh after outbound RTP stalls",
  );
  assert.ok(now - verifiedAtWithProgress > 15_000);

  post("overlay-stop");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "camera-source", "disabling Airboard restores Meet's original camera");

  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  sender.deferNext = true;
  post("overlay-stop");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const finishRestore = sender.resolveDeferred;
  assert.equal(typeof finishRestore, "function");
  const replacementCamera = new FakeTrack("camera-user-selected");
  await sender.replaceTrack(replacementCamera);
  assert.equal(sender.track, replacementCamera);
  finishRestore();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    sender.track,
    replacementCamera,
    "a late Airboard restore never overwrites Meet's newer user-selected camera",
  );
  await sender.replaceTrack(cameraTrack);
  await new Promise((resolve) => setTimeout(resolve, 0));

  sender.deferNext = true;
  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof sender.resolveDeferred, "function");
  post("overlay-stop");
  sender.resolveDeferred();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    sender.track.id,
    "camera-source",
    "stop waits for an in-flight sender replacement and restores it",
  );

  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const outputDuringFailedRestore = sender.track;
  sender.rejectNext = true;
  post("overlay-stop");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track, outputDuringFailedRestore);
  assert.equal(
    outputDuringFailedRestore.readyState,
    "live",
    "a failed restore never stops the track still attached to Meet",
  );
  intervalCallbacks[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "camera-source", "the fail-safe watchdog retries restoration");

  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "airboard-output");
  relayMounted = false;
  intervalCallbacks[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "camera-source", "relay disappearance fails safe to the real camera");

  relayMounted = true;
  relayNonce = "cd".repeat(32);
  relayFrame.src = `${relayOrigin}/engine.html#airboardRelayNonce=${relayNonce}`;
  post("overlay-hello");
  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  messageHandlers[0]({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-teardown-request",
      relayNonce,
      requestId: "teardown-1",
    },
    origin: "https://meet.google.com",
    source: fakeWindow,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "camera-source");
  const acknowledgement = mainWindowMessages.at(-1);
  assert.equal(acknowledgement.origin, "https://meet.google.com");
  assert.equal(acknowledgement.message.bridge, "airboard-media-bridge");
  assert.equal(acknowledgement.message.v, 1);
  assert.equal(acknowledgement.message.type, "overlay-teardown-ack");
  assert.equal(acknowledgement.message.relayNonce, relayNonce);
  assert.equal(acknowledgement.message.requestId, "teardown-1");

  relayNonce = "ef".repeat(32);
  relayFrame.src = `${relayOrigin}/engine.html#airboardRelayNonce=${relayNonce}`;
  post("overlay-hello");
  post("overlay-start");
  await new Promise((resolve) => setTimeout(resolve, 0));
  post("overlay-frame", { id: 2, bitmap: new FakeBitmap(), scrim: 0.4 });
  assert.equal(sender.track.id, "airboard-output");
  now += 30_001;
  intervalCallbacks[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    sender.track.id,
    "airboard-output",
    "one stale observation allows delayed browser callbacks to deliver a queued frame",
  );
  now += 2_001;
  intervalCallbacks[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(relayMounted, true, "liveness teardown does not depend on relay DOM removal");
  assert.equal(
    sender.track.id,
    "camera-source",
    "an identity-stable relay that stops producing frames fails safe to the real camera",
  );
});
