export type InstallationCredentialRow = {
  status: string;
  token_hash: string | null;
  previous_token_hash: string | null;
  previous_token_expires_at: string | null;
};

/**
 * Accepts the current browser credential or the bounded grace credential left
 * by an atomic status rotation. Revocation and expired grace windows always
 * fail closed.
 */
export function installationTokenMatches(
  row: InstallationCredentialRow,
  presentedTokenHash: string,
  nowMs = Date.now(),
): boolean {
  if (row.status === "revoked") return false;
  if (row.token_hash === presentedTokenHash) return true;
  return Boolean(
    row.previous_token_hash === presentedTokenHash &&
    row.previous_token_expires_at &&
    new Date(row.previous_token_expires_at).getTime() > nowMs,
  );
}
