import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRealMediaDevice,
} from "../src/features/board/realDeviceMediaEval.ts";

test("accepts a live station-bound physical camera", () => {
  assert.deepEqual(
    validateRealMediaDevice(camera(), /FaceTime HD Camera/iu),
    [],
  );
});

test("rejects fake and virtual labels or settings even when tracks are live", () => {
  assert.ok(
    validateRealMediaDevice(
      camera({ label: "Fake Video Capture" }),
      /Fake Video Capture/iu,
    ).includes("virtual_device_label"),
  );
  assert.ok(
    validateRealMediaDevice(
      camera({
        settings: {
          ...camera().settings,
          deviceId: "fake_device_0",
        },
      }),
      /FaceTime HD Camera/iu,
    ).includes("virtual_device_settings"),
  );
});

test("rejects logical defaults, dead tracks, missing frames, and the wrong station device", () => {
  const failures = validateRealMediaDevice(
    camera({
      readyState: "ended",
      videoFramesAdvanced: false,
      settings: {
        ...camera().settings,
        deviceId: "default",
      },
    }),
    /Studio Display Camera/iu,
  );
  assert.ok(failures.includes("track_not_live"));
  assert.ok(failures.includes("camera_frames_not_advancing"));
  assert.ok(failures.includes("logical_default_device"));
  assert.ok(failures.includes("unexpected_station_device"));
});

test("requires a live, enumerated microphone with plausible capture settings", () => {
  const microphone = {
    kind: "audioinput",
    label: "MacBook Pro Microphone",
    readyState: "live",
    enabled: true,
    muted: false,
    observedOverMs: 750,
    enumeratedDeviceMatched: true,
    settings: {
      deviceId: "physical-microphone-id",
      groupId: "physical-microphone-group",
      sampleRate: 48_000,
      channelCount: 1,
    },
  };
  assert.deepEqual(
    validateRealMediaDevice(microphone, /MacBook Pro Microphone/iu),
    [],
  );
  assert.ok(
    validateRealMediaDevice(
      {
        ...microphone,
        settings: { ...microphone.settings, sampleRate: 0 },
      },
      /MacBook Pro Microphone/iu,
    ).includes("invalid_microphone_settings"),
  );
});

function camera(overrides = {}) {
  return {
    kind: "videoinput",
    label: "FaceTime HD Camera",
    readyState: "live",
    enabled: true,
    muted: false,
    observedOverMs: 750,
    enumeratedDeviceMatched: true,
    videoFramesAdvanced: true,
    settings: {
      deviceId: "physical-camera-id",
      groupId: "physical-camera-group",
      width: 1280,
      height: 720,
      frameRate: 30,
    },
    ...overrides,
  };
}
