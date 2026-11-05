import assert from "node:assert/strict";
import test from "node:test";

import { MediaPipeHandTracker } from "../src/mediapipe.ts";

test("uses HandLandmarker as the sole MediaPipe runtime and preserves its landmark stream", async () => {
  let createOptions;
  let detectedVideo;
  let detectedTimestamp;
  let closed = false;
  const handLandmarker = {
    detectForVideo(video, timestampMs) {
      detectedVideo = video;
      detectedTimestamp = timestampMs;
      return {
        landmarks: [[{ x: 0.1, y: 0.2, z: -0.01 }]],
        worldLandmarks: [[{ x: 0.01, y: 0.02, z: -0.03 }]],
        handednesses: [[{ categoryName: "Left", score: 0.93 }]],
      };
    },
    close() {
      closed = true;
    },
  };
  const runtime = {
    FilesetResolver: {
      async forVisionTasks(baseUrl) {
        assert.equal(baseUrl, "/wasm");
        return { fileset: true };
      },
    },
    HandLandmarker: {
      async createFromOptions(vision, options) {
        assert.deepEqual(vision, { fileset: true });
        createOptions = options;
        return handLandmarker;
      },
    },
  };

  const tracker = await MediaPipeHandTracker.create({
    wasmBaseUrl: "/wasm",
    runtime,
  });
  assert.deepEqual(createOptions, {
    baseOptions: {
      modelAssetPath: "/vendor/mediapipe/models/hand_landmarker.task",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.6,
  });

  const video = { fixture: "camera" };
  assert.deepEqual(tracker.detect(video, 1234), [
    {
      handedness: "left",
      handednessScore: 0.93,
      landmarks: [{ x: 0.1, y: 0.2, z: -0.01 }],
      worldLandmarks: [{ x: 0.01, y: 0.02, z: -0.03 }],
    },
  ]);
  assert.equal(detectedVideo, video);
  assert.equal(detectedTimestamp, 1234);

  tracker.close();
  assert.equal(closed, true);
});

test("custom HandLandmarker thresholds remain configurable without classifier options", async () => {
  let createOptions;
  const runtime = {
    FilesetResolver: {
      async forVisionTasks() {
        return {};
      },
    },
    HandLandmarker: {
      async createFromOptions(_vision, options) {
        createOptions = options;
        return {
          detectForVideo() {
            return { landmarks: [], worldLandmarks: [], handednesses: [] };
          },
          close() {},
        };
      },
    },
  };

  await MediaPipeHandTracker.create({
    runtime,
    modelAssetPath: "/custom-hand.task",
    numHands: 1,
    minHandDetectionConfidence: 0.61,
    minHandPresenceConfidence: 0.62,
    minTrackingConfidence: 0.63,
  });

  assert.equal(createOptions.baseOptions.modelAssetPath, "/custom-hand.task");
  assert.equal(createOptions.numHands, 1);
  assert.equal(createOptions.minHandDetectionConfidence, 0.61);
  assert.equal(createOptions.minHandPresenceConfidence, 0.62);
  assert.equal(createOptions.minTrackingConfidence, 0.63);
  assert.equal("cannedGesturesClassifierOptions" in createOptions, false);
});
