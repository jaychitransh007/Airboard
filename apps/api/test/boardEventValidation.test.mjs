import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidBoardEventReason,
  isSupportedSceneVersion,
} from "../src/boardEventValidation.ts";
import { createBoardSceneElement } from "../../../packages/core/src/sceneElements.ts";
import { LEGACY_BOARD_EVENT_TYPES } from "../../../packages/core/src/legacyStrokeMigration.ts";

const envelope = {
  id: "event-1",
  boardSessionId: "board-1",
  actorParticipantId: "participant-1",
  createdAt: "2026-08-07T00:00:00.000Z",
};

test("accepts fully validated v2 scene lifecycle events", () => {
  const element = createBoardSceneElement({
    id: "shape-1",
    boardId: "board-1",
    kind: "shape",
    shapeKind: "speech-bubble",
  });
  assert.equal(
    invalidBoardEventReason({ ...envelope, type: "element.created", element }),
    null,
  );
  assert.equal(
    invalidBoardEventReason({
      ...envelope,
      type: "element.patched",
      elementId: element.id,
      patches: [{ op: "field.set", path: ["style", "fill"], value: "#ffffff" }],
    }),
    null,
  );
  assert.equal(
    invalidBoardEventReason({ ...envelope, type: "element.deleted", elementId: element.id }),
    null,
  );
});

test("rejects malformed elements and unsafe or non-JSON patch paths", () => {
  const element = createBoardSceneElement({
    id: "shape-1",
    boardId: "board-1",
    kind: "shape",
  });
  element.transform.width = Number.NaN;
  assert.equal(
    invalidBoardEventReason({ ...envelope, type: "element.created", element }),
    "INVALID_SCENE_ELEMENT",
  );
  assert.equal(
    invalidBoardEventReason({
      ...envelope,
      type: "element.patched",
      elementId: element.id,
      patches: [{ op: "field.set", path: ["__proto__", "polluted"], value: true }],
    }),
    "INVALID_ELEMENT_PATCH",
  );
  assert.equal(
    invalidBoardEventReason({
      ...envelope,
      type: "element.patched",
      elementId: element.id,
      patches: [{ op: "field.set", path: ["transform", "x"], value: Number.NaN }],
    }),
    "INVALID_ELEMENT_PATCH",
  );
});

test("the retired annotation-stroke events are refused before any other check", () => {
  assert.equal(LEGACY_BOARD_EVENT_TYPES.length, 8);
  for (const type of LEGACY_BOARD_EVENT_TYPES) {
    assert.equal(invalidBoardEventReason({ ...envelope, type }), "LEGACY_EVENT_RETIRED", type);
    assert.equal(invalidBoardEventReason({ type }), "LEGACY_EVENT_RETIRED", type);
  }
  // Exact names, so the list covers stroke.committed and erase.committed.
  assert.ok(LEGACY_BOARD_EVENT_TYPES.includes("stroke.committed"));
  assert.ok(LEGACY_BOARD_EVENT_TYPES.includes("erase.committed"));
  assert.equal(invalidBoardEventReason({ ...envelope, type: "stroke.unknown" }), "UNKNOWN_EVENT_TYPE");
  assert.equal(
    invalidBoardEventReason({ ...envelope, type: "cursor.moved", cursor: { participantId: "p", x: 1, y: 2 } }),
    null,
  );
  assert.equal(invalidBoardEventReason({ ...envelope, type: "element.deleted", elementId: "shape-1" }), null);
});

test("the websocket handshake accepts only scene version 3", () => {
  assert.equal(isSupportedSceneVersion(2), false);
  assert.equal(isSupportedSceneVersion("2"), false);
  assert.equal(isSupportedSceneVersion(3), true);
  assert.equal(isSupportedSceneVersion("3"), true);
  assert.equal(isSupportedSceneVersion(1), false);
  assert.equal(isSupportedSceneVersion("4"), false);
  assert.equal(isSupportedSceneVersion(null), false);
});
