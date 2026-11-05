import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidBoardEventReason,
  isSupportedSceneVersion,
} from "../src/boardEventValidation.ts";
import { createBoardSceneElement } from "../../../packages/core/src/sceneElements.ts";

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

test("the v2 websocket handshake rejects missing or stale scene versions", () => {
  assert.equal(isSupportedSceneVersion(2), true);
  assert.equal(isSupportedSceneVersion("2"), true);
  assert.equal(isSupportedSceneVersion(1), false);
  assert.equal(isSupportedSceneVersion(null), false);
});
