import { randomUUID } from "node:crypto";
import type { BoardEvent } from "@airboard/core";

/**
 * Carries accepted board events between API instances, so people on the same
 * live board see each other's changes when Cloud Run runs more than one
 * instance. Each instance still relays to its own sockets first; this only
 * reaches the sockets other instances hold. The database stays the record.
 */
export type BoardEventFanOut = {
  /** Called after events were appended and relayed locally. */
  publish(sessionId: string, events: BoardEvent[]): void;
  /** Receive a session's events from other instances; returns the stop function. */
  join(sessionId: string, deliver: (events: BoardEvent[]) => void): () => void;
  close(): Promise<void>;
  /** Joins and leaves a throwaway channel; resolves to how the join went ("SUBSCRIBED", or the failure and its reason). */
  probe?(): Promise<string>;
};

/** One API instance holds every socket, so there is nobody else to tell. */
export const singleInstanceFanOut: BoardEventFanOut = {
  publish() {},
  join: () => () => {},
  close: async () => {},
};

/** The parts of a Supabase realtime channel this uses. */
export type FanOutChannel = {
  on(
    type: "broadcast",
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void,
  ): FanOutChannel;
  subscribe(callback?: (status: string, error?: Error) => void): FanOutChannel;
  send(message: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
  /** Broadcasts over HTTP, for a channel that has not joined. */
  httpSend(event: string, payload: unknown): Promise<unknown>;
};

/** The parts of a Supabase client this uses. */
export type FanOutClient = {
  channel(name: string, options: { config: { private: boolean; broadcast: { self: boolean } } }): FanOutChannel;
  removeChannel(channel: FanOutChannel): Promise<unknown>;
};

type FanOutMessage = { events: BoardEvent[] } | { range: { sessionId: string; from: number; to: number } };

const EVENT = "board.events";
const CHANNEL_OPTIONS = { config: { private: true, broadcast: { self: false } } };
/** Stay well under Supabase's per-message broadcast limit. */
const MAX_MESSAGE_BYTES = 900_000;

/**
 * Splits events into messages under the size limit. An event too large to
 * send on its own goes as its sequence number, and receivers load it from the
 * database instead.
 */
export function fanOutMessages(sessionId: string, events: BoardEvent[], maxBytes = MAX_MESSAGE_BYTES): FanOutMessage[] {
  const messages: FanOutMessage[] = [];
  let batch: BoardEvent[] = [];
  let batchBytes = 0;
  const flush = () => {
    if (batch.length) messages.push({ events: batch });
    batch = [];
    batchBytes = 0;
  };
  for (const event of events) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (bytes > maxBytes) {
      flush();
      const sequence = event.sequence ?? 0;
      messages.push({ range: { sessionId, from: sequence, to: sequence } });
      continue;
    }
    if (batchBytes + bytes > maxBytes) flush();
    batch.push(event);
    batchBytes += bytes;
  }
  flush();
  return messages;
}

/**
 * Fan-out over Supabase Realtime broadcast. Each live session gets a private
 * channel, which the API joins with its service key; browsers using the
 * public key cannot listen in. An instance never hears its own messages.
 *
 * Broadcast is best effort, so each session keeps a high-water mark: every
 * sequence up to it has reached this instance's sockets. Anything that would
 * skip past the mark (the moments before the channel joined, or a Realtime
 * reconnect) is first read back from the database, and nothing at or below
 * it is relayed twice.
 */
export function supabaseFanOut(
  client: FanOutClient,
  options: {
    loadEvents(sessionId: string, from: number, to: number): Promise<BoardEvent[]>;
    latestSequence(sessionId: string): Promise<number>;
    onError?(error: unknown, context: string): void;
  },
): BoardEventFanOut {
  type Session = {
    channel: FanOutChannel;
    listeners: Set<(events: BoardEvent[]) => void>;
    joined: boolean;
    /** Undefined until read, or if the read failed (no catch-up then). */
    delivered: number | undefined;
    /** Deliveries run one at a time, in arrival order. */
    queue: Promise<void>;
  };
  const sessions = new Map<string, Session>();

  const enqueue = (session: Session, context: string, task: () => Promise<void>) => {
    session.queue = session.queue.then(task).catch((error: unknown) => options.onError?.(error, context));
  };

  const relay = (sessionId: string, session: Session, events: BoardEvent[]) => {
    if (events.length === 0 || sessions.get(sessionId) !== session) return;
    for (const listener of session.listeners) listener(events);
  };

  /** Moves the mark past these events, relaying them (unless the caller already has) and any gap before them. */
  const advance = async (sessionId: string, session: Session, events: BoardEvent[], alreadyRelayed: boolean) => {
    const untracked = events.filter((event) => event.sequence === undefined);
    const fresh = events.filter((event) => event.sequence !== undefined && event.sequence > (session.delivered ?? 0));
    if (!alreadyRelayed) relay(sessionId, session, untracked);
    if (fresh.length === 0) return;
    const first = fresh[0]!.sequence!;
    if (session.delivered !== undefined && first > session.delivered + 1) {
      const since = session.delivered;
      const missed = await options.loadEvents(sessionId, since + 1, first - 1);
      relay(sessionId, session, missed.filter((event) => (event.sequence ?? 0) > since && (event.sequence ?? 0) < first));
    }
    if (!alreadyRelayed) relay(sessionId, session, fresh);
    session.delivered = Math.max(session.delivered ?? 0, fresh.at(-1)!.sequence!);
  };

  const receive = (sessionId: string, session: Session, payload: unknown) => {
    const message = payload as FanOutMessage | undefined;
    if (message && "events" in message && Array.isArray(message.events)) {
      const events = message.events;
      enqueue(session, "deliver", () => advance(sessionId, session, events, false));
    } else if (message && "range" in message && message.range?.sessionId === sessionId) {
      const { from, to } = message.range;
      enqueue(session, "load", async () =>
        advance(sessionId, session, await options.loadEvents(sessionId, from, to), false),
      );
    }
  };

  const open = (sessionId: string): Session => {
    const channel = client.channel(`airboard:board-session:${sessionId}`, CHANNEL_OPTIONS);
    const session: Session = { channel, listeners: new Set(), joined: false, delivered: undefined, queue: Promise.resolve() };
    channel.on("broadcast", { event: EVENT }, ({ payload }) => receive(sessionId, session, payload));
    sessions.set(sessionId, session);
    // Read the mark before joining, so every event appended after it either
    // arrives on the channel or is found by the catch-up once joined.
    enqueue(session, "subscribe", async () => {
      try {
        session.delivered = await options.latestSequence(sessionId);
      } catch (error) {
        options.onError?.(error, "baseline");
      }
      if (sessions.get(sessionId) !== session) return;
      channel.subscribe((status, error) => {
        session.joined = status === "SUBSCRIBED";
        if (status === "SUBSCRIBED") {
          enqueue(session, "catch-up", async () => {
            if (session.delivered === undefined) return;
            const since = await options.loadEvents(sessionId, session.delivered + 1, Number.MAX_SAFE_INTEGER);
            await advance(sessionId, session, since, false);
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          options.onError?.(error ?? new Error(status), "subscribe");
        }
      });
    });
    return session;
  };

  // Over the socket once joined; before that (or with no socket on this
  // board here) over HTTP. Realtime servers before v2.97 lack the httpSend
  // endpoint; send() still reaches them over their older HTTP route.
  const send = (channel: FanOutChannel, payload: FanOutMessage, joined: boolean) => {
    const overSocket = () =>
      channel.send({ type: "broadcast", event: EVENT, payload }).then((result) => {
        if (result !== "ok") throw new Error(`BROADCAST_${String(result).toUpperCase().replace(" ", "_")}`);
      });
    return (joined ? overSocket() : channel.httpSend(EVENT, payload).catch(overSocket)).catch((error: unknown) =>
      options.onError?.(error, "publish"),
    );
  };

  return {
    publish(sessionId, events) {
      if (events.length === 0) return;
      const session = sessions.get(sessionId);
      if (session) {
        for (const payload of fanOutMessages(sessionId, events)) void send(session.channel, payload, session.joined);
        enqueue(session, "deliver", () => advance(sessionId, session, events, true));
        return;
      }
      // The sender's own socket keeps this instance joined; if it somehow
      // isn't, send through a channel that is dropped straight afterwards.
      const channel = client.channel(`airboard:board-session:${sessionId}`, CHANNEL_OPTIONS);
      void Promise.all(fanOutMessages(sessionId, events).map((payload) => send(channel, payload, false))).finally(() =>
        client.removeChannel(channel).catch(() => undefined),
      );
    },
    join(sessionId, listener) {
      const session = sessions.get(sessionId) ?? open(sessionId);
      session.listeners.add(listener);
      return () => {
        session.listeners.delete(listener);
        if (session.listeners.size === 0 && sessions.get(sessionId) === session) {
          sessions.delete(sessionId);
          void client.removeChannel(session.channel).catch(() => undefined);
        }
      };
    },
    async close() {
      const channels = [...sessions.values()].map((session) => session.channel);
      sessions.clear();
      await Promise.all(channels.map((channel) => client.removeChannel(channel).catch(() => undefined)));
    },
    // Proves this key may join private channels, so a misconfigured project
    // shows before two instances disagree.
    probe() {
      return new Promise<string>((resolve) => {
        let channel: FanOutChannel | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (status: string) => {
          if (timer === undefined) return;
          clearTimeout(timer);
          timer = undefined;
          if (channel) void client.removeChannel(channel).catch(() => undefined);
          resolve(status);
        };
        timer = setTimeout(() => finish("TIMED_OUT"), 8_000);
        (timer as { unref?: () => void }).unref?.();
        try {
          channel = client.channel(`airboard:fan-out-probe:${randomUUID()}`, CHANNEL_OPTIONS);
          channel.subscribe((status, error) => {
            if (status !== "CLOSED") finish(error ? `${status}: ${error.message}` : status);
          });
        } catch (error) {
          finish(error instanceof Error ? error.message : "ERROR");
        }
      });
    },
  };
}
