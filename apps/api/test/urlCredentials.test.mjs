// The operator API token is read only from the Authorization header, never
// from the URL, where Cloud Run's request log would keep it for 30 days
// (Threat Model I-5). These tests cover every surface that accepts it.
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
      const candidates = [
        new URL(`${specifier}.ts`, context.parentURL),
        ...(specifier.endsWith(".js")
          ? [new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)]
          : []),
      ];
      for (const candidate of candidates) {
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { loadTranscriptionConfig } = await import("../src/config.ts");
const { registerSemanticIntentRoutes } = await import("../src/semanticIntent/routes.ts");
const { registerTranscriptionRoutes } = await import("../src/transcription/routes.ts");
const { registerVoiceTraceRoutes } = await import("../src/voiceTrace/routes.ts");

const origin = "https://airboard.test";
const operatorToken = "operator-secret";
const queryForms = [`?token=${operatorToken}`, `?access_token=${operatorToken}`];

// Nobody is signed in: only the operator token can let a request through.
const noSignIn = {
  client: null,
  async authenticate() {
    return null;
  },
  async activeEntitlement() {
    return null;
  },
};

function productionConfig() {
  return {
    allowedOrigins: [origin],
    sessionSigningSecret: "test-session-signing-secret-at-least-32-bytes",
    localEntitlements: false,
    apiToken: operatorToken,
    trustedProxyHops: 1,
    rateLimits: { intentPerMinute: 100, voiceTracePerMinute: 100 },
    semanticIntent: {
      provider: "disabled",
      defaultModel: "gpt-5.6-terra",
      allowedModels: ["gpt-5.6-terra"],
      endpoint: "https://provider.invalid/v1/responses",
      reasoningEffort: "none",
      timeoutMs: 5_000,
      maxConcurrentRequests: 8,
      maxTranscriptCharacters: 500,
    },
    transcription: {
      ...loadTranscriptionConfig({}),
      maxConcurrentStreams: 10,
      maxStreamsPerProfile: 2,
    },
  };
}

const intentBody = () => ({
  voiceTurnId: `voice-turn-${crypto.randomUUID()}`,
  transcript: "Planner gets additional context from Golden Dataset and Historical Dataset.",
  parserIssue: "unknown_command",
  context: {
    selectionCount: 0,
    selected: [],
    objects: [
      { label: "Golden Dataset", nodeType: "database", ordinal: 1, selected: false },
      { label: "Historical Dataset", nodeType: "database", ordinal: 2, selected: false },
      { label: "Planner", nodeType: "process", ordinal: 1, selected: false },
    ],
    edges: [],
    projectGlossary: [],
    pointerAvailable: false,
  },
});

const traceBody = () => ({
  voiceTurnId: `voice-turn-${crypto.randomUUID().slice(0, 8)}`,
  stage: "stt_final",
  data: {},
});

const fakeProvider = {
  id: "fake",
  async open(_options, onEvent) {
    const stopped = () => onEvent({ type: "status", status: "stopped" });
    return { sendAudio() {}, updateKeyterms() {}, stop: stopped, abort: stopped };
  },
};

async function startServer(t) {
  const server = Fastify({ logger: false });
  t.after(() => server.close());
  await server.register(websocket);
  const config = productionConfig();
  registerSemanticIntentRoutes(server, config, undefined, noSignIn);
  registerVoiceTraceRoutes(server, config, undefined, noSignIn);
  registerTranscriptionRoutes(server, config, noSignIn, { provider: fakeProvider });
  await server.listen({ port: 0, host: "127.0.0.1" });
  return { server, port: server.server.address().port };
}

const bearer = { authorization: `Bearer ${operatorToken}` };

test("POST /intent/resolve refuses the operator token in the URL and accepts it as a Bearer header", async (t) => {
  const { server } = await startServer(t);
  for (const query of queryForms) {
    const refused = await server.inject({
      method: "POST",
      url: `/intent/resolve${query}`,
      headers: { origin },
      payload: intentBody(),
    });
    assert.equal(refused.statusCode, 401, query);
    assert.equal(refused.json().error, "AUTH_REQUIRED");
  }
  const accepted = await server.inject({
    method: "POST",
    url: "/intent/resolve",
    headers: { origin, ...bearer },
    payload: intentBody(),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
});

test("POST /voice/trace refuses the operator token in the URL and accepts it as a Bearer header", async (t) => {
  const { server } = await startServer(t);
  for (const query of queryForms) {
    const refused = await server.inject({
      method: "POST",
      url: `/voice/trace${query}`,
      headers: { origin },
      payload: traceBody(),
    });
    assert.equal(refused.statusCode, 401, query);
    assert.equal(refused.json().error, "AUTH_REQUIRED");
  }
  const accepted = await server.inject({
    method: "POST",
    url: "/voice/trace",
    headers: { origin, ...bearer },
    payload: traceBody(),
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
});

test("POST /transcription/ticket refuses the operator token in the URL and accepts it as a Bearer header", async (t) => {
  const { server } = await startServer(t);
  for (const query of queryForms) {
    const refused = await server.inject({
      method: "POST",
      url: `/transcription/ticket${query}`,
      headers: { origin },
    });
    assert.equal(refused.statusCode, 401, query);
  }
  const accepted = await server.inject({
    method: "POST",
    url: "/transcription/ticket",
    headers: { origin, ...bearer },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(typeof accepted.json().ticket, "string");
});

function openSocket(url, headers = {}) {
  const socket = new WebSocket(url, { headers: { origin, ...headers } });
  socket.on("error", () => undefined);
  const closed = new Promise((resolve) => {
    socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  const ready = new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "transcription.ready") resolve(message);
    });
    closed.then((result) => reject(new Error(`socket closed before ready: ${JSON.stringify(result)}`)));
  });
  socket.once("open", () =>
    socket.send(JSON.stringify({ type: "transcription.start", sampleRate: 16000 })),
  );
  return { socket, closed, ready };
}

test("WS /transcription/ws refuses the operator token in the URL and accepts it as a Bearer header", { timeout: 5_000 }, async (t) => {
  const { port } = await startServer(t);
  const base = `ws://127.0.0.1:${port}/transcription/ws`;
  for (const query of queryForms) {
    const refused = openSocket(`${base}${query}`);
    refused.ready.catch(() => undefined);
    assert.deepEqual(await refused.closed, { code: 1008, reason: "Airboard authentication required" }, query);
  }
  const accepted = openSocket(base, bearer);
  assert.equal((await accepted.ready).provider, "fake");
  accepted.socket.close();
  await accepted.closed;
});
