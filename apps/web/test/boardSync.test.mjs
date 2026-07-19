import assert from "node:assert/strict";
import test from "node:test";

import { createInitialBoardState, applyBoardEvent, createEventEnvelope } from "@airboard/core";
import {
  buildBoardWebSocketUrl,
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
  onStatus() {
    return () => {};
  }
  onRejection() {
    return () => {};
  }
}

function fakeFetchRouter(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
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
  const mine = { id: "evt-1", type: "stroke.deleted", strokeIds: ["s1"] };
  const theirs = { id: "evt-2", type: "stroke.deleted", strokeIds: ["s2"] };
  handle.publish(mine);
  clients[0].eventListener({ ...mine, sequence: 7 }); // server echo
  clients[0].eventListener(theirs);
  assert.deepEqual(
    remote.map((e) => e.id),
    ["evt-2"],
    "echo dropped, peer event delivered",
  );
});

test("publish reports drops while disconnected and does not poison echo dedup", async () => {
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
  const dropped = { id: "evt-9", type: "stroke.deleted", strokeIds: ["x"] };
  assert.equal(handle.publish(dropped), false);
  // If the same id later arrives from a peer (e.g. we resent after reconnect
  // and a peer relayed), it must not be swallowed as an echo.
  clients[0].eventListener(dropped);
  assert.equal(remote.length, 1);
});

test("snapshotBoardEvents seeds committed objects re-addressed to the session", () => {
  let state = createInitialBoardState("local-board");
  const stroke = {
    id: "s1",
    boardId: "local-board",
    userId: "u",
    color: "#000",
    thickness: 2,
    status: "active",
    points: [{ x: 0, y: 0, t: 0 }],
    createdAt: new Date().toISOString(),
  };
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "local-board", actorParticipantId: "p" }),
    type: "stroke.started",
    stroke,
  });
  state = applyBoardEvent(state, {
    ...createEventEnvelope({ boardSessionId: "local-board", actorParticipantId: "p" }),
    type: "stroke.committed",
    strokeId: "s1",
    points: [{ x: 0, y: 0, t: 0 }],
  });

  const events = snapshotBoardEvents(state, {
    boardSessionId: "server-session",
    actorParticipantId: "owner-p",
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "stroke.started");
  assert.equal(events[0].stroke.boardId, "server-session");
  assert.equal(events[0].boardSessionId, "server-session");
  assert.equal(events[1].type, "stroke.committed");
  assert.equal(events[1].strokeId, "s1");
});

test("buildBoardWebSocketUrl maps http(s) to ws(s)", () => {
  assert.equal(buildBoardWebSocketUrl("http://127.0.0.1:4600"), "ws://127.0.0.1:4600/ws");
  assert.equal(buildBoardWebSocketUrl("https://api.airboard.app/x?y=1"), "wss://api.airboard.app/ws");
});
