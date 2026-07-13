import type {
  BoardEvent,
  BoardState,
  EraseAction,
  Stroke,
  StrokePoint,
} from "./types";

export function createInitialBoardState(boardId: string): BoardState {
  return {
    boardId,
    strokes: {},
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
  const lastSequence = Math.max(state.lastSequence, event.sequence ?? state.lastSequence);

  switch (event.type) {
    case "stroke.started": {
      return {
        ...state,
        lastSequence,
        activeStrokes: {
          ...state.activeStrokes,
          [event.stroke.id]: event.stroke,
        },
      };
    }

    case "stroke.point_added": {
      const activeStroke = state.activeStrokes[event.strokeId];
      if (!activeStroke) {
        return { ...state, lastSequence };
      }

      return {
        ...state,
        lastSequence,
        activeStrokes: {
          ...state.activeStrokes,
          [event.strokeId]: appendPoint(activeStroke, event.point),
        },
      };
    }

    case "stroke.committed": {
      const activeStroke = state.activeStrokes[event.strokeId];
      if (!activeStroke) {
        return { ...state, lastSequence };
      }

      const { [event.strokeId]: _removed, ...remainingActiveStrokes } = state.activeStrokes;
      if (event.discard) {
        return {
          ...state,
          lastSequence,
          activeStrokes: remainingActiveStrokes,
        };
      }

      const committedStroke: Stroke = {
        ...activeStroke,
        points: event.points && event.points.length > 0 ? event.points : activeStroke.points,
        status: "committed",
        updatedAt: event.createdAt,
        committedAt: event.createdAt,
      };

      if (event.cleanupApplied !== undefined) {
        committedStroke.cleanupApplied = event.cleanupApplied;
      }
      if (event.lineSnapApplied !== undefined) {
        committedStroke.lineSnapApplied = event.lineSnapApplied;
      }
      if (event.frictionProfile) {
        committedStroke.frictionProfile = event.frictionProfile;
      }

      return {
        ...state,
        lastSequence,
        activeStrokes: remainingActiveStrokes,
        strokes: {
          ...state.strokes,
          [event.strokeId]: committedStroke,
        },
      };
    }

    case "stroke.label_updated": {
      const stroke = state.strokes[event.strokeId] ?? state.activeStrokes[event.strokeId];
      if (!stroke?.annotation) {
        return { ...state, lastSequence };
      }

      const updatedStroke: Stroke = {
        ...stroke,
        annotation: {
          ...stroke.annotation,
          label: event.label,
        },
        updatedAt: event.createdAt,
      };

      if (state.activeStrokes[event.strokeId]) {
        return {
          ...state,
          lastSequence,
          activeStrokes: {
            ...state.activeStrokes,
            [event.strokeId]: updatedStroke,
          },
        };
      }

      return {
        ...state,
        lastSequence,
        strokes: {
          ...state.strokes,
          [event.strokeId]: updatedStroke,
        },
      };
    }

    case "stroke.annotation_updated": {
      const stroke = state.strokes[event.strokeId] ?? state.activeStrokes[event.strokeId];
      if (!stroke?.annotation) {
        return { ...state, lastSequence };
      }

      const updatedStroke: Stroke = {
        ...stroke,
        annotation: event.annotation,
        points: event.points,
        updatedAt: event.createdAt,
      };

      if (state.activeStrokes[event.strokeId]) {
        return {
          ...state,
          lastSequence,
          activeStrokes: {
            ...state.activeStrokes,
            [event.strokeId]: updatedStroke,
          },
        };
      }

      return {
        ...state,
        lastSequence,
        strokes: {
          ...state.strokes,
          [event.strokeId]: updatedStroke,
        },
      };
    }

    case "erase.committed": {
      return {
        ...state,
        lastSequence,
        eraseActions: {
          ...state.eraseActions,
          [event.eraseAction.id]: event.eraseAction,
        },
        strokes: markStrokesDeleted(
          state.strokes,
          event.eraseAction.affectedStrokeIds,
          event.createdAt,
        ),
      };
    }

    case "stroke.deleted": {
      return {
        ...state,
        lastSequence,
        strokes: markStrokesDeleted(state.strokes, event.strokeIds, event.createdAt),
      };
    }

    case "stroke.restored": {
      return {
        ...state,
        lastSequence,
        strokes: markStrokesRestored(state.strokes, event.strokeIds, event.createdAt),
      };
    }

    case "board.cleared": {
      return {
        ...state,
        lastSequence,
        clearedAt: event.createdAt,
        strokes: markStrokesDeleted(Object.values(state.strokes), undefined, event.createdAt),
        activeStrokes: {},
      };
    }

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
      // stored sequence stays monotonic.
      return { ...state, lastSequence };
  }
}

export function createStroke(input: {
  id: string;
  boardId: string;
  userId: string;
  point: StrokePoint;
  color?: string;
  thickness?: number;
  inputSource?: Stroke["inputSource"];
  trackingSource?: Stroke["trackingSource"];
  annotation?: Stroke["annotation"];
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
  if (input.annotation) {
    stroke.annotation = input.annotation;
  }
  return stroke;
}

export function createEraseAction(input: {
  id: string;
  boardId: string;
  userId: string;
  point: StrokePoint;
  radius: number;
  affectedStrokeIds: string[];
  inputSource?: EraseAction["inputSource"];
  createdAt: string;
}): EraseAction {
  const action: EraseAction = {
    id: input.id,
    boardId: input.boardId,
    userId: input.userId,
    eraserPath: [input.point],
    radius: input.radius,
    affectedStrokeIds: input.affectedStrokeIds,
    createdAt: input.createdAt,
  };
  if (input.inputSource) {
    action.inputSource = input.inputSource;
  }
  return action;
}

function appendPoint(stroke: Stroke, point: StrokePoint): Stroke {
  // point.t is typed as a number but events are untrusted at runtime; a
  // non-finite timestamp would make `new Date(t).toISOString()` throw
  // RangeError and crash the whole reducer/replay. Fall back to the stroke's
  // existing updatedAt in that case.
  const updatedAt = Number.isFinite(point.t)
    ? new Date(point.t).toISOString()
    : stroke.updatedAt;
  return {
    ...stroke,
    points: [...stroke.points, point],
    updatedAt,
  };
}

function markStrokesDeleted(
  strokes: Record<string, Stroke> | Stroke[],
  strokeIds: string[] | undefined,
  updatedAt: string,
): Record<string, Stroke> {
  const input = Array.isArray(strokes)
    ? Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke]))
    : strokes;
  const idsToDelete = new Set(strokeIds ?? Object.keys(input));

  return Object.fromEntries(
    Object.entries(input).map(([id, stroke]) => [
      id,
      idsToDelete.has(id)
        ? {
            ...stroke,
            status: "deleted" as const,
            updatedAt,
          }
        : stroke,
    ]),
  );
}

function markStrokesRestored(
  strokes: Record<string, Stroke>,
  strokeIds: string[],
  updatedAt: string,
): Record<string, Stroke> {
  const idsToRestore = new Set(strokeIds);
  return Object.fromEntries(
    Object.entries(strokes).map(([id, stroke]) => [
      id,
      idsToRestore.has(id)
        ? {
            ...stroke,
            status: "committed" as const,
            updatedAt,
          }
        : stroke,
    ]),
  );
}
