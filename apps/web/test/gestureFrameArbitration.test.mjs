import assert from "node:assert/strict";
import test from "node:test";

import {
  GESTURE_FRAME_PRIORITY,
  arbitrateGestureFrame,
} from "../src/features/board/gestureFrameArbitration.ts";

const claimingOwners = ["navigation", "snap", "undo", "voice"];

function runScenario(winner) {
  const inspected = [];
  const executed = [];
  const preempted = [];
  const stage = (owner) => ({
    update: () => {
      inspected.push(owner);
      const claims = owner === winner;
      if (claims) {
        executed.push(owner);
      }
      return claims;
    },
    onPreempted: () => {
      preempted.push(owner);
    },
  });

  const owner = arbitrateGestureFrame({
    navigation: stage("navigation"),
    snap: stage("snap"),
    undo: stage("undo"),
    voice: stage("voice"),
    manipulation: {
      run: () => {
        executed.push("manipulation");
      },
      onPreempted: () => {
        preempted.push("manipulation");
      },
    },
  });

  return { owner, inspected, executed, preempted };
}

test("publishes the production gesture ownership order", () => {
  assert.deepEqual(GESTURE_FRAME_PRIORITY, [
    "navigation",
    "snap",
    "undo",
    "voice",
    "manipulation",
  ]);
});

for (const [winnerIndex, winner] of claimingOwners.entries()) {
  test(`${winner} owns the frame and preempts every lower-priority callback`, () => {
    const result = runScenario(winner);

    assert.equal(result.owner, winner);
    assert.deepEqual(
      result.inspected,
      claimingOwners.slice(0, winnerIndex + 1),
      "recognition stops as soon as the winning owner claims the frame",
    );
    assert.deepEqual(
      result.executed,
      [winner],
      "only the winning owner's action callback executes",
    );
    assert.deepEqual(
      result.preempted,
      GESTURE_FRAME_PRIORITY.slice(winnerIndex + 1),
      "every lower-priority state machine receives explicit cleanup",
    );
  });
}

test("manipulation runs exactly once as the fallback when no global gesture claims", () => {
  const result = runScenario("manipulation");

  assert.equal(result.owner, "manipulation");
  assert.deepEqual(result.inspected, claimingOwners);
  assert.deepEqual(result.executed, ["manipulation"]);
  assert.deepEqual(result.preempted, []);
});

test("simultaneous claims still produce one owner: the highest-priority stage", () => {
  const inspected = [];
  const executed = [];
  const preempted = [];
  const claimingStage = (owner) => ({
    update: () => {
      inspected.push(owner);
      executed.push(owner);
      return true;
    },
    onPreempted: () => {
      preempted.push(owner);
    },
  });

  const owner = arbitrateGestureFrame({
    navigation: claimingStage("navigation"),
    snap: claimingStage("snap"),
    undo: claimingStage("undo"),
    voice: claimingStage("voice"),
    manipulation: {
      run: () => {
        executed.push("manipulation");
      },
      onPreempted: () => {
        preempted.push("manipulation");
      },
    },
  });

  assert.equal(owner, "navigation");
  assert.deepEqual(inspected, ["navigation"]);
  assert.deepEqual(executed, ["navigation"]);
  assert.deepEqual(preempted, [
    "snap",
    "undo",
    "voice",
    "manipulation",
  ]);
});
