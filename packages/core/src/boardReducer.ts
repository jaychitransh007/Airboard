import type {
  BoardEvent,
  BoardSceneElement,
  BoardState,
  Stroke,
  StrokePoint,
} from "./types.ts";
import { BOARD_SCENE_VERSION } from "./types.ts";
import { applyBoardElementPatches } from "./sceneElements.ts";
import { isBoardSceneElement } from "./sceneValidation.ts";

export function createInitialBoardState(boardId: string): BoardState {
  return {
    boardId,
    sceneVersion: BOARD_SCENE_VERSION,
    elements: {},
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };
}

export function reduceBoardEvents(
  initialState: BoardState,
  events: readonly BoardEvent[],
): BoardState {
  return events.reduce(applyBoardEvent, initialState);
}

export function applyBoardEvent(state: BoardState, event: BoardEvent): BoardState {
  // Events and states arrive off the wire: a state without `elements` (a
  // very old snapshot) must not crash the reducer. Saved boards in the legacy
  // stroke model are converted before they reach it (upgradeLegacyBoardState).
  if (!state.elements) state = { ...state, elements: {} };
  const lastSequence = Math.max(state.lastSequence, event.sequence ?? state.lastSequence);

  switch (event.type) {
    case "board.cleared": {
      return {
        ...state,
        lastSequence,
        clearedAt: event.createdAt,
        elements: markElementsStatus(
          state.elements,
          undefined,
          "deleted",
          event.createdAt,
        ),
        activeStrokes: {},
      };
    }

    case "element.created": {
      if (
        !isBoardSceneElement(event.element) ||
        state.elements[event.element.id]
      ) {
        return { ...state, lastSequence };
      }
      return {
        ...state,
        lastSequence,
        elements: {
          ...state.elements,
          [event.element.id]: event.element,
        },
      };
    }

    case "element.patched": {
      const element = state.elements[event.elementId];
      if (!element || !Array.isArray(event.patches)) {
        return { ...state, lastSequence };
      }
      const patched = applyBoardElementPatches(element, event.patches, event.createdAt);
      if (patched === element) {
        return { ...state, lastSequence };
      }
      return {
        ...state,
        lastSequence,
        elements: {
          ...state.elements,
          [event.elementId]: patched,
        },
      };
    }

    case "element.deleted":
      return {
        ...state,
        lastSequence,
        elements: markElementsStatus(
          state.elements,
          [event.elementId],
          "deleted",
          event.createdAt,
        ),
      };

    case "element.restored":
      return {
        ...state,
        lastSequence,
        elements: markElementsStatus(
          state.elements,
          [event.elementId],
          "active",
          event.createdAt,
        ),
      };

    case "cursor.moved": {
      return {
        ...state,
        lastSequence,
        cursors: {
          ...state.cursors,
          [event.cursor.participantId]: event.cursor,
        },
      };
    }

    case "participant.joined": {
      return {
        ...state,
        lastSequence,
        participants: {
          ...state.participants,
          [event.participant.id]: event.participant,
        },
      };
    }

    case "participant.left": {
      const { [event.participantId]: _participant, ...participants } = state.participants;
      const { [event.participantId]: _cursor, ...cursors } = state.cursors;
      return {
        ...state,
        lastSequence,
        participants,
        cursors,
      };
    }

    case "undo.requested":
    case "redo.requested":
    case "owner.presence_changed":
    case "permission.changed":
      return { ...state, lastSequence };

    default:
      // Events arrive off the wire and are untrusted at runtime, so the switch
      // is not truly exhaustive. Ignore an unknown/forward-compat event type
      // rather than falling through and returning undefined (which corrupts the
      // board and crashes every subsequent event). Advance lastSequence so the
      // stored sequence stays monotonic. Rows of the retired legacy stroke
      // and erase events land here too (replayBoardEvents reads them).
      return { ...state, lastSequence };
  }
}

/** Starts the local freehand preview line (`activeStrokes`); never sent or stored. */
export function createStroke(input: {
  id: string;
  boardId: string;
  userId: string;
  point: StrokePoint;
  color?: string;
  thickness?: number;
  inputSource?: Stroke["inputSource"];
  trackingSource?: Stroke["trackingSource"];
  createdAt: string;
}): Stroke {
  const stroke: Stroke = {
    id: input.id,
    boardId: input.boardId,
    userId: input.userId,
    tool: "marker",
    color: input.color ?? "#111827",
    thickness: input.thickness ?? 4,
    points: [input.point],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: "active",
  };
  if (input.inputSource) {
    stroke.inputSource = input.inputSource;
  }
  if (input.trackingSource) {
    stroke.trackingSource = input.trackingSource;
  }
  return stroke;
}

function markElementsStatus(
  elements: Record<string, BoardSceneElement>,
  elementIds: readonly string[] | undefined,
  status: BoardSceneElement["status"],
  updatedAt: string,
): Record<string, BoardSceneElement> {
  const ids = new Set(elementIds ?? Object.keys(elements));
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(elements).map(([id, element]) => {
      if (!ids.has(id) || element.status === status) return [id, element];
      changed = true;
      return [
        id,
        {
          ...element,
          status,
          updatedAt,
          revision: element.revision + 1,
        } as BoardSceneElement,
      ];
    }),
  );
  return changed ? next : elements;
}
