export type RealMediaDeviceSnapshot = {
  kind: "videoinput" | "audioinput";
  label: string;
  readyState: MediaStreamTrackState;
  enabled: boolean;
  muted: boolean;
  observedOverMs: number;
  enumeratedDeviceMatched: boolean;
  videoFramesAdvanced?: boolean;
  settings: {
    deviceId?: string | undefined;
    groupId?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    frameRate?: number | undefined;
    sampleRate?: number | undefined;
    channelCount?: number | undefined;
    displaySurface?: string | undefined;
  };
};

const VIRTUAL_DEVICE_MARKER =
  /(?:^|[^a-z0-9])(?:fake|virtual|synthetic|dummy|test[ _-]*pattern|obs|manycam|snap[ _-]*camera|camo|blackhole|soundflower|loopback|vb[ _-]*audio|null[ _-]*audio|screen[ _-]*capture|screencast)(?:$|[^a-z0-9])/iu;
const LOGICAL_DEVICE_IDS = new Set(["default", "communications"]);

/**
 * Content-free assertions shared by the protected real-device Playwright run
 * and unit tests. The caller deliberately supplies the station's expected
 * label pattern; accepting any nonempty label would let a virtual driver pass.
 */
export function validateRealMediaDevice(
  snapshot: RealMediaDeviceSnapshot,
  expectedLabelPattern: RegExp,
): string[] {
  const failures: string[] = [];
  const settingIdentity = [
    snapshot.settings.deviceId ?? "",
    snapshot.settings.groupId ?? "",
  ].join(" ");

  if (!snapshot.label.trim()) failures.push("device_label_missing");
  if (VIRTUAL_DEVICE_MARKER.test(snapshot.label)) {
    failures.push("virtual_device_label");
  }
  if (VIRTUAL_DEVICE_MARKER.test(settingIdentity)) {
    failures.push("virtual_device_settings");
  }
  if (!expectedLabelPattern.test(snapshot.label)) {
    failures.push("unexpected_station_device");
  }
  expectedLabelPattern.lastIndex = 0;

  if (snapshot.readyState !== "live") failures.push("track_not_live");
  if (!snapshot.enabled) failures.push("track_not_enabled");
  if (snapshot.muted) failures.push("track_muted");
  if (snapshot.observedOverMs < 500) failures.push("track_not_observed_long_enough");
  if (!snapshot.enumeratedDeviceMatched) {
    failures.push("active_device_not_enumerated");
  }
  if (!snapshot.settings.deviceId?.trim()) {
    failures.push("device_id_missing");
  } else if (
    LOGICAL_DEVICE_IDS.has(snapshot.settings.deviceId.trim().toLowerCase())
  ) {
    failures.push("logical_default_device");
  }
  if (!snapshot.settings.groupId?.trim()) {
    failures.push("device_group_missing");
  }
  if (snapshot.settings.displaySurface) {
    failures.push("display_capture_instead_of_camera");
  }

  if (snapshot.kind === "videoinput") {
    if (
      !Number.isFinite(snapshot.settings.width) ||
      snapshot.settings.width! < 320 ||
      !Number.isFinite(snapshot.settings.height) ||
      snapshot.settings.height! < 240 ||
      !Number.isFinite(snapshot.settings.frameRate) ||
      snapshot.settings.frameRate! <= 0
    ) {
      failures.push("invalid_camera_settings");
    }
    if (!snapshot.videoFramesAdvanced) {
      failures.push("camera_frames_not_advancing");
    }
  } else if (
    !Number.isFinite(snapshot.settings.sampleRate) ||
    snapshot.settings.sampleRate! < 8_000 ||
    !Number.isFinite(snapshot.settings.channelCount) ||
    snapshot.settings.channelCount! < 1
  ) {
    failures.push("invalid_microphone_settings");
  }

  return failures;
}
