import {
  BOARD_SCENE_VERSION,
  isBoardElementPatchOperation,
  isBoardSceneElement,
  type BoardEvent,
} from "@airboard/core";

export function isSupportedSceneVersion(value: unknown): boolean {
  return String(value ?? "") === String(BOARD_SCENE_VERSION);
}

export const BOARD_EVENT_TYPES: ReadonlySet<BoardEvent["type"]> = new Set([
  "stroke.started",
  "stroke.point_added",
  "stroke.committed",
  "stroke.label_updated",
  "stroke.annotation_updated",
  "erase.committed",
  "stroke.deleted",
  "stroke.restored",
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
    case "stroke.started":
      return isStroke(event.stroke) ? null : "INVALID_STROKE";
    case "stroke.point_added":
      return isNonEmptyString(event.strokeId) && isStrokePoint(event.point)
        ? null
        : "INVALID_STROKE_POINT";
    case "stroke.committed":
      return isNonEmptyString(event.strokeId) &&
        (event.points === undefined ||
          (Array.isArray(event.points) && event.points.every(isStrokePoint)))
        ? null
        : "INVALID_STROKE_COMMIT";
    case "stroke.label_updated":
      return isNonEmptyString(event.strokeId) && typeof event.label === "string"
        ? null
        : "INVALID_STROKE_LABEL";
    case "stroke.annotation_updated":
      return isNonEmptyString(event.strokeId) &&
        isRecord(event.annotation) &&
        Array.isArray(event.points) &&
        event.points.every(isStrokePoint)
        ? null
        : "INVALID_STROKE_ANNOTATION";
    case "erase.committed":
      return isRecord(event.eraseAction) &&
        isNonEmptyString(event.eraseAction.id) &&
        isStringArray(event.eraseAction.affectedStrokeIds)
        ? null
        : "INVALID_ERASE_ACTION";
    case "stroke.deleted":
    case "stroke.restored":
      return isStringArray(event.strokeIds) ? null : "INVALID_STROKE_IDS";
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

function isStroke(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.boardId) &&
    Array.isArray(value.points) &&
    value.points.every(isStrokePoint)
  );
}

function isStrokePoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.t)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
