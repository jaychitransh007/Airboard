import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import type { ApiConfig } from "../config";
import { createTranscriptionProvider } from "./factory";
import { parseTranscriptionControlMessage, resolveTranscriptionStart } from "./protocol";
import { publicTranscriptionConfig } from "./publicConfig";
import type {
  RealtimeTranscriptionSession,
  TranscriptionProviderEvent,
  TranscriptionServerMessage,
} from "./types";

const MAX_PCM16_FRAME_BYTES = 256 * 1024;
const MAX_STARTUP_BUFFER_BYTES = 384 * 1024;

type ActiveTranscription = {
  token: symbol;
  session: RealtimeTranscriptionSession;
  stopReason: "completed" | "aborted" | "provider_closed";
};

export function registerTranscriptionRoutes(server: FastifyInstance, config: ApiConfig): void {
  const provider = createTranscriptionProvider(config.transcription);
  let concurrentStreams = 0;

  server.get("/transcription/config", async () => publicTranscriptionConfig(config.transcription));

  server.get("/transcription/ws", { websocket: true }, (socket, request) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      socket.close(1008, "Origin is not allowed");
      return;
    }

    const clientSocket = socket as unknown as WebSocket;
    let active: ActiveTranscription | null = null;
    let openingToken: symbol | null = null;
    let openingAbortController: AbortController | null = null;
    let startupFrames: Uint8Array[] = [];
    let startupBytes = 0;
    let closed = false;
    let streamSlotHeld = false;
    let sessionLimitTimer: ReturnType<typeof setTimeout> | null = null;
    let audioWindowStartedAt = Date.now();
    let audioBytesInWindow = 0;
    let stopActive: (reason: "completed" | "aborted") => void = () => undefined;

    const releaseStreamSlot = () => {
      if (sessionLimitTimer) {
        clearTimeout(sessionLimitTimer);
        sessionLimitTimer = null;
      }
      if (streamSlotHeld) {
        streamSlotHeld = false;
        concurrentStreams = Math.max(0, concurrentStreams - 1);
      }
    };

    const acquireStreamSlot = () => {
      if (concurrentStreams >= config.transcription.maxConcurrentStreams) {
        return false;
      }
      concurrentStreams += 1;
      streamSlotHeld = true;
      sessionLimitTimer = setTimeout(() => {
        sendError(
          clientSocket,
          "TRANSCRIPTION_SESSION_LIMIT",
          "The realtime transcription session reached its maximum duration. Start Airo again to continue.",
          true,
        );
        stopActive("aborted");
      }, config.transcription.maxSessionMs);
      return true;
    };

    const tokenIsCurrent = (token: symbol) =>
      openingToken === token || active?.token === token;

    const relayProviderEvent = (token: symbol, event: TranscriptionProviderEvent) => {
      if (closed || !tokenIsCurrent(token)) {
        return;
      }

      if (event.type === "status") {
        send(clientSocket, {
          type: "transcription.provider",
          provider: config.transcription.provider,
          status: event.status,
          ...(event.requestId ? { requestId: event.requestId } : {}),
        });
        if (event.status === "stopped") {
          const reason = active?.token === token ? active.stopReason : "provider_closed";
          active = null;
          openingToken = null;
          startupFrames = [];
          startupBytes = 0;
          releaseStreamSlot();
          send(clientSocket, { type: "transcription.stopped", reason });
        }
        return;
      }

      if (event.type === "error") {
        send(clientSocket, {
          type: "transcription.error",
          code: event.code,
          message: event.message,
          fatal: event.fatal,
        });
        return;
      }

      send(clientSocket, {
        type: event.type === "partial" ? "transcription.partial" : "transcription.final",
        transcript: event.transcript,
        ...(event.turnIndex !== undefined ? { turnIndex: event.turnIndex } : {}),
        ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
        ...(event.providerEvent ? { providerEvent: event.providerEvent } : {}),
      });
    };

    const start = async (rawMessage: string) => {
      const parsed = parseTranscriptionControlMessage(rawMessage);
      if (!parsed.ok) {
        sendError(clientSocket, parsed.error.code, parsed.error.message, true);
        return;
      }

      if (parsed.value.type !== "transcription.start") {
        if (parsed.value.type === "transcription.stop") {
          stopActive("completed");
        } else {
          stopActive("aborted");
        }
        return;
      }

      if (openingToken || active) {
        sendError(clientSocket, "TRANSCRIPTION_ALREADY_ACTIVE", "A transcription stream is active.");
        return;
      }
      if (!provider) {
        sendError(
          clientSocket,
          "TRANSCRIPTION_UNAVAILABLE",
          "Realtime transcription is not configured on the Airboard API.",
          true,
        );
        return;
      }

      const resolved = resolveTranscriptionStart(parsed.value, config.transcription);
      if (!resolved.ok) {
        sendError(clientSocket, resolved.error.code, resolved.error.message, true);
        return;
      }
      if (!acquireStreamSlot()) {
        sendError(
          clientSocket,
          "TRANSCRIPTION_CAPACITY_REACHED",
          "The realtime transcription service is at capacity. Try again shortly.",
          true,
        );
        return;
      }

      const token = Symbol("transcription");
      const abortController = new AbortController();
      openingToken = token;
      openingAbortController = abortController;
      startupFrames = [];
      startupBytes = 0;
      try {
        const session = await provider.open(
          resolved.value,
          (event) => relayProviderEvent(token, event),
          abortController.signal,
        );
        if (closed || openingToken !== token) {
          session.abort();
          return;
        }

        active = { token, session, stopReason: "provider_closed" };
        openingToken = null;
        if (openingAbortController === abortController) {
          openingAbortController = null;
        }
        for (const frame of startupFrames) {
          session.sendAudio(frame);
        }
        startupFrames = [];
        startupBytes = 0;
        send(clientSocket, {
          type: "transcription.ready",
          provider: provider.id,
          model: resolved.value.model,
          sampleRate: resolved.value.sampleRate,
        });
      } catch (error) {
        if (openingToken !== token || closed) {
          return;
        }
        openingToken = null;
        if (openingAbortController === abortController) {
          openingAbortController = null;
        }
        startupFrames = [];
        startupBytes = 0;
        releaseStreamSlot();
        sendError(
          clientSocket,
          "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
          error instanceof Error ? error.message : "Could not connect to transcription provider.",
          true,
        );
      }
    };

    stopActive = (reason: "completed" | "aborted") => {
      if (openingToken) {
        openingToken = null;
        openingAbortController?.abort();
        openingAbortController = null;
        startupFrames = [];
        startupBytes = 0;
        releaseStreamSlot();
        send(clientSocket, { type: "transcription.stopped", reason });
        return;
      }
      if (!active) {
        sendError(clientSocket, "NO_ACTIVE_TRANSCRIPTION", "No transcription stream is active.");
        return;
      }

      active.stopReason = reason;
      send(clientSocket, {
        type: "transcription.provider",
        provider: config.transcription.provider,
        status: "stopping",
      });
      if (reason === "completed") {
        active.session.stop();
      } else {
        active.session.abort();
      }
    };

    const receiveAudio = (raw: RawData) => {
      const frame = rawDataToUint8Array(raw);
      if (!frame.byteLength || frame.byteLength % 2 !== 0) {
        sendError(
          clientSocket,
          "INVALID_AUDIO_FRAME",
          "Audio frames must contain PCM16 samples.",
          true,
        );
        return;
      }
      if (frame.byteLength > MAX_PCM16_FRAME_BYTES) {
        sendError(
          clientSocket,
          "AUDIO_FRAME_TOO_LARGE",
          "Send smaller realtime PCM16 frames.",
          true,
        );
        return;
      }

      const now = Date.now();
      if (now - audioWindowStartedAt >= 1_000) {
        audioWindowStartedAt = now;
        audioBytesInWindow = 0;
      }
      audioBytesInWindow += frame.byteLength;
      if (audioBytesInWindow > config.transcription.maxAudioBytesPerSecond) {
        sendError(
          clientSocket,
          "AUDIO_RATE_LIMIT",
          "Realtime audio arrived faster than the configured PCM16 limit.",
          true,
        );
        stopActive("aborted");
        return;
      }

      if (active) {
        active.session.sendAudio(frame);
        return;
      }
      if (openingToken) {
        if (startupBytes + frame.byteLength > MAX_STARTUP_BUFFER_BYTES) {
          sendError(
            clientSocket,
            "STARTUP_AUDIO_OVERFLOW",
            "Wait for transcription.ready before sending more audio.",
            true,
          );
          return;
        }
        startupFrames.push(frame);
        startupBytes += frame.byteLength;
        return;
      }
      sendError(
        clientSocket,
        "TRANSCRIPTION_NOT_READY",
        "Send transcription.start before PCM16 audio.",
        true,
      );
    };

    clientSocket.on("message", (rawMessage: RawData, isBinary: boolean) => {
      if (isBinary) {
        receiveAudio(rawMessage);
        return;
      }
      void start(rawMessage.toString());
    });

    clientSocket.on("close", () => {
      closed = true;
      openingToken = null;
      openingAbortController?.abort();
      openingAbortController = null;
      startupFrames = [];
      active?.session.abort();
      active = null;
      releaseStreamSlot();
    });
  });
}

function sendError(
  socket: WebSocket,
  code: string,
  message: string,
  fatal = false,
): void {
  send(socket, { type: "transcription.error", code, message, fatal });
}

function send(socket: WebSocket, message: TranscriptionServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return false;
  }
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

function rawDataToUint8Array(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  return raw;
}
