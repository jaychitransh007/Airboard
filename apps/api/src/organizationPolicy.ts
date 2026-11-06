import type { SupabaseClient } from "@supabase/supabase-js";

/** The switches in Admin → Organization policy. */
export type OrganizationPolicy = {
  externalGuestsAllowed: boolean;
  voiceEnabled: boolean;
  cameraEnabled: boolean;
  gestureEnabled: boolean;
  exportsEnabled: boolean;
};

export const DEFAULT_ORGANIZATION_POLICY: OrganizationPolicy = {
  externalGuestsAllowed: true,
  voiceEnabled: true,
  cameraEnabled: true,
  gestureEnabled: true,
  exportsEnabled: true,
};

const POLICY_COLUMNS = "external_guests_allowed,voice_enabled,camera_enabled,gesture_enabled,exports_enabled";

/** A switch is off only when the row says false; a missing row keeps the defaults. */
export function policyFromRow(row: Record<string, unknown> | null | undefined): OrganizationPolicy {
  return {
    externalGuestsAllowed: row?.external_guests_allowed !== false,
    voiceEnabled: row?.voice_enabled !== false,
    cameraEnabled: row?.camera_enabled !== false,
    gestureEnabled: row?.gesture_enabled !== false,
    exportsEnabled: row?.exports_enabled !== false,
  };
}

/**
 * The organization's switches. A failed lookup throws, so a route refuses
 * rather than quietly ignoring a switch an admin turned off.
 */
export async function organizationPolicy(
  client: Pick<SupabaseClient, "from"> | null,
  organizationId: string,
): Promise<OrganizationPolicy> {
  if (!client) return DEFAULT_ORGANIZATION_POLICY;
  const { data, error } = await client
    .from("organization_policies")
    .select(POLICY_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("POLICY_LOOKUP_FAILED");
  return policyFromRow(data as Record<string, unknown> | null);
}

/** Whether the profile is an active member of the organization, with its role. */
export async function activeMembership(
  client: Pick<SupabaseClient, "from">,
  organizationId: string,
  profileId: string,
): Promise<{ role: string } | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  return data ? { role: String((data as { role: unknown }).role) } : null;
}
