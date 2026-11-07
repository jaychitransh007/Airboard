import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { BOARD_SCENE_VERSION, createEventEnvelope } = await import("@airboard/core");
const { loadConfig } = await import("../src/config.ts");
const { buildServer } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
const { singleInstanceFanOut } = await import("../src/boardEventFanOut.ts");
const { verifySignedToken } = await import("../src/signedTokens.ts");

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "33333333-3333-4333-8333-333333333333";

function fakeAuth() {
  return {
    client: null,
    enabled: true,
    async authenticate(request) {
      return request.headers.authorization === "Bearer owner"
        ? { authUserId: "auth-owner", profileId: OWNER, organizationId: ORG, role: "owner", email: null, displayName: "Owner", tokenKind: "supabase" }
        : null;
    },
    hasRole: (account, roles) => roles.includes(account.role),
    async activeEntitlement() {
      return { status: "active" };
    },
  };
}

async function server(t) {
  const config = loadConfig({ NODE_ENV: "test", AIRBOARD_LOCAL_ENTITLEMENTS: "true" });
  const store = new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true });
  const app = await buildServer(config, { store, auth: fakeAuth(), fanOut: singleInstanceFanOut });
  t.after(() => app.close());
  const started = (
    await app.inject({ method: "POST", url: "/sessions/start", headers: { authorization: "Bearer owner" }, payload: { provider: "standalone" } })
  ).json();
  const joined = (
    await app.inject({ method: "POST", url: `/sessions/${started.session.id}/join`, payload: { displayName: "Guest", joinToken: started.joinToken } })
  ).json();
  return { app, config, store, started, joined };
}

/** A genuine realtime ticket, signed with the API's secret, that ran out `secondsAgo` ago. */
function expiredTicket(secret, { sessionId, participantId, sub }, secondsAgo = 60) {
  const now = Math.floor(Date.now() / 1_000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    purpose: "realtime",
    sub,
    organizationId: ORG,
    sessionId,
    participantId,
    iat: now - secondsAgo - 30 * 60,
    exp: now - secondsAgo,
    jti: randomUUID(),
  })).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

const refresh = (app, sessionId, refreshToken, as) =>
  app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/ticket`,
    headers: as ? { authorization: `Bearer ${as}` } : {},
    payload: { refreshToken },
  });

test("a refresh token trades for a fresh ticket while its holder is in an open session; the URL-borne ticket can't", async (t) => {
  const { app, config, store, started, joined } = await server(t);
  const sessionId = started.session.id;
  assert.equal(typeof joined.refreshToken, "string", "join hands out a refresh token in the body");

  const fresh = await refresh(app, sessionId, joined.refreshToken);
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.equal(fresh.json().expiresInSeconds, 30 * 60);
  const ticket = verifySignedToken(config.sessionSigningSecret, fresh.json().realtimeTicket, "realtime");
  assert.equal(ticket.participantId, joined.participant.id);
  assert.equal(ticket.sessionId, sessionId);

  // A realtime ticket, which travels in URLs and logs, renews nothing, fresh or expired.
  for (const urlBorne of [
    joined.realtimeTicket,
    expiredTicket(config.sessionSigningSecret, { sessionId, participantId: joined.participant.id, sub: joined.participant.id }),
  ]) {
    const refused = await refresh(app, sessionId, urlBorne);
    assert.equal(refused.statusCode, 401);
    assert.equal(refused.json().error, "REFRESH_TOKEN_REQUIRED");
  }
  assert.equal((await refresh(app, sessionId, "forged.token")).statusCode, 401);
  assert.equal((await refresh(app, sessionId, undefined)).statusCode, 401);
  assert.equal((await refresh(app, "another-session", joined.refreshToken)).statusCode, 401);

  // Ending the session stops refreshes for everyone.
  store.endSession(sessionId);
  const after = await refresh(app, sessionId, joined.refreshToken);
  assert.equal(after.statusCode, 409);
  assert.equal(after.json().error, "SESSION_NOT_JOINABLE");
});

test("the signed-in owner's refresh revives a session locked while they were away; a guest's only waits", async (t) => {
  const { app, store, started, joined } = await server(t);
  const sessionId = started.session.id;
  store.lockSession(sessionId);
  const guestRefresh = await refresh(app, sessionId, joined.refreshToken);
  assert.equal(guestRefresh.statusCode, 409, "a guest can't reopen a locked session");
  assert.equal(guestRefresh.json().error, "SESSION_LOCKED", "locked, not over: the guest waits");

  // The owner's refresh token alone can't refresh or revive the owner's place.
  const unsigned = await refresh(app, sessionId, started.refreshToken);
  assert.equal(unsigned.statusCode, 401);
  assert.equal(unsigned.json().error, "OWNER_AUTH_REQUIRED");
  assert.equal(store.getSession(sessionId).status, "locked");

  const ownerRefresh = await refresh(app, sessionId, started.refreshToken, "owner");
  assert.equal(ownerRefresh.statusCode, 200, ownerRefresh.body);
  assert.equal(store.getSession(sessionId).status, "active");
  assert.equal((await refresh(app, sessionId, joined.refreshToken)).statusCode, 200, "guests carry on once the owner is back");

  store.endSession(sessionId);
  const ended = await refresh(app, sessionId, started.refreshToken, "owner");
  assert.equal(ended.statusCode, 409, "an ended session stays ended");
  assert.equal(ended.json().error, "SESSION_NOT_JOINABLE");
  assert.equal(store.getSession(sessionId).status, "ended");
});

test("a store that fails answers a retryable 503, not 'session not found'", async (t) => {
  const { app, store, started } = await server(t);
  store.getSession = () => {
    throw new Error("SESSION_LOOKUP_FAILED");
  };
  const ticket = await refresh(app, started.session.id, started.refreshToken, "owner");
  assert.equal(ticket.statusCode, 503);
  store.getLatestSequence = () => {
    throw new Error("BOARD_EVENT_LOOKUP_FAILED");
  };
  const events = await app.inject({
    method: "POST",
    url: `/sessions/${started.session.id}/events`,
    payload: { realtimeTicket: started.realtimeTicket, after: 0 },
  });
  assert.equal(events.statusCode, 503);
});

test("a board that reconnects gets exactly the events it missed, a page of 1,000 at a time", async (t) => {
  const { app, config, store, started } = await server(t);
  const sessionId = started.session.id;
  const event = () => ({
    ...createEventEnvelope({ boardSessionId: sessionId, actorParticipantId: started.ownerParticipant.id }),
    type: "element.deleted",
    elementId: "missing",
  });
  store.appendEvents(sessionId, [event(), event(), event()]);
  const catchUp = (payload) => app.inject({ method: "POST", url: `/sessions/${sessionId}/events`, payload });

  const missed = await catchUp({ realtimeTicket: started.realtimeTicket, after: 1 });
  assert.equal(missed.statusCode, 200, missed.body);
  assert.deepEqual(missed.json().events.map((e) => e.sequence), [2, 3]);
  assert.equal(missed.json().latestSequence, 3);
  assert.deepEqual((await catchUp({ realtimeTicket: started.realtimeTicket, after: 3 })).json(), { events: [], latestSequence: 3 });

  assert.equal((await catchUp({ realtimeTicket: started.realtimeTicket, after: -1 })).statusCode, 400);
  assert.equal((await catchUp({ realtimeTicket: started.realtimeTicket, after: "1" })).statusCode, 400);
  assert.equal((await catchUp({ realtimeTicket: "forged.ticket", after: 0 })).statusCode, 401);
  const expired = expiredTicket(config.sessionSigningSecret, {
    sessionId,
    participantId: started.ownerParticipant.id,
    sub: OWNER,
  });
  assert.equal((await catchUp({ realtimeTicket: expired, after: 0 })).statusCode, 401, "catching up needs a live ticket");

  store.appendEvents(sessionId, Array.from({ length: 1_001 }, event));
  const firstPage = (await catchUp({ realtimeTicket: started.realtimeTicket, after: 3 })).json();
  assert.equal(firstPage.events.length, 1_000);
  assert.equal(firstPage.events[0].sequence, 4);
  assert.equal(firstPage.latestSequence, 1_004);
  const lastPage = (await catchUp({ realtimeTicket: started.realtimeTicket, after: 1_003 })).json();
  assert.deepEqual(lastPage.events.map((e) => e.sequence), [1_004]);
});

test("a socket with an expired ticket is told so, so the board refreshes it; a forged one is refused", async (t) => {
  const { app, config, started } = await server(t);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = app.server.address().port;
  const closeOf = (ticket) =>
    new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${BOARD_SCENE_VERSION}`);
      socket.on("error", () => undefined);
      socket.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
    });
  const expired = expiredTicket(config.sessionSigningSecret, {
    sessionId: started.session.id,
    participantId: started.ownerParticipant.id,
    sub: OWNER,
  });
  assert.deepEqual(await closeOf(expired), { code: 1008, reason: "TICKET_EXPIRED" });
  assert.deepEqual(await closeOf("forged.ticket"), { code: 1008, reason: "A valid realtime ticket is required" });
});

test("a change resent after a cut connection is stored once", async (t) => {
  const { store, started } = await server(t);
  const sessionId = started.session.id;
  const change = {
    ...createEventEnvelope({ boardSessionId: sessionId, actorParticipantId: started.ownerParticipant.id }),
    type: "element.deleted",
    elementId: "missing",
  };
  const fresh = {
    ...createEventEnvelope({ boardSessionId: sessionId, actorParticipantId: started.ownerParticipant.id }),
    type: "element.deleted",
    elementId: "other",
  };
  assert.equal(store.appendEvents(sessionId, [change]).length, 1);
  const resent = store.appendEvents(sessionId, [change, fresh]);
  assert.deepEqual(resent.map((event) => event.id), [fresh.id], "only the new one is appended");
  assert.equal(store.getLatestSequence(sessionId), 2);
});


test("two batches sent back to back are stored in the order they were sent, even when the first is slower", async (t) => {
  const { app, store, started } = await server(t);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = app.server.address().port;
  const sessionId = started.session.id;
  const append = store.appendEvents.bind(store);
  let calls = 0;
  store.appendEvents = async (id, events) => {
    // The first write is slow, as a larger batch is on the database.
    if ((calls += 1) === 1) await new Promise((resolve) => setTimeout(resolve, 80));
    return append(id, events);
  };
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(started.realtimeTicket)}&sceneVersion=${BOARD_SCENE_VERSION}`);
  t.after(() => socket.close());
  const echoes = [];
  await new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "board.initialized") resolve();
      if (message.type === "board.event") echoes.push(message.event);
    });
  });
  const event = (elementId) => ({
    ...createEventEnvelope({ boardSessionId: sessionId, actorParticipantId: started.ownerParticipant.id }),
    type: "element.deleted",
    elementId,
  });
  socket.send(JSON.stringify({ type: "board.events", events: [event("first-a"), event("first-b")] }));
  socket.send(JSON.stringify({ type: "board.events", events: [event("second")] }));
  for (let i = 0; i < 100 && echoes.length < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(echoes.map((e) => [e.elementId, e.sequence]), [["first-a", 1], ["first-b", 2], ["second", 3]]);
});
