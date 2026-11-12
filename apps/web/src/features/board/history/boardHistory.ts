/**
 * Undo entries and event-journal helpers of the board component, moved
 * verbatim out of AirboardPrototype.tsx (board split, phase 1).
 */
import type { BoardElementPatchOperation, BoardEvent } from "@airboard/core";
import { OWNER_USER_ID, PARTICIPANT_ID } from "../engine/boardTypes.ts";

export type UndoAction =
  | {
      type: "stroke";
      strokeId: string;
    }
  | {
      type: "erase";
      strokeIds: string[];
    }
  | {
      type: "diagram";
      undoEvents: BoardEvent[];
      /** The forward events, kept so an undone Airo change can be redone. */
      redoEvents?: BoardEvent[];
      selectionBefore: string[];
      originatingInteractionId?: string;
    }
  | {
      type: "scene_created";
      elementId: string;
    }
  | {
      type: "scene_deleted";
      elementId: string;
    }
  | {
      type: "scene_created_batch" | "scene_deleted_batch";
      elementIds: string[];
      selectionBefore?: string[];
      selectionAfter?: string[];
    }
  | {
      type: "scene_patched";
      elementId: string;
      inversePatches: BoardElementPatchOperation[];
    }
  | {
      type: "scene_batch";
      entries: { elementId: string; inversePatches: BoardElementPatchOperation[] }[];
    };

export type UndoSource = "button" | "keyboard" | "voice" | "semantic";

export function diagramCommandContext(boardSessionId: string) {
  return {
    boardSessionId,
    actorParticipantId: PARTICIPANT_ID,
    userId: OWNER_USER_ID,
  };
}

export function appendBoundedBoardEvents(
  journal: BoardEvent[],
  events: readonly BoardEvent[],
  maxEvents = 2_000,
): void {
  journal.push(...events.map((event) => structuredClone(event)));
  if (journal.length > maxEvents) {
    journal.splice(0, journal.length - maxEvents);
  }
}

/** Whether undoing this entry leaves a redo entry that puts it back exactly. */
export function undoEntryCanBeRedone(action: UndoAction): boolean {
  if (action.type === "diagram") return Boolean(action.redoEvents?.length);
  return action.type.startsWith("scene_");
}
