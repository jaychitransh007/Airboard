import type { StrokeInputSource } from "@airboard/core";

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
  inputMode: "gesture" | "touchpad",
): StrokeInputSource {
  if (pointerType === "pen") return "stylus";
  return inputMode === "touchpad" ? "touchpad" : "pointer";
}
