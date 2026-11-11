import assert from "node:assert/strict";

// Signed-in acceptance journey for the standalone web app's control plane:
// account, preferences, the board-opening preflight and pilot, a saved board
// (compare-and-swap saves, reload, rename), a live session (start, a guest on
// the live link, ticket renewal, ending it), invitations, SCIM, a privacy
// request, usage and audit, and a permanent board delete. Temporary
// credentials are revoked as it goes. Run it as a disposable account
// (AIRBOARD_ACCESS_TOKEN) against an API backed by Supabase: an in-memory API
// keeps no boards. Without a token it signs in with a local API's loopback
// development identity, which needs a profile with a workspace.

const baseUrl = (process.env.AIRBOARD_API_URL || "http://127.0.0.1:4010").replace(/\/$/, "");
let accessToken = process.env.AIRBOARD_ACCESS_TOKEN || "";

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
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  assert.equal((await call("/health", { auth: false })).body.ok, true);
  assert.equal((await call("/ready", { auth: false })).body.ready, true);

  if (!accessToken) {
    const auth = await call("/auth/development", { method: "POST", auth: false });
    accessToken = auth.body.accessToken;
  }

  const me = (await call("/me")).body;
  assert.ok(me.profile.id);
  assert.ok(me.organization.id);
  assert.ok(me.workspace.id);

  // The defaults Settings → Board preferences saves.
  const preferences = { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true };
  assert.deepEqual((await call("/me/preferences", { method: "PATCH", body: preferences })).body.preferences, preferences);

  // Opening a board sends the standalone preflight, then starts the pilot.
  const preflight = await call("/integrations/preflight", {
    method: "POST",
    body: {
      platform: "standalone",
      eventId: `smoke-preflight-${Date.now()}`,
      checks: { canvas: true, firstAction: true },
      activateTrial: true,
    },
  });
  assert.equal(preflight.body.passed, true);
  const trial = (await call("/trial/activate", {
    method: "POST",
    body: { source: "commercial_smoke" },
  })).body;
  assert.ok(["trialing", "activated"].includes(trial.status));

  const board = (await call("/boards", {
    method: "POST",
    body: { title: `Commercial journey smoke ${new Date().toISOString()}` },
  })).body.board;
  assert.ok(board.id);
  const state = { nodes: [], edges: [], strokes: [], selectedIds: [], camera: { x: 0, y: 0, zoom: 1 } };
  const savedBoard = (await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: { version: 1, state },
  })).body.board;
  assert.equal(savedBoard.latest_version, 1);
  // Saves are compare-and-swap: a tab still on version 1 is refused.
  const stale = await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: { version: 1, state: { ...state, camera: { x: 9, y: 9, zoom: 9 } } },
    expectStatus: 409,
  });
  assert.equal(stale.body.error, "BOARD_VERSION_CONFLICT");
  assert.equal(stale.body.latestVersion, 1);
  await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: { version: 2, state: { ...state, camera: { x: 0, y: 0, zoom: 1.5 } } },
  });
  const renamed = `${board.title} (renamed)`;
  assert.equal((await call(`/boards/${board.id}`, { method: "PATCH", body: { title: renamed } })).body.board.title, renamed);
  const reloaded = (await call(`/boards/${board.id}`)).body.board;
  assert.equal(reloaded.id, board.id);
  assert.equal(reloaded.title, renamed);
  assert.equal(reloaded.latest_version, 2);
  assert.equal(reloaded.latest_state.camera.zoom, 1.5);
  // The Airboards home page lists it.
  assert.ok((await call("/boards?preview=1")).body.boards.some((item) => item.id === board.id));

  const session = (await call("/sessions/start", {
    method: "POST",
    body: {
      provider: "standalone",
      title: "Commercial journey smoke",
      workspaceId: board.workspace_id,
      boardId: board.id,
    },
  })).body;
  const sessionId = session.session.id;
  assert.ok(sessionId);
  assert.ok(session.joinToken);
  const sessionState = `/sessions/${sessionId}/state?ticket=${encodeURIComponent(session.realtimeTicket)}`;
  assert.equal((await call(sessionState, { auth: false })).body.session.id, sessionId);
  // A guest opens the live link, without an account.
  const guest = (await call(`/sessions/${sessionId}/join`, {
    method: "POST",
    auth: false,
    body: { joinToken: session.joinToken, displayName: "Smoke guest" },
  })).body;
  assert.equal(guest.session.id, sessionId);
  assert.ok(guest.participant.id);
  assert.ok(guest.realtimeTicket);
  // The owner's board renews its realtime ticket before it runs out.
  const renewed = (await call(`/sessions/${sessionId}/ticket`, {
    method: "POST",
    body: { refreshToken: session.refreshToken },
  })).body;
  assert.ok(renewed.realtimeTicket);
  // Settings lists the session and ends it; its live link then admits no one.
  assert.ok((await call("/me/sessions")).body.sessions.some((item) => item.id === sessionId));
  await call(`/me/sessions/${sessionId}`, { method: "DELETE", expectStatus: 204 });
  const closed = await call(`/sessions/${sessionId}/join`, {
    method: "POST",
    auth: false,
    body: { joinToken: session.joinToken, displayName: "Late guest" },
    expectStatus: 404,
  });
  assert.equal(closed.body.error, "SESSION_NOT_JOINABLE");

  const invitation = (await call("/organization/invitations", {
    method: "POST",
    body: { email: "airboard-commercial-smoke@example.com", role: "viewer" },
  })).body;
  assert.ok(invitation.invitationId);
  assert.ok((await call("/organization/invitations")).body.invitations.length >= 1);
  await call(`/organization/invitations/${invitation.invitationId}`, { method: "DELETE" });

  const scim = (await call("/organization/scim-tokens", {
    method: "POST",
    body: { name: "Commercial journey smoke" },
  })).body;
  const scimHeaders = { authorization: `Bearer ${scim.token}` };
  assert.equal(
    (await call("/scim/v2/ServiceProviderConfig", { auth: false, headers: scimHeaders })).body.patch.supported,
    true,
  );
  const directoryUser = (await call("/scim/v2/Users", {
    method: "POST",
    auth: false,
    headers: scimHeaders,
    body: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "airboard-directory-smoke@example.com",
      displayName: "Directory Smoke",
      active: true,
    },
  })).body;
  assert.ok(directoryUser.id);
  assert.ok((await call("/scim/v2/Users?filter=userName%20eq%20%22airboard-directory-smoke%40example.com%22", {
    auth: false,
    headers: scimHeaders,
  })).body.totalResults >= 1);
  await call(`/scim/v2/Users/${directoryUser.id}`, { method: "DELETE", auth: false, headers: scimHeaders });
  await call(`/organization/scim-tokens/${scim.record.id}`, { method: "DELETE" });

  const exportRequest = (await call("/privacy/data-requests", {
    method: "POST",
    body: { requestType: "export" },
  })).body;
  await call(`/privacy/data-requests/${exportRequest.id}`, { method: "DELETE" });

  assert.ok((await call("/organization/usage")).body.usage.boards >= 1);
  assert.ok((await call("/organization/audit")).body.events.length >= 1);

  // Deleting a board is permanent (there is no Trash and no restore): it is
  // gone from its own route and the list, and its live session went with it.
  await call(`/boards/${board.id}`, { method: "DELETE", expectStatus: 204 });
  assert.equal((await call(`/boards/${board.id}`, { expectStatus: 404 })).body.error, "BOARD_NOT_FOUND");
  assert.ok(!(await call("/boards?preview=1")).body.boards.some((item) => item.id === board.id));
  await call(`/boards/${board.id}`, { method: "DELETE", expectStatus: 404 });
  await call(sessionState, { auth: false, expectStatus: 404 });

  console.log(JSON.stringify({
    ok: true,
    account: me.profile.email,
    organization: me.organization.name,
    boardPersistence: "verified",
    versionConflict: "verified",
    liveSession: "started, joined, renewed and ended",
    invitation: "verified-and-revoked",
    scim: "verified-and-revoked",
    privacyRequest: "verified-and-canceled",
    usageAndAudit: "verified",
    boardDelete: "permanent, verified gone",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
