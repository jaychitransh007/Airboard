import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramUndo,
  createEventEnvelope,
  createInitialBoardState,
} from "@airboard/core";
import {
  commandTurnSnapshotChanged,
  commitCommandTurn,
} from "../src/features/board/commandTurnCoordinator.ts";

const contextForCommand = (index) => {
  let event = 0;
  let object = 0;
  return {
    boardSessionId: "eval-board",
    actorParticipantId: "eval-participant",
    userId: "eval-user",
    createdAt: `2026-07-30T00:00:0${index}.000Z`,
    eventIdFactory: () => `event-${index}-${++event}`,
    objectIdFactory: () => `object-${index}-${++object}`,
  };
};

test("commits a compound turn atomically as one event and undo batch", () => {
  const initial = createInitialBoardState("eval-board");
  const result = commitCommandTurn({
    snapshot: { boardState: initial, selectionIds: [] },
    currentState: initial,
    currentSelectionIds: [],
    commands: [
      {
        type: "node.create",
        nodeId: "api",
        nodeType: "api",
        label: "API",
        center: { x: 100, y: 100 },
      },
      {
        type: "node.create",
        nodeId: "db",
        nodeType: "database",
        label: "Orders",
        center: { x: 400, y: 100 },
      },
      {
        type: "nodes.connect",
        connectorId: "api-db",
        fromId: "api",
        toId: "db",
        label: "writes",
      },
    ],
    requestedSelectionIds: ["api", "db"],
    contextForCommand,
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(result.events.map((event) => event.type), [
    "stroke.started",
    "stroke.committed",
    "stroke.started",
    "stroke.committed",
    "stroke.started",
    "stroke.committed",
  ]);
  assert.deepEqual(result.selectionIds, ["api", "db"]);
  assert.deepEqual(Object.keys(result.state.strokes).sort(), ["api", "api-db", "db"]);

  const undone = applyDiagramUndo(result.state, {
    undoEvents: result.undoEvents,
  });
  assert.equal(
    Object.values(undone.state.strokes).filter((stroke) => stroke.status === "committed").length,
    0,
    "one Undo compensates the complete user turn",
  );
});

test("rejects stale board or selection snapshots without producing events", () => {
  const initial = createInitialBoardState("eval-board");
  const cursorOnly = applyBoardEvent(initial, {
    ...createEventEnvelope({
      boardSessionId: "eval-board",
      actorParticipantId: "eval-participant",
    }),
    type: "cursor.moved",
    cursor: {
      participantId: "eval-participant",
      x: 4,
      y: 8,
      mode: "marker_hover",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  assert.equal(
    commandTurnSnapshotChanged(
      { boardState: initial, selectionIds: [] },
      cursorOnly,
      [],
    ).stale,
    false,
    "non-content cursor churn is safe",
  );

  const selectionStale = commitCommandTurn({
    snapshot: { boardState: initial, selectionIds: ["api"] },
    currentState: initial,
    currentSelectionIds: ["db"],
    commands: [],
    contextForCommand,
  });
  assert.deepEqual(selectionStale, {
    status: "stale",
    boardChanged: false,
    selectionChanged: true,
  });
});

test("a failing later command cannot leak an earlier command", () => {
  const initial = createInitialBoardState("eval-board");
  assert.throws(() =>
    commitCommandTurn({
      snapshot: { boardState: initial, selectionIds: [] },
      currentState: initial,
      currentSelectionIds: [],
      commands: [
        {
          type: "node.create",
          nodeId: "api",
          nodeType: "api",
          label: "API",
          center: { x: 100, y: 100 },
        },
        {
          type: "nodes.connect",
          connectorId: "bad-edge",
          fromId: "api",
          toId: "missing",
        },
      ],
      contextForCommand,
    }),
  );
  assert.deepEqual(initial.strokes, {});
});
