import {
  applyDiagramUndo,
} from "../../../packages/core/src/index.ts";
import { commitCommandTurn } from "../../../apps/web/src/features/board/commandTurnCoordinator.ts";
import { resolveIntentOperation } from "../../../apps/web/src/features/board/intentPipeline.ts";
import {
  canonicalizeBoardEvents,
  canonicalizeBoardState,
  canonicalizeNonBoardState,
  createCanonicalizationContext,
} from "../interaction-eval-harness.mjs";
import {
  deriveBoardEffects,
  seedBoardFromSemanticContext,
  validateGroundedSemanticOutcome,
} from "../semantic-grounding-eval.mjs";

const EMPTY_CONTEXT = Object.freeze({
  selectionCount: 0,
  selected: [],
  objects: [],
  edges: [],
  projectGlossary: [],
  pointerAvailable: false,
});

/**
 * Execute routed deterministic commands through the production grounding,
 * DiagramCommand, reducer, and Undo seams. No transcript or label outside the
 * privacy-approved scenario oracle is added to the result.
 */
export function evaluateDeterministicAudioActions(
  scenario,
  parsedOperations,
) {
  const context = scenario.context ?? EMPTY_CONTEXT;
  const seeded = seedBoardFromSemanticContext(context);
  const initialState = seeded.state;
  const canonicalContext = createCanonicalizationContext({
    includeDeleted: false,
    ignoreFields: ["lastSequence"],
  });
  const initialBoardState = canonicalizeBoardState(initialState, {
    context: canonicalContext,
  });
  let state = initialState;
  let selectionIds = [...seeded.selectedIds];
  const eventDelta = [];
  const diagramCommands = [];
  const failures = [];
  const undoChecks = [];
  const undoStack = [];
  let eventCounter = 0;

  for (const [turnIndex, operation] of parsedOperations.entries()) {
    if (operation.kind === "cancel") {
      continue;
    }
    if (operation.kind === "undo") {
      const prior = undoStack.pop();
      if (!prior) continue;
      const undone = applyDiagramUndo(state, {
        undoEvents: prior.undoEvents,
      });
      state = undone.state;
      selectionIds = [...prior.selectionBefore];
      eventDelta.push(...undone.events);
      continue;
    }

    const beforeTurnState = state;
    const beforeTurnSelection = [...selectionIds];
    const resolution = resolveIntentOperation(operation, {
      boardState: state,
      pointer: pointValue(context.pointer, { x: 450, y: 300 }),
      canvasWidth: finitePositive(context.canvasWidth) ?? 900,
      canvasHeight: finitePositive(context.canvasHeight) ?? 600,
      selectionIds,
      primarySelectionId: selectionIds.at(-1) ?? null,
      hoverStrokeId: null,
      strokeColor: "#111111",
    });
    if ("error" in resolution) {
      failures.push(
        `production grounding rejected ${operation.kind}: ${resolution.error}`,
      );
      continue;
    }

    let commit;
    try {
      commit = commitCommandTurn({
        snapshot: {
          boardState: beforeTurnState,
          selectionIds: beforeTurnSelection,
        },
        currentState: beforeTurnState,
        currentSelectionIds: beforeTurnSelection,
        commands: resolution.commands,
        ...(resolution.selectionAfter
          ? { requestedSelectionIds: resolution.selectionAfter }
          : {}),
        contextForCommand: (commandIndex) => ({
          boardSessionId: state.boardId,
          actorParticipantId: "audio-eval-participant",
          userId: "audio-eval-user",
          createdAt: "2026-07-30T00:00:00.000Z",
          eventIdFactory: () =>
            `audio-event-${turnIndex + 1}-${commandIndex + 1}-${++eventCounter}`,
          objectIdFactory: () =>
            `audio-object-${turnIndex + 1}-${commandIndex + 1}-${eventCounter + 1}`,
        }),
      });
    } catch (error) {
      failures.push(
        `atomic command transaction failed for ${operation.kind}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (commit.status !== "applied") {
      failures.push(
        `atomic command transaction became stale for ${operation.kind}`,
      );
      continue;
    }

    const undoneForCheck = applyDiagramUndo(commit.state, {
      undoEvents: commit.undoEvents,
    });
    const beforeCanonical = canonicalizeBoardState(beforeTurnState, {
      context: canonicalContext,
    });
    const undoneCanonical = canonicalizeBoardState(
      undoneForCheck.state,
      { context: canonicalContext },
    );
    const roundTripPassed =
      JSON.stringify(beforeCanonical) === JSON.stringify(undoneCanonical);
    undoChecks.push({
      turnIndex,
      operationKind: operation.kind,
      applicable: commit.undoEvents.length > 0,
      roundTripPassed,
      eventCount: commit.undoEvents.length,
    });
    if (commit.undoEvents.length > 0 && !roundTripPassed) {
      failures.push(
        `one-step Undo did not restore the board for ${operation.kind}`,
      );
    }
    if (commit.undoEvents.length > 0) {
      undoStack.push({
        undoEvents: commit.undoEvents,
        selectionBefore: beforeTurnSelection,
      });
    }
    state = commit.state;
    selectionIds = commit.selectionIds;
    diagramCommands.push(...resolution.commands);
    eventDelta.push(...commit.events);
  }

  const finalBoardState = canonicalizeBoardState(state, {
    context: canonicalContext,
  });
  const effects = deriveBoardEffects(initialState, state);
  failures.push(
    ...validateGroundedSemanticOutcome(
      {
        status: failures.length > 0 ? "grounding_failed" : "applied",
        groundingError: failures[0] ?? null,
        mutationApplied: eventDelta.length > 0,
        eventDelta,
        effects,
        undo: {
          applicable: undoChecks.some((check) => check.applicable),
          roundTripPassed: undoChecks.every(
            (check) => !check.applicable || check.roundTripPassed,
          ),
        },
      },
      { finalState: scenario.finalState },
      "resolved",
    ),
  );

  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    groundedCommandCount: diagramCommands.length,
    boardEventCount: eventDelta.length,
    initialBoardState,
    finalBoardState,
    finalSelection: canonicalizeNonBoardState(selectionIds, {
      context: canonicalContext,
    }),
    groundedCommands: canonicalizeNonBoardState(diagramCommands, {
      context: canonicalContext,
    }),
    eventDelta: canonicalizeBoardEvents(eventDelta, {
      context: canonicalContext,
    }),
    effects,
    undoChecks,
  };
}

function pointValue(value, fallback) {
  return {
    x: finiteNumber(value?.x) ?? fallback.x,
    y: finiteNumber(value?.y) ?? fallback.y,
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
