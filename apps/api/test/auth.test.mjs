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

const { AuthService, signInMembership } = await import("../src/auth.ts");

const AUTH_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const PERSONAL = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const CONFIG = { sessionSigningSecret: "test-secret", localEntitlements: false };

function membership(organizationId, overrides = {}) {
  return { organization_id: organizationId, role: "owner", status: "active", created_at: "2026-07-18T00:00:00+00:00", ...overrides };
}

/**
 * Stands in for supabase-js: token claims are checked locally, and the one
 * profile read returns the row with its memberships embedded.
 */
function fakeClient({ claims = { sub: AUTH_USER, role: "authenticated" }, profile } = {}) {
  const calls = { getClaims: 0, getUser: 0, profileReads: [] };
  const state = {
    profile: profile === undefined
      ? {
          id: PROFILE,
          auth_user_id: AUTH_USER,
          local_user_key: null,
          email: "owner@airboard.test",
          display_name: "Owner",
          default_organization_id: PERSONAL,
          memberships: [membership(PERSONAL)],
        }
      : profile,
    profileError: null,
  };
  const client = {
    calls,
    state,
    auth: {
      async getClaims(token) {
        calls.getClaims += 1;
        if (token !== "valid-token") return { data: null, error: new Error("invalid JWT") };
        return { data: { claims }, error: null };
      },
      async getUser() {
        calls.getUser += 1;
        return { data: { user: null }, error: new Error("user not found") };
      },
    },
    from(table) {
      assert.equal(table, "profiles");
      const read = { columns: null, filters: {} };
      calls.profileReads.push(read);
      const query = {
        select(columns) { read.columns = columns; return query; },
        eq(column, value) { read.filters[column] = value; return query; },
        maybeSingle() { return query; },
        then(resolve, reject) {
          // Resolve on a later tick so concurrent requests overlap.
          return new Promise((done) => setTimeout(done, 5)).then(() => {
            if (state.profileError) return { data: null, error: state.profileError };
            const row = state.profile && state.profile.auth_user_id === read.filters.auth_user_id
              ? structuredClone(state.profile)
              : null;
            return { data: row, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

function bearer(token = "valid-token") {
  return { headers: { authorization: `Bearer ${token}` } };
}

test("a signed-in request is verified locally and resolved with one profile read", async () => {
  const client = fakeClient();
  const auth = new AuthService(CONFIG, client);

  const context = await auth.authenticate(bearer());

  assert.deepEqual(context, {
    authUserId: AUTH_USER,
    profileId: PROFILE,
    organizationId: PERSONAL,
    role: "owner",
    email: "owner@airboard.test",
    displayName: "Owner",
    tokenKind: "supabase",
  });
  assert.equal(client.calls.getUser, 0);
  assert.equal(client.calls.profileReads.length, 1);
  assert.match(client.calls.profileReads[0].columns, /memberships:organization_memberships/);
});

test("requests that arrive together share one lookup, and later ones reuse it", async () => {
  const client = fakeClient();
  const auth = new AuthService(CONFIG, client);

  const contexts = await Promise.all([auth.authenticate(bearer()), auth.authenticate(bearer()), auth.authenticate(bearer())]);
  await auth.authenticate(bearer());

  assert.ok(contexts.every((context) => context?.profileId === PROFILE));
  assert.equal(client.calls.profileReads.length, 1);
  // Every request still checks its own token.
  assert.equal(client.calls.getClaims, 4);
});

test("a token that fails verification or is not a signed-in user is rejected", async () => {
  const client = fakeClient();
  const auth = new AuthService(CONFIG, client);
  assert.equal(await auth.authenticate(bearer("forged-token")), null);

  const anonymous = new AuthService(CONFIG, fakeClient({ claims: { sub: AUTH_USER, role: "anon" } }));
  assert.equal(await anonymous.authenticate(bearer()), null);
  assert.equal(client.calls.profileReads.length, 0);
});

test("switching organization takes effect on the next request", async () => {
  const client = fakeClient();
  client.state.profile.memberships.push(membership(TEAM, { role: "member", created_at: "2026-08-01T00:00:00+00:00" }));
  const auth = new AuthService(CONFIG, client);
  assert.equal((await auth.authenticate(bearer()))?.organizationId, PERSONAL);

  client.state.profile.default_organization_id = TEAM;
  auth.forgetProfile(PROFILE);

  const switched = await auth.authenticate(bearer());
  assert.equal(switched?.organizationId, TEAM);
  assert.equal(switched?.role, "member");
});

test("a failed or empty lookup is not reused", async () => {
  const client = fakeClient();
  client.state.profileError = { code: "PGRST000" };
  const auth = new AuthService(CONFIG, client);
  await assert.rejects(auth.authenticate(bearer()), /PROFILE_LOOKUP_FAILED/);

  client.state.profileError = null;
  client.state.profile.memberships = [];
  assert.equal(await auth.authenticate(bearer()), null);

  client.state.profile.memberships = [membership(PERSONAL)];
  assert.equal((await auth.authenticate(bearer()))?.organizationId, PERSONAL);
  assert.equal(client.calls.profileReads.length, 3);
});

test("a first sign-in without a profile falls back to the full user record", async () => {
  const client = fakeClient({ profile: null });
  const auth = new AuthService(CONFIG, client);

  // The fake Auth server no longer knows the user, so there is nothing to build.
  assert.equal(await auth.authenticate(bearer()), null);
  assert.equal(client.calls.getUser, 1);
});

test("the request acts in the default organization, else the oldest active membership", () => {
  const personal = membership(PERSONAL, { created_at: "2026-07-18T00:00:00+00:00" });
  const team = membership(TEAM, { role: "member", created_at: "2026-08-01T00:00:00+00:00" });
  const suspended = membership("44444444-4444-4444-8444-444444444444", { status: "suspended", created_at: "2026-01-01T00:00:00+00:00" });

  assert.equal(signInMembership([team, personal, suspended], TEAM), team);
  assert.equal(signInMembership([team, suspended, personal], null), personal);
  assert.equal(signInMembership([team, personal], suspended.organization_id), null);
  assert.equal(signInMembership([], null), null);
});
