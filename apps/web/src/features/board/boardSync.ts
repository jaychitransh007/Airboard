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

/**
 * "paused": the session is locked while its owner is away; it carries on if
 * they come back. "ended": the session is over, and live sync has stopped.
 * "outdated": the API needs a newer page; reloading reconnects.
 */
export type BoardSyncStatus = RealtimeClientStatus | "paused" | "ended" | "outdated";

export type BoardSyncCallbacks = {
  /** A peer's event (never an echo of our own). Apply to the local board. */
  onRemoteEvent: (event: BoardEvent) => void;
  onStatus?: (status: BoardSyncStatus) => void;
  /**
   * For a guest who missed too much to replay event by event: the session's
   * whole current state, to replace the local board. The owner always
   * replays, so their board never loses content the session lacks.
   */
  onResync?: (state: BoardState) => void;
  /** Server denials: rejected events, persistence failures, auth errors. */
  onRejection?: (rejection: RealtimeServerRejection) => void;
  /**
   * Whether guests may edit, re-read after every (re)connect: a change the
   * owner made while this socket was away arrives here, not as an event.
   */
  onSessionPermission?: (allowParticipantDrawing: boolean) => void;
};

export type BoardSyncHandle = {
  boardSessionId: string;
  participantId: string;
  role: string;
  /** Share token used to invite a guest without exposing a guessable session. */
  joinToken?: string;
  /** Whether guests may edit, as the session stood when this person connected. */
  allowParticipantDrawing: boolean;
  /**
   * Publishes local events to peers. While the socket is reconnecting, board
   * changes wait and go out once it is back and caught up; cursor moves are
   * live only and are dropped. Returns false when nothing will reach peers:
   * the session has ended, or only cursor moves were dropped.
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
    realtimeTicket?: string;
    refreshTicket?: () => Promise<string | null>;
  }) => Pick<
    AirboardRealtimeClient,
    "connect" | "close" | "sendEvents" | "onEvent" | "onStatus" | "onRejection"
  > &
    Partial<Pick<AirboardRealtimeClient, "setRealtimeTicket">>;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearTimer?: (timer: ReturnType<typeof setInterval>) => void;
  heartbeatIntervalMs?: number;
  ticketRefreshIntervalMs?: number;
};

/** Keeps the owner inside the 180s absence grace with a wide margin. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/**
 * The API's realtime tickets last 30 minutes; trading them in every 20 keeps
 * every reconnect and heartbeat on a valid one for the whole meeting.
 */
const DEFAULT_TICKET_REFRESH_INTERVAL_MS = 20 * 60_000;
/** Board changes held while reconnecting: about a minute of fast drawing. */
const MAX_OUTBOX_EVENTS = 5_000;
/** Sent changes remembered until the server echoes them, to resend any a cut connection lost. */
const MAX_UNCONFIRMED_EVENTS = 5_000;
/** How long an event may wait for a missing earlier one before the board fetches it. */
const GAP_WAIT_MS = 1_500;
/** The API refuses a batch of more than 500 events, so larger sends are split. */
const MAX_EVENTS_PER_SEND = 500;
/** A guest this many catch-up pages behind reloads the whole board instead. */
const MAX_GUEST_CATCH_UP_PAGES = 20;
/** Failed catch-up attempts in a row before carrying on with live events. */
const MAX_CATCH_UP_RETRIES = 5;
/** Refusals that mean this person's place in the session is gone for good. */
const SESSION_OVER_REASONS = new Set(["SESSION_NOT_JOINABLE", "PARTICIPANT_NOT_IN_SESSION", "SESSION_NOT_FOUND"]);
/** Socket refusals that pass, after which the heartbeat reconnects. */
const PASSING_REFUSALS = new Set(["SESSION_LOCKED", "MAINTENANCE"]);

/** The API's own refusal code, or null for a route an older API doesn't have. */
async function apiErrorCode(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; statusCode?: unknown } | null;
  // Fastify's own "route not found" answer carries statusCode; the API's doesn't.
  if (!body || typeof body.error !== "string" || body.statusCode !== undefined) return null;
  return body.error;
}
/**
 * Echo-dedup window: ids of the most recent locally-published events. It
 * covers every change that can be held or awaiting its echo at once.
 */
const MAX_TRACKED_EVENT_IDS = 12_000;

export function buildBoardWebSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Asks the API to start a new live session as its owner. Exported so a page
 * can send it while the board is still loading and hand it to startBoardSync.
 */
export function requestBoardSessionStart(
  options: {
    apiBaseUrl: string;
    accessToken?: string;
    provider?: MeetingProvider;
    providerMeetingId?: string;
    title?: string;
    workspaceId?: string;
    boardId?: string;
    /** Whether people who join with the live link may edit; the API's default is yes. */
    allowParticipantDrawing?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(new URL("/sessions/start", options.apiBaseUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: JSON.stringify({
      provider: options.provider ?? "standalone",
      ...(options.providerMeetingId ? { providerMeetingId: options.providerMeetingId } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.boardId ? { boardId: options.boardId } : {}),
      ...(options.allowParticipantDrawing !== undefined
        ? { allowParticipantDrawing: options.allowParticipantDrawing }
        : {}),
    }),
  });
}

export async function startBoardSync(
  options: {
    apiBaseUrl: string;
    /**
     * A session start already in flight from requestBoardSessionStart. Each
     * use reads its own copy, so a remounted board can reuse it.
     */
    pendingStart?: Promise<Response> | null;
    /** Join this existing session; omit to create a new one as owner. */
    boardSessionId?: string | null;
    /**
     * The owner's own place in boardSessionId, kept from before a reload:
     * rejoin as the owner (needs accessToken) instead of as a guest.
     */
    resumeParticipantId?: string;
    ownerUserId: string;
    accessToken?: string;
    /** The current sign-in, which the owner's ticket refresh must carry. */
    getAccessToken?: () => string | undefined;
    joinToken?: string;
    workspaceId?: string;
    boardId?: string;
    provider?: MeetingProvider;
    providerMeetingId?: string;
    displayName?: string;
    title?: string;
    /** A new session's live-link setting: may guests edit? */
    allowParticipantDrawing?: boolean;
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
  const ticketRefreshIntervalMs =
    dependencies.ticketRefreshIntervalMs ?? DEFAULT_TICKET_REFRESH_INTERVAL_MS;

  let boardSessionId: string;
  let participantId: string;
  let role: string;
  let initialState: BoardState | null = null;
  let outcome: "created" | "joined";
  let realtimeTicket: string;
  // Renews realtimeTicket; an API from before refresh tokens sends none.
  let refreshToken: string | null = null;
  let joinToken: string | null = null;
  let allowParticipantDrawing = true;

  if (options.boardSessionId) {
    const resuming = Boolean(options.resumeParticipantId && options.accessToken);
    const response = await fetchImpl(
      new URL(`/sessions/${options.boardSessionId}/${resuming ? "resume" : "join"}`, options.apiBaseUrl).toString(),
      {
        method: "POST",
        // Signed-in people send their sign-in: when a workspace turns off
        // external guests, only its members may join.
        headers: {
          "Content-Type": "application/json",
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(
          resuming
            ? { participantId: options.resumeParticipantId }
            : { displayName: options.displayName ?? "Guest", joinToken: options.joinToken },
        ),
      },
    );
    if (!response.ok) {
      throw new Error(await describeSessionError(response, "join"));
    }
    const payload = (await response.json()) as {
      session: { id: string; allowParticipantDrawing?: boolean };
      participant: { id: string; role: string };
      state: BoardState;
      realtimeTicket: string;
      refreshToken?: string;
    };
    boardSessionId = payload.session.id;
    participantId = payload.participant.id;
    role = payload.participant.role;
    allowParticipantDrawing = payload.session.allowParticipantDrawing !== false;
    initialState = payload.state;
    realtimeTicket = payload.realtimeTicket;
    refreshToken = payload.refreshToken ?? null;
    outcome = "joined";
  } else {
    const response = options.pendingStart
      ? (await options.pendingStart).clone()
      : await requestBoardSessionStart(options, fetchImpl);
    if (!response.ok) {
      throw new Error(await describeSessionError(response, "start"));
    }
    const payload = (await response.json()) as {
      session: { id: string; allowParticipantDrawing?: boolean };
      ownerParticipant: { id: string; role: string };
      realtimeTicket: string;
      refreshToken?: string;
      joinToken: string;
    };
    allowParticipantDrawing = payload.session.allowParticipantDrawing !== false;
    boardSessionId = payload.session.id;
    participantId = payload.ownerParticipant.id;
    role = payload.ownerParticipant.role;
    realtimeTicket = payload.realtimeTicket;
    refreshToken = payload.refreshToken ?? null;
    joinToken = payload.joinToken;
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

  // Server sequences apply strictly in order: every sequence up to the
  // watermark is applied. One that arrives early (live events from another API
  // instance can overtake each other) waits in `early` for those before it; if
  // they don't arrive soon, the board fetches them. The watermark is where a
  // catch-up starts.
  let watermark = initialState?.lastSequence ?? 0;
  const early = new Map<number, BoardEvent>();
  // An older API can't send missed events, so nothing may wait for them.
  let catchUpUnsupported = false;
  let ended = false;
  let paused = false;
  let stopped = false;
  let outdated = false;
  // Refused for a reason that passes (a lock, maintenance, or tickets that
  // kept coming back expired): the heartbeat reconnects once it can.
  let socketRefused = false;
  let lastClientStatus: RealtimeClientStatus = "connecting";
  let catchingUp = false;
  let catchUpGeneration = 0;
  // Board changes made while the socket was away, paused or catching up.
  const outbox: BoardEvent[] = [];
  // Changes sent but not yet echoed, in send order: a connection cut just
  // after sending loses them, so they go out again after the catch-up.
  const unconfirmed = new Map<string, BoardEvent>();
  // The ids sent together in one batch, by each id: the server refuses or
  // fails a batch as a whole.
  const batchOf = new Map<string, string[]>();
  const forgetBatch = (eventId: string) => {
    for (const id of batchOf.get(eventId) ?? [eventId]) {
      unconfirmed.delete(id);
      batchOf.delete(id);
      permissionsAwaitingEcho.delete(id);
    }
  };
  // A guest-editing change sent but not yet echoed: a fresher one than the
  // session state the board may read meanwhile.
  const permissionsAwaitingEcho = new Set<string>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let gapTimer: ReturnType<typeof setInterval> | null = null;
  // setTimer repeats; this fires once.
  const once = (delayMs: number, callback: () => void): ReturnType<typeof setInterval> => {
    const timer = setTimer(() => {
      clearTimer(timer);
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer: ReturnType<typeof setInterval> | null) => {
    if (timer === null) return;
    clearTimer(timer);
    timers.delete(timer);
  };
  const stopTimers = () => {
    for (const timer of timers) clearTimer(timer);
    timers.clear();
    retryTimer = null;
    gapTimer = null;
  };

  // While the session is locked, a dropped or refused socket is part of the
  // pause, not a new problem.
  const reportStatus = (status: BoardSyncStatus) => {
    if (!stopped && !ended && !outdated) callbacks.onStatus?.(paused && status !== "connected" ? "paused" : status);
  };
  const markEnded = () => {
    if (stopped || ended) return;
    callbacks.onStatus?.("ended");
    ended = true;
    stopTimers();
    client.close();
  };
  const setPaused = (next: boolean) => {
    if (paused === next || ended || stopped) return;
    paused = next;
    if (next) {
      callbacks.onStatus?.("paused");
      return;
    }
    // Back: show where the socket really stands, and send what waited.
    reportStatus(lastClientStatus);
    flushOutbox();
  };
  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetchImpl(new URL(path, options.apiBaseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  // Trades the refresh token for a fresh ticket. Null when the session can't
  // be joined now: over for good (sync ends) or locked (sync pauses and the
  // heartbeat carries on). Rejects, keeping the current ticket, when it
  // should be tried again later: a network or server error, or an older API
  // without refresh tokens.
  let refreshing: Promise<string | null> | null = null;
  const refreshTicket = (): Promise<string | null> => {
    refreshing ??= (async () => {
      try {
        if (!refreshToken) throw new Error("TICKET_REFRESH_UNSUPPORTED");
        const accessToken = options.getAccessToken?.() ?? options.accessToken;
        const response = await postJson(
          `/sessions/${boardSessionId}/ticket`,
          { refreshToken },
          accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        );
        if (response.ok) {
          const body = (await response.json()) as { realtimeTicket?: unknown };
          if (typeof body.realtimeTicket !== "string") throw new Error("TICKET_REFRESH_MALFORMED");
          realtimeTicket = body.realtimeTicket;
          client.setRealtimeTicket?.(realtimeTicket);
          return realtimeTicket;
        }
        const code = await apiErrorCode(response);
        if (code === "SESSION_LOCKED") {
          socketRefused = true;
          setPaused(true);
          return null;
        }
        if (code && (SESSION_OVER_REASONS.has(code) || code === "REFRESH_TOKEN_REQUIRED")) {
          markEnded();
          return null;
        }
        throw new Error(code ?? `TICKET_REFRESH_${response.status}`);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };
  // Reconnects a refused socket, on a fresh ticket when the API offers one.
  const reconnect = async () => {
    const ticket = await refreshTicket().catch(() => realtimeTicket);
    if (ticket && !stopped && !ended && !outdated) client.connect();
  };

  const apply = (event: BoardEvent) => {
    if (event.type === "permission.changed" && event.id) permissionsAwaitingEcho.delete(event.id);
    if (event.id) {
      unconfirmed.delete(event.id);
      batchOf.delete(event.id);
    }
    if (event.id && sentEventIds.has(event.id)) {
      // Our own event echoed back with its server-assigned sequence.
      sentEventIds.delete(event.id);
      return;
    }
    callbacks.onRemoteEvent(event);
  };
  const drainEarly = () => {
    for (let next = early.get(watermark + 1); next; next = early.get(watermark + 1)) {
      early.delete(watermark + 1);
      watermark += 1;
      apply(next);
    }
    if (early.size === 0) {
      cancel(gapTimer);
      gapTimer = null;
    }
  };
  const deliver = (event: BoardEvent) => {
    const sequence = event.sequence;
    if (typeof sequence !== "number") {
      // Cursor moves are live presence with no sequence.
      apply(event);
      return;
    }
    // Already applied: a catch-up and the live socket can overlap.
    if (sequence <= watermark || early.has(sequence)) return;
    if (sequence > watermark + 1 && !catchUpUnsupported) {
      early.set(sequence, event);
      if (gapTimer === null && !catchingUp) {
        gapTimer = once(GAP_WAIT_MS, () => {
          gapTimer = null;
          if (early.size > 0 && !catchingUp && lastClientStatus === "connected") void catchUp();
        });
      }
      return;
    }
    watermark = sequence;
    apply(event);
    drainEarly();
  };

  // Sends in batches the API accepts; returns how many events went out.
  const send = (events: readonly BoardEvent[]): number => {
    for (let index = 0; index < events.length; index += MAX_EVENTS_PER_SEND) {
      const batch = events.slice(index, index + MAX_EVENTS_PER_SEND);
      if (!client.sendEvents(batch)) return index;
      const durable = batch.filter((event) => event.id && event.type !== "cursor.moved");
      const ids = durable.map((event) => event.id!);
      for (const event of durable) {
        unconfirmed.set(event.id!, event);
        batchOf.set(event.id!, ids);
      }
    }
    while (unconfirmed.size > MAX_UNCONFIRMED_EVENTS) forgetBatch(unconfirmed.keys().next().value!);
    return events.length;
  };
  function flushOutbox() {
    if (outbox.length === 0 || catchingUp || paused || ended || stopped) return;
    const batch = outbox.splice(0);
    const sent = send(batch);
    if (sent < batch.length) outbox.unshift(...batch.slice(sent));
  }
  // After a catch-up, every change of ours the server stored has echoed; the
  // rest never arrived, so they go out again first.
  const resendUnconfirmed = () => {
    if (unconfirmed.size === 0) return;
    outbox.unshift(...unconfirmed.values());
    unconfirmed.clear();
    batchOf.clear();
  };
  // Applies what waits behind a gap that can't be filled, in sequence order.
  const releaseEarly = () => {
    for (const sequence of [...early.keys()].sort((a, b) => a - b)) {
      const event = early.get(sequence)!;
      early.delete(sequence);
      watermark = Math.max(watermark, sequence);
      apply(event);
    }
  };

  const fetchSessionState = async (): Promise<{ session?: { allowParticipantDrawing?: unknown }; state?: BoardState } | null> => {
    const stateUrl = new URL(`/sessions/${boardSessionId}/state`, options.apiBaseUrl);
    stateUrl.searchParams.set("ticket", realtimeTicket);
    const response = await fetchImpl(stateUrl.toString());
    return response.ok ? ((await response.json()) as { session?: { allowParticipantDrawing?: unknown }; state?: BoardState }) : null;
  };
  // Whether guests may edit, re-read after (re)connecting: unless a change
  // from here is still on its way, the session's answer is the latest.
  const readSessionPermission = () => {
    if (!callbacks.onSessionPermission) return;
    void fetchSessionState()
      .then((body) => {
        const allow = body?.session?.allowParticipantDrawing;
        if (typeof allow === "boolean" && permissionsAwaitingEcho.size === 0 && !ended && !stopped) {
          callbacks.onSessionPermission?.(allow);
        }
      })
      .catch(() => undefined);
  };

  // On every admission: fetch what this board missed, page by page and in
  // order (events that arrive live meanwhile wait in `early`), then resend our
  // own changes the server never got, then the changes made meanwhile. A
  // failed attempt tries again; only the newest catch-up finishes.
  async function catchUp(attempt = 0): Promise<void> {
    const generation = (catchUpGeneration += 1);
    const current = () => generation === catchUpGeneration && !stopped && !ended;
    cancel(retryTimer);
    retryTimer = null;
    catchingUp = true;
    let outcome: "done" | "retry" = "done";
    try {
      for (let page = 0; ; page += 1) {
        const response = await postJson(`/sessions/${boardSessionId}/events`, { realtimeTicket, after: watermark });
        if (!current()) return;
        if (!response.ok) {
          const code = await apiErrorCode(response);
          if (!current()) return;
          // An older API without the route: carry on with what arrives live.
          if (response.status === 404 && code === null) {
            catchUpUnsupported = true;
            releaseEarly();
            break;
          }
          if (response.status === 401) await refreshTicket().catch(() => null);
          outcome = "retry";
          break;
        }
        const body = (await response.json()) as { events?: BoardEvent[]; latestSequence?: number };
        if (!current()) return;
        for (const event of body.events ?? []) deliver(event);
        const latest = body.latestSequence ?? watermark;
        if (watermark >= latest || (body.events ?? []).length === 0) break;
        if (role !== "owner" && page + 1 >= MAX_GUEST_CATCH_UP_PAGES && callbacks.onResync) {
          const fetched = await fetchSessionState();
          if (!current()) return;
          if (!fetched?.state) {
            outcome = "retry";
            break;
          }
          callbacks.onResync(fetched.state);
          watermark = Math.max(watermark, fetched.state.lastSequence ?? 0);
          for (const sequence of [...early.keys()]) if (sequence <= watermark) early.delete(sequence);
          drainEarly();
          // The replaced board lacks our unconfirmed and held changes: send
          // them again and let their echoes apply.
          resendUnconfirmed();
          for (const event of outbox) if (event.id) sentEventIds.delete(event.id);
          break;
        }
      }
    } catch {
      if (!current()) return;
      outcome = "retry";
    }
    if (!current()) return;
    if (outcome === "retry" && attempt < MAX_CATCH_UP_RETRIES) {
      retryTimer = once(1_000 * 2 ** attempt, () => {
        retryTimer = null;
        void catchUp(attempt + 1);
      });
      return;
    }
    // Out of retries: carry on with what has arrived rather than wait forever.
    if (outcome === "retry") releaseEarly();
    catchingUp = false;
    resendUnconfirmed();
    flushOutbox();
    readSessionPermission();
    if (early.size > 0 && gapTimer === null) {
      gapTimer = once(GAP_WAIT_MS, () => {
        gapTimer = null;
        if (early.size > 0 && !catchingUp && lastClientStatus === "connected") void catchUp();
      });
    }
  }

  const client = createClient({
    url: buildBoardWebSocketUrl(options.apiBaseUrl),
    boardSessionId,
    participantId,
    realtimeTicket,
    refreshTicket: () => refreshTicket(),
  });
  client.onEvent(deliver);
  client.onStatus((status) => {
    lastClientStatus = status;
    if (status === "connected") {
      socketRefused = false;
      paused = false;
    }
    if (status === "rejected" && !ended && !outdated) {
      // A refusal that isn't final: the heartbeat reconnects.
      socketRefused = true;
    }
    reportStatus(status);
    if (status === "connected" && !ended && !stopped) void catchUp();
  });
  client.onRejection((rejection) => {
    // The server refused or failed a batch as a whole: it won't arrive, and
    // replaying it later would put it after newer changes.
    if (rejection.kind === "event_rejected" && rejection.eventId) forgetBatch(rejection.eventId);
    if (rejection.kind === "append_failed") for (const id of rejection.eventIds ?? []) forgetBatch(id);
    if (rejection.kind === "connection_error") {
      const reason = rejection.reason;
      if (reason === "UPGRADE_REQUIRED") {
        // Only a reload brings a page the API accepts.
        outdated = true;
        callbacks.onStatus?.("outdated");
        stopTimers();
      } else if (reason === "SESSION_LOCKED") {
        socketRefused = true;
        // The owner's own fresh ticket brings the session back at once.
        if (role === "owner") void reconnect();
        else setPaused(true);
      } else if (reason === "SESSION_NOT_JOINABLE" && role === "owner") {
        // An older API refuses a locked session this way too: let the
        // heartbeat tell (it revives a lock, and reports an end).
        socketRefused = true;
      } else if (SESSION_OVER_REASONS.has(reason)) {
        markEnded();
      } else if (PASSING_REFUSALS.has(reason)) {
        socketRefused = true;
      }
    }
    callbacks.onRejection?.(rejection);
  });
  client.connect();

  // REST heartbeat is the ONLY signal that recovers a session from
  // owner_disconnected (WS reconnection alone does not), so it must keep
  // running for the whole session lifetime, on a ticket that is still valid.
  // It also tells everyone when the session is locked, back, or ended, and
  // reconnects a socket refused for a reason that has passed.
  const heartbeat = setTimer(() => {
    if (ended || outdated) return;
    void postJson(`/sessions/${boardSessionId}/heartbeat`, { realtimeTicket })
      .then(async (response) => {
        if (response.status === 401) {
          await refreshTicket();
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as { session?: { status?: unknown } };
        const status = body.session?.status;
        if (status === "ended") {
          markEnded();
        } else if (status === "locked") {
          setPaused(true);
        } else if (status === "active" || status === "owner_disconnected") {
          if (socketRefused) await reconnect();
          setPaused(false);
        }
      })
      .catch(() => undefined);
  }, heartbeatIntervalMs);
  timers.add(heartbeat);
  const renewal = setTimer(() => {
    if (!ended && !outdated) void refreshTicket().catch(() => undefined);
  }, ticketRefreshIntervalMs);
  timers.add(renewal);

  const handle: BoardSyncHandle = {
    boardSessionId,
    participantId,
    role,
    ...(joinToken ? { joinToken } : {}),
    allowParticipantDrawing,
    publish: (input) => {
      const events = Array.isArray(input) ? input : [input as BoardEvent];
      if (events.length === 0) {
        return true;
      }
      if (ended || stopped || outdated) {
        return false;
      }
      for (const event of events) {
        if (event.id) {
          trackSent(event.id);
        }
        if (event.type === "permission.changed" && event.id) permissionsAwaitingEcho.add(event.id);
      }
      const sent = !catchingUp && !paused && outbox.length === 0 ? send(events) : 0;
      if (sent === events.length) {
        return true;
      }
      // Hold board changes until the socket is back; cursor moves are live only.
      const rest = events.slice(sent);
      const durable = rest.filter((event) => event.type !== "cursor.moved");
      for (const event of rest) {
        if (event.type === "cursor.moved" && event.id) sentEventIds.delete(event.id);
      }
      // A full outbox refuses new changes rather than drop held ones, which
      // could leave a held stroke's start behind its end.
      const room = Math.max(0, MAX_OUTBOX_EVENTS - outbox.length);
      outbox.push(...durable.slice(0, room));
      for (const event of durable.slice(room)) if (event.id) sentEventIds.delete(event.id);
      return sent > 0 || (durable.length > 0 && durable.length <= room);
    },
    stop: () => {
      stopped = true;
      stopTimers();
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
  for (const element of Object.values(state.elements)) {
    // Legacy strokes are already replayed above and their scene mirrors are
    // regenerated by the v2 reducer. Publishing both would duplicate them.
    if (element.status !== "active" || element.legacyStrokeId) continue;
    events.push({
      ...createEventEnvelope({
        boardSessionId: target.boardSessionId,
        actorParticipantId: target.actorParticipantId,
        createdAt: element.createdAt,
      }),
      type: "element.created",
      element: { ...element, boardId: target.boardSessionId },
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
