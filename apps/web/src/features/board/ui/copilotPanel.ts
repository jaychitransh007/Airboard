/**
 * The Airo panel's remembered show/hide choice and the canvas width it covers.
 * Moved verbatim out of AirboardPrototype.tsx (board split, phase 1).
 */

/**
 * The Airo panel's show/hide choice. A new key: the panel used to start open,
 * and now starts hidden for everyone until they choose to show it.
 */
export const COPILOT_VISIBILITY_KEY = "airboard.copilot.v2";

/**
 * Whether the Airo panel opens with the board: hidden by default, so voice,
 * hands and the on-board notices carry the board; shown only once the person
 * chose to show it. On a phone it would cover the canvas, so it starts hidden.
 */
export function copilotStartsOpen(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(max-width: 700px)").matches) return false;
  try {
    return window.localStorage.getItem(COPILOT_VISIBILITY_KEY) === "open";
  } catch {
    return false;
  }
}

/** Canvas width the open Airo panel covers on the right. */
export function copilotRightInset(panelOpen: boolean, canvasWidth: number): number {
  return panelOpen ? Math.min(400, canvasWidth * 0.45) : 0;
}
