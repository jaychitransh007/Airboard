import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const { loadConfig } = await import("../src/config.ts");
const { buildServer, JOIN_LINK_TTL_SECONDS } = await import("../src/server.ts");
const { InMemorySessionStore } = await import("../src/sessionStore.ts");
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
  const app = await buildServer(config, {
    store: new InMemorySessionStore({ ownerGraceSeconds: 180, localEntitlements: true }),
    auth: fakeAuth(client),
  });
  t.after(() => app.close());
  return { app, config, client };
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
