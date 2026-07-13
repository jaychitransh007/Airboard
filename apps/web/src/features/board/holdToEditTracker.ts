/**
 * Hold-to-edit: grabbing an element (hand or pointer) and holding it still
 * scopes the voice mic to that element. This tracker owns the timing/motion
 * rules as a pure state machine — the caller feeds it the current grab
 * interaction each tick and performs the returned transition.
 */

export type HoldToEditConfig = {
  /** How long the grabbed element must stay still before it scopes. */
  holdMs: number;
  /** Canvas-pixel drift that counts as "the user is moving it, not holding". */
  moveTolerancePx: number;
};

export const defaultHoldToEditConfig: HoldToEditConfig = {
  holdMs: 600,
  moveTolerancePx: 14,
};

export type HoldToEditInput = {
  /** The active move-grab, or null when nothing is grabbed. */
  interaction: { strokeId: string; point: { x: number; y: number } | null } | null;
  now: number;
  /** True when this element is already the open scoped gate. */
  scopedActiveForStroke: boolean;
};

export type HoldToEditEvent =
  | { type: "scope"; strokeId: string }
  | { type: "released" }
  | null;

export class HoldToEditTracker {
  private readonly config: HoldToEditConfig;
  private hold: {
    strokeId: string;
    anchor: { x: number; y: number };
    startedAt: number;
    moved: boolean;
  } | null = null;
  private wasGrabbing = false;

  constructor(config: Partial<HoldToEditConfig> = {}) {
    this.config = { ...defaultHoldToEditConfig, ...config };
  }

  update(input: HoldToEditInput): HoldToEditEvent {
    const { interaction, now, scopedActiveForStroke } = input;

    if (!interaction) {
      this.hold = null;
      if (this.wasGrabbing) {
        this.wasGrabbing = false;
        return { type: "released" };
      }
      return null;
    }

    this.wasGrabbing = true;
    const point = interaction.point;
    if (!this.hold || this.hold.strokeId !== interaction.strokeId) {
      this.hold = point
        ? { strokeId: interaction.strokeId, anchor: point, startedAt: now, moved: false }
        : null;
      return null;
    }
    if (!point || this.hold.moved) {
      return null;
    }
    if (
      Math.hypot(point.x - this.hold.anchor.x, point.y - this.hold.anchor.y) >
      this.config.moveTolerancePx
    ) {
      this.hold.moved = true;
      return null;
    }
    if (now - this.hold.startedAt >= this.config.holdMs && !scopedActiveForStroke) {
      return { type: "scope", strokeId: interaction.strokeId };
    }
    return null;
  }

  reset(): void {
    this.hold = null;
    this.wasGrabbing = false;
  }
}
