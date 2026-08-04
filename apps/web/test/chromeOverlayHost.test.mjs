import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("Meet meeting routes mount one hidden Airboard engine and remove it on exit", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/content.js", import.meta.url),
    "utf8",
  );
  const intervals = [];
  const windowListeners = new Map();
  const compositorControlMessages = [];
  const elements = new Map();
  const documentElement = {
    appendChild(element) {
      elements.set(element.id, element);
    },
  };
  const document = {
    documentElement,
    getElementById: (id) => elements.get(id) ?? null,
    createElement(tag) {
      assert.equal(tag, "iframe");
      return {
        id: "",
        style: {},
        setAttribute() {},
        remove() {
          elements.delete(this.id);
        },
      };
    },
  };
  const window = {
    location: { pathname: "/abc-defg-hij" },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    postMessage(message, origin) {
      compositorControlMessages.push({ message, origin });
    },
  };
  const runtimeListeners = [];
  vm.runInContext(
    source,
    vm.createContext({
      window,
      document,
      chrome: { runtime: {
        getURL: (path) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`,
        sendMessage: (message, callback) => {
          if (typeof callback === "function") callback({
            linked: true,
            consented: true,
            entitled: true,
            settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
          });
          return Promise.resolve(message?.type === "AIRBOARD_MEET_CONTEXT" ? { ok: true } : undefined);
        },
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
      } },
      setInterval: (callback) => {
        intervals.push(callback);
        return intervals.length;
      },
      setTimeout,
      clearTimeout,
      createImageBitmap() {},
      crypto: {
        randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        getRandomValues(array) {
          array.fill(0xab);
          return array;
        },
      },
      navigator: { mediaDevices: {} },
      console,
      Object,
      Set,
      Math,
      Number,
      Promise,
      Float32Array,
      Uint8Array,
      Array,
      URL,
      URLSearchParams,
    }),
  );

  const engine = elements.get("airboard-overlay-engine-host");
  assert.ok(engine);
  assert.equal(
    engine.src,
    `chrome-extension://abcdefghijklmnopabcdefghijklmnop/engine.html#airboardRelayNonce=${"ab".repeat(32)}`,
  );
  assert.equal(engine.style.width, "1280px");
  assert.equal(engine.style.opacity, "0");

  intervals[0]();
  assert.equal(elements.size, 1, "route polling never duplicates the engine");
  window.location.pathname = "/";
  intervals[0]();
  assert.equal(elements.size, 1, "the relay stays mounted until compositor teardown is acknowledged");
  const teardown = compositorControlMessages.at(-1);
  assert.equal(teardown.origin, "https://meet.google.com");
  assert.equal(teardown.message.type, "overlay-teardown-request");
  windowListeners.get("message")({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-teardown-ack",
      relayNonce: teardown.message.relayNonce,
      requestId: teardown.message.requestId,
    },
    origin: "https://meet.google.com",
    source: window,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.size, 0);
});

test("media policy transitions stop active capture and cancel getUserMedia still in flight", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/content.js", import.meta.url),
    "utf8",
  );
  const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const relayNonce = "ab".repeat(32);
  const relayMessages = [];
  const relayWindow = { postMessage: (message) => relayMessages.push(message) };
  const elements = new Map();
  const windowListeners = new Map();
  const runtimeListeners = [];
  const controlMessages = [];
  let generatedNonceByte = 0xab;
  let state = {
    linked: true,
    consented: true,
    entitled: true,
    settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
  };
  let resolveVideoCapture;
  const pendingAudioReads = [];
  const audioTrack = fakeTrack("audio");
  const videoTrack = fakeTrack("video");
  const audioStream = fakeStream([audioTrack]);
  const videoStream = fakeStream([videoTrack]);
  const document = {
    documentElement: { appendChild: (element) => elements.set(element.id, element) },
    getElementById: (id) => elements.get(id) ?? null,
    createElement(tag) {
      if (tag === "iframe") {
        return {
          id: "",
          src: "",
          style: {},
          contentWindow: relayWindow,
          setAttribute() {},
          remove() { elements.delete(this.id); },
        };
      }
      throw new Error(`Unexpected element: ${tag}`);
    },
  };
  const window = {
    location: { pathname: "/abc-defg-hij" },
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    postMessage(message, origin) { controlMessages.push({ message, origin }); },
  };
  vm.runInContext(source, vm.createContext({
    window,
    document,
    chrome: { runtime: {
      getURL: (path) => `${extensionOrigin}/${path}`,
      sendMessage: (message, callback) => {
        if (typeof callback === "function") callback(state);
        return Promise.resolve(message);
      },
      onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
    } },
    navigator: { mediaDevices: {
      getUserMedia(constraints) {
        if (constraints.audio) return Promise.resolve(audioStream);
        return new Promise((resolve) => { resolveVideoCapture = resolve; });
      },
    } },
    MediaStreamTrackProcessor: class {
      readable = { getReader: () => ({
        read: () => new Promise((resolve) => pendingAudioReads.push(resolve)),
        cancel: () => {
          pendingAudioReads.shift()?.({ done: true });
          return Promise.resolve();
        },
      }) };
    },
    setInterval: () => 1,
    setTimeout,
    clearTimeout,
    createImageBitmap() {},
    crypto: {
      randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      getRandomValues(array) {
        array.fill(generatedNonceByte);
        generatedNonceByte = 0xcd;
        return array;
      },
    },
    console,
    Object,
    Set,
    Map,
    Math,
    Number,
    Promise,
    Float32Array,
    Uint8Array,
    Array,
    URL,
    URLSearchParams,
  }));

  const sendFromRelay = (type) => windowListeners.get("message")({
    data: { bridge: "airboard-media-bridge", v: 1, type, relayNonce },
    origin: extensionOrigin,
    source: relayWindow,
  });
  sendFromRelay("start-audio");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audioTrack.readyState, "live");
  pendingAudioReads.shift()({
    done: false,
    value: {
      sampleRate: 48_000,
      numberOfFrames: 2,
      copyTo(samples) {
        samples[0] = 0.25;
        samples[1] = -0.25;
      },
      close() {},
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  state = { ...state, settings: { ...state.settings, audioEnabled: false } };
  runtimeListeners[0]({ type: "AIRBOARD_STATE_CHANGED", state });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audioTrack.readyState, "ended", "turning voice off stops an active microphone");
  assert.equal(
    relayMessages.some((message) => message.type === "audio-chunk"),
    false,
    "revocation drops buffered microphone samples instead of flushing them to the relay",
  );

  state = { ...state, settings: { ...state.settings, audioEnabled: true } };
  runtimeListeners[0]({ type: "AIRBOARD_STATE_CHANGED", state });

  sendFromRelay("start-video");
  assert.equal(typeof resolveVideoCapture, "function");
  state = { ...state, settings: { ...state.settings, videoEnabled: false } };
  runtimeListeners[0]({ type: "AIRBOARD_STATE_CHANGED", state });
  resolveVideoCapture(videoStream);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(videoTrack.readyState, "ended", "a revoked pending camera acquisition is released");

  const teardown = controlMessages.at(-1).message;
  windowListeners.get("message")({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-teardown-ack",
      relayNonce,
      requestId: teardown.requestId,
    },
    origin: "https://meet.google.com",
    source: window,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.size, 1, "video-off keeps the engine mounted for allowed voice capture");

  state = { ...state, settings: { ...state.settings, videoEnabled: true } };
  runtimeListeners[0]({ type: "AIRBOARD_STATE_CHANGED", state });
  const remountTeardown = controlMessages.at(-1).message;
  assert.equal(remountTeardown.type, "overlay-teardown-request");
  windowListeners.get("message")({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-teardown-ack",
      relayNonce,
      requestId: remountTeardown.requestId,
    },
    origin: "https://meet.google.com",
    source: window,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    elements.get("airboard-overlay-engine-host").src,
    new RegExp(`airboardRelayNonce=${"cd".repeat(32)}$`),
    "video re-enable remounts with a fresh relay nonce",
  );
});

test("an identity-stable dead relay stops both captures and remounts a fresh nonce", async () => {
  const source = await readFile(
    new URL("../../../extensions/chrome-meet-bridge/content.js", import.meta.url),
    "utf8",
  );
  const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const elements = new Map();
  const intervalCallbacks = [];
  const windowListeners = new Map();
  const controlMessages = [];
  const relayWindow = { postMessage() {} };
  const capturedTracks = [];
  let pendingAudioRead = null;
  let generatedNonceByte = 0xab;
  let now = 1_000_000;

  const document = {
    documentElement: { appendChild: (element) => elements.set(element.id, element) },
    getElementById: (id) => elements.get(id) ?? null,
    createElement(tag) {
      if (tag === "iframe") {
        return {
          id: "",
          src: "",
          style: {},
          contentWindow: relayWindow,
          setAttribute() {},
          remove() { elements.delete(this.id); },
        };
      }
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
      throw new Error(`Unexpected element: ${tag}`);
    },
  };
  const window = {
    location: { pathname: "/abc-defg-hij" },
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    postMessage(message, origin) { controlMessages.push({ message, origin }); },
  };
  vm.runInContext(source, vm.createContext({
    window,
    document,
    chrome: { runtime: {
      getURL: (path) => `${extensionOrigin}/${path}`,
      sendMessage: (message, callback) => {
        if (typeof callback === "function") callback({
          linked: true,
          consented: true,
          entitled: true,
          settings: { overlayEnabled: true, videoEnabled: true, audioEnabled: true },
        });
        return Promise.resolve(message);
      },
      onMessage: { addListener() {} },
    } },
    navigator: { mediaDevices: {
      async getUserMedia(constraints) {
        const track = fakeTrack(constraints.audio ? "audio" : "video");
        capturedTracks.push(track);
        return fakeStream([track]);
      },
    } },
    MediaStreamTrackProcessor: class {
      readable = { getReader: () => ({
        read: () => new Promise((resolve) => { pendingAudioRead = resolve; }),
        cancel: () => {
          pendingAudioRead?.({ done: true });
          pendingAudioRead = null;
          return Promise.resolve();
        },
      }) };
    },
    setInterval: (callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    setTimeout,
    clearTimeout,
    createImageBitmap() {},
    crypto: {
      randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      getRandomValues(array) {
        array.fill(generatedNonceByte);
        generatedNonceByte = 0xcd;
        return array;
      },
    },
    Date: { now: () => now },
    console,
    Object,
    Set,
    Map,
    Math,
    Number,
    Promise,
    Float32Array,
    Uint8Array,
    Array,
    URL,
    URLSearchParams,
  }));

  const firstEngine = elements.get("airboard-overlay-engine-host");
  const firstNonce = "ab".repeat(32);
  const sendFromRelay = (type, fields = {}) => windowListeners.get("message")({
    data: { bridge: "airboard-media-bridge", v: 1, type, relayNonce: firstNonce, ...fields },
    origin: extensionOrigin,
    source: relayWindow,
  });
  sendFromRelay("start-audio");
  sendFromRelay("start-video");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capturedTracks.length, 2);
  assert.ok(capturedTracks.every((track) => track.readyState === "live"));

  now += 30_001;
  intervalCallbacks[0]();
  assert.ok(
    capturedTracks.every((track) => track.readyState === "live"),
    "one stale observation leaves room for throttled relay acknowledgements",
  );
  now += 5_001;
  intervalCallbacks[0]();
  assert.ok(capturedTracks.every((track) => track.readyState === "ended"));
  assert.equal(
    elements.get("airboard-overlay-engine-host"),
    firstEngine,
    "the old frame stays mounted until compositor teardown acknowledgement",
  );

  const teardown = controlMessages.at(-1).message;
  assert.equal(teardown.type, "overlay-teardown-request");
  assert.equal(teardown.reason, "relay-unresponsive");
  windowListeners.get("message")({
    data: {
      bridge: "airboard-media-bridge",
      v: 1,
      type: "overlay-teardown-ack",
      relayNonce: firstNonce,
      requestId: teardown.requestId,
    },
    origin: "https://meet.google.com",
    source: window,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const recoveredEngine = elements.get("airboard-overlay-engine-host");
  assert.notEqual(recoveredEngine, firstEngine);
  assert.match(
    recoveredEngine.src,
    new RegExp(`airboardRelayNonce=${"cd".repeat(32)}$`),
    "recovery requires a fresh relay identity",
  );
});

function fakeTrack(kind) {
  return {
    kind,
    readyState: "live",
    stop() { this.readyState = "ended"; },
    addEventListener() {},
  };
}

function fakeStream(tracks) {
  return {
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  };
}
