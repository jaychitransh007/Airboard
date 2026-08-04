import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedKeyterms,
  buildRealtimeTranscriptionWebSocketUrl,
  createRealtimeSpeechSession,
  DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  encodePcm16Frame,
  fetchRealtimeTranscriptionConfig,
  REALTIME_TRANSCRIPTION_FRAME_SAMPLES,
} from "../src/features/board/realtimeSpeech.ts";

test("boundedKeyterms trims, de-dupes, and caps to the provider limit of 100", () => {
  // The shared Airboard vocabulary is 127 terms; the provider rejects > 100.
  const many = Array.from({ length: 150 }, (_, index) => `term-${index}`);
  const capped = boundedKeyterms(many);
  assert.equal(capped.length, 100);
  assert.equal(capped[0], "term-0");

  assert.deepEqual(boundedKeyterms([" Airo ", "Airo", "", "  ", "API"]), ["Airo", "API"]);
});

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  closeCalls = [];
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit("close", { code: code ?? 1000, reason: reason ?? "" });
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  serverMessage(payload) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createMediaStreamHarness() {
  const track = {
    stopCalls: 0,
    stop() {
      this.stopCalls += 1;
    },
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
    },
  };
}

function createWorkletAudioHarness(sampleRate = 16_000) {
  const source = {
    connectedTo: null,
    disconnected: false,
    connect(destination) {
      this.connectedTo = destination;
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  const worklet = {
    connectedTo: null,
    disconnected: false,
    port: {
      onmessage: null,
      closed: false,
      close() {
        this.closed = true;
      },
    },
    connect(destination) {
      this.connectedTo = destination;
    },
    disconnect() {
      this.disconnected = true;
    },
    emit(samples) {
      this.port.onmessage?.({ data: samples });
    },
  };
  const addedModules = [];
  const context = {
    sampleRate,
    destination: { kind: "destination" },
    state: "running",
    audioWorklet: {
      async addModule(url) {
        addedModules.push(url);
      },
    },
    createMediaStreamSource: () => source,
    createScriptProcessor() {
      throw new Error("ScriptProcessor should not be used when AudioWorklet is available");
    },
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
    },
  };
  return { context, source, worklet, addedModules };
}

test("builds the provider-neutral websocket and config endpoints", async () => {
  assert.equal(
    buildRealtimeTranscriptionWebSocketUrl("https://api.example.com/v1"),
    "wss://api.example.com/transcription/ws",
  );
  assert.equal(
    buildRealtimeTranscriptionWebSocketUrl("http://localhost:4000"),
    "ws://localhost:4000/transcription/ws",
  );

  const requests = [];
  const config = await fetchRealtimeTranscriptionConfig("http://localhost:4000/base", async (...args) => {
    requests.push(args);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          available: true,
          provider: "deepgram",
          defaultModel: "flux-general-en",
          allowedModels: ["flux-general-en", "nova-3", 42],
        };
      },
    };
  });

  assert.equal(requests[0][0], "http://localhost:4000/transcription/config");
  assert.deepEqual(requests[0][1], { method: "GET" });
  assert.deepEqual(config, {
    available: true,
    provider: "deepgram",
    defaultModel: "flux-general-en",
    allowedModels: ["flux-general-en", "nova-3"],
    dynamicKeyterms: false,
  });
});

test("encodes signed little-endian PCM16 and produces a 1280-sample 80ms frame", () => {
  assert.equal(DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES, 32 * 1024);
  const encoded = encodePcm16Frame(new Float32Array([-1, -0.5, 0, 0.5, 1]), 5, 5);
  const view = new DataView(encoded);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => view.getInt16(index * 2, true)),
    [-32768, -16384, 0, 16384, 32767],
  );

  const eightyMillisecondsAt48Khz = new Float32Array(3_840);
  const frame = encodePcm16Frame(eightyMillisecondsAt48Khz, 48_000, 16_000);
  assert.equal(frame.byteLength, REALTIME_TRANSCRIPTION_FRAME_SAMPLES * 2);
});

test("streams exact 80ms frames, emits live callbacks, and releases resources on stop", async () => {
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const events = [];
  const revokedUrls = [];
  let requestedConstraints;

  const session = createRealtimeSpeechSession(
    {
      onReady: (metadata) => events.push(["ready", metadata]),
      onListening: (listening) => events.push(["listening", listening]),
      onInterim: (transcript, event) => events.push(["interim", transcript, event]),
      onFinal: (transcript, event) => events.push(["final", transcript, event]),
      onProviderStatus: (event) => events.push(["provider", event]),
      onError: (message, code) => events.push(["error", message, code]),
      onEnd: (reason) => events.push(["end", reason]),
    },
    {
      apiBaseUrl: "http://localhost:4000",
      language: "en-IN",
      model: "nova-3",
      keyterms: ["Airo", "database", "API"],
    },
    {
      createWebSocket: () => socket,
      getUserMedia: async (constraints) => {
        requestedConstraints = constraints;
        return media.stream;
      },
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:airboard-worklet",
      revokeAudioWorkletModuleUrl: (url) => revokedUrls.push(url),
    },
  );

  assert.ok(session);
  assert.equal(session.requestedModel, "nova-3");
  assert.equal(session.getMetadata(), null);
  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.binaryType, "arraybuffer");

  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: "transcription.start",
    sampleRate: 16_000,
    language: "en-IN",
    model: "nova-3",
    keyterms: ["Airo", "database", "API"],
  });

  socket.serverMessage({
    type: "transcription.ready",
    provider: "deepgram",
    model: "nova-3",
    sampleRate: 16_000,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(session.getMetadata(), {
    provider: "deepgram",
    model: "nova-3",
    sampleRate: 16_000,
  });
  assert.equal(session.isListening(), true);
  assert.deepEqual(requestedConstraints, {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  assert.deepEqual(audio.addedModules, ["blob:airboard-worklet"]);
  assert.deepEqual(revokedUrls, ["blob:airboard-worklet"]);
  assert.equal(audio.source.connectedTo, audio.worklet);

  audio.worklet.emit(new Float32Array(640).fill(0.25));
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 0);
  audio.worklet.emit(new Float32Array(640).fill(0.25));
  const binaryFrames = socket.sent.filter((entry) => entry instanceof ArrayBuffer);
  assert.equal(binaryFrames.length, 1);
  assert.equal(binaryFrames[0].byteLength, 2_560);
  assert.equal(new DataView(binaryFrames[0]).getInt16(0, true), 8_192);

  socket.serverMessage({
    type: "transcription.partial",
    transcript: "add a data",
    confidence: 0.7,
  });
  socket.serverMessage({
    type: "transcription.final",
    transcript: "add a database",
    confidence: 0.98,
    provider: "deepgram",
    model: "nova-3",
  });
  socket.serverMessage({
    type: "transcription.provider",
    status: "speech_started",
    provider: "deepgram",
  });

  audio.worklet.emit(new Float32Array(320).fill(0.1));
  session.stop();
  assert.equal(session.isListening(), false);
  assert.equal(media.track.stopCalls, 1);
  assert.equal(audio.context.closeCalls, 1);
  assert.equal(audio.source.disconnected, true);
  assert.equal(audio.worklet.disconnected, true);
  assert.equal(audio.worklet.port.closed, true);
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 2);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: "transcription.stop" });

  socket.serverMessage({ type: "transcription.stopped" });
  assert.equal(socket.closeCalls.length, 1);
  assert.ok(events.some(([type, value]) => type === "interim" && value === "add a data"));
  assert.ok(events.some(([type, value]) => type === "final" && value === "add a database"));
  assert.ok(events.some(([type, value]) => type === "end" && value === "stopped"));
});

test("queues the latest board vocabulary until ready and configures it mid-session exactly once", async () => {
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const providerEvents = [];
  const session = createRealtimeSpeechSession(
    {
      onFinal() {},
      onProviderStatus: (event) => providerEvents.push(event),
    },
    {
      url: "ws://localhost/transcription/ws",
      keyterms: ["Airo", "database"],
      dynamicKeyterms: true,
    },
    {
      createWebSocket: () => socket,
      getUserMedia: async () => media.stream,
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:test",
      revokeAudioWorkletModuleUrl() {},
    },
  );

  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: "transcription.start",
    sampleRate: 16_000,
    keyterms: ["Airo", "database"],
  });

  session.updateKeyterms([
    "Airo",
    "Planner",
    "Golden Dataset",
    "Historical Dataset",
  ]);
  assert.equal(socket.sent.length, 1);

  socket.serverMessage({
    type: "transcription.ready",
    provider: "deepgram",
    model: "flux-general-en",
    sampleRate: 16_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(socket.sent[1]), {
    type: "transcription.configure",
    keyterms: [
      "Airo",
      "Planner",
      "Golden Dataset",
      "Historical Dataset",
    ],
  });

  session.updateKeyterms([
    "airo",
    "Planner",
    "Golden Dataset",
    "Historical Dataset",
  ]);
  assert.equal(socket.sent.length, 2);
  session.updateKeyterms([
    "Airo",
    "Planner",
    "Golden Dataset",
    "Historical Dataset",
    "Feature Store",
  ]);
  assert.deepEqual(JSON.parse(socket.sent[2]), {
    type: "transcription.configure",
    keyterms: [
      "Airo",
      "Planner",
      "Golden Dataset",
      "Historical Dataset",
      "Feature Store",
    ],
  });

  socket.serverMessage({
    type: "transcription.configured",
    keytermCount: 5,
  });
  assert.deepEqual(providerEvents.at(-1), {
    status: "configured",
    message: "5 transcription keyterms active",
  });
  session.abort();
});

test("streams bridged PCM without creating an AudioContext or requiring user activation", async () => {
  const socket = new FakeSocket();
  const events = [];
  let pcmHandlers;
  let stopCalls = 0;
  const session = createRealtimeSpeechSession(
    {
      onFinal() {},
      onListening: (listening) => events.push(["listening", listening]),
    },
    { url: "ws://localhost/transcription/ws" },
    {
      createWebSocket: () => socket,
      startPcmInput: async (handlers) => {
        pcmHandlers = handlers;
        // The first bridge chunk can arrive before the server is ready. It is
        // intentionally dropped instead of being queued as stale speech.
        handlers.onChunk(new Float32Array(1_280).fill(0.1), 16_000);
        return { stop: () => (stopCalls += 1) };
      },
      getUserMedia: async () => {
        throw new Error("direct PCM must not request iframe microphone access");
      },
      createAudioContext: () => {
        throw new Error("direct PCM must not create an autoplay-gated AudioContext");
      },
    },
  );

  assert.ok(session);
  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  socket.serverMessage({
    type: "transcription.ready",
    provider: "test",
    model: "pcm-bridge",
    sampleRate: 16_000,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(session.isListening(), true);
  pcmHandlers.onChunk(new Float32Array(1_280).fill(0.25), 16_000);
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 1);

  session.abort();
  assert.equal(stopCalls, 1);
  assert.deepEqual(events, [
    ["listening", true],
    ["listening", false],
  ]);
});

test("drops audio while websocket backpressure exceeds the bounded latency queue", async () => {
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const session = createRealtimeSpeechSession(
    { onFinal() {} },
    { url: "ws://localhost/transcription/ws", maxBufferedBytes: 100 },
    {
      createWebSocket: () => socket,
      getUserMedia: async () => media.stream,
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:test",
      revokeAudioWorkletModuleUrl() {},
    },
  );

  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  socket.serverMessage({
    type: "transcription.ready",
    provider: "test",
    model: "test-model",
    sampleRate: 16_000,
  });
  await new Promise((resolve) => setImmediate(resolve));

  socket.bufferedAmount = 100;
  audio.worklet.emit(new Float32Array(1_280));
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 0);

  socket.bufferedAmount = 0;
  audio.worklet.emit(new Float32Array(1_280));
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 1);
  session.abort();
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: "transcription.abort" });
  assert.equal(media.track.stopCalls, 1);
});

test("falls back to ScriptProcessor and aborts cleanly", async () => {
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const source = {
    connect() {},
    disconnectCalls: 0,
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
  const processor = {
    onaudioprocess: null,
    connect() {},
    disconnectCalls: 0,
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
  const context = {
    sampleRate: 48_000,
    destination: {},
    state: "running",
    createMediaStreamSource: () => source,
    createScriptProcessor: () => processor,
    async close() {},
  };
  const endReasons = [];
  const session = createRealtimeSpeechSession(
    { onFinal() {}, onEnd: (reason) => endReasons.push(reason) },
    { url: "ws://localhost/transcription/ws" },
    {
      createWebSocket: () => socket,
      getUserMedia: async () => media.stream,
      createAudioContext: () => context,
    },
  );

  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  socket.serverMessage({
    type: "transcription.ready",
    provider: "test",
    model: "test-model",
    sampleRate: 16_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof processor.onaudioprocess, "function");

  processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array(3_840).fill(-0.25) },
  });
  const binaryFrames = socket.sent.filter((entry) => entry instanceof ArrayBuffer);
  assert.equal(binaryFrames.length, 1);
  assert.equal(binaryFrames[0].byteLength, 2_560);

  session.abort();
  assert.deepEqual(endReasons, ["aborted"]);
  assert.equal(media.track.stopCalls, 1);
  assert.equal(source.disconnectCalls, 1);
  assert.equal(processor.disconnectCalls, 1);
});

test("does not open a provider websocket when microphone access fails", async () => {
  let socketCreations = 0;
  const context = {
    sampleRate: 48_000,
    destination: {},
    state: "running",
    createMediaStreamSource() {
      throw new Error("not reached");
    },
    async close() {},
  };
  const errors = [];
  const endReasons = [];
  const session = createRealtimeSpeechSession(
    {
      onFinal() {},
      onError: (message, code) => errors.push({ message, code }),
      onEnd: (reason) => endReasons.push(reason),
    },
    { url: "ws://localhost/transcription/ws" },
    {
      createWebSocket() {
        socketCreations += 1;
        return new FakeSocket();
      },
      getUserMedia: async () => {
        throw new Error("permission denied in test");
      },
      createAudioContext: () => context,
    },
  );

  session.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socketCreations, 0);
  assert.deepEqual(errors, [
    { message: "permission denied in test", code: "MICROPHONE_UNAVAILABLE" },
  ]);
  assert.deepEqual(endReasons, ["error"]);
});
