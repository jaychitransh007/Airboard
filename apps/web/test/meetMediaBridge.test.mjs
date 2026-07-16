import assert from "node:assert/strict";
import test from "node:test";

import { probeMeetMediaBridge } from "../src/features/meet/meetMediaBridge.ts";

const HOST = { name: "host-window" };
const ORIGIN = "https://meet.google.com";

/** Minimal two-sided bridge environment with scriptable host behavior. */
function makeEnv({ helloAttempts = 3, helloIntervalMs = 5, firstFrameTimeoutMs = 50 } = {}) {
  const listeners = new Set();
  const sentToHost = [];
  const env = {
    listen(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    postToHost(message) {
      sentToHost.push(message);
      env.onHostReceived?.(message);
    },
    hostWindow: HOST,
    allowedOrigins: [ORIGIN],
    helloAttempts,
    helloIntervalMs,
    firstFrameTimeoutMs,
    onHostReceived: null,
  };
  const emit = (message, { origin = ORIGIN, source = HOST } = {}) => {
    for (const handler of [...listeners]) {
      handler({ data: message, origin, source });
    }
  };
  const hostMessage = (type, fields = {}) => ({
    bridge: "airboard-media-bridge",
    v: 1,
    type,
    ...fields,
  });
  return { env, emit, hostMessage, sentToHost };
}

test("probe resolves with a bridge when the host answers hello", async () => {
  const { env, emit, hostMessage, sentToHost } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  assert.notEqual(bridge, null);
  assert.equal(sentToHost.filter((m) => m.type === "hello").length, 1);
});

test("probe resolves null when nothing answers", async () => {
  const { env, sentToHost } = makeEnv({ helloAttempts: 2 });
  const bridge = await probeMeetMediaBridge(env);
  assert.equal(bridge, null);
  assert.equal(sentToHost.filter((m) => m.type === "hello").length, 2);
});

test("ready from a wrong origin or wrong source window is ignored", async () => {
  const { env, emit, hostMessage } = makeEnv({ helloAttempts: 2 });
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"), { origin: "https://evil.example" });
      emit(hostMessage("ready"), { source: { name: "other-window" } });
    }
  };
  assert.equal(await probeMeetMediaBridge(env), null);
});

test("startVideo resolves on the first frame, acks frames, and stops the host", async () => {
  const { env, emit, hostMessage, sentToHost } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
    if (message.type === "start-video") {
      emit(hostMessage("frame", { id: 1, bitmap: { fake: "bitmap-1" } }));
      emit(hostMessage("frame", { id: 2, bitmap: { fake: "bitmap-2" } }));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  const frames = [];
  const session = await bridge.startVideo({
    onFrame: (bitmap) => frames.push(bitmap),
    onEnded: () => {
      throw new Error("must not end in this test");
    },
  });
  assert.deepEqual(frames, [{ fake: "bitmap-1" }, { fake: "bitmap-2" }]);
  assert.deepEqual(
    sentToHost.filter((m) => m.type === "frame-ack").map((m) => m.id),
    [1, 2],
  );
  session.stop();
  assert.equal(sentToHost.filter((m) => m.type === "stop-video").length, 1);
});

test("startVideo rejects when no frame arrives before the timeout", async () => {
  const { env, emit, hostMessage } = makeEnv({ firstFrameTimeoutMs: 20 });
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  await assert.rejects(
    bridge.startVideo({ onFrame: () => {}, onEnded: () => {} }),
    /did not deliver video frames/,
  );
});

test("a host-side end after frames reports onEnded exactly once and stops delivery", async () => {
  const { env, emit, hostMessage } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
    if (message.type === "start-video") {
      emit(hostMessage("frame", { id: 1, bitmap: { fake: "bitmap" } }));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  const endReasons = [];
  const frames = [];
  await bridge.startVideo({
    onFrame: (bitmap) => frames.push(bitmap),
    onEnded: (reason) => endReasons.push(reason),
  });
  emit(hostMessage("ended", { reason: "camera-ended" }));
  emit(hostMessage("ended", { reason: "camera-ended" }));
  emit(hostMessage("frame", { id: 9, bitmap: { fake: "late" } }));
  assert.deepEqual(endReasons, ["camera-ended"]);
  assert.equal(frames.length, 1);
});
