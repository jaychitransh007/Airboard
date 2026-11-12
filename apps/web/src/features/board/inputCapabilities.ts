import type { StrokeInputSource } from "@airboard/core";

/**
 * Every production input surface. "touchpad" is laptop trackpad navigation:
 * pinch (ctrl/cmd + wheel) zooms at the cursor and two-finger scroll pans.
 * A trackpad press-and-drag reports as a mouse pointer, so it is attributed to
 * "pointer" like any other primary-button drag.
 */
export const AIRBOARD_SHIPPED_INPUT_CHANNELS = [
  "typed",
  "voice",
  "gesture",
  "pointer",
  "touchpad",
  "stylus",
  "keyboard",
  "catalog",
  "remote",
] as const;

export type AirboardShippedInputChannel =
  (typeof AIRBOARD_SHIPPED_INPUT_CHANNELS)[number];

/**
 * Retained only for data compatibility. These paths are not allowed to become
 * runtime input owners without an explicit capability-contract change.
 */
export const AIRBOARD_LEGACY_NON_RUNTIME_INPUTS = [
  "physical_marker",
  "air_writing",
] as const;

export function isShippedInputChannel(
  value: string,
): value is AirboardShippedInputChannel {
  return (AIRBOARD_SHIPPED_INPUT_CHANNELS as readonly string[]).includes(value);
}

export function strokeInputSourceForPointer(
  pointerType: string,
): StrokeInputSource {
  return pointerType === "pen" ? "stylus" : "pointer";
}
