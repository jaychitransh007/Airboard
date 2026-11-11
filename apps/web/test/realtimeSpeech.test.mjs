import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedKeyterms,
  buildRealtimeTranscriptionWebSocketUrl,
  createRealtimeSpeechSession,
  createSpeechGate,
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
  audio.worklet.emit(new Float32Array(1_280).fill(0.2));
  assert.equal(socket.sent.filter((entry) => entry instanceof ArrayBuffer).length, 0);

  socket.bufferedAmount = 0;
  audio.worklet.emit(new Float32Array(1_280).fill(0.2));
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

test("a signed-in session exchanges its token for a ticket and keeps the token out of the socket URL", async () => {
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const exchanged = [];
  const opened = [];
  const session = createRealtimeSpeechSession(
    { onFinal() {} },
    { apiBaseUrl: "https://api.example.com", accessToken: "sign-in-jwt" },
    {
      fetchTranscriptionTicket: async (apiBaseUrl, accessToken) => {
        exchanged.push([apiBaseUrl, accessToken]);
        return "one-minute-ticket";
      },
      createWebSocket: (url) => {
        opened.push(url);
        return socket;
      },
      getUserMedia: async () => media.stream,
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:test",
      revokeAudioWorkletModuleUrl() {},
    },
  );

  session.start();
  for (let i = 0; i < 5 && opened.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exchanged, [["https://api.example.com", "sign-in-jwt"]]);
  assert.deepEqual(opened, ["wss://api.example.com/transcription/ws?ticket=one-minute-ticket"]);
  assert.equal(opened[0].includes("sign-in-jwt"), false);
  assert.equal(session.url, "wss://api.example.com/transcription/ws", "the reported URL carries no credential");
  session.abort();
});

test("a refused ticket reports the same message as a refused socket", async () => {
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const errors = [];
  const { TranscriptionTicketError } = await import("../src/features/board/realtimeSpeech.ts");
  const session = createRealtimeSpeechSession(
    { onFinal() {}, onError: (message, code) => errors.push({ message, code }) },
    { apiBaseUrl: "https://api.example.com", accessToken: "sign-in-jwt" },
    {
      fetchTranscriptionTicket: async () => {
        throw new TranscriptionTicketError("ACTIVE_ENTITLEMENT_REQUIRED");
      },
      createWebSocket: () => {
        throw new Error("no socket should open");
      },
      getUserMedia: async () => media.stream,
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:test",
      revokeAudioWorkletModuleUrl() {},
    },
  );
  session.start();
  for (let i = 0; i < 5 && errors.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "ACTIVE_ENTITLEMENT_REQUIRED");
  assert.match(errors[0].message, /pilot access has ended/);
});

const { TranscriptionTicketError } = await import("../src/features/board/realtimeSpeech.ts");

async function flushAsync() {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// The server or network ends the socket; nothing on the client closed it.
function serverClose(socket, code, reason = "") {
  socket.readyState = 3;
  socket.emit("close", { code, reason });
}

function createReconnectHarness(options = {}, { random = () => 1 } = {}) {
  const ends = [];
  const sockets = [];
  const tickets = [];
  const timers = [];
  const events = [];
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  let clock = 0;
  let token = "first-jwt";
  const ticketRefusals = [];
  const session = createRealtimeSpeechSession(
    {
      onReady: () => events.push(["ready"]),
      onReconnecting: (cause, attempt) => events.push(["reconnecting", cause, attempt]),
      onReconnected: () => events.push(["reconnected"]),
      onListening: (listening) => events.push(["listening", listening]),
      onFinal() {},
      onError: (message, code) => events.push(["error", message, code]),
      onEnd: (reason, detail) => {
        events.push(["end", reason]);
        ends.push({ reason, ...detail });
      },
    },
    {
      apiBaseUrl: "https://api.example.com",
      accessToken: "first-jwt",
      getAccessToken: () => token,
      reconnect: true,
      ...options,
    },
    {
      fetchTranscriptionTicket: async (_apiBaseUrl, accessToken) => {
        tickets.push(accessToken);
        const refusal = ticketRefusals.shift();
        if (refusal) throw new TranscriptionTicketError(refusal);
        return `ticket-${tickets.length}`;
      },
      createWebSocket: (url) => {
        const socket = new FakeSocket();
        socket.url = url;
        sockets.push(socket);
        return socket;
      },
      getUserMedia: async () => media.stream,
      createAudioContext: () => audio.context,
      createAudioWorkletNode: () => audio.worklet,
      createAudioWorkletModuleUrl: () => "blob:test",
      revokeAudioWorkletModuleUrl() {},
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, done: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timer.done = true;
      },
      now: () => clock,
      random,
    },
  );
  return {
    session,
    ends,
    refuseNextTicket: (code) => ticketRefusals.push(code),
    sockets,
    tickets,
    events,
    media,
    audio,
    latest: () => sockets.at(-1),
    setToken: (next) => {
      token = next;
    },
    advance: (ms) => {
      clock += ms;
    },
    pendingTimers: () => timers.filter((timer) => !timer.done),
    async runTimer() {
      const timer = timers.find((candidate) => !candidate.done);
      assert.ok(timer, "a reconnect is scheduled");
      timer.done = true;
      timer.callback();
      await flushAsync();
      return timer.delayMs;
    },
    async start() {
      session.start();
      await flushAsync();
    },
    async openAndReady(socket = sockets.at(-1)) {
      socket.open();
      socket.serverMessage({
        type: "transcription.ready",
        provider: "deepgram",
        model: "flux-general-en",
        sampleRate: 16_000,
      });
      await flushAsync();
    },
  };
}

const MINUTE = 60_000;

test("a server restart or network drop reopens the stream with a fresh ticket while the microphone stays open", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  await voice.openAndReady();
  assert.equal(voice.session.isListening(), true);

  // The founder deploys: the API closes every socket with 1012.
  serverClose(voice.sockets[0], 1012, "SERVICE_RESTART");
  assert.deepEqual(voice.events.slice(-2), [["listening", false], ["reconnecting", "dropped", 1]]);
  assert.equal(voice.media.track.stopCalls, 0, "the microphone stays open");
  assert.equal(voice.audio.context.closeCalls, 0);

  voice.setToken("refreshed-jwt");
  assert.equal(await voice.runTimer(), 1_000);
  assert.deepEqual(voice.tickets, ["first-jwt", "refreshed-jwt"], "the reconnect uses the latest sign-in");
  assert.equal(voice.sockets.length, 2);
  assert.equal(voice.sockets[1].url, "wss://api.example.com/transcription/ws?ticket=ticket-2");

  await voice.openAndReady();
  assert.equal(JSON.parse(voice.sockets[1].sent[0]).type, "transcription.start");
  assert.deepEqual(voice.events.slice(-2), [["reconnected"], ["listening", true]]);
  assert.equal(voice.events.filter(([name]) => name === "ready").length, 1, "only the first stream reports onReady");
  assert.equal(voice.events.some(([name]) => name === "end" || name === "error"), false);

  // Audio flows to the new stream, not the dropped one.
  const sentBefore = voice.sockets[0].sent.length;
  voice.audio.worklet.emit(new Float32Array(1_280).fill(0.2));
  assert.equal(voice.sockets[0].sent.length, sentBefore);
  assert.ok(voice.sockets[1].sent.some((data) => data instanceof ArrayBuffer));
  voice.session.abort();
});

test("the per-stream time limit rolls over at once while people talk, and pauses a quiet tab", async () => {
  const talking = createReconnectHarness({ quietPauseMs: 20 * MINUTE });
  await talking.start();
  await talking.openAndReady();
  talking.advance(25 * MINUTE);
  talking.latest().serverMessage({ type: "transcription.partial", transcript: "so the API calls the queue" });
  talking.advance(5 * MINUTE);
  talking.latest().serverMessage({
    type: "transcription.error",
    code: "TRANSCRIPTION_SESSION_LIMIT",
    message: "This voice stream reached its maximum length.",
    fatal: true,
  });
  assert.deepEqual(talking.events.at(-1), ["reconnecting", "rollover", 1]);
  assert.deepEqual(talking.sockets[0].closeCalls, [{ code: 1000, reason: "transcription reconnecting" }]);
  assert.equal(await talking.runTimer(), 0, "a rollover reconnects without waiting");
  await talking.openAndReady();
  assert.equal(talking.session.isListening(), true);
  assert.equal(talking.events.some(([name]) => name === "error" || name === "end"), false);
  talking.session.abort();

  const quiet = createReconnectHarness({ quietPauseMs: 20 * MINUTE });
  await quiet.start();
  await quiet.openAndReady();
  quiet.advance(30 * MINUTE);
  quiet.latest().serverMessage({
    type: "transcription.error",
    code: "TRANSCRIPTION_SESSION_LIMIT",
    message: "This voice stream reached its maximum length.",
    fatal: true,
  });
  assert.deepEqual(quiet.events.at(-1), ["end", "paused"]);
  assert.deepEqual(quiet.ends, [{ reason: "paused", wakeable: true }]);
  assert.equal(quiet.events.some(([name]) => name === "error"), false);
  assert.equal(quiet.media.track.stopCalls, 1, "a paused session releases the microphone");
  assert.equal(quiet.pendingTimers().length, 0);
});

test("a busy server is retried with growing waits, then voice ends with a plain message", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  const refuse = () => {
    voice.latest().open();
    voice.latest().serverMessage({
      type: "transcription.error",
      code: "TRANSCRIPTION_CAPACITY_REACHED",
      message: "The realtime transcription service is at capacity. Try again shortly.",
      fatal: true,
    });
  };
  refuse();
  const delays = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    delays.push(await voice.runTimer());
    refuse();
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 15_000, 20_000, 30_000]);
  assert.deepEqual(voice.ends, [{ reason: "error", wakeable: true }], "a later try may work, so voice can be woken");
  const [, message, code] = voice.events.find(([name]) => name === "error");
  assert.match(message, /busy right now/);
  assert.equal(code, "TRANSCRIPTION_CAPACITY_REACHED");
  assert.deepEqual(voice.events.at(-1), ["end", "error"]);
  assert.equal(voice.media.track.stopCalls, 1);
  assert.equal(voice.pendingTimers().length, 0);
});

test("a refusal a new stream can't fix still ends voice at once", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  await voice.openAndReady();
  voice.latest().serverMessage({
    type: "transcription.error",
    code: "DAILY_VOICE_LIMIT",
    message: "You've used today's Airo voice minutes.",
    fatal: true,
  });
  assert.equal(voice.events.find(([name]) => name === "error")[2], "DAILY_VOICE_LIMIT");
  assert.deepEqual(voice.events.at(-1), ["end", "error"]);
  assert.deepEqual(voice.ends, [{ reason: "error", wakeable: false }], "a palm must not restart it");
  assert.equal(voice.pendingTimers().length, 0);

  // On a first start, the per-account limit means another tab has voice on.
  const second = createReconnectHarness();
  await second.start();
  second.latest().open();
  second.latest().serverMessage({
    type: "transcription.error",
    code: "TRANSCRIPTION_PROFILE_LIMIT",
    message: "This account already has the maximum number of live transcription streams.",
    fatal: true,
  });
  assert.equal(second.events.find(([name]) => name === "error")[2], "TRANSCRIPTION_PROFILE_LIMIT");
  assert.equal(second.pendingTimers().length, 0);
});

test("turning voice off during a reconnect cancels it", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  await voice.openAndReady();
  serverClose(voice.sockets[0], 1006);
  assert.deepEqual(voice.events.at(-1), ["reconnecting", "dropped", 1]);
  voice.session.stop();
  assert.deepEqual(voice.events.at(-1), ["end", "stopped"]);
  assert.equal(voice.pendingTimers().length, 0);
  assert.equal(voice.sockets.length, 1);
});

test("a stream that drops right after opening gives up instead of looping, and a healthy stream starts afresh", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  await voice.openAndReady();
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    serverClose(voice.latest(), 1006);
    assert.deepEqual(voice.events.at(-1), ["reconnecting", "dropped", attempt]);
    await voice.runTimer();
    await voice.openAndReady();
  }
  serverClose(voice.latest(), 1006);
  const [, message, code] = voice.events.find(([name]) => name === "error");
  assert.match(message, /dropped and couldn't reconnect/);
  assert.equal(code, "TRANSCRIPTION_RECONNECT_FAILED");
  assert.deepEqual(voice.events.at(-1), ["end", "error"]);

  const steady = createReconnectHarness();
  await steady.start();
  await steady.openAndReady();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    serverClose(steady.latest(), 1006);
    await steady.runTimer();
    await steady.openAndReady();
  }
  steady.advance(31_000);
  serverClose(steady.latest(), 1006);
  assert.deepEqual(steady.events.at(-1), ["reconnecting", "dropped", 1]);
  steady.session.abort();
});

test("without reconnect, a dropped stream still ends as closed", async () => {
  const voice = createReconnectHarness({ reconnect: false });
  await voice.start();
  await voice.openAndReady();
  serverClose(voice.sockets[0], 1012, "SERVICE_RESTART");
  assert.deepEqual(voice.events.at(-1), ["end", "closed"]);
  assert.equal(voice.pendingTimers().length, 0);
});

test("after a stream has worked, a provider failure or an expired sign-in reconnects; on a first start it doesn't", async () => {
  const voice = createReconnectHarness();
  await voice.start();
  await voice.openAndReady();
  // The API's socket to Deepgram resets mid-stream.
  voice.latest().serverMessage({
    type: "transcription.error",
    code: "PROVIDER_SOCKET_ERROR",
    message: "read ECONNRESET",
    fatal: true,
  });
  assert.deepEqual(voice.events.at(-1), ["reconnecting", "dropped", 1]);
  assert.equal(voice.media.track.stopCalls, 0);

  // The laptop slept past the token's lifetime: the first ticket is refused,
  // and the next attempt reads the refreshed token.
  voice.refuseNextTicket("Airboard authentication required");
  await voice.runTimer();
  assert.deepEqual(voice.events.at(-1), ["reconnecting", "dropped", 2]);
  voice.setToken("refreshed-jwt");
  await voice.runTimer();
  assert.equal(voice.tickets.at(-1), "refreshed-jwt");
  await voice.openAndReady();
  assert.equal(voice.session.isListening(), true);
  assert.equal(voice.events.some(([name]) => name === "error" || name === "end"), false);
  voice.session.abort();

  const first = createReconnectHarness();
  first.refuseNextTicket("Airboard authentication required");
  await first.start();
  assert.equal(first.events.find(([name]) => name === "error")[2], "Airboard authentication required");
  assert.deepEqual(first.ends, [{ reason: "error", wakeable: false }]);
  assert.equal(first.pendingTimers().length, 0);
});

test("reconnect waits are spread between half and all of each step, and a rate-limited close counts as busy", async () => {
  const voice = createReconnectHarness({}, { random: () => 0 });
  await voice.start();
  await voice.openAndReady();
  serverClose(voice.latest(), 1013, "RATE_LIMITED");
  assert.deepEqual(voice.events.at(-1), ["reconnecting", "busy", 1]);
  assert.equal(await voice.runTimer(), 500);
  serverClose(voice.latest(), 1006);
  assert.equal(await voice.runTimer(), 1_000);
  voice.session.abort();
});

test("the speech gate sends speech with a moment either side, and holds back silence", () => {
  const gate = createSpeechGate({ hangoverMs: 160, preRollMs: 160 });
  const quiet = (tag) => Object.assign(new Float32Array(1_280).fill(0.001), { tag });
  const loud = (tag) => Object.assign(new Float32Array(1_280).fill(0.2), { tag });
  const tags = (frames) => frames.map((frame) => frame.tag);

  // Silence is held back; only the last two quiet frames are kept.
  assert.deepEqual(tags(gate.push(quiet("q1"))), []);
  assert.deepEqual(tags(gate.push(quiet("q2"))), []);
  assert.deepEqual(tags(gate.push(quiet("q3"))), []);
  assert.equal(gate.isOpen(), false);
  // Speech opens the gate with the quiet lead-in, so the onset is not clipped.
  assert.deepEqual(tags(gate.push(loud("s1"))), ["q2", "q3", "s1"]);
  assert.deepEqual(tags(gate.push(loud("s2"))), ["s2"]);
  // A short pause inside speech is still sent.
  assert.deepEqual(tags(gate.push(quiet("p1"))), ["p1"]);
  assert.deepEqual(tags(gate.push(loud("s3"))), ["s3"]);
  // After the hangover the gate closes again.
  assert.deepEqual(tags(gate.push(quiet("t1"))), ["t1"]);
  assert.deepEqual(tags(gate.push(quiet("t2"))), ["t2"]);
  assert.deepEqual(tags(gate.push(quiet("t3"))), []);
  assert.equal(gate.isOpen(), false);
});

test("a session streams only speech, unless the gate is turned off", async () => {
  for (const silenceGate of [undefined, false]) {
    const socket = new FakeSocket();
    const media = createMediaStreamHarness();
    const audio = createWorkletAudioHarness();
    const session = createRealtimeSpeechSession(
      { onFinal() {} },
      { url: "ws://localhost/transcription/ws", ...(silenceGate === false ? { silenceGate } : {}) },
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
    socket.serverMessage({ type: "transcription.ready", provider: "test", model: "m", sampleRate: 16_000 });
    await new Promise((resolve) => setImmediate(resolve));
    const binary = () => socket.sent.filter((entry) => entry instanceof ArrayBuffer).length;

    // Ten seconds of silence.
    for (let frame = 0; frame < 125; frame += 1) audio.worklet.emit(new Float32Array(1_280));
    assert.equal(binary(), silenceGate === false ? 125 : 0);
    // Then a word: it goes out with its lead-in.
    audio.worklet.emit(new Float32Array(1_280).fill(0.1));
    assert.equal(binary(), silenceGate === false ? 126 : 7);
    session.abort();
  }
});

test("allowance warnings from the API reach the page", async () => {
  const warnings = [];
  const socket = new FakeSocket();
  const media = createMediaStreamHarness();
  const audio = createWorkletAudioHarness();
  const session = createRealtimeSpeechSession(
    { onFinal() {}, onAllowanceWarning: (warning) => warnings.push(warning) },
    { url: "ws://localhost/transcription/ws" },
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
  socket.serverMessage({ type: "transcription.ready", provider: "test", model: "m", sampleRate: 16_000 });
  await new Promise((resolve) => setImmediate(resolve));
  socket.serverMessage({
    type: "transcription.allowance_warning",
    remainingMinutes: 14,
    scope: "personal",
    message: "About 14 minutes of Airo voice left today. Typed commands keep working, and voice is back at midnight UTC.",
  });
  socket.serverMessage({ type: "transcription.allowance_warning", remainingMinutes: 4.6, scope: "service" });
  socket.serverMessage({ type: "transcription.allowance_warning", scope: "personal" });
  assert.deepEqual(warnings, [
    {
      remainingMinutes: 14,
      scope: "personal",
      message: "About 14 minutes of Airo voice left today. Typed commands keep working, and voice is back at midnight UTC.",
    },
    { remainingMinutes: 4, scope: "service", message: "About 4 minutes of Airo voice left today. Typed commands keep working." },
  ]);
  assert.equal(session.isListening(), true, "a warning does not interrupt voice");
  session.abort();
});

test("a server-side stream renewal is invisible while people talk, and pauses a quiet tab", async () => {
  const talking = createReconnectHarness({ quietPauseMs: 20 * MINUTE });
  await talking.start();
  await talking.openAndReady();
  talking.advance(25 * MINUTE);
  talking.latest().serverMessage({ type: "transcription.partial", transcript: "so the API calls the queue" });
  talking.advance(5 * MINUTE);
  const eventsBefore = talking.events.length;
  talking.latest().serverMessage({ type: "transcription.renewing" });
  assert.equal(talking.events.length, eventsBefore, "no reconnect, no listening change");
  assert.equal(talking.sockets.length, 1);
  assert.equal(talking.session.isListening(), true);
  talking.session.abort();

  const quiet = createReconnectHarness({ quietPauseMs: 20 * MINUTE });
  await quiet.start();
  await quiet.openAndReady();
  quiet.advance(30 * MINUTE);
  quiet.latest().serverMessage({ type: "transcription.renewing" });
  assert.deepEqual(quiet.ends, [{ reason: "paused", wakeable: true }]);
  assert.deepEqual(quiet.sockets[0].closeCalls, [{ code: 1000, reason: "transcription paused" }]);
  assert.equal(quiet.media.track.stopCalls, 1);
});
