import { expect, test, type Page } from "@playwright/test";

import {
  validateRealMediaDevice,
  type RealMediaDeviceSnapshot,
} from "../src/features/board/realDeviceMediaEval";

const realCameraRequested =
  process.env.AIRBOARD_EVAL_REAL_CAMERA === "1";
const realMicrophoneRequested =
  process.env.AIRBOARD_EVAL_REAL_MICROPHONE === "1";

// Real-device runs must never create Playwright media, screenshots, or traces.
test.use({ screenshot: "off", trace: "off", video: "off" });

test("@real-device validates physical media and production HandLandmarker health", async ({
  context,
  page,
}) => {
  test.skip(
    !realCameraRequested && !realMicrophoneRequested,
    "Protected real-device opt-ins are not enabled.",
  );
  expect(
    realCameraRequested && realMicrophoneRequested,
    "camera and microphone opt-ins must be enabled together",
  ).toBe(true);

  const expectedCamera = requiredPattern(
    "AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN",
  );
  const expectedMicrophone = requiredPattern(
    "AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN",
  );
  const origin = "http://127.0.0.1:3100";
  await context.grantPermissions(["camera", "microphone"], { origin });
  await page.goto("/?testStandalone=1");

  const directCapture = await acquireAndInspectPhysicalMedia(page);
  expect(
    validateRealMediaDevice(directCapture.camera, expectedCamera),
    "physical camera contract",
  ).toEqual([]);
  expect(
    validateRealMediaDevice(directCapture.microphone, expectedMicrophone),
    "physical microphone contract",
  ).toEqual([]);

  const onboarding = page.getByRole("button", {
    name: "Got it — let me try",
  });
  if (await onboarding.isVisible()) await onboarding.click();
  await page.getByRole("button", { name: "Open board settings" }).click();
  const cameraRow = page
    .locator(".media-permission-row")
    .filter({ hasText: "Camera" });
  await expect(cameraRow).toBeVisible();
  await cameraRow.getByRole("button", { name: /^(?:Allow|Use)$/u }).click();

  await expect
    .poll(async () => {
      const observation = await productionPerceptionHealth(page);
      return (
        observation.healthyFrames >= 3 &&
        observation.inferenceErrors === 0 &&
        observation.inferenceDurationsValid &&
        observation.observedOverMs >= 64 &&
        observation.liveCamera
      );
    }, {
      message:
        "production camera frames must reach MediaPipe HandLandmarker and gesture coordination",
      timeout: 45_000,
    })
    .toBe(true);

  const health = await productionPerceptionHealth(page);
  expect(health.healthyFrames).toBeGreaterThanOrEqual(3);
  expect(health.observedOverMs).toBeGreaterThanOrEqual(64);
  expect(health.inferenceDurationsValid).toBe(true);
  expect(
    validateRealMediaDevice(health.camera!, expectedCamera),
    "camera acquired by Airboard production path",
  ).toEqual([]);

  await cameraRow.getByRole("button", { name: "Turn off" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>(".camera-preview");
        const stream = video?.srcObject as MediaStream | null;
        return stream?.getVideoTracks().some((track) => track.readyState === "live") ?? false;
      }),
    )
    .toBe(false);
});

async function acquireAndInspectPhysicalMedia(page: Page): Promise<{
  camera: RealMediaDeviceSnapshot;
  microphone: RealMediaDeviceSnapshot;
}> {
  return page.evaluate(async () => {
    const inspectTrack = (
      track: MediaStreamTrack,
      kind: "videoinput" | "audioinput",
      devices: MediaDeviceInfo[],
      observedOverMs: number,
      videoFramesAdvanced?: boolean,
    ) => {
      const settings = track.getSettings();
      const matchingDevice = devices.find(
        (device) =>
          device.kind === kind &&
          device.deviceId === settings.deviceId &&
          device.label === track.label,
      );
      return {
        kind,
        label: track.label,
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted,
        observedOverMs,
        enumeratedDeviceMatched: Boolean(matchingDevice),
        ...(videoFramesAdvanced === undefined
          ? {}
          : { videoFramesAdvanced }),
        settings: {
          deviceId: settings.deviceId,
          groupId: settings.groupId,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          displaySurface: settings.displaySurface,
        },
      };
    };
    const waitForFrame = (video: HTMLVideoElement) =>
      new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () =>
            reject(
              new Error("The physical camera did not produce a frame"),
            ),
          5_000,
        );
        video.requestVideoFrameCallback(() => {
          window.clearTimeout(timeout);
          resolve();
        });
      });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
      },
    });
    const camera = stream.getVideoTracks()[0];
    const microphone = stream.getAudioTracks()[0];
    if (!camera || !microphone) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Combined real-device capture did not return both tracks");
    }

    const preview = document.createElement("video");
    preview.muted = true;
    preview.playsInline = true;
    preview.srcObject = new MediaStream([camera]);
    const startedAt = performance.now();
    try {
      await preview.play();
      const initialTime = preview.currentTime;
      await waitForFrame(preview);
      await new Promise((resolve) => setTimeout(resolve, 750));
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        camera: inspectTrack(
          camera,
          "videoinput",
          devices,
          performance.now() - startedAt,
          preview.currentTime > initialTime,
        ),
        microphone: inspectTrack(
          microphone,
          "audioinput",
          devices,
          performance.now() - startedAt,
        ),
      };
    } finally {
      preview.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    }
  });
}

async function productionPerceptionHealth(page: Page): Promise<{
  healthyFrames: number;
  inferenceErrors: number;
  inferenceDurationsValid: boolean;
  observedOverMs: number;
  liveCamera: boolean;
  camera: RealMediaDeviceSnapshot | null;
}> {
  return page.evaluate(async () => {
    const inspectTrack = (
      track: MediaStreamTrack,
      kind: "videoinput",
      devices: MediaDeviceInfo[],
      observedOverMs: number,
      videoFramesAdvanced: boolean,
    ) => {
      const settings = track.getSettings();
      const matchingDevice = devices.find(
        (device) =>
          device.kind === kind &&
          device.deviceId === settings.deviceId &&
          device.label === track.label,
      );
      return {
        kind,
        label: track.label,
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted,
        observedOverMs,
        enumeratedDeviceMatched: Boolean(matchingDevice),
        videoFramesAdvanced,
        settings: {
          deviceId: settings.deviceId,
          groupId: settings.groupId,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          displaySurface: settings.displaySurface,
        },
      };
    };
    const hooks = (
      window as unknown as {
        __airboardTestHooks?: {
          getInteractionDiagnostics(): {
            gestureTrace: {
              frameAtMs: number;
              stage: string;
              data: Record<string, unknown>;
            }[];
          };
        };
      }
    ).__airboardTestHooks;
    const trace = hooks?.getInteractionDiagnostics().gestureTrace ?? [];
    const health = trace.filter(
      (event) => event.stage === "perception_health",
    );
    const ok = health.filter((event) => event.data.status === "ok");
    const video = document.querySelector<HTMLVideoElement>(".camera-preview");
    const stream = video?.srcObject as MediaStream | null;
    const camera = stream?.getVideoTracks()[0] ?? null;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      healthyFrames: ok.length,
      inferenceErrors: health.filter(
        (event) => event.data.status === "error",
      ).length,
      inferenceDurationsValid: ok.every(
        (event) =>
          typeof event.data.inferenceMs === "number" &&
          Number.isFinite(event.data.inferenceMs) &&
          event.data.inferenceMs >= 0,
      ),
      observedOverMs:
        ok.length > 1
          ? ok.at(-1)!.frameAtMs - ok[0]!.frameAtMs
          : 0,
      liveCamera:
        camera?.readyState === "live" &&
        Boolean(video && video.readyState >= 2),
      camera: camera
        ? inspectTrack(
            camera,
            "videoinput",
            devices,
            Math.max(
              0,
              ok.length > 1
                ? ok.at(-1)!.frameAtMs - ok[0]!.frameAtMs
                : 0,
            ),
            Boolean(video && video.currentTime > 0 && ok.length >= 3),
          )
        : null,
    };
  });
}

function requiredPattern(name: string): RegExp {
  const source = process.env[name]?.trim();
  if (!source) throw new Error(`${name} is required for a real-device run`);
  try {
    return new RegExp(source, "iu");
  } catch {
    throw new Error(`${name} is not a valid regular expression`);
  }
}
