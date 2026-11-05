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
