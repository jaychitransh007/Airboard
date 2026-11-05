/**
 * Pure command-turn commit coordination shared by production and evals.
 *
 * Grounding may produce several DiagramCommands, but a user turn is one
 * transaction: either every command is reduced against the same snapshot and
 * returned as one publish/undo batch, or nothing escapes this function.
 */

import {
  applyDiagramCommand,
  type BoardEvent,
  type BoardState,
  type DiagramCommand,
  type DiagramCommandContext,
} from "@airboard/core";
import { boardContentChanged } from "./intentPipeline.ts";

export type CommandTurnSnapshot = {
  boardState: BoardState;
  selectionIds: readonly string[];
};

export type CommandTurnCommitInput = {
  snapshot: CommandTurnSnapshot;
  currentState: BoardState;
  currentSelectionIds: readonly string[];
  commands: readonly DiagramCommand[];
  requestedSelectionIds?: readonly string[];
  contextForCommand: (commandIndex: number) => DiagramCommandContext;
};

export type AppliedCommandTurn = {
  status: "applied";
  state: BoardState;
  events: BoardEvent[];
  undoEvents: BoardEvent[];
  affectedStrokeIds: string[];
  selectionIds: string[];
};

export type RejectedCommandTurn = {
  status: "stale";
  boardChanged: boolean;
  selectionChanged: boolean;
};

export type CommandTurnCommitResult = AppliedCommandTurn | RejectedCommandTurn;

export function commandTurnSnapshotChanged(
  snapshot: CommandTurnSnapshot,
  currentState: BoardState,
  currentSelectionIds: readonly string[],
): { stale: boolean; boardChanged: boolean; selectionChanged: boolean } {
  const boardChanged = boardContentChanged(currentState, snapshot.boardState);
  const selectionChanged = !sameOrderedIds(
    currentSelectionIds,
    snapshot.selectionIds,
  );
  return {
    stale: boardChanged || selectionChanged,
    boardChanged,
    selectionChanged,
  };
}

/**
 * Reduces a grounded turn without side effects. Callers publish `events`, push
 * `undoEvents`, and replace live state only after this returns `applied`.
 */
export function commitCommandTurn(
  input: CommandTurnCommitInput,
): CommandTurnCommitResult {
  const staleness = commandTurnSnapshotChanged(
    input.snapshot,
    input.currentState,
    input.currentSelectionIds,
  );
  if (staleness.stale) {
    return {
      status: "stale",
      boardChanged: staleness.boardChanged,
      selectionChanged: staleness.selectionChanged,
    };
  }

  let state = input.currentState;
  let events: BoardEvent[] = [];
  let undoEvents: BoardEvent[] = [];
  const affectedStrokeIds = new Set<string>();

  // No caller-visible mutation occurs inside this loop. If a later command
  // throws, the accumulated local state/events are discarded by JavaScript's
  // stack unwinding and the production board remains unchanged.
  for (const [index, command] of input.commands.entries()) {
    const result = applyDiagramCommand(
      state,
      command,
      input.contextForCommand(index),
    );
    state = result.state;
    events = [...events, ...result.events];
    undoEvents = [...result.undoEvents, ...undoEvents];
    for (const strokeId of result.affectedStrokeIds) {
      affectedStrokeIds.add(strokeId);
    }
  }

  const requestedSelectionIds =
    input.requestedSelectionIds ?? input.currentSelectionIds;
  const validRequestedSelection = requestedSelectionIds.filter(
    (strokeId) => state.strokes[strokeId]?.status === "committed",
  );
  const fallbackSelection = [...affectedStrokeIds].filter(
    (strokeId) => state.strokes[strokeId]?.status === "committed",
  );

  return {
    status: "applied",
    state,
    events,
    undoEvents,
    affectedStrokeIds: [...affectedStrokeIds],
    selectionIds:
      validRequestedSelection.length > 0
        ? [...validRequestedSelection]
        : fallbackSelection.slice(-1),
  };
}

function sameOrderedIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((strokeId, index) => strokeId === right[index])
  );
}
