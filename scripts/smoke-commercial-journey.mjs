import assert from "node:assert/strict";

const baseUrl = (process.env.AIRBOARD_API_URL || "http://127.0.0.1:4010").replace(/\/$/, "");
let accessToken = process.env.AIRBOARD_ACCESS_TOKEN || "";

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken && options.auth !== false) headers.set("authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
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
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} returned ${response.status}: ${text}`);
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

  await call("/me/preferences", {
    method: "PATCH",
    body: {
      overlayEnabled: true,
      neonTheme: true,
      videoEnabled: true,
      audioEnabled: true,
      personOcclusion: true,
    },
  });

  const preflight = await call("/integrations/preflight", {
    method: "POST",
    body: {
      platform: "standalone",
      eventId: `smoke-preflight-${Date.now()}`,
      checks: { canvas: true, firstAction: true },
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
  const savedBoard = (await call(`/boards/${board.id}`, {
    method: "PATCH",
    body: {
      version: 1,
      state: { nodes: [], edges: [], strokes: [], selectedIds: [], camera: { x: 0, y: 0, zoom: 1 } },
    },
  })).body.board;
  assert.equal(savedBoard.latest_version, 1);
  assert.equal((await call(`/boards/${board.id}`)).body.board.id, board.id);

  const session = (await call("/sessions/start", {
    method: "POST",
    body: {
      provider: "standalone",
      title: "Commercial journey smoke",
      workspaceId: board.workspace_id,
      boardId: board.id,
    },
  })).body;
  assert.ok(session.session.id);
  assert.equal(
    (await call(`/sessions/${session.session.id}/state?ticket=${encodeURIComponent(session.realtimeTicket)}`, { auth: false })).body.session.id,
    session.session.id,
  );

  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const installationInstanceId = crypto.randomUUID();
  const extensionLink = (await call("/integrations/extension-link", {
    method: "POST",
    body: { extensionId, installationInstanceId, version: "0.8.0" },
  })).body;
  const extension = (await call("/integrations/extension-exchange", {
    method: "POST",
    auth: false,
    body: { linkToken: extensionLink.linkToken },
  })).body;
  let installationHeaders = {
    authorization: `Bearer ${extension.installationToken}`,
    "x-airboard-extension-id": extensionId,
    "x-airboard-installation-instance-id": installationInstanceId,
    "x-airboard-bridge": "airboard-media-bridge",
    "x-airboard-bridge-protocol-version": "1",
    "x-airboard-extension-version": "0.8.0",
  };
  const extensionStatus = (await call("/integrations/extension/status", { auth: false, headers: installationHeaders })).body;
  assert.ok(extensionStatus.installation.id);
  assert.ok(extensionStatus.installationToken);
  installationHeaders = {
    ...installationHeaders,
    authorization: `Bearer ${extensionStatus.installationToken}`,
  };
  const savedSettings = (await call("/integrations/extension/settings", {
    method: "PATCH",
    auth: false,
    headers: installationHeaders,
    body: { overlayEnabled: true, neonTheme: true, videoEnabled: true, audioEnabled: true, personOcclusion: true },
  })).body.settings;
  assert.equal(savedSettings.overlayEnabled, true);
  await call("/integrations/extension/consent", {
    method: "POST",
    auth: false,
    headers: installationHeaders,
    body: { camera: true, microphone: true, voiceProcessing: true },
  });
  const verifiedComposite = await call("/integrations/extension/preflight-complete", {
    method: "POST",
    auth: false,
    headers: installationHeaders,
    body: {
      senderAttached: true,
      framesEncoded: 60,
      bytesSent: 65_536,
      extensionVersion: "0.8.0",
      meetingSessionId: `smoke-meeting-${Date.now()}`,
    },
  });
  assert.equal(verifiedComposite.body.verified, true);

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
  assert.ok((await call("/activity")).body.events.length >= 1);

  await call(`/integrations/${extensionLink.installationId}`, {
    method: "PATCH",
    body: { revoked: true },
  });
  await call(`/boards/${board.id}`, { method: "DELETE" });
  assert.ok((await call("/boards?scope=trash")).body.boards.some((item) => item.id === board.id));

  console.log(JSON.stringify({
    ok: true,
    account: me.profile.email,
    organization: me.organization.name,
    boardPersistence: "verified",
    meetingSession: "verified",
    meetInstallation: "verified-and-revoked",
    invitation: "verified-and-revoked",
    scim: "verified-and-revoked",
    privacyRequest: "verified-and-canceled",
    telemetry: "verified",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
