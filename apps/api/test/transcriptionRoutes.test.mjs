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

function fakeAuth({ entitledOrganizations = [], failWith, voiceOffOrganizations = [] } = {}) {
  return {
    // Only the organization_policies read organizationPolicy makes.
    client: {
      from: () => {
        let organizationId = null;
        const query = {
          select: () => query,
          eq: (_column, value) => { organizationId = value; return query; },
          maybeSingle: async () => ({
            data: { voice_enabled: !voiceOffOrganizations.includes(organizationId) },
            error: null,
          }),
        };
        return query;
      },
    },
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

async function startServer(t, { auth, transcription = {}, provider = fakeProvider, dailyUsage, serviceDailyUsage } = {}) {
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
      ...(dailyUsage ? { dailyUsage } : {}),
      ...(serviceDailyUsage ? { serviceDailyUsage } : {}),
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
  return { socket, closed, nextMessage, start, messages };
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

test("an admin who turns voice off stops new voice tickets for the whole organization", { timeout: 5_000 }, async (t) => {
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-quiet", "org-loud"], voiceOffOrganizations: ["org-quiet"] }),
  });
  const api = url.replace("ws://", "http://").replace("/transcription/ws", "");
  const ticketFor = (user) =>
    fetch(`${api}/transcription/ticket`, { method: "POST", headers: { authorization: `Bearer user:${user}` } });

  const refused = await ticketFor("quiet");
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "VOICE_DISABLED_BY_ADMIN");
  assert.equal((await ticketFor("loud")).status, 200);
});

// A provider whose every stream ("leg") is recorded: the audio it was sent,
// whether it was dropped, and a way to make it speak.
function recordingProvider({ failOpen = () => false } = {}) {
  const legs = [];
  return {
    legs,
    provider: {
      id: "fake",
      async open(options, onEvent) {
        if (failOpen(legs.length)) throw new Error("Deepgram unreachable");
        const leg = {
          options,
          frames: [],
          keepAlives: 0,
          aborted: false,
          stopped: false,
          emit: onEvent,
        };
        legs.push(leg);
        const stopped = () => onEvent({ type: "status", status: "stopped" });
        return {
          sendAudio(frame) {
            leg.frames.push(Buffer.from(frame));
          },
          updateKeyterms() {},
          keepAlive() {
            leg.keepAlives += 1;
          },
          stop() {
            leg.stopped = true;
            stopped();
          },
          abort() {
            leg.aborted = true;
            stopped();
          },
        };
      },
    },
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}
// A PCM16 frame whose bytes all equal `fill`, so frames can be told apart.
const pcm = (fill, bytes = 2_560) => Buffer.alloc(bytes, fill);
const isPrimer = (frame) => frame.every((byte) => byte === 0);

test("a stream nearing its time limit hands over to a replacement on the same socket, replaying the turn in progress", { timeout: 5_000 }, async (t) => {
  const { legs, provider } = recordingProvider();
  // One stream for the account and for the instance: the overlap must not
  // need a second slot.
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a"] }),
    provider,
    transcription: { maxConcurrentStreams: 1, maxStreamsPerProfile: 1, maxSessionMs: 400 },
  });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  assert.equal(legs.length, 1);

  // A finished turn, then the start of the next one.
  client.socket.send(pcm(1));
  await until(() => legs[0].frames.some((frame) => frame[0] === 1), "the first frame");
  legs[0].emit({ type: "final", transcript: "Airo add a user", turnIndex: 0 });
  assert.equal((await client.nextMessage("transcription.final")).turnIndex, 0);

  // Keep talking through the limit, so the switch cannot wait for a pause.
  const talking = setInterval(() => client.socket.send(pcm(2)), 60);
  t.after(() => clearInterval(talking));
  await client.nextMessage("transcription.renewing");
  await until(() => legs.length === 2 && legs[0].aborted, "the handover");
  clearInterval(talking);

  // The replacement heard the unfinished turn again, from its start, and
  // never the finished one; the old leg was dropped, not asked to finish.
  const replayed = legs[1].frames;
  assert.ok(replayed.length > 0);
  assert.ok(replayed.every((frame) => frame[0] === 2), "only the turn in progress is replayed");
  assert.equal(legs[0].stopped, false);
  const sentToOld = legs[0].frames.filter((frame) => frame[0] === 2).length;
  assert.ok(replayed.length >= sentToOld, "every frame of the turn reaches the replacement");

  // New audio goes only to the replacement, and its turns keep counting up.
  const oldCount = legs[0].frames.length;
  client.socket.send(pcm(3));
  await until(() => legs[1].frames.some((frame) => frame[0] === 3), "audio on the replacement");
  assert.equal(legs[0].frames.length, oldCount);
  legs[1].emit({ type: "partial", transcript: "add a database", turnIndex: 0 });
  assert.equal((await client.nextMessage("transcription.partial")).turnIndex, 1);

  // The browser saw one unbroken stream.
  assert.equal(client.messages.some((message) => message.type === "transcription.error" || message.type === "transcription.stopped"), false);
  assert.equal(client.messages.filter((message) => message.type === "transcription.ready").length, 0);
  client.socket.close();
});

test("a replacement that is ready during a pause takes over at once", { timeout: 5_000 }, async (t) => {
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a"] }),
    provider,
    transcription: { maxSessionMs: 2_000 },
  });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  await client.nextMessage("transcription.renewing");
  await until(() => legs.length === 2 && legs[0].aborted, "the handover");
  // Nothing to replay, so the replacement gets a moment of silence instead.
  assert.ok(legs[1].frames.length === 1 && isPrimer(legs[1].frames[0]));
  client.socket.close();
});

test("when the replacement cannot open, the stream ends at its limit as before", { timeout: 5_000 }, async (t) => {
  const { legs, provider } = recordingProvider({ failOpen: (opened) => opened >= 1 });
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a"] }),
    provider,
    transcription: { maxSessionMs: 200 },
  });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  // Speech right up to the limit keeps the old leg in use until then.
  const talking = setInterval(() => client.socket.send(pcm(1)), 40);
  t.after(() => clearInterval(talking));
  const limit = await client.nextMessage("transcription.error");
  clearInterval(talking);
  assert.equal(limit.code, "TRANSCRIPTION_SESSION_LIMIT");
  assert.equal(limit.fatal, true);
  assert.equal((await client.nextMessage("transcription.stopped")).reason, "aborted");
  assert.equal(legs.length, 1);
  client.socket.close();
});

test("silence is not streamed: the provider is kept open with KeepAlive, and a stream it closes in silence reopens on speech", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, { auth: fakeAuth({ entitledOrganizations: ["org-a"] }), provider });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");

  // No audio arrives during a silence: keep-alives hold the stream.
  t.mock.timers.tick(5_000);
  await until(() => legs[0].keepAlives >= 1, "a keep-alive");

  // The provider gives up on the silent stream anyway (its no-audio timeout):
  // the browser is not told, and nothing is lost.
  legs[0].emit({ type: "error", code: "NET-0001", message: "no audio", fatal: true });
  assert.equal(legs[0].aborted, true);
  await delay(30);
  assert.equal(client.messages.some((message) => message.type === "transcription.error" || message.type === "transcription.stopped"), false);

  // Speech reopens a provider stream and its first words reach it.
  client.socket.send(pcm(7));
  await until(() => legs.length === 2 && legs[1].frames.some((frame) => frame[0] === 7), "the reopened stream");
  legs[1].emit({ type: "final", transcript: "Airo add a queue", turnIndex: 0 });
  assert.equal((await client.nextMessage("transcription.final")).transcript, "Airo add a queue");
  client.socket.close();
});

test("a forgotten tab whose provider stream went dormant still reaches its limit, and its stream slots return", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a"] }),
    provider,
    transcription: { maxStreamsPerProfile: 1 },
  });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");

  // The provider closes the silent leg; no leg time limit is left to fire.
  t.mock.timers.tick(5_000);
  legs[0].emit({ type: "error", code: "NET-0001", message: "no audio", fatal: true });
  assert.equal(legs[0].aborted, true);
  t.mock.timers.tick(10 * 60_000);
  await delay(300);
  assert.equal(client.messages.some((message) => message.type === "transcription.error"), false, "not before the quiet limit");

  // Twenty quiet minutes in, the stream reaches its limit like a leg would:
  // the browser's quiet-tab check runs on TRANSCRIPTION_SESSION_LIMIT.
  t.mock.timers.tick(10 * 60_000);
  const limit = await client.nextMessage("transcription.error");
  assert.equal(limit.code, "TRANSCRIPTION_SESSION_LIMIT");
  assert.equal(limit.fatal, true);
  assert.equal((await client.nextMessage("transcription.stopped")).reason, "aborted");
  assert.equal(legs.length, 1, "no provider stream was opened for it");

  // The account's only slot is free again, even with the old socket open.
  const next = connect(url, "a");
  next.start();
  await next.nextMessage("transcription.ready");
  client.socket.close();
  next.socket.close();
});

test("a replacement the provider closes before it takes over is never promoted", { timeout: 5_000 }, async (t) => {
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, {
    auth: fakeAuth({ entitledOrganizations: ["org-a"] }),
    provider,
    transcription: { maxSessionMs: 600 },
  });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  // Talking keeps the replacement on standby instead of taking over in a pause.
  const talking = setInterval(() => client.socket.send(pcm(1)), 40);
  t.after(() => clearInterval(talking));
  await client.nextMessage("transcription.renewing");
  await until(() => legs.length === 2, "the replacement");
  await delay(20);
  legs[1].emit({ type: "status", status: "stopped" });
  assert.equal(legs[1].aborted, true);

  // At the limit, the dead replacement is not made current: the stream ends,
  // so the browser reconnects instead of streaming into a closed leg.
  const limit = await client.nextMessage("transcription.error");
  clearInterval(talking);
  assert.equal(limit.code, "TRANSCRIPTION_SESSION_LIMIT");
  assert.equal(legs[0].aborted || legs[0].stopped, true);
  assert.equal(legs[1].frames.filter((frame) => frame[0] === 1).length, 0, "no speech went to the closed replacement");
  client.socket.close();
});

test("a provider close while audio is flowing still ends the stream, so the browser reconnects", { timeout: 5_000 }, async (t) => {
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, { auth: fakeAuth({ entitledOrganizations: ["org-a"] }), provider });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  client.socket.send(pcm(1));
  await until(() => legs[0].frames.some((frame) => frame[0] === 1), "audio");
  legs[0].emit({ type: "status", status: "stopped" });
  assert.equal((await client.nextMessage("transcription.stopped")).reason, "provider_closed");
  client.socket.close();
});

// A Supabase stand-in for the voice allowance: the charging RPCs, and the
// daily_usage / service_daily_usage rows the warnings read.
function meteredAuth({ users, rpc, usedSeconds, serviceUsedSeconds = () => 0 }) {
  const signedIn = fakeAuth({ entitledOrganizations: users.map((user) => `org-${user}`) });
  return {
    ...signedIn,
    client: {
      from(table) {
        if (table !== "daily_usage" && table !== "service_daily_usage") return signedIn.client.from(table);
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { amount: table === "daily_usage" ? usedSeconds() : serviceUsedSeconds() },
            error: null,
          }),
        };
        return query;
      },
      async rpc(name, params) {
        if (name === "consume_rate_limit") return { data: true, error: null };
        return rpc(name, params);
      },
    },
  };
}

// Sends `seconds` of 16 kHz PCM16 in one-second frames, a second apart on the
// mocked clock so the per-second audio rate limit holds.
async function speak(t, client, seconds) {
  for (let second = 0; second < seconds; second += 1) {
    t.mock.timers.tick(1_001);
    client.socket.send(pcm(5, 32_000));
    await delay(5);
  }
}

test("voice is charged for audio sent, not open time, and stops when a person's minutes run out", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const charges = [];
  let blocksLeft = 2;
  const auth = meteredAuth({
    users: ["a"],
    usedSeconds: () => 0,
    async rpc(name, params) {
      charges.push({ name, ...params });
      if (blocksLeft <= 0) return { data: null, error: null };
      blocksLeft -= 1;
      return { data: 15, error: null };
    },
  });
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, { auth, provider, dailyUsage: { airoCommands: 500, voiceSeconds: 600 } });

  // The first block is paid when the stream starts.
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  assert.deepEqual(charges, [
    { name: "consume_daily_usage", p_profile_id: "profile-a", p_metric: "voice_seconds", p_amount: 15, p_limit: 600 },
  ]);

  // An hour with the board open and nobody speaking costs nothing more.
  t.mock.timers.tick(60 * 60_000);
  await delay(20);
  assert.equal(charges.length, 1);

  // Speech uses the paid block, and the next is bought ahead of need.
  await speak(t, client, 8);
  await until(() => charges.length === 2, "the second block");
  // The third block is refused: the stream ends.
  await speak(t, client, 15);
  const limit = await client.nextMessage("transcription.error");
  assert.equal(limit.code, "DAILY_VOICE_LIMIT");
  assert.equal(limit.fatal, true);
  await client.nextMessage("transcription.stopped");
  assert.equal(charges.length, 3);
  // Nothing beyond the paid 30 seconds reached the provider.
  const sentSeconds = legs[0].frames.filter((frame) => !isPrimer(frame)).reduce((total, frame) => total + frame.length, 0) / 32_000;
  assert.ok(sentSeconds <= 30, `sent ${sentSeconds}s`);

  // A new stream is refused before the provider opens.
  client.start();
  const refused = await client.nextMessage("transcription.error");
  assert.equal(refused.code, "DAILY_VOICE_LIMIT");
  assert.match(refused.message, /midnight UTC/);
  assert.equal(legs.length, 1);
  client.socket.close();
});

test("voice stops for everyone when the service's daily minutes run out", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const calls = [];
  let serviceBlocksLeft = 2;
  const auth = meteredAuth({
    users: ["a", "b"],
    usedSeconds: () => 0,
    async rpc(name, params) {
      // Each person still has plenty of their own minutes.
      calls.push({ name, ...params });
      if (serviceBlocksLeft <= 0) return { data: "service_exhausted", error: null };
      serviceBlocksLeft -= 1;
      return { data: "allowed", error: null };
    },
  });
  const { legs, provider } = recordingProvider();
  const url = await startServer(t, {
    auth,
    provider,
    dailyUsage: { airoCommands: 500, voiceSeconds: 600 },
    serviceDailyUsage: { airoCommands: 500, voiceSeconds: 30 },
  });

  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  assert.deepEqual(calls, [{
    name: "consume_daily_usage_with_service_limit",
    p_profile_id: "profile-a",
    p_metric: "voice_seconds",
    p_amount: 15,
    p_limit: 600,
    p_service_limit: 30,
  }]);

  // The second block uses the service's last minutes; the third ends the stream.
  await speak(t, client, 23);
  const limit = await client.nextMessage("transcription.error");
  assert.equal(limit.code, "SERVICE_VOICE_LIMIT");
  assert.equal(limit.fatal, true);
  assert.match(limit.message, /everyone in the pilot/);
  await client.nextMessage("transcription.stopped");
  client.socket.close();

  // Someone else is refused before Deepgram is ever dialled.
  const other = connect(url, "b");
  other.start();
  assert.equal((await other.nextMessage("transcription.error")).code, "SERVICE_VOICE_LIMIT");
  assert.equal(legs.length, 1);
  assert.equal(other.messages.some((message) => message.type === "transcription.ready"), false);
  other.socket.close();
});

test("the browser is warned as today's voice minutes fall to 15 and to 5", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  // 20 minutes a day, 4 m 45 s used before this stream: each block charged
  // adds to what the warning reads.
  let used = 285 - 15;
  const auth = meteredAuth({
    users: ["a"],
    usedSeconds: () => used,
    async rpc() {
      used += 15;
      return { data: used, error: null };
    },
  });
  const url = await startServer(t, { auth, dailyUsage: { airoCommands: 500, voiceSeconds: 20 * 60 } });
  const client = connect(url, "a");
  client.start();
  await client.nextMessage("transcription.ready");
  // Nothing to say while more than 15 minutes are left.
  await delay(20);
  assert.equal(client.messages.some((message) => message.type === "transcription.allowance_warning"), false);

  used = 20 * 60 - 15 * 60 - 1;
  await speak(t, client, 8);
  const first = await client.nextMessage("transcription.allowance_warning");
  assert.deepEqual(
    { remainingMinutes: first.remainingMinutes, scope: first.scope },
    { remainingMinutes: 14, scope: "personal" },
  );
  assert.match(first.message, /About 14 minutes of Airo voice left today/);

  // Only once per threshold.
  await speak(t, client, 15);
  await delay(20);
  assert.equal(client.messages.some((message) => message.type === "transcription.allowance_warning"), false);

  used = 20 * 60 - 5 * 60 - 1;
  await speak(t, client, 15);
  const second = await client.nextMessage("transcription.allowance_warning");
  assert.equal(second.remainingMinutes, 4);
  client.socket.close();
});

test("the pilot-wide total warns when it is nearer than the person's own limit", { timeout: 5_000 }, async () => {
  const { createVoiceAllowanceReader, nextVoiceAllowanceWarning } = await import("../src/transcription/voiceAllowance.ts");
  const reads = [];
  const client = {
    from(table) {
      const query = {
        select: () => query,
        eq: (column, value) => { reads.push([table, column, value]); return query; },
        maybeSingle: async () => ({ data: table === "daily_usage" ? { amount: 60 } : { amount: 2_900 * 60 }, error: null }),
      };
      return query;
    },
  };
  const reader = createVoiceAllowanceReader(
    client,
    { airoCommands: 1, voiceSeconds: 240 * 60 },
    { airoCommands: 1, voiceSeconds: 3_000 * 60 },
  );
  const remaining = await reader.remaining("profile-a");
  assert.deepEqual(remaining, { seconds: 100 * 60, scope: "service" });
  assert.ok(reads.some(([table, column, value]) => table === "daily_usage" && column === "profile_id" && value === "profile-a"));

  const warned = new Set();
  assert.equal(nextVoiceAllowanceWarning(remaining, warned), null);
  // Falling straight past both thresholds sends one warning.
  const late = nextVoiceAllowanceWarning({ seconds: 200, scope: "service" }, warned);
  assert.equal(late.remainingMinutes, 3);
  assert.match(late.message, /everyone in the pilot/);
  assert.equal(nextVoiceAllowanceWarning({ seconds: 100, scope: "service" }, warned), null);
  // A failed read warns nobody.
  const broken = createVoiceAllowanceReader(
    { from: () => { throw new Error("db down"); } },
    { airoCommands: 1, voiceSeconds: 60 },
    undefined,
  );
  assert.equal(await broken.remaining("profile-a"), null);
});
