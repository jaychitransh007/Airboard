import { createRequire } from "node:module";

import {
  acceptDeepgramFinal,
  translateDeepgramFluxMessage,
} from "../../../apps/api/src/transcription/deepgramFluxProtocol.ts";
import {
  parseTranscriptionControlMessage,
} from "../../../apps/api/src/transcription/protocol.ts";
import {
  buildRealtimeTranscriptionWebSocketUrl,
  DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
} from "../../../apps/web/src/features/board/realtimeSpeech.ts";
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
          "Meet audio cannot be replayed: the Meet bridge replay was removed with the Chrome extension, and direct WebSocket WAV streaming is not Meet transport.",
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

async function streamLiveGatewayScenario({
  scenario,
  asset,
  signal,
  createWebSocket = defaultCreateWebSocket,
  url,
  apiBaseUrl,
  accessToken,
  apiToken,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  frameDelayMs = REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
  maxBufferedBytes = DEFAULT_REALTIME_TRANSCRIPTION_MAX_BUFFERED_BYTES,
  origin = "http://localhost:3000",
}) {
  const socketUrl = await authorizedLiveGatewaySocketUrl({
    url: scenario.source.url ?? url,
    apiBaseUrl: scenario.source.apiBaseUrl ?? apiBaseUrl,
    accessToken,
    apiToken,
    fetchImpl,
  });
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

/**
 * The gateway socket URL for an evaluation run. Whichever credential the run
 * holds (a sign-in token, else the operator API token) is sent as a Bearer
 * header to trade for a one-minute voice ticket first, as the app does, so no
 * token ever goes in a URL. With no credential (local development) the socket
 * is opened without a ticket.
 */
async function authorizedLiveGatewaySocketUrl({ url, apiBaseUrl, accessToken, apiToken, fetchImpl }) {
  const credential = accessToken || apiToken;
  if (!credential) return buildLiveGatewaySocketUrl(url, apiBaseUrl, null);
  const ticketUrl = new URL(buildLiveGatewaySocketUrl(url, apiBaseUrl, null));
  ticketUrl.protocol = ticketUrl.protocol === "wss:" ? "https:" : "http:";
  ticketUrl.pathname = "/transcription/ticket";
  ticketUrl.search = "";
  const response = await fetchImpl(ticketUrl.toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${credential}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.ticket !== "string") {
    throw new Error(`Voice ticket request failed (${response.status}): ${body?.error ?? "no ticket"}`);
  }
  return buildLiveGatewaySocketUrl(url, apiBaseUrl, body.ticket);
}

/** The socket URL carries only a short-lived voice ticket, never a token. */
export function buildLiveGatewaySocketUrl(explicitUrl, apiBaseUrl, ticket) {
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
  for (const name of ["token", "access_token"]) {
    parsed.searchParams.delete(name);
  }
  if (ticket) {
    parsed.searchParams.set("ticket", ticket);
  }
  return parsed.toString();
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
