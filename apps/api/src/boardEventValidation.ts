import {
  BOARD_SCENE_VERSION,
  isBoardElementPatchOperation,
  isBoardSceneElement,
  isLegacyBoardEventType,
  type BoardEvent,
} from "@airboard/core";

/**
 * Scene versions the realtime socket accepts: only the current one, so tabs
 * from before shape-merge phase 3 (version 2) get UPGRADE_REQUIRED and reload.
 */
const SUPPORTED_SCENE_VERSIONS: ReadonlySet<string> = new Set([String(BOARD_SCENE_VERSION)]);

export function isSupportedSceneVersion(value: unknown): boolean {
  return SUPPORTED_SCENE_VERSIONS.has(String(value ?? ""));
}

export const BOARD_EVENT_TYPES: ReadonlySet<BoardEvent["type"]> = new Set([
  "undo.requested",
  "redo.requested",
  "board.cleared",
  "cursor.moved",
  "participant.joined",
  "participant.left",
  "owner.presence_changed",
  "permission.changed",
  "element.created",
  "element.patched",
  "element.deleted",
  "element.restored",
]);

/**
 * Runtime gate for websocket events. It validates every field the reducer reads
 * and fully validates v2 scene elements/patches before they are persisted.
 */
export function invalidBoardEventReason(event: unknown): string | null {
  if (!isRecord(event)) return "MALFORMED_EVENT";
  // The retired annotation-stroke events are never written again. Rows already
  // stored still replay through core replayBoardEvents.
  if (isLegacyBoardEventType(event.type)) return "LEGACY_EVENT_RETIRED";
  if (typeof event.type !== "string" || !BOARD_EVENT_TYPES.has(event.type as BoardEvent["type"])) {
    return "UNKNOWN_EVENT_TYPE";
  }
  if (
    !isNonEmptyString(event.id) ||
    !isNonEmptyString(event.boardSessionId) ||
    !isNonEmptyString(event.createdAt)
  ) {
    return "INVALID_EVENT_ENVELOPE";
  }

  switch (event.type) {
    case "cursor.moved":
      return isRecord(event.cursor) &&
        isNonEmptyString(event.cursor.participantId) &&
        Number.isFinite(event.cursor.x) &&
        Number.isFinite(event.cursor.y)
        ? null
        : "INVALID_CURSOR";
    case "participant.joined":
      return isRecord(event.participant) &&
        isNonEmptyString(event.participant.id) &&
        isNonEmptyString(event.participant.boardSessionId)
        ? null
        : "INVALID_PARTICIPANT";
    case "participant.left":
      return isNonEmptyString(event.participantId) ? null : "INVALID_PARTICIPANT";
    case "owner.presence_changed":
      return ["active", "owner_disconnected", "locked"].includes(String(event.status))
        ? null
        : "INVALID_OWNER_PRESENCE";
    case "permission.changed":
      return typeof event.allowParticipantDrawing === "boolean"
        ? null
        : "INVALID_PERMISSION";
    case "element.created":
      return isBoardSceneElement(event.element) ? null : "INVALID_SCENE_ELEMENT";
    case "element.patched":
      return isNonEmptyString(event.elementId) &&
        Array.isArray(event.patches) &&
        event.patches.length > 0 &&
        event.patches.length <= 1_000 &&
        event.patches.every(isBoardElementPatchOperation) &&
        (event.baseRevision === undefined ||
          (Number.isSafeInteger(event.baseRevision) && Number(event.baseRevision) >= 0))
        ? null
        : "INVALID_ELEMENT_PATCH";
    case "element.deleted":
    case "element.restored":
      return isNonEmptyString(event.elementId) ? null : "INVALID_ELEMENT_ID";
    case "undo.requested":
    case "redo.requested":
    case "board.cleared":
      return null;
    default:
      return "UNKNOWN_EVENT_TYPE";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
