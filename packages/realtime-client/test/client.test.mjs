import assert from "node:assert/strict";
import test from "node:test";

import { AirboardRealtimeClient } from "../src/client.ts";

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this.closed = false;
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  message(payload) {
    this.emit("message", { data: JSON.stringify(payload) });
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code) {
    this.closed = true;
    this.readyState = 3;
  }
}

function makeClient(overrides = {}) {
  const sockets = [];
  const timers = [];
  const client = new AirboardRealtimeClient(
    {
      url: "ws://127.0.0.1:4000/ws",
      boardSessionId: "session-1",
      participantId: "participant-1",
      ...overrides,
    },
    {
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      setTimer: (cb, ms) => {
        timers.push({ cb, ms });
        return timers.length;
      },
      clearTimer: () => {},
    },
  );
  return { client, sockets, timers };
}

test("connects with session/participant query params and receives events", () => {
  const { client, sockets } = makeClient();
  const statuses = [];
  const events = [];
  client.onStatus((s) => statuses.push(s));
  client.onEvent((e) => events.push(e));
  client.connect();

  const socket = sockets[0];
  assert.ok(socket.url.includes("boardSessionId=session-1"));
  assert.ok(socket.url.includes("participantId=participant-1"));
  socket.open();
  socket.message({ type: "board.event", event: { id: "e1", type: "cursor.moved" } });
  assert.deepEqual(statuses, ["connecting", "connected"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "e1");
});

test("send returns false while disconnected — callers know the event dropped", () => {
  const { client, sockets } = makeClient();
  client.connect();
  assert.equal(client.sendEvent({ id: "e1" }), false, "not open yet");
  sockets[0].open();
  assert.equal(client.sendEvent({ id: "e1" }), true);
  assert.equal(client.sendEvents([{ id: "e2" }, { id: "e3" }]), true);
  assert.deepEqual(sockets[0].sent[1], {
    type: "board.events",
    events: [{ id: "e2" }, { id: "e3" }],
  });
});

test("surfaces event.rejected and event.append_failed to listeners", () => {
  const { client, sockets } = makeClient();
  const rejections = [];
  client.onRejection((r) => rejections.push(r));
  client.connect();
  sockets[0].open();
  sockets[0].message({ type: "event.rejected", reason: "NOT_ALLOWED_TO_DRAW", eventId: "e9" });
  sockets[0].message({ type: "event.append_failed", reason: "STORE_DOWN", eventIds: ["a", "b"] });
  assert.deepEqual(rejections, [
    { kind: "event_rejected", reason: "NOT_ALLOWED_TO_DRAW", eventId: "e9" },
    { kind: "append_failed", reason: "STORE_DOWN", eventIds: ["a", "b"] },
  ]);
});

test("a server error frame + 1008 close is terminal: no reconnection", () => {
  const { client, sockets, timers } = makeClient();
  const statuses = [];
  const rejections = [];
  client.onStatus((s) => statuses.push(s));
  client.onRejection((r) => rejections.push(r));
  client.connect();
  sockets[0].open();
  sockets[0].message({ type: "error", reason: "SESSION_NOT_JOINABLE" });
  sockets[0].emit("close", { code: 1008 });
  assert.equal(statuses.at(-1), "rejected");
  assert.equal(rejections[0].kind, "connection_error");
  assert.equal(timers.length, 0, "no reconnect timer scheduled");
});

test("transient closes reconnect with backoff; close() cancels reconnection", () => {
  const { client, sockets, timers } = makeClient();
  client.connect();
  sockets[0].open();
  sockets[0].emit("close", { code: 1006 });
  assert.equal(timers.length, 1, "reconnect scheduled");
  assert.equal(timers[0].ms, 1000);

  // Manual close before the timer fires: firing must not reconnect.
  client.close();
  timers[0].cb();
  assert.equal(sockets.length, 1, "no new socket after manual close");
});

test("reconnect: false disables retry entirely", () => {
  const { client, sockets, timers } = makeClient({ reconnect: false });
  client.connect();
  sockets[0].open();
  sockets[0].emit("close", { code: 1006 });
  assert.equal(timers.length, 0);
});
