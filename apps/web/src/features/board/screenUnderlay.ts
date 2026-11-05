/**
 * Browser screen/window capture used as the visual layer underneath Airboard.
 *
 * Capture always starts from a user gesture in the UI. This module owns only
 * acquisition/error normalization; React owns the video element and lifecycle.
 */

export type DisplayMediaGetter = (
  constraints?: DisplayMediaStreamOptions,
) => Promise<MediaStream>;

export async function requestScreenUnderlay(
  getDisplayMedia?: DisplayMediaGetter,
): Promise<MediaStream> {
  const acquire =
    getDisplayMedia ??
    (typeof navigator !== "undefined" && navigator.mediaDevices?.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      : null);

  if (!acquire) {
    throw new Error("Screen and window capture is not supported in this browser.");
  }

  const stream = await acquire({
    video: {
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });
  if (stream.getVideoTracks().length === 0) {
    stopMediaStream(stream);
    throw new Error("The selected source did not provide a video track.");
  }
  return stream;
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function describeScreenUnderlayError(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError") {
    return "Screen selection was cancelled or blocked. Airboard is no longer capturing it.";
  }
  if (name === "NotFoundError") {
    return "No shareable screen or window was available.";
  }
  if (name === "NotReadableError") {
    return "The selected screen or window could not be captured. It may already be protected or unavailable.";
  }
  return error instanceof Error ? error.message : "The screen or window could not be captured.";
}
