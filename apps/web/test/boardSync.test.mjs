import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialBoardState,
  applyBoardEvent,
  createBoardSceneElement,
  createEventEnvelope,
} from "@airboard/core";
import {
  buildBoardWebSocketUrl,
  requestBoardSessionStart,
  snapshotBoardEvents,
  startBoardSync,
} from "../src/features/board/boardSync.ts";

class FakeClient {
  constructor(options) {
    this.options = options;
    this.batches = [];
    this.eventListener = null;
    this.connected = false;
    this.closed = false;
    this.sendResult = true;
  }
  connect() {
    this.connected = true;
    this.connects = (this.connects ?? 0) + 1;
  }
  setRealtimeTicket(ticket) {
    this.ticket = ticket;
  }
  close() {
    this.closed = true;
  }
  sendEvents(events) {
    if (!this.sendResult) return false;
    this.batches.push(events);
    return true;
  }
  onEvent(listener) {
    this.eventListener = listener;
    return () => {};
  }
  onStatus(listener) {
    this.statusListener = listener;
    return () => {};
  }
  onRejection(listener) {
    this.rejectionListener = listener;
    return () => {};
  }
}

function fakeFetchRouter(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    // Every admission catches up first; these sessions have nothing to miss.
    if (String(url).endsWith("/events") && !routes.some((route) => String(url).includes(route.match))) {
      const after = JSON.parse(init.body).after;
      return { ok: true, status: 200, json: async () => ({ events: [], latestSequence: after }) };
    }
    for (const route of routes) {
      if (String(url).includes(route.match)) {
        return {
          ok: route.status ? route.status < 400 : true,
          status: route.status ?? 200,
          json: async () => route.body,
        };
      }
    }
    throw new Error(`no route for ${url}`);
  };
  return { fetchImpl, calls };
}

const noTimers = { setTimer: () => 0, clearTimer: () => {} };

test("create path: bearer auth, standalone provider, ws to the session", async () => {
  const clients = [];
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/start",
      body: {
        session: { id: "session-9" },
        ownerParticipant: { id: "owner-p", role: "owner" },
        realtimeTicket: "realtime-9",
        joinToken: "join-9",
      },
    },
  ]);
  const result = await startBoardSync(
    { apiBaseUrl: "http://127.0.0.1:4600", ownerUserId: "user-1", accessToken: "account-9", title: "Test board" },
    { onRemoteEvent: () => {} },
    {
      fetchImpl,
      createClient: (o) => {
        const c = new FakeClient(o);
        clients.push(c);
        return c;
      },
      ...noTimers,
    },
  );
  assert.equal(result.outcome, "created");
  assert.equal(result.initialState, null);
  assert.equal(result.handle.boardSessionId, "session-9");
  assert.equal(calls[0].init.headers.Authorization, "Bearer account-9");
  assert.equal(calls[0].init.headers["x-airboard-user-id"], undefined);
  assert.equal(JSON.parse(calls[0].init.body).provider, "standalone");
  assert.equal(clients[0].options.url, "ws://127.0.0.1:4600/ws");
  assert.equal(clients[0].options.realtimeTicket, "realtime-9");
  assert.equal(clients[0].connected, true);
});

test("create path binds a provider meeting to the server session", async () => {
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/start",
      body: {
        session: { id: "meet-session" },
        ownerParticipant: { id: "meet-owner", role: "owner" },
      },
    },
  ]);
  await startBoardSync(
    {
      apiBaseUrl: "http://127.0.0.1:4600",
      ownerUserId: "user-1",
      provider: "google_meet",
      providerMeetingId: "meet-global-id",
    },
    { onRemoteEvent: () => {} },
    { fetchImpl, createClient: (o) => new FakeClient(o), ...noTimers },
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    provider: "google_meet",
    providerMeetingId: "meet-global-id",
  });
});

test("join path returns the server board state for hydration", async () => {
  const state = createInitialBoardState("session-3");
  const { fetchImpl } = fakeFetchRouter([
    {
      match: "/sessions/session-3/join",
      body: {
        session: { id: "session-3" },
        participant: { id: "guest-p", role: "editor" },
        state,
      },
    },
  ]);
  const result = await startBoardSync(
    { apiBaseUrl: "http://127.0.0.1:4600", boardSessionId: "session-3", ownerUserId: "user-1" },
    { onRemoteEvent: () => {} },
    { fetchImpl, createClient: (o) => new FakeClient(o), ...noTimers },
  );
  assert.equal(result.outcome, "joined");
  assert.equal(result.initialState.boardId, "session-3");
  assert.equal(result.handle.role, "editor");
});

test("join intake drops the API's strokes key and converts a board still holding legacy strokes", async () => {
  const legacyNode = {
    id: "legacy-node",
    boardId: "session-4",
    userId: "u",
    color: "#0f172a",
    thickness: 3,
    status: "committed",
    points: [{ x: 100, y: 100, t: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    annotation: {
      type: "flow_node",
      source: "voice",
      confidence: 1,
      nodeType: "service",
      label: "Billing",
      bounds: { x: 100, y: 100, width: 160, height: 80 },
    },
  };
  for (const [id, strokes] of [["session-4", { [legacyNode.id]: legacyNode }], ["session-5", {}]]) {
    const { fetchImpl } = fakeFetchRouter([
      {
        match: `/sessions/${id}/join`,
        body: {
          session: { id },
          participant: { id: "guest-p", role: "editor" },
          state: { ...createInitialBoardState(id), lastSequence: 12, strokes },
        },
      },
    ]);
    const result = await startBoardSync(
      { apiBaseUrl: "http://127.0.0.1:4600", boardSessionId: id, ownerUserId: "user-1" },
      { onRemoteEvent: () => {} },
      { fetchImpl, createClient: (o) => new FakeClient(o), ...noTimers },
    );
    assert.equal("strokes" in result.initialState, false, `${id}: no strokes key`);
    assert.equal(result.initialState.lastSequence, 12, `${id}: the catch-up watermark is kept`);
    if (id === "session-4") {
      assert.equal(result.initialState.elements[legacyNode.id]?.kind, "shape", "the legacy node is now a v2 shape");
      assert.equal(result.initialState.elements[legacyNode.id]?.status, "active");
    } else {
      assert.deepEqual(result.initialState.elements, {});
    }
  }
});

test("join failures surface the server error code", async () => {
  const { fetchImpl } = fakeFetchRouter([
    { match: "/join", status: 404, body: { error: "SESSION_NOT_FOUND" } },
  ]);
  await assert.rejects(
    startBoardSync(
      { apiBaseUrl: "http://x", boardSessionId: "nope", ownerUserId: "u" },
      { onRemoteEvent: () => {} },
      { fetchImpl, createClient: (o) => new FakeClient(o), ...noTimers },
    ),
    /SESSION_NOT_FOUND/,
  );
});

test("ECHO INVARIANT: published events never come back as remote events", async () => {
  const clients = [];
  const remote = [];
  const { fetchImpl } = fakeFetchRouter([
    {
      match: "/sessions/start",
      body: { session: { id: "s" }, ownerParticipant: { id: "p", role: "owner" } },
    },
  ]);
  const { handle } = await startBoardSync(
    { apiBaseUrl: "http://x", ownerUserId: "u" },
    { onRemoteEvent: (e) => remote.push(e) },
    {
      fetchImpl,
      createClient: (o) => {
        const c = new FakeClient(o);
        clients.push(c);
        return c;
      },
      ...noTimers,
    },
  );
  const mine = { id: "evt-1", type: "element.deleted", elementId: "s1" };
  const theirs = { id: "evt-2", type: "element.deleted", elementId: "s2" };
  handle.publish(mine);
  clients[0].eventListener({ ...mine, sequence: 7 }); // server echo
  clients[0].eventListener(theirs);
  assert.deepEqual(
    remote.map((e) => e.id),
    ["evt-2"],
    "echo dropped, peer event delivered",
  );
});

test("board changes made while disconnected wait and go out on reconnect; cursor moves are dropped", async () => {
  const clients = [];
  const remote = [];
  const { fetchImpl } = fakeFetchRouter([
    {
      match: "/sessions/start",
      body: { session: { id: "s" }, ownerParticipant: { id: "p", role: "owner" } },
    },
  ]);
  const { handle } = await startBoardSync(
    { apiBaseUrl: "http://x", ownerUserId: "u" },
    { onRemoteEvent: (e) => remote.push(e) },
    {
      fetchImpl,
      createClient: (o) => {
        const c = new FakeClient(o);
        clients.push(c);
        return c;
      },
      ...noTimers,
    },
  );
  clients[0].sendResult = false;
  const held = { id: "evt-9", type: "element.deleted", elementId: "x" };
  assert.equal(handle.publish(held), true, "held for the reconnect");
  assert.equal(handle.publish({ id: "cur-1", type: "cursor.moved", cursor: { participantId: "p", x: 0, y: 0 } }), false);

  // The socket comes back: after catching up, the held change goes out once.
  clients[0].sendResult = true;
  clients[0].statusListener("connected");
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(clients[0].batches, [[held]]);
  // Its echo is ours, so it is not applied twice.
  clients[0].eventListener({ ...held, sequence: 1 });
  assert.equal(remote.length, 0);
});

test("snapshotBoardEvents seeds the board's objects re-addressed to the session", () => {
  let state = createInitialBoardState("local-board");
  for (const [id, kind] of [["sticky", "sticky"], ["gone", "text"]]) {
    state = applyBoardEvent(state, {
      ...createEventEnvelope({ boardSessionId: "local-board", actorParticipantId: "p" }),
      type: "element.created",
      element: createBoardSceneElement({ id, boardId: "local-board", kind }),
    });
  }
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "local-board", actorParticipantId: "p" }),
    type: "element.deleted",
    elementId: "gone",
  });

  const events = snapshotBoardEvents(state, {
    boardSessionId: "server-session",
    actorParticipantId: "owner-p",
  });
  assert.deepEqual(events.map((event) => event.type), ["element.created"], "only element.created, deleted objects skipped");
  assert.equal(events[0].element.id, "sticky");
  assert.equal(events[0].element.boardId, "server-session");
  assert.equal(events[0].boardSessionId, "server-session");
});

test("buildBoardWebSocketUrl maps http(s) to ws(s)", () => {
  assert.equal(buildBoardWebSocketUrl("http://127.0.0.1:4600"), "ws://127.0.0.1:4600/ws");
  assert.equal(buildBoardWebSocketUrl("https://api.airboard.app/x?y=1"), "wss://api.airboard.app/ws");
});

test("a session start sent while the board loads is used instead of a new one, and can be read twice", async () => {
  const sent = [];
  const startFetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(JSON.stringify({
      session: { id: "early-session" },
      ownerParticipant: { id: "owner-p", role: "owner" },
      realtimeTicket: "realtime-early",
      joinToken: "join-early",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const pendingStart = requestBoardSessionStart(
    { apiBaseUrl: "http://127.0.0.1:4600", accessToken: "account-9", boardId: "board-1", title: "Airboard" },
    startFetch,
  );
  assert.deepEqual(sent[0].body, { provider: "standalone", title: "Airboard", boardId: "board-1" });
  assert.equal(sent[0].auth, "Bearer account-9");

  // startBoardSync must not send its own start when one is already in flight.
  const { fetchImpl, calls } = fakeFetchRouter([]);
  const start = () => startBoardSync(
    { apiBaseUrl: "http://127.0.0.1:4600", ownerUserId: "user-1", accessToken: "account-9", boardId: "board-1", pendingStart },
    { onRemoteEvent: () => {} },
    { fetchImpl, createClient: (o) => new FakeClient(o), ...noTimers },
  );
  const first = await start();
  // A remounted board (React runs effects twice in development) reuses it.
  const second = await start();
  assert.equal(first.handle.boardSessionId, "early-session");
  assert.equal(second.handle.boardSessionId, "early-session");
  assert.equal(calls.filter((call) => call.url.includes("/sessions/start")).length, 0);
  assert.equal(sent.length, 1);
});

test("a saved board's session starts view-only for guests, and the handle reports the setting", async () => {
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/start",
      body: {
        session: { id: "session-v", allowParticipantDrawing: false },
        ownerParticipant: { id: "owner-p", role: "owner" },
        realtimeTicket: "realtime-v",
        joinToken: "join-v",
      },
    },
  ]);
  const result = await startBoardSync(
    { apiBaseUrl: "https://api.test", ownerUserId: "owner-1", accessToken: "token", boardId: "board-1", allowParticipantDrawing: false },
    { onRemoteEvent() {} },
    { fetchImpl, createClient: (options) => new FakeClient(options), ...noTimers },
  );
  assert.equal(JSON.parse(calls[0].init.body).allowParticipantDrawing, false);
  assert.equal(result.handle.allowParticipantDrawing, false);
});

test("after a reload the owner resumes their own place instead of joining as a guest", async () => {
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/session-r/resume",
      body: {
        session: { id: "session-r", allowParticipantDrawing: true },
        participant: { id: "owner-p", role: "owner" },
        state: createInitialBoardState("session-r"),
        realtimeTicket: "realtime-r",
      },
    },
  ]);
  const result = await startBoardSync(
    {
      apiBaseUrl: "https://api.test",
      ownerUserId: "owner-1",
      accessToken: "token",
      boardSessionId: "session-r",
      joinToken: "join-r",
      resumeParticipantId: "owner-p",
    },
    { onRemoteEvent() {} },
    { fetchImpl, createClient: (options) => new FakeClient(options), ...noTimers },
  );
  assert.match(calls[0].url, /\/sessions\/session-r\/resume$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { participantId: "owner-p" });
  assert.equal(result.outcome, "joined");
  assert.equal(result.handle.role, "owner");
  assert.equal(result.handle.allowParticipantDrawing, true);
});

test("a guest's join sends their sign-in when they have one", async () => {
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/session-g/join",
      body: {
        session: { id: "session-g", allowParticipantDrawing: false },
        participant: { id: "guest-p", role: "editor" },
        state: createInitialBoardState("session-g"),
        realtimeTicket: "realtime-g",
      },
    },
  ]);
  const result = await startBoardSync(
    { apiBaseUrl: "https://api.test", ownerUserId: "member-1", accessToken: "token", boardSessionId: "session-g", joinToken: "join-g" },
    { onRemoteEvent() {} },
    { fetchImpl, createClient: (options) => new FakeClient(options), ...noTimers },
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
  assert.equal(JSON.parse(calls[0].init.body).joinToken, "join-g");
  assert.equal(result.handle.allowParticipantDrawing, false);
});

test("after each connect a guest re-reads whether they may edit, so a change made while away is not missed", async () => {
  const clients = [];
  const { fetchImpl, calls } = fakeFetchRouter([
    {
      match: "/sessions/session-p/join",
      body: {
        session: { id: "session-p", allowParticipantDrawing: false },
        participant: { id: "guest-p", role: "editor" },
        state: createInitialBoardState("session-p"),
        realtimeTicket: "realtime-p",
      },
    },
    { match: "/sessions/session-p/state", body: { session: { id: "session-p", allowParticipantDrawing: true } } },
  ]);
  const seen = [];
  await startBoardSync(
    { apiBaseUrl: "https://api.test", ownerUserId: "guest", boardSessionId: "session-p", joinToken: "join-p" },
    { onRemoteEvent() {}, onSessionPermission: (allow) => seen.push(allow) },
    { fetchImpl, createClient: (options) => { const client = new FakeClient(options); clients.push(client); return client; }, ...noTimers },
  );
  clients[0].statusListener("connecting");
  clients[0].statusListener("connected");
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [true]);
  assert.match(calls.at(-1).url, /\/sessions\/session-p\/state\?ticket=realtime-p$/);
});

/** Routes by path; each answer can be a value or a function of the request body. */
function liveRouter(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    const route = Object.entries(routes).find(([suffix]) => path.endsWith(suffix)) ??
      // Every admission catches up first; by default there is nothing to miss.
      (path.endsWith("/events") ? ["/events", { body: { events: [], latestSequence: body.after } }] : null);
    if (!route) throw new Error(`no route for ${path}`);
    const answer = typeof route[1] === "function" ? await route[1](body) : route[1];
    const status = answer.status ?? 200;
    return { ok: status < 400, status, json: async () => answer.body };
  };
  return { fetchImpl, calls };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function liveEvent(sequence, id = `remote-${sequence}`) {
  return { id, boardSessionId: "s", actorParticipantId: "peer", createdAt: "t", type: "element.deleted", elementId: id, sequence };
}

async function joinLive({ routes, callbacks = {}, role = "editor", lastSequence = 5 }) {
  const clients = [];
  const timers = [];
  const remote = [];
  const statuses = [];
  const { fetchImpl, calls } = liveRouter({
    "/join": {
      body: {
        session: { id: "s" },
        participant: { id: "p", role },
        state: { ...createInitialBoardState("s"), lastSequence },
        realtimeTicket: "ticket-1",
        refreshToken: "refresh-1",
      },
    },
    ...routes,
  });
  const { handle } = await startBoardSync(
    { apiBaseUrl: "http://x", boardSessionId: "s", ownerUserId: "u", joinToken: "j" },
    { onRemoteEvent: (e) => remote.push(e), onStatus: (s) => statuses.push(s), ...callbacks },
    {
      fetchImpl,
      createClient: (o) => {
        const c = new FakeClient(o);
        clients.push(c);
        return c;
      },
      setTimer: (cb, ms) => {
        timers.push({ cb, ms });
        return timers.length;
      },
      clearTimer: () => {},
    },
  );
  return { handle, client: clients[0], timers, remote, statuses, calls };
}

test("after a reconnect the board applies what it missed in order, then live events, then its own held changes", async () => {
  let answerCatchUp;
  const live = await joinLive({
    routes: { "/events": () => new Promise((resolve) => (answerCatchUp = resolve)) },
  });
  const { client, remote, handle, calls } = live;
  client.statusListener("connected");
  client.statusListener("reconnecting");
  client.sendResult = false;
  // Made while the socket was away: held.
  const held = { id: "mine-1", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "mine" };
  assert.equal(handle.publish(held), true);

  client.sendResult = true;
  client.statusListener("connected");
  await flush();
  assert.deepEqual(calls.find((call) => call.path.endsWith("/events")).body, { realtimeTicket: "ticket-1", after: 5 });
  // Live events arrive before the catch-up answers: they wait.
  client.eventListener(liveEvent(8));
  client.eventListener(liveEvent(9));
  assert.equal(remote.length, 0);

  answerCatchUp({ body: { events: [liveEvent(6), liveEvent(7), liveEvent(8)], latestSequence: 8 } });
  await flush();
  assert.deepEqual(remote.map((e) => e.sequence), [6, 7, 8, 9], "in order, each once");
  assert.deepEqual(client.batches, [[held]], "held changes go out after the catch-up");
  // Our own change echoes back with its sequence and is not applied twice.
  client.eventListener({ ...held, sequence: 10 });
  assert.equal(remote.length, 4);
});

test("a guest far behind reloads the whole board after 20 pages; the owner always replays", async () => {
  // Each page answers one event while the session is far ahead.
  const pages = (body) => ({ body: { events: [liveEvent(body.after + 1)], latestSequence: 100_000 } });
  const resynced = [];
  const guest = await joinLive({
    routes: {
      "/events": pages,
      "/state": { body: { session: { id: "s" }, state: { ...createInitialBoardState("s"), lastSequence: 100_000, strokes: {} } } },
    },
    callbacks: { onResync: (state) => resynced.push(state) },
  });
  guest.client.sendResult = false;
  const held = { id: "mine-2", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "mine" };
  guest.handle.publish(held);
  guest.client.sendResult = true;
  guest.client.statusListener("connected");
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(guest.calls.filter((call) => call.path.endsWith("/events")).length, 20);
  assert.equal(resynced.length, 1);
  assert.equal("strokes" in resynced[0], false, "the reloaded board drops the API's strokes key");
  assert.equal(resynced[0].lastSequence, 100_000);
  guest.client.eventListener(liveEvent(99_999));
  assert.ok(!guest.remote.some((e) => e.sequence === 99_999), "already in the reloaded board");
  // The reloaded board lacks the held change, so its echo applies.
  guest.client.eventListener({ ...held, sequence: 100_001 });
  assert.equal(guest.remote.at(-1).id, "mine-2");

  // The owner never swaps their board for the session's: they page on to the end.
  let served = 0;
  const owner = await joinLive({
    role: "owner",
    routes: {
      "/events": (body) => {
        served += 1;
        return { body: { events: body.after < 30 ? [liveEvent(body.after + 1)] : [], latestSequence: 30 } };
      },
    },
    callbacks: { onResync: () => assert.fail("the owner's board is never replaced") },
  });
  owner.client.statusListener("connected");
  for (let i = 0; i < 10; i += 1) await flush();
  assert.equal(served, 25, "events 6 to 30, one page each");
  assert.deepEqual(owner.remote.map((e) => e.sequence), Array.from({ length: 25 }, (_, i) => i + 6));
});

test("the ticket is renewed every 20 minutes, the heartbeat recovers from an expired one, and an ended session stops", async () => {
  let ticketCount = 1;
  let heartbeatAnswer = { status: 401, body: { error: "REALTIME_TICKET_REQUIRED" } };
  const live = await joinLive({
    routes: {
      "/ticket": () => ({ body: { realtimeTicket: `ticket-${(ticketCount += 1)}`, expiresInSeconds: 1_800 } }),
      "/heartbeat": () => heartbeatAnswer,
    },
  });
  const { client, timers, calls, statuses, handle } = live;
  const heartbeat = timers.find((timer) => timer.ms === 30_000);
  const renewal = timers.find((timer) => timer.ms === 20 * 60_000);
  assert.ok(heartbeat && renewal);

  renewal.cb();
  await flush();
  assert.equal(client.ticket, "ticket-2", "the socket's next reconnect uses the fresh ticket");

  // A heartbeat refused for an expired ticket trades it in.
  heartbeat.cb();
  await flush();
  assert.equal(calls.filter((call) => call.path.endsWith("/heartbeat")).at(-1).body.realtimeTicket, "ticket-2");
  assert.equal(client.ticket, "ticket-3");

  heartbeatAnswer = { body: { session: { id: "s", status: "ended" } } };
  heartbeat.cb();
  await flush();
  assert.equal(statuses.at(-1), "ended");
  assert.equal(client.closed, true);
  assert.equal(handle.publish(liveEvent(1, "after-end")), false);
});

test("a guest refused because the session is over is told it ended; a lock only pauses; the owner revives it", async () => {
  const guest = await joinLive({ routes: {} });
  guest.client.rejectionListener({ kind: "connection_error", reason: "SESSION_NOT_JOINABLE" });
  assert.equal(guest.statuses.at(-1), "ended");

  const waiting = await joinLive({ routes: {} });
  waiting.client.rejectionListener({ kind: "connection_error", reason: "SESSION_LOCKED" });
  waiting.client.statusListener("rejected");
  assert.equal(waiting.statuses.at(-1), "paused", "not ended: the owner may come back");

  const owner = await joinLive({
    role: "owner",
    routes: { "/ticket": { body: { realtimeTicket: "ticket-2", expiresInSeconds: 1_800 } } },
  });
  const connectsBefore = owner.client.connects;
  owner.client.rejectionListener({ kind: "connection_error", reason: "SESSION_LOCKED" });
  await flush();
  assert.equal(owner.client.connects, connectsBefore + 1, "reconnects once the session is revived");
  assert.notEqual(owner.statuses.at(-1), "ended");
});

test("live events from another API instance can arrive out of order, and none is dropped", async () => {
  const live = await joinLive({ routes: {} });
  live.client.statusListener("connected");
  await flush();
  live.client.eventListener(liveEvent(7));
  assert.deepEqual(live.remote, [], "7 waits for 6");
  live.client.eventListener(liveEvent(6));
  live.client.eventListener(liveEvent(7));
  assert.deepEqual(live.remote.map((e) => e.sequence), [6, 7], "in order; the duplicate doesn't apply");
});

test("a failed catch-up keeps holding live events and tries again; an older API without the route is tolerated", async () => {
  let failures = 1;
  const flaky = await joinLive({
    routes: {
      "/events": (body) =>
        failures-- > 0
          ? { status: 503, body: { error: "SESSION_LOOKUP_FAILED" } }
          : { body: { events: [liveEvent(body.after + 1)], latestSequence: 6 } },
    },
  });
  flaky.client.statusListener("connected");
  await flush();
  flaky.client.eventListener(liveEvent(7));
  assert.equal(flaky.remote.length, 0, "held while the gap is unfilled");
  const retry = flaky.timers.find((timer) => timer.ms === 1_000);
  assert.ok(retry, "a retry is scheduled");
  retry.cb();
  await flush();
  assert.deepEqual(flaky.remote.map((e) => e.sequence), [6, 7]);

  // An API from before this change answers its generic 404.
  const old = await joinLive({
    routes: {
      "/events": { status: 404, body: { message: "Route POST:/sessions/s/events not found", error: "Not Found", statusCode: 404 } },
      "/ticket": { status: 404, body: { message: "Route POST:/sessions/s/ticket not found", error: "Not Found", statusCode: 404 } },
    },
  });
  old.client.statusListener("connected");
  await flush();
  old.client.eventListener(liveEvent(8));
  assert.deepEqual(old.remote.map((e) => e.sequence), [8], "nothing waits for events an older API can't send");
  old.timers.find((timer) => timer.ms === 20 * 60_000).cb();
  await flush();
  assert.notEqual(old.statuses.at(-1), "ended", "a missing refresh route doesn't end the session");
});

test("a locked session pauses a guest's changes, which go out when the owner is back", async () => {
  let session = "locked";
  const live = await joinLive({ routes: { "/heartbeat": () => ({ body: { session: { id: "s", status: session } } }) } });
  live.client.statusListener("connected");
  const heartbeat = live.timers.find((timer) => timer.ms === 30_000);
  heartbeat.cb();
  await flush();
  assert.equal(live.statuses.at(-1), "paused");
  const change = { id: "mine-3", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "mine" };
  assert.equal(live.handle.publish(change), true);
  assert.equal(live.client.batches.length, 0, "held while locked");

  session = "active";
  heartbeat.cb();
  await flush();
  assert.equal(live.statuses.at(-1), "connected");
  assert.deepEqual(live.client.batches, [[change]]);
});

test("the owner's guest-editing switch made while reconnecting isn't undone by the session's older answer", async () => {
  const permissions = [];
  const live = await joinLive({
    role: "owner",
    routes: {
      "/events": { body: { events: [], latestSequence: 5 } },
      "/state": { body: { session: { id: "s", allowParticipantDrawing: false } } },
    },
    callbacks: { onSessionPermission: (allow) => permissions.push(allow) },
  });
  live.client.statusListener("connected");
  await flush();
  permissions.length = 0;
  live.client.statusListener("reconnecting");
  live.client.sendResult = false;
  live.handle.publish({ id: "perm-1", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "permission.changed", allowParticipantDrawing: true });
  live.client.sendResult = true;
  live.client.statusListener("connected");
  await flush();
  assert.deepEqual(permissions, [], "the switch stays as the owner set it");
  assert.equal(live.client.batches.at(-1)[0].id, "perm-1");
});

test("a change sent just before the connection was cut is sent again, unless the server got it", async () => {
  const stored = [];
  const live = await joinLive({
    routes: { "/events": (body) => ({ body: { events: stored.filter((e) => e.sequence > body.after), latestSequence: 5 + stored.length } }) },
  });
  live.client.statusListener("connected");
  await flush();
  const lost = { id: "lost-1", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "a" };
  const kept = { id: "kept-1", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "b" };
  assert.equal(live.handle.publish(kept), true);
  assert.equal(live.handle.publish(lost), true);
  // The server stored "kept" (sequence 6) but the cut lost "lost"; neither echo arrived.
  stored.push({ ...kept, sequence: 6 });
  live.client.statusListener("reconnecting");
  live.client.statusListener("connected");
  await flush();
  assert.deepEqual(live.client.batches.map((batch) => batch.map((e) => e.id)), [["kept-1"], ["lost-1"], ["lost-1"]]);
  assert.equal(live.remote.length, 0, "our own stored change isn't applied twice");
});

test("the first connection catches up on changes made between joining and being admitted", async () => {
  const live = await joinLive({
    routes: { "/events": (body) => ({ body: { events: body.after === 5 ? [liveEvent(6)] : [], latestSequence: 6 } }) },
  });
  live.client.statusListener("connected");
  await flush();
  assert.deepEqual(live.remote.map((e) => e.sequence), [6]);
});

test("a page the API no longer accepts stops for a reload instead of retrying", async () => {
  const live = await joinLive({ routes: {} });
  live.client.rejectionListener({ kind: "connection_error", reason: "UPGRADE_REQUIRED" });
  live.client.statusListener("rejected");
  assert.equal(live.statuses.at(-1), "outdated");
  assert.equal(live.handle.publish(liveEvent(1, "after")), false);
});

test("a guest's renewal during a lock pauses instead of retrying an expired ticket in a loop", async () => {
  const live = await joinLive({
    routes: { "/ticket": { status: 409, body: { error: "SESSION_LOCKED" } } },
  });
  const ticket = await live.client.options.refreshTicket();
  assert.equal(ticket, null, "the socket stops and waits");
  assert.equal(live.statuses.at(-1), "paused");
  assert.equal(live.calls.filter((call) => call.path.endsWith("/ticket")).at(-1).body.refreshToken, "refresh-1");
});

test("a batch the server refused is not replayed after a later reconnect", async () => {
  const live = await joinLive({ routes: {} });
  live.client.statusListener("connected");
  await flush();
  const refused = { id: "refused-1", boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: "a" };
  live.handle.publish(refused);
  live.client.rejectionListener({ kind: "event_rejected", reason: "RATE_LIMITED", eventId: "refused-1" });
  live.client.statusListener("reconnecting");
  live.client.statusListener("connected");
  await flush();
  assert.deepEqual(live.client.batches.map((batch) => batch.map((e) => e.id)), [["refused-1"]], "sent once, never again");
});

test("a full outbox refuses new changes instead of dropping held ones", async () => {
  const live = await joinLive({ routes: {} });
  live.client.sendResult = false;
  const change = (n) => ({ id: `held-${n}`, boardSessionId: "s", actorParticipantId: "p", createdAt: "t", type: "element.deleted", elementId: `e${n}` });
  assert.equal(live.handle.publish(Array.from({ length: 5_000 }, (_, n) => change(n))), true);
  assert.equal(live.handle.publish(change(5_000)), false, "no room: the caller learns it didn't go");
  live.client.sendResult = true;
  live.client.statusListener("connected");
  await flush();
  const sent = live.client.batches.flat().map((e) => e.id);
  assert.equal(sent.length, 5_000);
  assert.equal(sent[0], "held-0", "the oldest held change is kept");
});

test("when catch-up keeps failing, changes waiting behind the gap are applied rather than held forever", async () => {
  const live = await joinLive({ routes: { "/events": { status: 503, body: { error: "SESSION_LOOKUP_FAILED" } } } });
  live.client.statusListener("connected");
  await flush();
  live.client.eventListener(liveEvent(7));
  assert.equal(live.remote.length, 0);
  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
    const retry = live.timers.findLast((timer) => timer.ms === delay);
    assert.ok(retry, `retry after ${delay} ms`);
    retry.cb();
    await flush();
  }
  assert.deepEqual(live.remote.map((e) => e.sequence), [7]);
});
