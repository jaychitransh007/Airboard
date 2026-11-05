import type { HoldToEditEvent } from "./holdToEditTracker";

export type NavigationActionEvidence =
  | "navigation_pan"
  | "navigation_zoom";

/**
 * Converts frame-level navigation state into one content-free action record
 * per engaged session. The tracker rearms only after reservation ends.
 */
export class GestureActionEvidenceTracker {
  private navigationMode: "pan" | "zoom" | null = null;

  observeNavigation(input: {
    reserving: boolean;
    engaged: boolean;
    updateMode: "idle" | "pan" | "zoom";
  }): NavigationActionEvidence | null {
    if (!input.reserving) {
      this.navigationMode = null;
      return null;
    }
    if (
      !input.engaged ||
      input.updateMode === "idle" ||
      this.navigationMode !== null
    ) {
      return null;
    }
    this.navigationMode = input.updateMode;
    return input.updateMode === "pan"
      ? "navigation_pan"
      : "navigation_zoom";
  }

  reset(): void {
    this.navigationMode = null;
  }
}

export function holdToEditActionEvidence(
  event: HoldToEditEvent,
): "hold_to_edit_scope" | null {
  return event?.type === "scope" ? "hold_to_edit_scope" : null;
}
