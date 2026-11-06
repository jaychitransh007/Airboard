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
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { BOARD_SCENE_VERSION, createEventEnvelope } = await import("@airboard/core");
const { loadConfig } = await import("../src/config.ts");
const { buildServer, JOIN_LINK_TTL_SECONDS, joinLinkReplaced } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
const { singleInstanceFanOut } = await import("../src/boardEventFanOut.ts");
const { verifySignedToken } = await import("../src/signedTokens.ts");
const {
  activeMembership,
  organizationPolicy,
  policyFromRow,
} = await import("../src/organizationPolicy.ts");

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "33333333-3333-4333-8333-333333333333";
const MEMBER = "55555555-5555-4555-8555-555555555555";
const OUTSIDER = "66666666-6666-4666-8666-666666666666";

/** Just the reads organizationPolicy and activeMembership make. */
function fakeClient(tables, { failPolicies = false } = {}) {
  return {
    tables,
    from(table) {
      const filters = [];
      const query = {
        select: () => query,
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        async maybeSingle() {
          if (failPolicies && table === "organization_policies") return { data: null, error: { message: "down" } };
          return { data: (tables[table] ?? []).find((row) => filters.every((filter) => filter(row))) ?? null, error: null };
        },
      };
      return query;
    },
  };
}

function fakeAuth(client) {
  const people = {
    "Bearer owner": { profileId: OWNER, role: "owner" },
    "Bearer member": { profileId: MEMBER, role: "member" },
    "Bearer viewer": { profileId: MEMBER, role: "viewer" },
    "Bearer billing": { profileId: MEMBER, role: "billing" },
    "Bearer outsider": { profileId: OUTSIDER, role: "owner", organizationId: "77777777-7777-4777-8777-777777777777" },
  };
  return {
    client,
    enabled: true,
    async authenticate(request) {
      const person = people[request.headers.authorization ?? ""];
      return person
        ? {
          authUserId: `auth-${person.profileId}`,
          organizationId: ORG,
          email: null,
          displayName: "Person",
          tokenKind: "supabase",
          ...person,
        }
        : null;
    },
    hasRole: (account, roles) => roles.includes(account.role),
    async activeEntitlement() {
      return { status: "active" };
    },
  };
}

async function server(t, tables, options) {
  const config = loadConfig({ NODE_ENV: "test", AIRBOARD_LOCAL_ENTITLEMENTS: "true" });
  const client = fakeClient(tables, options);
  const store = new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true });
  // The fake database has no realtime channel, so live boards stay on one instance.
  const app = await buildServer(config, { store, auth: fakeAuth(client), fanOut: singleInstanceFanOut });
  t.after(() => app.close());
  return { app, config, client, store };
}

const start = (app, as) =>
  app.inject({ method: "POST", url: "/sessions/start", headers: { authorization: `Bearer ${as}` }, payload: { provider: "standalone" } });

const join = (app, sessionId, joinToken, as) =>
  app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/join`,
    headers: as ? { authorization: `Bearer ${as}` } : {},
    payload: { displayName: "Guest", joinToken },
  });

test("Viewer and Billing members can't start live sessions; editors can, with a two-hour link", async (t) => {
  const { app, config } = await server(t, {});
  for (const role of ["viewer", "billing"]) {
    const refused = await start(app, role);
    assert.equal(refused.statusCode, 403, role);
    assert.equal(refused.json().error, "BOARD_READ_ONLY_ROLE");
  }
  const started = await start(app, "member");
  assert.equal(started.statusCode, 200, started.body);
  const claims = verifySignedToken(config.sessionSigningSecret, started.json().joinToken, "join");
  assert.equal(JOIN_LINK_TTL_SECONDS, 2 * 60 * 60);
  const lifetime = claims.exp - Math.floor(Date.now() / 1000);
  assert.ok(lifetime > JOIN_LINK_TTL_SECONDS - 60 && lifetime <= JOIN_LINK_TTL_SECONDS, `join link lasts ${lifetime}s`);
});

test("with external guests off, only the organization's signed-in members join a live board", async (t) => {
  const tables = {
    organization_policies: [{ organization_id: ORG, external_guests_allowed: true }],
    organization_memberships: [
      { organization_id: ORG, profile_id: OWNER, role: "owner", status: "active" },
      { organization_id: ORG, profile_id: MEMBER, role: "member", status: "active" },
    ],
  };
  const { app } = await server(t, tables);
  const { session, joinToken } = (await start(app, "owner")).json();

  assert.equal((await join(app, session.id, joinToken)).statusCode, 200, "guests join while allowed");

  tables.organization_policies[0].external_guests_allowed = false;
  for (const as of [undefined, "outsider"]) {
    const refused = await join(app, session.id, joinToken, as);
    assert.equal(refused.statusCode, 403, as ?? "anonymous");
    assert.equal(refused.json().error, "EXTERNAL_GUESTS_DISABLED");
  }
  assert.equal((await join(app, session.id, joinToken, "member")).statusCode, 200, "members still join");

  tables.organization_memberships[1].status = "suspended";
  assert.equal((await join(app, session.id, joinToken, "member")).statusCode, 403, "a suspended member is outside");
});

test("a policy that can't be read refuses the join instead of ignoring the switch", async (t) => {
  const { app } = await server(t, {}, { failPolicies: true });
  const { session, joinToken } = (await start(app, "owner")).json();
  const refused = await join(app, session.id, joinToken);
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.json().error, "POLICY_UNAVAILABLE");
});

test("a policy switch is off only when the row says so", async () => {
  assert.deepEqual(policyFromRow(null), {
    externalGuestsAllowed: true,
    voiceEnabled: true,
    cameraEnabled: true,
    gestureEnabled: true,
    exportsEnabled: true,
  });
  assert.equal(policyFromRow({ voice_enabled: false }).voiceEnabled, false);
  assert.equal(policyFromRow({ voice_enabled: null }).voiceEnabled, true);
  assert.equal((await organizationPolicy(null, ORG)).exportsEnabled, true, "no database: defaults");
  await assert.rejects(organizationPolicy(fakeClient({}, { failPolicies: true }), ORG), /POLICY_LOOKUP_FAILED/);
  const client = fakeClient({ organization_memberships: [{ organization_id: ORG, profile_id: MEMBER, role: "viewer", status: "active" }] });
  assert.deepEqual(await activeMembership(client, ORG, MEMBER), { role: "viewer" });
  assert.equal(await activeMembership(client, ORG, OUTSIDER), null);
});

const post = (app, url, as, payload = {}) =>
  app.inject({ method: "POST", url, headers: as ? { authorization: `Bearer ${as}` } : {}, payload });

test("New link stops older live links from letting people in; only the owner can make one", async (t) => {
  const { app } = await server(t, {});
  const { session, joinToken: first } = (await start(app, "owner")).json();
  assert.equal((await join(app, session.id, first)).statusCode, 200);

  assert.equal((await post(app, `/sessions/${session.id}/join-link`)).statusCode, 401);
  assert.equal((await post(app, `/sessions/${session.id}/join-link`, "member")).statusCode, 404, "someone else's session");

  // Tokens are dated to the second, so wait for the next one before replacing.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const replaced = await post(app, `/sessions/${session.id}/join-link`, "owner");
  assert.equal(replaced.statusCode, 200, replaced.body);
  const refused = await join(app, session.id, first);
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.json().error, "JOIN_LINK_REPLACED");
  assert.equal((await join(app, session.id, replaced.json().joinToken)).statusCode, 200);
});

test("after a reload the owner rejoins their session as its owner, never as a guest", async (t) => {
  const { app, config } = await server(t, {});
  const started = (await start(app, "owner")).json();
  const guest = (await join(app, started.session.id, started.joinToken)).json();
  const resume = (as, participantId) => post(app, `/sessions/${started.session.id}/resume`, as, { participantId });

  const resumed = await resume("owner", started.ownerParticipant.id);
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().participant.role, "owner");
  const ticket = verifySignedToken(config.sessionSigningSecret, resumed.json().realtimeTicket, "realtime");
  assert.equal(ticket.participantId, started.ownerParticipant.id);

  assert.equal((await resume("owner", guest.participant.id)).statusCode, 404, "a guest's place is not the owner's");
  assert.equal((await resume("member", started.ownerParticipant.id)).statusCode, 404, "someone else");
  assert.equal((await resume(undefined, started.ownerParticipant.id)).statusCode, 401);
});

test("a link is replaced only when it was issued before the reset, to the second", () => {
  assert.equal(joinLinkReplaced(1_000, undefined), false);
  assert.equal(joinLinkReplaced(999, new Date(1_000_500).toISOString()), true);
  assert.equal(joinLinkReplaced(1_000, new Date(1_000_500).toISOString()), false);
});

function openSocket(port, ticket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}&sceneVersion=${BOARD_SCENE_VERSION}`);
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  socket.on("error", () => undefined);
  t_sockets.push(socket);
  return { socket, messages };
}
const t_sockets = [];
const waitFor = async (predicate) => {
  for (let i = 0; i < 300 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return predicate();
};

test("the owner switches guests between viewing and editing while they are in", async (t) => {
  const { app } = await server(t, {});
  t.after(() => t_sockets.forEach((socket) => socket.close()));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = app.server.address().port;
  const startedResponse = await start(app, "owner");
  const started = startedResponse.json();
  const joined = (await join(app, started.session.id, started.joinToken)).json();
  assert.equal(joined.participant.role, "editor", "a guest's editing follows the session's switch");

  const owner = openSocket(port, started.realtimeTicket);
  const guest = openSocket(port, joined.realtimeTicket);
  assert.ok(await waitFor(() => [owner, guest].every((c) => c.messages.some((m) => m.type === "board.initialized"))));
  const edit = () => guest.socket.send(JSON.stringify({ type: "board.event", event: {
    ...createEventEnvelope({ boardSessionId: started.session.id, actorParticipantId: joined.participant.id }),
    type: "element.deleted",
    elementId: "missing",
  } }));
  const setEditing = (allow) => owner.socket.send(JSON.stringify({ type: "board.event", event: {
    ...createEventEnvelope({ boardSessionId: started.session.id, actorParticipantId: started.ownerParticipant.id }),
    type: "permission.changed",
    allowParticipantDrawing: allow,
  } }));

  setEditing(false);
  assert.ok(await waitFor(() => guest.messages.some((m) => m.type === "board.event" && m.event.type === "permission.changed")), "guests hear the change");
  await new Promise((resolve) => setTimeout(resolve, 1_100)); // past the socket's one-second permission cache
  edit();
  assert.ok(await waitFor(() => guest.messages.some((m) => m.type === "event.rejected")), "a viewing guest's edit is refused");

  setEditing(true);
  assert.ok(await waitFor(() => guest.messages.filter((m) => m.type === "board.event" && m.event.type === "permission.changed").length === 2));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const rejectedBefore = guest.messages.filter((m) => m.type === "event.rejected").length;
  edit();
  assert.ok(await waitFor(() => guest.messages.some((m) => m.type === "board.event" && m.event.type === "element.deleted")), "an editing guest's edit lands");
  assert.equal(guest.messages.filter((m) => m.type === "event.rejected").length, rejectedBefore);
});
