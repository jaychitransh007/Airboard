import assert from "node:assert/strict";
import test from "node:test";

import {
  probeMeetCameraOverlay,
  probeMeetMediaBridge,
} from "../src/features/meet/meetMediaBridge.ts";

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

test("startAudio resolves on the first chunk and delivers samples with their rate", async () => {
  const { env, emit, hostMessage, sentToHost } = makeEnv();
  const pcm = new Float32Array([0.25, -0.5, 1]);
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
    if (message.type === "start-audio") {
      emit(hostMessage("audio-chunk", { seq: 1, sampleRate: 48000, samples: pcm.buffer }));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  const chunks = [];
  const session = await bridge.startAudio({
    onChunk: (samples, sampleRate) => chunks.push({ samples: [...samples], sampleRate }),
    onEnded: () => {
      throw new Error("must not end in this test");
    },
  });
  assert.deepEqual(chunks, [{ samples: [0.25, -0.5, 1], sampleRate: 48000 }]);
  session.stop();
  assert.equal(sentToHost.filter((m) => m.type === "stop-audio").length, 1);
});

test("channel-scoped end events tear down only their own session", async () => {
  const { env, emit, hostMessage } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "hello") {
      emit(hostMessage("ready"));
    }
    if (message.type === "start-video") {
      emit(hostMessage("frame", { id: 1, bitmap: { fake: "bitmap" } }));
    }
    if (message.type === "start-audio") {
      emit(hostMessage("audio-chunk", { seq: 1, sampleRate: 48000, samples: new Float32Array(4).buffer }));
    }
  };
  const bridge = await probeMeetMediaBridge(env);
  const videoEnds = [];
  const audioChunks = [];
  const audioEnds = [];
  await bridge.startVideo({ onFrame: () => {}, onEnded: (r) => videoEnds.push(r) });
  await bridge.startAudio({
    onChunk: (samples) => audioChunks.push(samples.length),
    onEnded: (r) => audioEnds.push(r),
  });

  emit(hostMessage("ended", { reason: "camera-ended", channel: "video" }));
  assert.deepEqual(videoEnds, ["camera-ended"]);
  assert.deepEqual(audioEnds, [], "video end must not stop audio");

  emit(hostMessage("audio-chunk", { seq: 2, sampleRate: 48000, samples: new Float32Array(8).buffer }));
  assert.deepEqual(audioChunks, [4, 8], "audio keeps flowing after the video ended");

  emit(hostMessage("ended", { reason: "microphone-ended", channel: "audio" }));
  assert.deepEqual(audioEnds, ["microphone-ended"]);
});

test("overlay probe resolves with a handle and reports compositor state", async () => {
  const { env, emit, hostMessage } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "overlay-hello") {
      emit(hostMessage("overlay-state", { armed: false, engaged: true }));
    }
  };
  const states = [];
  const overlay = await probeMeetCameraOverlay(env, (state) => states.push(state));
  assert.notEqual(overlay, null);
  assert.deepEqual(states, [{ armed: false, engaged: true }]);
});

test("overlay probe resolves null when no compositor answers", async () => {
  const { env } = makeEnv({ helloAttempts: 2 });
  assert.equal(await probeMeetCameraOverlay(env, () => {}), null);
});

test("overlay state carries bounded real-Meet outbound verification metrics", async () => {
  const { env, emit, hostMessage } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "overlay-hello") {
      emit(
        hostMessage("overlay-state", {
          armed: true,
          engaged: true,
          verification: {
            extensionVersion: "0.5.0",
            framesComposited: 140,
            lastCompositeAt: 1234,
            senderAttached: true,
            framesEncoded: 120,
            bytesSent: 456789,
            lastVerifiedAt: 1250,
          },
        }),
      );
    }
  };
  const states = [];
  await probeMeetCameraOverlay(env, (state) => states.push(state));
  assert.deepEqual(states[0].verification, {
    extensionVersion: "0.5.0",
    framesComposited: 140,
    lastCompositeAt: 1234,
    senderAttached: true,
    framesEncoded: 120,
    bytesSent: 456789,
    lastVerifiedAt: 1250,
  });
});

test("overlay frames respect the in-flight cap until acked; start/stop reach the host", async () => {
  const { env, emit, hostMessage, sentToHost } = makeEnv();
  env.onHostReceived = (message) => {
    if (message.type === "overlay-hello") {
      emit(hostMessage("overlay-state", { armed: false, engaged: true }));
    }
  };
  const overlay = await probeMeetCameraOverlay(env, () => {});
  overlay.start();

  assert.equal(overlay.trySendFrame({ fake: "b1" }, 0.85), true);
  assert.equal(overlay.trySendFrame({ fake: "b2" }, 0.85), true);
  assert.equal(overlay.trySendFrame({ fake: "b3" }, 0.85), false, "cap of 2 in flight");

  const sentFrames = sentToHost.filter((m) => m.type === "overlay-frame");
  assert.equal(sentFrames.length, 2);
  emit(hostMessage("overlay-ack", { id: sentFrames[0].id }));
  assert.equal(overlay.trySendFrame({ fake: "b4" }, 0.5), true, "ack frees a slot");

  overlay.stop();
  assert.equal(sentToHost.filter((m) => m.type === "overlay-start").length, 1);
  assert.equal(sentToHost.filter((m) => m.type === "overlay-stop").length, 1);
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
