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
    }
    replaceTrack(track) {
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
              framesEncoded: 42,
              bytesSent: 123456,
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
    close() {}
  }

  const storage = new Map();
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
  };
  const context = vm.createContext({
    window: fakeWindow,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => cameraStream,
      },
    },
    document: {
      createElement(tag) {
        if (tag === "video") {
          return {
            muted: false,
            playsInline: false,
            srcObject: null,
            videoWidth: 640,
            videoHeight: 360,
            play: async () => {},
            requestVideoFrameCallback() {},
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
    Date,
    Promise,
    Number,
    Map,
    Set,
  });
  vm.runInContext(source, context);

  const client = {
    postMessage(message) {
      clientMessages.push(message);
    },
  };
  const post = (type, fields = {}) =>
    messageHandlers[0]({
      data: { bridge: "airboard-media-bridge", v: 1, type, ...fields },
      origin: "http://127.0.0.1:3100",
      source: client,
    });
  post("overlay-hello");
  assert.equal(clientMessages.at(-1).armed, false, "camera overlay waits for explicit media consent");

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
  for (const callback of intervalCallbacks) {
    callback();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const latest = clientMessages.filter((message) => message.type === "overlay-state").at(-1);
  assert.equal(latest.verification.extensionVersion, "0.8.0");
  assert.equal(latest.verification.senderAttached, true);
  assert.equal(latest.verification.framesEncoded, 42);
  assert.equal(latest.verification.bytesSent, 123456);
  assert.ok(latest.verification.lastVerifiedAt > 0);

  post("overlay-stop");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sender.track.id, "camera-source", "disabling Airboard restores Meet's original camera");
});
