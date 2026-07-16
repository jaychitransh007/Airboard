import assert from "node:assert/strict";
import test from "node:test";

import { resolveMeetActivityState } from "../src/features/meet/meetActivityState.ts";

const VALID = JSON.stringify({ protocolVersion: 1, boardSessionId: "session-1" });
// The pre-runtime adapter serialized activity data without a protocol version.
const LEGACY = JSON.stringify({ boardSessionId: "session-1" });

test("valid activity data resolves on both surfaces", () => {
  for (const surface of ["side-panel", "main-stage"]) {
    const resolved = resolveMeetActivityState({ surface, additionalData: VALID });
    assert.deepEqual(resolved.activity, { protocolVersion: 1, boardSessionId: "session-1" });
    assert.equal(resolved.staleActivityNotice, null);
  }
});

test("side panel without activity data starts fresh silently", () => {
  const resolved = resolveMeetActivityState({ surface: "side-panel", additionalData: undefined });
  assert.equal(resolved.activity, null);
  assert.equal(resolved.staleActivityNotice, null);
});

test("side panel recovers from unreadable activity data instead of dead-ending", () => {
  for (const additionalData of [LEGACY, "not-json", '{"protocolVersion":2,"boardSessionId":"s"}']) {
    const resolved = resolveMeetActivityState({ surface: "side-panel", additionalData });
    assert.equal(resolved.activity, null, `activity must reset for ${additionalData}`);
    assert.match(resolved.staleActivityNotice, /fresh shared board/);
  }
});

test("main stage without a session explains itself", () => {
  assert.throws(
    () => resolveMeetActivityState({ surface: "main-stage", additionalData: undefined }),
    /did not provide an Airboard session/,
  );
});

test("main stage with unreadable data tells the user the recovery path", () => {
  assert.throws(
    () => resolveMeetActivityState({ surface: "main-stage", additionalData: LEGACY }),
    /start a fresh activity from the Airboard side panel/,
  );
});
