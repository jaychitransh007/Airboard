import { clamp } from "./math.ts";
import {
  defaultPinchHysteresisConfig,
  PinchHysteresis,
  type PinchHysteresisConfig,
  type PinchHysteresisOutput,
  type PinchPhase,
} from "./pinchHysteresis.ts";
import {
  acquireStickyTarget,
  targetCenter,
  type GestureTarget,
} from "./targetAcquisition.ts";
import type { Vector2D } from "./types.ts";

export type NormalizedControlZone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HybridGestureControllerConfig = {
  canvasWidth: number;
  canvasHeight: number;
  controlZone: NormalizedControlZone;
  mirrorX: boolean;
  minTrackingConfidence: number;
  hoverSmoothingTimeMs: number;
  hoverDeadZonePx: number;
  /** Relative drag gain after a target has been latched. Values below 1 add precision. */
  dragGain: number;
  dragDeadZonePx: number;
  maxDragStepPx: number;
  areaCursorRadiusPx: number;
  stickyReleaseRadiusPx: number;
  /** Cursor freezes for this duration, then an active grab is cancelled. */
  trackingLossTimeoutMs: number;
  /** Below this grab-evidence confidence a frame is treated as ambiguous. */
  grabConfidenceFloor: number;
  /** A closed hand may still latch a target only within this window after closing. */
  grabReacquireGraceMs: number;
  pinch: PinchHysteresisConfig;
};

export type HybridGestureControllerOptions = {
  canvasWidth: number;
  canvasHeight: number;
  controlZone?: Partial<NormalizedControlZone>;
  mirrorX?: boolean;
  minTrackingConfidence?: number;
  hoverSmoothingTimeMs?: number;
  hoverDeadZonePx?: number;
  dragGain?: number;
  dragDeadZonePx?: number;
  maxDragStepPx?: number;
  areaCursorRadiusPx?: number;
  stickyReleaseRadiusPx?: number;
  trackingLossTimeoutMs?: number;
  grabConfidenceFloor?: number;
  grabReacquireGraceMs?: number;
  pinch?: Partial<PinchHysteresisConfig>;
};

export type HybridGestureControllerInput = {
  /** Normalized camera-space palm or thumb/index midpoint. */
  handPoint: Vector2D | null;
  trackingConfidence: number;
  /** A normalized 0..1 activation signal: pinch or closed-hand grab. */
  pinchStrength: number;
  /**
   * Optional confidence in the grab estimate (0..1). When below the configured
   * floor the frame is ambiguous: an in-progress grab is held (no slip) while an
   * idle hand reports open (so a new grab cannot false-start and the release
   * gate can clear). Omit to treat pinchStrength as fully trusted.
   */
  grabConfidence?: number;
  timestampMs: number;
  targets: readonly GestureTarget[];
};

export type GestureTrackingState = "tracked" | "frozen" | "lost";

export type GestureManipulationAction =
  | {
      type: "grab_started";
      targetId: string;
      cursor: Vector2D;
      targetAnchor: Vector2D;
      grabOffset: Vector2D;
    }
  | {
      type: "drag_moved";
      targetId: string;
      cursor: Vector2D;
      delta: Vector2D;
      totalDelta: Vector2D;
    }
  | {
      type: "grab_ended";
      targetId: string;
      cursor: Vector2D;
      totalDelta: Vector2D;
    }
  | {
      type: "grab_cancelled";
      targetId: string;
      cursor: Vector2D;
      totalDelta: Vector2D;
      reason: "tracking_lost";
    };

export type HybridGestureControllerState =
  | "idle"
  | "pointing"
  | "pinch_arming"
  | "pinched"
  | "dragging"
  | "pinch_releasing"
  | "tracking_frozen"
  | "tracking_lost";

export type HybridGestureControllerOutput = {
  timestampMs: number;
  state: HybridGestureControllerState;
  trackingState: GestureTrackingState;
  pinchState: PinchPhase;
  /** Stable cursor used for focus and manipulation. */
  cursor: Vector2D | null;
  /** Unsmoothed absolute control-zone mapping for diagnostics. */
  coarseCursor: Vector2D | null;
  focusedTargetId: string | null;
  grabbedTargetId: string | null;
  areaCursorRadiusPx: number;
  /**
   * True while a prior grab/tracking-loss requires the hand to open before any
   * new grab can start. The UI surfaces this as an "open hand to resume" hint so
   * the user is not left with an unexplained unresponsive cursor.
   */
  requiresPinchRelease: boolean;
  action: GestureManipulationAction | null;
};

// When holding an in-progress grab through an uncertain frame, keep the strength
// just above the release threshold so hysteresis stays "closed" without engaging.
const RELEASE_HOLD_EPSILON = 0.01;

const defaultControlZone: NormalizedControlZone = {
  x: 0.22,
  y: 0.16,
  width: 0.56,
  height: 0.68,
};

type ActiveGrab = {
  targetId: string;
  lastControlPoint: Vector2D;
  totalDelta: Vector2D;
};

/**
 * Stable target-aware controller for pointing and object manipulation.
 *
 * Hover uses a coarse absolute map so the whole canvas is reachable from a
 * compact hand zone. A confirmed pinch latches the focused target and switches
 * to low-gain relative motion until release. Focus cannot retarget mid-drag.
 */
export class HybridGestureController {
  readonly config: HybridGestureControllerConfig;

  private readonly pinch: PinchHysteresis;
  private cursor: Vector2D | null = null;
  private coarseCursor: Vector2D | null = null;
  private focusedTargetId: string | null = null;
  private activeGrab: ActiveGrab | null = null;
  private lastTrackedAt: number | null = null;
  private lastUpdateAt: number | null = null;
  private trackingWasMissing = false;
  private lossHandled = false;
  private requirePinchRelease = false;
  /** Timestamp of the most recent close (engage) edge, or null while open. */
  private pinchClosedAt: number | null = null;
  private lastPinch: PinchHysteresisOutput = {
    phase: "open",
    strength: 0,
    engaged: false,
    released: false,
  };

  constructor(options: HybridGestureControllerOptions) {
    this.config = resolveConfig(options);
    this.pinch = new PinchHysteresis(this.config.pinch);
  }

  update(input: HybridGestureControllerInput): HybridGestureControllerOutput {
    const now = monotonicTimestamp(input.timestampMs, this.lastUpdateAt);
    const deltaTimeMs = this.lastUpdateAt === null ? 0 : now - this.lastUpdateAt;
    this.lastUpdateAt = now;

    const tracked =
      input.handPoint !== null &&
      Number.isFinite(input.handPoint.x) &&
      Number.isFinite(input.handPoint.y) &&
      Number.isFinite(input.trackingConfidence) &&
      input.trackingConfidence >= this.config.minTrackingConfidence;
    if (!tracked || !input.handPoint) {
      return this.handleTrackingLoss(now);
    }

    const recovered = this.trackingWasMissing;
    this.trackingWasMissing = false;
    this.lossHandled = false;
    this.lastTrackedAt = now;

    const controlPoint = normalizeControlPoint(
      input.handPoint,
      this.config.controlZone,
      this.config.mirrorX,
    );
    this.coarseCursor = controlPointToCanvas(controlPoint, this.config);

    // Resolve an effective activation strength from a possibly-uncertain frame.
    // When grab confidence is below the floor the reading is ambiguous: hold an
    // in-progress grab closed (no slip), but report open when idle so a new grab
    // cannot false-start and — critically — so the release gate can still clear.
    const grabConfident =
      input.grabConfidence === undefined ||
      !Number.isFinite(input.grabConfidence) ||
      input.grabConfidence >= this.config.grabConfidenceFloor;
    const releaseThreshold = this.config.pinch.releaseThreshold;
    const effectiveStrength = grabConfident
      ? input.pinchStrength
      : this.activeGrab
        ? Math.max(input.pinchStrength, releaseThreshold + RELEASE_HOLD_EPSILON)
        : Math.min(input.pinchStrength, releaseThreshold);

    if (this.requirePinchRelease) {
      if (effectiveStrength <= releaseThreshold) {
        this.requirePinchRelease = false;
      }
      this.pinch.reset();
      this.lastPinch = this.pinch.snapshot();
    } else {
      this.lastPinch = this.pinch.update(effectiveStrength, now);
    }

    // Track the close edge so a still-closed hand can only re-latch a target
    // within a short grace window, not for the entire time it stays closed.
    if (this.lastPinch.engaged) {
      this.pinchClosedAt = now;
    } else if (this.lastPinch.phase === "open") {
      this.pinchClosedAt = null;
    }

    let action: GestureManipulationAction | null = null;

    if (this.activeGrab) {
      if (recovered) {
        // A short camera dropout freezes the object and rebases relative motion,
        // avoiding a jump when tracking resumes.
        this.activeGrab.lastControlPoint = controlPoint;
      } else if (!this.lastPinch.released) {
        const delta = this.relativeDragDelta(this.activeGrab.lastControlPoint, controlPoint);
        if (delta.x !== 0 || delta.y !== 0) {
          // Only rebase after meaningful movement. Sub-dead-zone movements then
          // accumulate instead of making deliberate slow drags impossible.
          this.activeGrab.lastControlPoint = controlPoint;
          const previousCursor = this.cursor ?? this.coarseCursor;
          this.cursor = clampPointToCanvas(addPoints(previousCursor, delta), this.config);
          const appliedDelta = subtractPoints(this.cursor, previousCursor);
          this.activeGrab.totalDelta = addPoints(this.activeGrab.totalDelta, appliedDelta);
          action = {
            type: "drag_moved",
            targetId: this.activeGrab.targetId,
            cursor: copyPoint(this.cursor),
            delta: appliedDelta,
            totalDelta: copyPoint(this.activeGrab.totalDelta),
          };
        }
      }

      if (this.lastPinch.released) {
        action = {
          type: "grab_ended",
          targetId: this.activeGrab.targetId,
          cursor: copyPoint(this.cursor ?? this.coarseCursor),
          totalDelta: copyPoint(this.activeGrab.totalDelta),
        };
        this.focusedTargetId = this.activeGrab.targetId;
        this.activeGrab = null;
      }
    } else {
      this.cursor = smoothHoverCursor(
        this.cursor,
        this.coarseCursor,
        deltaTimeMs,
        this.config,
      );
      const match = acquireStickyTarget({
        point: this.cursor,
        targets: input.targets,
        currentTargetId: this.focusedTargetId,
        acquireRadiusPx: this.config.areaCursorRadiusPx,
        releaseRadiusPx: this.config.stickyReleaseRadiusPx,
      });
      this.focusedTargetId = match?.target.id ?? null;

      // Start a grab on the engage edge, or shortly after closing once the
      // cursor reaches a target (so a pinch that closed just off a target still
      // latches after a small move). The grace window is bounded so a hand kept
      // closed while resting/gesturing does not silently latch every object it
      // later sweeps over.
      const withinReacquireGrace =
        this.pinchClosedAt !== null && now - this.pinchClosedAt <= this.config.grabReacquireGraceMs;
      if (
        match &&
        (this.lastPinch.engaged || (this.lastPinch.phase === "closed" && withinReacquireGrace))
      ) {
        const anchor = targetCenter(match.target.bounds);
        this.activeGrab = {
          targetId: match.target.id,
          lastControlPoint: controlPoint,
          totalDelta: { x: 0, y: 0 },
        };
        action = {
          type: "grab_started",
          targetId: match.target.id,
          cursor: copyPoint(this.cursor),
          targetAnchor: anchor,
          grabOffset: subtractPoints(this.cursor, anchor),
        };
      }
    }

    return this.output(now, "tracked", action);
  }

  reset(options: { requirePinchRelease?: boolean } = {}): void {
    this.pinch.reset();
    this.cursor = null;
    this.coarseCursor = null;
    this.focusedTargetId = null;
    this.activeGrab = null;
    this.lastTrackedAt = null;
    this.lastUpdateAt = null;
    this.trackingWasMissing = false;
    this.lossHandled = false;
    this.requirePinchRelease = options.requirePinchRelease ?? false;
    this.pinchClosedAt = null;
    this.lastPinch = this.pinch.snapshot();
  }

  private handleTrackingLoss(timestampMs: number): HybridGestureControllerOutput {
    this.trackingWasMissing = true;
    const elapsed =
      this.lastTrackedAt === null ? Number.POSITIVE_INFINITY : timestampMs - this.lastTrackedAt;

    if (elapsed <= this.config.trackingLossTimeoutMs) {
      return this.output(timestampMs, "frozen", null);
    }

    let action: GestureManipulationAction | null = null;
    if (!this.lossHandled) {
      if (this.activeGrab) {
        action = {
          type: "grab_cancelled",
          targetId: this.activeGrab.targetId,
          cursor: copyPoint(this.cursor ?? this.coarseCursor ?? { x: 0, y: 0 }),
          totalDelta: copyPoint(this.activeGrab.totalDelta),
          reason: "tracking_lost",
        };
      }
      this.activeGrab = null;
      this.focusedTargetId = null;
      this.pinch.reset();
      this.lastPinch = this.pinch.snapshot();
      this.requirePinchRelease = true;
      this.lossHandled = true;
    }

    return this.output(timestampMs, "lost", action);
  }

  private relativeDragDelta(previous: Vector2D, current: Vector2D): Vector2D {
    const raw = {
      x: (current.x - previous.x) * this.config.canvasWidth * this.config.dragGain,
      y: (current.y - previous.y) * this.config.canvasHeight * this.config.dragGain,
    };
    const magnitude = Math.hypot(raw.x, raw.y);
    if (magnitude <= this.config.dragDeadZonePx) {
      return { x: 0, y: 0 };
    }
    if (magnitude <= this.config.maxDragStepPx) {
      return raw;
    }
    const scale = this.config.maxDragStepPx / magnitude;
    return { x: raw.x * scale, y: raw.y * scale };
  }

  private output(
    timestampMs: number,
    trackingState: GestureTrackingState,
    action: GestureManipulationAction | null,
  ): HybridGestureControllerOutput {
    return {
      timestampMs,
      state: resolveState(trackingState, this.lastPinch.phase, this.activeGrab !== null),
      trackingState,
      pinchState: this.lastPinch.phase,
      cursor: this.cursor ? copyPoint(this.cursor) : null,
      coarseCursor: this.coarseCursor ? copyPoint(this.coarseCursor) : null,
      focusedTargetId: this.activeGrab?.targetId ?? this.focusedTargetId,
      grabbedTargetId: this.activeGrab?.targetId ?? null,
      areaCursorRadiusPx: this.config.areaCursorRadiusPx,
      requiresPinchRelease: this.requirePinchRelease,
      action,
    };
  }
}

/** Maps a normalized camera point into normalized control-zone coordinates. */
export function normalizeControlPoint(
  point: Vector2D,
  zone: NormalizedControlZone,
  mirrorX: boolean,
): Vector2D {
  if (!(zone.width > 0) || !(zone.height > 0)) {
    throw new Error("control-zone width and height must be positive");
  }
  const x = mirrorX ? 1 - point.x : point.x;
  return {
    x: clamp((x - zone.x) / zone.width),
    y: clamp((point.y - zone.y) / zone.height),
  };
}

/** Maps a normalized camera point directly to a compact-zone canvas position. */
export function mapControlZonePointToCanvas(
  point: Vector2D,
  config: Pick<
    HybridGestureControllerConfig,
    "canvasWidth" | "canvasHeight" | "controlZone" | "mirrorX"
  >,
): Vector2D {
  return controlPointToCanvas(
    normalizeControlPoint(point, config.controlZone, config.mirrorX),
    config,
  );
}

function resolveConfig(options: HybridGestureControllerOptions): HybridGestureControllerConfig {
  const controlZone = { ...defaultControlZone, ...options.controlZone };
  const config: HybridGestureControllerConfig = {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    controlZone,
    mirrorX: options.mirrorX ?? true,
    minTrackingConfidence: options.minTrackingConfidence ?? 0.55,
    hoverSmoothingTimeMs: options.hoverSmoothingTimeMs ?? 45,
    hoverDeadZonePx: options.hoverDeadZonePx ?? 1.5,
    dragGain: options.dragGain ?? 0.35,
    dragDeadZonePx: options.dragDeadZonePx ?? 1,
    maxDragStepPx: options.maxDragStepPx ?? 64,
    areaCursorRadiusPx: options.areaCursorRadiusPx ?? 28,
    stickyReleaseRadiusPx: options.stickyReleaseRadiusPx ?? 46,
    trackingLossTimeoutMs: options.trackingLossTimeoutMs ?? 180,
    grabConfidenceFloor: options.grabConfidenceFloor ?? 0.55,
    grabReacquireGraceMs: options.grabReacquireGraceMs ?? 400,
    pinch: { ...defaultPinchHysteresisConfig, ...options.pinch },
  };
  validateControllerConfig(config);
  return config;
}

function validateControllerConfig(config: HybridGestureControllerConfig): void {
  const positiveValues = [
    config.canvasWidth,
    config.canvasHeight,
    config.controlZone.width,
    config.controlZone.height,
    config.maxDragStepPx,
  ];
  if (positiveValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("canvas, control-zone, and maximum drag dimensions must be positive");
  }
  const finiteValues = [
    config.controlZone.x,
    config.controlZone.y,
    config.dragGain,
    config.hoverSmoothingTimeMs,
    config.hoverDeadZonePx,
    config.dragDeadZonePx,
    config.areaCursorRadiusPx,
    config.stickyReleaseRadiusPx,
    config.trackingLossTimeoutMs,
    config.minTrackingConfidence,
    config.grabConfidenceFloor,
    config.grabReacquireGraceMs,
  ];
  if (
    finiteValues.some((value) => !Number.isFinite(value)) ||
    config.dragGain < 0 ||
    config.hoverSmoothingTimeMs < 0 ||
    config.hoverDeadZonePx < 0 ||
    config.dragDeadZonePx < 0 ||
    config.areaCursorRadiusPx < 0 ||
    config.stickyReleaseRadiusPx < config.areaCursorRadiusPx ||
    config.trackingLossTimeoutMs < 0 ||
    config.minTrackingConfidence < 0 ||
    config.minTrackingConfidence > 1 ||
    config.grabConfidenceFloor < 0 ||
    config.grabConfidenceFloor > 1 ||
    config.grabReacquireGraceMs < 0
  ) {
    throw new Error("gesture controller gains, radii, and durations are invalid");
  }
}

function controlPointToCanvas(
  point: Vector2D,
  config: Pick<HybridGestureControllerConfig, "canvasWidth" | "canvasHeight">,
): Vector2D {
  return {
    x: point.x * config.canvasWidth,
    y: point.y * config.canvasHeight,
  };
}

function smoothHoverCursor(
  previous: Vector2D | null,
  target: Vector2D,
  deltaTimeMs: number,
  config: HybridGestureControllerConfig,
): Vector2D {
  if (!previous || config.hoverSmoothingTimeMs === 0 || deltaTimeMs <= 0) {
    return copyPoint(target);
  }
  const distance = Math.hypot(target.x - previous.x, target.y - previous.y);
  if (distance <= config.hoverDeadZonePx) {
    return copyPoint(previous);
  }
  const alpha = 1 - Math.exp(-deltaTimeMs / config.hoverSmoothingTimeMs);
  return {
    x: previous.x + (target.x - previous.x) * alpha,
    y: previous.y + (target.y - previous.y) * alpha,
  };
}

function resolveState(
  tracking: GestureTrackingState,
  pinch: PinchPhase,
  dragging: boolean,
): HybridGestureControllerState {
  if (tracking === "frozen") return "tracking_frozen";
  if (tracking === "lost") return "tracking_lost";
  if (dragging && pinch === "opening") return "pinch_releasing";
  if (dragging) return "dragging";
  if (pinch === "closing") return "pinch_arming";
  if (pinch === "closed" || pinch === "opening") return "pinched";
  return "pointing";
}

function clampPointToCanvas(
  point: Vector2D,
  config: HybridGestureControllerConfig,
): Vector2D {
  return {
    x: clamp(point.x, 0, config.canvasWidth),
    y: clamp(point.y, 0, config.canvasHeight),
  };
}

function addPoints(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtractPoints(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function copyPoint(point: Vector2D): Vector2D {
  return { x: point.x, y: point.y };
}

function monotonicTimestamp(timestampMs: number, previous: number | null): number {
  const safe = Number.isFinite(timestampMs) ? timestampMs : (previous ?? 0);
  return Math.max(safe, previous ?? safe);
}
