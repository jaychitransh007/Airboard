/**
 * Links handed out by the Share dialog. A live link lets anyone join the
 * running board session as a guest (no account), so it carries the session's
 * join token and expires with it. A board link is the stable address of the
 * saved board and opens only for people the board's visibility allows.
 */

/** Join tokens are issued for two hours by the API's /sessions/start (JOIN_LINK_TTL_SECONDS). */
export const LIVE_LINK_HOURS = 2;

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
 * session, the host's workspace admits only its members, Airboard is down for
 * a short upgrade, or the network is down; each needs a different next step.
 */
export function liveJoinFailure(message: string | undefined): "expired" | "ended" | "members_only" | "maintenance" | "offline" {
  if (!message) return "offline";
  if (/MAINTENANCE/.test(message)) return "maintenance";
  if (/EXTERNAL_GUESTS_DISABLED/.test(message)) return "members_only";
  if (/JOIN_TOKEN|HTTP_401/.test(message)) return "expired";
  if (/NOT_JOINABLE|NOT_FOUND|HTTP_404/.test(message)) return "ended";
  return "offline";
}

export type LiveStartFailure = "pilot_ended" | "maintenance" | "offline";

/**
 * Starting the host's live session is refused once the workspace's pilot has
 * ended (the board itself still saves) and while Airboard is down for a short
 * upgrade; anything else means the live server could not be reached.
 */
export function liveStartFailure(message: string | undefined): LiveStartFailure {
  if (message && /OWNER_ENTITLEMENT_REQUIRED/.test(message)) return "pilot_ended";
  if (message && /MAINTENANCE/.test(message)) return "maintenance";
  return "offline";
}

const LIVE_SESSION_KEY_PREFIX = "airboard.liveSession.";

export type RememberedLiveSession = { boardSessionId: string; joinToken: string };

/**
 * The owner's live session for a saved board, kept for this tab only so a
 * reload rejoins it. It stays out of the address bar: an address copied from
 * there, or kept in browser history, must not let others edit the board.
 */
export function rememberLiveSession(boardId: string, session: RememberedLiveSession): void {
  try {
    window.sessionStorage.setItem(`${LIVE_SESSION_KEY_PREFIX}${boardId}`, JSON.stringify(session));
  } catch {
    // Storage can be off (private windows); a reload then starts a new session.
  }
}

export function rememberedLiveSession(boardId: string): RememberedLiveSession | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`${LIVE_SESSION_KEY_PREFIX}${boardId}`) ?? "null") as unknown;
    if (value && typeof value === "object") {
      const { boardSessionId, joinToken } = value as Record<string, unknown>;
      if (typeof boardSessionId === "string" && typeof joinToken === "string") return { boardSessionId, joinToken };
    }
  } catch {
    // Unreadable or blocked storage counts as nothing remembered.
  }
  return null;
}

export function forgetLiveSession(boardId: string): void {
  try {
    window.sessionStorage.removeItem(`${LIVE_SESSION_KEY_PREFIX}${boardId}`);
  } catch {
    // Nothing to forget.
  }
}
