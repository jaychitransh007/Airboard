import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { BOARD_SCENE_VERSION, createEventEnvelope } = await import("@airboard/core");
const { fanOutMessages, supabaseFanOut } = await import("../src/boardEventFanOut.ts");
const { loadConfig } = await import("../src/config.ts");
const { buildServer } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
const { issueSignedToken } = await import("../src/signedTokens.ts");

/**
 * Stands in for Supabase Realtime: channels with the same name hear each
 * other's broadcasts, and a channel created with self: false never hears its
 * own. Each client() is one API instance's connection.
 */
function createRealtimeHub() {
  const subscribed = new Set();
  const removed = [];
  const client = () => ({
    channel(name, options) {
      const channel = {
        name,
        options,
        handlers: [],
        on(_type, filter, callback) {
          this.handlers.push({ event: filter.event, callback });
          return this;
        },
        subscribe(callback) {
          subscribed.add(this);
          this.status = callback;
          callback?.("SUBSCRIBED");
          return this;
        },
        async send(message) {
          for (const other of subscribed) {
            if (other.name !== name || (other === this && !options.config.broadcast.self)) continue;
            for (const handler of other.handlers) {
              if (handler.event === message.event) handler.callback({ payload: structuredClone(message.payload) });
            }
          }
          return "ok";
        },
        async httpSend(event, payload) {
          await this.send({ type: "broadcast", event, payload });
          return { success: true };
        },
      };
      return channel;
    },
    async removeChannel(channel) {
      subscribed.delete(channel);
      removed.push(channel.name);
      return "ok";
    },
  });
  return { client, subscribed, removed };
}

const event = (sequence, extra = {}) => ({ id: `e${sequence}`, type: "board.cleared", sequence, boardSessionId: "s1", createdAt: "2026-11-05T00:00:00Z", ...extra });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A board_events table both instances read from. */
function eventTable(...sequences) {
  const rows = sequences.map((sequence) => event(sequence));
  return {
    rows,
    loadEvents: async (_sessionId, from, to) => rows.filter((row) => row.sequence >= from && row.sequence <= to),
    latestSequence: async () => rows.at(-1)?.sequence ?? 0,
  };
}

test("events reach the other instances on a live board, never the sender, over a private channel", async () => {
  const hub = createRealtimeHub();
  const table = eventTable();
  const a = supabaseFanOut(hub.client(), table);
  const b = supabaseFanOut(hub.client(), table);
  const heardOnA = [];
  const heardOnB = [];
  a.join("s1", (events) => heardOnA.push(...events));
  const leaveB = b.join("s1", (events) => heardOnB.push(...events));
  await settle();

  table.rows.push(event(1), event(2));
  a.publish("s1", [event(1), event(2)]);
  await settle();
  assert.deepEqual(heardOnB.map((entry) => entry.sequence), [1, 2]);
  assert.deepEqual(heardOnA, [], "the sending instance already relayed these itself");
  assert.equal([...hub.subscribed][0].options.config.private, true);

  // The last local socket leaving drops the channel.
  leaveB();
  assert.deepEqual(hub.removed, ["airboard:board-session:s1"]);

  // The startup probe joins a private channel of its own and leaves it.
  assert.equal(await a.probe(), "SUBSCRIBED");
  assert.match(hub.removed.at(-1), /^airboard:fan-out-probe:/);
  const refusing = supabaseFanOut({ ...hub.client(), channel: () => { throw new Error("NO_REALTIME"); } }, table);
  assert.equal(await refusing.probe(), "NO_REALTIME");
});

test("an event too large for one message is sent as its sequence and loaded from the database", async () => {
  // Shrink the limit so the test needn't build a megabyte of JSON.
  const big = event(7, { note: "x".repeat(2_000) });
  const messages = fanOutMessages("s1", [event(6), big, event(8)], 1_000);
  assert.deepEqual(messages.map((message) => ("range" in message ? "range" : message.events.map((entry) => entry.sequence))), [[6], "range", [8]]);

  const hub = createRealtimeHub();
  const table = eventTable(1, 2, 3, 4, 5, 6);
  table.rows.push(big);
  const b = supabaseFanOut(hub.client(), { ...table, latestSequence: async () => 6 });
  const heardOnB = [];
  b.join("s1", (events) => heardOnB.push(...events));
  await settle();

  const [rangeMessage] = fanOutMessages("s1", [big], 1_000);
  await hub.client().channel("airboard:board-session:s1", { config: { private: true, broadcast: { self: false } } })
    .send({ type: "broadcast", event: "board.events", payload: rangeMessage });
  await settle();
  assert.deepEqual(heardOnB.map((entry) => entry.sequence), [7]);
  assert.equal(heardOnB[0].note.length, 2_000);
});

test("an instance that missed messages reads them back, and relays nothing twice", async () => {
  const hub = createRealtimeHub();
  const table = eventTable(1, 2);
  const a = supabaseFanOut(hub.client(), table);
  const b = supabaseFanOut(hub.client(), table);
  const heardOnB = [];
  a.join("s1", () => {});
  b.join("s1", (events) => heardOnB.push(...events));
  await settle();
  const heard = () => heardOnB.map((entry) => entry.sequence);

  // Events already on the board when B joined are not replayed.
  table.rows.push(event(3));
  a.publish("s1", [event(3)]);
  await settle();
  assert.deepEqual(heard(), [3]);

  // Realtime dropped 4 and 5; 6 shows the gap, so B reads them first.
  table.rows.push(event(4), event(5), event(6));
  a.publish("s1", [event(6)]);
  await settle();
  assert.deepEqual(heard(), [3, 4, 5, 6]);

  // A reconnect rejoins the channel; B catches up on what it missed meanwhile.
  table.rows.push(event(7));
  const channelOfB = [...hub.subscribed].filter((channel) => channel.name === "airboard:board-session:s1")[1];
  channelOfB.status("SUBSCRIBED");
  await settle();
  assert.deepEqual(heard(), [3, 4, 5, 6, 7]);

  // A late copy of 7 is dropped, and B's own event 8 is not relayed back to it.
  a.publish("s1", [event(7)]);
  table.rows.push(event(8));
  b.publish("s1", [event(8)]);
  await settle();
  assert.deepEqual(heard(), [3, 4, 5, 6, 7]);
  table.rows.push(event(9));
  a.publish("s1", [event(9)]);
  await settle();
  assert.deepEqual(heard(), [3, 4, 5, 6, 7, 9]);
});

function connect(port, ticket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${BOARD_SCENE_VERSION}`);
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  const ready = new Promise((resolve, reject) => {
    socket.once("error", reject);
    const check = () => (messages.some((message) => message.type === "board.initialized") ? resolve() : setTimeout(check, 5));
    check();
  });
  return { socket, messages, ready };
}

test("two API instances: an edit made through one reaches a guest connected to the other", async (t) => {
  const config = loadConfig({ NODE_ENV: "test", AIRBOARD_LOCAL_ENTITLEMENTS: "true" });
  const store = new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true });
  const hub = createRealtimeHub();
  const instance = async () => {
    const server = await buildServer(config, {
      store,
      fanOut: supabaseFanOut(hub.client(), {
        loadEvents: async (sessionId, from, to) => store.getEventsInRange(sessionId, from, to),
        latestSequence: async (sessionId) => store.getLatestSequence(sessionId),
      }),
    });
    await server.listen({ host: "127.0.0.1", port: 0 });
    t.after(() => server.close());
    return server.server.address().port;
  };
  const [portA, portB] = [await instance(), await instance()];

  const { session, ownerParticipant } = store.startSession({ ownerUserId: "owner-1", provider: "standalone", allowParticipantDrawing: true });
  const { participant: guest } = store.joinSession({ sessionId: session.id, displayName: "Guest" });
  const ticket = (participant, sub) =>
    issueSignedToken(config.sessionSigningSecret, { purpose: "realtime", sub, sessionId: session.id, participantId: participant.id, ttlSeconds: 600 });

  const owner = connect(portA, ticket(ownerParticipant, "owner-1"));
  const guestOnB = connect(portB, ticket(guest, guest.id));
  t.after(() => {
    owner.socket.close();
    guestOnB.socket.close();
  });
  await Promise.all([owner.ready, guestOnB.ready]);
  await new Promise((resolve) => setTimeout(resolve, 20));

  owner.socket.send(JSON.stringify({
    type: "board.event",
    event: { ...createEventEnvelope({ boardSessionId: session.id, actorParticipantId: ownerParticipant.id }), type: "board.cleared" },
  }));

  const arrived = async (client) => {
    for (let waited = 0; waited < 2_000; waited += 10) {
      const found = client.messages.filter((message) => message.type === "board.event");
      if (found.length) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return [];
  };
  const onB = await arrived(guestOnB);
  assert.equal(onB.length, 1, "the guest on the other instance gets the owner's edit");
  assert.equal(onB[0].event.type, "board.cleared");
  assert.equal(onB[0].event.sequence, 1);
  const onA = await arrived(owner);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(owner.messages.filter((message) => message.type === "board.event").length, 1, "the sender's instance relays once, with no echo");
  assert.equal(onA[0].event.sequence, 1);
});
