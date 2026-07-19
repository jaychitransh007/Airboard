import assert from "node:assert/strict";
import test from "node:test";

import {
  describeScreenUnderlayError,
  requestScreenUnderlay,
  stopMediaStream,
} from "../src/features/board/screenUnderlay.ts";

function fakeStream(videoTrackCount = 1) {
  const tracks = [
    ...Array.from({ length: videoTrackCount }, () => ({ kind: "video", stopped: false, stop() { this.stopped = true; } })),
    { kind: "audio", stopped: false, stop() { this.stopped = true; } },
  ];
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  };
}

test("screen underlay requests video-only capture with a bounded frame rate", async () => {
  const stream = fakeStream();
  let received;
  const result = await requestScreenUnderlay(async (constraints) => {
    received = constraints;
    return stream;
  });

  assert.equal(result, stream);
  assert.deepEqual(received, {
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: false,
  });
});

test("screen underlay rejects a source without video and releases every track", async () => {
  const stream = fakeStream(0);
  await assert.rejects(
    requestScreenUnderlay(async () => stream),
    /did not provide a video track/,
  );
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test("screen underlay stop releases every captured track", () => {
  const stream = fakeStream();
  stopMediaStream(stream);
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test("screen capture errors distinguish cancellation from source failures", () => {
  assert.match(
    describeScreenUnderlayError({ name: "NotAllowedError" }),
    /cancelled or blocked/,
  );
  assert.match(describeScreenUnderlayError({ name: "NotFoundError" }), /No shareable/);
  assert.equal(describeScreenUnderlayError(new Error("custom")), "custom");
});
