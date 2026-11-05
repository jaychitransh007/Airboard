import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import type { ApiConfig } from "../config";
import { createTranscriptionProvider } from "./factory";
import {
  parseTranscriptionControlMessage,
  resolveTranscriptionConfigure,
  resolveTranscriptionStart,
} from "./protocol";
import { publicTranscriptionConfig } from "./publicConfig";
import type {
  RealtimeTranscriptionProvider,
  RealtimeTranscriptionSession,
  TranscriptionProviderEvent,
  TranscriptionServerMessage,
} from "./types";
import type { AuthService } from "../auth";
import { clientKey, configuredApiTokenAllowed, createCircuitBreaker, createRateLimiter, originAllowed } from "../security";
import { issueSignedToken, verifySignedToken } from "../signedTokens";

const MAX_PCM16_FRAME_BYTES = 256 * 1024;
const MAX_STARTUP_BUFFER_BYTES = 384 * 1024;

type ActiveTranscription = {
  token: symbol;
  session: RealtimeTranscriptionSession;
  stopReason: "completed" | "aborted" | "provider_closed";
};

const TRANSCRIPTION_TICKET_TTL_SECONDS = 60;

type TranscriptionAuthorization =
  | { allowed: true; profileId: string | null }
  | { allowed: false; reason: string };

export function registerTranscriptionRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  auth?: AuthService,
  dependencies: { provider?: RealtimeTranscriptionProvider | null } = {},
): void {
  const provider =
    dependencies.provider !== undefined
      ? dependencies.provider
      : createTranscriptionProvider(config.transcription);
  let concurrentStreams = 0;
  // Live stream slots per signed-in profile, so one account cannot occupy
  // every maxConcurrentStreams slot.
  const streamsByProfile = new Map<string, number>();
  // Connection attempts per caller address; stream caps bound the rest.
  const connectionLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimits?.transcriptionConnectionsPerMinute ?? 60,
  });
  // During a provider outage, refuse at once rather than holding every
  // start open for the connect timeout.
  const providerBreaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });

  server.get("/transcription/config", async () => publicTranscriptionConfig(config.transcription));

  // Who may stream audio: the shared API token or local development, else a
  // signed-in (or installation) identity whose organization is entitled. Any
  // email can sign in, so Deepgram spend also requires an entitlement; the
  // reason string is the client-facing error code.
  const authorizeRequest = async (request: Parameters<AuthService["authenticate"]>[0]): Promise<TranscriptionAuthorization> => {
    if (configuredApiTokenAllowed(request, config.apiToken) || config.localEntitlements) {
      return { allowed: true, profileId: null };
    }
    const context = auth ? await auth.authenticate(request, { allowInstallation: true }) : null;
    if (!auth || !context) {
      return { allowed: false, reason: "Airboard authentication required" };
    }
    if (!(await auth.activeEntitlement(context.organizationId))) {
      return { allowed: false, reason: "ACTIVE_ENTITLEMENT_REQUIRED" };
    }
    return { allowed: true, profileId: context.profileId };
  };

  // Browsers cannot set headers on a WebSocket upgrade, so the socket URL
  // carries this one-minute ticket instead of the person's sign-in token,
  // which would otherwise land in request logs.
  server.post("/transcription/ticket", async (request, reply) => {
    const authorization = await authorizeRequest(request);
    if (!authorization.allowed) {
      return reply
        .code(authorization.reason === "ACTIVE_ENTITLEMENT_REQUIRED" ? 403 : 401)
        .send({ error: authorization.reason });
    }
    const ticket = issueSignedToken(config.sessionSigningSecret, {
      purpose: "transcription",
      sub: authorization.profileId ?? "",
      ttlSeconds: TRANSCRIPTION_TICKET_TTL_SECONDS,
    });
    return { ticket, expiresInSeconds: TRANSCRIPTION_TICKET_TTL_SECONDS };
  });

  server.get("/transcription/ws", { websocket: true }, (socket, request) => {
    if (!originAllowed(request.headers.origin, config.allowedOrigins)) {
      socket.close(1008, "Origin is not allowed");
      return;
    }
    if (!connectionLimiter.allow(clientKey(request, { trustedProxyHops: config.trustedProxyHops ?? 0 }))) {
      socket.close(1013, "RATE_LIMITED");
      return;
    }
    const authorize = async (): Promise<TranscriptionAuthorization> => {
      const query = request.query as Record<string, unknown> | undefined;
      if (typeof query?.ticket === "string") {
        // Access and entitlement were checked when the ticket was issued.
        const ticket = verifySignedToken(config.sessionSigningSecret, query.ticket, "transcription");
        return ticket
          ? { allowed: true, profileId: ticket.sub || null }
          : { allowed: false, reason: "Airboard authentication required" };
      }
      // Older clients send the sign-in token itself as `access_token`; kept
      // for one release so tabs opened before a deploy keep their voice.
      return authorizeRequest(request);
    };

    const clientSocket = socket as unknown as WebSocket;
    let active: ActiveTranscription | null = null;
    let openingToken: symbol | null = null;
    let openingAbortController: AbortController | null = null;
    let startupFrames: Uint8Array[] = [];
    let startupBytes = 0;
    let closed = false;
    let streamSlotHeld = false;
    let streamOwner: string | null = null;
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
        if (streamOwner) {
          const remaining = (streamsByProfile.get(streamOwner) ?? 1) - 1;
          if (remaining > 0) streamsByProfile.set(streamOwner, remaining);
          else streamsByProfile.delete(streamOwner);
        }
      }
    };

    const acquireStreamSlot = (): "TRANSCRIPTION_PROFILE_LIMIT" | "TRANSCRIPTION_CAPACITY_REACHED" | null => {
      const ownerStreams = streamOwner ? (streamsByProfile.get(streamOwner) ?? 0) : 0;
      if (streamOwner && ownerStreams >= config.transcription.maxStreamsPerProfile) {
        return "TRANSCRIPTION_PROFILE_LIMIT";
      }
      if (concurrentStreams >= config.transcription.maxConcurrentStreams) {
        return "TRANSCRIPTION_CAPACITY_REACHED";
      }
      concurrentStreams += 1;
      if (streamOwner) streamsByProfile.set(streamOwner, ownerStreams + 1);
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
      return null;
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
        sendError(
          clientSocket,
          parsed.error.code,
          parsed.error.message,
          !isConfigureControlMessage(rawMessage),
        );
        return;
      }

      if (parsed.value.type === "transcription.configure") {
        if (!active) {
          sendError(
            clientSocket,
            "TRANSCRIPTION_NOT_READY",
            "Wait for transcription.ready before updating keyterms.",
            false,
          );
          return;
        }
        const resolved = resolveTranscriptionConfigure(
          parsed.value,
          config.transcription,
        );
        if (!resolved.ok) {
          sendError(clientSocket, resolved.error.code, resolved.error.message, false);
          return;
        }
        try {
          active.session.updateKeyterms(resolved.value);
          send(clientSocket, {
            type: "transcription.configured",
            keytermCount: resolved.value.length,
          });
        } catch (error) {
          sendError(
            clientSocket,
            "TRANSCRIPTION_CONFIGURE_FAILED",
            error instanceof Error
              ? error.message
              : "The transcription vocabulary could not be updated.",
            false,
          );
        }
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
      const slotRefusal = acquireStreamSlot();
      if (slotRefusal === "TRANSCRIPTION_PROFILE_LIMIT") {
        sendError(
          clientSocket,
          slotRefusal,
          "This account already has the maximum number of live transcription streams. Stop Airo in another tab and try again.",
          true,
        );
        return;
      }
      if (slotRefusal) {
        sendError(
          clientSocket,
          slotRefusal,
          "The realtime transcription service is at capacity. Try again shortly.",
          true,
        );
        return;
      }
      if (providerBreaker.retryAfterMs() !== null) {
        releaseStreamSlot();
        sendError(
          clientSocket,
          "TRANSCRIPTION_PROVIDER_UNAVAILABLE",
          "The transcription provider is unavailable. Try again shortly.",
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
        providerBreaker.recordSuccess();
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
          // Stopped while opening: the failure says nothing about the provider.
          providerBreaker.abandon();
          return;
        }
        providerBreaker.recordFailure();
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

    let authorized = false;
    const pendingMessages: Array<{ rawMessage: RawData; isBinary: boolean }> = [];
    const receive = (rawMessage: RawData, isBinary: boolean) => {
      if (isBinary) {
        receiveAudio(rawMessage);
        return;
      }
      void start(rawMessage.toString());
    };
    clientSocket.on("message", (rawMessage: RawData, isBinary: boolean) => {
      if (!authorized) {
        if (pendingMessages.length < 4) pendingMessages.push({ rawMessage, isBinary });
        return;
      }
      receive(rawMessage, isBinary);
    });
    void authorize().then(
      (authorization) => {
        if (!authorization.allowed) {
          socket.close(1008, authorization.reason);
          return;
        }
        streamOwner = authorization.profileId;
        authorized = true;
        for (const pending of pendingMessages.splice(0)) receive(pending.rawMessage, pending.isBinary);
      },
      (error: unknown) => {
        // A failed profile/entitlement lookup must not become an unhandled
        // rejection; the client sees a retryable server-side close instead.
        request.log.error({ err: error }, "transcription authorization failed");
        socket.close(1011, "AUTHORIZATION_UNAVAILABLE");
      },
    );

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

function isConfigureControlMessage(input: string): boolean {
  try {
    const value = JSON.parse(input) as { type?: unknown };
    return (
      value?.type === "transcription.configure" ||
      value?.type === "configure"
    );
  } catch {
    return false;
  }
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


function rawDataToUint8Array(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  return raw;
}
