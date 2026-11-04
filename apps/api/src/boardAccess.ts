const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Private boards belong to their owner; organization and link boards are open
 * to the organization's members. The API reads boards with the service role,
 * so every board read and write adds this to its organization filter, e.g.
 * `.eq("organization_id", org).or(boardAccessFilter(profileId))`.
 */
export function boardAccessFilter(profileId: string): string {
  if (!PROFILE_ID.test(profileId)) throw new Error("INVALID_PROFILE_ID");
  return `visibility.neq.private,owner_profile_id.eq.${profileId}`;
}
