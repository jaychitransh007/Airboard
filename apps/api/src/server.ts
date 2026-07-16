import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  authorizeBoardEvent,
  canJoinBoard,
  shouldLockForOwnerAbsence,
  type BoardEvent,
  type BoardSession,
  type MeetingProvider,
  type Participant,
  type ParticipantRole,
} from "@airboard/core";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import type { ApiConfig } from "./config";
import { clientKey, createRateLimiter } from "./security";
import { validateSessionStartBody } from "./sessionStartValidation";
import { registerSemanticIntentRoutes } from "./semanticIntent/routes";
import { createSessionStore } from "./storeFactory";
import { registerTranscriptionRoutes } from "./transcription/routes";
import { VoiceTraceBuffer } from "./voiceTrace/buffer";
import { registerVoiceTraceRoutes } from "./voiceTrace/routes";

type RoomClient = {
  participantId: string;
  socket: WebSocket;
  role: ParticipantRole | null;
};

// The 16 board event types the reducer understands. Events off the wire are
// validated against this set before persistence so an unknown/forward-compat or
// hostile type is never stored (and the reducer's default branch is a backstop).
const BOARD_EVENT_TYPES: ReadonlySet<string> = new Set([
  "stroke.started",
  "stroke.point_added",
  "stroke.committed",
  "stroke.label_updated",
  "stroke.annotation_updated",
  "erase.committed",
  "stroke.deleted",
  "stroke.restored",
  "undo.requested",
  "redo.requested",
  "board.cleared",
  "cursor.moved",
  "participant.joined",
  "participant.left",
  "owner.presence_changed",
  "permission.changed",
]);

/**
 * Reject events the reducer cannot safely apply. Returns null when valid, or a
 * short reason code. Only the fields that can crash the reducer are checked;
 * deeper schema validation is left to the reducer's own guards.
 */
function invalidBoardEventReason(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return "MALFORMED_EVENT";
  }
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string" || !BOARD_EVENT_TYPES.has(type)) {
    return "UNKNOWN_EVENT_TYPE";
  }
  if (type === "stroke.point_added") {
    const point = (event as { point?: { t?: unknown } }).point;
    if (!point || typeof point !== "object" || !Number.isFinite((point as { t?: unknown }).t)) {
      return "INVALID_POINT_TIMESTAMP";
    }
  }
  return null;
}

// Per-connection cache so session-status changes (lock / end / owner-disconnect)
// are picked up within ~1s while high-frequency events (cursor moves) don't force
// a store round-trip each time. Note: participant role and session drawing policy
// have no mutation path today, so this TTL does NOT propagate permission changes.
const AUTH_CACHE_TTL_MS = 1000;

export async function buildServer(config: ApiConfig) {
  const server = Fastify({ logger: true });
  const store = createSessionStore(config);
  const rooms = new Map<string, Set<RoomClient>>();
  // At most one pending owner-absence lock timer per session, so repeated owner
  // disconnects (flapping) cannot pile up timers.
  const ownerLockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const voiceTraceBuffer = new VoiceTraceBuffer();

  await server.register(cors, {
    origin: config.allowedOrigins,
  });
  await server.register(websocket);
  const sessionStartLimiter = createRateLimiter({
    windowMs: 60_000,
    max: config.rateLimits.sessionStartPerMinute,
  });
  registerTranscriptionRoutes(server, config);
  registerSemanticIntentRoutes(server, config, voiceTraceBuffer);
  registerVoiceTraceRoutes(server, config, voiceTraceBuffer);

  server.get("/health", async () => ({
    ok: true,
    service: "airboard-api",
  }));

  server.get("/", async () => ({
    ok: true,
    service: "airboard-api",
    message: "Airboard API is running. Open the web app on http://localhost:3000.",
    routes: {
      web: "http://localhost:3000",
      health: "http://127.0.0.1:4000/health",
      sessions: "POST http://127.0.0.1:4000/sessions/start",
      transcriptionConfig: "GET http://127.0.0.1:4000/transcription/config",
      transcription: "WS ws://127.0.0.1:4000/transcription/ws",
      semanticIntentConfig: "GET http://127.0.0.1:4000/intent/config",
      semanticIntent: "POST http://127.0.0.1:4000/intent/resolve",
      voiceTrace: "POST http://127.0.0.1:4000/voice/trace",
    },
  }));

  server.post<{
    Body: {
      provider?: MeetingProvider;
      providerMeetingId?: string;
      title?: string;
      allowParticipantDrawing?: boolean;
    };
  }>("/sessions/start", async (request, reply) => {
    if (!sessionStartLimiter.allow(clientKey(request))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const ownerUserId = request.headers["x-airboard-user-id"];
    if (!ownerUserId || Array.isArray(ownerUserId)) {
      return reply.code(401).send({ error: "OWNER_AUTH_REQUIRED" });
    }
    // JSON off the wire is untyped: bound provider, meeting binding, and
    // title before they reach the store or persistence.
    const validation = validateSessionStartBody(request.body);
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error });
    }

    try {
      const result = await store.startSession({
        ownerUserId,
        ...validation.value,
      });
      return result;
    } catch (error) {
      return reply.code(403).send({ error: error instanceof Error ? error.message : "FORBIDDEN" });
    }
  });

  server.post<{
    Params: { sessionId: string };
    Body: { displayName?: string };
  }>("/sessions/:sessionId/join", async (request, reply) => {
    try {
      return await store.joinSession({
        sessionId: request.params.sessionId,
        displayName: request.body.displayName ?? "Guest",
      });
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  server.post<{
    Params: { sessionId: string };
    Body: { participantId: string };
  }>("/sessions/:sessionId/heartbeat", async (request, reply) => {
    try {
      return {
        session: await store.heartbeat(request.params.sessionId, request.body.participantId),
      };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  server.get<{
    Params: { sessionId: string };
  }>("/sessions/:sessionId/state", async (request, reply) => {
    try {
      return {
        session: await store.getSession(request.params.sessionId),
        state: await store.getState(request.params.sessionId),
      };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "NOT_FOUND" });
    }
  });

  server.get("/ws", { websocket: true }, (socket, request) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const boardSessionId = url.searchParams.get("boardSessionId");
    const participantId = url.searchParams.get("participantId");

    if (!boardSessionId || !participantId) {
      socket.close(1008, "boardSessionId and participantId are required");
      return;
    }

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
      try {
        const auth = await resolveAuth();
        if (!auth) {
          denyAndClose(1008, "PARTICIPANT_NOT_IN_SESSION");
          return;
        }
        if (!canJoinBoard(auth.session)) {
          denyAndClose(1008, "SESSION_NOT_JOINABLE");
          return;
        }
      } catch {
        denyAndClose(1008, "SESSION_NOT_FOUND");
        return;
      }

      const room = rooms.get(boardSessionId) ?? new Set<RoomClient>();
      room.add(client);
      rooms.set(boardSessionId, room);
      // An owner reconnecting cancels a pending absence lock.
      if (client.role === "owner") {
        cancelOwnerAbsenceLock();
      }

      socket.on("message", async (rawMessage) => {
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
        } catch {
          denyAndClose(1008, "SESSION_NOT_FOUND");
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

        // The server is the authority for who acted; never trust a
        // client-supplied actorParticipantId. A persistence failure must surface
        // to the client instead of silently dropping events or rejecting unhandled.
        let events;
        try {
          events = await store.appendEvents(
            boardSessionId,
            incoming.map((event) => ({ ...event, actorParticipantId: participantId })),
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
        for (const event of events) {
          broadcast(room, { type: "board.event", event });
        }
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
        if (room.size === 0) {
          rooms.delete(boardSessionId);
        }
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
