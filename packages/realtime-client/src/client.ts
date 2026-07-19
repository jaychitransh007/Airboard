import type { BoardEvent } from "@airboard/core";

export type RealtimeClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  /** Transient transport error; reconnection may still recover it. */
  | "error"
  /** Server refused the connection (auth/session denial). No reconnection. */
  | "rejected";

export type RealtimeServerRejection = {
  /** Which server frame carried the rejection. */
  kind: "event_rejected" | "append_failed" | "connection_error";
  reason: string;
  /** Present for event_rejected: the first offending event's id. */
  eventId?: string;
  /** Present for append_failed: every event id in the failed batch. */
  eventIds?: string[];
};

export type RealtimeClientOptions = {
  url: string;
  boardSessionId: string;
  participantId: string;
  /** Short-lived server-signed admission ticket; identifiers alone are never trusted. */
  realtimeTicket?: string;
  reconnect?: boolean;
};

type WebSocketLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: never) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type RealtimeClientDependencies = {
  createWebSocket?: (url: string) => WebSocketLike;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

const WEB_SOCKET_OPEN = 1;
/** The server closes with 1008 (policy violation) on auth/session denials. */
const CLOSE_CODE_POLICY_VIOLATION = 1008;

/**
 * Client for the Airboard board-event websocket.
 *
 * Speaks the full server protocol: board.event / board.events out;
 * board.event, event.rejected, event.append_failed, and error frames in.
 * Reconnects with capped backoff on transient closes, but treats a server
 * `error` frame or a 1008 close as terminal (`rejected`) — auth denials are
 * permanent, so retrying them forever would only hammer the server.
 */
export class AirboardRealtimeClient {
  private socket: WebSocketLike | null = null;
  private eventListeners = new Set<(event: BoardEvent) => void>();
  private statusListeners = new Set<(status: RealtimeClientStatus) => void>();
  private rejectionListeners = new Set<(rejection: RealtimeServerRejection) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private rejectedByServer = false;
  private readonly options: RealtimeClientOptions;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options: RealtimeClientOptions, dependencies: RealtimeClientDependencies = {}) {
    this.options = options;
    this.createWebSocket =
      dependencies.createWebSocket ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.setTimer = dependencies.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = dependencies.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  connect(): void {
    if (this.socket) {
      // A live or half-open socket would otherwise leak with its listeners.
      try {
        this.socket.close();
      } catch {
        // Already closed.
      }
      this.socket = null;
    }
    this.clearReconnect();
    this.manuallyClosed = false;
    this.rejectedByServer = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const url = new URL(this.options.url);
    if (this.options.realtimeTicket) {
      url.searchParams.set("ticket", this.options.realtimeTicket);
    } else {
      // Compatibility for dependency-injected local tests. Production session
      // responses always include a ticket and the API rejects bare ids.
      url.searchParams.set("boardSessionId", this.options.boardSessionId);
      url.searchParams.set("participantId", this.options.participantId);
    }

    const socket = this.createWebSocket(url.toString());
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    });
    socket.addEventListener("message", (message: MessageEvent) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleMessage(safeParse(message.data));
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (this.socket !== socket) {
        return;
      }
      if (this.rejectedByServer || event?.code === CLOSE_CODE_POLICY_VIOLATION) {
        this.rejectedByServer = true;
        this.setStatus("rejected");
        return;
      }
      this.setStatus("closed");
      if (this.options.reconnect !== false && !this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.setStatus("error");
    });
  }

  close(): void {
    this.manuallyClosed = true;
    this.clearReconnect();
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WEB_SOCKET_OPEN;
  }

  /** Returns false when the socket is not open — the event was NOT sent. */
  sendEvent(event: BoardEvent): boolean {
    return this.sendFrame({ type: "board.event", event });
  }

  /**
   * Atomic batch: the server appends all events with a contiguous sequence
   * block, so compound commands replay in order on every peer.
   * Returns false when the socket is not open — the batch was NOT sent.
   */
  sendEvents(events: readonly BoardEvent[]): boolean {
    if (events.length === 0) {
      return true;
    }
    return this.sendFrame({ type: "board.events", events });
  }

  onEvent(listener: (event: BoardEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: RealtimeClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Server-side denials: rejected events, persistence failures, auth errors. */
  onRejection(listener: (rejection: RealtimeServerRejection) => void): () => void {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  private sendFrame(frame: object): boolean {
    if (this.socket?.readyState !== WEB_SOCKET_OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private handleMessage(payload: Record<string, unknown> | null): void {
    if (!payload) {
      return;
    }
    switch (payload.type) {
      case "board.event":
        this.emitEvent(payload.event as BoardEvent);
        return;
      case "event.rejected":
        this.emitRejection({
          kind: "event_rejected",
          reason: String(payload.reason ?? "UNKNOWN"),
          ...(typeof payload.eventId === "string" ? { eventId: payload.eventId } : {}),
        });
        return;
      case "event.append_failed":
        this.emitRejection({
          kind: "append_failed",
          reason: String(payload.reason ?? "UNKNOWN"),
          ...(Array.isArray(payload.eventIds)
            ? { eventIds: payload.eventIds.map(String) }
            : {}),
        });
        return;
      case "error":
        // The server sends this immediately before a 1008 close. Terminal.
        this.rejectedByServer = true;
        this.emitRejection({
          kind: "connection_error",
          reason: String(payload.reason ?? "UNKNOWN"),
        });
        return;
      default:
        return;
    }
  }

  private emitEvent(event: BoardEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private emitRejection(rejection: RealtimeServerRejection): void {
    for (const listener of this.rejectionListeners) {
      listener(rejection);
    }
  }

  private setStatus(status: RealtimeClientStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectAttempt += 1;
    const delayMs = Math.min(500 * 2 ** this.reconnectAttempt, 5000);
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed && !this.rejectedByServer) {
        this.connect();
      }
    }, delayMs);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function safeParse(data: unknown): Record<string, unknown> | null {
  try {
    const value = JSON.parse(String(data)) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
