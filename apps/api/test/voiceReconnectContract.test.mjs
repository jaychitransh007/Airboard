import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
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

const { loadTranscriptionConfig } = await import("../src/config.ts");
const { registerTranscriptionRoutes } = await import("../src/transcription/routes.ts");
const { SERVICE_RESTART_CLOSE_CODE } = await import("../src/shutdown.ts");
// The browser's voice client, run against the real API routes.
const { createRealtimeSpeechSession } = await import("../../web/src/features/board/realtimeSpeech.ts");

const origin = "https://airboard.test";

test("the board's voice survives the stream time limit and a server restart against the real API", { timeout: 10_000 }, async (t) => {
  let audioFrames = 0;
  const provider = {
    id: "fake",
    async open(_options, onEvent) {
      const stopped = () => onEvent({ type: "status", status: "stopped" });
      return {
        sendAudio() {
          audioFrames += 1;
        },
        updateKeyterms() {},
        stop: stopped,
        abort: stopped,
      };
    },
  };
  const config = {
    allowedOrigins: [origin],
    localEntitlements: true,
    sessionSigningSecret: "test-session-signing-secret-at-least-32-bytes",
    transcription: { ...loadTranscriptionConfig({}), maxSessionMs: 300 },
  };
  const server = Fastify();
  t.after(() => server.close());
  await server.register(websocket);
  registerTranscriptionRoutes(server, config, undefined, { provider });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.server.address();

  const events = [];
  const waiters = [];
  const record = (event) => {
    events.push(event);
    for (const waiter of [...waiters]) waiter();
  };
  const waitFor = (name) =>
    new Promise((resolve) => {
      const start = events.length;
      const check = () => {
        if (!events.slice(start).some(([eventName]) => eventName === name)) return false;
        waiters.splice(waiters.indexOf(check), 1);
        resolve();
        return true;
      };
      waiters.push(check);
    });
  let pushPcm = null;
  const session = createRealtimeSpeechSession(
    {
      onReady: () => record(["ready"]),
      onReconnecting: (cause) => record(["reconnecting", cause]),
      onReconnected: () => record(["reconnected"]),
      onListening: (listening) => record(["listening", listening]),
      onFinal() {},
      onError: (message, code) => record(["error", code, message]),
      onEnd: (reason) => record(["end", reason]),
    },
    { url: `ws://127.0.0.1:${port}/transcription/ws`, reconnect: true },
    {
      createWebSocket: (url) => new WebSocket(url, { headers: { origin } }),
      startPcmInput: async ({ onChunk }) => {
        pushPcm = () => onChunk(new Float32Array(1_280), 16_000);
        return { stop() {} };
      },
    },
  );

  const ready = waitFor("ready");
  session.start();
  await ready;
  assert.equal(session.isListening(), true);

  // The 300 ms stream limit ends the stream; the client rolls over at once.
  const rolledOver = waitFor("reconnected");
  await rolledOver;
  assert.ok(events.some(([name, cause]) => name === "reconnecting" && cause === "rollover"));
  config.transcription.maxSessionMs = 60_000;

  // A deploy: the API closes every socket with 1012, as on SIGTERM.
  const restarted = waitFor("reconnected");
  for (const client of server.websocketServer.clients) client.close(SERVICE_RESTART_CLOSE_CODE, "SERVICE_RESTART");
  await restarted;
  assert.ok(events.some(([name, cause]) => name === "reconnecting" && cause === "dropped"));
  assert.equal(session.isListening(), true);

  // Audio reaches the replacement stream.
  const before = audioFrames;
  pushPcm();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(audioFrames > before);
  assert.equal(events.some(([name]) => name === "error" || name === "end"), false);

  const ended = waitFor("end");
  session.stop();
  await ended;
  assert.deepEqual(events.at(-1), ["end", "stopped"]);
});
