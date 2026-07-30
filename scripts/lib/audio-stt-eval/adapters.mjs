import { createRequire } from "node:module";

import {
  acceptDeepgramFinal,
  translateDeepgramFluxMessage,
} from "../../../apps/api/src/transcription/deepgramFluxProtocol.ts";
import {
  parseTranscriptionControlMessage,
} from "../../../apps/api/src/transcription/protocol.ts";
import {
  createRealtimeSpeechSession,
  buildRealtimeTranscriptionWebSocketUrl,
  DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
} from "../../../apps/web/src/features/board/realtimeSpeech.ts";
import {
  MEET_MEDIA_BRIDGE_MARKER,
  MEET_MEDIA_BRIDGE_VERSION,
  probeMeetMediaBridge,
} from "../../../apps/web/src/features/meet/meetMediaBridge.ts";
import { streamPcm16WavFrames } from "./wav.mjs";

const requireFromApi = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);

export function createFakeTranscriptionAdapter() {
  return {
    id: "fake",
    requiresAsset: false,
    async run({ scenario }) {
      if (!Array.isArray(scenario.source.events)) {
        throw new Error("Fake STT scenarios require source.events.");
      }
      return {
        events: scenario.source.events.map(validateProviderNeutralEvent),
        diagnostics: { source: "synthetic", inputEvents: scenario.source.events.length },
      };
    },
  };
}

export function createDeepgramReplayAdapter() {
  return {
    id: "deepgram-replay",
    requiresAsset: false,
    async run({ scenario }) {
      const seenFinals = new Set();
      const events = [];
      const messages = [
        ...(scenario.source.messages ?? []).map((message) => JSON.stringify(message)),
        ...(scenario.source.rawMessages ?? []),
      ];
      if (messages.length === 0) {
        throw new Error("Deepgram replay scenarios require provider messages.");
      }
      for (const message of messages) {
        const translation = translateDeepgramFluxMessage(message);
        if (
          translation.finalDedupeKey &&
          !acceptDeepgramFinal(seenFinals, translation.finalDedupeKey)
        ) {
          events.push(
            ...translation.events.filter((event) => event.type !== "final"),
          );
          continue;
        }
        events.push(...translation.events);
      }
      return {
        events,
        diagnostics: {
          source: "redacted-provider-replay",
          inputMessages: messages.length,
          outputEvents: events.length,
        },
      };
    },
  };
}

export function createLiveGatewayWebSocketAdapter(defaults = {}) {
  return {
    id: "live-websocket",
    requiresAsset: true,
    liveProvider: true,
    retryTransientFailures: true,
    async run({ scenario, asset, signal }) {
      if (isMeetSurface(scenario.surface) || scenario.transport === "meet-bridge") {
        throw new Error(
          "Meet audio must use the meet-bridge-replay adapter; direct WebSocket WAV streaming is not Meet transport.",
        );
      }
      if (!asset?.wav) {
        throw new Error("Live STT scenarios require a verified PCM16 WAV asset.");
      }
      return streamLiveGatewayScenario({
        scenario,
        asset,
        signal,
        ...defaults,
      });
    },
  };
}

/**
 * Replays a verified WAV through the production Meet bridge protocol and the
 * production realtime speech session before it reaches the live STT gateway.
 *
 * The host half intentionally emits the same Float32 `audio-chunk` messages as
 * the Chrome extension. `probeMeetMediaBridge` performs the production
 * source/origin/protocol checks, while `createRealtimeSpeechSession` performs
 * the production PCM ingestion, resampling, 80 ms framing, backpressure, and
 * transcription control flow. This makes the transport claim observable
 * without pretending a direct Node WebSocket upload traversed Meet.
 */
export function createMeetBridgeReplayAdapter(defaults = {}) {
  return {
    id: "meet-bridge-replay",
    requiresAsset: true,
    liveProvider: true,
    retryTransientFailures: true,
    async run({ scenario, asset, signal }) {
      if (!isMeetSurface(scenario.surface) || scenario.transport !== "meet-bridge") {
        throw new Error(
          "Meet bridge replay requires a Meet surface and transport=meet-bridge.",
        );
      }
      if (!asset?.wav) {
        throw new Error(
          "Meet bridge replay scenarios require a verified PCM16 WAV asset.",
        );
      }
      return streamMeetBridgeScenario({
        scenario,
        asset,
        signal,
        ...defaults,
      });
    },
  };
}

async function streamLiveGatewayScenario({
  scenario,
  asset,
  signal,
  createWebSocket = defaultCreateWebSocket,
  url,
  apiBaseUrl,
  accessToken,
  apiToken,
  timeoutMs = 30_000,
  frameDelayMs = REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
  maxBufferedBytes = DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  origin = "http://localhost:3000",
}) {
  const socketUrl = buildLiveGatewaySocketUrl(
    scenario.source.url ?? url,
    scenario.source.apiBaseUrl ?? apiBaseUrl,
    accessToken,
    apiToken,
  );
  const socket = createWebSocket(socketUrl, { origin });
  const events = [];
  const effectiveTimeoutMs = Math.max(
    timeoutMs,
    frameDelayMs > 0
      ? Math.ceil(asset.wav.durationSeconds * 1_000) + 30_000
      : Math.min(
          600_000,
          30_000 + Math.ceil(asset.wav.durationSeconds * 50),
        ),
  );
  const startMessage = {
    type: "transcription.start",
    sampleRate: asset.wav.sampleRate,
    ...(typeof scenario.source.language === "string"
      ? { language: scenario.source.language }
      : {}),
    ...(typeof scenario.source.model === "string"
      ? { model: scenario.source.model }
      : {}),
    ...(Array.isArray(scenario.source.keyterms)
      ? { keyterms: scenario.source.keyterms }
      : {}),
  };
  assertControlMessage(startMessage);

  return await new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let streaming = false;
    let framesSent = 0;
    let pcmBytesSent = 0;
    let audioEndedAtMs = null;
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `Live transcription scenario exceeded ${effectiveTimeoutMs}ms.`,
          ),
        ),
      effectiveTimeoutMs,
    );
    const abort = () => fail(new Error("Live transcription scenario was aborted."));
    signal?.addEventListener("abort", abort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (typeof socket.readyState !== "number" || socket.readyState < 2) {
          socket.close(1000, "audio-stt-eval completed");
        }
      } catch {
        // The gateway may have already closed the socket.
      }
      resolveRun({
        events,
        timing: {
          audioEndedAtMs,
        },
        diagnostics: {
          source: "live-gateway",
          framesSent,
          pcmBytesSent,
        },
      });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close(1011, "audio-stt-eval failed");
      } catch {
        // Socket may already be closed.
      }
      rejectRun(error);
    };

    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(startMessage));
    });
    socket.addEventListener("message", (event) => {
      const message = parseGatewayMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "transcription.ready":
          if (message.sampleRate !== asset.wav.sampleRate) {
            fail(
              new Error(
                `Transcription gateway acknowledged ${message.sampleRate} Hz for a ${asset.wav.sampleRate} Hz WAV.`,
              ),
            );
            return;
          }
          if (!streaming) {
            streaming = true;
            void sendFrames().catch(fail);
          }
          return;
        case "transcription.partial":
        case "transcription.final": {
          const transcript =
            typeof message.transcript === "string" ? message.transcript.trim() : "";
          if (!transcript) return;
          events.push({
            type:
              message.type === "transcription.partial"
                ? "partial"
                : "final",
            transcript,
            ...(typeof message.turnIndex === "number"
              ? { turnIndex: message.turnIndex }
              : {}),
            ...(typeof message.confidence === "number"
              ? { confidence: message.confidence }
              : {}),
            ...(typeof message.providerEvent === "string"
              ? { providerEvent: message.providerEvent }
              : {}),
          });
          return;
        }
        case "transcription.provider":
          if (typeof message.status === "string") {
            events.push({
              type: "status",
              status: normalizeProviderStatus(message.status),
              ...(typeof message.requestId === "string"
                ? { requestId: message.requestId }
                : {}),
            });
          }
          return;
        case "transcription.error": {
          const fatal = message.fatal !== false;
          events.push({
            type: "error",
            code:
              typeof message.code === "string"
                ? message.code
                : "TRANSCRIPTION_ERROR",
            message:
              typeof message.message === "string"
                ? message.message
                : "The transcription gateway reported an error.",
            fatal,
          });
          if (fatal) finish();
          return;
        }
        case "transcription.stopped":
          finish();
          return;
        default:
          return;
      }
    });
    socket.addEventListener("error", () => {
      fail(new Error("Could not connect to the Airboard transcription WebSocket."));
    });
    socket.addEventListener("close", () => {
      if (!settled) {
        if (streaming) finish();
        else fail(new Error("Transcription WebSocket closed before it became ready."));
      }
    });

    async function sendFrames() {
      for (const frame of streamPcm16WavFrames(asset.wav)) {
        if (settled) {
          throw new Error("Live transcription scenario ended before audio streaming completed.");
        }
        while (socket.bufferedAmount >= maxBufferedBytes) {
          if (settled) {
            throw new Error("Live transcription scenario ended while waiting for socket backpressure.");
          }
          await delay(Math.min(10, Math.max(1, frameDelayMs)));
        }
        socket.send(frame);
        framesSent += 1;
        pcmBytesSent += frame.byteLength;
        if (frameDelayMs > 0) {
          await delay(frameDelayMs);
        }
      }
      audioEndedAtMs = performance.now();
      const stopMessage = { type: "transcription.stop" };
      assertControlMessage(stopMessage);
      socket.send(JSON.stringify(stopMessage));
    }
  });
}

async function streamMeetBridgeScenario({
  scenario,
  asset,
  signal,
  createWebSocket = defaultCreateWebSocket,
  url,
  apiBaseUrl,
  accessToken,
  apiToken,
  timeoutMs = 30_000,
  frameDelayMs = REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
  maxBufferedBytes = DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  origin = "http://localhost:3000",
}) {
  const socketUrl = buildLiveGatewaySocketUrl(
    scenario.source.url ?? url,
    scenario.source.apiBaseUrl ?? apiBaseUrl,
    accessToken,
    apiToken,
  );
  const effectiveTimeoutMs = Math.max(
    timeoutMs,
    frameDelayMs > 0
      ? Math.ceil(
          asset.wav.durationSeconds *
            (frameDelayMs / REALTIME_TRANSCRIPTION_FRAME_DURATION_MS) *
            1_000,
        ) + 30_000
      : Math.min(
          600_000,
          30_000 + Math.ceil(asset.wav.durationSeconds * 50),
        ),
  );
  const hostWindow = Object.freeze({ id: "meet-bridge-replay-host" });
  const allowedOrigin = "https://meet.google.com";
  const listeners = new Set();
  const events = [];
  let bridgeChunksSent = 0;
  let bridgeSamplesSent = 0;
  let audioEndedAtMs = null;
  let speechSession = null;
  let activeSocket = null;
  let settled = false;
  let pumpStarted = false;
  let hostStopped = false;
  let resolveServerReady;
  let rejectTransport = () => {};
  let pumpBridgeAudio = async () => {};
  const serverReady = new Promise((resolveReady) => {
    resolveServerReady = resolveReady;
  });

  const emitHostMessage = (type, fields = {}) => {
    const event = {
      origin: allowedOrigin,
      source: hostWindow,
      data: {
        bridge: MEET_MEDIA_BRIDGE_MARKER,
        v: MEET_MEDIA_BRIDGE_VERSION,
        type,
        ...fields,
      },
    };
    for (const listener of [...listeners]) {
      listener(event);
    }
  };
  const environment = {
    listen(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    postToHost(message) {
      if (message.type === "hello") {
        emitHostMessage("ready");
        return;
      }
      if (message.type === "start-audio") {
        // Resolve the production bridge session before opening the WebSocket.
        // The priming sample is discarded while realtimeSpeech is still in
        // `starting`, exactly as an early extension chunk would be.
        emitHostMessage("audio-chunk", {
          seq: 0,
          sampleRate: asset.wav.sampleRate,
          samples: new Float32Array(1).buffer,
        });
        void serverReady
          .then(() => pumpBridgeAudio())
          .catch((error) => rejectTransport(error));
        return;
      }
      if (message.type === "stop-audio") {
        hostStopped = true;
      }
    },
    hostWindow,
    allowedOrigins: [allowedOrigin],
    helloAttempts: 1,
    helloIntervalMs: 1,
    firstFrameTimeoutMs: Math.min(effectiveTimeoutMs, 8_000),
  };
  const bridge = await probeMeetMediaBridge(environment);
  if (!bridge) {
    throw new Error("The production Meet media bridge replay did not answer.");
  }

  return await new Promise((resolveRun, rejectRun) => {
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `Meet bridge transcription scenario exceeded ${effectiveTimeoutMs}ms.`,
          ),
        ),
      effectiveTimeoutMs,
    );
    const abort = () =>
      fail(new Error("Meet bridge transcription scenario was aborted."));
    signal?.addEventListener("abort", abort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveRun({
        events,
        timing: { audioEndedAtMs },
        diagnostics: {
          source: "meet-bridge-replay",
          transportVerified: true,
          bridgeProtocolVersion: MEET_MEDIA_BRIDGE_VERSION,
          bridgeChunksSent,
          bridgeSamplesSent,
          bridgeStopObserved: hostStopped,
        },
      });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      speechSession?.abort();
      rejectRun(error);
    };
    rejectTransport = fail;
    const socketFactory = (requestedUrl) => {
      const socket = createWebSocket(requestedUrl, { origin });
      activeSocket = socket;
      socket.addEventListener("message", (event) => {
        const message = parseGatewayMessage(event.data);
        if (message?.type === "transcription.ready") {
          resolveServerReady();
        }
      });
      return socket;
    };

    speechSession = createRealtimeSpeechSession(
      {
        onInterim: (transcript, event) => {
          events.push(providerNeutralTranscript("partial", transcript, event));
        },
        onFinal: (transcript, event) => {
          events.push(providerNeutralTranscript("final", transcript, event));
        },
        onProviderStatus: (event) => {
          events.push({
            type: "status",
            status: normalizeProviderStatus(event.status),
          });
        },
        onError: (message, code) => {
          events.push({
            type: "error",
            code: code ?? "TRANSCRIPTION_ERROR",
            message,
            fatal: false,
          });
        },
        onEnd: (reason) => {
          if (reason === "error" || reason === "closed") {
            const lastError = [...events]
              .reverse()
              .find((event) => event.type === "error");
            if (lastError) {
              lastError.fatal = true;
            } else {
              events.push({
                type: "error",
                code: "TRANSCRIPTION_CLOSED",
                message: `Realtime transcription ended: ${reason}.`,
                fatal: true,
              });
            }
          }
          finish();
        },
      },
      {
        url: socketUrl,
        language: scenario.source.language,
        model: scenario.source.model,
        keyterms: scenario.source.keyterms,
        maxBufferedBytes,
      },
      {
        createWebSocket: socketFactory,
        startPcmInput: (handlers) => bridge.startAudio(handlers),
      },
    );
    if (!speechSession) {
      fail(
        new Error(
          "The production realtime speech session could not start with Meet bridge PCM input.",
        ),
      );
      return;
    }
    speechSession.start();

    pumpBridgeAudio = async () => {
      if (pumpStarted || settled) return;
      pumpStarted = true;
      // Let the production ready handler transition to listening before the
      // replay sends the first real asset sample.
      await delay(0);
      const frameSamples = Math.max(
        1,
        Math.round(
          (asset.wav.sampleRate * REALTIME_TRANSCRIPTION_FRAME_DURATION_MS) /
            1_000,
        ),
      );
      let sequence = 1;
      for (
        let sampleOffset = 0;
        sampleOffset < asset.wav.sampleCount;
        sampleOffset += frameSamples
      ) {
        if (settled || signal?.aborted) {
          throw new Error("Meet bridge replay ended before the WAV was consumed.");
        }
        while (
          activeSocket &&
          activeSocket.bufferedAmount >= maxBufferedBytes
        ) {
          if (settled || signal?.aborted) {
            throw new Error(
              "Meet bridge replay ended while waiting for gateway backpressure.",
            );
          }
          await delay(Math.min(10, Math.max(1, frameDelayMs)));
        }
        const sampleCount = Math.min(
          frameSamples,
          asset.wav.sampleCount - sampleOffset,
        );
        const samples = pcm16ToFloat32(
          asset.wav.pcmBytes,
          sampleOffset,
          sampleCount,
        );
        emitHostMessage("audio-chunk", {
          seq: sequence,
          sampleRate: asset.wav.sampleRate,
          samples: samples.buffer,
        });
        sequence += 1;
        bridgeChunksSent += 1;
        bridgeSamplesSent += samples.length;
        if (frameDelayMs > 0) {
          await delay(frameDelayMs);
        }
      }
      audioEndedAtMs = performance.now();
      speechSession.stop();
    };
  });
}

export function buildLiveGatewaySocketUrl(
  explicitUrl,
  apiBaseUrl,
  accessToken,
  apiToken,
) {
  let value;
  if (typeof explicitUrl === "string" && explicitUrl.trim()) {
    value = explicitUrl.trim();
  } else if (typeof apiBaseUrl === "string" && apiBaseUrl.trim()) {
    value = buildRealtimeTranscriptionWebSocketUrl(apiBaseUrl.trim());
  } else {
    throw new Error(
      "Live STT evaluation requires a WebSocket URL or Airboard API base URL.",
    );
  }
  const parsed = new URL(value);
  if (!["ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("Live STT evaluation URL must use ws:// or wss://.");
  }
  if (accessToken) {
    parsed.searchParams.set("access_token", accessToken);
  }
  if (apiToken) {
    parsed.searchParams.set("token", apiToken);
  }
  return parsed.toString();
}

function providerNeutralTranscript(type, transcript, event) {
  return {
    type,
    transcript,
    ...(typeof event.turnIndex === "number"
      ? { turnIndex: event.turnIndex }
      : {}),
    ...(typeof event.confidence === "number"
      ? { confidence: event.confidence }
      : {}),
    ...(typeof event.providerEvent === "string"
      ? { providerEvent: event.providerEvent }
      : {}),
  };
}

function pcm16ToFloat32(pcmBytes, sampleOffset, sampleCount) {
  const samples = new Float32Array(sampleCount);
  const view = new DataView(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    pcmBytes.byteLength,
  );
  for (let index = 0; index < sampleCount; index += 1) {
    const pcm = view.getInt16((sampleOffset + index) * 2, true);
    samples[index] = pcm < 0 ? pcm / 0x8000 : pcm / 0x7fff;
  }
  return samples;
}

function isMeetSurface(surface) {
  return [
    "meet",
    "meet-bridge",
    "meet-main-stage",
    "meet-side-panel",
  ].includes(surface);
}

function parseGatewayMessage(data) {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data);
    return isRecord(parsed) && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function validateProviderNeutralEvent(event) {
  if (!isRecord(event) || typeof event.type !== "string") {
    throw new Error("Fake transcription event must be an object with a type.");
  }
  if (event.type === "partial" || event.type === "final") {
    if (typeof event.transcript !== "string" || !event.transcript.trim()) {
      throw new Error(`${event.type} transcription events require a transcript.`);
    }
    return { ...event, transcript: event.transcript.trim() };
  }
  if (event.type === "status") {
    if (typeof event.status !== "string") {
      throw new Error("Status transcription events require a status.");
    }
    return event;
  }
  if (event.type === "error") {
    if (
      typeof event.code !== "string" ||
      typeof event.message !== "string" ||
      typeof event.fatal !== "boolean"
    ) {
      throw new Error("Error transcription events require code, message, and fatal.");
    }
    return event;
  }
  throw new Error(`Unknown provider-neutral transcription event: ${event.type}.`);
}

function assertControlMessage(message) {
  const parsed = parseTranscriptionControlMessage(JSON.stringify(message));
  if (!parsed.ok) {
    throw new Error(
      `Generated transcription control message violates production protocol: ${parsed.error.code} ${parsed.error.message}`,
    );
  }
}

function normalizeProviderStatus(status) {
  return ["connecting", "connected", "stopping", "stopped"].includes(status)
    ? status
    : "connected";
}

function defaultCreateWebSocket(url, { origin } = {}) {
  const WebSocketClient = requireFromApi("ws");
  return new WebSocketClient(url, {
    ...(origin ? { headers: { Origin: origin } } : {}),
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
