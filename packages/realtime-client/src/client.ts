import type { BoardEvent } from "@airboard/core";

export type RealtimeClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

export type RealtimeClientOptions = {
  url: string;
  boardSessionId: string;
  participantId: string;
  reconnect?: boolean;
};

export class AirboardRealtimeClient {
  private socket: WebSocket | null = null;
  private eventListeners = new Set<(event: BoardEvent) => void>();
  private statusListeners = new Set<(status: RealtimeClientStatus) => void>();
  private reconnectAttempt = 0;
  private manuallyClosed = false;

  constructor(private readonly options: RealtimeClientOptions) {}

  connect(): void {
    this.manuallyClosed = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const url = new URL(this.options.url);
    url.searchParams.set("boardSessionId", this.options.boardSessionId);
    url.searchParams.set("participantId", this.options.participantId);

    this.socket = new WebSocket(url);
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    });
    this.socket.addEventListener("message", (message) => {
      const payload = safeParse(message.data);
      if (payload?.type === "board.event") {
        this.emitEvent(payload.event as BoardEvent);
      }
    });
    this.socket.addEventListener("close", () => {
      this.setStatus("closed");
      if (this.options.reconnect !== false && !this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener("error", () => {
      this.setStatus("error");
    });
  }

  close(): void {
    this.manuallyClosed = true;
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  sendEvent(event: BoardEvent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "board.event",
        event,
      }),
    );
  }

  onEvent(listener: (event: BoardEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: RealtimeClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitEvent(event: BoardEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private setStatus(status: RealtimeClientStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delayMs = Math.min(500 * 2 ** this.reconnectAttempt, 5000);
    window.setTimeout(() => this.connect(), delayMs);
  }
}

function safeParse(data: unknown): any {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}
