import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import sharp from "sharp";

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

const { registerBoardContentRoutes, sweepStaleBoardUploads } = await import("../src/boardContentRoutes.ts");
const {
  DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES,
  UPLOAD_STARTS_PER_MINUTE,
} = await import("../src/boardAssetLifecycle.ts");

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "44444444-4444-4444-8444-444444444444";
const BOARD = "22222222-2222-4222-8222-222222222222";
const PROFILES = {
  owner: "33333333-3333-4333-8333-333333333331",
  member: "33333333-3333-4333-8333-333333333332",
  viewer: "33333333-3333-4333-8333-333333333333",
  billing: "33333333-3333-4333-8333-333333333334",
};
const HOUR = 60 * 60 * 1_000;

/**
 * In-memory stand-in for the supabase-js calls the board content routes make:
 * the query builder, the quota RPC (mirroring
 * supabase/migrations/20261106160000_board_asset_quota.sql) and the storage
 * bucket, with objects held as bytes.
 */
function createFakeSupabase(tables = {}) {
  const client = {
    tables: { boards: [], board_assets: [], ...tables },
    objects: new Map(),
    storageCalls: [],
    storageError: null,
    rpcError: null,
    afterRpc: null,
    onInfo: null,
    from(table) {
      return new FakeQuery(client, table);
    },
    async rpc(name, args) {
      assert.equal(name, "organization_board_asset_bytes");
      if (client.rpcError) return { data: null, error: client.rpcError };
      const bytes = client.tables.board_assets
        .filter((row) => row.organization_id === args.p_organization_id)
        .filter((row) => row.status === "pending" || row.status === "ready")
        .reduce((total, row) => total + row.byte_size, 0);
      const hook = client.afterRpc;
      client.afterRpc = null;
      hook?.();
      return { data: bytes, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "board-assets");
        return {
          async createSignedUploadUrl(path) {
            client.storageCalls.push({ op: "sign", path });
            return { data: { signedUrl: `https://storage.airboard.test/upload/${path}`, token: "t" }, error: null };
          },
          async createSignedUrl(path, ttl) {
            return { data: { signedUrl: `https://storage.airboard.test/${path}?ttl=${ttl}` }, error: null };
          },
          async info(path) {
            client.onInfo?.(path);
            const object = client.objects.get(path);
            if (!object) return { data: null, error: { statusCode: "404", message: "Object not found" } };
            return { data: { size: object.bytes.byteLength, contentType: object.contentType }, error: null };
          },
          async download(path) {
            const object = client.objects.get(path);
            if (!object) return { data: null, error: { statusCode: "404" } };
            return { data: new Blob([object.bytes]), error: null };
          },
          async upload(path, bytes, options = {}) {
            client.storageCalls.push({ op: "upload", path, upsert: options.upsert === true });
            if (client.objects.has(path) && !options.upsert) {
              return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
            }
            client.objects.set(path, { bytes: Buffer.from(bytes), contentType: options.contentType });
            return { data: { path }, error: null };
          },
          async remove(paths) {
            client.storageCalls.push({ op: "remove", paths: [...paths] });
            if (client.storageError) return { data: null, error: client.storageError };
            for (const path of paths) client.objects.delete(path);
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return client;
}

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.returning = false;
    this.columns = "*";
    this.orderBy = null;
    this.limitCount = null;
    this.singleMode = null;
  }
  select(columns = "*") {
    if (this.op !== "select") this.returning = true;
    this.columns = columns;
    return this;
  }
  insert(row) { this.op = "insert"; this.payload = row; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  lt(column, value) { this.filters.push((row) => row[column] < value); return this; }
  is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  or(expression) {
    const clauses = expression.split(",").map((clause) => {
      const [column, operator, ...rest] = clause.split(".");
      const value = rest.join(".");
      return (row) => (operator === "eq" ? String(row[column]) === value : String(row[column]) !== value);
    });
    this.filters.push((row) => clauses.some((clause) => clause(row)));
    return this;
  }
  order(column, { ascending = true } = {}) { this.orderBy = { column, ascending }; return this; }
  limit(count) { this.limitCount = count; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "single"; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }
  execute() {
    const failure = this.client.fail?.(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.client.tables[this.table];
    const matches = () => rows.filter((row) => this.filters.every((filter) => filter(row)));
    let result;
    if (this.op === "select") {
      result = matches();
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        result = [...result].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
      }
      if (this.limitCount !== null) result = result.slice(0, this.limitCount);
    } else if (this.op === "insert") {
      const row = { metadata: {}, updated_at: new Date().toISOString(), ...this.payload };
      rows.push(row);
      result = [row];
    } else if (this.op === "update") {
      result = matches();
      for (const row of result) Object.assign(row, this.payload);
    } else {
      result = matches();
      this.client.tables[this.table] = rows.filter((row) => !result.includes(row));
    }
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    const projected = result.map((row) => this.columns === "*"
      ? { ...row }
      : Object.fromEntries(this.columns.split(",").map((column) => [column, row[column]])));
    if (this.singleMode === "maybe") return { data: projected[0] ?? null, error: null };
    if (this.singleMode === "single") {
      return projected.length === 1 ? { data: projected[0], error: null } : { data: null, error: { code: "PGRST116" } };
    }
    return { data: projected, error: null };
  }
}

function fakeAuth(client) {
  return {
    client,
    async authenticate(request) {
      const role = /^Bearer (\w+)$/.exec(request.headers.authorization ?? "")?.[1];
      if (!role || !PROFILES[role]) return null;
      return {
        authUserId: `auth-${role}`,
        profileId: PROFILES[role],
        organizationId: ORG,
        role,
        email: `${role}@airboard.test`,
        displayName: role,
        tokenKind: "supabase",
      };
    },
  };
}

function boardTables(extraAssets = []) {
  return {
    boards: [{ id: BOARD, organization_id: ORG, visibility: "organization", owner_profile_id: PROFILES.owner, deleted_at: null }],
    board_assets: extraAssets,
  };
}

function assetRow(overrides = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    board_id: BOARD,
    organization_id: ORG,
    created_by: PROFILES.owner,
    kind: "image",
    mime_type: "image/png",
    byte_size: 1_000,
    original_name: "file.png",
    storage_path: `${overrides.organization_id ?? ORG}/${BOARD}/${id}/file.png`,
    status: "ready",
    metadata: {},
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function buildApp(t, client, options) {
  const server = Fastify();
  t.after(() => server.close());
  registerBoardContentRoutes(server, fakeAuth(client), options);
  return server;
}

function startUpload(server, role, body = {}) {
  return server.inject({
    method: "POST",
    url: `/boards/${BOARD}/assets/uploads`,
    headers: { authorization: `Bearer ${role}` },
    payload: { fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1_000, ...body },
  });
}

function finalize(server, role, assetId) {
  return server.inject({
    method: "POST",
    url: `/boards/${BOARD}/assets/${assetId}/finalize`,
    headers: { authorization: `Bearer ${role}` },
  });
}

test("Viewer and Billing members cannot start, finalize or delete uploads", async (t) => {
  const pending = assetRow({ status: "pending" });
  const client = createFakeSupabase(boardTables([pending]));
  client.objects.set(pending.storage_path, { bytes: Buffer.alloc(1_000), contentType: "image/png" });
  const server = await buildApp(t, client);

  for (const role of ["viewer", "billing"]) {
    const started = await startUpload(server, role);
    assert.equal(started.statusCode, 403, role);
    assert.deepEqual(started.json(), { error: "BOARD_READ_ONLY_ROLE" });

    const finalized = await finalize(server, role, pending.id);
    assert.equal(finalized.statusCode, 403, role);
    assert.deepEqual(finalized.json(), { error: "BOARD_READ_ONLY_ROLE" });

    const deleted = await server.inject({
      method: "DELETE",
      url: `/boards/${BOARD}/assets/${pending.id}`,
      headers: { authorization: `Bearer ${role}` },
    });
    assert.equal(deleted.statusCode, 403, role);
    assert.deepEqual(deleted.json(), { error: "BOARD_READ_ONLY_ROLE" });
  }
  assert.equal(client.tables.board_assets.length, 1);
  assert.equal(client.tables.board_assets[0].status, "pending");
  assert.ok(client.objects.has(pending.storage_path));
  assert.equal(client.storageCalls.length, 0);

  // Editing roles still upload.
  for (const role of ["owner", "member"]) {
    assert.equal((await startUpload(server, role)).statusCode, 201, role);
  }
});

test("each person may start 30 uploads a minute", async (t) => {
  const client = createFakeSupabase(boardTables());
  const server = await buildApp(t, client);
  assert.equal(UPLOAD_STARTS_PER_MINUTE, 30);
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await startUpload(server, "owner")).statusCode, 201);
  }
  const limited = await startUpload(server, "owner");
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), { error: "RATE_LIMITED" });
  assert.equal(client.tables.board_assets.length, 30);
  // The budget is per person, not per organization.
  assert.equal((await startUpload(server, "member")).statusCode, 201);
});

test("an upload that would take the organization past its quota is refused", async (t) => {
  const quota = DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES;
  assert.equal(quota, 2 * 1024 ** 3);
  const client = createFakeSupabase(boardTables([
    assetRow({ byte_size: quota - 5_000, status: "ready" }),
    // Failed rows hold no object; other organizations have their own quota.
    assetRow({ byte_size: 50_000_000, status: "failed" }),
    assetRow({ organization_id: OTHER_ORG, byte_size: quota }),
  ]));
  const server = await buildApp(t, client);

  const refused = await startUpload(server, "owner", { sizeBytes: 6_000 });
  assert.equal(refused.statusCode, 413);
  assert.deepEqual(refused.json(), {
    error: "ASSET_QUOTA_EXCEEDED",
    quotaBytes: quota,
    usedBytes: quota - 5_000,
  });
  assert.equal(client.tables.board_assets.length, 3);

  assert.equal((await startUpload(server, "owner", { sizeBytes: 4_000 })).statusCode, 201);
  // The pending upload reserves its bytes until it is finalized or swept.
  const full = await startUpload(server, "owner", { sizeBytes: 2_000 });
  assert.equal(full.statusCode, 413);
  assert.equal(full.json().usedBytes, quota - 1_000);
});

test("concurrent upload starts cannot overshoot the quota", async (t) => {
  const client = createFakeSupabase(boardTables());
  const server = await buildApp(t, client, { organizationAssetQuotaBytes: 10_000 });
  // Another start passes its own check while this one is between its check
  // and its insert.
  const concurrent = assetRow({ status: "pending", byte_size: 6_000 });
  client.afterRpc = () => client.tables.board_assets.push(concurrent);

  const refused = await startUpload(server, "owner", { sizeBytes: 6_000 });
  assert.equal(refused.statusCode, 413);
  assert.deepEqual(refused.json(), { error: "ASSET_QUOTA_EXCEEDED", quotaBytes: 10_000, usedBytes: 6_000 });
  assert.deepEqual(client.tables.board_assets.map((row) => row.id), [concurrent.id]);
  assert.equal(client.storageCalls.filter((call) => call.op === "sign").length, 0);
});

test("an upload is refused when the quota cannot be counted", async (t) => {
  const client = createFakeSupabase(boardTables());
  client.rpcError = { code: "PGRST202", message: "function not found" };
  const server = await buildApp(t, client);
  const refused = await startUpload(server, "owner");
  assert.equal(refused.statusCode, 503);
  assert.deepEqual(refused.json(), { error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
  assert.equal(client.tables.board_assets.length, 0);
});

test("finalize replaces an uploaded photo with a copy that has no location data", async (t) => {
  const plain = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#d04020" } })
    .jpeg()
    .toBuffer();
  const photo = await sharp(plain)
    .withExif({
      IFD0: { Make: "LeakyCam" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSMapDatum: "WGS-84" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(photo).metadata()).exif);

  const client = createFakeSupabase(boardTables());
  const server = await buildApp(t, client);
  const started = await startUpload(server, "member", { sizeBytes: photo.byteLength });
  assert.equal(started.statusCode, 201);
  const assetId = started.json().asset.id;
  const row = client.tables.board_assets.find((asset) => asset.id === assetId);
  // The browser PUTs the bytes straight to the signed URL.
  client.objects.set(row.storage_path, { bytes: photo, contentType: "image/jpeg" });

  const finalized = await finalize(server, "member", assetId);
  assert.equal(finalized.statusCode, 200, finalized.body);

  // Same path, so the original is gone and the signed URL cannot add another object.
  assert.deepEqual([...client.objects.keys()], [row.storage_path]);
  const stored = client.objects.get(row.storage_path);
  assert.equal(stored.contentType, "image/jpeg");
  const storedMetadata = await sharp(stored.bytes).metadata();
  assert.equal(storedMetadata.exif, undefined);
  assert.equal(storedMetadata.orientation, undefined);
  assert.equal(storedMetadata.width, 20);
  assert.equal(storedMetadata.height, 40);
  for (const marker of ["WGS-84", "LeakyCam", "Exif"]) {
    assert.equal(stored.bytes.includes(marker), false, marker);
  }
  assert.ok(client.storageCalls.some((call) => call.op === "upload" && call.path === row.storage_path && call.upsert));

  // The row records exactly what is stored.
  assert.equal(row.status, "ready");
  assert.equal(row.mime_type, "image/jpeg");
  assert.equal(row.byte_size, stored.bytes.byteLength);
  assert.equal(finalized.json().asset.sizeBytes, stored.bytes.byteLength);
  assert.equal(finalized.json().asset.mimeType, "image/jpeg");
  assert.equal(finalized.json().asset.metadata.metadataStripped, true);
});

test("a finalize that loses a race does not delete the winner's object", async (t) => {
  const pending = assetRow({ status: "pending", mime_type: "image/jpeg", byte_size: 500 });
  const client = createFakeSupabase(boardTables([pending]));
  // The stored object no longer matches the declared size because a
  // concurrent finalize has just replaced it and made the asset ready.
  client.objects.set(pending.storage_path, { bytes: Buffer.alloc(400), contentType: "image/jpeg" });
  client.onInfo = () => { pending.status = "ready"; };
  const server = await buildApp(t, client);

  const finalized = await finalize(server, "owner", pending.id);
  assert.equal(finalized.statusCode, 422);
  assert.deepEqual(finalized.json(), { error: "BOARD_ASSET_SIZE_MISMATCH" });
  assert.equal(pending.status, "ready");
  assert.ok(client.objects.has(pending.storage_path));
  assert.equal(client.storageCalls.filter((call) => call.op === "remove").length, 0);
});

test("a finalize that fails validation marks the asset failed and removes its object", async (t) => {
  const pending = assetRow({ status: "pending", mime_type: "image/png", byte_size: 64 });
  const client = createFakeSupabase(boardTables([pending]));
  client.objects.set(pending.storage_path, { bytes: Buffer.alloc(64, 1), contentType: "image/png" });
  const server = await buildApp(t, client);

  const finalized = await finalize(server, "owner", pending.id);
  assert.equal(finalized.statusCode, 422);
  assert.equal(pending.status, "failed");
  assert.equal(pending.metadata.failureCode, finalized.json().error);
  assert.equal(client.objects.has(pending.storage_path), false);
});

test("the lifecycle sweep removes stale uploads across organizations", async () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const stale = new Date(now - 25 * HOUR).toISOString();
  const fresh = new Date(now - 2 * HOUR).toISOString();
  const rows = [
    assetRow({ id: "a1", status: "pending", updated_at: stale }),
    assetRow({ id: "a2", status: "failed", updated_at: stale, organization_id: OTHER_ORG }),
    assetRow({ id: "a3", status: "pending", updated_at: fresh }),
    assetRow({ id: "a4", status: "ready", updated_at: stale }),
  ];
  const client = createFakeSupabase({ board_assets: rows });
  for (const row of rows) client.objects.set(row.storage_path, { bytes: Buffer.alloc(1), contentType: "image/png" });

  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 2, failures: 0 });
  assert.deepEqual(client.tables.board_assets.map((row) => row.id).sort(), ["a3", "a4"]);
  assert.deepEqual([...client.objects.keys()].sort(), [rows[2].storage_path, rows[3].storage_path].sort());
  // Nothing left to do on the next run.
  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 0, failures: 0 });
});

test("the lifecycle sweep works in bounded batches", async () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const rows = Array.from({ length: 2_100 }, (_, index) => assetRow({
    status: "pending",
    organization_id: index % 2 ? ORG : OTHER_ORG,
    updated_at: new Date(now - 30 * HOUR + index * 1_000).toISOString(),
  }));
  const client = createFakeSupabase({ board_assets: rows });

  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 2_000, failures: 0 });
  const removals = client.storageCalls.filter((call) => call.op === "remove");
  assert.equal(removals.length, 20);
  assert.ok(removals.every((call) => call.paths.length === 100));
  // Oldest first; the newest 100 wait for the next run.
  assert.deepEqual(
    client.tables.board_assets.map((row) => row.id),
    rows.slice(2_000).map((row) => row.id),
  );
  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 100, failures: 0 });
  assert.equal(client.tables.board_assets.length, 0);
});

test("a storage or lookup failure keeps stale rows for the next sweep", async () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const stale = new Date(now - 25 * HOUR).toISOString();
  const client = createFakeSupabase({
    board_assets: [assetRow({ status: "pending", updated_at: stale })],
  });

  client.storageError = { statusCode: "500", message: "storage unavailable" };
  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 0, failures: 1 });
  assert.equal(client.tables.board_assets.length, 1);

  client.storageError = null;
  client.fail = (table, op) => (table === "board_assets" && op === "select" ? { message: "db down" } : null);
  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 0, failures: 1 });
  assert.equal(client.tables.board_assets.length, 1);

  // A missing bucket means there is nothing left to erase.
  client.fail = null;
  client.storageError = { statusCode: "404", message: "Bucket not found" };
  assert.deepEqual(await sweepStaleBoardUploads(client, now), { removed: 1, failures: 0 });
  assert.equal(client.tables.board_assets.length, 0);
});
