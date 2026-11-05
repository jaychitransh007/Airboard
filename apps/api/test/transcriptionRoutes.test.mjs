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

const origin = "https://airboard.test";

function fakeAuth({ entitledOrganizations = [], failWith } = {}) {
  return {
    async authenticate(request) {
      if (failWith) throw failWith;
      const header = request.headers.authorization;
      const match = typeof header === "string" ? /^Bearer user:(.+)$/.exec(header) : null;
      if (!match) return null;
      return {
        authUserId: match[1],
        profileId: `profile-${match[1]}`,
        organizationId: `org-${match[1]}`,
        role: "owner",
        email: null,
        displayName: match[1],
        tokenKind: "supabase",
      };
    },
    async activeEntitlement(organizationId) {
      return entitledOrganizations.includes(organizationId) ? { status: "active" } : null;
    },
  };
}

// Opens instantly and reports "stopped" when stopped or aborted, like Flux.
const fakeProvider = {
  id: "fake",
  async open(_options, onEvent) {
    const stopped = () => onEvent({ type: "status", status: "stopped" });
    return { sendAudio() {}, updateKeyterms() {}, stop: stopped, abort: stopped };
  },
};

async function startServer(t, { auth, transcription = {}, provider = fakeProvider } = {}) {
  const server = Fastify();
  t.after(() => server.close());
  await server.register(websocket);
  registerTranscriptionRoutes(
    server,
    {
      allowedOrigins: [origin],
      localEntitlements: false,
      apiToken: "operator-secret",
      sessionSigningSecret: "test-session-signing-secret-at-least-32-bytes",
      transcription: {
        ...loadTranscriptionConfig({}),
        maxConcurrentStreams: 10,
        maxStreamsPerProfile: 2,
        ...transcription,
      },
    },
    auth,
    { provider },
  );
  await server.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.server.address();
  return `ws://127.0.0.1:${port}/transcription/ws`;
}

function connect(url, user) {
  const socket = new WebSocket(url, {
    headers: { origin, ...(user ? { authorization: `Bearer user:${user}` } : {}) },
  });
  const messages = [];
  const waiters = [];
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
    for (const waiter of [...waiters]) waiter();
  });
  const closed = new Promise((resolve) => {
    socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  socket.on("error", () => undefined);
  const nextMessage = (type) =>
    new Promise((resolve, reject) => {
      const check = () => {
        const index = messages.findIndex((message) => message.type === type);
        if (index < 0) return false;
        waiters.splice(waiters.indexOf(check), 1);
        resolve(messages.splice(index, 1)[0]);
        return true;
      };
      waiters.push(check);
      if (check()) return;
      closed.then(() => reject(new Error(`socket closed before ${type}`)));
    });
  const start = () => {
    const send = () => socket.send(JSON.stringify({ type: "transcription.start", sampleRate: 16000 }));
    if (socket.readyState === WebSocket.OPEN) send();
    else socket.once("open", send);
  };
  return { socket, closed, nextMessage, start };
}

test("transcription sockets close with ACTIVE_ENTITLEMENT_REQUIRED for unentitled accounts", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, { auth: fakeAuth({ entitledOrganizations: ["org-paid"] }) });

  const anonymous = connect(url);
  assert.deepEqual(await anonymous.closed, { code: 1008, reason: "Airboard authentication required" });

  const fresh = connect(url, "fresh");
  fresh.start();
  assert.deepEqual(await fresh.closed, { code: 1008, reason: "ACTIVE_ENTITLEMENT_REQUIRED" });

  const paid = connect(url, "paid");
  paid.start();
  assert.equal((await paid.nextMessage("transcription.ready")).provider, "fake");
  paid.socket.close();
});

test("a failed authorization lookup closes with a retryable server code", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, { auth: fakeAuth({ failWith: new Error("PROFILE_LOOKUP_FAILED") }) });
  const client = connect(url, "paid");
  assert.deepEqual(await client.closed, { code: 1011, reason: "AUTHORIZATION_UNAVAILABLE" });
});

test("one account cannot hold more than its per-profile share of streams", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a", "org-b"] }),
  });
  const first = connect(url, "a");
  const second = connect(url, "a");
  first.start();
  second.start();
  await first.nextMessage("transcription.ready");
  await second.nextMessage("transcription.ready");

  const third = connect(url, "a");
  third.start();
  const refused = await third.nextMessage("transcription.error");
  assert.equal(refused.code, "TRANSCRIPTION_PROFILE_LIMIT");
  assert.equal(refused.fatal, true);

  // Other accounts still get the remaining global capacity.
  const other = connect(url, "b");
  other.start();
  await other.nextMessage("transcription.ready");

  // Closing a socket returns its slot to the account.
  first.socket.close();
  await first.closed;
  const retry = connect(url, "a");
  retry.start();
  await retry.nextMessage("transcription.ready");

  for (const client of [second, third, other, retry]) client.socket.close();
});

test("the global stream cap still answers with the capacity code", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a", "org-b"] }),
    transcription: { maxConcurrentStreams: 1 },
  });
  const holder = connect(url, "a");
  holder.start();
  await holder.nextMessage("transcription.ready");
  const blocked = connect(url, "b");
  blocked.start();
  assert.equal((await blocked.nextMessage("transcription.error")).code, "TRANSCRIPTION_CAPACITY_REACHED");
  holder.socket.close();
  blocked.socket.close();
});

test("a one-minute ticket opens the socket, so the sign-in token never goes in a URL", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, { auth: fakeAuth({ entitledOrganizations: ["org-paid"] }) });
  const api = url.replace("ws://", "http://").replace("/transcription/ws", "");
  const ticketFor = (user) =>
    fetch(`${api}/transcription/ticket`, {
      method: "POST",
      headers: user ? { authorization: `Bearer user:${user}` } : {},
    });

  // No ticket without a signed-in, entitled account.
  assert.equal((await ticketFor()).status, 401);
  const unentitled = await ticketFor("fresh");
  assert.equal(unentitled.status, 403);
  assert.equal((await unentitled.json()).error, "ACTIVE_ENTITLEMENT_REQUIRED");

  const issued = await (await ticketFor("paid")).json();
  assert.equal(issued.expiresInSeconds, 60);
  const withTicket = connect(`${url}?ticket=${encodeURIComponent(issued.ticket)}`);
  withTicket.start();
  assert.equal((await withTicket.nextMessage("transcription.ready")).provider, "fake");

  // A forged ticket is refused like a missing sign-in.
  const forged = connect(`${url}?ticket=forged.ticket`);
  assert.deepEqual(await forged.closed, { code: 1008, reason: "Airboard authentication required" });

  // Tickets still count against the account's stream share.
  const second = connect(`${url}?ticket=${encodeURIComponent((await (await ticketFor("paid")).json()).ticket)}`);
  second.start();
  await second.nextMessage("transcription.ready");
  const third = connect(`${url}?ticket=${encodeURIComponent((await (await ticketFor("paid")).json()).ticket)}`);
  third.start();
  assert.equal((await third.nextMessage("transcription.error")).code, "TRANSCRIPTION_PROFILE_LIMIT");
  for (const client of [withTicket, second, third]) client.socket.close();
});

test("repeated provider failures make later starts fail fast", { timeout: 5_000 }, async (t) => {
  let opens = 0;
  const downProvider = {
    id: "down",
    async open() {
      opens += 1;
      throw new Error("Deepgram unreachable");
    },
  };
  const url = await startServer(t, { auth: fakeAuth({ entitledOrganizations: ["org-a"] }), provider: downProvider });
  const startOnce = async () => {
    const client = connect(url, "a");
    client.start();
    const error = await client.nextMessage("transcription.error");
    client.socket.close();
    return error;
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await startOnce()).message, "Deepgram unreachable");
  }
  const fastFail = await startOnce();
  assert.equal(fastFail.code, "TRANSCRIPTION_PROVIDER_UNAVAILABLE");
  assert.match(fastFail.message, /Try again shortly/);
  assert.equal(opens, 3, "the provider is not dialled while the breaker is open");
});
