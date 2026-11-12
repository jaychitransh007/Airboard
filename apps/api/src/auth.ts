import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { ApiConfig } from "./config";
import { DEFAULT_ORGANIZATION_POLICY, policyFromRow } from "./organizationPolicy";
import { bearerToken, verifySignedToken } from "./signedTokens";

export type AccountRole = "owner" | "admin" | "billing" | "member" | "viewer";

export type AuthContext = {
  authUserId: string;
  profileId: string;
  organizationId: string;
  role: AccountRole;
  email: string | null;
  displayName: string;
  tokenKind: "supabase" | "development";
};

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
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

type SignInMembershipRow = MembershipRow & { created_at: string };

type CachedSignIn = {
  expiresAt: number;
  context: Promise<AuthContext | null>;
  profileId?: string;
};

const PROFILE_COLUMNS = "id,auth_user_id,local_user_key,email,display_name,default_organization_id";
// The profile and its memberships in one round trip; Supabase is a region away.
const PROFILE_WITH_MEMBERSHIPS = `${PROFILE_COLUMNS},memberships:organization_memberships!organization_memberships_profile_id_fkey(organization_id,role,status,created_at)`;

// Opening a board sends several requests at once; they share one lookup, and
// later requests reuse it briefly. Routes that change a person's organization,
// role or name call forgetProfile, so the window only bounds outside changes.
const SIGN_IN_CACHE_TTL_MS = 30_000;
const SIGN_IN_CACHE_LIMIT = 1_000;

const LIVE_ENTITLEMENT_STATUSES = new Set(["active", "trialing", "grace", "past_due"]);

/**
 * The entitlement /me reports: a live one when there is one, otherwise the
 * latest that ended, so Billing can say a pilot is over instead of looking
 * like it never started. A pending (not yet started) trial comes last. Rows
 * arrive newest valid_until first, and the sort keeps that order per rank.
 */
export function accountEntitlement<T extends { status: string }>(rows: readonly T[]): T | null {
  const rank = (status: string) => (LIVE_ENTITLEMENT_STATUSES.has(status) ? 0 : status === "pending" ? 2 : 1);
  return [...rows].sort((left, right) => rank(left.status) - rank(right.status))[0] ?? null;
}

/**
 * The membership a request acts in: the one in the profile's default
 * organization when it has one, otherwise its oldest active membership.
 */
export function signInMembership<T extends SignInMembershipRow>(
  memberships: readonly T[],
  defaultOrganizationId: string | null,
): T | null {
  return memberships
    .filter((membership) =>
      membership.status === "active" &&
      (!defaultOrganizationId || membership.organization_id === defaultOrganizationId))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))[0] ?? null;
}

export class AuthService {
  readonly client: SupabaseClient | null;
  private readonly config: ApiConfig;
  private readonly signIns = new Map<string, CachedSignIn>();

  constructor(config: ApiConfig, client?: SupabaseClient) {
    this.config = config;
    this.client =
      client ??
      (config.supabaseUrl && config.supabaseServiceRoleKey
        ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null);
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
        signal: AbortSignal.timeout(5_000),
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

  async authenticate(request: RequestLike): Promise<AuthContext | null> {
    // Only the Authorization header: a sign-in token in a URL would land in
    // browser history and request logs (RGB-016). Sockets use short tickets.
    const token = bearerToken(request.headers);
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

    if (!this.client) {
      return null;
    }
    const authUserId = await this.verifiedAuthUserId(token);
    if (!authUserId) {
      return null;
    }
    return this.signInContext(authUserId, token);
  }

  /** Drops cached sign-ins after a profile's organization, role or name changes. */
  forgetProfile(profileId: string): void {
    for (const [authUserId, entry] of this.signIns) {
      // A lookup still in flight may have read the old rows; drop it too.
      if (entry.profileId === undefined || entry.profileId === profileId) {
        this.signIns.delete(authUserId);
      }
    }
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
        policy: DEFAULT_ORGANIZATION_POLICY,
        trial: { status: "active", activatedAt: null, expiresAt: null },
        entitlement: { plan: "local", status: "active", validUntil: null },
      };
    }

    const [profileResult, organizationResult, workspaceResult, trialResult, entitlementResult, policyResult] =
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
          .order("valid_until", { ascending: false })
          .limit(10),
        this.client
          .from("organization_policies")
          .select("external_guests_allowed,voice_enabled,camera_enabled,gesture_enabled,exports_enabled")
          .eq("organization_id", context.organizationId)
          .maybeSingle(),
      ]);
    if (profileResult.error || organizationResult.error) {
      throw new Error("ACCOUNT_LOOKUP_FAILED");
    }
    const profile = profileResult.data;
    const organization = organizationResult.data;
    const workspace = workspaceResult.data;
    const trial = trialResult.data;
    const entitlement = accountEntitlement(entitlementResult.data ?? []);
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
      // The browser applies the switches only it can: camera, gestures and
      // downloads never reach the API.
      policy: policyFromRow(policyResult.data),
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

  /**
   * The organization's current active/trialing/grace entitlement, or null
   * when it has none (or the lookup failed). Gates both board creation and
   * the provider-spending voice endpoints. Without a control-plane database
   * every caller is entitled, matching the local account stub above.
   */
  async activeEntitlement(organizationId: string): Promise<Record<string, unknown> | null> {
    if (!this.client) {
      return { status: "active" };
    }
    const { data, error } = await this.client
      .from("entitlements")
      .select("id,plan,status,valid_until")
      .eq("organization_id", organizationId)
      .in("status", ["active", "trialing", "grace"])
      .gt("valid_until", new Date().toISOString())
      .order("valid_until", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return data as Record<string, unknown>;
  }

  /**
   * Checks the access token's signature against the project's published
   * signing key (fetched once and cached by supabase-js), so a request no
   * longer waits on a Supabase Auth round trip. A signed-out session's token
   * stays valid until it expires, at most an hour. Projects still on a shared
   * HS256 secret fall back to asking Supabase Auth.
   */
  private async verifiedAuthUserId(token: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    try {
      const { data, error } = await this.client.auth.getClaims(token);
      const claims = data?.claims;
      if (error || !claims || claims.role !== "authenticated" || typeof claims.sub !== "string" || !claims.sub) {
        return null;
      }
      return claims.sub;
    } catch {
      return null;
    }
  }

  private signInContext(authUserId: string, token: string): Promise<AuthContext | null> {
    const now = Date.now();
    const cached = this.signIns.get(authUserId);
    if (cached && cached.expiresAt > now) {
      return cached.context;
    }
    const entry: CachedSignIn = {
      expiresAt: now + SIGN_IN_CACHE_TTL_MS,
      context: this.lookupSignInContext(authUserId, token),
    };
    // Re-inserting keeps the map ordered oldest first for eviction.
    this.signIns.delete(authUserId);
    this.signIns.set(authUserId, entry);
    for (const key of this.signIns.keys()) {
      if (this.signIns.size <= SIGN_IN_CACHE_LIMIT) break;
      this.signIns.delete(key);
    }
    // Only a found context is reused; a failure or a missing membership is
    // looked up again on the next request.
    const forget = () => {
      if (this.signIns.get(authUserId) === entry) this.signIns.delete(authUserId);
    };
    entry.context.then((context) => {
      if (context) entry.profileId = context.profileId;
      else forget();
    }, forget);
    return entry.context;
  }

  private async lookupSignInContext(authUserId: string, token: string): Promise<AuthContext | null> {
    if (!this.client) {
      return null;
    }
    const { data, error } = await this.client
      .from("profiles")
      .select(PROFILE_WITH_MEMBERSHIPS)
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (error) {
      throw new Error("PROFILE_LOOKUP_FAILED");
    }
    if (!data) {
      // A first sign-in (or an account from before the auth trigger) builds
      // its profile from the full user record.
      const { data: userData, error: userError } = await this.client.auth.getUser(token);
      if (userError || !userData.user) {
        return null;
      }
      const profile = await this.ensureProfile(userData.user);
      return this.contextForProfile(profile, "supabase");
    }
    const { memberships, ...profile } = data as unknown as ProfileRow & {
      memberships: SignInMembershipRow[] | null;
    };
    const membership = signInMembership(memberships ?? [], profile.default_organization_id);
    return membership ? toAuthContext(profile, membership, "supabase") : null;
  }

  private async ensureProfile(user: User): Promise<ProfileRow> {
    if (!this.client) {
      throw new Error("AUTH_NOT_CONFIGURED");
    }
    const { data: existing, error: lookupError } = await this.client
      .from("profiles")
      .select(PROFILE_COLUMNS)
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
      .select(PROFILE_COLUMNS)
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
      .select(PROFILE_COLUMNS)
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
  ): Promise<AuthContext | null> {
    if (!this.client) {
      return null;
    }
    let membershipQuery = this.client
      .from("organization_memberships")
      .select("organization_id,role,status")
      .eq("profile_id", profile.id)
      .eq("status", "active");
    const targetOrganizationId = profile.default_organization_id;
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
    return toAuthContext(profile, data as MembershipRow, tokenKind);
  }
}

function toAuthContext(
  profile: ProfileRow,
  membership: MembershipRow,
  tokenKind: AuthContext["tokenKind"],
): AuthContext {
  // Concurrent requests share one context, so none may change it for another.
  return Object.freeze({
    authUserId: profile.auth_user_id ?? profile.local_user_key ?? profile.id,
    profileId: profile.id,
    organizationId: membership.organization_id,
    role: membership.role,
    email: profile.email,
    displayName: profile.display_name,
    tokenKind,
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}
