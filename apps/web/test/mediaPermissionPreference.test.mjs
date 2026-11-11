import assert from "node:assert/strict";
import test from "node:test";

import {
  airoStartPlan,
  mediaPermissionLabel,
  queryMediaPermission,
  requestMediaAccess,
} from "../src/features/board/mediaPermissionPreference.ts";

function fakeMedia(outcomes) {
  const calls = [];
  const stopped = [];
  const getUserMedia = async (constraints) => {
    calls.push(constraints);
    const outcome = outcomes.shift();
    if (outcome !== "ok") throw Object.assign(new Error(outcome), { name: outcome });
    const track = { stop: () => stopped.push(constraints) };
    return { getTracks: () => [track] };
  };
  return { calls, stopped, getUserMedia };
}

test("a board starts every input that isn't blocked or turned off, and asks only for what isn't granted", () => {
  assert.deepEqual(
    airoStartPlan({ voice: true, camera: true, microphonePermission: "prompt", cameraPermission: "prompt" }),
    { voice: true, camera: true, ask: { audio: true, video: true } },
  );
  assert.deepEqual(
    airoStartPlan({ voice: true, camera: true, microphonePermission: "granted", cameraPermission: "unsupported" }),
    { voice: true, camera: true, ask: { audio: false, video: true } },
  );
  assert.deepEqual(
    airoStartPlan({ voice: true, camera: true, microphonePermission: "denied", cameraPermission: "granted" }),
    { voice: false, camera: true, ask: { audio: false, video: false } },
  );
  assert.deepEqual(
    airoStartPlan({ voice: false, camera: true, microphonePermission: "prompt", cameraPermission: "prompt" }),
    { voice: false, camera: true, ask: { audio: false, video: true } },
  );
});

test("camera and microphone are asked for in one prompt, and the test stream is released", async () => {
  const media = fakeMedia(["ok"]);
  assert.deepEqual(await requestMediaAccess({ audio: true, video: true }, media.getUserMedia), { audio: true, video: true });
  assert.deepEqual(media.calls, [{ audio: true, video: true }]);
  assert.equal(media.stopped.length, 1);
});

test("a refusal leaves both off without asking again", async () => {
  const media = fakeMedia(["NotAllowedError"]);
  assert.deepEqual(await requestMediaAccess({ audio: true, video: true }, media.getUserMedia), { audio: false, video: false });
  assert.equal(media.calls.length, 1);
});

test("a missing camera still lets voice start", async () => {
  const media = fakeMedia(["NotFoundError", "ok", "NotFoundError"]);
  assert.deepEqual(await requestMediaAccess({ audio: true, video: true }, media.getUserMedia), { audio: true, video: false });
  assert.deepEqual(media.calls, [{ audio: true, video: true }, { audio: true, video: false }, { audio: false, video: true }]);
});

test("nothing is asked when everything is already granted", async () => {
  const media = fakeMedia([]);
  assert.deepEqual(await requestMediaAccess({ audio: false, video: false }, media.getUserMedia), { audio: true, video: true });
  assert.equal(media.calls.length, 0);
  assert.deepEqual(await requestMediaAccess({ audio: true, video: false }, undefined), { audio: false, video: true });
});

test("permission queries fail closed without creating a browser prompt", async () => {
  assert.equal(await queryMediaPermission("microphone", undefined), "unsupported");
  assert.equal(
    await queryMediaPermission("camera", {
      query: async () => ({ state: "granted" }),
    }),
    "granted",
  );
  assert.equal(
    await queryMediaPermission("camera", {
      query: async () => {
        throw new Error("descriptor unsupported");
      },
    }),
    "unsupported",
  );
});

test("permission labels stay plain and actionable", () => {
  assert.equal(mediaPermissionLabel("granted"), "Allowed");
  assert.equal(mediaPermissionLabel("prompt"), "Ask once");
  assert.equal(mediaPermissionLabel("denied"), "Blocked");
  assert.equal(mediaPermissionLabel("unsupported"), "Browser managed");
});
