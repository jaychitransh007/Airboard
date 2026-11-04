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
    storage: {
      from(bucket) {
        return {
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
    auth: {
      admin: {
        async deleteUser(id) {
          fakeClient.deletedAuthUsers.push(id);
          return { data: {}, error: null };
        },
      },
    },
  };
  return fakeClient;
}

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
  or(expression) {
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
    async activeEntitlement() {
      return { status: "active" };
    },
  };
}

async function buildApp(t, client) {
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
  assert.equal(response.statusCode, 200, response.body);
  const { deletedBoards } = response.json();
  assert.equal(deletedBoards.purged, 0);
  assert.equal(deletedBoards.storageFailures, 1);
  assert.equal(deletedBoards.failures, 1);
  assert.equal(client.tables.boards.length, 3, "rows survive so a retry can erase the binaries");

  // Already-missing objects (a bucket-level 404) do not block the purge.
  client.storageError = { statusCode: "404", message: "Bucket not found" };
  const retried = (await runLifecycle(server)).json().deletedBoards;
  assert.equal(retried.purged, 1);
  assert.equal(retried.storageFailures, 0);
});

test("workspace deletion erases the organization's objects and retries on storage failure", async (t) => {
  const tables = lifecycleTables();
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
