import WebSocket, { type RawData } from "ws";
import type {
  RealtimeTranscriptionProvider,
  RealtimeTranscriptionSession,
  TranscriptionProviderEvent,
  TranscriptionProviderEventHandler,
  TranscriptionRuntimeConfig,
  TranscriptionSessionOptions,
} from "./types";
import {
  acceptDeepgramFinal,
  buildDeepgramFluxConfigureMessage,
  buildDeepgramFluxUrl,
  translateDeepgramFluxMessage,
} from "./deepgramFluxProtocol";

const MAX_UPSTREAM_AUDIO_BACKLOG_BYTES = 32 * 1024;

export class DeepgramFluxProvider implements RealtimeTranscriptionProvider {
  readonly id = "deepgram";
  private readonly config: TranscriptionRuntimeConfig;

  constructor(config: TranscriptionRuntimeConfig) {
    this.config = config;
  }

  async open(
    options: TranscriptionSessionOptions,
    onEvent: TranscriptionProviderEventHandler,
    signal?: AbortSignal,
  ): Promise<RealtimeTranscriptionSession> {
    if (!this.config.apiKey) {
      throw new Error("Deepgram transcription is not configured.");
    }
    if (signal?.aborted) {
      throw new Error("Transcription provider connection was cancelled.");
    }

    onEvent({ type: "status", status: "connecting" });
    const url = buildDeepgramFluxUrl(this.config.providerWebSocketUrl, options, this.config);
    const socket = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
      },
    });
    const session = new DeepgramFluxSession(socket);

    return await new Promise<RealtimeTranscriptionSession>((resolve, reject) => {
      let opened = false;
      let settled = false;
      let configuring = false;
      const seenFinals = new Set<string>();
      const removeAbortListener = () => signal?.removeEventListener("abort", abortOpening);
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        removeAbortListener();
        socket.terminate();
        reject(new Error("Timed out while connecting to the transcription provider."));
      }, this.config.connectTimeoutMs);

      const rejectOpening = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        removeAbortListener();
        reject(error);
      };

      function abortOpening() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        removeAbortListener();
        socket.terminate();
        reject(new Error("Transcription provider connection was cancelled."));
      }

      signal?.addEventListener("abort", abortOpening, { once: true });

      socket.on("message", (raw: RawData) => {
        const translation = translateDeepgramFluxMessage(raw.toString());
        if (translation.finalDedupeKey) {
          if (!acceptDeepgramFinal(seenFinals, translation.finalDedupeKey)) {
            translation.events = translation.events.filter((event) => event.type !== "final");
          }
        }
        const fatalError = translation.events.find(
          (event): event is Extract<TranscriptionProviderEvent, { type: "error" }> =>
            event.type === "error" && event.fatal,
        );
        const configurationError = translation.events.find(
          (event): event is Extract<TranscriptionProviderEvent, { type: "error" }> =>
            event.type === "error" && !event.fatal,
        );

        if (!opened && (fatalError || (configuring && configurationError))) {
          rejectOpening(new Error((fatalError ?? configurationError)?.message));
          socket.close();
          return;
        }

        for (const event of translation.events) {
          onEvent(event);
        }

        if (translation.connected && !settled && !configuring) {
          configuring = true;
          socket.send(JSON.stringify(buildDeepgramFluxConfigureMessage(options, this.config)));
        }

        if (translation.configured && !settled) {
          opened = true;
          settled = true;
          clearTimeout(timeout);
          removeAbortListener();
          resolve(session);
        }
      });

      socket.on("error", (error) => {
        if (!opened) {
          rejectOpening(error);
          return;
        }
        onEvent({
          type: "error",
          code: "PROVIDER_SOCKET_ERROR",
          message: error.message,
          fatal: true,
        });
      });

      socket.on("close", (code, reason) => {
        if (!opened) {
          rejectOpening(
            new Error(
              `Transcription provider closed during startup (${code}${
                reason.length ? `: ${reason.toString()}` : ""
              }).`,
            ),
          );
          return;
        }
        onEvent({ type: "status", status: "stopped" });
      });
    });
  }
}

class DeepgramFluxSession implements RealtimeTranscriptionSession {
  private stopping = false;
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  sendAudio(pcm16Frame: Uint8Array): void {
    if (this.stopping || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // Interactive commands should never arrive seconds late. If the provider
    // connection falls behind, discard new audio until its bounded queue
    // drains instead of building an unbounded stale-audio backlog.
    if (this.socket.bufferedAmount >= MAX_UPSTREAM_AUDIO_BACKLOG_BYTES) {
      return;
    }
    this.socket.send(pcm16Frame, { binary: true });
  }

  stop(): void {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
    }
  }

  abort(): void {
    this.stopping = true;
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.terminate();
    }
  }
}
