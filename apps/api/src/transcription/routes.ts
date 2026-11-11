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
  TranscriptionSessionOptions,
} from "./types";
import {
  createVoiceAllowanceReader,
  nextVoiceAllowanceWarning,
  VOICE_ALLOWANCE_WARNING_MINUTES,
} from "./voiceAllowance";
import type { AuthService } from "../auth";
import { clientKey, configuredApiTokenAllowed, createCircuitBreaker, originAllowed } from "../security";
import { createSharedRateLimiter } from "../sharedRateLimit";
import { issueSignedToken, verifySignedToken } from "../signedTokens";
import { createDailyUsage, type UsageVerdict } from "../dailyUsage";
import { organizationPolicy } from "../organizationPolicy";

const MAX_PCM16_FRAME_BYTES = 256 * 1024;
const MAX_STARTUP_BUFFER_BYTES = 384 * 1024;

// One provider stream under the browser's stream ("leg"): the first, a
// reopen after a silence the provider closed, or a replacement opened just
// before the current one's time limit.
type ProviderLeg = {
  kind: "initial" | "reopen" | "handover";
  session: RealtimeTranscriptionSession | null;
  abortController: AbortController;
  /** The keyterms this leg has; compared by identity with the stream's. */
  keyterms: string[];
  /** Added to the leg's own turn numbers, so they keep rising across legs. */
  turnBase: number;
  timers: Array<ReturnType<typeof setTimeout>>;
  /** The provider closed or failed this leg before it became current. */
  lost: boolean;
};

type ClientStream = {
  options: TranscriptionSessionOptions;
  bytesPerSecond: number;
  /** transcription.ready has been sent. */
  ready: boolean;
  /** Stop or abort requested; the current leg's "stopped" ends the stream. */
  ending: "completed" | "aborted" | null;
  /** The leg audio goes to; null while opening, or closed during a silence. */
  current: ProviderLeg | null;
  opening: ProviderLeg | null;
  /** An open replacement waiting for a pause to take over. */
  standby: ProviderLeg | null;
  /** The time limit passed while the replacement was opening. */
  handoverForced: boolean;
  lastAudioAt: number;
  lastKeepAliveAt: number;
  /** Recent audio of the turn in progress, replayed into a replacement leg. */
  turnAudio: Uint8Array[];
  turnAudioBytes: number;
  /** Audio held while no leg is open. */
  pendingFrames: Uint8Array[];
  pendingBytes: number;
  maxTurnIndex: number;
  /** Seconds of audio paid for, and sent to the provider. */
  paidSeconds: number;
  usedSeconds: number;
  chargeInFlight: boolean;
  exhausted: boolean;
  /** Warning thresholds (minutes left) already sent on this stream. */
  allowanceWarned: Set<number>;
  tick: ReturnType<typeof setInterval>;
};

const TRANSCRIPTION_TICKET_TTL_SECONDS = 60;
// Voice is charged against the person's daily allowance in blocks paid ahead,
// for the audio actually sent to the provider: the browser holds back
// silence (realtimeSpeech.ts), so an open board that hears nobody costs
// nothing. A stream costs at most one block more than it used.
const VOICE_CHARGE_SECONDS = 15;
// The next block is bought while this much paid audio is left, so speech is
// not held up waiting for the database.
const VOICE_CHARGE_AHEAD_SECONDS = 7.5;
// While no audio arrives, the provider stream is held open with KeepAlive
// messages instead of streamed (and billed) silence.
const KEEP_ALIVE_INTERVAL_MS = 4_000;
const STREAM_TICK_MS = 250;
// A replacement leg opens this long before the current one's time limit (at
// most a fifth of the limit) and takes over at the first pause in the audio,
// or at the limit with the turn in progress replayed into it.
const HANDOVER_LEAD_MS = 5_000;
const HANDOVER_IDLE_MS = 300;
// A provider close or failure after this long without audio is its own
// no-audio timeout, not a fault: the leg reopens when speech returns.
const IDLE_CLOSE_GRACE_MS = 3_000;
// A pause this long ends a turn, for what a replacement leg replays.
const TURN_GAP_MS = 1_500;
const MAX_REPLAY_SECONDS = 8;
const SILENCE_PRIMER_SECONDS = 0.1;
// A stream whose provider leg closed during a silence has no leg time limit,
// so it would never send `transcription.renewing` or reach
// TRANSCRIPTION_SESSION_LIMIT, the two points where the browser pauses a
// forgotten tab. After this long without audio (or the leg limit, if
// shorter) it reaches its limit as a leg would; the browser, having heard
// nobody, ends the session as "paused", and the stream slots return.
const DORMANT_STREAM_LIMIT_MS = 20 * 60_000;
const DAILY_VOICE_LIMIT_MESSAGE =
  "You've used today's Airo voice minutes. Typed commands still work, and voice comes back at midnight UTC.";
const SERVICE_VOICE_LIMIT_MESSAGE =
  "Airo voice has reached today's limit for everyone in the pilot. Typed commands still work, and voice is back at midnight UTC.";

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
  // Daily voice minutes per person, counted in the database across instances.
  const usage = createDailyUsage(
    config.dailyUsage ? (auth?.client ?? null) : null,
    config.dailyUsage,
    (error) => server.log.warn({ err: error }, "daily voice allowance could not be counted"),
    {
      ...(config.serviceDailyUsage ? { service: config.serviceDailyUsage } : {}),
      onServiceLimitReached: () =>
        server.log.warn(
          { limitMinutes: (config.serviceDailyUsage?.voiceSeconds ?? 0) / 60 },
          "the service's daily voice limit is reached",
        ),
    },
  );
  // What is left of today's voice minutes, to warn before the limit.
  const allowance = createVoiceAllowanceReader(
    config.dailyUsage ? (auth?.client ?? null) : null,
    config.dailyUsage,
    config.serviceDailyUsage,
    (error) => server.log.warn({ err: error }, "remaining voice minutes could not be read"),
  );
  // Connection attempts per caller address; stream caps bound the rest.
  const connectionLimiter = createSharedRateLimiter({
    bucket: "transcription_connection",
    windowMs: 60_000,
    max: config.rateLimits?.transcriptionConnectionsPerMinute ?? 60,
    client: auth?.client ?? null,
    keySecret: config.sessionSigningSecret,
    onError: (error) => server.log.warn({ err: error }, "shared voice connection rate limit could not be counted"),
  });
  // During a provider outage, refuse at once rather than holding every
  // start open for the connect timeout.
  const providerBreaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });

  server.get("/transcription/config", async () => publicTranscriptionConfig(config.transcription));

  // Who may stream audio: the shared API token or local development, else a
  // signed-in identity whose organization is entitled. Any
  // email can sign in, so Deepgram spend also requires an entitlement; the
  // reason string is the client-facing error code.
  const authorizeRequest = async (request: Parameters<AuthService["authenticate"]>[0]): Promise<TranscriptionAuthorization> => {
    if (configuredApiTokenAllowed(request, config.apiToken) || config.localEntitlements) {
      return { allowed: true, profileId: null };
    }
    const context = auth ? await auth.authenticate(request) : null;
    if (!auth || !context) {
      return { allowed: false, reason: "Airboard authentication required" };
    }
    if (!(await auth.activeEntitlement(context.organizationId))) {
      return { allowed: false, reason: "ACTIVE_ENTITLEMENT_REQUIRED" };
    }
    // An admin can turn voice off for the whole organization (Admin → Policy).
    const policy = await organizationPolicy(auth.client, context.organizationId).catch(() => null);
    if (!policy) return { allowed: false, reason: "POLICY_UNAVAILABLE" };
    if (!policy.voiceEnabled) return { allowed: false, reason: "VOICE_DISABLED_BY_ADMIN" };
    return { allowed: true, profileId: context.profileId };
  };

  // Browsers cannot set headers on a WebSocket upgrade, so the socket URL
  // carries this one-minute ticket instead of the person's sign-in token,
  // which would otherwise land in request logs.
  server.post("/transcription/ticket", async (request, reply) => {
    const authorization = await authorizeRequest(request);
    if (!authorization.allowed) {
      return reply
        .code(ticketRefusalStatus(authorization.reason))
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
    // Counted now, awaited before the stream is authorized below.
    const admitted = connectionLimiter.allow(clientKey(request, { trustedProxyHops: config.trustedProxyHops ?? 0 }));
    const authorize = async (): Promise<TranscriptionAuthorization> => {
      const query = request.query as Record<string, unknown> | undefined;
      if (typeof query?.ticket === "string") {
        // Access and entitlement were checked when the ticket was issued.
        const ticket = verifySignedToken(config.sessionSigningSecret, query.ticket, "transcription");
        return ticket
          ? { allowed: true, profileId: ticket.sub || null }
          : { allowed: false, reason: "Airboard authentication required" };
      }
      // Without a ticket, only the shared API token or local development may
      // stream: the sign-in token is no longer accepted in the URL (RGB-016).
      return authorizeRequest(request);
    };

    const clientSocket = socket as unknown as WebSocket;
    // The browser's one voice stream on this socket. Underneath it, provider
    // streams ("legs") come and go: one is replaced shortly before its time
    // limit, and one the provider closes during a long silence is reopened
    // when speech returns. The browser sees one unbroken stream, and the
    // socket holds one stream slot throughout, so a handover never counts
    // against the account's or the instance's stream caps.
    let stream: ClientStream | null = null;
    let closed = false;
    let streamSlotHeld = false;
    let streamOwner: string | null = null;
    let audioWindowStartedAt = Date.now();
    let audioBytesInWindow = 0;

    const releaseStreamSlot = () => {
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
      return null;
    };

    const clearLegTimers = (leg: ProviderLeg | null) => {
      if (!leg) return;
      for (const timer of leg.timers) clearTimeout(timer);
      leg.timers = [];
    };

    const abortLeg = (leg: ProviderLeg | null) => {
      if (!leg) return;
      clearLegTimers(leg);
      leg.abortController.abort();
      leg.session?.abort();
    };

    // Ends the browser's stream: every leg is dropped (their late events are
    // ignored, since the stream is no longer current) and the slot returns.
    const endStream = (s: ClientStream, reason: "completed" | "aborted" | "provider_closed") => {
      if (stream !== s) return;
      stream = null;
      clearInterval(s.tick);
      for (const leg of [s.current, s.standby, s.opening]) abortLeg(leg);
      releaseStreamSlot();
      send(clientSocket, { type: "transcription.stopped", reason });
    };

    const stopActive = (reason: "completed" | "aborted") => {
      const s = stream;
      if (!s) {
        sendError(clientSocket, "NO_ACTIVE_TRANSCRIPTION", "No transcription stream is active.");
        return;
      }
      if (!s.ready || !s.current?.session) {
        // Still opening, or no provider stream open during a silence.
        endStream(s, reason);
        return;
      }
      if (s.ending) return;
      s.ending = reason;
      abortLeg(s.standby);
      s.standby = null;
      abortLeg(s.opening);
      s.opening = null;
      const current = s.current;
      clearLegTimers(current);
      send(clientSocket, {
        type: "transcription.provider",
        provider: config.transcription.provider,
        status: "stopping",
      });
      // The current leg's "stopped" event ends the stream, after a graceful
      // stop has delivered its last final transcript.
      if (reason === "completed") current.session!.stop();
      else current.session!.abort();
    };

    const streamIsIdle = (s: ClientStream, forMs: number) => Date.now() - s.lastAudioAt >= forMs;

    // A provider stream closed (or failed) after a silence long enough to be
    // its own no-audio timeout: drop it quietly and reopen on the next speech.
    const goDormant = (s: ClientStream, leg: ProviderLeg) => {
      if (s.current !== leg) return;
      s.current = null;
      abortLeg(leg);
      request.log.info("voice provider stream closed during silence; it reopens when speech returns");
      if (s.standby) {
        promote(s, s.standby);
      }
    };

    const promote = (s: ClientStream, leg: ProviderLeg) => {
      const previous = s.current;
      if (s.standby === leg) s.standby = null;
      leg.turnBase = s.maxTurnIndex + 1;
      s.current = leg;
      s.handoverForced = false;
      s.lastKeepAliveAt = Date.now();
      scheduleLegLimit(s, leg);
      // The turn in progress on the old leg is replayed into the new one, and
      // the old leg is dropped without finishing it, so no word is lost or
      // heard twice. The replay is ours to pay for: it is not charged again.
      // Nor is the silence primer below. Both are deliberate exceptions to
      // "every second sent to the provider is metered": each is bounded (at
      // most MAX_REPLAY_SECONDS of audio already charged once, or
      // SILENCE_PRIMER_SECONDS of silence) and happens once per leg, so at
      // most once per maxSessionMs or per reopen after a silence.
      const replay = previous ? s.turnAudio : [];
      if (previous) abortLeg(previous);
      const frames = [...replay, ...s.pendingFrames];
      s.pendingFrames = [];
      s.pendingBytes = 0;
      // A provider may close a stream that carries no audio soon after it
      // opens, so one with nothing to hear gets a tenth of a second of silence.
      if (!frames.length) {
        frames.push(new Uint8Array(Math.round(s.bytesPerSecond * SILENCE_PRIMER_SECONDS) & ~1));
      }
      for (const frame of frames) leg.session!.sendAudio(frame);
    };

    // The leg is replaced a few seconds before its time limit; if the
    // replacement cannot open, the stream ends at the limit as it used to and
    // the browser opens a new one.
    const scheduleLegLimit = (s: ClientStream, leg: ProviderLeg) => {
      const limitMs = config.transcription.maxSessionMs;
      const leadMs = Math.min(HANDOVER_LEAD_MS, Math.floor(limitMs / 5));
      leg.timers.push(
        setTimeout(() => {
          if (stream !== s || s.current !== leg || s.ending || s.opening || s.standby) return;
          send(clientSocket, { type: "transcription.renewing" });
          openLeg(s, "handover");
        }, limitMs - leadMs),
        setTimeout(() => {
          if (stream !== s || s.current !== leg || s.ending) return;
          if (s.standby) {
            promote(s, s.standby);
            return;
          }
          if (s.opening) {
            // Switch the moment the replacement is ready.
            s.handoverForced = true;
            return;
          }
          sessionLimitReached(s);
        }, limitMs),
      );
    };

    const sessionLimitReached = (s: ClientStream) => {
      if (stream !== s || s.ending) return;
      sendError(
        clientSocket,
        "TRANSCRIPTION_SESSION_LIMIT",
        "This voice stream reached its maximum length. Airboard opens a new one automatically.",
        true,
      );
      stopActive("aborted");
    };

    const relayProviderEvent = (s: ClientStream, leg: ProviderLeg, event: TranscriptionProviderEvent) => {
      if (closed || stream !== s) return;
      const isCurrent = s.current === leg;
      // Only the first leg's start-up is the browser's business.
      const isFirstOpening = s.opening === leg && leg.kind === "initial";

      // A replacement the provider closed or failed before it took over is
      // dropped, so it is never promoted: the limit then falls back to ending
      // the stream, and the browser reconnects.
      const lostBeforeTakeover =
        !isCurrent &&
        (s.standby === leg || s.opening === leg) &&
        ((event.type === "status" && event.status === "stopped") || (event.type === "error" && event.fatal));
      if (lostBeforeTakeover) {
        leg.lost = true;
        if (s.standby === leg) {
          s.standby = null;
          request.log.warn("the replacement voice stream closed before it took over");
          abortLeg(leg);
          if (s.handoverForced && s.current) sessionLimitReached(s);
          return;
        }
        // Still opening: the open below sees `lost` and treats it as failed.
        if (leg.kind !== "initial") return;
      }

      if (event.type === "status") {
        if (event.status === "stopped") {
          if (!isCurrent) return;
          if (s.ending) endStream(s, s.ending);
          else if (streamIsIdle(s, IDLE_CLOSE_GRACE_MS)) goDormant(s, leg);
          else endStream(s, "provider_closed");
          return;
        }
        if (isFirstOpening || (isCurrent && leg.kind === "initial")) {
          send(clientSocket, {
            type: "transcription.provider",
            provider: config.transcription.provider,
            status: event.status,
            ...(event.requestId ? { requestId: event.requestId } : {}),
          });
        }
        return;
      }

      if (event.type === "error") {
        if (!isCurrent && !isFirstOpening) return;
        if (isCurrent && event.fatal && !s.ending && streamIsIdle(s, IDLE_CLOSE_GRACE_MS)) {
          request.log.info({ code: event.code }, "voice provider stream failed during silence");
          goDormant(s, leg);
          return;
        }
        send(clientSocket, {
          type: "transcription.error",
          code: event.code,
          message: event.message,
          fatal: event.fatal,
        });
        return;
      }

      if (!isCurrent) return;
      // Turn numbers keep rising across legs, as if one provider stream.
      const turnIndex = event.turnIndex !== undefined ? event.turnIndex + leg.turnBase : undefined;
      if (turnIndex !== undefined) s.maxTurnIndex = Math.max(s.maxTurnIndex, turnIndex);
      if (event.type === "final") {
        s.turnAudio = [];
        s.turnAudioBytes = 0;
      }
      send(clientSocket, {
        type: event.type === "partial" ? "transcription.partial" : "transcription.final",
        transcript: event.transcript,
        ...(turnIndex !== undefined ? { turnIndex } : {}),
        ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
        ...(event.providerEvent ? { providerEvent: event.providerEvent } : {}),
      });
    };

    const openLeg = (s: ClientStream, kind: ProviderLeg["kind"]) => {
      if (!provider || s.opening) return;
      const leg: ProviderLeg = {
        kind,
        session: null,
        abortController: new AbortController(),
        keyterms: s.options.keyterms,
        turnBase: 0,
        timers: [],
        lost: false,
      };
      s.opening = leg;
      const failed = (message: string) => {
        if (stream !== s || s.opening !== leg) return;
        s.opening = null;
        if (s.current) {
          request.log.warn({ err: message }, "the replacement voice stream could not open");
          if (s.handoverForced) sessionLimitReached(s);
          return;
        }
        if (s.ready && !s.pendingFrames.length) {
          // Nothing is waiting to be heard: stay closed until speech returns.
          request.log.warn({ err: message }, "the voice stream could not reopen");
          return;
        }
        endStreamWithError(s, "TRANSCRIPTION_PROVIDER_UNAVAILABLE", message);
      };
      if (providerBreaker.retryAfterMs() !== null) {
        failed("The transcription provider is unavailable. Try again shortly.");
        return;
      }
      provider
        .open(
          { ...s.options, keyterms: [...s.options.keyterms] },
          (event) => relayProviderEvent(s, leg, event),
          leg.abortController.signal,
        )
        .then(
          (session) => {
            providerBreaker.recordSuccess();
            leg.session = session;
            if (closed || stream !== s || s.opening !== leg || s.ending) {
              session.abort();
              return;
            }
            if (leg.lost && leg.kind !== "initial") {
              session.abort();
              failed("The voice provider closed the stream as it opened.");
              return;
            }
            s.opening = null;
            if (leg.keyterms !== s.options.keyterms) {
              session.updateKeyterms([...s.options.keyterms]);
            }
            if (kind === "handover" && s.current) {
              s.standby = leg;
              if (s.handoverForced || streamIsIdle(s, HANDOVER_IDLE_MS)) promote(s, leg);
              return;
            }
            promote(s, leg);
            if (!s.ready) {
              s.ready = true;
              send(clientSocket, {
                type: "transcription.ready",
                provider: provider.id,
                model: s.options.model,
                sampleRate: s.options.sampleRate,
              });
            }
          },
          (error: unknown) => {
            if (closed || stream !== s || s.opening !== leg) {
              // Stopped while opening: the failure says nothing about the provider.
              providerBreaker.abandon();
              return;
            }
            providerBreaker.recordFailure();
            failed(error instanceof Error ? error.message : "Could not connect to transcription provider.");
          },
        );
    };

    const endStreamWithError = (s: ClientStream, code: string, message: string) => {
      if (stream !== s) return;
      stream = null;
      clearInterval(s.tick);
      for (const leg of [s.current, s.standby, s.opening]) abortLeg(leg);
      releaseStreamSlot();
      sendError(clientSocket, code, message, true);
    };

    // Voice is charged for audio actually sent to the provider, in blocks
    // paid ahead: silence the browser holds back costs nothing.
    const chargeNextBlock = (s: ClientStream) => {
      const owner = streamOwner;
      if (!owner || s.chargeInFlight || s.ending || stream !== s) return;
      s.chargeInFlight = true;
      void usage.consume(owner, "voice_seconds", VOICE_CHARGE_SECONDS).then((verdict) => {
        s.chargeInFlight = false;
        if (stream !== s) return;
        const refusal = voiceLimitRefusal(verdict);
        if (refusal) {
          s.exhausted = true;
          sendError(clientSocket, refusal.code, refusal.message, true);
          stopActive("aborted");
          return;
        }
        s.paidSeconds += VOICE_CHARGE_SECONDS;
        void warnIfAllowanceLow(s);
      });
    };

    // Returns false when the frame must wait for the next paid block.
    const meterAudio = (s: ClientStream, bytes: number): boolean => {
      if (!streamOwner) return true;
      if (s.exhausted) return false;
      const seconds = bytes / s.bytesPerSecond;
      if (s.usedSeconds + seconds > s.paidSeconds) {
        chargeNextBlock(s);
        return false;
      }
      s.usedSeconds += seconds;
      if (s.paidSeconds - s.usedSeconds < VOICE_CHARGE_AHEAD_SECONDS) chargeNextBlock(s);
      return true;
    };

    const warnIfAllowanceLow = async (s: ClientStream) => {
      const owner = streamOwner;
      if (!owner || s.allowanceWarned.size >= VOICE_ALLOWANCE_WARNING_MINUTES.length) return;
      const remaining = await allowance.remaining(owner);
      if (!remaining || stream !== s) return;
      const warning = nextVoiceAllowanceWarning(remaining, s.allowanceWarned);
      if (warning) send(clientSocket, { type: "transcription.allowance_warning", ...warning });
    };

    const tick = (s: ClientStream) => {
      if (stream !== s || s.ending) return;
      const now = Date.now();
      // A forgotten tab whose provider leg went dormant still reaches a limit.
      if (
        s.ready &&
        !s.current &&
        !s.opening &&
        now - s.lastAudioAt >= Math.min(DORMANT_STREAM_LIMIT_MS, config.transcription.maxSessionMs)
      ) {
        request.log.info("a voice stream heard nothing for a long time; it ends so the browser can pause");
        sessionLimitReached(s);
        return;
      }
      // Switch to a ready replacement in a pause, so no turn is re-heard.
      if (s.standby && now - s.lastAudioAt >= HANDOVER_IDLE_MS) promote(s, s.standby);
      if (now - Math.max(s.lastAudioAt, s.lastKeepAliveAt) >= KEEP_ALIVE_INTERVAL_MS) {
        s.lastKeepAliveAt = now;
        s.current?.session?.keepAlive?.();
        s.standby?.session?.keepAlive?.();
      }
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
        const s = stream;
        if (!s || !s.ready || s.ending) {
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
          // A leg opened later starts with these, and one still opening is
          // updated when it opens.
          s.options = { ...s.options, keyterms: resolved.value };
          for (const leg of [s.current, s.standby]) {
            if (leg?.session) {
              leg.session.updateKeyterms(resolved.value);
              leg.keyterms = s.options.keyterms;
            }
          }
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

      if (stream) {
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
          "This account already has Airo voice on in other tabs. Close Airboard in another tab, then reload this board.",
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

      const now = Date.now();
      const s: ClientStream = {
        options: resolved.value,
        bytesPerSecond: resolved.value.sampleRate * 2,
        ready: false,
        ending: null,
        current: null,
        opening: null,
        standby: null,
        handoverForced: false,
        lastAudioAt: now,
        lastKeepAliveAt: now,
        turnAudio: [],
        turnAudioBytes: 0,
        pendingFrames: [],
        pendingBytes: 0,
        maxTurnIndex: -1,
        paidSeconds: 0,
        usedSeconds: 0,
        chargeInFlight: false,
        exhausted: false,
        allowanceWarned: new Set(),
        tick: setInterval(() => tick(s), STREAM_TICK_MS),
      };
      stream = s;
      // The first block is paid before the provider opens, so a used-up
      // allowance is refused before Deepgram is dialled.
      const owner = streamOwner;
      if (owner) {
        s.chargeInFlight = true;
        const refusal = voiceLimitRefusal(await usage.consume(owner, "voice_seconds", VOICE_CHARGE_SECONDS));
        s.chargeInFlight = false;
        if (stream !== s || closed) return;
        if (refusal) {
          endStreamWithError(s, refusal.code, refusal.message);
          return;
        }
        s.paidSeconds = VOICE_CHARGE_SECONDS;
        void warnIfAllowanceLow(s);
      }
      openLeg(s, "initial");
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

      const s = stream;
      if (!s) {
        sendError(
          clientSocket,
          "TRANSCRIPTION_NOT_READY",
          "Send transcription.start before PCM16 audio.",
          true,
        );
        return;
      }
      if (s.ending) return;
      const current = s.current?.session ? s.current : null;
      if (!current && s.pendingBytes + frame.byteLength > MAX_STARTUP_BUFFER_BYTES) {
        sendError(
          clientSocket,
          "STARTUP_AUDIO_OVERFLOW",
          "Wait for transcription.ready before sending more audio.",
          true,
        );
        return;
      }
      if (!meterAudio(s, frame.byteLength)) return;

      // The audio of the turn in progress, kept for a replacement leg; a
      // pause in the audio starts a new turn.
      if (now - s.lastAudioAt >= TURN_GAP_MS) {
        s.turnAudio = [];
        s.turnAudioBytes = 0;
      }
      s.lastAudioAt = now;
      s.turnAudio.push(frame);
      s.turnAudioBytes += frame.byteLength;
      const maxReplayBytes = s.bytesPerSecond * MAX_REPLAY_SECONDS;
      while (s.turnAudioBytes > maxReplayBytes && s.turnAudio.length > 1) {
        s.turnAudioBytes -= s.turnAudio.shift()!.byteLength;
      }

      if (current) {
        current.session!.sendAudio(frame);
        return;
      }
      s.pendingFrames.push(frame);
      s.pendingBytes += frame.byteLength;
      // Speech after a silence the provider closed: reopen, holding the audio.
      if (s.ready && !s.opening) openLeg(s, "reopen");
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
    void admitted.then((allowed) => {
      if (!allowed) {
        socket.close(1013, "RATE_LIMITED");
        return;
      }
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
    });

    clientSocket.on("close", () => {
      closed = true;
      const s = stream;
      stream = null;
      if (s) {
        clearInterval(s.tick);
        for (const leg of [s.current, s.standby, s.opening]) abortLeg(leg);
      }
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

// The person's own allowance, or the service's daily total, is used up.
function voiceLimitRefusal(verdict: UsageVerdict): { code: string; message: string } | null {
  if (verdict === "exhausted") return { code: "DAILY_VOICE_LIMIT", message: DAILY_VOICE_LIMIT_MESSAGE };
  if (verdict === "service_exhausted") return { code: "SERVICE_VOICE_LIMIT", message: SERVICE_VOICE_LIMIT_MESSAGE };
  return null;
}

function ticketRefusalStatus(reason: string): number {
  if (reason === "ACTIVE_ENTITLEMENT_REQUIRED" || reason === "VOICE_DISABLED_BY_ADMIN") return 403;
  if (reason === "POLICY_UNAVAILABLE") return 503;
  return 401;
}
