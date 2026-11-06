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
const { loadConfig } = await import("../src/config.ts");
const { buildServer } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
const { createEventBudget } = await import("../src/security.ts");
const { issueSignedToken } = await import("../src/signedTokens.ts");

test("an event budget allows a burst up to its size and refills steadily", () => {
  const budget = createEventBudget({ windowMs: 10_000, max: 10 });
  assert.equal(budget.allowMany(10, 0), true);
  assert.equal(budget.allowMany(1, 0), false);
  assert.equal(budget.allowMany(5, 5_000), true, "half the window refills half the budget");
  assert.equal(budget.allowMany(1, 5_000), false);
});

async function limitedServer(t) {
  const config = loadConfig({
    NODE_ENV: "test",
    AIRBOARD_LOCAL_ENTITLEMENTS: "true",
    AIRBOARD_RATE_LIMIT_BOARD_CONNECTIONS_PER_MINUTE: "3",
    AIRBOARD_RATE_LIMIT_BOARD_READS_PER_MINUTE: "2",
    AIRBOARD_RATE_LIMIT_BOARD_EVENTS_PER_10_SECONDS: "10",
  });
  const store = new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true });
  const server = await buildServer(config, { store });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const { session, ownerParticipant } = store.startSession({ ownerUserId: "owner-1", provider: "standalone", allowParticipantDrawing: true });
  const ticket = issueSignedToken(config.sessionSigningSecret, {
    purpose: "realtime", sub: "owner-1", sessionId: session.id, participantId: ownerParticipant.id, ttlSeconds: 600,
  });
  return { port: server.server.address().port, session, ownerParticipant, ticket };
}

function open(port, ticket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${BOARD_SCENE_VERSION}`);
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  let isClosed = false;
  const closed = new Promise((resolve) =>
    socket.on("close", (code, reason) => {
      isClosed = true;
      resolve({ code, reason: String(reason) });
    }),
  );
  socket.on("error", () => undefined);
  // Polls until initialized; a refused socket stops the polling when it closes.
  const ready = new Promise((resolve) => {
    const check = () => {
      if (messages.some((m) => m.type === "board.initialized")) resolve();
      else if (!isClosed) setTimeout(check, 5);
    };
    check();
  });
  return { socket, messages, closed, ready };
}

const waitFor = async (predicate) => {
  for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("board sockets cap batch size, event rate, message size and connections per caller", async (t) => {
  const { port, session, ownerParticipant, ticket } = await limitedServer(t);
  const cleared = () => ({
    ...createEventEnvelope({ boardSessionId: session.id, actorParticipantId: ownerParticipant.id }),
    type: "board.cleared",
  });

  const client = open(port, ticket);
  await client.ready;

  // A batch larger than any compound command is refused whole.
  client.socket.send(JSON.stringify({ type: "board.events", events: Array.from({ length: 501 }, cleared) }));
  await waitFor(() => client.messages.some((m) => m.type === "event.rejected"));
  assert.equal(client.messages.find((m) => m.type === "event.rejected").reason, "BATCH_TOO_LARGE");

  // Ten events fit the budget; the eleventh is refused until it refills.
  for (let i = 0; i < 11; i += 1) client.socket.send(JSON.stringify({ type: "board.event", event: cleared() }));
  await waitFor(() => client.messages.filter((m) => m.type === "event.rejected").length >= 2);
  assert.equal(client.messages.filter((m) => m.type === "event.rejected").at(-1).reason, "RATE_LIMITED");
  await waitFor(() => client.messages.filter((m) => m.type === "board.event").length >= 10);
  assert.equal(client.messages.filter((m) => m.type === "board.event").length, 10);

  // A message over 1 MB closes the socket (1009, or 1006 when the server drops it outright).
  client.socket.send("x".repeat(1024 * 1024 + 1));
  assert.ok([1006, 1009].includes((await client.closed).code));

  // Connections per caller per minute: two more are allowed, the next is refused.
  const second = open(port, ticket);
  await second.ready;
  const third = open(port, ticket);
  await third.ready;
  const refused = open(port, ticket);
  assert.deepEqual(await refused.closed, { code: 1013, reason: "RATE_LIMITED" });
  second.socket.close();
  third.socket.close();

  // State reads per caller per minute.
  const state = () => fetch(`http://127.0.0.1:${port}/sessions/${session.id}/state?ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await state()).status, 200);
  assert.equal((await state()).status, 200);
  assert.equal((await state()).status, 429);
});

async function cappedServer(t) {
  const config = loadConfig({
    NODE_ENV: "test",
    AIRBOARD_LOCAL_ENTITLEMENTS: "true",
    AIRBOARD_TRUSTED_PROXY_HOPS: "1",
    AIRBOARD_BOARD_SOCKETS_PER_PARTICIPANT: "2",
    AIRBOARD_BOARD_SOCKETS_PER_CALLER: "3",
    AIRBOARD_BOARD_SOCKETS_PER_SESSION: "4",
  });
  const store = new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true });
  const server = await buildServer(config, { store });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const { session, ownerParticipant } = store.startSession({ ownerUserId: "owner-1", provider: "standalone", allowParticipantDrawing: true });
  const ticketFor = (participantId) =>
    issueSignedToken(config.sessionSigningSecret, { purpose: "realtime", sub: "owner-1", sessionId: session.id, participantId, ttlSeconds: 600 });
  const guest = () => ticketFor(store.joinSession({ sessionId: session.id, displayName: "Guest" }).participant.id);
  return { port: server.server.address().port, store, session, ownerParticipant, ownerTicket: ticketFor(ownerParticipant.id), guest };
}

function openFrom(port, ticket, address) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${BOARD_SCENE_VERSION}`, {
    headers: { "x-forwarded-for": address },
  });
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  socket.on("error", () => undefined);
  let isClosed = false;
  const closed = new Promise((resolve) =>
    socket.on("close", (code, reason) => {
      isClosed = true;
      resolve({ code, reason: String(reason) });
    }),
  );
  const ready = new Promise((resolve) => {
    const check = () => {
      if (messages.some((m) => m.type === "board.initialized")) resolve();
      else if (!isClosed) setTimeout(check, 5);
    };
    check();
  });
  return { socket, messages, closed, ready };
}

const CONNECTION_LIMIT = { code: 1013, reason: "BOARD_CONNECTION_LIMIT" };

test("one participant, address or board can hold only so many open sockets", async (t) => {
  const { port, ownerTicket, guest } = await cappedServer(t);
  const closeAll = async (clients) => {
    for (const client of clients) client.socket.close();
    await Promise.all(clients.map((client) => client.closed));
  };

  // Per participant (2): a third tab waits until one closes.
  const tabs = [openFrom(port, ownerTicket, "203.0.113.1"), openFrom(port, ownerTicket, "203.0.113.2")];
  await Promise.all(tabs.map((client) => client.ready));
  assert.deepEqual(await openFrom(port, ownerTicket, "203.0.113.3").closed, CONNECTION_LIMIT);
  await closeAll([tabs[0]]);
  const replacement = openFrom(port, ownerTicket, "203.0.113.3");
  await replacement.ready;
  await closeAll([tabs[1], replacement]);

  // Per address (3): different people behind one address; the board holds 3 of its 4.
  const office = [1, 2, 3].map(() => openFrom(port, guest(), "198.51.100.7"));
  await Promise.all(office.map((client) => client.ready));
  assert.deepEqual(await openFrom(port, guest(), "198.51.100.7").closed, CONNECTION_LIMIT);

  // Per board (4): one more from elsewhere fits, the next is refused.
  const remote = openFrom(port, guest(), "192.0.2.10");
  await remote.ready;
  assert.deepEqual(await openFrom(port, guest(), "192.0.2.11").closed, CONNECTION_LIMIT);

  // Closing a socket frees its slot on every count.
  await closeAll([office[0]]);
  const late = openFrom(port, guest(), "198.51.100.7");
  await late.ready;
  await closeAll([office[1], office[2], remote, late]);
});

test("cursor moves reach everyone on the board but are never stored", async (t) => {
  const { port, store, session, ownerParticipant, ownerTicket, guest } = await cappedServer(t);
  const owner = openFrom(port, ownerTicket, "203.0.113.1");
  const viewer = openFrom(port, guest(), "203.0.113.2");
  await Promise.all([owner.ready, viewer.ready]);

  const envelope = () => createEventEnvelope({ boardSessionId: session.id, actorParticipantId: ownerParticipant.id });
  owner.socket.send(JSON.stringify({
    type: "board.event",
    event: { ...envelope(), sequence: 99, type: "cursor.moved", cursor: { participantId: ownerParticipant.id, x: 10, y: 20, mode: "idle" } },
  }));
  await waitFor(() => viewer.messages.some((m) => m.type === "board.event" && m.event.type === "cursor.moved"));
  const relayed = viewer.messages.find((m) => m.type === "board.event" && m.event.type === "cursor.moved").event;
  assert.deepEqual([relayed.cursor.x, relayed.cursor.y], [10, 20]);
  assert.equal(relayed.sequence, undefined, "presence carries no sequence");
  assert.equal(store.getLatestSequence(session.id), 0, "nothing was stored");

  // Board changes are still stored and numbered.
  owner.socket.send(JSON.stringify({ type: "board.event", event: { ...envelope(), type: "board.cleared" } }));
  await waitFor(() => viewer.messages.some((m) => m.type === "board.event" && m.event.type === "board.cleared"));
  assert.equal(viewer.messages.find((m) => m.event?.type === "board.cleared").event.sequence, 1);
  assert.equal(store.getLatestSequence(session.id), 1);

  owner.socket.close();
  viewer.socket.close();
});
