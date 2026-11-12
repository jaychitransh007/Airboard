import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Signed-in deploy smoke for a live API. A throwaway account is created with
// the Supabase admin key, walks the entitlement, board save, version-conflict,
// reload, data-export and permanent-delete journey, and is then removed
// (organizations, profile and auth user) whether or not the journey passed.

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const baseUrl = (process.env.AIRBOARD_API_URL || "http://127.0.0.1:4010").replace(/\/$/, "");
const webOrigin = (process.env.AIRBOARD_WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
let accessToken = "";

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken && options.auth !== false) headers.set("authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const method = options.method || "GET";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const expected = options.expectStatus;
  if (expected ? response.status !== expected : !response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}${expected ? ` (expected ${expected})` : ""}: ${text}`);
  }
  return { status: response.status, body };
}

async function accessTokenFor(admin, email) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const verifier = createClient(supabaseUrl, serviceRoleKey, clientOptions);
  const verified = await verifier.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  return verified.data.session.access_token;
}

async function journey(results) {
  assert.equal((await call("/health", { auth: false })).body.ok, true);
  assert.equal((await call("/ready", { auth: false })).body.ready, true);
  const me = (await call("/me")).body;
  assert.ok(me.profile.id);
  assert.ok(me.organization.id);
  results.authentication = "verified";

  // An empty intent body is rejected only after the entitlement check, so the
  // 402 -> 400 flip proves the gate without spending a model call.
  const intent = { method: "POST", headers: { origin: webOrigin }, body: {} };
  const gated = await call("/intent/resolve", { ...intent, expectStatus: 402 });
  assert.equal(gated.body.error, "ACTIVE_ENTITLEMENT_REQUIRED");
  const trial = (await call("/trial/activate", { method: "POST", body: { source: "deploy_smoke" } })).body;
  assert.ok(["trialing", "activated"].includes(trial.status));
  await call("/intent/resolve", { ...intent, expectStatus: 400 });
  results.entitlementGate = "verified";

  const board = (await call("/boards", {
    method: "POST",
    body: { title: `Deploy smoke ${new Date().toISOString()}` },
  })).body.board;
  assert.ok(board.id);
  const state = { nodes: [], edges: [], selectedIds: [], camera: { x: 0, y: 0, zoom: 1 } };
  const first = (await call(`/boards/${board.id}`, { method: "PATCH", body: { version: 1, state } })).body.board;
  assert.equal(first.latest_version, 1);
  const stale = await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: { version: 1, state: { ...state, camera: { x: 9, y: 9, zoom: 9 } } },
    expectStatus: 409,
  });
  assert.equal(stale.body.error, "BOARD_VERSION_CONFLICT");
  assert.equal(stale.body.latestVersion, 1);
  results.versionConflict = "verified";
  await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: { version: 2, state: { ...state, camera: { x: 0, y: 0, zoom: 1.5 } } },
  });
  const reloaded = (await call(`/boards/${board.id}`)).body.board;
  assert.equal(reloaded.latest_version, 2);
  assert.equal(reloaded.latest_state.camera.zoom, 1.5);
  // The Airboards home page lists it.
  assert.ok((await call("/boards?preview=1")).body.boards.some((item) => item.id === board.id));
  results.boardPersistence = "verified";

  const exportRequest = (await call("/privacy/data-requests", {
    method: "POST",
    body: { requestType: "export" },
  })).body;
  assert.ok(exportRequest.id);
  const pending = await call(`/privacy/data-requests/${exportRequest.id}/export`, { expectStatus: 409 });
  assert.equal(pending.body.error, "EXPORT_NOT_READY");
  await call(`/privacy/data-requests/${exportRequest.id}`, { method: "DELETE" });
  results.dataExport = "request accepted; completion needs the lifecycle job";

  // Deleting a board is permanent (there is no Trash and no restore), so
  // afterwards it is gone from its own route, from the list and from a
  // second delete.
  await call(`/boards/${board.id}`, { method: "DELETE", expectStatus: 204 });
  const gone = await call(`/boards/${board.id}`, { expectStatus: 404 });
  assert.equal(gone.body.error, "BOARD_NOT_FOUND");
  assert.ok(!(await call("/boards?preview=1")).body.boards.some((item) => item.id === board.id));
  await call(`/boards/${board.id}`, { method: "DELETE", expectStatus: 404 });
  results.boardDelete = "permanent, verified gone";
}

async function removeAccount(admin, authUserId) {
  const removed = [];
  const { data: profile, error: profileError } = await admin
    .from("profiles").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (profileError) throw profileError;
  if (profile) {
    const { data: organizations, error } = await admin
      .from("organizations").delete().eq("created_by", profile.id).select("id");
    if (error) throw error;
    removed.push(`${organizations.length} organization(s)`);
    const deleted = await admin.from("profiles").delete().eq("id", profile.id);
    if (deleted.error) throw deleted.error;
    removed.push("profile");
  }
  const deleted = await admin.auth.admin.deleteUser(authUserId);
  if (deleted.error) throw deleted.error;
  removed.push("auth user");
  return `removed ${removed.join(", ")}`;
}

async function main() {
  assert.ok(supabaseUrl && serviceRoleKey, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const admin = createClient(supabaseUrl, serviceRoleKey, clientOptions);
  const email = `airboard-deploy-smoke+${Date.now()}@example.com`;
  const results = { api: baseUrl, account: email };
  let authUserId = null;
  let failure = null;
  try {
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: "Deploy smoke" },
    });
    if (created.error) throw created.error;
    authUserId = created.data.user.id;
    accessToken = await accessTokenFor(admin, email);
    await journey(results);
  } catch (error) {
    failure = error;
  }
  if (authUserId) {
    try {
      results.cleanup = await removeAccount(admin, authUserId);
    } catch (error) {
      results.cleanup = `FAILED for auth user ${authUserId}: ${error instanceof Error ? error.message : String(error)}`;
      failure ??= error;
    }
  }
  console.log(JSON.stringify({ ok: !failure, ...results }, null, 2));
  if (failure) {
    console.error(failure instanceof Error ? failure.stack : failure);
    process.exitCode = 1;
  }
}

main();
