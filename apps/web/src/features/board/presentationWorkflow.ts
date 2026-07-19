export type PresentationSource = "screen" | "camera" | "dark";

export type PresentationReadinessInput = {
  theme: "classic" | "lightboard";
  source: PresentationSource;
  canvasReady: boolean;
  screenReady: boolean;
  cameraReady: boolean;
  localContrastPlates: boolean;
  pendingPreview?: boolean;
};

export type PresentationReadinessCheck = {
  id: "theme" | "source" | "canvas" | "contrast" | "preview";
  label: string;
  passed: boolean;
};

export const SCREEN_PRESENTATION_SCRIM = 0.25;
export const MAX_SCREEN_FRIENDLY_SCRIM = 0.45;

/** Preserve an already-light user preference; otherwise reveal the shared screen. */
export function screenFriendlyScrim(current: number): number {
  return current > MAX_SCREEN_FRIENDLY_SCRIM ? SCREEN_PRESENTATION_SCRIM : current;
}

export function assessPresentationReadiness(
  input: PresentationReadinessInput,
): { ready: boolean; checks: PresentationReadinessCheck[] } {
  const sourcePassed =
    input.source === "screen"
      ? input.screenReady
      : input.source === "camera"
        ? input.cameraReady
        : true;
  const sourceLabel =
    input.source === "screen"
      ? "Selected screen/window is live"
      : input.source === "camera"
        ? "Camera background is live"
        : "Dark canvas background is ready";
  const checks: PresentationReadinessCheck[] = [
    { id: "theme", label: "Lightboard theme is active", passed: input.theme === "lightboard" },
    { id: "source", label: sourceLabel, passed: sourcePassed },
    { id: "canvas", label: "Composited Airboard canvas is rendering", passed: input.canvasReady },
    {
      id: "contrast",
      label: "Local contrast plates protect diagram legibility",
      passed: input.source !== "screen" || input.localContrastPlates,
    },
    {
      id: "preview",
      label: "No unfinished command preview is on stage",
      passed: !input.pendingPreview,
    },
  ];
  return { ready: checks.every((check) => check.passed), checks };
}
