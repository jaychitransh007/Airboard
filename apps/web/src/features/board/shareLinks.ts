/**
 * Links handed out by the Share dialog. A live link lets anyone join the
 * running board session as a guest (no account), so it carries the session's
 * join token and expires with it. A board link is the stable address of the
 * saved board and opens only for people the board's visibility allows.
 */

/** Join tokens are issued for six hours by the API's /sessions/start. */
export const LIVE_LINK_HOURS = 6;

const GUEST_NAME_LIMIT = 40;

export function liveBoardLink(origin: string, boardSessionId: string, joinToken: string): string {
  const url = new URL(`/live/${encodeURIComponent(boardSessionId)}`, origin);
  url.searchParams.set("joinToken", joinToken);
  return url.toString();
}

export function savedBoardLink(origin: string, boardId: string): string {
  return new URL(`/app/boards/${encodeURIComponent(boardId)}`, origin).toString();
}

/**
 * A saved-board address that still carries a live session, e.g. one copied from
 * the owner's address bar. People who cannot open the saved board can still
 * join the session through the live route.
 */
export function liveLinkFromBoardAddress(origin: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const boardSessionId = params.get("boardSessionId");
  const joinToken = params.get("joinToken");
  return boardSessionId && joinToken ? liveBoardLink(origin, boardSessionId, joinToken) : null;
}

/** A guest's chosen name, trimmed to something a presence label can show. */
export function guestDisplayName(value: string | null | undefined): string {
  const name = (value ?? "").replace(/\s+/g, " ").trim().slice(0, GUEST_NAME_LIMIT).trim();
  return name || "Guest";
}

/**
 * Joining can fail because the link outlived its token, the host ended the
 * session, or the network is down; each needs a different next step.
 */
export function liveJoinFailure(message: string | undefined): "expired" | "ended" | "offline" {
  if (!message) return "offline";
  if (/JOIN_TOKEN|HTTP_401/.test(message)) return "expired";
  if (/NOT_JOINABLE|NOT_FOUND|HTTP_404/.test(message)) return "ended";
  return "offline";
}
