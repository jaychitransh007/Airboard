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

const { createEventEnvelope } = await import("@airboard/core");
const { loadConfig } = await import("../src/config.ts");
const { buildServer } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
const { issueSignedToken } = await import("../src/signedTokens.ts");

// Shape-merge phase 3: only scene version 3 connects; older tabs are told to
// upgrade, nobody can write a stroke.* event, and state carries no strokes.
async function startServer(t) {
  const config = loadConfig({ NODE_ENV: "test", AIRBOARD_LOCAL_ENTITLEMENTS: "true" });
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

function open(port, ticket, sceneVersion) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${sceneVersion}`);
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  socket.on("error", () => undefined);
  const closed = new Promise((resolve) => socket.on("close", (code) => resolve(code)));
  return { socket, messages, closed };
}

const waitFor = async (predicate) => {
  for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("/state carries no legacy strokes map", async (t) => {
  const { port, session, ticket } = await startServer(t);
  const response = await fetch(`http://127.0.0.1:${port}/sessions/${session.id}/state?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal("strokes" in body.state, false);
  assert.equal(typeof body.state.elements, "object");
});

test("only scene version 3 connects, older tabs are told to upgrade, and stroke writes are refused", async (t) => {
  const { port, session, ownerParticipant, ticket } = await startServer(t);
  const client = open(port, ticket, "3");
  await waitFor(() => client.messages.some((m) => m.type === "board.initialized"));
  assert.ok(client.messages.some((m) => m.type === "board.initialized"));
  client.socket.send(JSON.stringify({
    type: "board.event",
    event: {
      ...createEventEnvelope({ boardSessionId: session.id, actorParticipantId: ownerParticipant.id }),
      type: "stroke.committed",
      strokeId: "stroke-1",
    },
  }));
  await waitFor(() => client.messages.some((m) => m.type === "event.rejected"));
  assert.equal(client.messages.find((m) => m.type === "event.rejected")?.reason, "LEGACY_EVENT_RETIRED");
  client.socket.close();
  await client.closed;
  for (const version of ["2", "1"]) {
    const stale = open(port, ticket, version);
    assert.equal(await stale.closed, 1008, `scene version ${version}`);
    assert.ok(stale.messages.some((m) => m.reason === "UPGRADE_REQUIRED"));
  }
});
