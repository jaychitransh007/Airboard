import {
  createEventEnvelope,
  type BoardEvent,
  type BoardState,
  type MeetingProvider,
  type Stroke,
} from "@airboard/core";
import {
  AirboardRealtimeClient,
  type RealtimeClientStatus,
  type RealtimeServerRejection,
} from "@airboard/realtime-client";

/**
 * Board sync: the client half of the sessions + /ws contract in apps/api.
 *
 * Responsibilities kept OUT of the React component:
 *  - session lifecycle (create as owner / join as guest, REST heartbeat),
 *  - the websocket event pipe (via AirboardRealtimeClient),
 *  - echo reconciliation — the server broadcasts every persisted event back
 *    to its sender, so locally-applied events must not re-apply when their
 *    echo arrives. Dedup is by event id, bounded FIFO.
 *
 * The module is dependency-injected (fetch, client factory, timers) so every
 * rule is unit-testable without a server.
 */

export type BoardSyncCallbacks = {
  /** A peer's event (never an echo of our own). Apply to the local board. */
  onRemoteEvent: (event: BoardEvent) => void;
  onStatus?: (status: RealtimeClientStatus) => void;
  /** Server denials: rejected events, persistence failures, auth errors. */
  onRejection?: (rejection: RealtimeServerRejection) => void;
};

export type BoardSyncHandle = {
  boardSessionId: string;
  participantId: string;
  role: string;
  /**
   * Publishes local events to peers. Returns false when the socket is not
   * open (the events were dropped — local state is still correct, but peers
   * will not see the change until something else publishes).
   */
  publish: (events: BoardEvent | readonly BoardEvent[]) => boolean;
  stop: () => void;
};

export type StartBoardSyncResult =
  | { outcome: "created"; handle: BoardSyncHandle; initialState: null }
  | { outcome: "joined"; handle: BoardSyncHandle; initialState: BoardState };

export type BoardSyncDependencies = {
  fetchImpl?: typeof fetch;
  createClient?: (options: {
    url: string;
    boardSessionId: string;
    participantId: string;
  }) => Pick<
    AirboardRealtimeClient,
    "connect" | "close" | "sendEvents" | "onEvent" | "onStatus" | "onRejection"
  >;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearTimer?: (timer: ReturnType<typeof setInterval>) => void;
  heartbeatIntervalMs?: number;
};

/** Keeps the owner inside the 180s absence grace with a wide margin. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/** Echo-dedup window: ids of the most recent locally-published events. */
const MAX_TRACKED_EVENT_IDS = 2_000;

export function buildBoardWebSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function startBoardSync(
  options: {
    apiBaseUrl: string;
    /** Join this existing session; omit to create a new one as owner. */
    boardSessionId?: string | null;
    ownerUserId: string;
    provider?: MeetingProvider;
    providerMeetingId?: string;
    displayName?: string;
    title?: string;
  },
  callbacks: BoardSyncCallbacks,
  dependencies: BoardSyncDependencies = {},
): Promise<StartBoardSyncResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const createClient =
    dependencies.createClient ?? ((clientOptions) => new AirboardRealtimeClient(clientOptions));
  const setTimer = dependencies.setTimer ?? ((cb, ms) => setInterval(cb, ms));
  const clearTimer = dependencies.clearTimer ?? ((timer) => clearInterval(timer));
  const heartbeatIntervalMs =
    dependencies.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  let boardSessionId: string;
  let participantId: string;
  let role: string;
  let initialState: BoardState | null = null;
  let outcome: "created" | "joined";

  if (options.boardSessionId) {
    const response = await fetchImpl(
      new URL(`/sessions/${options.boardSessionId}/join`, options.apiBaseUrl).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: options.displayName ?? "Guest" }),
      },
    );
    if (!response.ok) {
      throw new Error(await describeSessionError(response, "join"));
    }
    const payload = (await response.json()) as {
      session: { id: string };
      participant: { id: string; role: string };
      state: BoardState;
    };
    boardSessionId = payload.session.id;
    participantId = payload.participant.id;
    role = payload.participant.role;
    initialState = payload.state;
    outcome = "joined";
  } else {
    const response = await fetchImpl(
      new URL("/sessions/start", options.apiBaseUrl).toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-airboard-user-id": options.ownerUserId,
        },
        body: JSON.stringify({
          provider: options.provider ?? "standalone",
          ...(options.providerMeetingId
            ? { providerMeetingId: options.providerMeetingId }
            : {}),
          ...(options.title ? { title: options.title } : {}),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(await describeSessionError(response, "start"));
    }
    const payload = (await response.json()) as {
      session: { id: string };
      ownerParticipant: { id: string; role: string };
    };
    boardSessionId = payload.session.id;
    participantId = payload.ownerParticipant.id;
    role = payload.ownerParticipant.role;
    outcome = "created";
  }

  // Echo reconciliation state.
  const sentEventIds = new Set<string>();
  const sentEventOrder: string[] = [];
  const trackSent = (id: string) => {
    sentEventIds.add(id);
    sentEventOrder.push(id);
    while (sentEventOrder.length > MAX_TRACKED_EVENT_IDS) {
      const oldest = sentEventOrder.shift();
      if (oldest !== undefined) {
        sentEventIds.delete(oldest);
      }
    }
  };

  const client = createClient({
    url: buildBoardWebSocketUrl(options.apiBaseUrl),
    boardSessionId,
    participantId,
  });
  client.onEvent((event) => {
    if (event.id && sentEventIds.has(event.id)) {
      // Our own event echoed back with its server-assigned sequence.
      sentEventIds.delete(event.id);
      return;
    }
    callbacks.onRemoteEvent(event);
  });
  if (callbacks.onStatus) {
    client.onStatus(callbacks.onStatus);
  }
  if (callbacks.onRejection) {
    client.onRejection(callbacks.onRejection);
  }
  client.connect();

  // REST heartbeat is the ONLY signal that recovers a session from
  // owner_disconnected (WS reconnection alone does not), so it must keep
  // running for the whole session lifetime.
  const heartbeatTimer = setTimer(() => {
    void fetchImpl(
      new URL(`/sessions/${boardSessionId}/heartbeat`, options.apiBaseUrl).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      },
    ).catch(() => undefined);
  }, heartbeatIntervalMs);

  const handle: BoardSyncHandle = {
    boardSessionId,
    participantId,
    role,
    publish: (input) => {
      const events = Array.isArray(input) ? input : [input as BoardEvent];
      if (events.length === 0) {
        return true;
      }
      for (const event of events) {
        if (event.id) {
          trackSent(event.id);
        }
      }
      const sent = client.sendEvents(events);
      if (!sent) {
        for (const event of events) {
          if (event.id) {
            sentEventIds.delete(event.id);
          }
        }
      }
      return sent;
    },
    stop: () => {
      clearTimer(heartbeatTimer);
      client.close();
    },
  };

  return outcome === "joined"
    ? { outcome, handle, initialState: initialState as BoardState }
    : { outcome, handle, initialState: null };
}

/**
 * Seeds a freshly created server session with the board drawn before sync
 * connected: one started+committed pair per committed annotation object,
 * re-addressed to the server session id.
 */
export function snapshotBoardEvents(
  state: BoardState,
  target: { boardSessionId: string; actorParticipantId: string },
): BoardEvent[] {
  const events: BoardEvent[] = [];
  for (const stroke of Object.values(state.strokes)) {
    if (stroke.status !== "committed") {
      continue;
    }
    const readdressed: Stroke = { ...stroke, boardId: target.boardSessionId };
    events.push({
      ...createEventEnvelope({
        boardSessionId: target.boardSessionId,
        actorParticipantId: target.actorParticipantId,
        createdAt: stroke.createdAt,
      }),
      type: "stroke.started",
      stroke: readdressed,
    });
    events.push({
      ...createEventEnvelope({
        boardSessionId: target.boardSessionId,
        actorParticipantId: target.actorParticipantId,
      }),
      type: "stroke.committed",
      strokeId: stroke.id,
      points: stroke.points,
      cleanupApplied: true,
    });
  }
  return events;
}

async function describeSessionError(
  response: Response,
  operation: "start" | "join",
): Promise<string> {
  let reason = `HTTP_${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      reason = payload.error;
    }
  } catch {
    // Non-JSON error body.
  }
  return `Board session ${operation} failed: ${reason}`;
}
