import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { ApiConfig } from "./config";
import { installationTokenMatches } from "./installationCredential";
import { bearerToken, verifySignedToken } from "./signedTokens";

export type AccountRole = "owner" | "admin" | "billing" | "member" | "viewer";

export type AuthContext = {
  authUserId: string;
  profileId: string;
  organizationId: string;
  role: AccountRole;
  email: string | null;
  displayName: string;
  tokenKind: "supabase" | "development" | "installation";
};

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
};

type ProfileRow = {
  id: string;
  auth_user_id: string | null;
  local_user_key: string | null;
  email: string | null;
  display_name: string;
  default_organization_id: string | null;
};

type MembershipRow = {
  organization_id: string;
  role: AccountRole;
  status: string;
};

export class AuthService {
  readonly client: SupabaseClient | null;
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.client =
      config.supabaseUrl && config.supabaseServiceRoleKey
        ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async providerAvailability(): Promise<{
    google: boolean;
    microsoft: boolean;
    emailMagicLink: boolean;
  }> {
    if (!this.client || !this.config.supabaseUrl || !this.config.supabaseServiceRoleKey) {
      return { google: false, microsoft: false, emailMagicLink: false };
    }
    try {
      const response = await fetch(`${this.config.supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: this.config.supabaseServiceRoleKey },
      });
      if (!response.ok) throw new Error(`AUTH_SETTINGS_${response.status}`);
      const settings = (await response.json()) as {
        disable_signup?: boolean;
        external?: { google?: boolean; azure?: boolean };
      };
      return {
        google: settings.external?.google === true,
        microsoft: settings.external?.azure === true,
        emailMagicLink: settings.disable_signup !== true,
      };
    } catch {
      // Fail closed for social providers so the product never advertises a
      // sign-in path whose provider configuration could not be verified.
      return { google: false, microsoft: false, emailMagicLink: true };
    }
  }

  async authenticate(
    request: RequestLike,
    options: { allowInstallation?: boolean } = {},
  ): Promise<AuthContext | null> {
    const query = request.query as Record<string, unknown> | undefined;
    const queryToken = typeof query?.access_token === "string" ? query.access_token : null;
    const token = bearerToken(request.headers) ?? queryToken;
    if (!token) {
      return null;
    }

    const development = verifySignedToken(
      this.config.sessionSigningSecret,
      token,
      "development_access",
    );
    if (development && this.config.localEntitlements) {
      if (!this.client) {
        return {
          authUserId: development.sub,
          profileId: development.sub,
          organizationId: development.organizationId ?? "local-organization",
          role: "owner",
          email: "local@airboard.test",
          displayName: "Local owner",
          tokenKind: "development",
        };
      }
      const profile = await this.profileByLocalKey(development.sub);
      if (!profile) {
        return null;
      }
      return this.contextForProfile(profile, "development");
    }

    const installation = verifySignedToken(
      this.config.sessionSigningSecret,
      token,
      "installation",
    );
    if (installation) {
      // Installation credentials are intentionally capability-scoped. They
      // can reach only the media/session endpoints that explicitly opt in,
      // never the general account or control-plane API surface.
      if (!options.allowInstallation) return null;
      if (!installation.installationId || !installation.organizationId || !this.client) {
        return null;
      }
      const { data: installRow } = await this.client
        .from("platform_installations")
        .select("id,installed_by,organization_id,status,token_hash,previous_token_hash,previous_token_expires_at")
        .eq("id", installation.installationId)
        .eq("organization_id", installation.organizationId)
        .maybeSingle();
      const presentedTokenHash = sha256(token);
      if (
        installRow?.installed_by &&
        installationTokenMatches(installRow, presentedTokenHash)
      ) {
        const { data: profile } = await this.client
          .from("profiles")
          .select("id,auth_user_id,local_user_key,email,display_name,default_organization_id")
          .eq("id", installRow.installed_by)
          .maybeSingle();
        if (profile) {
          const context = await this.contextForProfile(
            profile as ProfileRow,
            "installation",
            installation.organizationId,
          );
          if (context && context.organizationId === installation.organizationId) return context;
        }
      }
      return null;
    }

    if (!this.client) {
      return null;
    }
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    const profile = await this.ensureProfile(data.user);
    return this.contextForProfile(profile, "supabase");
  }

  async account(context: AuthContext): Promise<Record<string, unknown>> {
    if (!this.client) {
      return {
        profile: {
          id: context.profileId,
          email: context.email,
          displayName: context.displayName,
          locale: "en",
          timezone: "UTC",
          onboardingCompletedAt: new Date().toISOString(),
        },
        organization: {
          id: context.organizationId,
          name: "Local workspace",
          slug: "local-workspace",
          kind: "personal",
          role: context.role,
        },
        workspace: { id: "local-workspace", name: "My Airboards" },
        trial: { status: "active", activatedAt: null, expiresAt: null },
        entitlement: { plan: "local", status: "active", validUntil: null },
      };
    }

    const [profileResult, organizationResult, workspaceResult, trialResult, entitlementResult] =
      await Promise.all([
        this.client.from("profiles").select("*").eq("id", context.profileId).single(),
        this.client.from("organizations").select("*").eq("id", context.organizationId).single(),
        this.client
          .from("workspaces")
          .select("*")
          .eq("organization_id", context.organizationId)
          .eq("is_default", true)
          .maybeSingle(),
        this.client
          .from("trial_eligibility")
          .select("*")
          .eq("organization_id", context.organizationId)
          .maybeSingle(),
        this.client
          .from("entitlements")
          .select("*")
          .eq("organization_id", context.organizationId)
          .in("status", ["pending", "trialing", "grace", "active", "past_due"])
          .order("valid_until", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    if (profileResult.error || organizationResult.error) {
      throw new Error("ACCOUNT_LOOKUP_FAILED");
    }
    const profile = profileResult.data;
    const organization = organizationResult.data;
    const workspace = workspaceResult.data;
    const trial = trialResult.data;
    const entitlement = entitlementResult.data;
    return {
        profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
        locale: profile.locale,
        timezone: profile.timezone,
          onboardingCompletedAt: profile.onboarding_completed_at,
          preferences: profile.preferences,
          notificationPreferences: profile.notification_preferences,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        kind: organization.kind,
        companySizeBand: organization.company_size_band,
        countryCode: organization.country_code,
        role: context.role,
      },
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, isDefault: workspace.is_default }
        : null,
      trial: trial
        ? {
            status: trial.status,
            activatedAt: trial.activated_at,
            expiresAt: trial.expires_at,
          }
        : null,
      entitlement: entitlement
        ? {
            plan: entitlement.plan,
            status: entitlement.status,
            featureKey: entitlement.feature_key,
            validUntil: entitlement.valid_until,
          }
        : null,
    };
  }

  hasRole(context: AuthContext, roles: AccountRole[]): boolean {
    return roles.includes(context.role);
  }

  private async ensureProfile(user: User): Promise<ProfileRow> {
    if (!this.client) {
      throw new Error("AUTH_NOT_CONFIGURED");
    }
    const { data: existing, error: lookupError } = await this.client
      .from("profiles")
      .select("id,auth_user_id,local_user_key,email,display_name,default_organization_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (lookupError) {
      throw new Error("PROFILE_LOOKUP_FAILED");
    }
    if (existing) {
      return existing as ProfileRow;
    }
    const displayName =
      stringValue(user.user_metadata?.full_name) ||
      stringValue(user.user_metadata?.name) ||
      user.email?.split("@")[0] ||
      "Airboard user";
    const { data, error } = await this.client
      .from("profiles")
      .upsert(
        {
          auth_user_id: user.id,
          email: user.email ?? null,
          display_name: displayName,
          avatar_url: stringValue(user.user_metadata?.avatar_url),
        },
        { onConflict: "auth_user_id" },
      )
      .select("id,auth_user_id,local_user_key,email,display_name,default_organization_id")
      .single();
    if (error || !data) {
      throw new Error("PROFILE_BOOTSTRAP_FAILED");
    }
    // The auth trigger normally creates the personal tenant. If this fallback
    // was needed because an old user predated the trigger, create it now.
    await this.ensurePersonalOrganization(data as ProfileRow);
    return data as ProfileRow;
  }

  private async ensurePersonalOrganization(profile: ProfileRow): Promise<void> {
    if (!this.client) {
      return;
    }
    const { data: membership, error } = await this.client
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error || membership) {
      return;
    }
    const slug = `personal-${profile.id.replaceAll("-", "").slice(0, 32)}`;
    const { data: organization, error: organizationError } = await this.client
      .from("organizations")
      .insert({
        name: `${profile.display_name}'s workspace`,
        slug,
        kind: "personal",
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (organizationError || !organization) {
      throw new Error("ORGANIZATION_BOOTSTRAP_FAILED");
    }
    await Promise.all([
      this.client.from("organization_memberships").insert({
        organization_id: organization.id,
        profile_id: profile.id,
        role: "owner",
        status: "active",
        joined_at: new Date().toISOString(),
      }),
      this.client.from("workspaces").insert({
        organization_id: organization.id,
        name: "My Airboards",
        is_default: true,
        created_by: profile.id,
      }),
      this.client.from("organization_policies").insert({
        organization_id: organization.id,
        updated_by: profile.id,
      }),
      this.client.from("trial_eligibility").insert({
        profile_id: profile.id,
        organization_id: organization.id,
      }),
      this.client.from("entitlements").insert({
        user_id: profile.id,
        organization_id: organization.id,
        plan: "trial_pending",
        status: "pending",
        source: "trial",
        feature_key: "airboard.presenter",
        valid_until: new Date().toISOString(),
      }),
      this.client.from("profiles").update({ default_organization_id: organization.id }).eq("id", profile.id),
    ]);
  }

  private async profileByLocalKey(localUserKey: string): Promise<ProfileRow | null> {
    if (!this.client) {
      return null;
    }
    const { data, error } = await this.client
      .from("profiles")
      .select("id,auth_user_id,local_user_key,email,display_name,default_organization_id")
      .eq("local_user_key", localUserKey)
      .maybeSingle();
    if (error) {
      throw new Error(`LOCAL_PROFILE_LOOKUP_FAILED:${error.code ?? "unknown"}`);
    }
    return (data as ProfileRow | null) ?? null;
  }

  private async contextForProfile(
    profile: ProfileRow,
    tokenKind: AuthContext["tokenKind"],
    organizationId?: string,
  ): Promise<AuthContext | null> {
    if (!this.client) {
      return null;
    }
    let membershipQuery = this.client
      .from("organization_memberships")
      .select("organization_id,role,status")
      .eq("profile_id", profile.id)
      .eq("status", "active");
    const targetOrganizationId = organizationId ?? profile.default_organization_id;
    if (targetOrganizationId) {
      membershipQuery = membershipQuery.eq("organization_id", targetOrganizationId);
    }
    const { data, error } = await membershipQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`MEMBERSHIP_LOOKUP_FAILED:${error.code ?? "unknown"}`);
    }
    if (!data) {
      return null;
    }
    const membership = data as MembershipRow;
    return {
      authUserId: profile.auth_user_id ?? profile.local_user_key ?? profile.id,
      profileId: profile.id,
      organizationId: membership.organization_id,
      role: membership.role,
      email: profile.email,
      displayName: profile.display_name,
      tokenKind,
    };
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function sha256(value: string): string {
  // WebCrypto is not used here because authentication is on the synchronous
  // request path and Node's implementation is already available to the API.
  return createHash("sha256").update(value).digest("hex");
}
