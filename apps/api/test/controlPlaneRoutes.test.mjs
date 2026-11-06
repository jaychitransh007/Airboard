import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

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

const { registerControlPlaneRoutes } = await import("../src/controlPlaneRoutes.ts");
const { accountEntitlement } = await import("../src/auth.ts");
const { SupabaseSessionStore } = await import("../src/supabaseSessionStore.ts");

/**
 * Minimal in-memory stand-in for the supabase-js query builder: just the
 * filters, writes, and storage calls the control plane uses. `fail(table, op)`
 * may return an error object to simulate a PostgREST failure.
 */
function createFakeSupabase(tables, options = {}) {
  const storageCalls = [];
  const fakeClient = {
    tables,
    storageCalls,
    storageError: null,
    fail: options.fail ?? (() => null),
    from(table) {
      return new FakeQuery(fakeClient, table);
    },
    // The database functions the API calls, emulated over the same tables.
    rpc(name, args) {
      const handler = FAKE_RPC[name];
      assert.ok(handler, `unexpected rpc ${name}`);
      const run = () => handler(fakeClient.tables, args);
      return { single: () => Promise.resolve().then(run) };
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            return { data: { signedUrl: `https://storage.airboard.test/${path}?ttl=${ttl}` }, error: null };
          },
          async remove(paths) {
            storageCalls.push({ bucket, paths: [...paths] });
            return fakeClient.storageError
              ? { data: null, error: fakeClient.storageError }
              : { data: [], error: null };
          },
        };
      },
    },
    deletedAuthUsers: [],
    authDeleteError: null,
    auth: {
      admin: {
        async deleteUser(id) {
          if (fakeClient.authDeleteError) return { data: null, error: fakeClient.authDeleteError };
          fakeClient.deletedAuthUsers.push(id);
          return { data: {}, error: null };
        },
      },
    },
  };
  return fakeClient;
}

const FAKE_RPC = {
  // Mirrors supabase/migrations/20261105140000_start_board_session_rpc.sql.
  start_board_session(tables, args) {
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      owner_user_id: args.p_owner_user_id,
      provider: args.p_provider,
      status: "active",
      allow_participant_drawing: args.p_allow_participant_drawing,
      owner_last_seen_at: now,
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      organization_id: args.p_organization_id,
      workspace_id: args.p_workspace_id,
      board_id: args.p_board_id,
      provider_meeting_id: args.p_provider_meeting_id,
      title: args.p_title || "Airboard",
    };
    const participant = {
      id: crypto.randomUUID(),
      board_session_id: session.id,
      user_id: args.p_owner_user_id,
      display_name: args.p_owner_display_name || "Owner",
      role: "owner",
      input_enabled: true,
    };
    (tables.board_sessions ??= []).push(session);
    (tables.participants ??= []).push(participant);
    return { data: { session, participant }, error: null };
  },
};

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.returning = false;
    this.columns = "*";
    this.selectOptions = {};
    this.orderBy = null;
    this.limitCount = null;
    this.singleMode = null;
  }
  select(columns = "*", selectOptions = {}) {
    if (this.op === "select") {
      this.columns = columns;
      this.selectOptions = selectOptions;
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows, upsertOptions = {}) {
    this.op = "upsert";
    this.payload = rows;
    this.upsertOptions = upsertOptions;
    return this;
  }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
  filter(column, operator, value) {
    assert.ok(operator === "eq" || operator === "neq", `unsupported filter() operator ${operator}`);
    this.filters.push((row) => (operator === "eq" ? row[column] === value : row[column] !== value));
    return this;
  }
  or(expression) {
    // PostgREST v14.3 rejects or= on UPDATE … RETURNING (42703); writes must
    // use writeAccessibleBoard's two plain filters instead.
    assert.equal(this.op, "select", `or() on ${this.op} breaks on PostgREST v14.3`);
    // Supports the comma-separated `column.eq.value` / `column.neq.value` form.
    const clauses = expression.split(",").map((clause) => {
      const [column, operator, ...rest] = clause.split(".");
      const value = rest.join(".");
      assert.ok(operator === "eq" || operator === "neq", `unsupported or() operator ${operator}`);
      return (row) => (operator === "eq" ? String(row[column]) === value : String(row[column]) !== value);
    });
    this.filters.push((row) => clauses.some((clause) => clause(row)));
    return this;
  }
  is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  not(column, operator, value) {
    assert.equal(operator, "is");
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  lt(column, value) { this.filters.push((row) => row[column] < value); return this; }
  lte(column, value) { this.filters.push((row) => row[column] <= value); return this; }
  gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
  order(column, { ascending = true } = {}) { this.orderBy = { column, ascending }; return this; }
  limit(count) { this.limitCount = count; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "single"; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  execute() {
    const failure = this.client.fail(this.table, this.op);
    if (failure) return { data: null, error: failure, count: null };
    const rows = (this.client.tables[this.table] ??= []);
    const matches = () => rows.filter((row) => this.filters.every((filter) => filter(row)));
    let result;
    if (this.op === "select") {
      result = matches();
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        result = [...result].sort((a, b) =>
          (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
      }
      if (this.limitCount !== null) result = result.slice(0, this.limitCount);
      if (this.selectOptions.head) {
        return { data: null, error: null, count: result.length };
      }
    } else if (this.op === "update") {
      result = matches();
      for (const row of result) Object.assign(row, this.payload);
    } else if (this.op === "delete") {
      result = matches();
      this.client.tables[this.table] = rows.filter((row) => !result.includes(row));
      if (this.table === "boards") {
        // ON DELETE CASCADE for the rows these tests observe.
        const ids = new Set(result.map((row) => row.id));
        this.client.tables.board_assets = (this.client.tables.board_assets ?? [])
          .filter((asset) => !ids.has(asset.board_id));
      }
    } else {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      result = [];
      for (const value of incoming) {
        const keys = this.op === "upsert" && this.upsertOptions.onConflict
          ? this.upsertOptions.onConflict.split(",")
          : null;
        const existing = keys
          ? rows.find((row) => keys.every((key) => row[key] === value[key]))
          : null;
        if (existing) {
          if (!this.upsertOptions.ignoreDuplicates) Object.assign(existing, value);
          result.push(existing);
        } else {
          const row = { id: crypto.randomUUID(), ...value };
          rows.push(row);
          result.push(row);
        }
      }
    }
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    const projected = result.map((row) => project(row, this.columns));
    if (this.singleMode === "maybe") {
      return { data: projected[0] ?? null, error: null };
    }
    if (this.singleMode === "single") {
      return projected.length === 1
        ? { data: projected[0], error: null }
        : { data: null, error: { code: "PGRST116" } };
    }
    return { data: projected, error: null };
  }
}

function project(row, columns) {
  if (columns === "*") return { ...row };
  return Object.fromEntries(
    columns.split(",").map((column) => [column.trim(), row[column.trim()]]),
  );
}

const ORG = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const CRON_SECRET = "cron-secret";

function fakeAuth(client) {
  const context = {
    authUserId: "auth-user",
    profileId: PROFILE,
    organizationId: ORG,
    role: "owner",
    email: "owner@airboard.test",
    displayName: "Owner",
    tokenKind: "supabase",
  };
  return {
    client,
    enabled: true,
    async authenticate(request) {
      return request.headers.authorization === "Bearer owner" ? context : null;
    },
    hasRole: (account, roles) => roles.includes(account.role),
    forgetProfile() {},
    async providerAvailability() {
      return { google: true, microsoft: false, emailMagicLink: true };
    },
    async activeEntitlement() {
      return { status: "active" };
    },
  };
}

async function buildApp(t, client, overrides = {}) {
  const server = Fastify();
  t.after(() => server.close());
  registerControlPlaneRoutes(
    server,
    {
      localEntitlements: false,
      cronSecret: CRON_SECRET,
      email: { from: "Airboard <test@airboard.test>" },
      stripe: { enabled: false },
      chromeExtensionCompatibleVersions: [],
      chromeExtensionEnabled: false,
      ...overrides,
    },
    fakeAuth(client),
  );
  return server;
}

function boardRow(overrides = {}) {
  return {
    id: BOARD,
    organization_id: ORG,
    workspace_id: "44444444-4444-4444-8444-444444444444",
    title: "Board",
    latest_state: { nodes: ["original"] },
    latest_version: 3,
    visibility: "private",
    owner_profile_id: PROFILE,
    deleted_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function patchBoard(server, payload) {
  return server.inject({
    method: "PATCH",
    url: `/boards/${BOARD}`,
    headers: { authorization: "Bearer owner" },
    payload,
  });
}

test("board state saves are compare-and-swap on latest_version", async (t) => {
  const client = createFakeSupabase({ boards: [boardRow()], board_versions: [] });
  const server = await buildApp(t, client);

  const saved = await patchBoard(server, { version: 4, state: { nodes: ["tab-a"] } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().board.latest_version, 4);
  assert.deepEqual(client.tables.boards[0].latest_state, { nodes: ["tab-a"] });
  assert.deepEqual(
    client.tables.board_versions.map((row) => [row.version, row.state]),
    [[4, { nodes: ["tab-a"] }]],
  );

  // A second tab still on version 3 also proposes 4 and must not overwrite.
  const stale = await patchBoard(server, { version: 4, state: { nodes: ["tab-b"] } });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json(), { error: "BOARD_VERSION_CONFLICT", latestVersion: 4 });
  // Skipping ahead is a conflict too.
  const ahead = await patchBoard(server, { version: 9, state: { nodes: ["tab-b"] } });
  assert.equal(ahead.statusCode, 409);
  assert.equal(ahead.json().latestVersion, 4);
  assert.deepEqual(client.tables.boards[0].latest_state, { nodes: ["tab-a"] });
  assert.equal(client.tables.board_versions.length, 1, "rejected writes create no history");

  const next = await patchBoard(server, { version: 5, state: { nodes: ["tab-b rebased"] } });
  assert.equal(next.statusCode, 200, next.body);
  assert.equal(next.json().board.latest_version, 5);
  assert.deepEqual(client.tables.board_versions.map((row) => row.version), [4, 5]);
});

test("another member's private board is invisible; organization boards stay shared", async (t) => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const SHARED = "88888888-8888-4888-8888-888888888888";
  const client = createFakeSupabase({
    boards: [
      boardRow({ owner_profile_id: OTHER }),
      boardRow({ id: SHARED, owner_profile_id: OTHER, visibility: "organization", title: "Team map" }),
    ],
    board_versions: [],
    audit_events: [],
  });
  const server = await buildApp(t, client);
  const as = (method, url, payload) =>
    server.inject({ method, url, headers: { authorization: "Bearer owner" }, ...(payload ? { payload } : {}) });

  const listed = await as("GET", "/boards");
  assert.deepEqual(listed.json().boards.map((board) => board.id), [SHARED]);
  assert.equal((await as("GET", `/boards/${BOARD}`)).statusCode, 404);
  assert.equal((await as("PATCH", `/boards/${BOARD}`, { title: "Taken over" })).statusCode, 404);
  assert.equal((await as("PATCH", `/boards/${BOARD}`, { version: 4, state: { nodes: [] } })).statusCode, 404);
  assert.equal((await as("DELETE", `/boards/${BOARD}`)).statusCode, 404);
  assert.equal(client.tables.boards[0].title, "Board");
  assert.equal(client.tables.boards[0].deleted_at, null);

  client.tables.boards[0].deleted_at = "2026-11-02T00:00:00.000Z";
  assert.equal((await as("GET", "/boards?scope=trash")).json().boards.length, 0);
  assert.equal((await as("POST", `/boards/${BOARD}/restore`)).statusCode, 404);

  assert.equal((await as("GET", `/boards/${SHARED}`)).statusCode, 200);
  assert.equal((await as("PATCH", `/boards/${SHARED}`, { title: "Team map v2" })).statusCode, 200);
});

test("only a board's owner changes who can open it", async (t) => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const SHARED = "88888888-8888-4888-8888-888888888888";
  const client = createFakeSupabase({
    boards: [
      boardRow(),
      boardRow({ id: SHARED, owner_profile_id: OTHER, visibility: "organization" }),
    ],
    board_versions: [],
    audit_events: [],
  });
  const server = await buildApp(t, client);
  const as = (url, payload) =>
    server.inject({ method: "PATCH", url, headers: { authorization: "Bearer owner" }, payload });

  const shared = await as(`/boards/${BOARD}`, { visibility: "organization" });
  assert.equal(shared.statusCode, 200, shared.body);
  assert.equal(client.tables.boards[0].visibility, "organization");

  const hidden = await as(`/boards/${SHARED}`, { visibility: "private" });
  assert.equal(hidden.statusCode, 403);
  assert.equal(hidden.json().error, "BOARD_OWNER_ONLY");
  assert.equal(client.tables.boards[1].visibility, "organization");
});

test("metadata-only board patches need no version and missing boards stay 404", async (t) => {
  const client = createFakeSupabase({ boards: [boardRow()], board_versions: [], audit_events: [] });
  const server = await buildApp(t, client);

  const renamed = await patchBoard(server, { title: "Renamed", archived: true });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(client.tables.boards[0].title, "Renamed");
  assert.equal(client.tables.boards[0].latest_version, 3);
  assert.ok(client.tables.boards[0].archived_at);

  assert.equal((await patchBoard(server, { state: { nodes: [] } })).json().error, "BOARD_VERSION_REQUIRED");

  client.tables.boards[0].deleted_at = "2026-11-02T00:00:00.000Z";
  const missing = await patchBoard(server, { version: 4, state: { nodes: [] } });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "BOARD_NOT_FOUND");
});

test("a failed history write is a distinct 500 that reports the saved version", async (t) => {
  const client = createFakeSupabase(
    { boards: [boardRow()], board_versions: [] },
    { fail: (table) => (table === "board_versions" ? { code: "XX000", message: "boom" } : null) },
  );
  const server = await buildApp(t, client);
  const response = await patchBoard(server, { version: 4, state: { nodes: ["saved"] } });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "BOARD_VERSION_HISTORY_FAILED", latestVersion: 4 });
});

const DAY = 86_400_000;

function lifecycleTables() {
  const expiredBoard = "55555555-5555-4555-8555-555555555555";
  const recentBoard = "66666666-6666-4666-8666-666666666666";
  return {
    organizations: [{ id: ORG, kind: "team" }],
    organization_policies: [{ organization_id: ORG, content_retention_days: 30 }],
    boards: [
      boardRow({ id: expiredBoard, deleted_at: new Date(Date.now() - 60 * DAY).toISOString() }),
      boardRow({ id: recentBoard, deleted_at: new Date(Date.now() - DAY).toISOString() }),
      boardRow(),
    ],
    board_assets: [
      { id: "a1", organization_id: ORG, board_id: expiredBoard, storage_path: `${ORG}/${expiredBoard}/a1/one.png` },
      { id: "a2", organization_id: ORG, board_id: expiredBoard, storage_path: `${ORG}/${expiredBoard}/a2/browser-safe.jpg` },
      { id: "a3", organization_id: ORG, board_id: recentBoard, storage_path: `${ORG}/${recentBoard}/a3/three.mp4` },
      { id: "a4", organization_id: ORG, board_id: BOARD, storage_path: `${ORG}/${BOARD}/a4/four.png` },
    ],
    trial_eligibility: [],
    data_requests: [],
    support_requests: [],
  };
}

function runLifecycle(server) {
  return server.inject({
    method: "POST",
    url: "/internal/lifecycle/run",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

test("purging expired boards erases their uploaded objects first", async (t) => {
  const client = createFakeSupabase(lifecycleTables());
  const server = await buildApp(t, client);
  const response = await runLifecycle(server);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().deletedBoards, {
    attempted: true,
    organizations: 1,
    purged: 1,
    failures: 0,
    assetObjects: 2,
    storageFailures: 0,
  });
  assert.deepEqual(client.storageCalls, [{
    bucket: "board-assets",
    paths: [
      `${ORG}/55555555-5555-4555-8555-555555555555/a1/one.png`,
      `${ORG}/55555555-5555-4555-8555-555555555555/a2/browser-safe.jpg`,
    ],
  }]);
  assert.equal(client.tables.boards.length, 2);
  assert.deepEqual(client.tables.board_assets.map((asset) => asset.id), ["a3", "a4"]);
});

test("a storage failure keeps expired boards for the next lifecycle run", async (t) => {
  const client = createFakeSupabase(lifecycleTables());
  client.storageError = { statusCode: "500", message: "storage unavailable" };
  const server = await buildApp(t, client);
  const response = await runLifecycle(server);
  // A failed step fails the run so Cloud Scheduler logs an error and alerts.
  assert.equal(response.statusCode, 500, response.body);
  assert.equal(response.json().error, "LIFECYCLE_STEP_FAILED");
  assert.equal(response.json().failures, 1);
  const { deletedBoards } = response.json();
  assert.equal(deletedBoards.purged, 0);
  assert.equal(deletedBoards.storageFailures, 1);
  assert.equal(deletedBoards.failures, 1);
  assert.equal(client.tables.boards.length, 3, "rows survive so a retry can erase the binaries");

  // Already-missing objects (a bucket-level 404) do not block the purge.
  client.storageError = { statusCode: "404", message: "Bucket not found" };
  const retry = await runLifecycle(server);
  assert.equal(retry.statusCode, 200, retry.body);
  const retried = retry.json().deletedBoards;
  assert.equal(retried.purged, 1);
  assert.equal(retried.storageFailures, 0);
});

test("workspace deletion erases the organization's objects and retries on storage failure", async (t) => {
  const tables = lifecycleTables();
  tables.organization_memberships = [{ id: "m1", organization_id: ORG, profile_id: PROFILE, role: "owner", status: "active" }];
  tables.data_requests.push({
    id: "request-1",
    request_type: "delete_workspace",
    organization_id: ORG,
    profile_id: PROFILE,
    status: "queued",
    execute_after: new Date(Date.now() - DAY).toISOString(),
    requested_at: new Date(Date.now() - 2 * DAY).toISOString(),
  });
  const client = createFakeSupabase(tables);
  client.storageError = { statusCode: "503", message: "storage unavailable" };
  const server = await buildApp(t, client);

  const failed = (await runLifecycle(server)).json();
  assert.deepEqual(failed.dataRequests, { completed: 0, failed: 0, storageFailures: 1 });
  assert.equal(client.tables.organizations.length, 1, "organization rows are kept");
  assert.equal(client.tables.data_requests[0].status, "queued");
  assert.equal(client.tables.data_requests[0].error_code, "BOARD_ASSET_STORAGE_DELETE_FAILED");

  client.storageError = null;
  client.storageCalls.length = 0;
  const completed = (await runLifecycle(server)).json();
  assert.deepEqual(completed.dataRequests, { completed: 1, failed: 0, storageFailures: 0 });
  assert.deepEqual(
    client.storageCalls[0].paths.map((path) => path.split("/")[2]),
    ["a1", "a2", "a3", "a4"],
  );
  assert.equal(client.tables.organizations.length, 0);
});

test("account deletion erases a personal workspace's objects before deleting the auth user", async (t) => {
  const tables = lifecycleTables();
  tables.organizations = [{ id: ORG, kind: "personal" }];
  tables.organization_memberships = [{ id: "m1", organization_id: ORG, profile_id: PROFILE, status: "active" }];
  tables.profiles = [{ id: PROFILE, auth_user_id: "auth-user", email: "owner@airboard.test" }];
  tables.data_requests.push({
    id: "request-2",
    request_type: "delete_account",
    organization_id: ORG,
    profile_id: PROFILE,
    status: "queued",
    execute_after: new Date(Date.now() - DAY).toISOString(),
    requested_at: new Date(Date.now() - 2 * DAY).toISOString(),
  });
  const client = createFakeSupabase(tables);
  client.storageError = { statusCode: "500", message: "storage unavailable" };
  const server = await buildApp(t, client);

  const failed = (await runLifecycle(server)).json();
  assert.equal(failed.dataRequests.storageFailures, 1);
  assert.deepEqual(client.deletedAuthUsers, [], "nothing irreversible happens before erasure");
  assert.equal(client.tables.profiles.length, 1);
  assert.equal(client.tables.data_requests[0].status, "queued");

  client.storageError = null;
  const completed = (await runLifecycle(server)).json();
  assert.deepEqual(completed.dataRequests, { completed: 1, failed: 0, storageFailures: 0 });
  assert.deepEqual(client.deletedAuthUsers, ["auth-user"]);
  assert.equal(client.tables.organizations.length, 0);
  assert.equal(client.tables.profiles.length, 0);
});

function deletionRequest(overrides = {}) {
  return {
    id: "request-3",
    request_type: "delete_account",
    organization_id: ORG,
    profile_id: PROFILE,
    status: "queued",
    execute_after: new Date(Date.now() - DAY).toISOString(),
    requested_at: new Date(Date.now() - 2 * DAY).toISOString(),
    ...overrides,
  };
}

test("account deletion removes every personal workspace left without a member and resumes after a failure", async (t) => {
  const SECOND_PERSONAL = "77777777-7777-4777-8777-777777777777";
  const SHARED_PERSONAL = "88888888-8888-4888-8888-888888888888";
  const TEAM = "99999999-9999-4999-8999-999999999999";
  const OTHER = "44444444-4444-4444-8444-444444444444";
  const tables = lifecycleTables();
  tables.organizations = [
    { id: ORG, kind: "personal" },
    { id: SECOND_PERSONAL, kind: "personal" },
    { id: SHARED_PERSONAL, kind: "personal" },
    { id: TEAM, kind: "team" },
  ];
  tables.organization_memberships = [
    { id: "m1", organization_id: ORG, profile_id: PROFILE, status: "active" },
    { id: "m2", organization_id: SECOND_PERSONAL, profile_id: PROFILE, status: "active" },
    { id: "m3", organization_id: SHARED_PERSONAL, profile_id: PROFILE, status: "active" },
    { id: "m4", organization_id: SHARED_PERSONAL, profile_id: OTHER, status: "active" },
    { id: "m5", organization_id: TEAM, profile_id: PROFILE, status: "active" },
  ];
  tables.profiles = [{ id: PROFILE, auth_user_id: "auth-user", email: "owner@airboard.test" }];
  tables.data_requests.push(deletionRequest());
  const client = createFakeSupabase(tables);
  client.authDeleteError = { status: 500, message: "auth unavailable" };
  const server = await buildApp(t, client);

  const failed = await runLifecycle(server);
  assert.equal(failed.statusCode, 500, "a failed erasure alerts");
  assert.deepEqual(failed.json().dataRequests, { completed: 0, failed: 1, storageFailures: 0 });
  assert.equal(client.tables.data_requests[0].status, "queued", "it is retried, not abandoned");
  assert.equal(client.tables.data_requests[0].attempts, 1);
  assert.equal(client.tables.data_requests[0].error_code, "AUTH_USER_DELETE_FAILED");
  assert.equal(client.tables.profiles.length, 1);

  // The retry finds the auth user already gone (an interrupted run) and finishes.
  client.authDeleteError = { status: 404, message: "User not found" };
  const retried = await runLifecycle(server);
  assert.deepEqual(retried.json().dataRequests, { completed: 1, failed: 0, storageFailures: 0 });
  assert.deepEqual(
    client.tables.organizations.map((organization) => organization.id).sort(),
    [SHARED_PERSONAL, TEAM].sort(),
    "both sole-member personal workspaces go; shared and team workspaces stay",
  );
  assert.equal(client.tables.profiles.length, 0);
});

test("account deletion gives up after repeated database failures", async (t) => {
  const tables = lifecycleTables();
  tables.organizations = [{ id: ORG, kind: "personal" }];
  tables.organization_memberships = [{ id: "m1", organization_id: ORG, profile_id: PROFILE, status: "active" }];
  tables.profiles = [{ id: PROFILE, auth_user_id: "auth-user", email: "owner@airboard.test" }];
  tables.product_events = [{ id: "e1", profile_id: PROFILE }];
  tables.data_requests.push(deletionRequest());
  const client = createFakeSupabase(tables, {
    fail: (table, op) => (table === "product_events" && op === "delete" ? { message: "statement timeout" } : null),
  });
  const server = await buildApp(t, client);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await runLifecycle(server);
    assert.equal(client.tables.data_requests[0].attempts, attempt);
  }
  assert.equal(client.tables.data_requests[0].status, "failed");
  assert.equal(client.tables.data_requests[0].error_code, "ACCOUNT_DATA_ERASE_FAILED");
  assert.deepEqual(client.deletedAuthUsers, [], "the account is never half-deleted");
  assert.equal(client.tables.profiles.length, 1);
});

test("an interrupted request is picked up again, a fresh one is left to its run", async (t) => {
  const tables = lifecycleTables();
  tables.organizations = [{ id: ORG, kind: "personal" }];
  tables.organization_memberships = [{ id: "m1", organization_id: ORG, profile_id: PROFILE, status: "active" }];
  tables.profiles = [{ id: PROFILE, auth_user_id: "auth-user", email: "owner@airboard.test" }];
  tables.data_requests.push(deletionRequest({ status: "processing", updated_at: new Date(Date.now() - 5 * 60_000).toISOString() }));
  const client = createFakeSupabase(tables);
  const server = await buildApp(t, client);

  assert.deepEqual((await runLifecycle(server)).json().dataRequests, { completed: 0, failed: 0, storageFailures: 0 });
  client.tables.data_requests[0].updated_at = new Date(Date.now() - 60 * 60_000).toISOString();
  assert.deepEqual((await runLifecycle(server)).json().dataRequests, { completed: 1, failed: 0, storageFailures: 0 });
  assert.equal(client.tables.profiles.length, 0);
});

test("workspace deletion is refused if the requester is no longer its owner", async (t) => {
  const tables = lifecycleTables();
  tables.organization_memberships = [{ id: "m1", organization_id: ORG, profile_id: PROFILE, role: "admin", status: "active" }];
  tables.data_requests.push(deletionRequest({ request_type: "delete_workspace" }));
  const client = createFakeSupabase(tables);
  const server = await buildApp(t, client);

  assert.deepEqual((await runLifecycle(server)).json().dataRequests, { completed: 0, failed: 1, storageFailures: 0 });
  assert.equal(client.tables.data_requests[0].status, "failed", "refusals are not retried");
  assert.equal(client.tables.data_requests[0].error_code, "OWNER_ROLE_REQUIRED");
  assert.equal(client.tables.organizations.length, 1);
  assert.ok(
    client.storageCalls.every((call) => !call.paths.some((path) => path.includes(BOARD))),
    "the workspace's live uploads are untouched",
  );
});

test("queued emails more than a day overdue are canceled instead of sent late", async (t) => {
  const tables = lifecycleTables();
  const overdue = { id: "job-old", status: "queued", attempts: 0, template_key: "trial_welcome", recipient_email: "a@airboard.test", send_after: new Date(Date.now() - 2 * DAY).toISOString() };
  const due = { id: "job-due", status: "queued", attempts: 0, template_key: "trial_welcome", recipient_email: "b@airboard.test", send_after: new Date(Date.now() - 60_000).toISOString() };
  const later = { id: "job-later", status: "queued", attempts: 0, template_key: "trial_expired", recipient_email: "c@airboard.test", send_after: new Date(Date.now() + DAY).toISOString() };
  tables.notification_jobs = [overdue, due, later];
  const client = createFakeSupabase(tables);
  const server = await buildApp(t, client);

  const response = await runLifecycle(server);
  assert.equal(response.statusCode, 200, response.body);
  // No email provider is configured in this test, as in the pilot.
  assert.deepEqual(response.json().notifications, { configured: false, sent: 0, failed: 0, expired: 1 });
  const status = Object.fromEntries(client.tables.notification_jobs.map((job) => [job.id, job.status]));
  assert.deepEqual(status, { "job-old": "canceled", "job-due": "queued", "job-later": "queued" });
  assert.equal(client.tables.notification_jobs.find((job) => job.id === "job-old").last_error, "NOT_SENT_IN_TIME");
});

test("an invitation returns a link the admin can share; the API keeps only its hash", async (t) => {
  const { createHash } = await import("node:crypto");
  const client = createFakeSupabase({ organization_invitations: [], notification_jobs: [], audit_events: [], product_events: [] });
  const server = await buildApp(t, client, { appUrl: "https://app.airboard.test" });
  const response = await server.inject({
    method: "POST",
    url: "/organization/invitations",
    headers: { authorization: "Bearer owner" },
    payload: { email: "new@airboard.test", role: "member" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const token = /^https:\/\/app\.airboard\.test\/invite\/([0-9a-f-]{72})$/.exec(response.json().inviteUrl)?.[1];
  assert.ok(token, response.json().inviteUrl);
  const stored = client.tables.organization_invitations[0];
  assert.equal(stored.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(token), false);
});

test("email sign-in is offered only where this deployment switches it on", async (t) => {
  const providers = async (emailSignInEnabled) => {
    const server = await buildApp(t, createFakeSupabase({}), { emailSignInEnabled });
    return (await server.inject({ method: "GET", url: "/auth/config" })).json().providers;
  };
  assert.deepEqual(await providers(false), { google: true, microsoft: false, emailMagicLink: false });
  assert.deepEqual(await providers(true), { google: true, microsoft: false, emailMagicLink: true });
});

function shareTables() {
  return {
    boards: [
      boardRow({
        title: "Checkout flow",
        owner_profile_id: PROFILE,
        latest_state: {
          elements: { a: { id: "a", kind: "shape" } },
          strokes: {},
          participants: { p1: { displayName: "Priya Raman" } },
          cursors: { p1: { x: 1, y: 2 } },
          activeStrokes: { s1: {} },
        },
      }),
      boardRow({ id: "44444444-4444-4444-8444-444444444444", owner_profile_id: "77777777-7777-4777-8777-777777777777" }),
    ],
    board_shares: [],
    board_assets: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", board_id: BOARD, organization_id: ORG, status: "ready", storage_path: `${ORG}/${BOARD}/a/one.png` },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", board_id: "44444444-4444-4444-8444-444444444444", organization_id: ORG, status: "ready", storage_path: "other.png" },
    ],
    audit_events: [],
  };
}

test("a board's owner makes a view-only link that opens the board without an account", async (t) => {
  const { createHash } = await import("node:crypto");
  const client = createFakeSupabase(shareTables());
  const server = await buildApp(t, client, { appUrl: "https://app.airboard.test", trustedProxyHops: 0 });
  const owner = { authorization: "Bearer owner" };

  const created = await server.inject({ method: "POST", url: `/boards/${BOARD}/share-links`, headers: owner, payload: {} });
  assert.equal(created.statusCode, 201, created.body);
  const token = /^https:\/\/app\.airboard\.test\/s\/([A-Za-z0-9_-]{43})$/.exec(created.json().url)?.[1];
  assert.ok(token, created.json().url);
  const stored = client.tables.board_shares[0];
  assert.equal(stored.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(stored.role, "viewer");
  assert.equal(JSON.stringify(stored).includes(token), false, "only the hash is kept");
  const days = (new Date(created.json().link.expiresAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days <= 7, "links last seven days unless asked otherwise");

  const listed = await server.inject({ method: "GET", url: `/boards/${BOARD}/share-links`, headers: owner });
  assert.deepEqual(listed.json().links.map((link) => Object.keys(link).sort()), [["createdAt", "expiresAt", "id"]]);

  const viewed = await server.inject({ method: "GET", url: `/shared-boards/${token}` });
  assert.equal(viewed.statusCode, 200, viewed.body);
  assert.equal(viewed.json().title, "Checkout flow");
  assert.deepEqual(viewed.json().state.elements, { a: { id: "a", kind: "shape" } });
  // Who joined a live session is not part of a public link.
  assert.deepEqual(viewed.json().state.participants, {});
  assert.deepEqual(viewed.json().state.cursors, {});
  assert.deepEqual(viewed.json().state.activeStrokes, {});
  assert.equal(JSON.stringify(viewed.json()).includes("Priya"), false);
  assert.equal(viewed.headers["cache-control"], "no-store");
  assert.match(viewed.headers["x-robots-tag"], /noindex/);

  // Its pictures load through the link; another board's do not.
  const image = await server.inject({ method: "GET", url: `/shared-boards/${token}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content` });
  assert.equal(image.statusCode, 302);
  assert.match(image.headers.location, /one\.png\?ttl=60$/);
  const other = await server.inject({ method: "GET", url: `/shared-boards/${token}/assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/content` });
  assert.equal(other.statusCode, 404);

  // Turning it off closes the link at once.
  const linkId = created.json().link.id;
  assert.equal((await server.inject({ method: "DELETE", url: `/boards/${BOARD}/share-links/${linkId}`, headers: owner })).statusCode, 204);
  assert.equal((await server.inject({ method: "GET", url: `/shared-boards/${token}` })).statusCode, 404);
  assert.deepEqual((await server.inject({ method: "GET", url: `/boards/${BOARD}/share-links`, headers: owner })).json().links, []);
  assert.deepEqual(client.tables.audit_events.map((event) => event.action), ["board.share_link_created", "board.share_link_revoked"]);
});

test("view-only links refuse other people's boards, expired or unknown links and deleted boards", async (t) => {
  const client = createFakeSupabase(shareTables());
  const server = await buildApp(t, client, { appUrl: "https://app.airboard.test", trustedProxyHops: 0 });
  const owner = { authorization: "Bearer owner" };

  assert.equal((await server.inject({ method: "POST", url: `/boards/${BOARD}/share-links`, payload: {} })).statusCode, 401);
  assert.equal((await server.inject({ method: "POST", url: "/boards/44444444-4444-4444-8444-444444444444/share-links", headers: owner, payload: {} })).statusCode, 404, "only the owner shares a board");
  assert.equal((await server.inject({ method: "POST", url: `/boards/${BOARD}/share-links`, headers: owner, payload: { expiresInDays: 365 } })).statusCode, 400);

  const forever = await server.inject({ method: "POST", url: `/boards/${BOARD}/share-links`, headers: owner, payload: { expiresInDays: null } });
  assert.equal(forever.json().link.expiresAt, null);
  const token = forever.json().url.split("/s/")[1];

  assert.equal((await server.inject({ method: "GET", url: "/shared-boards/not-a-token" })).statusCode, 404);
  assert.equal((await server.inject({ method: "GET", url: `/shared-boards/${"A".repeat(43)}` })).statusCode, 404);

  client.tables.board_shares[0].expires_at = new Date(Date.now() - 1_000).toISOString();
  assert.equal((await server.inject({ method: "GET", url: `/shared-boards/${token}` })).statusCode, 404, "an expired link");
  client.tables.board_shares[0].expires_at = null;
  client.tables.boards[0].deleted_at = new Date().toISOString();
  assert.equal((await server.inject({ method: "GET", url: `/shared-boards/${token}` })).statusCode, 404, "a board in Trash");
});

test("a board holds at most 20 live view-only links", async (t) => {
  const tables = shareTables();
  tables.board_shares = Array.from({ length: 20 }, (_, index) => ({
    id: `link-${index}`, board_id: BOARD, token_hash: `hash-${index}`, role: "viewer",
    expires_at: null, revoked_at: null, created_at: new Date().toISOString(),
  }));
  const server = await buildApp(t, createFakeSupabase(tables), { appUrl: "https://app.airboard.test", trustedProxyHops: 0 });
  const response = await server.inject({ method: "POST", url: `/boards/${BOARD}/share-links`, headers: { authorization: "Bearer owner" }, payload: {} });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, "SHARE_LINK_LIMIT");
});

test("/me reports a pilot that ended instead of hiding it", () => {
  const expired = { status: "expired", valid_until: "2026-11-01T00:00:00.000Z" };
  const pending = { status: "pending", valid_until: "2026-11-02T00:00:00.000Z" };
  const trialing = { status: "trialing", valid_until: "2026-10-30T00:00:00.000Z" };
  // Rows arrive newest valid_until first; a live entitlement wins over newer ended ones.
  assert.equal(accountEntitlement([expired, trialing]), trialing);
  assert.equal(accountEntitlement([expired]), expired);
  // A pending trial is reported only when nothing has started or ended.
  assert.equal(accountEntitlement([pending, expired]), expired);
  assert.equal(accountEntitlement([pending]), pending);
  assert.equal(accountEntitlement([]), null);
});

test("live sessions use the workspace's entitlement, so team members can start them", async () => {
  const MEMBER = "55555555-5555-4555-8555-555555555555";
  const tables = {
    profiles: [
      { id: PROFILE, display_name: "Owner" },
      { id: MEMBER, display_name: "Member" },
    ],
    // A team's entitlement row is held by its owner.
    entitlements: [{
      id: "entitlement-1",
      user_id: PROFILE,
      organization_id: ORG,
      plan: "team",
      status: "active",
      source: "stripe",
      valid_until: "2999-01-01T00:00:00.000Z",
    }],
    boards: [boardRow({ visibility: "organization" })],
  };
  const store = new SupabaseSessionStore(createFakeSupabase(tables));
  const started = await store.startSession({
    ownerUserId: MEMBER,
    organizationId: ORG,
    boardId: BOARD,
    provider: "standalone",
    allowParticipantDrawing: true,
  });
  assert.equal(started.session.ownerUserId, MEMBER);

  // Once the workspace's access ends, nobody in it can start one.
  tables.entitlements[0].status = "expired";
  await assert.rejects(
    store.startSession({ ownerUserId: PROFILE, organizationId: ORG, provider: "standalone", allowParticipantDrawing: true }),
    /OWNER_ENTITLEMENT_REQUIRED/,
  );
});

test("team members save, trash and restore a shared board", async (t) => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const client = createFakeSupabase({
    boards: [boardRow({ owner_profile_id: OTHER, visibility: "organization" })],
    board_versions: [],
    audit_events: [],
  });
  const server = await buildApp(t, client);
  const as = (method, url, payload) =>
    server.inject({ method, url, headers: { authorization: "Bearer owner" }, ...(payload ? { payload } : {}) });

  // The owner-scoped attempt matches nothing, so the shared-board attempt saves.
  const saved = await as("PATCH", `/boards/${BOARD}`, { version: 4, state: { nodes: ["member"] } });
  assert.equal(saved.statusCode, 200);
  assert.equal(client.tables.boards[0].latest_version, 4);
  // A stale save fails both attempts and still reports the conflict.
  const stale = await as("PATCH", `/boards/${BOARD}`, { version: 4, state: { nodes: ["stale"] } });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(client.tables.boards[0].latest_state, { nodes: ["member"] });

  assert.equal((await as("DELETE", `/boards/${BOARD}`)).statusCode, 204);
  assert.notEqual(client.tables.boards[0].deleted_at, null);
  assert.equal((await as("POST", `/boards/${BOARD}/restore`)).statusCode, 200);
  assert.equal(client.tables.boards[0].deleted_at, null);
});

test("session start reads the owner, entitlement and board together and still guards private boards", async () => {
  const MEMBER = "55555555-5555-4555-8555-555555555555";
  const tables = {
    profiles: [
      { id: PROFILE, display_name: "Owner" },
      { id: MEMBER, display_name: "Member" },
    ],
    entitlements: [{
      id: "entitlement-1",
      user_id: PROFILE,
      organization_id: ORG,
      plan: "team",
      status: "active",
      source: "stripe",
      valid_until: "2999-01-01T00:00:00.000Z",
    }],
    boards: [boardRow()],
  };
  const client = createFakeSupabase(tables);
  // Each query takes a beat, so reads that wait on one another show up as
  // separate in-flight batches.
  let inFlight = 0;
  let mostInFlight = 0;
  const from = client.from.bind(client);
  client.from = (table) => {
    const query = from(table);
    const then = query.then.bind(query);
    query.then = (resolve, reject) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      return new Promise((done) => setTimeout(done, 5))
        .then(() => { inFlight -= 1; })
        .then(() => then(resolve, reject));
    };
    return query;
  };
  const store = new SupabaseSessionStore(client);

  const started = await store.startSession({
    ownerUserId: PROFILE,
    organizationId: ORG,
    boardId: BOARD,
    provider: "standalone",
    allowParticipantDrawing: true,
  });
  assert.equal(started.session.ownerUserId, PROFILE);
  assert.equal(mostInFlight, 3);

  // The owner's private board stays closed to other members of the workspace.
  await assert.rejects(
    store.startSession({ ownerUserId: MEMBER, organizationId: ORG, boardId: BOARD, provider: "standalone", allowParticipantDrawing: true }),
    /BOARD_ACCESS_DENIED/,
  );
});

test("a session started with only the board id belongs to the board's workspace", async () => {
  const tables = {
    profiles: [{ id: PROFILE, display_name: "Owner" }],
    entitlements: [{
      id: "entitlement-1",
      user_id: PROFILE,
      organization_id: ORG,
      plan: "personal_trial",
      status: "trialing",
      source: "trial",
      valid_until: "2999-01-01T00:00:00.000Z",
    }],
    boards: [boardRow()],
  };
  const store = new SupabaseSessionStore(createFakeSupabase(tables));
  // The board page starts the session while the board is still loading, so
  // it knows the board id but not yet its workspace.
  await store.startSession({ ownerUserId: PROFILE, organizationId: ORG, boardId: BOARD, provider: "standalone", allowParticipantDrawing: true });
  assert.equal(tables.board_sessions[0].workspace_id, boardRow().workspace_id);
  assert.equal(tables.board_sessions[0].board_id, BOARD);

  // A workspace that doesn't match the board is still refused.
  await assert.rejects(
    store.startSession({
      ownerUserId: PROFILE,
      organizationId: ORG,
      boardId: BOARD,
      workspaceId: "66666666-6666-4666-8666-666666666666",
      provider: "standalone",
      allowParticipantDrawing: true,
    }),
    /BOARD_ACCESS_DENIED/,
  );
});

test("the library list carries a small preview of each board, and only when asked", async (t) => {
  const state = {
    elements: {
      api: { id: "api", kind: "shape", status: "active", visible: true, zIndex: 0, shapeKind: "rectangle", transform: { x: 10, y: 20, width: 100, height: 50, rotation: 0 }, content: { type: "doc", blocks: [{ type: "paragraph", runs: [{ text: "Payments API" }] }] } },
    },
  };
  const client = createFakeSupabase({ boards: [boardRow({ latest_state: state })] });
  const server = await buildApp(t, client);
  const list = (url) => server.inject({ method: "GET", url, headers: { authorization: "Bearer owner" } });

  const plain = (await list("/boards")).json().boards[0];
  assert.equal("preview" in plain, false);
  assert.equal("latest_state" in plain, false);

  const withPreview = (await list("/boards?preview=1")).json().boards[0];
  assert.equal("latest_state" in withPreview, false, "the full board content is never sent with the list");
  assert.deepEqual(withPreview.preview.text, ["Payments API"]);
  assert.deepEqual(withPreview.preview.shapes, [{ kind: "shape", x: 10, y: 20, width: 100, height: 50 }]);
});

test("the development sign-in trusts only the connection's real loopback address", async () => {
  const { isLoopbackRequest } = await import("../src/controlPlaneRoutes.ts");
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  // A caller-controlled Host header no longer counts.
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "10.0.0.5" }, hostname: "127.0.0.1.attacker.example" }), false);
  assert.equal(isLoopbackRequest({ socket: {} }), false);
});
