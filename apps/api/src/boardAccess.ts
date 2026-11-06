const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Private boards belong to their owner; organization and link boards are open
 * to the organization's members. The API reads boards with the service role,
 * so every board read adds this to its organization filter, e.g.
 * `.eq("organization_id", org).or(boardAccessFilter(profileId))`. Writes use
 * writeAccessibleBoard instead.
 */
export function boardAccessFilter(profileId: string): string {
  if (!PROFILE_ID.test(profileId)) throw new Error("INVALID_PROFILE_ID");
  return `visibility.neq.private,owner_profile_id.eq.${profileId}`;
}

/** One half of boardAccessFilter, applied with the query builder's `.filter()`. */
export type BoardWriteScope = {
  column: "owner_profile_id" | "visibility";
  operator: "eq" | "neq";
  value: string;
};

/**
 * Runs a board update with boardAccessFilter's access rule, without an OR
 * filter: PostgREST v14.3, which fresh local stacks still run, rejects `or=` on
 * UPDATE … RETURNING (42703 "column boards.owner_profile_id does not exist");
 * v14.5 accepts it. The write is tried as the board's owner,
 * then, only if that matched nothing, on a shared board. Together the two
 * scopes equal the filter, and a row is never written twice.
 */
export async function writeAccessibleBoard<R extends { data: unknown; error: unknown }>(
  profileId: string,
  write: (scope: BoardWriteScope) => PromiseLike<R>,
): Promise<R> {
  if (!PROFILE_ID.test(profileId)) throw new Error("INVALID_PROFILE_ID");
  const owned = await write({ column: "owner_profile_id", operator: "eq", value: profileId });
  if (owned.error || owned.data) return owned;
  return write({ column: "visibility", operator: "neq", value: "private" });
}

/**
 * Roles that may change boards: create, save, trash, restore, upload and
 * share. Viewer and Billing members can open the organization's boards but
 * not change them.
 */
export const BOARD_EDITOR_ROLES = ["owner", "admin", "member"] as const;

export function canEditBoards(role: string): boolean {
  return (BOARD_EDITOR_ROLES as readonly string[]).includes(role);
}
