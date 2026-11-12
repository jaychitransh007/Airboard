import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBoardEvent,
  applyDiagramUndo,
  createEventEnvelope,
  createBoardSceneElement,
  createInitialBoardState,
} from "@airboard/core";
import {
  commandTurnSnapshotChanged,
  commitCommandTurn,
  diagramRedoEvents,
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
    "element.created",
    "element.created",
    "element.created",
  ]);
  assert.deepEqual(result.selectionIds, ["api", "db"]);
  assert.deepEqual(Object.keys(result.state.elements).sort(), ["api", "api-db", "db"]);
  assert.deepEqual(result.state.strokes, {});

  const undone = applyDiagramUndo(result.state, {
    undoEvents: result.undoEvents,
  });
  assert.equal(
    Object.values(undone.state.elements).filter((element) => element.status === "active").length,
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

test("redo of an undone turn restores the elements it created instead of replaying their creation", () => {
  let state = createInitialBoardState("eval-board");
  const envelope = (id) => ({
    ...createEventEnvelope({ boardSessionId: "eval-board", actorParticipantId: "eval-participant" }),
    id,
  });
  const connector = createBoardSceneElement({
    id: "connector-1",
    boardId: "eval-board",
    kind: "connector",
    pathKind: "bent",
    transform: { x: 0, y: 0, width: 100, height: 10, rotation: 0 },
    start: { point: { x: 0, y: 0 }, decoration: "none" },
    end: { point: { x: 100, y: 0 }, decoration: "solid_arrow" },
  });
  const forward = [{ ...envelope("create"), type: "element.created", element: connector }];
  const undo = [{ ...envelope("delete"), type: "element.deleted", elementId: connector.id }];
  for (const event of forward) state = applyBoardEvent(state, event);
  state = applyDiagramUndo(state, { undoEvents: undo }).state;
  assert.equal(state.elements[connector.id].status, "deleted");

  // Replaying the creation is a no-op: the element is still there, deleted.
  const replayed = applyDiagramUndo(state, { undoEvents: forward }).state;
  assert.equal(replayed.elements[connector.id].status, "deleted");

  const redo = diagramRedoEvents(state, forward);
  assert.equal(redo[0].type, "element.restored");
  assert.equal(redo[0].elementId, connector.id);
  assert.equal(redo[0].id, "create");
  const redone = applyDiagramUndo(state, { undoEvents: redo }).state;
  assert.equal(redone.elements[connector.id].status, "active");

  // An element the board never had is still created.
  const fresh = diagramRedoEvents(createInitialBoardState("eval-board"), forward);
  assert.equal(fresh[0].type, "element.created");
});
