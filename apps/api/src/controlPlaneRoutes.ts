import { boardPreview } from "@airboard/core";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";
import { AuthService, type AccountRole, type AuthContext } from "./auth";
import { bearerToken, issueSignedToken } from "./signedTokens";
import { secretsMatch } from "./security";
import { registerBoardContentRoutes, removeBoardAssetObjects, sweepStaleBoardUploads } from "./boardContentRoutes";
import { registerBoardShareRoutes } from "./boardShareRoutes";
import { BoardAssetLifecycleError } from "./boardAssetLifecycle";
import { boardAccessFilter, canEditBoards, writeAccessibleBoard } from "./boardAccess";

/** The pilot trial lasts one month from activation. */
const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const PURGE_BOARD_BATCH = 100;
const MAX_PURGE_BATCHES_PER_ORGANIZATION = 20;
const PROFILE_ROLES: AccountRole[] = ["owner", "admin", "billing", "member", "viewer"];
const ADMIN_ROLES: AccountRole[] = ["owner", "admin"];
const BILLING_ROLES: AccountRole[] = ["owner", "admin", "billing"];
/** The product events the API records; writeProductEvent drops any other name. */
const ANALYTICS_EVENT_NAMES = new Set([
  "preflight.passed",
  "preflight.failed",
  "trial.started",
  "board.created",
  "checkout.started",
  "invite.sent",
  "invite.accepted",
]);

type JsonRecord = Record<string, unknown>;
export function registerControlPlaneRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  auth: AuthService,
): void {
  server.get("/auth/config", async () => {
    const providers = await auth.providerAvailability();
    return {
      supabaseEnabled: auth.enabled,
      developmentAccessEnabled: config.localEntitlements,
      readOnly: config.readOnly,
      // Supabase only says sign-up is open; whether a link can reach anyone
      // is this deployment's call.
      providers: { ...providers, emailMagicLink: providers.emailMagicLink && config.emailSignInEnabled },
    };
  });

  server.post("/auth/development", async (request, reply) => {
    if (!config.localEntitlements || !isLoopbackRequest(request)) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return {
      accessToken: issueSignedToken(config.sessionSigningSecret, {
        purpose: "development_access",
        sub: "local-owner",
        organizationId: "local-organization",
        ttlSeconds: 12 * 60 * 60,
      }),
      expiresIn: 12 * 60 * 60,
    };
  });

  server.get("/me", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    try {
      return await auth.account(context);
    } catch (error) {
      request.log.error({ err: error }, "account bootstrap failed");
      return reply.code(503).send({ error: "ACCOUNT_UNAVAILABLE" });
    }
  });

  server.patch<{ Body: unknown }>("/me/profile", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const displayName = boundedString(body.displayName, 1, 120);
    const locale = boundedString(body.locale, 2, 20);
    const timezone = boundedString(body.timezone, 1, 80);
    if (!displayName || !locale || !timezone) {
      return reply.code(400).send({ error: "INVALID_PROFILE" });
    }
    if (!auth.client) {
      return { updated: true };
    }
    const onboardingCompleted = body.onboardingCompleted === true;
    const { error } = await auth.client
      .from("profiles")
      .update({
        display_name: displayName,
        locale,
        timezone,
        ...(onboardingCompleted ? { onboarding_completed_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.profileId);
    if (error) return reply.code(500).send({ error: "PROFILE_UPDATE_FAILED" });
    auth.forgetProfile(context.profileId);
    await writeAudit(auth, context, request, "profile.updated", "profile", context.profileId);
    return { updated: true };
  });

  server.patch<{ Body: unknown }>("/me/preferences", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const preferences = booleanSettings(body, [
      "overlayEnabled", "neonTheme", "videoEnabled", "audioEnabled", "personOcclusion",
    ]);
    if (!Object.keys(preferences).length) return reply.code(400).send({ error: "PREFERENCE_REQUIRED" });
    if (!auth.client) return { preferences };
    const { error } = await auth.client
      .from("profiles")
      .update({ preferences, updated_at: new Date().toISOString() })
      .eq("id", context.profileId);
    if (error) return reply.code(500).send({ error: "PREFERENCE_UPDATE_FAILED" });
    await writeAudit(auth, context, request, "preferences.updated", "profile", context.profileId, {
      fields: Object.keys(preferences),
    });
    return { preferences };
  });

  server.patch<{ Body: unknown }>("/me/notifications", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const preferences = booleanSettings(record(request.body), ["product", "trial", "security", "billing"]);
    if (!Object.keys(preferences).length) return reply.code(400).send({ error: "NOTIFICATION_PREFERENCE_REQUIRED" });
    // Security and transactional billing messages cannot be disabled.
    preferences.security = true;
    preferences.billing = true;
    if (!auth.client) return { notificationPreferences: preferences };
    const { error } = await auth.client
      .from("profiles")
      .update({ notification_preferences: preferences, updated_at: new Date().toISOString() })
      .eq("id", context.profileId);
    if (error) return reply.code(500).send({ error: "NOTIFICATION_UPDATE_FAILED" });
    return { notificationPreferences: preferences };
  });

  server.get("/me/organizations", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { organizations: [] };
    const { data, error } = await auth.client
      .from("organization_memberships")
      .select("organization_id,role,status,organizations(id,name,slug,kind)")
      .eq("profile_id", context.profileId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) return reply.code(500).send({ error: "ORGANIZATION_LIST_FAILED" });
    return { organizations: data ?? [], currentOrganizationId: context.organizationId };
  });

  server.get("/me/sessions", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { sessions: [] };
    const { data, error } = await auth.client
      .from("board_sessions")
      .select("id,provider,title,status,created_at,updated_at,ended_at,board_id")
      .eq("owner_user_id", context.profileId)
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return reply.code(500).send({ error: "SESSION_LIST_FAILED" });
    return { sessions: data ?? [] };
  });

  server.delete<{ Params: { sessionId: string } }>("/me/sessions/:sessionId", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.sessionId)) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    const now = new Date().toISOString();
    const { data, error } = await auth.client.from("board_sessions")
      .update({ status: "ended", ended_at: now, updated_at: now })
      .eq("id", request.params.sessionId)
      .eq("owner_user_id", context.profileId)
      .eq("organization_id", context.organizationId)
      .select("id")
      .maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    return reply.code(204).send();
  });

  server.post<{ Params: { organizationId: string } }>("/me/organizations/:organizationId/select", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.organizationId)) {
      return reply.code(404).send({ error: "ORGANIZATION_NOT_FOUND" });
    }
    const { data: membership } = await auth.client
      .from("organization_memberships")
      .select("id")
      .eq("profile_id", context.profileId)
      .eq("organization_id", request.params.organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return reply.code(404).send({ error: "ORGANIZATION_NOT_FOUND" });
    await auth.client.from("profiles").update({ default_organization_id: request.params.organizationId }).eq("id", context.profileId);
    auth.forgetProfile(context.profileId);
    return { selected: true };
  });

  server.post<{ Body: unknown }>("/trial/activate", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) {
      return {
        status: "trialing",
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + TRIAL_DURATION_MS).toISOString(),
      };
    }
    const body = record(request.body);
    const source = boundedString(body.source, 1, 80) ?? "preflight";
    const { data: trial, error: trialError } = await auth.client
      .from("trial_eligibility")
      .select("*")
      .eq("organization_id", context.organizationId)
      .single();
    if (trialError || !trial) {
      return reply.code(409).send({ error: "TRIAL_NOT_ELIGIBLE" });
    }
    if (trial.status !== "eligible") {
      return {
        status: trial.status,
        activatedAt: trial.activated_at,
        expiresAt: trial.expires_at,
      };
    }
    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + TRIAL_DURATION_MS);
    const { data: activated, error: activationError } = await auth.client
      .from("trial_eligibility")
      .update({
        status: "activated",
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        activation_source: source,
        updated_at: activatedAt.toISOString(),
      })
      .eq("id", trial.id)
      .eq("status", "eligible")
      .select("id")
      .maybeSingle();
    if (activationError) return reply.code(500).send({ error: "TRIAL_ACTIVATION_FAILED" });
    if (!activated) return reply.code(409).send({ error: "TRIAL_ALREADY_ACTIVATED" });
    await Promise.all([
      auth.client
        .from("entitlements")
        .update({
          plan: "personal_trial",
          status: "trialing",
          source: "trial",
          starts_at: activatedAt.toISOString(),
          valid_until: expiresAt.toISOString(),
          updated_at: activatedAt.toISOString(),
        })
        .eq("organization_id", context.organizationId)
        .eq("source", "trial"),
      queueTrialNotifications(auth, context, activatedAt, expiresAt),
      writeAudit(auth, context, request, "trial.activated", "organization", context.organizationId, {
        source,
        expiresAt: expiresAt.toISOString(),
      }),
      writeProductEvent(auth, context, {
        eventId: `trial-${trial.id}`,
        eventName: "trial.started",
        occurredAt: activatedAt.toISOString(),
        properties: { source },
      }),
    ]);
    return {
      status: "trialing",
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  });

  server.get<{ Querystring: { preview?: string } }>("/boards", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { boards: [] };
    // The library asks for previews; other lists stay light and skip the
    // saved state entirely.
    const withPreview = request.query.preview === "1";
    const { data, error } = await auth.client
      .from("boards")
      .select(`id,workspace_id,title,description,latest_version,visibility,created_at,updated_at,archived_at${withPreview ? ",latest_state" : ""}`)
      .eq("organization_id", context.organizationId)
      .or(boardAccessFilter(context.profileId))
      // Boards deleted before Trash was removed wait here for the lifecycle purge.
      .is("deleted_at", null)
      // Nothing archives a board any more; boards archived before that stay hidden.
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) return reply.code(500).send({ error: "BOARD_LIST_FAILED" });
    const rows = (data ?? []) as unknown as JsonRecord[];
    if (!withPreview) return { boards: rows };
    return {
      boards: rows.map(({ latest_state: latestState, ...board }) => ({
        ...board,
        preview: boardPreview(latestState),
      })),
    };
  });

  server.post<{ Body: unknown }>("/boards", async (request, reply) => {
    const context = await requireBoardEditor(auth, request, reply);
    if (!context) return;
    const entitlement = await requireActiveEntitlement(auth, context, reply);
    if (!entitlement) return;
    const body = record(request.body);
    const title = boundedString(body.title, 1, 240) ?? "Untitled Airboard";
    if (!auth.client) {
      return reply.code(201).send({ board: { id: crypto.randomUUID(), title } });
    }
    const workspaceId =
      boundedUuid(body.workspaceId) ?? (await defaultWorkspaceId(auth, context.organizationId));
    if (!workspaceId) return reply.code(409).send({ error: "WORKSPACE_REQUIRED" });
    const { data, error } = await auth.client
      .from("boards")
      .insert({
        workspace_id: workspaceId,
        organization_id: context.organizationId,
        owner_profile_id: context.profileId,
        title,
      })
      .select("id,workspace_id,title,description,latest_version,visibility,created_at,updated_at")
      .single();
    if (error || !data) return reply.code(500).send({ error: "BOARD_CREATE_FAILED" });
    await Promise.all([
      writeAudit(auth, context, request, "board.created", "board", data.id),
      writeProductEvent(auth, context, {
        eventId: `board-created-${data.id}`,
        eventName: "board.created",
        occurredAt: new Date().toISOString(),
        properties: { workspaceId },
      }),
    ]);
    return reply.code(201).send({ board: data });
  });

  server.get<{ Params: { boardId: string } }>("/boards/:boardId", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.boardId)) {
      return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    }
    const { data, error } = await auth.client
      .from("boards")
      .select("*")
      .eq("id", request.params.boardId)
      .eq("organization_id", context.organizationId)
      .or(boardAccessFilter(context.profileId))
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    return { board: data };
  });

  server.patch<{ Params: { boardId: string }; Body: unknown }>(
    "/boards/:boardId",
    async (request, reply) => {
      const context = await requireBoardEditor(auth, request, reply);
      if (!context) return;
      if (!auth.client || !boundedUuid(request.params.boardId)) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const body = record(request.body);
      const update: JsonRecord = { updated_at: new Date().toISOString() };
      const title = boundedString(body.title, 1, 240);
      if (body.title !== undefined && !title) {
        return reply.code(400).send({ error: "INVALID_BOARD_TITLE" });
      }
      if (title) update.title = title;
      if (["private", "organization"].includes(String(body.visibility))) {
        update.visibility = body.visibility;
      }
      if (update.visibility !== undefined) {
        // Members may edit a shared board, but only its owner decides who can
        // open it; otherwise a member could make a teammate's board vanish.
        const { data: owned, error: ownerError } = await auth.client
          .from("boards")
          .select("owner_profile_id")
          .eq("id", request.params.boardId)
          .eq("organization_id", context.organizationId)
          .or(boardAccessFilter(context.profileId))
          .is("deleted_at", null)
          .maybeSingle();
        if (ownerError) return reply.code(500).send({ error: "BOARD_SAVE_FAILED" });
        if (!owned) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
        if (owned.owner_profile_id !== context.profileId) {
          return reply.code(403).send({ error: "BOARD_OWNER_ONLY" });
        }
      }
      let version: number | null = null;
      if (body.state && typeof body.state === "object") {
        const stateText = JSON.stringify(body.state);
        if (stateText.length > 2_000_000) return reply.code(413).send({ error: "BOARD_STATE_TOO_LARGE" });
        version = Number.isInteger(body.version) ? Number(body.version) : null;
        if (!version || version < 1) return reply.code(400).send({ error: "BOARD_VERSION_REQUIRED" });
        update.latest_state = body.state;
        update.latest_version = version;
      }
      const client = auth.client;
      const { data, error } = await writeAccessibleBoard(context.profileId, (scope) => {
        let boardUpdate = client
          .from("boards")
          .update(update)
          .eq("id", request.params.boardId)
          .eq("organization_id", context.organizationId)
          .filter(scope.column, scope.operator, scope.value)
          .is("deleted_at", null);
        // State saves are compare-and-swap: the client sends its last known
        // latest_version + 1 and the write lands only if nobody else saved in
        // between, so two tabs or devices cannot silently overwrite each other.
        if (version !== null) boardUpdate = boardUpdate.eq("latest_version", version - 1);
        return boardUpdate.select("id,title,latest_version,visibility,updated_at").maybeSingle();
      });
      if (!data) {
        const { data: current, error: currentError } = await auth.client
          .from("boards")
          .select("latest_version")
          .eq("id", request.params.boardId)
          .eq("organization_id", context.organizationId)
          .or(boardAccessFilter(context.profileId))
          .is("deleted_at", null)
          .maybeSingle();
        if (currentError || (error && current)) {
          request.log.error({ err: error ?? currentError }, "board save failed");
          return reply.code(500).send({ error: "BOARD_SAVE_FAILED" });
        }
        if (!current) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
        if (version !== null && current.latest_version !== version - 1) {
          return reply.code(409).send({
            error: "BOARD_VERSION_CONFLICT",
            latestVersion: current.latest_version,
          });
        }
        return reply.code(500).send({ error: "BOARD_SAVE_FAILED" });
      }
      if (title) {
        await writeAudit(auth, context, request, "board.renamed", "board", data.id);
      }
      return { board: data };
    },
  );

  // Deleting a board is permanent; there is no Trash. Its uploaded files go
  // first, so a failure leaves the board to delete again; then the row goes,
  // and the database removes its versions, share links, images and live
  // sessions with it. People still in a live session on it are told it ended
  // at their next action, when their socket finds the session gone.
  server.delete<{ Params: { boardId: string } }>("/boards/:boardId", async (request, reply) => {
    const context = await requireBoardEditor(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.boardId)) {
      return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    }
    const client = auth.client;
    const boardId = request.params.boardId;
    const { data, error } = await writeAccessibleBoard(context.profileId, (scope) => client
      .from("boards")
      .select("id")
      .eq("id", boardId)
      .eq("organization_id", context.organizationId)
      .filter(scope.column, scope.operator, scope.value)
      .is("deleted_at", null)
      .maybeSingle());
    if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    try {
      await removeBoardAssetObjects(client, { organizationId: context.organizationId, boardIds: [boardId] });
    } catch {
      return reply.code(503).send({ error: "BOARD_DELETE_FAILED" });
    }
    const { error: deleteError } = await client
      .from("boards")
      .delete()
      .eq("id", boardId)
      .eq("organization_id", context.organizationId);
    if (deleteError) return reply.code(503).send({ error: "BOARD_DELETE_FAILED" });
    await writeAudit(auth, context, request, "board.deleted", "board", boardId);
    return reply.code(204).send();
  });

  registerIntegrationRoutes(server, auth);
  registerBoardContentRoutes(server, auth, { rateLimitKeySecret: config.sessionSigningSecret });
  registerBoardShareRoutes(server, config, auth, (context, request, action, targetType, targetId, metadata) =>
    writeAudit(auth, context, request, action, targetType, targetId, metadata));
  registerOrganizationRoutes(server, config, auth);
  registerPrivacyAndTelemetryRoutes(server, auth);
  registerBillingRoutes(server, config, auth);
  registerLifecycleRoutes(server, config, auth);
}

function registerIntegrationRoutes(server: FastifyInstance, auth: AuthService) {
  server.post<{ Body: unknown }>("/integrations/preflight", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const platform = platformValue(body.platform);
    if (!platform) return reply.code(400).send({ error: "INVALID_PLATFORM" });
    const checks = record(body.checks);
    const required = platform === "standalone" ? ["canvas", "firstAction"] : ["engine", "camera", "overlay", "sender"];
    const failures = required.filter((name) => checks[name] !== true);
    const passed = failures.length === 0;
    await writeProductEvent(auth, context, {
      eventId: boundedString(body.eventId, 8, 120) ?? crypto.randomUUID(),
      eventName: passed ? "preflight.passed" : "preflight.failed",
      occurredAt: new Date().toISOString(),
      properties: { platform, failures },
    });
    if (passed && body.activateTrial !== false) {
      // The client calls /trial/activate after this response. Keeping those
      // state changes separate makes retries idempotent and observable.
      return { passed, failures, trialActivationRequired: true };
    }
    return { passed, failures, trialActivationRequired: false };
  });
}

function registerOrganizationRoutes(server: FastifyInstance, _config: ApiConfig, auth: AuthService) {
  server.get<{ Params: { token: string } }>("/invitations/:token", async (request, reply) => {
    if (!auth.client || request.params.token.length < 40 || request.params.token.length > 200) {
      return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    }
    const { data } = await auth.client
      .from("organization_invitations")
      .select("id,email,role,expires_at,accepted_at,revoked_at,organizations(name)")
      .eq("token_hash", sha256(request.params.token))
      .maybeSingle();
    if (!data || data.revoked_at || data.accepted_at || new Date(data.expires_at).getTime() <= Date.now()) {
      return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    }
    return { invitation: { role: data.role, expiresAt: data.expires_at, emailHint: maskEmail(data.email), organization: data.organizations } };
  });

  server.post<{ Params: { token: string } }>("/invitations/:token/accept", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || request.params.token.length < 40 || !context.email) {
      return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    }
    const { data: invitation } = await auth.client
      .from("organization_invitations")
      .select("id,organization_id,email,role,expires_at,accepted_at,revoked_at")
      .eq("token_hash", sha256(request.params.token))
      .maybeSingle();
    if (!invitation || invitation.revoked_at || invitation.accepted_at || new Date(invitation.expires_at).getTime() <= Date.now()) {
      return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    }
    if (invitation.email.toLowerCase() !== context.email.toLowerCase()) {
      return reply.code(403).send({ error: "INVITATION_EMAIL_MISMATCH" });
    }
    const now = new Date().toISOString();
    const { error } = await auth.client.from("organization_memberships").upsert({
      organization_id: invitation.organization_id,
      profile_id: context.profileId,
      role: invitation.role,
      status: "active",
      joined_at: now,
      updated_at: now,
    }, { onConflict: "organization_id,profile_id" });
    if (error) return reply.code(500).send({ error: "INVITATION_ACCEPT_FAILED" });
    await Promise.all([
      auth.client.from("organization_invitations").update({ accepted_at: now }).eq("id", invitation.id),
      auth.client.from("profiles").update({ default_organization_id: invitation.organization_id }).eq("id", context.profileId),
      writeAudit(auth, { ...context, organizationId: invitation.organization_id }, request, "member.joined", "profile", context.profileId, { invitationId: invitation.id }),
      writeProductEvent(auth, { ...context, organizationId: invitation.organization_id }, {
        eventId: `invite-accepted-${invitation.id}`,
        eventName: "invite.accepted",
        occurredAt: now,
        properties: { role: invitation.role },
      }),
    ]);
    auth.forgetProfile(context.profileId);
    return { accepted: true, organizationId: invitation.organization_id };
  });

  server.get("/organization/members", async (request, reply) => {
    const context = await requireRole(auth, request, reply, PROFILE_ROLES);
    if (!context) return;
    if (!auth.client) return { members: [] };
    const { data, error } = await auth.client
      .from("organization_memberships")
      .select("id,role,status,joined_at,created_at,profiles!organization_memberships_profile_id_fkey(id,email,display_name,avatar_url)")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: true });
    if (error) return reply.code(500).send({ error: "MEMBER_LIST_FAILED" });
    return { members: data ?? [] };
  });

  server.patch<{ Params: { membershipId: string }; Body: unknown }>("/organization/members/:membershipId", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.membershipId)) return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });
    const body = record(request.body);
    const role = PROFILE_ROLES.includes(String(body.role) as AccountRole) ? String(body.role) : null;
    const status = ["active", "suspended"].includes(String(body.status)) ? String(body.status) : null;
    if (!role && !status) return reply.code(400).send({ error: "MEMBERSHIP_CHANGE_REQUIRED" });
    if (role === "owner" && context.role !== "owner") return reply.code(403).send({ error: "OWNER_ROLE_REQUIRED" });
    const { data: current } = await auth.client.from("organization_memberships").select("id,profile_id,role,status")
      .eq("id", request.params.membershipId).eq("organization_id", context.organizationId).maybeSingle();
    if (!current) return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });
    if (current.role === "owner" && (role !== "owner" || status === "suspended")) {
      const { count } = await auth.client.from("organization_memberships").select("id", { count: "exact", head: true })
        .eq("organization_id", context.organizationId).eq("role", "owner").eq("status", "active");
      if ((count ?? 0) <= 1) return reply.code(409).send({ error: "LAST_OWNER_REQUIRED" });
    }
    const update = { ...(role ? { role } : {}), ...(status ? { status } : {}), updated_at: new Date().toISOString() };
    const { data, error } = await auth.client.from("organization_memberships").update(update).eq("id", current.id).select("id,role,status").single();
    if (error) return reply.code(500).send({ error: "MEMBERSHIP_UPDATE_FAILED" });
    auth.forgetProfile(current.profile_id);
    await writeAudit(auth, context, request, "member.updated", "membership", current.id, update);
    return { membership: data };
  });

  server.get("/organization/invitations", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { invitations: [] };
    const { data, error } = await auth.client.from("organization_invitations")
      .select("id,email,role,expires_at,accepted_at,revoked_at,created_at")
      .eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(100);
    if (error) return reply.code(500).send({ error: "INVITATION_LIST_FAILED" });
    return { invitations: data ?? [] };
  });

  server.post<{ Body: unknown }>("/organization/invitations", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    const body = record(request.body);
    const email = emailValue(body.email);
    const role = ["admin", "billing", "member", "viewer"].includes(String(body.role))
      ? String(body.role)
      : "member";
    if (!email || !auth.client) return reply.code(400).send({ error: "VALID_EMAIL_REQUIRED" });
    const rawToken = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const { data, error } = await auth.client
      .from("organization_invitations")
      .insert({
        organization_id: context.organizationId,
        email,
        role,
        token_hash: sha256(rawToken),
        invited_by: context.profileId,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !data) return reply.code(500).send({ error: "INVITATION_CREATE_FAILED" });
    await Promise.all([
      auth.client.from("notification_jobs").insert({
        organization_id: context.organizationId,
        profile_id: context.profileId,
        template_key: "organization_invitation",
        recipient_email: email,
        payload: { inviteUrl: `${_config.appUrl}/invite/${rawToken}`, role },
      }),
      writeAudit(auth, context, request, "member.invited", "invitation", data.id, { role }),
      writeProductEvent(auth, context, {
        eventId: `invite-${data.id}`,
        eventName: "invite.sent",
        occurredAt: new Date().toISOString(),
        properties: { role },
      }),
    ]);
    // The pilot sends no email, so the inviting admin shares this link; the
    // invitee still has to sign in as the invited address to accept it.
    return reply.code(201).send({ invitationId: data.id, expiresAt, inviteUrl: `${_config.appUrl}/invite/${rawToken}` });
  });

  server.delete<{ Params: { invitationId: string } }>("/organization/invitations/:invitationId", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.invitationId)) return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    const { data } = await auth.client.from("organization_invitations").update({ revoked_at: new Date().toISOString() })
      .eq("id", request.params.invitationId).eq("organization_id", context.organizationId).is("accepted_at", null).is("revoked_at", null)
      .select("id").maybeSingle();
    if (!data) return reply.code(404).send({ error: "INVITATION_NOT_FOUND" });
    await writeAudit(auth, context, request, "invitation.revoked", "invitation", data.id);
    return reply.code(204).send();
  });

  server.get("/organization/policies", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { policy: null };
    const { data, error } = await auth.client
      .from("organization_policies")
      .select("*")
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: "POLICY_LOOKUP_FAILED" });
    return { policy: data };
  });

  server.patch<{ Body: unknown }>("/organization/policies", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { updated: true };
    const body = record(request.body);
    const update: JsonRecord = {
      updated_by: context.profileId,
      updated_at: new Date().toISOString(),
    };
    for (const [inputKey, dbKey] of [
      ["externalGuestsAllowed", "external_guests_allowed"],
      ["voiceEnabled", "voice_enabled"],
      ["cameraEnabled", "camera_enabled"],
      ["gestureEnabled", "gesture_enabled"],
      ["exportsEnabled", "exports_enabled"],
    ] as const) {
      if (typeof body[inputKey] === "boolean") update[dbKey] = body[inputKey];
    }
    if (Array.isArray(body.allowedPlatforms)) {
      const platforms = body.allowedPlatforms.map(platformValue).filter(Boolean);
      if (platforms.length) update.allowed_platforms = platforms;
    }
    const retention = Number(body.contentRetentionDays);
    if (Number.isInteger(retention) && retention >= 1 && retention <= 3650) {
      update.content_retention_days = retention;
    }
    const { error } = await auth.client
      .from("organization_policies")
      .update(update)
      .eq("organization_id", context.organizationId);
    if (error) return reply.code(500).send({ error: "POLICY_UPDATE_FAILED" });
    await writeAudit(auth, context, request, "policy.updated", "organization", context.organizationId, {
      fields: Object.keys(update).filter((key) => !["updated_by", "updated_at"].includes(key)),
    });
    return { updated: true };
  });

  server.get("/organization/audit", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { events: [] };
    const { data, error } = await auth.client
      .from("audit_events")
      .select("id,actor_type,action,target_type,target_id,request_id,metadata,occurred_at,actor_profile_id")
      .eq("organization_id", context.organizationId)
      .order("occurred_at", { ascending: false })
      .limit(250);
    if (error) return reply.code(500).send({ error: "AUDIT_LIST_FAILED" });
    return { events: data ?? [] };
  });

  server.get("/organization/usage", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { usage: { members: 1, boards: 0, sessions30d: 0 } };
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [members, boards, sessions] = await Promise.all([
      auth.client.from("organization_memberships").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).eq("status", "active"),
      auth.client.from("boards").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).is("deleted_at", null),
      auth.client.from("board_sessions").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).gte("created_at", since),
    ]);
    return { usage: { members: members.count ?? 0, boards: boards.count ?? 0, sessions30d: sessions.count ?? 0 } };
  });
}

function registerPrivacyAndTelemetryRoutes(server: FastifyInstance, auth: AuthService) {
  server.post<{ Body: unknown }>("/leads", async (request, reply) => {
    const body = record(request.body);
    // A filled website field is a bot honeypot; return the same response so it
    // cannot be used to tune spam submissions.
    if (boundedString(body.website, 1, 500)) return reply.code(202).send({ accepted: true });
    const email = emailValue(body.email);
    const name = boundedString(body.name, 1, 120);
    const company = boundedString(body.company, 1, 160);
    const useCase = boundedString(body.useCase, 3, 1_000);
    if (!email || !name || !company || !useCase) return reply.code(400).send({ error: "LEAD_DETAILS_REQUIRED" });
    if (!auth.client) return reply.code(202).send({ accepted: true });
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const { data: existing } = await auth.client.from("marketing_leads").select("id")
      .eq("email", email).eq("source", boundedString(body.source, 1, 80) ?? "contact_sales")
      .gte("created_at", recent).limit(1).maybeSingle();
    if (!existing) {
      const { error } = await auth.client.from("marketing_leads").insert({
        email,
        name,
        company,
        company_size_band: boundedString(body.companySizeBand, 1, 40),
        use_case: useCase,
        source: boundedString(body.source, 1, 80) ?? "contact_sales",
        ip_hash: sha256(request.ip).slice(0, 24),
        request_id: request.id,
      });
      if (error) return reply.code(500).send({ error: "LEAD_SAVE_FAILED" });
    }
    return reply.code(202).send({ accepted: true });
  });

  server.post<{ Body: unknown }>("/consents", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const consentType = boundedString(body.consentType, 2, 80);
    const allowed = ["terms", "privacy", "cookies_analytics", "camera", "microphone", "voice_processing", "support_diagnostics"];
    if (!consentType || !allowed.includes(consentType) || typeof body.granted !== "boolean") {
      return reply.code(400).send({ error: "INVALID_CONSENT" });
    }
    if (!auth.client) return reply.code(201).send({ recorded: true });
    const { data, error } = await auth.client
      .from("consent_records")
      .insert({
        profile_id: context.profileId,
        organization_id: context.organizationId,
        consent_type: consentType,
        document_version: boundedString(body.documentVersion, 1, 40) ?? "2026-07-18",
        granted: body.granted,
        source: boundedString(body.source, 1, 80) ?? "web_app",
        user_agent_summary: summarizeUserAgent(request.headers["user-agent"]),
      })
      .select("id,created_at")
      .single();
    if (error) return reply.code(500).send({ error: "CONSENT_SAVE_FAILED" });
    await writeAudit(auth, context, request, "consent.recorded", "consent", data.id, {
      consentType,
      granted: body.granted,
    });
    return reply.code(201).send({ recorded: true, consent: data });
  });

  server.post<{ Body: unknown }>("/support/diagnostics", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const diagnostics = sanitizeDiagnostics(record(body.diagnostics));
    const includesContent = body.includesContent === true;
    if (includesContent && body.explicitContentConsent !== true) {
      return reply.code(400).send({ error: "CONTENT_DIAGNOSTIC_CONSENT_REQUIRED" });
    }
    if (!auth.client) return reply.code(201).send({ id: crypto.randomUUID(), expiresAt: null });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const { data, error } = await auth.client
      .from("diagnostic_bundles")
      .insert({
        organization_id: context.organizationId,
        profile_id: context.profileId,
        board_session_id: boundedUuid(body.boardSessionId),
        includes_content: includesContent,
        diagnostics,
        expires_at: expiresAt,
      })
      .select("id,expires_at")
      .single();
    if (error) return reply.code(500).send({ error: "DIAGNOSTIC_CREATE_FAILED" });
    await writeAudit(auth, context, request, "diagnostic.created", "diagnostic_bundle", data.id, {
      includesContent,
    });
    return reply.code(201).send({ id: data.id, expiresAt: data.expires_at });
  });

  server.post<{ Body: unknown }>("/support/requests", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const category = boundedString(body.category, 2, 40) ?? "product";
    const subject = boundedString(body.subject, 3, 160);
    const message = boundedString(body.message, 10, 10_000);
    if (!subject || !message) return reply.code(400).send({ error: "SUPPORT_DETAILS_REQUIRED" });
    if (!auth.client) return reply.code(201).send({ id: crypto.randomUUID(), status: "open" });
    const { data, error } = await auth.client.from("support_requests").insert({
      organization_id: context.organizationId,
      profile_id: context.profileId,
      category,
      subject,
      message,
      request_id: request.id,
    }).select("id,status,created_at").single();
    if (error || !data) return reply.code(500).send({ error: "SUPPORT_REQUEST_FAILED" });
    await writeAudit(auth, context, request, "support.requested", "support_request", data.id, { category });
    return reply.code(201).send(data);
  });

  server.get("/privacy/data-requests", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { requests: [] };
    const { data, error } = await auth.client.from("data_requests")
      .select("id,request_type,status,error_code,requested_at,execute_after,completed_at")
      .eq("profile_id", context.profileId)
      .order("requested_at", { ascending: false })
      .limit(50);
    if (error) return reply.code(500).send({ error: "DATA_REQUEST_LIST_FAILED" });
    return { requests: data ?? [] };
  });

  server.post<{ Body: unknown }>("/privacy/data-requests", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const requestBody = record(request.body);
    const requestType = String(requestBody.requestType);
    if (!["export", "delete_account", "delete_workspace"].includes(requestType)) {
      return reply.code(400).send({ error: "INVALID_DATA_REQUEST" });
    }
    // Erasing a whole workspace removes every member's boards: owners only.
    if (requestType === "delete_workspace" && !auth.hasRole(context, ["owner"])) {
      return reply.code(403).send({ error: "OWNER_ROLE_REQUIRED" });
    }
    if (requestType.startsWith("delete_") && requestBody.confirmation !== "DELETE") {
      return reply.code(400).send({ error: "DELETION_CONFIRMATION_REQUIRED" });
    }
    if (!auth.client) return reply.code(202).send({ id: crypto.randomUUID(), status: "queued" });
    const executeAfter = requestType === "export"
      ? new Date().toISOString()
      : new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data, error } = await auth.client
      .from("data_requests")
      .insert({
        organization_id: context.organizationId,
        profile_id: context.profileId,
        request_type: requestType,
        execute_after: executeAfter,
      })
      .select("id,status,requested_at,execute_after")
      .single();
    if (error) return reply.code(500).send({ error: "DATA_REQUEST_FAILED" });
    await writeAudit(auth, context, request, "data_request.created", "data_request", data.id, {
      requestType,
    });
    return reply.code(202).send(data);
  });

  server.delete<{ Params: { requestId: string } }>("/privacy/data-requests/:requestId", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.requestId)) return reply.code(404).send({ error: "DATA_REQUEST_NOT_FOUND" });
    const { data, error } = await auth.client.from("data_requests").update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", request.params.requestId).eq("profile_id", context.profileId).eq("status", "queued")
      .select("id").maybeSingle();
    if (error || !data) return reply.code(409).send({ error: "DATA_REQUEST_NOT_CANCELABLE" });
    return reply.code(204).send();
  });

  server.get<{ Params: { requestId: string } }>("/privacy/data-requests/:requestId/export", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.requestId)) return reply.code(404).send({ error: "EXPORT_NOT_FOUND" });
    const { data } = await auth.client.from("data_requests").select("status,result,completed_at")
      .eq("id", request.params.requestId).eq("profile_id", context.profileId).eq("request_type", "export").maybeSingle();
    if (!data) return reply.code(404).send({ error: "EXPORT_NOT_FOUND" });
    if (data.status !== "completed" || !data.result) return reply.code(409).send({ error: "EXPORT_NOT_READY" });
    reply.header("Content-Disposition", `attachment; filename=airboard-data-${request.params.requestId}.json`);
    return { exportedAt: data.completed_at, ...record(data.result) };
  });
}

function registerBillingRoutes(server: FastifyInstance, config: ApiConfig, auth: AuthService) {
  server.get("/commercial/config", async () => {
    const checkoutEnabled = Boolean(
      config.stripe.enabled &&
      config.stripe.secretKey &&
      config.stripe.webhookSecret &&
      config.stripe.personalPriceId &&
      config.stripe.teamPriceId,
    );
    return {
      releaseStage: checkoutEnabled ? "paid_pilot" : "controlled_pilot",
      checkoutEnabled,
      billingPortalEnabled: Boolean(config.stripe.secretKey && auth.client),
      plans: {
        personal: { currency: "USD", monthlyAmount: 12 },
        team: { currency: "USD", monthlyAmount: 18, unit: "member" },
      },
    };
  });

  server.post<{ Body: unknown }>("/billing/checkout", async (request, reply) => {
    const context = await requireRole(auth, request, reply, BILLING_ROLES);
    if (!context) return;
    if (!config.stripe.enabled || !config.stripe.secretKey || !config.stripe.webhookSecret) {
      return reply.code(503).send({ error: "BILLING_NOT_CONFIGURED" });
    }
    const plan = String(record(request.body).plan ?? "personal");
    const priceId = plan === "team" ? config.stripe.teamPriceId : config.stripe.personalPriceId;
    if (!priceId) return reply.code(503).send({ error: "PRICE_NOT_CONFIGURED" });
    const seatQuantity = plan === "team" ? boundedInteger(record(request.body).seats, 1, 10_000) ?? 1 : 1;
    const params = new URLSearchParams({
      mode: "subscription",
      success_url: `${config.appUrl}/app/billing?checkout=success`,
      cancel_url: `${config.appUrl}/pricing?checkout=canceled`,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": String(seatQuantity),
      "metadata[organization_id]": context.organizationId,
      "metadata[profile_id]": context.profileId,
      "subscription_data[metadata][organization_id]": context.organizationId,
      "subscription_data[metadata][profile_id]": context.profileId,
      allow_promotion_codes: "true",
      billing_address_collection: "auto",
      client_reference_id: context.organizationId,
    });
    if (context.email) params.set("customer_email", context.email);
    const response = await stripeRequest(config, "/v1/checkout/sessions", params);
    if (!response.ok) return reply.code(502).send({ error: "CHECKOUT_CREATE_FAILED" });
    const session = (await response.json()) as { id?: string; url?: string };
    if (!session.url) return reply.code(502).send({ error: "CHECKOUT_URL_MISSING" });
    await Promise.all([
      writeAudit(auth, context, request, "billing.checkout_started", "checkout", session.id ?? null, {
        plan,
        seats: seatQuantity,
      }),
      writeProductEvent(auth, context, {
        eventId: `checkout-${session.id ?? crypto.randomUUID()}`,
        eventName: "checkout.started",
        occurredAt: new Date().toISOString(),
        properties: { plan, seats: seatQuantity },
      }),
    ]);
    return { checkoutUrl: session.url };
  });

  server.post("/billing/portal", async (request, reply) => {
    const context = await requireRole(auth, request, reply, BILLING_ROLES);
    if (!context) return;
    if (!config.stripe.secretKey || !auth.client) {
      return reply.code(503).send({ error: "BILLING_NOT_CONFIGURED" });
    }
    const { data: customer } = await auth.client
      .from("billing_customers")
      .select("external_customer_id")
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (!customer?.external_customer_id) return reply.code(404).send({ error: "BILLING_CUSTOMER_NOT_FOUND" });
    const response = await stripeRequest(
      config,
      "/v1/billing_portal/sessions",
      new URLSearchParams({
        customer: customer.external_customer_id,
        return_url: `${config.appUrl}/app/billing`,
      }),
    );
    if (!response.ok) return reply.code(502).send({ error: "PORTAL_CREATE_FAILED" });
    const portal = (await response.json()) as { url?: string };
    return { portalUrl: portal.url };
  });

  server.post<{ Body: unknown }>("/webhooks/stripe", async (request, reply) => {
    if (!config.stripe.webhookSecret || !auth.client) {
      return reply.code(503).send({ error: "STRIPE_WEBHOOK_NOT_CONFIGURED" });
    }
    const raw = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string" || !stripeSignatureValid(raw, signature, config.stripe.webhookSecret)) {
      return reply.code(400).send({ error: "INVALID_STRIPE_SIGNATURE" });
    }
    let event: JsonRecord;
    try {
      event = JSON.parse(raw) as JsonRecord;
    } catch {
      return reply.code(400).send({ error: "INVALID_WEBHOOK_BODY" });
    }
    const eventId = boundedString(event.id, 4, 200);
    const eventType = boundedString(event.type, 3, 160);
    if (!eventId || !eventType) return reply.code(400).send({ error: "INVALID_STRIPE_EVENT" });
    const { data: existing } = await auth.client
      .from("webhook_inbox")
      .select("id,status")
      .eq("provider", "stripe")
      .eq("external_event_id", eventId)
      .maybeSingle();
    if (existing?.status === "processed" || existing?.status === "ignored") return { received: true };
    const { data: inbox, error: inboxError } = await auth.client
      .from("webhook_inbox")
      .upsert(
        {
          provider: "stripe",
          external_event_id: eventId,
          event_type: eventType,
          payload: event,
          status: "received",
        },
        { onConflict: "provider,external_event_id" },
      )
      .select("id,attempts")
      .single();
    if (inboxError || !inbox) return reply.code(500).send({ error: "WEBHOOK_PERSIST_FAILED" });
    try {
      const handled = await processStripeEvent(config, auth, eventType, event);
      await auth.client
        .from("webhook_inbox")
        .update({
          status: handled ? "processed" : "ignored",
          attempts: Number(inbox.attempts ?? 0) + 1,
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", inbox.id);
      return { received: true };
    } catch (error) {
      await auth.client
        .from("webhook_inbox")
        .update({
          status: "failed",
          attempts: Number(inbox.attempts ?? 0) + 1,
          last_error: error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN",
        })
        .eq("id", inbox.id);
      request.log.error({ err: error, stripeEventId: eventId }, "stripe webhook processing failed");
      return reply.code(500).send({ error: "WEBHOOK_PROCESSING_FAILED" });
    }
  });
}

function registerLifecycleRoutes(server: FastifyInstance, config: ApiConfig, auth: AuthService) {
  server.post("/internal/lifecycle/run", async (request, reply) => {
    if (!secretsMatch(bearerToken(request.headers), config.cronSecret)) {
      return reply.code(401).send({ error: "CRON_AUTH_REQUIRED" });
    }
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const now = new Date().toISOString();
    const { data: expiredTrials, error: trialError } = await auth.client
      .from("trial_eligibility")
      .update({ status: "expired", updated_at: now })
      .eq("status", "activated")
      .lt("expires_at", now)
      .select("organization_id");
    if (trialError) return reply.code(500).send({ error: "TRIAL_SWEEP_FAILED" });
    const organizationIds = (expiredTrials ?? []).map((row) => row.organization_id);
    if (organizationIds.length) {
      await auth.client
        .from("entitlements")
        .update({ status: "expired", updated_at: now })
        .in("organization_id", organizationIds)
        .eq("source", "trial");
    }
    const dataRequests = await processDataRequests(auth);
    const delivered = await deliverNotifications(config, auth);
    await expireDiagnostics(auth);
    const operationalData = await expireOperationalData(auth);
    const deletedBoards = await purgeExpiredDeletedBoards(auth);
    // Uploads started but never finished, in every organization.
    const abandonedUploads = auth.client
      ? await sweepStaleBoardUploads(auth.client)
      : { removed: 0, failures: 0 };
    const summary = {
      expiredTrials: organizationIds.length,
      dataRequests,
      notifications: delivered,
      operationalData,
      deletedBoards,
      abandonedUploads,
    };
    // Any failed step fails the run, so Cloud Scheduler logs the attempt as an
    // error (no alert is set up). Every step is retried on the next run.
    const failures = lifecycleFailureCount(summary);
    if (failures > 0) return reply.code(500).send({ error: "LIFECYCLE_STEP_FAILED", failures, ...summary });
    return summary;
  });
}

// Every erasure step is safe to repeat, so a failed request goes back on the
// queue for the next lifecycle run and is marked failed only after this many
// attempts.
const DATA_REQUEST_MAX_ATTEMPTS = 5;
// A request still "processing" after this long was interrupted (the instance
// stopped mid-run) and is picked up again.
const DATA_REQUEST_STALE_MS = 30 * 60_000;

/** A request that must not run, now or on a retry. */
class DataRequestRefused extends Error {}

/** Supabase reports a failed query in its result; erasure must never read that as success. */
function mustSucceed<T extends { error: unknown }>(result: T, code: string): T {
  if (result.error) throw new Error(code);
  return result;
}

async function processDataRequests(auth: AuthService) {
  if (!auth.client) return { completed: 0, failed: 0, storageFailures: 0 };
  const client = auth.client;
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - DATA_REQUEST_STALE_MS).toISOString();
  const [queued, stalled] = await Promise.all([
    client.from("data_requests").select("*")
      .eq("status", "queued").lte("execute_after", now).order("requested_at", { ascending: true }).limit(10),
    client.from("data_requests").select("*")
      .eq("status", "processing").lt("updated_at", staleBefore).order("requested_at", { ascending: true }).limit(10),
  ]);
  if (queued.error || stalled.error) return { completed: 0, failed: 1, storageFailures: 0 };
  let completed = 0;
  let failed = 0;
  let storageFailures = 0;
  for (const item of [...(stalled.data ?? []), ...(queued.data ?? [])]) {
    // Claim the request; when two runs overlap, only one gets it.
    let claim = client.from("data_requests").update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", item.id).eq("status", item.status);
    if (item.status === "processing") claim = claim.lt("updated_at", staleBefore);
    const { data: claimed } = await claim.select("id").maybeSingle();
    if (!claimed) continue;
    try {
      if (item.request_type === "export") {
        const profile = await client.from("profiles")
          .select("id,email,display_name,avatar_url,locale,timezone,preferences,notification_preferences,created_at")
          .eq("id", item.profile_id)
          .single();
        mustSucceed(profile, "EXPORT_PROFILE_LOOKUP_FAILED");
        const profileEmail = profile.data?.email ?? "";
        const sections = await Promise.all([
          client.from("organization_memberships").select("organization_id,role,status,joined_at,organizations(name,slug,kind)").eq("profile_id", item.profile_id),
          client.from("boards").select("id,workspace_id,title,description,latest_state,latest_version,visibility,archived_at,deleted_at,created_at,updated_at").eq("organization_id", item.organization_id).eq("owner_profile_id", item.profile_id).limit(500),
          client.from("consent_records").select("consent_type,document_version,granted,source,created_at").eq("profile_id", item.profile_id),
          client.from("support_requests").select("category,subject,message,status,created_at,updated_at").eq("profile_id", item.profile_id),
          client.from("product_events").select("event_name,properties,occurred_at,received_at").eq("profile_id", item.profile_id).limit(5_000),
          client.from("audit_events").select("actor_type,action,target_type,target_id,metadata,occurred_at").eq("actor_profile_id", item.profile_id).limit(5_000),
          client.from("notification_jobs").select("template_key,status,send_after,created_at,sent_at").eq("profile_id", item.profile_id).limit(1_000),
          client.from("marketing_leads").select("name,email,company,company_size_band,use_case,source,status,created_at").eq("email", profileEmail).limit(100),
        ]);
        // An export with a silently missing section would look complete.
        if (sections.some((section) => section.error)) throw new Error("EXPORT_QUERY_FAILED");
        const [memberships, boards, consents, supportRequests, productEvents, auditEvents, notifications, leads] = sections;
        const result = {
          // 3: installations left with the extension (12 Nov 2026).
          schemaVersion: 3,
          profile: profile.data,
          memberships: memberships.data ?? [],
          boards: boards.data ?? [],
          consents: consents.data ?? [],
          supportRequests: supportRequests.data ?? [],
          productEvents: productEvents.data ?? [],
          auditEvents: auditEvents.data ?? [],
          notifications: notifications.data ?? [],
          leads: leads.data ?? [],
        };
        mustSucceed(
          await client.from("data_requests").update({ status: "completed", result, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id),
          "EXPORT_SAVE_FAILED",
        );
      } else if (item.request_type === "delete_workspace") {
        // The requester may have lost the owner role during the
        // cancellation window.
        const { data: membership, error: membershipError } = await client.from("organization_memberships")
          .select("role").eq("organization_id", item.organization_id).eq("profile_id", item.profile_id).eq("status", "active").maybeSingle();
        if (membershipError) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
        if (membership?.role !== "owner") throw new DataRequestRefused("OWNER_ROLE_REQUIRED");
        // Uploaded binaries first: board_assets rows cascade with the
        // organization, the bucket objects do not.
        await removeBoardAssetObjects(client, { organizationId: item.organization_id });
        mustSucceed(await client.from("support_requests").delete().eq("organization_id", item.organization_id), "SUPPORT_REQUEST_DELETE_FAILED");
        // The request row cascades with the organization.
        mustSucceed(await client.from("organizations").delete().eq("id", item.organization_id), "ORGANIZATION_DELETE_FAILED");
      } else {
        const { data: profile, error: profileError } = await client.from("profiles").select("auth_user_id,email").eq("id", item.profile_id).maybeSingle();
        if (profileError) throw new Error("PROFILE_LOOKUP_FAILED");
        const soleWorkspaces = await personalWorkspacesOnlyMember(client, item.profile_id, item.organization_id);
        // Erase those workspaces' uploads before anything irreversible (the
        // auth user) so a storage failure retries cleanly.
        for (const organizationId of soleWorkspaces) {
          await removeBoardAssetObjects(client, { organizationId });
        }
        const erased = await Promise.all([
          client.from("support_requests").delete().eq("profile_id", item.profile_id),
          client.from("product_events").delete().eq("profile_id", item.profile_id),
          client.from("audit_events").update({
            actor_profile_id: null,
            ip_hash: null,
            user_agent_summary: null,
            metadata: {},
          }).eq("actor_profile_id", item.profile_id),
          ...(profile?.email
            ? [client.from("marketing_leads").delete().eq("email", profile.email)]
            : []),
        ]);
        if (erased.some((step) => step.error)) throw new Error("ACCOUNT_DATA_ERASE_FAILED");
        if (profile?.auth_user_id) {
          const { error } = await client.auth.admin.deleteUser(profile.auth_user_id);
          // A retry after an interrupted run finds the auth user already gone.
          if (error && error.status !== 404) throw new Error("AUTH_USER_DELETE_FAILED");
        }
        if (soleWorkspaces.length) {
          mustSucceed(await client.from("organizations").delete().in("id", soleWorkspaces), "ORGANIZATION_DELETE_FAILED");
        }
        // Last, because the request row cascades with the profile: until
        // here, a failure leaves the request to be retried.
        mustSucceed(await client.from("profiles").delete().eq("id", item.profile_id), "PROFILE_DELETE_FAILED");
        auth.forgetProfile(item.profile_id);
      }
      completed += 1;
    } catch (error) {
      if (error instanceof BoardAssetLifecycleError) {
        // Nothing was deleted yet; requeue so the next lifecycle run retries
        // instead of leaving orphaned binaries behind a "failed" request.
        await client.from("data_requests").update({
          status: "queued",
          error_code: error.code,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        storageFailures += 1;
        continue;
      }
      const attempts = (Number(item.attempts) || 0) + 1;
      const giveUp = error instanceof DataRequestRefused || attempts >= DATA_REQUEST_MAX_ATTEMPTS;
      await client.from("data_requests").update({
        status: giveUp ? "failed" : "queued",
        attempts,
        error_code: error instanceof Error ? error.message.slice(0, 80) : "PROCESSING_FAILED",
        ...(giveUp ? { completed_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed += 1;
    }
  }
  return { completed, failed, storageFailures };
}

/**
 * The personal workspaces that would be left with no member once this
 * profile goes: the one the request was filed from and any other the
 * account is the last active member of. They are erased with the account.
 */
async function personalWorkspacesOnlyMember(
  client: NonNullable<AuthService["client"]>,
  profileId: string,
  requestOrganizationId: string,
): Promise<string[]> {
  const { data: memberships, error } = await client.from("organization_memberships")
    .select("organization_id").eq("profile_id", profileId).eq("status", "active");
  if (error) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  const candidates = [...new Set([requestOrganizationId, ...(memberships ?? []).map((row) => String(row.organization_id))])];
  const [personal, others] = await Promise.all([
    client.from("organizations").select("id").in("id", candidates).eq("kind", "personal"),
    client.from("organization_memberships").select("organization_id")
      .in("organization_id", candidates).eq("status", "active").neq("profile_id", profileId),
  ]);
  if (personal.error || others.error) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  const shared = new Set((others.data ?? []).map((row) => String(row.organization_id)));
  return (personal.data ?? []).map((row) => String(row.id)).filter((id) => !shared.has(id));
}

async function requireAuth(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const context = await auth.authenticate(request);
  if (!context) {
    reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  return context;
}

async function requireRole(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
  roles: AccountRole[],
): Promise<AuthContext | null> {
  const context = await requireAuth(auth, request, reply);
  if (!context) return null;
  if (!auth.hasRole(context, roles)) {
    reply.code(403).send({ error: "ROLE_REQUIRED" });
    return null;
  }
  return context;
}

/** Board changes need an editing role; Viewer and Billing members only read. */
async function requireBoardEditor(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const context = await requireAuth(auth, request, reply);
  if (!context) return null;
  if (!canEditBoards(context.role)) {
    reply.code(403).send({ error: "BOARD_READ_ONLY_ROLE" });
    return null;
  }
  return context;
}

async function requireActiveEntitlement(
  auth: AuthService,
  context: AuthContext,
  reply: FastifyReply,
): Promise<JsonRecord | null> {
  const entitlement = await auth.activeEntitlement(context.organizationId);
  if (!entitlement) {
    reply.code(402).send({ error: "ACTIVE_ENTITLEMENT_REQUIRED" });
    return null;
  }
  return entitlement;
}

async function defaultWorkspaceId(auth: AuthService, organizationId: string): Promise<string | null> {
  if (!auth.client) return null;
  const { data } = await auth.client
    .from("workspaces")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .maybeSingle();
  return data?.id ?? null;
}

async function writeAudit(
  auth: AuthService,
  context: AuthContext,
  request: FastifyRequest,
  action: string,
  targetType?: string,
  targetId?: string | null,
  metadata: JsonRecord = {},
) {
  if (!auth.client) return;
  await auth.client.from("audit_events").insert({
    organization_id: context.organizationId,
    actor_profile_id: context.profileId,
    actor_type: "user",
    action,
    target_type: targetType,
    target_id: targetId,
    request_id: request.id,
    ip_hash: sha256(request.ip).slice(0, 24),
    user_agent_summary: summarizeUserAgent(request.headers["user-agent"]),
    metadata,
  });
}

async function writeProductEvent(
  auth: AuthService,
  context: AuthContext,
  event: {
    eventId: string;
    eventName: string;
    occurredAt: string;
    properties: JsonRecord;
  },
) {
  if (!auth.client || !ANALYTICS_EVENT_NAMES.has(event.eventName)) return;
  await auth.client.from("product_events").upsert(
    {
      event_id: event.eventId,
      profile_id: context.profileId,
      organization_id: context.organizationId,
      event_name: event.eventName,
      schema_version: 1,
      properties: event.properties,
      occurred_at: event.occurredAt,
    },
    { onConflict: "event_id", ignoreDuplicates: true },
  );
}

async function queueTrialNotifications(
  auth: AuthService,
  context: AuthContext,
  activatedAt: Date,
  expiresAt: Date,
) {
  if (!auth.client || !context.email) return;
  const jobs = [
    { template_key: "trial_welcome", send_after: activatedAt.toISOString() },
    {
      template_key: "trial_24_hours_remaining",
      send_after: new Date(expiresAt.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    },
    {
      template_key: "trial_6_hours_remaining",
      send_after: new Date(expiresAt.getTime() - 6 * 60 * 60 * 1_000).toISOString(),
    },
    { template_key: "trial_expired", send_after: expiresAt.toISOString() },
  ];
  await auth.client.from("notification_jobs").insert(
    jobs.map((job) => ({
      organization_id: context.organizationId,
      profile_id: context.profileId,
      recipient_email: context.email,
      payload: { displayName: context.displayName, expiresAt: expiresAt.toISOString() },
      ...job,
    })),
  );
}

// An email that could not go out within a day of its time is canceled, not
// sent late: without an email provider (the pilot has none) queued reminders
// and invitations would otherwise pile up and all go out the day one is added.
const NOTIFICATION_STALE_MS = 24 * 60 * 60 * 1_000;

async function deliverNotifications(config: ApiConfig, auth: AuthService) {
  if (!auth.client) return { configured: false, sent: 0, failed: 0, expired: 0 };
  const { data: expiredJobs, error: expireError } = await auth.client
    .from("notification_jobs")
    .update({ status: "canceled", last_error: "NOT_SENT_IN_TIME" })
    .eq("status", "queued")
    .lt("send_after", new Date(Date.now() - NOTIFICATION_STALE_MS).toISOString())
    .select("id");
  const expired = expiredJobs?.length ?? 0;
  if (!config.email.resendApiKey) return { configured: false, sent: 0, failed: expireError ? 1 : 0, expired };
  const { data: jobs } = await auth.client
    .from("notification_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("send_after", new Date().toISOString())
    .order("send_after", { ascending: true })
    .limit(50);
  let sent = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    await auth.client.from("notification_jobs").update({ status: "sending" }).eq("id", job.id);
    const message = notificationMessage(job.template_key, record(job.payload));
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.email.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.email.from,
          to: [job.recipient_email],
          subject: message.subject,
          html: message.html,
        }),
        // A stalled send fails like any other and the job is retried later.
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`RESEND_${response.status}`);
      const result = (await response.json()) as { id?: string };
      await auth.client
        .from("notification_jobs")
        .update({
          status: "sent",
          attempts: Number(job.attempts) + 1,
          provider_message_id: result.id,
          sent_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      sent += 1;
    } catch (error) {
      await auth.client
        .from("notification_jobs")
        .update({
          status: Number(job.attempts) >= 4 ? "failed" : "queued",
          attempts: Number(job.attempts) + 1,
          last_error: error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN",
          send_after: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
        })
        .eq("id", job.id);
      failed += 1;
    }
  }
  return { configured: true, sent, failed: failed + (expireError ? 1 : 0), expired };
}

async function expireDiagnostics(auth: AuthService) {
  if (!auth.client) return;
  await auth.client
    .from("diagnostic_bundles")
    .update({ status: "expired", diagnostics: {} })
    .in("status", ["ready", "attached"])
    .lt("expires_at", new Date().toISOString());
}

/** Failures each lifecycle step reported; any of them fails the run. */
function lifecycleFailureCount(summary: {
  dataRequests: { failed?: number; storageFailures?: number };
  notifications: { failed?: number };
  operationalData: { failures?: number };
  deletedBoards: { failures?: number };
  abandonedUploads: { failures?: number };
}): number {
  return [
    summary.dataRequests.failed,
    summary.dataRequests.storageFailures,
    summary.notifications.failed,
    summary.operationalData.failures,
    summary.deletedBoards.failures,
    summary.abandonedUploads.failures,
  ].reduce<number>((total, count) => total + (Number(count) || 0), 0);
}

async function expireOperationalData(auth: AuthService) {
  if (!auth.client) return { attempted: false };
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const results = await Promise.all([
    auth.client.from("voice_trace_events").delete().lt("expires_at", now),
    // Shared per-minute rate-limit windows (sharedRateLimit.ts), long finished.
    auth.client.from("rate_limit_windows").delete().lt("window_start", oneHourAgo),
    auth.client.from("diagnostic_bundles").delete().in("status", ["expired", "deleted"]).lt("expires_at", thirtyDaysAgo),
    auth.client.from("webhook_inbox").delete().in("status", ["processed", "ignored"]).lt("received_at", thirtyDaysAgo),
    auth.client.from("board_sessions").update({ status: "ended", ended_at: now, updated_at: now }).in("status", ["active", "owner_disconnected"]).lt("expires_at", now),
    auth.client.from("data_requests").update({ result: null, updated_at: now }).eq("request_type", "export").eq("status", "completed").lt("completed_at", sevenDaysAgo),
    auth.client.from("data_requests").delete().in("status", ["completed", "failed", "canceled"]).lt("updated_at", thirtyDaysAgo),
    auth.client.from("notification_jobs").delete().in("status", ["sent", "canceled"]).lt("created_at", thirtyDaysAgo),
    auth.client.from("product_events").delete().lt("received_at", ninetyDaysAgo),
    auth.client.from("marketing_leads").delete().lt("created_at", oneYearAgo),
    auth.client.from("support_requests").delete().in("status", ["resolved", "closed"]).lt("updated_at", oneYearAgo),
    auth.client.from("audit_events").delete().lt("occurred_at", oneYearAgo),
  ]);
  return {
    attempted: true,
    failures: results.filter((result) => result.error).length,
  };
}

async function purgeExpiredDeletedBoards(auth: AuthService) {
  const empty = { organizations: 0, purged: 0, failures: 0, assetObjects: 0, storageFailures: 0 };
  if (!auth.client) return { attempted: false, ...empty };
  const client = auth.client;
  const { data: policies, error } = await client
    .from("organization_policies")
    .select("organization_id,content_retention_days");
  if (error) {
    return { attempted: true, ...empty, failures: 1 };
  }
  let purged = 0;
  let failures = 0;
  let assetObjects = 0;
  let storageFailures = 0;
  for (const policy of policies ?? []) {
    const retentionDays = Math.min(3650, Math.max(1, Number(policy.content_retention_days ?? 30)));
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    for (let batch = 0; batch < MAX_PURGE_BATCHES_PER_ORGANIZATION; batch += 1) {
      const { data: expired, error: lookupError } = await client
        .from("boards")
        .select("id")
        .eq("organization_id", policy.organization_id)
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoff)
        .order("id", { ascending: true })
        .limit(PURGE_BOARD_BATCH);
      if (lookupError) {
        failures += 1;
        break;
      }
      const boardIds = (expired ?? [])
        .map((row) => (typeof row.id === "string" ? row.id : null))
        .filter((id): id is string => Boolean(id));
      if (boardIds.length === 0) break;
      // Erase uploaded binaries before the rows that reference them; on
      // failure keep the boards so the next lifecycle run retries the batch.
      try {
        assetObjects += await removeBoardAssetObjects(client, {
          organizationId: policy.organization_id,
          boardIds,
        });
      } catch {
        storageFailures += 1;
        failures += 1;
        break;
      }
      const { data, error: deleteError } = await client
        .from("boards")
        .delete()
        .eq("organization_id", policy.organization_id)
        .in("id", boardIds)
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoff)
        .select("id");
      if (deleteError) {
        failures += 1;
        break;
      }
      purged += data?.length ?? 0;
      if (boardIds.length < PURGE_BOARD_BATCH) break;
    }
  }
  return {
    attempted: true,
    organizations: policies?.length ?? 0,
    purged,
    failures,
    assetObjects,
    storageFailures,
  };
}

async function stripeRequest(config: ApiConfig, path: string, body: URLSearchParams) {
  return fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
}

function stripeSignatureValid(raw: string, header: string, secret: string): boolean {
  const fields = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, value] = part.trim().split("=", 2);
      return [key, value];
    }),
  );
  const timestamp = Number(fields.t);
  const signature = fields.v1;
  if (!Number.isFinite(timestamp) || !signature || Math.abs(Date.now() / 1_000 - timestamp) > 300) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(signature);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

async function processStripeEvent(config: ApiConfig, auth: AuthService, eventType: string, event: JsonRecord) {
  if (!auth.client) return false;
  const data = record(record(event.data).object);
  if (eventType === "checkout.session.completed") {
    const metadata = record(data.metadata);
    const organizationId = boundedUuid(metadata.organization_id);
    if (!organizationId) throw new Error("STRIPE_ORGANIZATION_MISSING");
    const customerId = boundedString(data.customer, 3, 200);
    if (customerId) {
      await auth.client.from("billing_customers").upsert(
        {
          organization_id: organizationId,
          provider: "stripe",
          external_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      );
    }
    await auth.client.from("audit_events").insert({
      organization_id: organizationId,
      actor_type: "webhook",
      action: "billing.checkout_completed",
      target_type: "checkout",
      target_id: boundedString(data.id, 1, 200),
      metadata: {},
    });
    return true;
  }
  if (eventType.startsWith("customer.subscription.")) {
    const metadata = record(data.metadata);
    const organizationId = boundedUuid(metadata.organization_id);
    if (!organizationId) throw new Error("STRIPE_ORGANIZATION_MISSING");
    const items = Array.isArray(record(data.items).data) ? (record(data.items).data as unknown[]) : [];
    const firstItem = record(items[0]);
    const price = record(firstItem.price);
    const externalSubscriptionId = boundedString(data.id, 3, 200);
    const status = String(data.status);
    const priceId = boundedString(price.id, 3, 200);
    const planKey = priceId && priceId === config.stripe.teamPriceId
      ? "team"
      : priceId && priceId === config.stripe.personalPriceId
        ? "personal"
        : null;
    if (!externalSubscriptionId || !planKey || !["trialing", "active", "past_due", "paused", "canceled", "incomplete", "unpaid"].includes(status)) {
      throw new Error("STRIPE_SUBSCRIPTION_INVALID");
    }
    const periodStart = unixDate(data.current_period_start);
    const periodEnd = unixDate(data.current_period_end);
    await auth.client.from("billing_subscriptions").upsert(
      {
        organization_id: organizationId,
        external_subscription_id: externalSubscriptionId,
        external_price_id: priceId,
        plan_key: planKey,
        status,
        seat_quantity: boundedInteger(firstItem.quantity, 1, 100_000) ?? 1,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: data.cancel_at_period_end === true,
        canceled_at: unixDate(data.canceled_at),
        raw_summary: { collectionMethod: data.collection_method ?? null },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_subscription_id" },
    );
    const entitlementStatus = status === "active" || status === "trialing" ? "active" : status === "past_due" ? "past_due" : "canceled";
    const { data: member } = await auth.client
      .from("organization_memberships")
      .select("profile_id")
      .eq("organization_id", organizationId)
      .eq("role", "owner")
      .eq("status", "active")
      .limit(1)
      .single();
    if (!member?.profile_id) throw new Error("STRIPE_SUBSCRIPTION_OWNER_MISSING");
    await auth.client.from("entitlements").upsert(
      {
        user_id: member.profile_id,
        organization_id: organizationId,
        plan: planKey,
        status: entitlementStatus,
        source: "stripe",
        feature_key: "airboard.presenter",
        external_subscription_id: externalSubscriptionId,
        starts_at: periodStart ?? new Date().toISOString(),
        valid_until: periodEnd ?? new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_subscription_id" },
    );
    if (status === "active") {
      await auth.client
        .from("trial_eligibility")
        .update({ status: "converted", converted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .in("status", ["eligible", "activated", "expired"]);
    }
    await auth.client.from("audit_events").insert({
      organization_id: organizationId,
      actor_type: "webhook",
      action: `billing.subscription_${eventType.split(".").at(-1)}`,
      target_type: "subscription",
      target_id: externalSubscriptionId,
      metadata: { status, planKey },
    });
    return true;
  }
  return false;
}

function notificationMessage(template: string, payload: JsonRecord) {
  const name = boundedString(payload.displayName, 1, 120) ?? "there";
  const messages: Record<string, { subject: string; html: string }> = {
    trial_welcome: {
      subject: "Your one-month Airboard pilot has started",
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your free one-month Airboard pilot has started. Open Airboard and create your first board.</p>`,
    },
    trial_24_hours_remaining: {
      subject: "24 hours left in your Airboard trial",
      html: `<p>Hi ${escapeHtml(name)},</p><p>You have 24 hours left to keep presenting with Airboard.</p>`,
    },
    trial_6_hours_remaining: {
      subject: "6 hours left in your Airboard trial",
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your Airboard trial ends in about six hours. Your boards remain exportable during the grace period.</p>`,
    },
    trial_expired: {
      subject: "Your Airboard trial has ended",
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your trial has ended. Upgrade to start new presenter sessions; existing boards remain available for export during the grace period.</p>`,
    },
    organization_invitation: {
      subject: "You have been invited to Airboard",
      html: `<p>You have been invited to an Airboard workspace.</p><p><a href="${escapeHtml(String(payload.inviteUrl ?? ""))}">Accept invitation</a></p>`,
    },
  };
  return messages[template] ?? { subject: "Airboard notification", html: "<p>There is an update to your Airboard account.</p>" };
}

function sanitizeDiagnostics(input: JsonRecord): JsonRecord {
  const allowed = new Set([
    "appVersion",
    "platform",
    "browser",
    "operatingSystem",
    "permissionStates",
    "capabilities",
    "errorCodes",
    "traceIds",
    "timings",
    "featureFlags",
  ]);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, JSON.parse(JSON.stringify(value).slice(0, 20_000))]),
  );
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function boundedString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : null;
}

function boundedUuid(value: unknown): string | null {
  const text = boundedString(value, 36, 36);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function emailValue(value: unknown): string | null {
  const text = boundedString(value, 3, 320)?.toLowerCase();
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

function booleanSettings(value: unknown, keys: readonly string[]): JsonRecord {
  const input = record(value);
  return Object.fromEntries(keys.filter((key) => typeof input[key] === "boolean").map((key) => [key, input[key]]));
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@", 2);
  return `${local?.slice(0, 2) ?? ""}•••@${domain ?? ""}`;
}

function platformValue(value: unknown): string | null {
  const text = String(value);
  return ["standalone", "chrome_meet", "google_workspace", "zoom", "teams", "desktop"].includes(text)
    ? text
    : null;
}

function unixDate(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000).toISOString() : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeUserAgent(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value.replace(/[()]/g, "").slice(0, 240) : null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True only for a connection that really comes from this machine. The Host
 * header is caller-controlled, so this reads the socket's peer address and
 * compares it exactly.
 */
export function isLoopbackRequest(request: Pick<FastifyRequest, "socket">): boolean {
  return LOOPBACK_ADDRESSES.has(request.socket?.remoteAddress ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
