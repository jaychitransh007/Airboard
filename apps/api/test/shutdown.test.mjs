import assert from "node:assert/strict";
import test from "node:test";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket from "ws";

import { registerCrashHandlers, registerGracefulShutdown, SERVICE_RESTART_CLOSE_CODE } from "../src/shutdown.ts";

test("on SIGTERM, open board sockets are told to reconnect and the process exits cleanly", async (t) => {
  const server = Fastify();
  await server.register(websocket);
  server.get("/ws", { websocket: true }, () => {
    // Keep the socket open, like a live board.
  });
  server.get("/health", async () => ({ ok: true }));
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close().catch(() => undefined));

  const signals = new Map();
  const exits = [];
  const shutdown = registerGracefulShutdown(server, {
    graceMs: 2_000,
    exit: (code) => exits.push(code),
    onSignal: (signal, handler) => signals.set(signal, handler),
  });
  assert.deepEqual([...signals.keys()].sort(), ["SIGINT", "SIGTERM"]);

  const { port } = server.server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));

  await shutdown("SIGTERM");
  assert.equal(await closed, SERVICE_RESTART_CLOSE_CODE);
  assert.deepEqual(exits, [0]);

  // A second signal while shutting down does nothing more.
  await shutdown("SIGINT");
  assert.deepEqual(exits, [0]);
});

test("an unhandled error is logged and shuts the process down with a failure code", async () => {
  const server = Fastify();
  const logged = [];
  server.log.fatal = (details, message) => logged.push([details.event, message]);
  const handlers = new Map();
  const shutdowns = [];
  registerCrashHandlers(server, async (signal, code) => shutdowns.push([signal, code]), (event, handler) => handlers.set(event, handler));
  assert.deepEqual([...handlers.keys()].sort(), ["uncaughtException", "unhandledRejection"]);

  handlers.get("unhandledRejection")(new Error("lost promise"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logged, [["unhandledRejection", "unhandled error; shutting down"]]);
  assert.deepEqual(shutdowns, [["SIGTERM", 1]]);
});

