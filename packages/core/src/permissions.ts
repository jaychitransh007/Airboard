import type { BoardEvent, BoardSession, Entitlement, Participant } from "./types";

export function hasActiveEntitlement(
  entitlement: Entitlement | null | undefined,
  now = new Date(),
): boolean {
  if (!entitlement) {
    return false;
  }

  if (entitlement.status !== "active" && entitlement.status !== "trialing") {
    return false;
  }

  return new Date(entitlement.validUntil).getTime() > now.getTime();
}

export function canStartBoard(entitlement: Entitlement | null | undefined): boolean {
  return hasActiveEntitlement(entitlement);
}

export function canJoinBoard(session: BoardSession, now = new Date()): boolean {
  if (session.status === "ended" || session.status === "locked") {
    return false;
  }

  return new Date(session.expiresAt).getTime() > now.getTime();
}

export function canDraw(input: {
  session: BoardSession;
  participant: Participant;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();

  if (!canJoinBoard(input.session, now)) {
    return false;
  }

  if (!input.participant.inputEnabled) {
    return false;
  }

  if (input.participant.role === "owner") {
    return input.session.status === "active" || input.session.status === "owner_disconnected";
  }

  if (input.participant.role === "viewer") {
    return false;
  }

  return input.session.status === "active" && input.session.allowParticipantDrawing;
}

/**
 * Owner-only administrative events. These change board-wide policy, lifecycle,
 * or wipe the whole board, so a non-owner must never be able to emit them.
 */
const OWNER_ONLY_EVENT_TYPES: ReadonlySet<BoardEvent["type"]> = new Set([
  "permission.changed",
  "owner.presence_changed",
  "participant.joined",
  "participant.left",
  "board.cleared",
]);

/**
 * Presence-only events that any joined participant (including viewers) may emit.
 */
const PRESENCE_EVENT_TYPES: ReadonlySet<BoardEvent["type"]> = new Set(["cursor.moved"]);

export type EventAuthorization = { allowed: true } | { allowed: false; reason: string };

/**
 * Decides whether a participant may apply a specific board event. This is the
 * single authority for realtime write access: the session must be joinable, the
 * participant must belong to it, and the event type must match the participant's
 * role (owner-only administrative events, draw permission for mutations, and
 * presence events for everyone). Ordinary content mutations require `canDraw`.
 */
export function authorizeBoardEvent(input: {
  session: BoardSession;
  participant: Participant;
  event: Pick<BoardEvent, "type">;
  now?: Date;
}): EventAuthorization {
  const now = input.now ?? new Date();

  if (input.participant.boardSessionId !== input.session.id) {
    return { allowed: false, reason: "PARTICIPANT_NOT_IN_SESSION" };
  }

  if (!canJoinBoard(input.session, now)) {
    return { allowed: false, reason: "SESSION_NOT_JOINABLE" };
  }

  if (PRESENCE_EVENT_TYPES.has(input.event.type)) {
    return { allowed: true };
  }

  if (OWNER_ONLY_EVENT_TYPES.has(input.event.type)) {
    if (input.participant.role !== "owner") {
      return { allowed: false, reason: "OWNER_ONLY_EVENT" };
    }
    // Owner administrative events still require the owner to be an active drawer
    // (e.g. board.cleared), which canDraw enforces for the owner role.
    if (input.event.type === "board.cleared" && !canDraw({ session: input.session, participant: input.participant, now })) {
      return { allowed: false, reason: "NOT_ALLOWED_TO_DRAW" };
    }
    return { allowed: true };
  }

  if (!canDraw({ session: input.session, participant: input.participant, now })) {
    return { allowed: false, reason: "NOT_ALLOWED_TO_DRAW" };
  }

  return { allowed: true };
}

export function shouldLockForOwnerAbsence(input: {
  session: BoardSession;
  ownerGracePeriodSeconds: number;
  now?: Date;
}): boolean {
  if (input.session.status !== "owner_disconnected") {
    return false;
  }

  const now = input.now ?? new Date();
  const lastSeen = new Date(input.session.ownerLastSeenAt).getTime();
  return now.getTime() - lastSeen > input.ownerGracePeriodSeconds * 1000;
}
