import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";
import { AuthService, type AccountRole, type AuthContext } from "./auth";
import { bearerToken, issueSignedToken, verifySignedToken } from "./signedTokens";

const TRIAL_DURATION_MS = 72 * 60 * 60 * 1_000;
const PROFILE_ROLES: AccountRole[] = ["owner", "admin", "billing", "member", "viewer"];
const ADMIN_ROLES: AccountRole[] = ["owner", "admin"];
const BILLING_ROLES: AccountRole[] = ["owner", "admin", "billing"];
const ANALYTICS_EVENT_NAMES = new Set([
  "landing.viewed",
  "signup.started",
  "signup.completed",
  "onboarding.use_case_selected",
  "onboarding.platform_selected",
  "integration.install_started",
  "integration.install_verified",
  "preflight.passed",
  "preflight.failed",
  "trial.started",
  "board.created",
  "session.started",
  "session.successful",
  "overlay.engaged",
  "overlay.sender_verified",
  "diagram.first_action",
  "checkout.started",
  "checkout.completed",
  "invite.sent",
  "invite.accepted",
  "subscription.canceled",
]);
const FORBIDDEN_ANALYTICS_KEYS = /audio|video|transcript|meeting.?url|meeting.?title|board.?text|label|token|secret|password|content/i;

type JsonRecord = Record<string, unknown>;

export function registerControlPlaneRoutes(
  server: FastifyInstance,
  config: ApiConfig,
  auth: AuthService,
): void {
  server.get("/auth/config", async () => ({
    supabaseEnabled: auth.enabled,
    developmentAccessEnabled: config.localEntitlements,
    providers: await auth.providerAvailability(),
  }));

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
    await auth.client
      .from("platform_installations")
      .update({ settings: preferences, updated_at: new Date().toISOString() })
      .eq("installed_by", context.profileId)
      .eq("organization_id", context.organizationId)
      .neq("status", "revoked");
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

  server.get<{ Querystring: { scope?: string } }>("/boards", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { boards: [] };
    const scope = String(request.query.scope ?? "active");
    let query = auth.client
      .from("boards")
      .select("id,workspace_id,title,description,latest_version,visibility,created_at,updated_at,archived_at")
      .eq("organization_id", context.organizationId);
    if (scope === "trash") query = query.not("deleted_at", "is", null);
    else query = query.is("deleted_at", null);
    if (scope === "shared") query = query.neq("visibility", "private");
    if (scope === "archived") query = query.not("archived_at", "is", null);
    if (scope === "active") query = query.is("archived_at", null);
    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) return reply.code(500).send({ error: "BOARD_LIST_FAILED" });
    return { boards: data ?? [] };
  });

  server.post<{ Body: unknown }>("/boards", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
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
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    return { board: data };
  });

  server.patch<{ Params: { boardId: string }; Body: unknown }>(
    "/boards/:boardId",
    async (request, reply) => {
      const context = await requireAuth(auth, request, reply);
      if (!context) return;
      if (!auth.client || !boundedUuid(request.params.boardId)) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const body = record(request.body);
      const update: JsonRecord = { updated_at: new Date().toISOString() };
      const title = boundedString(body.title, 1, 240);
      if (title) update.title = title;
      if (typeof body.description === "string") update.description = body.description.slice(0, 2_000);
      if (["private", "organization", "link"].includes(String(body.visibility))) {
        update.visibility = body.visibility;
      }
      if (typeof body.archived === "boolean") update.archived_at = body.archived ? new Date().toISOString() : null;
      if (body.state && typeof body.state === "object") {
        const stateText = JSON.stringify(body.state);
        if (stateText.length > 2_000_000) return reply.code(413).send({ error: "BOARD_STATE_TOO_LARGE" });
        const version = Number.isInteger(body.version) ? Number(body.version) : null;
        if (!version || version < 1) return reply.code(400).send({ error: "BOARD_VERSION_REQUIRED" });
        update.latest_state = body.state;
        update.latest_version = version;
        const { error: versionError } = await auth.client.from("board_versions").upsert(
          {
            board_id: request.params.boardId,
            version,
            state: body.state,
            created_by: context.profileId,
          },
          { onConflict: "board_id,version", ignoreDuplicates: true },
        );
        if (versionError) return reply.code(409).send({ error: "BOARD_VERSION_CONFLICT" });
      }
      const { data, error } = await auth.client
        .from("boards")
        .update(update)
        .eq("id", request.params.boardId)
        .eq("organization_id", context.organizationId)
        .is("deleted_at", null)
        .select("id,title,latest_version,visibility,updated_at")
        .maybeSingle();
      if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      return { board: data };
    },
  );

  server.delete<{ Params: { boardId: string } }>("/boards/:boardId", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.boardId)) {
      return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    }
    const { data, error } = await auth.client
      .from("boards")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", request.params.boardId)
      .eq("organization_id", context.organizationId)
      .select("id")
      .maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    await writeAudit(auth, context, request, "board.deleted", "board", data.id);
    return reply.code(204).send();
  });

  server.post<{ Params: { boardId: string } }>("/boards/:boardId/restore", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.boardId)) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    const { data, error } = await auth.client.from("boards")
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", request.params.boardId).eq("organization_id", context.organizationId)
      .not("deleted_at", "is", null).select("id,title,updated_at").maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    await writeAudit(auth, context, request, "board.restored", "board", data.id);
    return { board: data };
  });

  registerIntegrationRoutes(server, config, auth);
  registerOrganizationRoutes(server, config, auth);
  registerPrivacyAndTelemetryRoutes(server, auth);
  registerBillingRoutes(server, config, auth);
  registerLifecycleRoutes(server, config, auth);
  registerEnterpriseRoutes(server, auth);
}

function registerIntegrationRoutes(server: FastifyInstance, config: ApiConfig, auth: AuthService) {
  server.get("/integrations", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { installations: [] };
    const { data, error } = await auth.client
      .from("platform_installations")
      .select("id,platform,status,version,settings,external_installation_id,consented_at,last_seen_at,last_success_at,last_error_code,created_at")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false });
    if (error) return reply.code(500).send({ error: "INSTALLATION_LIST_FAILED" });
    return { installations: data ?? [] };
  });

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

  server.post<{ Body: unknown }>("/integrations/extension-link", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const externalInstallationId = boundedString(body.extensionId, 8, 128);
    if (!externalInstallationId) return reply.code(400).send({ error: "EXTENSION_ID_REQUIRED" });
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const { data: installation, error } = await auth.client
      .from("platform_installations")
      .upsert(
        {
          organization_id: context.organizationId,
          installed_by: context.profileId,
          platform: "chrome_meet",
          external_installation_id: externalInstallationId,
          status: "pending",
          version: boundedString(body.version, 1, 40),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,platform,external_installation_id" },
      )
      .select("id")
      .single();
    if (error || !installation) return reply.code(500).send({ error: "INSTALLATION_LINK_FAILED" });
    const linkToken = issueSignedToken(config.sessionSigningSecret, {
      purpose: "installation_link",
      sub: context.profileId,
      organizationId: context.organizationId,
      installationId: installation.id,
      ttlSeconds: 10 * 60,
    });
    await writeAudit(auth, context, request, "installation.link_started", "installation", installation.id);
    return { linkToken, installationId: installation.id, expiresIn: 600 };
  });

  server.post<{ Body: unknown }>("/integrations/extension-exchange", async (request, reply) => {
    const body = record(request.body);
    const linkToken = boundedString(body.linkToken, 20, 4_096);
    const claims = linkToken
      ? verifySignedToken(config.sessionSigningSecret, linkToken, "installation_link")
      : null;
    if (!claims?.installationId || !claims.organizationId || !auth.client) {
      return reply.code(401).send({ error: "INVALID_LINK_TOKEN" });
    }
    const installationToken = issueSignedToken(config.sessionSigningSecret, {
      purpose: "installation",
      sub: claims.sub,
      organizationId: claims.organizationId,
      installationId: claims.installationId,
      ttlSeconds: 90 * 24 * 60 * 60,
    });
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
    const { error } = await auth.client
      .from("platform_installations")
      .update({
        status: "connected",
        token_hash: sha256(installationToken),
        previous_token_hash: null,
        previous_token_expires_at: null,
        token_expires_at: expiresAt,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", claims.installationId)
      .eq("organization_id", claims.organizationId);
    if (error) return reply.code(500).send({ error: "INSTALLATION_EXCHANGE_FAILED" });
    return { installationToken, expiresIn: 90 * 24 * 60 * 60, expiresAt };
  });

  server.get("/integrations/extension/status", async (request, reply) => {
    const installation = await requireInstallation(config, auth, request, reply);
    if (!installation) return;
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const refreshedToken = issueSignedToken(config.sessionSigningSecret, {
      purpose: "installation",
      sub: installation.profileId,
      organizationId: installation.organizationId,
      installationId: installation.installationId,
      ttlSeconds: 90 * 24 * 60 * 60,
    });
    const refreshedExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
    const { error: refreshError } = await auth.client
      .from("platform_installations")
      .update({
        previous_token_hash: installation.presentedTokenHash,
        previous_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        token_hash: sha256(refreshedToken),
        token_expires_at: refreshedExpiresAt,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", installation.installationId)
      .eq("organization_id", installation.organizationId);
    if (refreshError) return reply.code(503).send({ error: "INSTALLATION_TOKEN_REFRESH_FAILED" });
    const [installationResult, policyResult, entitlementResult] = await Promise.all([
      auth.client
        .from("platform_installations")
        .select("id,status,version,settings,consented_at,last_error_code")
        .eq("id", installation.installationId)
        .single(),
      auth.client
        .from("organization_policies")
        .select("*")
        .eq("organization_id", installation.organizationId)
        .maybeSingle(),
      auth.client
        .from("entitlements")
        .select("plan,status,valid_until")
        .eq("organization_id", installation.organizationId)
        .in("status", ["pending", "trialing", "grace", "active", "past_due"])
        .order("valid_until", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (installationResult.error) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    return {
      installation: installationResult.data,
      policy: policyResult.data,
      entitlement: entitlementResult.data,
      installationToken: refreshedToken,
      tokenExpiresAt: refreshedExpiresAt,
      serverTime: new Date().toISOString(),
    };
  });

  server.patch<{ Body: unknown }>("/integrations/extension/settings", async (request, reply) => {
    const installation = await requireInstallation(config, auth, request, reply);
    if (!installation) return;
    const settings = booleanSettings(record(request.body), [
      "overlayEnabled", "neonTheme", "videoEnabled", "audioEnabled", "personOcclusion",
    ]);
    if (!Object.keys(settings).length) return reply.code(400).send({ error: "INSTALLATION_SETTING_REQUIRED" });
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const [currentResult, policyResult] = await Promise.all([
      auth.client.from("platform_installations").select("settings").eq("id", installation.installationId).eq("organization_id", installation.organizationId).maybeSingle(),
      auth.client.from("organization_policies").select("allowed_platforms,camera_enabled,voice_enabled,gesture_enabled").eq("organization_id", installation.organizationId).maybeSingle(),
    ]);
    if (currentResult.error || !currentResult.data) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    const policy = policyResult.data;
    const allowedPlatform = !policy || !Array.isArray(policy.allowed_platforms) || policy.allowed_platforms.includes("chrome_meet");
    const nextSettings = { ...(record(currentResult.data.settings)), ...settings };
    if (!allowedPlatform) nextSettings.overlayEnabled = false;
    if (policy?.camera_enabled === false) {
      nextSettings.videoEnabled = false;
      nextSettings.personOcclusion = false;
    }
    if (policy?.voice_enabled === false) nextSettings.audioEnabled = false;
    const { data, error } = await auth.client
      .from("platform_installations")
      .update({ settings: nextSettings, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", installation.installationId)
      .eq("organization_id", installation.organizationId)
      .select("id,settings")
      .maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    return { settings: data.settings };
  });

  server.patch<{ Params: { installationId: string }; Body: unknown }>("/integrations/:installationId", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.installationId)) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    const settings = booleanSettings(record(request.body).settings, ["overlayEnabled", "neonTheme", "videoEnabled", "audioEnabled", "personOcclusion"]);
    const status = record(request.body).revoked === true ? "revoked" : undefined;
    if (!Object.keys(settings).length && !status) return reply.code(400).send({ error: "INSTALLATION_CHANGE_REQUIRED" });
    const update: JsonRecord = { updated_at: new Date().toISOString(), ...(Object.keys(settings).length ? { settings } : {}), ...(status ? { status, token_hash: null, token_expires_at: null, previous_token_hash: null, previous_token_expires_at: null } : {}) };
    const { data, error } = await auth.client.from("platform_installations").update(update)
      .eq("id", request.params.installationId).eq("organization_id", context.organizationId)
      .select("id,status,settings").maybeSingle();
    if (error || !data) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    await writeAudit(auth, context, request, status ? "installation.revoked" : "installation.settings_updated", "installation", data.id);
    return { installation: data };
  });

  server.post<{ Body: unknown }>("/integrations/extension/consent", async (request, reply) => {
    const installation = await requireInstallation(config, auth, request, reply);
    if (!installation) return;
    const body = record(request.body);
    if (body.camera !== true || body.microphone !== true || body.voiceProcessing !== true) {
      return reply.code(400).send({ error: "AFFIRMATIVE_CONSENT_REQUIRED" });
    }
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const consentedAt = new Date().toISOString();
    const { data: installRow, error } = await auth.client
      .from("platform_installations")
      .update({ consented_at: consentedAt, updated_at: consentedAt })
      .eq("id", installation.installationId)
      .select("installed_by")
      .single();
    if (error || !installRow?.installed_by) return reply.code(500).send({ error: "CONSENT_SAVE_FAILED" });
    await auth.client.from("consent_records").insert(
      ["camera", "microphone", "voice_processing"].map((consentType) => ({
        profile_id: installRow.installed_by,
        organization_id: installation.organizationId,
        installation_id: installation.installationId,
        consent_type: consentType,
        document_version: "2026-07-18",
        granted: true,
        source: "chrome_extension_popup",
      })),
    );
    return { consented: true, consentedAt };
  });

  server.post<{ Body: unknown }>(
    "/integrations/extension/preflight-complete",
    async (request, reply) => {
      const installation = await requireInstallation(config, auth, request, reply);
      if (!installation) return;
      const body = record(request.body);
      const framesEncoded = boundedInteger(body.framesEncoded, 1, 1_000_000_000);
      const outboundBytes = boundedInteger(body.bytesSent, 1, Number.MAX_SAFE_INTEGER);
      if (body.senderAttached !== true || !framesEncoded || !outboundBytes || !auth.client) {
        return reply.code(400).send({ error: "VERIFIED_OUTBOUND_COMPOSITE_REQUIRED" });
      }
      const now = new Date();
      const { data: installationRow, error: installationError } = await auth.client
        .from("platform_installations")
        .update({
          status: "connected",
          version: boundedString(body.extensionVersion, 1, 40),
          last_success_at: now.toISOString(),
          last_seen_at: now.toISOString(),
          last_error_code: null,
          updated_at: now.toISOString(),
        })
        .eq("id", installation.installationId)
        .not("consented_at", "is", null)
        .select("installed_by")
        .maybeSingle();
      if (installationError || !installationRow?.installed_by) {
        return reply.code(409).send({ error: "MEDIA_CONSENT_REQUIRED" });
      }
      const { data: trial } = await auth.client
        .from("trial_eligibility")
        .select("id,status")
        .eq("organization_id", installation.organizationId)
        .maybeSingle();
      let trialExpiresAt: string | null = null;
      if (trial?.status === "eligible") {
        trialExpiresAt = new Date(now.getTime() + TRIAL_DURATION_MS).toISOString();
        const { data: activated } = await auth.client
          .from("trial_eligibility")
          .update({
            status: "activated",
            activated_at: now.toISOString(),
            expires_at: trialExpiresAt,
            activation_source: "chrome_meet_sender_verified",
            updated_at: now.toISOString(),
          })
          .eq("id", trial.id)
          .eq("status", "eligible")
          .select("id")
          .maybeSingle();
        if (activated) {
          await auth.client
            .from("entitlements")
            .update({
              plan: "personal_trial",
              status: "trialing",
              source: "trial",
              starts_at: now.toISOString(),
              valid_until: trialExpiresAt,
              updated_at: now.toISOString(),
            })
            .eq("organization_id", installation.organizationId)
            .eq("source", "trial");
          const { data: profile } = await auth.client
            .from("profiles")
            .select("email,display_name")
            .eq("id", installationRow.installed_by)
            .maybeSingle();
          if (profile?.email) {
            await auth.client.from("notification_jobs").insert([
              {
                organization_id: installation.organizationId,
                profile_id: installationRow.installed_by,
                template_key: "trial_welcome",
                recipient_email: profile.email,
                payload: { displayName: profile.display_name, expiresAt: trialExpiresAt },
                send_after: now.toISOString(),
              },
              {
                organization_id: installation.organizationId,
                profile_id: installationRow.installed_by,
                template_key: "trial_24_hours_remaining",
                recipient_email: profile.email,
                payload: { displayName: profile.display_name, expiresAt: trialExpiresAt },
                send_after: new Date(new Date(trialExpiresAt).getTime() - 24 * 60 * 60 * 1_000).toISOString(),
              },
              {
                organization_id: installation.organizationId,
                profile_id: installationRow.installed_by,
                template_key: "trial_6_hours_remaining",
                recipient_email: profile.email,
                payload: { displayName: profile.display_name, expiresAt: trialExpiresAt },
                send_after: new Date(new Date(trialExpiresAt).getTime() - 6 * 60 * 60 * 1_000).toISOString(),
              },
              {
                organization_id: installation.organizationId,
                profile_id: installationRow.installed_by,
                template_key: "trial_expired",
                recipient_email: profile.email,
                payload: { displayName: profile.display_name, expiresAt: trialExpiresAt },
                send_after: trialExpiresAt,
              },
            ]);
          }
        }
      }
      await Promise.all([
        auth.client.from("product_events").upsert(
          {
            event_id: `extension-preflight-${installation.installationId}`,
            profile_id: installationRow.installed_by,
            organization_id: installation.organizationId,
            installation_id: installation.installationId,
            event_name: "preflight.passed",
            schema_version: 1,
            properties: { platform: "chrome_meet", senderAttached: true },
            occurred_at: now.toISOString(),
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        ),
        auth.client.from("audit_events").insert({
          organization_id: installation.organizationId,
          actor_profile_id: installationRow.installed_by,
          actor_type: "system",
          action: "installation.preflight_passed",
          target_type: "installation",
          target_id: installation.installationId,
          request_id: request.id,
          metadata: { platform: "chrome_meet" },
        }),
      ]);
      return { verified: true, trialExpiresAt };
    },
  );
}

function registerOrganizationRoutes(server: FastifyInstance, _config: ApiConfig, auth: AuthService) {
  server.patch<{ Body: unknown }>("/organization", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    const body = record(request.body);
    const update: JsonRecord = { updated_at: new Date().toISOString() };
    const name = boundedString(body.name, 1, 160);
    if (name) update.name = name;
    if (["personal", "team", "enterprise"].includes(String(body.kind))) update.kind = body.kind;
    const companySizeBand = boundedString(body.companySizeBand, 1, 40);
    const countryCode = boundedString(body.countryCode, 2, 2);
    const billingEmail = emailValue(body.billingEmail);
    const securityContactEmail = emailValue(body.securityContactEmail);
    if (companySizeBand) update.company_size_band = companySizeBand;
    if (countryCode) update.country_code = countryCode.toUpperCase();
    if (billingEmail) update.billing_email = billingEmail;
    if (securityContactEmail) update.security_contact_email = securityContactEmail;
    if (Object.keys(update).length === 1) return reply.code(400).send({ error: "ORGANIZATION_FIELD_REQUIRED" });
    if (!auth.client) return { updated: true };
    const { error } = await auth.client.from("organizations").update(update).eq("id", context.organizationId);
    if (error) return reply.code(500).send({ error: "ORGANIZATION_UPDATE_FAILED" });
    await writeAudit(auth, context, request, "organization.updated", "organization", context.organizationId, {
      fields: Object.keys(update).filter((key) => key !== "updated_at"),
    });
    return { updated: true };
  });

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
    return reply.code(201).send({ invitationId: data.id, expiresAt });
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
    if (!auth.client) return { usage: { members: 1, boards: 0, sessions30d: 0, installations: 0 } };
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [members, boards, sessions, installations] = await Promise.all([
      auth.client.from("organization_memberships").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).eq("status", "active"),
      auth.client.from("boards").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).is("deleted_at", null),
      auth.client.from("board_sessions").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).gte("created_at", since),
      auth.client.from("platform_installations").select("id", { count: "exact", head: true }).eq("organization_id", context.organizationId).neq("status", "revoked"),
    ]);
    return { usage: { members: members.count ?? 0, boards: boards.count ?? 0, sessions30d: sessions.count ?? 0, installations: installations.count ?? 0 } };
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

  server.post<{ Body: unknown }>("/analytics/events", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const body = record(request.body);
    const eventName = boundedString(body.eventName, 2, 80);
    const eventId = boundedString(body.eventId, 8, 120);
    const properties = record(body.properties);
    if (!eventName || !eventId || !ANALYTICS_EVENT_NAMES.has(eventName)) {
      return reply.code(400).send({ error: "INVALID_ANALYTICS_EVENT" });
    }
    if (!analyticsPropertiesAllowed(properties)) {
      return reply.code(400).send({ error: "SENSITIVE_ANALYTICS_PROPERTY" });
    }
    await writeProductEvent(auth, context, {
      eventId,
      eventName,
      occurredAt: isoDate(body.occurredAt) ?? new Date().toISOString(),
      properties,
      ...(boundedUuid(body.installationId)
        ? { installationId: boundedUuid(body.installationId) as string }
        : {}),
      ...(boundedUuid(body.boardSessionId)
        ? { boardSessionId: boundedUuid(body.boardSessionId) as string }
        : {}),
    });
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
        installation_id: boundedUuid(body.installationId),
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

  server.get("/activity", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    if (!auth.client) return { events: [] };
    const { data, error } = await auth.client.from("product_events")
      .select("event_id,event_name,properties,occurred_at,board_session_id,installation_id")
      .eq("organization_id", context.organizationId)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (error) return reply.code(500).send({ error: "ACTIVITY_LIST_FAILED" });
    return { events: data ?? [] };
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
    if (requestType === "delete_workspace" && !auth.hasRole(context, ADMIN_ROLES)) {
      return reply.code(403).send({ error: "ADMIN_ROLE_REQUIRED" });
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
  server.post<{ Body: unknown }>("/billing/checkout", async (request, reply) => {
    const context = await requireRole(auth, request, reply, BILLING_ROLES);
    if (!context) return;
    if (!config.stripe.secretKey) return reply.code(503).send({ error: "BILLING_NOT_CONFIGURED" });
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
    if (!config.cronSecret || bearerToken(request.headers) !== config.cronSecret) {
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
    await expireOperationalData(auth);
    return { expiredTrials: organizationIds.length, dataRequests, notifications: delivered };
  });
}

function registerEnterpriseRoutes(server: FastifyInstance, auth: AuthService) {
  server.get("/organization/identity-provider", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { identityProvider: null };
    const { data, error } = await auth.client.from("identity_provider_configs")
      .select("id,protocol,metadata_url,entity_id,domains,enforced,status,last_error_code,created_at,updated_at")
      .eq("organization_id", context.organizationId).maybeSingle();
    if (error) return reply.code(500).send({ error: "IDENTITY_PROVIDER_LOOKUP_FAILED" });
    return { identityProvider: data };
  });

  server.patch<{ Body: unknown }>("/organization/identity-provider", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    const body = record(request.body);
    const protocol = ["saml", "oidc"].includes(String(body.protocol)) ? String(body.protocol) : "saml";
    const metadataUrl = httpsUrl(body.metadataUrl);
    const entityId = boundedString(body.entityId, 3, 500);
    const domains = Array.isArray(body.domains)
      ? [...new Set(body.domains.map(domainValue).filter((value): value is string => Boolean(value)))].slice(0, 20)
      : [];
    if (!metadataUrl || !domains.length) return reply.code(400).send({ error: "IDENTITY_PROVIDER_DETAILS_REQUIRED" });
    if (!auth.client) return { identityProvider: { protocol, metadata_url: metadataUrl, entity_id: entityId, domains, status: "pending_verification" } };
    const { data, error } = await auth.client.from("identity_provider_configs").upsert({
      organization_id: context.organizationId,
      protocol,
      metadata_url: metadataUrl,
      entity_id: entityId,
      domains,
      enforced: body.enforced === true,
      // Enforcement remains off until the deployment operator activates the
      // matching Supabase SSO provider; this prevents an admin lockout.
      status: "pending_verification",
      updated_by: context.profileId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" }).select("id,protocol,metadata_url,entity_id,domains,enforced,status,updated_at").single();
    if (error || !data) return reply.code(500).send({ error: "IDENTITY_PROVIDER_SAVE_FAILED" });
    await writeAudit(auth, context, request, "identity_provider.configured", "identity_provider", data.id, { protocol, domains });
    return { identityProvider: data };
  });

  server.get("/organization/scim-tokens", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client) return { tokens: [] };
    const { data, error } = await auth.client.from("scim_access_tokens")
      .select("id,name,token_prefix,status,last_used_at,expires_at,created_at,revoked_at")
      .eq("organization_id", context.organizationId).order("created_at", { ascending: false });
    if (error) return reply.code(500).send({ error: "SCIM_TOKEN_LIST_FAILED" });
    return { tokens: data ?? [] };
  });

  server.post<{ Body: unknown }>("/organization/scim-tokens", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    const name = boundedString(record(request.body).name, 1, 100) ?? "Directory provisioner";
    if (!auth.client) return reply.code(503).send({ error: "CONTROL_PLANE_UNAVAILABLE" });
    const token = `airboard_scim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const { data, error } = await auth.client.from("scim_access_tokens").insert({
      organization_id: context.organizationId,
      name,
      token_prefix: token.slice(0, 22),
      token_hash: sha256(token),
      created_by: context.profileId,
      expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }).select("id,name,token_prefix,status,expires_at,created_at").single();
    if (error || !data) return reply.code(500).send({ error: "SCIM_TOKEN_CREATE_FAILED" });
    await writeAudit(auth, context, request, "scim_token.created", "scim_token", data.id);
    return reply.code(201).send({ token, record: data, scimBaseUrl: "/scim/v2" });
  });

  server.delete<{ Params: { tokenId: string } }>("/organization/scim-tokens/:tokenId", async (request, reply) => {
    const context = await requireRole(auth, request, reply, ADMIN_ROLES);
    if (!context) return;
    if (!auth.client || !boundedUuid(request.params.tokenId)) return reply.code(404).send({ error: "SCIM_TOKEN_NOT_FOUND" });
    const { data } = await auth.client.from("scim_access_tokens").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", request.params.tokenId).eq("organization_id", context.organizationId).eq("status", "active").select("id").maybeSingle();
    if (!data) return reply.code(404).send({ error: "SCIM_TOKEN_NOT_FOUND" });
    await writeAudit(auth, context, request, "scim_token.revoked", "scim_token", data.id);
    return reply.code(204).send();
  });

  server.get("/scim/v2/ServiceProviderConfig", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory) return;
    reply.type("application/scim+json");
    return { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Organization-scoped Airboard SCIM token", specUri: "https://www.rfc-editor.org/rfc/rfc6750", primary: true }] };
  });

  server.get<{ Querystring: { startIndex?: string; count?: string; filter?: string } }>("/scim/v2/Users", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory || !auth.client) return;
    const startIndex = Math.max(1, boundedInteger(request.query.startIndex, 1, 1_000_000) ?? 1);
    const count = boundedInteger(request.query.count, 1, 200) ?? 100;
    let query = auth.client.from("directory_users").select("*", { count: "exact" }).eq("organization_id", directory.organizationId);
    const filteredEmail = scimEmailFilter(request.query.filter);
    if (filteredEmail) query = query.eq("email", filteredEmail);
    const { data, error, count: total } = await query.order("created_at", { ascending: true }).range(startIndex - 1, startIndex + count - 2);
    if (error) return scimError(reply, 500, "Unable to list directory users");
    reply.type("application/scim+json");
    return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: total ?? 0, startIndex, itemsPerPage: data?.length ?? 0, Resources: (data ?? []).map(scimUser) };
  });

  server.post<{ Body: unknown }>("/scim/v2/Users", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory || !auth.client) return;
    const body = record(request.body);
    const email = emailValue(body.userName);
    if (!email) return scimError(reply, 400, "userName must be a valid email", "invalidValue");
    const role = scimRole(body);
    const { data, error } = await auth.client.from("directory_users").upsert({
      organization_id: directory.organizationId,
      external_id: boundedString(body.externalId, 1, 240),
      email,
      display_name: boundedString(body.displayName, 1, 160) ?? email.split("@")[0],
      role,
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,email" }).select("*").single();
    if (error || !data) return scimError(reply, 409, "Directory user conflicts with an existing record", "uniqueness");
    reply.type("application/scim+json").header("Location", `/scim/v2/Users/${data.id}`);
    return reply.code(201).send(scimUser(data));
  });

  server.get<{ Params: { userId: string } }>("/scim/v2/Users/:userId", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory || !auth.client || !boundedUuid(request.params.userId)) return;
    const { data } = await auth.client.from("directory_users").select("*").eq("id", request.params.userId).eq("organization_id", directory.organizationId).maybeSingle();
    if (!data) return scimError(reply, 404, "User not found");
    reply.type("application/scim+json");
    return scimUser(data);
  });

  server.patch<{ Params: { userId: string }; Body: unknown }>("/scim/v2/Users/:userId", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory || !auth.client || !boundedUuid(request.params.userId)) return;
    const body = record(request.body);
    const update: JsonRecord = { updated_at: new Date().toISOString() };
    const operations = Array.isArray(body.Operations) ? body.Operations.map(record) : [];
    for (const operation of operations) {
      const path = String(operation.path ?? "").toLowerCase();
      if (path === "active" && typeof operation.value === "boolean") update.active = operation.value;
      if (path === "displayname") {
        const value = boundedString(operation.value, 1, 160);
        if (value) update.display_name = value;
      }
      if ((path === "username" || path === "emails") && emailValue(operation.value)) update.email = emailValue(operation.value);
    }
    const { data, error } = await auth.client.from("directory_users").update(update).eq("id", request.params.userId).eq("organization_id", directory.organizationId).select("*").maybeSingle();
    if (error || !data) return scimError(reply, 404, "User not found");
    reply.type("application/scim+json");
    return scimUser(data);
  });

  server.delete<{ Params: { userId: string } }>("/scim/v2/Users/:userId", async (request, reply) => {
    const directory = await requireScim(auth, request, reply);
    if (!directory || !auth.client || !boundedUuid(request.params.userId)) return;
    const { data } = await auth.client.from("directory_users").update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", request.params.userId).eq("organization_id", directory.organizationId).select("id").maybeSingle();
    if (!data) return scimError(reply, 404, "User not found");
    return reply.code(204).send();
  });
}

async function processDataRequests(auth: AuthService) {
  if (!auth.client) return { completed: 0, failed: 0 };
  const now = new Date().toISOString();
  const { data: requests } = await auth.client.from("data_requests").select("*")
    .eq("status", "queued").lte("execute_after", now).order("requested_at", { ascending: true }).limit(10);
  let completed = 0;
  let failed = 0;
  for (const item of requests ?? []) {
    await auth.client.from("data_requests").update({ status: "processing", updated_at: now }).eq("id", item.id).eq("status", "queued");
    try {
      if (item.request_type === "export") {
        const [profile, memberships, boards, consents, subscriptions, installations] = await Promise.all([
          auth.client.from("profiles").select("id,email,display_name,avatar_url,locale,timezone,preferences,notification_preferences,created_at").eq("id", item.profile_id).single(),
          auth.client.from("organization_memberships").select("organization_id,role,status,joined_at,organizations(name,slug,kind)").eq("profile_id", item.profile_id),
          auth.client.from("boards").select("id,workspace_id,title,description,latest_state,latest_version,visibility,archived_at,deleted_at,created_at,updated_at").eq("organization_id", item.organization_id).or(`owner_profile_id.eq.${item.profile_id},visibility.neq.private`).limit(500),
          auth.client.from("consent_records").select("consent_type,document_version,granted,source,created_at").eq("profile_id", item.profile_id),
          auth.client.from("billing_subscriptions").select("plan_key,status,seat_quantity,current_period_start,current_period_end,cancel_at_period_end").eq("organization_id", item.organization_id),
          auth.client.from("platform_installations").select("platform,status,version,settings,consented_at,last_seen_at,last_success_at,created_at").eq("organization_id", item.organization_id),
        ]);
        const result = {
          schemaVersion: 1,
          profile: profile.data,
          memberships: memberships.data ?? [],
          boards: boards.data ?? [],
          consents: consents.data ?? [],
          subscriptions: subscriptions.data ?? [],
          installations: installations.data ?? [],
        };
        await auth.client.from("data_requests").update({ status: "completed", result, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);
      } else if (item.request_type === "delete_workspace") {
        await auth.client.from("organizations").delete().eq("id", item.organization_id);
      } else {
        const { data: profile } = await auth.client.from("profiles").select("auth_user_id").eq("id", item.profile_id).maybeSingle();
        if (profile?.auth_user_id) {
          const { error } = await auth.client.auth.admin.deleteUser(profile.auth_user_id);
          if (error) throw new Error("AUTH_USER_DELETE_FAILED");
        }
        const { count } = await auth.client.from("organization_memberships").select("id", { count: "exact", head: true }).eq("organization_id", item.organization_id).eq("status", "active");
        const { data: organization } = await auth.client.from("organizations").select("kind").eq("id", item.organization_id).maybeSingle();
        if (organization?.kind === "personal" && (count ?? 0) <= 1) {
          await auth.client.from("organizations").delete().eq("id", item.organization_id);
        }
        await auth.client.from("profiles").delete().eq("id", item.profile_id);
      }
      completed += 1;
    } catch (error) {
      await auth.client.from("data_requests").update({
        status: "failed",
        error_code: error instanceof Error ? error.message.slice(0, 80) : "PROCESSING_FAILED",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed += 1;
    }
  }
  return { completed, failed };
}

async function requireScim(auth: AuthService, request: FastifyRequest, reply: FastifyReply) {
  const token = bearerToken(request.headers);
  if (!token || !token.startsWith("airboard_scim_") || !auth.client) {
    scimError(reply, 401, "A valid bearer token is required");
    return null;
  }
  const { data } = await auth.client.from("scim_access_tokens")
    .select("id,organization_id,status,expires_at")
    .eq("token_hash", sha256(token)).eq("status", "active").maybeSingle();
  if (!data || (data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) {
    scimError(reply, 401, "The bearer token is invalid or expired");
    return null;
  }
  await auth.client.from("scim_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { tokenId: data.id, organizationId: data.organization_id };
}

function scimError(reply: FastifyReply, status: number, detail: string, scimType?: string) {
  return reply.code(status).type("application/scim+json").send({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  });
}

function scimUser(row: JsonRecord) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    externalId: row.external_id ?? undefined,
    userName: row.email,
    displayName: row.display_name,
    active: row.active !== false,
    emails: [{ value: row.email, primary: true, type: "work" }],
    roles: [{ value: row.role, primary: true }],
    meta: { resourceType: "User", created: row.created_at, lastModified: row.updated_at, location: `/scim/v2/Users/${String(row.id)}` },
  };
}

function scimRole(body: JsonRecord): string {
  const roles = Array.isArray(body.roles) ? body.roles : [];
  const value = String(record(roles[0]).value ?? "member");
  return ["admin", "billing", "member", "viewer"].includes(value) ? value : "member";
}

function scimEmailFilter(filter: unknown): string | null {
  if (typeof filter !== "string" || filter.length > 500) return null;
  const match = /^userName\s+eq\s+"([^"]+)"$/i.exec(filter.trim());
  return match ? emailValue(match[1]) : null;
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

async function requireActiveEntitlement(
  auth: AuthService,
  context: AuthContext,
  reply: FastifyReply,
): Promise<JsonRecord | null> {
  if (!auth.client) return { status: "active" };
  const { data, error } = await auth.client
    .from("entitlements")
    .select("id,plan,status,valid_until")
    .eq("organization_id", context.organizationId)
    .in("status", ["active", "trialing", "grace"])
    .gt("valid_until", new Date().toISOString())
    .order("valid_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    reply.code(402).send({ error: "ACTIVE_ENTITLEMENT_REQUIRED" });
    return null;
  }
  return data;
}

async function requireInstallation(
  config: ApiConfig,
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = bearerToken(request.headers);
  const claims = token
    ? verifySignedToken(config.sessionSigningSecret, token, "installation")
    : null;
  if (!claims?.installationId || !claims.organizationId || !auth.client) {
    reply.code(401).send({ error: "INSTALLATION_AUTH_REQUIRED" });
    return null;
  }
  const { data } = await auth.client
    .from("platform_installations")
    .select("id,organization_id,token_hash,previous_token_hash,previous_token_expires_at,status")
    .eq("id", claims.installationId)
    .eq("organization_id", claims.organizationId)
    .maybeSingle();
  const presentedTokenHash = token ? sha256(token) : null;
  const previousStillValid = Boolean(
    data?.previous_token_hash === presentedTokenHash
    && data.previous_token_expires_at
    && new Date(data.previous_token_expires_at).getTime() > Date.now(),
  );
  if (!token || !data || data.status === "revoked" || (data.token_hash !== presentedTokenHash && !previousStillValid)) {
    reply.code(401).send({ error: "INSTALLATION_TOKEN_REVOKED" });
    return null;
  }
  return { installationId: data.id, organizationId: data.organization_id, profileId: claims.sub, presentedTokenHash };
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
    installationId?: string;
    boardSessionId?: string;
  },
) {
  if (!auth.client || !ANALYTICS_EVENT_NAMES.has(event.eventName)) return;
  await auth.client.from("product_events").upsert(
    {
      event_id: event.eventId,
      profile_id: context.profileId,
      organization_id: context.organizationId,
      installation_id: event.installationId,
      board_session_id: event.boardSessionId,
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

async function deliverNotifications(config: ApiConfig, auth: AuthService) {
  if (!auth.client || !config.email.resendApiKey) return { configured: false, sent: 0, failed: 0 };
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
  return { configured: true, sent, failed };
}

async function expireDiagnostics(auth: AuthService) {
  if (!auth.client) return;
  await auth.client
    .from("diagnostic_bundles")
    .update({ status: "expired", diagnostics: {} })
    .in("status", ["ready", "attached"])
    .lt("expires_at", new Date().toISOString());
}

async function expireOperationalData(auth: AuthService) {
  if (!auth.client) return;
  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await Promise.all([
    auth.client.from("voice_trace_events").delete().lt("expires_at", now),
    auth.client.from("diagnostic_bundles").delete().in("status", ["expired", "deleted"]).lt("expires_at", thirtyDaysAgo),
    auth.client.from("webhook_inbox").delete().in("status", ["processed", "ignored"]).lt("received_at", thirtyDaysAgo),
    auth.client.from("board_sessions").update({ status: "ended", ended_at: now, updated_at: now }).in("status", ["active", "owner_disconnected"]).lt("expires_at", now),
  ]);
}

async function stripeRequest(config: ApiConfig, path: string, body: URLSearchParams) {
  return fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
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
      subject: "Your 3-day Airboard trial is live",
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your 72-hour Airboard trial has started. Open Airboard and create your first board.</p>`,
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

function analyticsPropertiesAllowed(properties: JsonRecord): boolean {
  const text = JSON.stringify(properties);
  return text.length <= 16_000 && !Object.keys(properties).some((key) => FORBIDDEN_ANALYTICS_KEYS.test(key));
}

function sanitizeDiagnostics(input: JsonRecord): JsonRecord {
  const allowed = new Set([
    "appVersion",
    "extensionVersion",
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

function domainValue(value: unknown): string | null {
  const text = boundedString(value, 3, 253)?.toLowerCase().replace(/^@/, "");
  return text && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(text)
    ? text
    : null;
}

function httpsUrl(value: unknown): string | null {
  const text = boundedString(value, 8, 2_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
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

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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

function isLoopbackRequest(request: FastifyRequest): boolean {
  return ["127.0.0.1", "::1", "localhost"].some((host) =>
    String(request.hostname ?? request.ip).includes(host),
  );
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
