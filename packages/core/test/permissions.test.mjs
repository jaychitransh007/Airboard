import assert from "node:assert/strict";
import test from "node:test";

import { authorizeBoardEvent, canJoinBoard, shouldLockForOwnerAbsence } from "../dist/permissions.js";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function makeSession(overrides = {}) {
  return {
    id: "session-1",
    ownerUserId: "owner",
    provider: "standalone",
    status: "active",
    allowParticipantDrawing: true,
    ownerLastSeenAt: FUTURE,
    expiresAt: FUTURE,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  };
}

function makeParticipant(overrides = {}) {
  return {
    id: "participant-1",
    boardSessionId: "session-1",
    displayName: "Guest",
    role: "editor",
    inputEnabled: true,
    connectedAt: PAST,
    lastSeenAt: PAST,
    ...overrides,
  };
}

test("rejects a participant that does not belong to the session", () => {
  const decision = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ boardSessionId: "other-session" }),
    event: { type: "stroke.committed" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "PARTICIPANT_NOT_IN_SESSION");
});

test("rejects any write to an expired or ended session", () => {
  const expired = authorizeBoardEvent({
    session: makeSession({ expiresAt: PAST }),
    participant: makeParticipant({ role: "owner" }),
    event: { type: "stroke.committed" },
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, "SESSION_NOT_JOINABLE");
});

test("lets any joined participant emit presence events", () => {
  const decision = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "viewer" }),
    event: { type: "cursor.moved" },
  });
  assert.equal(decision.allowed, true);
});

test("viewers cannot mutate the board", () => {
  const decision = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "viewer" }),
    event: { type: "stroke.deleted" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "NOT_ALLOWED_TO_DRAW");
});

test("editors can draw when participant drawing is allowed", () => {
  const decision = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "editor" }),
    event: { type: "stroke.committed" },
  });
  assert.equal(decision.allowed, true);
});

test("editors cannot draw when the owner disabled participant drawing", () => {
  const decision = authorizeBoardEvent({
    session: makeSession({ allowParticipantDrawing: false }),
    participant: makeParticipant({ role: "editor" }),
    event: { type: "stroke.committed" },
  });
  assert.equal(decision.allowed, false);
});

test("owner-absence locking waits for the grace period and only applies while disconnected", () => {
  const base = makeSession({ status: "owner_disconnected", ownerLastSeenAt: PAST });

  // Owner has been gone longer than the grace period → lock.
  assert.equal(
    shouldLockForOwnerAbsence({ session: base, ownerGracePeriodSeconds: 60 }),
    true,
  );

  // Within the grace period → do not lock yet.
  assert.equal(
    shouldLockForOwnerAbsence({
      session: makeSession({ status: "owner_disconnected", ownerLastSeenAt: new Date().toISOString() }),
      ownerGracePeriodSeconds: 60,
    }),
    false,
  );

  // An active session (owner present) never locks for absence.
  assert.equal(
    shouldLockForOwnerAbsence({
      session: makeSession({ status: "active", ownerLastSeenAt: PAST }),
      ownerGracePeriodSeconds: 60,
    }),
    false,
  );
});

test("only the owner can change permissions or clear the board", () => {
  const editorPermission = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "editor" }),
    event: { type: "permission.changed" },
  });
  assert.equal(editorPermission.allowed, false);
  assert.equal(editorPermission.reason, "OWNER_ONLY_EVENT");

  const editorClear = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "editor" }),
    event: { type: "board.cleared" },
  });
  assert.equal(editorClear.allowed, false);

  const ownerClear = authorizeBoardEvent({
    session: makeSession(),
    participant: makeParticipant({ role: "owner" }),
    event: { type: "board.cleared" },
  });
  assert.equal(ownerClear.allowed, true);
});

test("canJoinBoard is the single joinability authority: expiry and lock both deny", () => {
  assert.equal(canJoinBoard(makeSession()), true);
  assert.equal(canJoinBoard(makeSession({ status: "locked" })), false);
  assert.equal(canJoinBoard(makeSession({ status: "ended" })), false);
  // owner_disconnected stays joinable — the grace window belongs to drawing,
  // not joining.
  assert.equal(canJoinBoard(makeSession({ status: "owner_disconnected" })), true);
  // An expired-but-active session must deny joins: the REST join flow and the
  // WS gate both route through this exact check now.
  assert.equal(
    canJoinBoard(
      makeSession({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    ),
    false,
  );
});
