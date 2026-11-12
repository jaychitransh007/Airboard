import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  BOARD_SCENE_VERSION,
  authorizeBoardEvent,
  canJoinBoard,
  shouldLockForOwnerAbsence,
  type BoardEvent,
  type BoardSession,
  type MeetingProvider,
  type Participant,
  type ParticipantRole,
} from "@airboard/core";
import Fastify, { type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { ApiConfig } from "./config";
import { clientKey, createEventBudget, secretsMatch } from "./security";
import { createSharedRateLimiter } from "./sharedRateLimit";
import { validateSessionStartBody } from "./sessionStartValidation";
import { registerSemanticIntentRoutes } from "./semanticIntent/routes";
import { createSessionStore } from "./storeFactory";
import type { SessionStore } from "./store";
import { registerTranscriptionRoutes } from "./transcription/routes";
import { VoiceTraceBuffer } from "./voiceTrace/buffer";
import { registerVoiceTraceRoutes } from "./voiceTrace/routes";
import { AuthService, type AuthContext } from "./auth";
import { canEditBoards } from "./boardAccess";
import { activeMembership, organizationPolicy } from "./organizationPolicy";
import { registerControlPlaneRoutes } from "./controlPlaneRoutes";
import { bearerToken, issueSignedToken, verifySignedToken } from "./signedTokens";
import { AIRBOARD_CORS_MAX_AGE_SECONDS, AIRBOARD_CORS_METHODS } from "./cors";
import { singleInstanceFanOut, supabaseFanOut, type BoardEventFanOut, type FanOutClient } from "./boardEventFanOut";
import { registerReadOnlyGuard } from "./readOnly";
import { redactSensitiveRequestUrl } from "./requestLogging";
import {
  invalidBoardEventReason,
  isSupportedSceneVersion,
} from "./boardEventValidation";

type RoomClient = {
  participantId: string;
  socket: WebSocket;
  role: ParticipantRole | null;
};

// Per-connection cache so session-status changes (lock / end / owner-disconnect)
// and the owner's guest-editing switch (permission.changed) are picked up within
// ~1s, while high-frequency events (cursor moves) don't force a store round-trip
// each time. Participant roles have no mutation path.
const AUTH_CACHE_TTL_MS = 1000;
/** Largest socket message accepted; a compound board batch is a few hundred KB. */
const MAX_SOCKET_MESSAGE_BYTES = 1024 * 1024;
/** Most events one board batch may carry; compound commands stay far below. */
const MAX_EVENTS_PER_BATCH = 500;
/**
 * How long a live link admits new people. People already in keep going; the
 * owner gets a fresh link each time the board opens, and ending the session
 * (Settings → Sessions) stops a link at once.
 */
export const JOIN_LINK_TTL_SECONDS = 2 * 60 * 60;
/**
 * A realtime ticket admits one live-board socket and travels in its URL, so
 * it stays short. The board trades it for a fresh one before it runs out
 * (POST /sessions/:id/ticket), so a session outlives any one ticket.
 */
const REALTIME_TICKET_TTL_SECONDS = 30 * 60;
/**
 * A live session's refresh token, which trades for fresh realtime tickets,
 * outlives the session's whole six-hour life. It only travels in JSON bodies.
 */
const REALTIME_REFRESH_TTL_SECONDS = 12 * 60 * 60;
/** How long past expiry a genuine ticket is still recognised as expired rather than forged. */
const EXPIRED_TICKET_RECOGNITION_SECONDS = 12 * 60 * 60;
/** Most missed events one catch-up page returns (PostgREST's row cap); the board pages on. */
const MAX_CATCH_UP_EVENTS = 1_000;

/** A session the store says doesn't exist answers 404; a failing store, 503 to retry. */
function sessionLookupStatus(error: unknown): { status: number; error: string } {
  return error instanceof Error && error.message === "SESSION_NOT_FOUND"
    ? { status: 404, error: "SESSION_NOT_FOUND" }
    : { status: 503, error: "SESSION_LOOKUP_FAILED" };
}

/** Closes a socket a few seconds from now, so a client that retries at once can't flood the store. */
function closeAfterPause(socket: { close(code: number, reason: string): void }, code: number, reason: string): void {
  const timer = setTimeout(() => {
    try {
      socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }, 5_000);
  (timer as { unref?: () => void }).unref?.();
}

/** One participant's realtime ticket and the refresh token that renews it. */
function liveCredentials(
  secret: string,
  claims: { sub: string; organizationId?: string; sessionId: string; participantId: string },
): { realtimeTicket: string; refreshToken: string } {
  return {
    realtimeTicket: issueSignedToken(secret, { purpose: "realtime", ...claims, ttlSeconds: REALTIME_TICKET_TTL_SECONDS }),
    refreshToken: issueSignedToken(secret, { purpose: "realtime_refresh", ...claims, ttlSeconds: REALTIME_REFRESH_TTL_SECONDS }),
  };
}

/** Why a session can't be joined: locked until its owner returns, or over. */
function notJoinableReason(session: BoardSession): "SESSION_LOCKED" | "SESSION_NOT_JOINABLE" {
  return session.status === "locked" && new Date(session.expiresAt).getTime() > Date.now()
    ? "SESSION_LOCKED"
    : "SESSION_NOT_JOINABLE";
}

export async function buildServer(
  config: ApiConfig,
  dependencies: { store?: SessionStore; fanOut?: BoardEventFanOut; auth?: AuthService } = {},
) {
  const server = Fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: redactSensitiveRequestUrl(request.url),
            host: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket.remotePort ?? 0,
          };
        },
      },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['stripe-signature']",
        ],
        censor: "[REDACTED]",
      },
    },
  });
  const store = dependencies.store ?? createSessionStore(config);
  const auth = dependencies.auth ?? new AuthService(config);
  const rooms = new Map<string, Set<RoomClient>>();
  // Other API instances may hold sockets for the same session (Cloud Run can
  // run several); their accepted events arrive through the fan-out.
  const fanOut: BoardEventFanOut =
    dependencies.fanOut ??
    (auth.client && config.realtimeFanOut
      ? supabaseFanOut(auth.client as unknown as FanOutClient, {
          loadEvents: async (sessionId, from, to) => store.getEventsInRange(sessionId, from, to),
          latestSequence: async (sessionId) => store.getLatestSequence(sessionId),
          onError: (error, context) => server.log.warn({ err: error, context }, "board event fan-out failed"),
        })
      : singleInstanceFanOut);
  const roomFanOutLeave = new Map<string, () => void>();
  const openRoom = (sessionId: string) => {
    const room = new Set<RoomClient>();
    rooms.set(sessionId, room);
    roomFanOutLeave.set(
      sessionId,
      fanOut.join(sessionId, (events) => {
        for (const event of events) broadcast(room, { type: "board.event", event });
      }),
    );
    return room;
  };
  // Whether this instance may join the channels live boards share. Checked
  // inside a request (/ready), since Cloud Run throttles CPU between them; a
  // pass is reused for 10 minutes and a failure retried after 30 seconds.
  let fanOutCheck: { status: Promise<string>; at: number } | undefined;
  const boardFanOutStatus = async (): Promise<"ready" | "unavailable" | "off"> => {
    if (!fanOut.probe) return "off";
    const age = fanOutCheck ? Date.now() - fanOutCheck.at : Infinity;
    if (!fanOutCheck || age > 600_000 || (age > 30_000 && (await fanOutCheck.status) !== "SUBSCRIBED")) {
      const status = fanOut.probe().then((result) => {
        if (result !== "SUBSCRIBED") server.log.warn({ status: result }, "board event fan-out cannot join its channels");
        return result;
      });
      fanOutCheck = { status, at: Date.now() };
    }
    return (await fanOutCheck.status) === "SUBSCRIBED" ? "ready" : "unavailable";
  };
  server.addHook("onClose", async () => {
    await fanOut.close();
  });
  const closeRoomIfEmpty = (sessionId: string, room: Set<RoomClient>) => {
    if (room.size > 0 || rooms.get(sessionId) !== room) return;
    rooms.delete(sessionId);
    roomFanOutLeave.get(sessionId)?.();
    roomFanOutLeave.delete(sessionId);
  };
  // At most one pending owner-absence lock timer per session, so repeated owner
  // disconnects (flapping) cannot pile up timers.
  const ownerLockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const voiceTraceBuffer = new VoiceTraceBuffer();
  const requestStartedAt = new WeakMap<object, number>();
  const requestMetrics = new Map<string, { count: number; durationMs: number }>();

  server.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    reply.header("x-request-id", request.id);
    const traceparent = request.headers.traceparent;
    if (typeof traceparent === "string" && /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(traceparent)) {
      reply.header("traceparent", traceparent);
    }
  });
  server.addHook("onResponse", async (request, reply) => {
    const durationMs = Math.max(0, performance.now() - (requestStartedAt.get(request) ?? performance.now()));
    const route = request.routeOptions.url || "unmatched";
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    const key = `${request.method} ${route} ${statusClass}`;
    const metric = requestMetrics.get(key) ?? { count: 0, durationMs: 0 };
    metric.count += 1; metric.durationMs += durationMs; requestMetrics.set(key, metric);
    request.log.info({ requestId: request.id, route, statusCode: reply.statusCode, durationMs: Math.round(durationMs * 10) / 10 }, "request completed");
  });

  await server.register(cors, {
    origin: config.allowedOrigins,
    methods: [...AIRBOARD_CORS_METHODS],
    maxAge: AIRBOARD_CORS_MAX_AGE_SECONDS,
  });
  registerReadOnlyGuard(server, config.readOnly);
  // Preserve Stripe's exact request bytes for signature verification while
  // continuing to parse every other JSON request normally.
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      if (request.url.startsWith("/webhooks/stripe")) {
        done(null, body);
        return;
      }
      try {
        done(null, body ? JSON.parse(String(body)) : {});
      } catch {
        // A body that isn't JSON is the caller's mistake: 400, not 500.
        done(Object.assign(new Error("The request body is not valid JSON."), { statusCode: 400, code: "INVALID_JSON_BODY" }), undefined);
      }
    },
  );
  // The largest legitimate message is a compound board batch of a few
  // hundred KB; audio frames are far smaller.
  await server.register(websocket, { options: { maxPayload: MAX_SOCKET_MESSAGE_BYTES } });
  // Per-minute limits, counted across instances (see sharedRateLimit.ts).
  const sharedLimit = (bucket: string, max: number) =>
    createSharedRateLimiter({
      bucket,
      windowMs: 60_000,
      max,
      client: auth.client,
      keySecret: config.sessionSigningSecret,
      onError: (error) => server.log.warn({ err: error, bucket }, "shared rate limit could not be counted"),
    });
  const sessionStartLimiter = sharedLimit("session_start", config.rateLimits.sessionStartPerMinute);
  const boardConnectionLimiter = sharedLimit("board_connection", config.rateLimits.boardConnectionsPerMinute);
  const boardReadLimiter = sharedLimit("board_read", config.rateLimits.boardReadsPerMinute);
  const callerKey = (request: FastifyRequest) =>
    clientKey(request, { trustedProxyHops: config.trustedProxyHops });
  // Board sockets open on this instance. Each Cloud Run instance takes a fixed
  // number of requests, sockets included, so these caps stop one participant,
  // address or board from holding all of them.
  const openBoardSockets = {
    participant: new Map<string, number>(),
    caller: new Map<string, number>(),
    session: new Map<string, number>(),
  };
  registerTranscriptionRoutes(server, config, auth);
  registerSemanticIntentRoutes(server, config, voiceTraceBuffer, auth);
  registerVoiceTraceRoutes(server, config, voiceTraceBuffer, auth);
  registerControlPlaneRoutes(server, config, auth);

  server.get("/health", async () => ({
    ok: true,
    service: "airboard-api",
  }));

  server.get("/ready", async (_request, reply) => {
    const billingReady = Boolean(
      config.stripe.enabled &&
      config.stripe.secretKey &&
      config.stripe.webhookSecret &&
      config.stripe.personalPriceId &&
      config.stripe.teamPriceId,
    );
    if (!auth.client) {
      // Only local development runs without a database; anything else is not ready.
      return reply.code(config.localEntitlements ? 200 : 503).send({
        ready: config.localEntitlements,
        service: "airboard-api",
        dependencies: { database: "not_configured", billing: billingReady ? "configured" : "not_configured" },
      });
    }
    const { error } = await auth.client.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
    if (error) {
      return reply.code(503).send({
        ready: false,
        service: "airboard-api",
        dependencies: { database: "unavailable", billing: billingReady ? "configured" : "not_configured" },
      });
    }
    return {
      ready: true,
      service: "airboard-api",
      dependencies: {
        database: "ready",
        billing: billingReady ? "configured" : "not_configured",
        transcription: Boolean(config.transcription.apiKey),
        semanticIntent: Boolean(config.semanticIntent.apiKey),
        boardFanOut: await boardFanOutStatus(),
      },
    };
  });

  server.get("/metrics", async (request, reply) => {
    const expected = config.cronSecret ?? config.apiToken;
    if (!secretsMatch(bearerToken(request.headers), expected)) return reply.code(401).send({ error: "METRICS_AUTH_REQUIRED" });
    const lines = ["# HELP airboard_http_requests_total HTTP requests by route and status class.", "# TYPE airboard_http_requests_total counter", "# HELP airboard_http_request_duration_ms_total Cumulative HTTP request duration.", "# TYPE airboard_http_request_duration_ms_total counter"];
    for (const [key, value] of requestMetrics) {
      const [method, route, status] = key.split(" ");
      const labels = `method="${method}",route="${String(route).replaceAll('"', '')}",status="${status}"`;
      lines.push(`airboard_http_requests_total{${labels}} ${value.count}`);
      lines.push(`airboard_http_request_duration_ms_total{${labels}} ${value.durationMs.toFixed(3)}`);
    }
    return reply.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
  });

  server.get("/", async () => ({
    ok: true,
    service: "airboard-api",
  }));

  /** The session, if the signed-in caller started it. */
  const ownedSession = async (
    sessionId: string,
    request: FastifyRequest,
  ): Promise<
    | { refused: { status: number; error: string } }
    | { refused: null; session: BoardSession; account: AuthContext }
  > => {
    const account = await auth.authenticate(request);
    if (!account) return { refused: { status: 401, error: "OWNER_AUTH_REQUIRED" } };
    let session: BoardSession;
    try {
      session = await store.getSession(sessionId);
    } catch {
      return { refused: { status: 404, error: "SESSION_NOT_FOUND" } };
    }
    if (session.ownerUserId !== account.profileId) return { refused: { status: 404, error: "SESSION_NOT_FOUND" } };
    return { refused: null, session, account };
  };

  server.post<{
    Body: {
      provider?: MeetingProvider;
      providerMeetingId?: string;
      title?: string;
      workspaceId?: string;
      boardId?: string;
      allowParticipantDrawing?: boolean;
    };
  }>("/sessions/start", async (request, reply) => {
    const account = await auth.authenticate(request);
    if (!account) {
      return reply.code(401).send({ error: "OWNER_AUTH_REQUIRED" });
    }
    // Starting a session makes its owner an editor of the board; Viewer and
    // Billing members open boards read-only instead.
    if (!canEditBoards(account.role)) {
      return reply.code(403).send({ error: "BOARD_READ_ONLY_ROLE" });
    }
    if (
      !(await sessionStartLimiter.allow(
        clientKey(request, {
          profileId: account.profileId,
          trustedProxyHops: config.trustedProxyHops,
        }),
      ))
    ) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    // JSON off the wire is untyped: bound provider, meeting binding, and
    // title before they reach the store or persistence.
    const validation = validateSessionStartBody(request.body);
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error });
    }

    try {
      const result = await store.startSession({
        ownerUserId: account.profileId,
        organizationId: account.organizationId,
        ...validation.value,
      });
      return {
        ...result,
        sceneVersion: BOARD_SCENE_VERSION,
        ...liveCredentials(config.sessionSigningSecret, {
          sub: account.profileId,
          organizationId: account.organizationId,
          sessionId: result.session.id,
          participantId: result.ownerParticipant.id,
        }),
        joinToken: issueSignedToken(config.sessionSigningSecret, {
          purpose: "join",
          sub: account.profileId,
          organizationId: account.organizationId,
          sessionId: result.session.id,
          ttlSeconds: JOIN_LINK_TTL_SECONDS,
        }),
      };
    } catch (error) {
      return reply.code(403).send({ error: error instanceof Error ? error.message : "FORBIDDEN" });
    }
  });

  server.post<{
    Params: { sessionId: string };
    Body: { displayName?: string; joinToken?: string };
  }>("/sessions/:sessionId/join", async (request, reply) => {
    const join = request.body.joinToken
      ? verifySignedToken(config.sessionSigningSecret, request.body.joinToken, "join")
      : null;
    if (!join || join.sessionId !== request.params.sessionId) {
      return reply.code(401).send({ error: "VALID_JOIN_TOKEN_REQUIRED" });
    }
    // With "External guests" off (Admin → Policy), only the organization's
    // active members may join, signed in.
    if (join.organizationId && auth.client) {
      try {
        const policy = await organizationPolicy(auth.client, join.organizationId);
        if (!policy.externalGuestsAllowed) {
          const account = await auth.authenticate(request);
          const member = account
            ? await activeMembership(auth.client, join.organizationId, account.profileId)
            : null;
          if (!member) return reply.code(403).send({ error: "EXTERNAL_GUESTS_DISABLED" });
        }
      } catch {
        return reply.code(503).send({ error: "POLICY_UNAVAILABLE" });
      }
    }
    try {
      // "New link" stops older links from admitting anyone new.
      const current = await store.getSession(request.params.sessionId);
      if (joinLinkReplaced(join.iat, current.joinLinksResetAt)) {
        return reply.code(401).send({ error: "JOIN_LINK_REPLACED" });
      }
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
    try {
      const result = await store.joinSession({
        sessionId: request.params.sessionId,
        displayName: request.body.displayName ?? "Guest",
      });
      return {
        ...result,
        state: forLegacyClients(result.state),
        sceneVersion: BOARD_SCENE_VERSION,
        ...liveCredentials(config.sessionSigningSecret, {
          sub: result.participant.id,
          ...(join.organizationId ? { organizationId: join.organizationId } : {}),
          sessionId: result.session.id,
          participantId: result.participant.id,
        }),
      };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  // The session's owner, signed in, back in their own session after a reload:
  // they rejoin as its owner rather than as a guest of their own board.
  server.post<{
    Params: { sessionId: string };
    Body: { participantId?: string };
  }>("/sessions/:sessionId/resume", async (request, reply) => {
    const owned = await ownedSession(request.params.sessionId, request);
    if (owned.refused) return reply.code(owned.refused.status).send({ error: owned.refused.error });
    const participantId = typeof request.body?.participantId === "string" ? request.body.participantId : "";
    const participant = participantId ? await store.getParticipant(owned.session.id, participantId) : null;
    if (!participant || participant.role !== "owner" || !canJoinBoard(owned.session)) {
      return reply.code(404).send({ error: "SESSION_NOT_JOINABLE" });
    }
    return {
      session: owned.session,
      participant,
      sceneVersion: BOARD_SCENE_VERSION,
      state: forLegacyClients(await store.getState(owned.session.id)),
      ...liveCredentials(config.sessionSigningSecret, {
        sub: owned.account.profileId,
        organizationId: owned.account.organizationId,
        sessionId: owned.session.id,
        participantId: participant.id,
      }),
    };
  });

  // "New link" in Share: links issued before now stop admitting new people;
  // everyone already in keeps going. Ending the session removes them too.
  server.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/join-link", async (request, reply) => {
    const owned = await ownedSession(request.params.sessionId, request);
    if (owned.refused) return reply.code(owned.refused.status).send({ error: owned.refused.error });
    if (!canJoinBoard(owned.session)) return reply.code(409).send({ error: "SESSION_NOT_JOINABLE" });
    await store.resetJoinLinks(owned.session.id);
    return {
      joinToken: issueSignedToken(config.sessionSigningSecret, {
        purpose: "join",
        sub: owned.account.profileId,
        organizationId: owned.account.organizationId,
        sessionId: owned.session.id,
        ttlSeconds: JOIN_LINK_TTL_SECONDS,
      }),
    };
  });

  // Trades a refresh token (never in a URL, unlike the realtime ticket) for a
  // fresh realtime ticket while its holder is still in a session that is
  // open. The board does this before its ticket runs out, so live sync and the
  // heartbeat keep working for the whole meeting; ending the session stops it.
  // The owner must also be signed in: their return revives a session locked
  // while they were away, as their heartbeat does.
  server.post<{
    Params: { sessionId: string };
    Body: { refreshToken?: unknown };
  }>("/sessions/:sessionId/ticket", async (request, reply) => {
    if (!(await boardReadLimiter.allow(callerKey(request)))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const presented = typeof request.body?.refreshToken === "string" ? request.body.refreshToken : "";
    const ticket = presented ? verifySignedToken(config.sessionSigningSecret, presented, "realtime_refresh") : null;
    if (!ticket?.participantId || ticket.sessionId !== request.params.sessionId) {
      return reply.code(401).send({ error: "REFRESH_TOKEN_REQUIRED" });
    }
    let session: BoardSession;
    let participant: Participant | null;
    try {
      session = await store.getSession(request.params.sessionId);
      participant = await store.getParticipant(session.id, ticket.participantId);
    } catch (error) {
      const refusal = sessionLookupStatus(error);
      return reply.code(refusal.status).send({ error: refusal.error });
    }
    if (!participant || participant.boardSessionId !== session.id) {
      return reply.code(404).send({ error: "PARTICIPANT_NOT_IN_SESSION" });
    }
    if (participant.role === "owner") {
      const account = await auth.authenticate(request);
      if (!account || account.profileId !== session.ownerUserId) {
        return reply.code(401).send({ error: "OWNER_AUTH_REQUIRED" });
      }
      if (session.status !== "ended") {
        try {
          session = await store.heartbeat(session.id, participant.id);
        } catch {
          return reply.code(503).send({ error: "SESSION_LOOKUP_FAILED" });
        }
      }
    }
    if (!canJoinBoard(session)) {
      return reply.code(409).send({ error: notJoinableReason(session) });
    }
    return {
      realtimeTicket: issueSignedToken(config.sessionSigningSecret, {
        purpose: "realtime",
        sub: ticket.sub,
        ...(ticket.organizationId ? { organizationId: ticket.organizationId } : {}),
        sessionId: session.id,
        participantId: participant.id,
        ttlSeconds: REALTIME_TICKET_TTL_SECONDS,
      }),
      expiresInSeconds: REALTIME_TICKET_TTL_SECONDS,
    };
  });

  // The events a board missed while its socket was away, after the last
  // sequence it applied, a page of at most MAX_CATCH_UP_EVENTS at a time; the
  // board asks again until it reaches latestSequence. The ticket goes in the
  // body, not the URL.
  server.post<{
    Params: { sessionId: string };
    Body: { realtimeTicket?: unknown; after?: unknown };
  }>("/sessions/:sessionId/events", async (request, reply) => {
    if (!(await boardReadLimiter.allow(callerKey(request)))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const presented = typeof request.body?.realtimeTicket === "string" ? request.body.realtimeTicket : "";
    const ticket = presented ? verifySignedToken(config.sessionSigningSecret, presented, "realtime") : null;
    if (!ticket || ticket.sessionId !== request.params.sessionId) {
      return reply.code(401).send({ error: "REALTIME_TICKET_REQUIRED" });
    }
    const after = request.body?.after;
    if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0) {
      return reply.code(400).send({ error: "INVALID_AFTER" });
    }
    try {
      const latestSequence = await store.getLatestSequence(request.params.sessionId);
      if (latestSequence <= after) return { events: [], latestSequence };
      return {
        events: await store.getEventsInRange(
          request.params.sessionId,
          after + 1,
          Math.min(latestSequence, after + MAX_CATCH_UP_EVENTS),
        ),
        latestSequence,
      };
    } catch (error) {
      const refusal = sessionLookupStatus(error);
      return reply.code(refusal.status).send({ error: refusal.error });
    }
  });

  server.post<{
    Params: { sessionId: string };
    Body: { realtimeTicket: string };
  }>("/sessions/:sessionId/heartbeat", async (request, reply) => {
    if (!(await boardReadLimiter.allow(callerKey(request)))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const ticket = verifySignedToken(
      config.sessionSigningSecret,
      request.body.realtimeTicket,
      "realtime",
    );
    if (!ticket?.participantId || ticket.sessionId !== request.params.sessionId) {
      return reply.code(401).send({ error: "REALTIME_TICKET_REQUIRED" });
    }
    try {
      return {
        session: await store.heartbeat(request.params.sessionId, ticket.participantId),
      };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  server.get<{
    Params: { sessionId: string };
    Querystring: { ticket?: string };
  }>("/sessions/:sessionId/state", async (request, reply) => {
    if (!(await boardReadLimiter.allow(callerKey(request)))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const ticket = request.query.ticket
      ? verifySignedToken(config.sessionSigningSecret, request.query.ticket, "realtime")
      : null;
    if (!ticket || ticket.sessionId !== request.params.sessionId) {
      return reply.code(401).send({ error: "REALTIME_TICKET_REQUIRED" });
    }
    try {
      return {
        sceneVersion: BOARD_SCENE_VERSION,
        session: await store.getSession(request.params.sessionId),
        state: forLegacyClients(await store.getState(request.params.sessionId)),
      };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  server.get("/ws", { websocket: true }, (socket, request) => {
    // Counted now, awaited before the socket joins its room below.
    const admitted = boardConnectionLimiter.allow(callerKey(request));
    const eventLimiter = createEventBudget({ windowMs: 10_000, max: config.rateLimits.boardEventsPerTenSeconds });
    // Board events are writes, so live boards pause with everything else.
    if (config.readOnly) {
      try {
        socket.send(JSON.stringify({ type: "error", reason: "MAINTENANCE" }));
      } catch {
        // best effort before the close
      }
      socket.close(1013, "MAINTENANCE");
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (!isSupportedSceneVersion(url.searchParams.get("sceneVersion"))) {
      try {
        socket.send(JSON.stringify({ type: "error", reason: "UPGRADE_REQUIRED" }));
      } catch {
        // best effort before the policy close
      }
      socket.close(1008, "UPGRADE_REQUIRED");
      return;
    }
    const ticketValue = url.searchParams.get("ticket");
    const ticket = ticketValue
      ? verifySignedToken(config.sessionSigningSecret, ticketValue, "realtime")
      : null;
    const boardSessionId = ticket?.sessionId ?? null;
    const participantId = ticket?.participantId ?? null;

    if (!boardSessionId || !participantId) {
      // A genuine ticket that has only run out: the board trades it for a
      // fresh one and reconnects, rather than giving up.
      const expired =
        ticketValue &&
        verifySignedToken(config.sessionSigningSecret, ticketValue, "realtime", {
          acceptExpiredForSeconds: EXPIRED_TICKET_RECOGNITION_SECONDS,
        });
      socket.close(1008, expired ? "TICKET_EXPIRED" : "A valid realtime ticket is required");
      return;
    }

    const held = [
      [openBoardSockets.participant, participantId, config.boardSockets.perParticipant],
      [openBoardSockets.caller, callerKey(request), config.boardSockets.perCaller],
      [openBoardSockets.session, boardSessionId, config.boardSockets.perSession],
    ] as const;
    if (held.some(([open, key, limit]) => (open.get(key) ?? 0) >= limit)) {
      // 1013 (try again later): the client backs off and retries.
      socket.close(1013, "BOARD_CONNECTION_LIMIT");
      return;
    }
    for (const [open, key] of held) open.set(key, (open.get(key) ?? 0) + 1);
    socket.once("close", () => {
      for (const [open, key] of held) {
        const remaining = (open.get(key) ?? 1) - 1;
        if (remaining > 0) open.set(key, remaining);
        else open.delete(key);
      }
    });

    const typedSocket = socket as unknown as WebSocket;
    const client: RoomClient = {
      participantId,
      socket: typedSocket,
      role: null,
    };

    const denyAndClose = (code: number, reason: string) => {
      try {
        socket.send(JSON.stringify({ type: "error", reason }));
      } catch {
        // ignore send failures on a socket we are about to close
      }
      socket.close(code, reason);
    };

    let cachedAuth: { session: BoardSession; participant: Participant; fetchedAt: number } | null =
      null;
    const resolveAuth = async (): Promise<{
      session: BoardSession;
      participant: Participant;
    } | null> => {
      const now = Date.now();
      if (cachedAuth && now - cachedAuth.fetchedAt < AUTH_CACHE_TTL_MS) {
        return cachedAuth;
      }
      const session = await store.getSession(boardSessionId);
      const participant = await store.getParticipant(boardSessionId, participantId);
      if (!participant || participant.boardSessionId !== session.id) {
        return null;
      }
      cachedAuth = { session, participant, fetchedAt: now };
      client.role = participant.role;
      return cachedAuth;
    };

    // Lock the board if the owner is still absent after the grace period. Skipped
    // if an owner reconnected in the meantime. At most one timer per session:
    // owner flapping replaces the pending timer instead of accumulating timers.
    const scheduleOwnerAbsenceLock = () => {
      const existing = ownerLockTimers.get(boardSessionId);
      if (existing) {
        clearTimeout(existing);
      }
      const timer = setTimeout(() => {
        ownerLockTimers.delete(boardSessionId);
        void (async () => {
          const currentRoom = rooms.get(boardSessionId);
          if (currentRoom && [...currentRoom].some((member) => member.role === "owner")) {
            return;
          }
          try {
            const session = await store.getSession(boardSessionId);
            if (
              shouldLockForOwnerAbsence({
                session,
                ownerGracePeriodSeconds: config.ownerGraceSeconds,
              })
            ) {
              await store.lockSession(boardSessionId);
            }
          } catch {
            // Session may have ended or been removed; nothing to lock.
          }
        })();
      }, config.ownerGraceSeconds * 1000);
      // Do not keep the process alive solely for this timer.
      (timer as { unref?: () => void }).unref?.();
      ownerLockTimers.set(boardSessionId, timer);
    };

    // An owner (re)joining cancels any pending absence lock for the session.
    const cancelOwnerAbsenceLock = () => {
      const existing = ownerLockTimers.get(boardSessionId);
      if (existing) {
        clearTimeout(existing);
        ownerLockTimers.delete(boardSessionId);
      }
    };

    // Authorize the connection before joining the room: the session must exist
    // and be joinable, and the participant must belong to it. This is the gate
    // that stops an unauthenticated party from streaming into a guessed board.
    void (async () => {
      if (!(await admitted)) {
        socket.close(1013, "RATE_LIMITED");
        return;
      }
      try {
        const auth = await resolveAuth();
        if (!auth) {
          denyAndClose(1008, "PARTICIPANT_NOT_IN_SESSION");
          return;
        }
        if (!canJoinBoard(auth.session)) {
          denyAndClose(1008, notJoinableReason(auth.session));
          return;
        }
      } catch (error) {
        // A failing store is temporary: close so the board retries (1011),
        // rather than refuse it for good (1008). The pause first keeps older
        // boards, which retry within a second, off a database that's struggling.
        if (sessionLookupStatus(error).status === 404) denyAndClose(1008, "SESSION_NOT_FOUND");
        else closeAfterPause(socket, 1011, "SESSION_LOOKUP_FAILED");
        return;
      }

      const room = rooms.get(boardSessionId) ?? openRoom(boardSessionId);
      room.add(client);
      try {
        socket.send(
          JSON.stringify({
            type: "board.initialized",
            sceneVersion: BOARD_SCENE_VERSION,
          }),
        );
      } catch {
        room.delete(client);
        closeRoomIfEmpty(boardSessionId, room);
        socket.close(1011, "INITIALIZATION_FAILED");
        return;
      }
      // An owner reconnecting cancels a pending absence lock.
      if (client.role === "owner") {
        cancelOwnerAbsenceLock();
      }

      // One socket's messages are handled in the order they arrived: two
      // batches sent back to back must be stored in that order, or a change
      // can land before the one it depends on.
      let messageQueue: Promise<void> = Promise.resolve();
      const handleMessage = async (rawMessage: { toString(): string }) => {
        const payload = safeParse(rawMessage.toString());
        // Accept a single event or a compound batch. A batch is authorized and
        // appended atomically so its events keep a contiguous sequence block.
        let incoming: BoardEvent[];
        if (payload?.type === "board.event") {
          incoming = [payload.event as BoardEvent];
        } else if (payload?.type === "board.events" && Array.isArray(payload.events)) {
          incoming = payload.events as BoardEvent[];
        } else {
          return;
        }
        if (incoming.length === 0) {
          return;
        }
        // A batch is one atomic append; anything larger than a compound
        // command could produce is refused, and a socket sending far faster
        // than drawing does is refused until it slows down.
        const refusal =
          incoming.length > MAX_EVENTS_PER_BATCH
            ? "BATCH_TOO_LARGE"
            : !eventLimiter.allowMany(incoming.length)
              ? "RATE_LIMITED"
              : null;
        if (refusal) {
          try {
            socket.send(JSON.stringify({ type: "event.rejected", reason: refusal, eventId: (incoming[0] as { id?: string }).id }));
          } catch {
            // best effort
          }
          return;
        }

        // Validate every event before authorization/persistence so an unknown
        // type or a crash-inducing payload is never stored or reduced.
        const invalid = incoming
          .map((event) => ({ event, reason: invalidBoardEventReason(event) }))
          .find((entry) => entry.reason !== null);
        if (invalid && invalid.reason) {
          try {
            socket.send(
              JSON.stringify({
                type: "event.rejected",
                reason: invalid.reason,
                eventId: (invalid.event as { id?: string }).id,
              }),
            );
          } catch {
            // best effort
          }
          return;
        }

        // Re-authorize (cached briefly) so role and permission changes take
        // effect, then authorize every event type in the batch.
        let auth: { session: BoardSession; participant: Participant } | null;
        try {
          auth = await resolveAuth();
        } catch (error) {
          if (sessionLookupStatus(error).status === 404) denyAndClose(1008, "SESSION_NOT_FOUND");
          else closeAfterPause(socket, 1011, "SESSION_LOOKUP_FAILED");
          return;
        }

        if (!auth) {
          denyAndClose(1008, "PARTICIPANT_NOT_IN_SESSION");
          return;
        }

        const resolvedAuth = auth;
        const rejected = incoming
          .map((event) => ({
            event,
            decision: authorizeBoardEvent({
              session: resolvedAuth.session,
              participant: resolvedAuth.participant,
              event,
            }),
          }))
          .find((entry) => !entry.decision.allowed);
        if (rejected && !rejected.decision.allowed) {
          try {
            socket.send(
              JSON.stringify({
                type: "event.rejected",
                reason: rejected.decision.reason,
                eventId: rejected.event.id,
              }),
            );
          } catch {
            // best effort
          }
          return;
        }

        // Cursor moves are live presence: relay them but never store them.
        // They arrive several times a second per person, and replaying a board
        // never needs them. Without a sequence they skip the relay's catch-up.
        if (incoming.every((event) => event.type === "cursor.moved")) {
          const presence = incoming.map(({ sequence: _sequence, ...event }) => ({
            ...event,
            boardSessionId,
            actorParticipantId: participantId,
          })) as BoardEvent[];
          for (const event of presence) {
            broadcast(room, { type: "board.event", event });
          }
          fanOut.publish(boardSessionId, presence);
          return;
        }

        // The server is the authority for who acted; never trust a
        // client-supplied actorParticipantId. A persistence failure must surface
        // to the client instead of silently dropping events or rejecting unhandled.
        let events;
        try {
          events = await store.appendEvents(
            boardSessionId,
            incoming.map((event) => ({
              ...event,
              boardSessionId,
              actorParticipantId: participantId,
            })),
          );
        } catch (error) {
          server.log.error({ err: error, boardSessionId }, "board event append failed");
          try {
            socket.send(
              JSON.stringify({
                type: "event.append_failed",
                reason: error instanceof Error ? error.message : "APPEND_FAILED",
                eventIds: incoming.map((event) => event.id),
              }),
            );
          } catch {
            // best effort
          }
          return;
        }
        // The owner's Share switch: whether guests may edit takes effect for
        // every socket at its next permission check.
        const permission = [...events].reverse().find((event) => event.type === "permission.changed");
        if (permission && permission.type === "permission.changed") {
          try {
            await store.setParticipantDrawing(boardSessionId, permission.allowParticipantDrawing);
            cachedAuth = null;
          } catch (error) {
            server.log.error({ err: error, boardSessionId }, "guest editing change failed");
          }
        }
        for (const event of events) {
          broadcast(room, { type: "board.event", event });
        }
        fanOut.publish(boardSessionId, events);
      };
      socket.on("message", (rawMessage) => {
        messageQueue = messageQueue
          .then(() => handleMessage(rawMessage))
          .catch((error: unknown) => server.log.error({ err: error, boardSessionId }, "board message failed"));
      });

      socket.on("close", () => {
        room.delete(client);
        // If the owner just left and no other owner socket remains, mark the
        // session owner-disconnected and start the grace-period lock timer.
        const ownerStillPresent = [...room].some((member) => member.role === "owner");
        if (client.role === "owner" && !ownerStillPresent) {
          void (async () => {
            try {
              await store.markOwnerDisconnected(boardSessionId);
            } catch {
              // Session may already be gone; nothing to update.
            }
          })();
          scheduleOwnerAbsenceLock();
        }
        closeRoomIfEmpty(boardSessionId, room);
      });
    })();
  });

  return server;
}


// ws.readyState OPEN. Kept as a literal to avoid importing the ws runtime value.
const WS_OPEN = 1;

function broadcast(room: Set<RoomClient>, payload: unknown): void {
  const message = JSON.stringify(payload);
  const dead: RoomClient[] = [];
  for (const client of room) {
    if (client.socket.readyState !== WS_OPEN) {
      dead.push(client);
      continue;
    }
    try {
      client.socket.send(message);
    } catch {
      // A failing socket must not starve the rest of the room; prune it.
      dead.push(client);
    }
  }
  for (const client of dead) {
    room.delete(client);
  }
}

function safeParse(data: string): any {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** A live link issued (to the second) before the owner's last "New link". */
export function joinLinkReplaced(issuedAtSeconds: number, resetAt: string | undefined): boolean {
  if (!resetAt) return false;
  const resetSeconds = Math.floor(Date.parse(resetAt) / 1_000);
  return Number.isFinite(resetSeconds) && issuedAtSeconds < resetSeconds;
}

/**
 * launch-f5e326e tabs read the board's `strokes` map; remove ≥7 days after the API accepts
 * only scene version 3 (shape-merge phase 3, step C).
 */
export function forLegacyClients<T extends object>(state: T): T & { strokes: Record<string, never> } {
  return { strokes: {}, ...state };
}
