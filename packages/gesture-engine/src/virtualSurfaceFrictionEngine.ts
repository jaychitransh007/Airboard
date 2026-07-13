import { clamp } from "./math.ts";
import { cleanupStrokePoints } from "./strokeCleanup.ts";
import type {
  CursorPoint,
  FrictionDiagnostics,
  FrictionEngineOutput,
  FrictionStrokePoint,
  GestureName,
  Handedness,
  MarkerCursorStyle,
  MarkerInputSource,
  MarkerState,
  MarkerTipSource,
  SpeedBucket,
  Vector2D,
  VirtualSurfaceFrictionConfig,
} from "./types.ts";
import { defaultVirtualSurfaceFrictionConfig } from "./types.ts";

type MarkerFrameInput = {
  detected: boolean;
  hand: Handedness;
  handednessConfidence: number;
  gesture: GestureName;
  gestureConfidence: number;
  cursorPoint: CursorPoint;
  inputSource?: MarkerInputSource;
  trackingSource?: MarkerTipSource;
  gripConfidence?: number;
  tipConfidence?: number;
  contactScore?: number;
  rawTipPoint?: CursorPoint;
  gripCenter?: CursorPoint;
  shaftVector?: Vector2D;
  fallbackToHandGesture?: boolean;
};

type FrictionUpdateInput = {
  timestampMs: number;
  marker?: MarkerFrameInput;
  leftDusterActive?: boolean;
  paused?: boolean;
};

type CommitPayload = Pick<
  FrictionEngineOutput,
  | "shouldCommitStroke"
  | "shouldDiscardStroke"
  | "cleanedStrokePoints"
  | "cleanupApplied"
  | "lineSnapApplied"
>;

export class VirtualSurfaceFrictionEngine {
  private config: VirtualSurfaceFrictionConfig;
  private markerState: MarkerState = "NO_HAND";
  private virtualMarkerTip: CursorPoint | undefined;
  private previousHandPoint: CursorPoint | undefined;
  private previousVelocity: Vector2D = { x: 0, y: 0 };
  private markerGestureStartedAt: number | undefined;
  private lowConfidenceStartedAt: number | undefined;
  private lastFrameTimestamp: number | undefined;
  private currentStrokePoints: FrictionStrokePoint[] = [];
  private lastDiagnostics = createEmptyDiagnostics();
  private lastGain = 0;
  private repositionCount = 0;

  constructor(config: Partial<VirtualSurfaceFrictionConfig> = {}) {
    this.config = { ...defaultVirtualSurfaceFrictionConfig, ...config };
  }

  setConfig(config: Partial<VirtualSurfaceFrictionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.markerState = "NO_HAND";
    this.virtualMarkerTip = undefined;
    this.previousHandPoint = undefined;
    this.previousVelocity = { x: 0, y: 0 };
    this.markerGestureStartedAt = undefined;
    this.lowConfidenceStartedAt = undefined;
    this.lastFrameTimestamp = undefined;
    this.currentStrokePoints = [];
    this.lastDiagnostics = createEmptyDiagnostics();
    this.lastGain = 0;
    this.repositionCount = 0;
  }

  update(input: FrictionUpdateInput): FrictionEngineOutput {
    const dtSec = this.computeDeltaSeconds(input.timestampMs);

    if (input.paused) {
      const commit = this.commitStrokeIfNeeded();
      this.markerState = "PAUSED";
      return this.output({
        cursorStyle: "paused",
        shouldDraw: false,
        commit,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec: 0,
          contactScore: 0,
          gestureConfidence: 0,
          markerGestureDurationMs: 0,
          frameTimeMs: dtSec * 1000,
        }),
      });
    }

    if (input.leftDusterActive) {
      const commit = this.commitStrokeIfNeeded();
      this.markerState = input.marker?.detected ? "MARKER_HOVER" : "NO_HAND";
      this.previousVelocity = { x: 0, y: 0 };
      const rawHandPoint = input.marker?.cursorPoint;
      return this.output({
        cursorStyle: this.markerState === "NO_HAND" ? "hidden" : "hover",
        shouldDraw: false,
        commit,
        ...(rawHandPoint ? { rawHandPoint } : {}),
        ...(this.virtualMarkerTip ? { virtualMarkerPoint: this.virtualMarkerTip } : {}),
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec: 0,
          contactScore: 0,
          gestureConfidence: input.marker?.gestureConfidence ?? 0,
          markerGestureDurationMs: this.getMarkerGestureDurationMs(input.timestampMs),
          frameTimeMs: dtSec * 1000,
          marker: input.marker,
        }),
      });
    }

    return this.updateMarker(input.marker, input.timestampMs, dtSec);
  }

  private updateMarker(
    marker: MarkerFrameInput | undefined,
    timestampMs: number,
    dtSec: number,
  ): FrictionEngineOutput {
    if (!marker?.detected) {
      const commit = this.commitStrokeIfNeeded();
      this.markerState = "NO_HAND";
      this.previousHandPoint = undefined;
      this.markerGestureStartedAt = undefined;
      this.lowConfidenceStartedAt = undefined;
      this.previousVelocity = { x: 0, y: 0 };
      return this.output({
        cursorStyle: "hidden",
        shouldDraw: false,
        commit,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec: 0,
          contactScore: 0,
          gestureConfidence: 0,
          markerGestureDurationMs: 0,
          frameTimeMs: dtSec * 1000,
        }),
      });
    }

    const targetPoint = marker.cursorPoint;
    const handSpeedPxPerSec = this.computeHandSpeed(targetPoint, dtSec);

    if (marker.handednessConfidence < this.config.minHandednessConfidence) {
      const commit = this.commitStrokeIfNeeded();
      this.markerState = "HAND_DETECTED";
      this.virtualMarkerTip = targetPoint;
      this.previousHandPoint = targetPoint;
      this.previousVelocity = { x: 0, y: 0 };
      return this.output({
        cursorStyle: "low_confidence",
        shouldDraw: false,
        commit,
        rawHandPoint: targetPoint,
        virtualMarkerPoint: targetPoint,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec,
          contactScore: 0,
          gestureConfidence: marker.gestureConfidence,
          markerGestureDurationMs: 0,
          frameTimeMs: dtSec * 1000,
          marker,
        }),
      });
    }

    const markerPoseActive = this.isMarkerPoseActive(marker, timestampMs);
    if (!markerPoseActive) {
      const commit = this.commitStrokeIfNeeded();
      const markerGripDetected =
        marker.inputSource === "physical_marker" && (marker.gripConfidence ?? 0) >= 0.35;
      const cursorStyle: MarkerCursorStyle =
        marker.gesture === "marker" ? "low_confidence" : "hand_detected";
      this.markerState = markerGripDetected ? "MARKER_GRIP_DETECTED" : "HAND_DETECTED";
      this.virtualMarkerTip = targetPoint;
      this.previousHandPoint = targetPoint;
      this.markerGestureStartedAt = undefined;
      this.previousVelocity = { x: 0, y: 0 };
      return this.output({
        cursorStyle,
        shouldDraw: false,
        commit,
        rawHandPoint: targetPoint,
        virtualMarkerPoint: targetPoint,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec,
          contactScore: 0,
          gestureConfidence: marker.gestureConfidence,
          markerGestureDurationMs: 0,
          frameTimeMs: dtSec * 1000,
          marker,
        }),
      });
    }

    this.markerGestureStartedAt ??= timestampMs;
    this.lowConfidenceStartedAt = undefined;
    this.virtualMarkerTip ??= targetPoint;

    const markerGestureDurationMs = this.getMarkerGestureDurationMs(timestampMs);
    const contactScore = this.computeContactScore({
      gestureConfidence: marker.gestureConfidence,
      handSpeedPxPerSec,
      markerGestureDurationMs,
      marker,
    });

    if (
      this.markerState === "NO_HAND" ||
      this.markerState === "HAND_DETECTED" ||
      this.markerState === "MARKER_GRIP_DETECTED" ||
      this.markerState === "STROKE_COMMITTED" ||
      this.markerState === "LOW_CONFIDENCE" ||
      this.markerState === "MARKER_LOST" ||
      this.markerState === "PAUSED"
    ) {
      this.markerState = "MARKER_HOVER";
      this.currentStrokePoints = [];
    }

    if (
      this.markerState === "WRITING" &&
      this.config.enableAutoLift &&
      handSpeedPxPerSec > this.config.repositionSpeedPxPerSec
    ) {
      const commit = this.commitStrokeIfNeeded();
      this.markerState = "REPOSITIONING";
      this.repositionCount += 1;
      this.virtualMarkerTip = targetPoint;
      this.previousHandPoint = targetPoint;
      this.previousVelocity = { x: 0, y: 0 };
      return this.output({
        cursorStyle: "repositioning",
        shouldDraw: false,
        commit,
        rawHandPoint: targetPoint,
        virtualMarkerPoint: targetPoint,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec,
          contactScore,
          gestureConfidence: marker.gestureConfidence,
          markerGestureDurationMs,
          frameTimeMs: dtSec * 1000,
          marker,
        }),
      });
    }

    if (
      this.markerState === "MARKER_HOVER" &&
      contactScore >= this.config.contactReadyThreshold &&
      markerGestureDurationMs >= this.config.activationDurationMs
    ) {
      this.markerState = "CONTACT_READY";
    }

    if (this.markerState === "REPOSITIONING") {
      this.virtualMarkerTip = targetPoint;
      this.previousVelocity = { x: 0, y: 0 };
      if (
        handSpeedPxPerSec < this.config.normalSpeedPxPerSec &&
        contactScore >= this.config.contactReadyThreshold &&
        markerGestureDurationMs >= this.config.activationDurationMs
      ) {
        this.markerState = "CONTACT_READY";
      }
      this.previousHandPoint = targetPoint;
      return this.output({
        cursorStyle: this.markerState === "CONTACT_READY" ? "contact_ready" : "repositioning",
        shouldDraw: false,
        rawHandPoint: targetPoint,
        virtualMarkerPoint: targetPoint,
        diagnostics: this.buildDiagnostics({
          handSpeedPxPerSec,
          contactScore,
          gestureConfidence: marker.gestureConfidence,
          markerGestureDurationMs,
          frameTimeMs: dtSec * 1000,
          marker,
        }),
      });
    }

    const nextTip =
      handSpeedPxPerSec > this.config.repositionSpeedPxPerSec && this.markerState !== "WRITING"
        ? targetPoint
        : this.limitVelocityAndAcceleration(
            this.applyVirtualFriction(targetPoint, handSpeedPxPerSec),
            dtSec,
          );

    this.virtualMarkerTip = nextTip;

    if (
      this.markerState === "CONTACT_READY" &&
      handSpeedPxPerSec >= this.config.minWritingSpeedPxPerSec &&
      handSpeedPxPerSec <= this.config.normalSpeedPxPerSec
    ) {
      this.markerState = "WRITING";
      this.currentStrokePoints = [];
    }

    const strokePoint =
      this.markerState === "WRITING"
        ? this.appendStrokePointIfNeeded({
            point: this.virtualMarkerTip,
            rawHandPoint: targetPoint,
            confidence: marker.gestureConfidence,
            handSpeedPxPerSec,
            contactScore,
            marker,
          })
        : undefined;

    this.previousHandPoint = targetPoint;

    return this.output({
      cursorStyle: getCursorStyleForMarkerState(this.markerState),
      shouldDraw: Boolean(strokePoint),
      ...(strokePoint ? { strokePoint } : {}),
      rawHandPoint: targetPoint,
      virtualMarkerPoint: nextTip,
      diagnostics: this.buildDiagnostics({
        handSpeedPxPerSec,
        contactScore,
        gestureConfidence: marker.gestureConfidence,
        markerGestureDurationMs,
        frameTimeMs: dtSec * 1000,
        marker,
      }),
    });
  }

  private isMarkerPoseActive(marker: MarkerFrameInput, timestampMs: number): boolean {
    const confidenceOk =
      marker.gesture === "marker" && marker.gestureConfidence >= this.config.minMarkerConfidence;
    if (confidenceOk) {
      return true;
    }

    if (this.markerState !== "WRITING" || marker.gesture !== "marker") {
      return false;
    }

    this.lowConfidenceStartedAt ??= timestampMs;
    return timestampMs - this.lowConfidenceStartedAt <= this.config.lowConfidenceGraceMs;
  }

  private computeDeltaSeconds(timestampMs: number): number {
    const previousTimestamp = this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestampMs;
    if (previousTimestamp === undefined) {
      return 1 / 30;
    }
    return clamp((timestampMs - previousTimestamp) / 1000, 1 / 120, 0.12);
  }

  private computeHandSpeed(targetPoint: CursorPoint, dtSec: number): number {
    if (!this.previousHandPoint) {
      return 0;
    }
    return distance(targetPoint, this.previousHandPoint) / dtSec;
  }

  private getMarkerGestureDurationMs(timestampMs: number): number {
    return this.markerGestureStartedAt === undefined ? 0 : timestampMs - this.markerGestureStartedAt;
  }

  private computeContactScore(input: {
    gestureConfidence: number;
    handSpeedPxPerSec: number;
    markerGestureDurationMs: number;
    marker?: MarkerFrameInput;
  }): number {
    const stabilityScore =
      input.handSpeedPxPerSec < this.config.stillSpeedPxPerSec
        ? 1
        : clamp(1 - input.handSpeedPxPerSec / this.config.normalSpeedPxPerSec);
    const speedControlScore = this.computeSpeedControlScore(input.handSpeedPxPerSec);
    const durationScore = clamp(input.markerGestureDurationMs / this.config.activationDurationMs);

    if (
      input.marker?.inputSource === "physical_marker" ||
      input.marker?.gripConfidence !== undefined ||
      input.marker?.tipConfidence !== undefined
    ) {
      const gripScore = clamp(input.marker.gripConfidence ?? input.gestureConfidence);
      const tipScore = clamp(input.marker.tipConfidence ?? input.gestureConfidence);
      return clamp(
        0.3 * gripScore +
          0.25 * tipScore +
          0.2 * stabilityScore +
          0.15 * speedControlScore +
          0.1 * durationScore,
      );
    }

    const gestureScore = clamp(input.gestureConfidence);
    return clamp(
      0.4 * gestureScore + 0.25 * stabilityScore + 0.2 * speedControlScore + 0.15 * durationScore,
    );
  }

  private computeSpeedControlScore(handSpeedPxPerSec: number): number {
    if (handSpeedPxPerSec < this.config.stillSpeedPxPerSec) {
      return 0.7;
    }
    if (handSpeedPxPerSec < this.config.slowSpeedPxPerSec) {
      return 1;
    }
    if (handSpeedPxPerSec < this.config.normalSpeedPxPerSec) {
      return 0.85;
    }
    if (handSpeedPxPerSec < this.config.repositionSpeedPxPerSec) {
      return 0.4;
    }
    return 0;
  }

  private applyVirtualFriction(targetPoint: CursorPoint, handSpeedPxPerSec: number): CursorPoint {
    const currentTip = this.virtualMarkerTip ?? targetPoint;
    const distanceToTarget = distance(targetPoint, currentTip);
    const effectiveStaticFrictionRadius =
      this.lastDiagnostics.gestureConfidence < 0.8
        ? this.config.staticFrictionRadiusPx * 1.5
        : this.config.staticFrictionRadiusPx;

    if (distanceToTarget < effectiveStaticFrictionRadius) {
      this.lastGain = 0;
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        staticFrictionActive: true,
      };
      return currentTip;
    }

    const gain = this.getAdaptiveGain(handSpeedPxPerSec);
    this.lastGain = gain;
    this.lastDiagnostics = {
      ...this.lastDiagnostics,
      staticFrictionActive: false,
    };
    return {
      x: currentTip.x + gain * (targetPoint.x - currentTip.x),
      y: currentTip.y + gain * (targetPoint.y - currentTip.y),
      t: targetPoint.t,
    };
  }

  private getAdaptiveGain(handSpeedPxPerSec: number): number {
    if (handSpeedPxPerSec < this.config.stillSpeedPxPerSec) {
      return 0;
    }
    if (handSpeedPxPerSec < this.config.slowSpeedPxPerSec) {
      return this.config.gainSlow;
    }
    if (handSpeedPxPerSec < this.config.normalSpeedPxPerSec) {
      return this.config.gainNormal;
    }
    return this.config.gainFast;
  }

  private limitVelocityAndAcceleration(nextTip: CursorPoint, dtSec: number): CursorPoint {
    const currentTip = this.virtualMarkerTip;
    if (!currentTip) {
      return nextTip;
    }

    const desiredVelocity = {
      x: (nextTip.x - currentTip.x) / dtSec,
      y: (nextTip.y - currentTip.y) / dtSec,
    };
    const velocity = clampMagnitude(desiredVelocity, this.config.maxWritingSpeedPxPerSec);
    const velocityLimited = magnitude(velocity) < magnitude(desiredVelocity) - 0.01;

    const desiredAcceleration = {
      x: (velocity.x - this.previousVelocity.x) / dtSec,
      y: (velocity.y - this.previousVelocity.y) / dtSec,
    };
    const acceleration = clampMagnitude(
      desiredAcceleration,
      this.config.maxAccelerationPxPerSec2,
    );
    const accelerationLimited = magnitude(acceleration) < magnitude(desiredAcceleration) - 0.01;
    const nextVelocity = {
      x: this.previousVelocity.x + acceleration.x * dtSec,
      y: this.previousVelocity.y + acceleration.y * dtSec,
    };

    this.previousVelocity = nextVelocity;
    this.lastDiagnostics = {
      ...this.lastDiagnostics,
      velocityLimited,
      accelerationLimited,
    };

    return {
      x: currentTip.x + nextVelocity.x * dtSec,
      y: currentTip.y + nextVelocity.y * dtSec,
      t: nextTip.t,
    };
  }

  private appendStrokePointIfNeeded(input: {
    point: CursorPoint;
    rawHandPoint: CursorPoint;
    confidence: number;
    handSpeedPxPerSec: number;
    contactScore: number;
    marker?: MarkerFrameInput;
  }): FrictionStrokePoint | undefined {
    const lastPoint = this.currentStrokePoints[this.currentStrokePoints.length - 1];
    if (lastPoint && distance(lastPoint, input.point) < this.config.minStrokePointDistancePx) {
      return undefined;
    }

    const point: FrictionStrokePoint = {
      x: input.point.x,
      y: input.point.y,
      t: input.point.t,
      rawX: input.rawHandPoint.x,
      rawY: input.rawHandPoint.y,
      confidence: input.confidence,
      handSpeedPxPerSec: input.handSpeedPxPerSec,
      gestureConfidence: input.confidence,
      contactScore: input.contactScore,
      frictionGain: this.lastGain,
    };
    setOptionalNumber(point, "rawTipX", input.marker?.rawTipPoint?.x ?? input.rawHandPoint.x);
    setOptionalNumber(point, "rawTipY", input.marker?.rawTipPoint?.y ?? input.rawHandPoint.y);
    setOptionalNumber(point, "gripConfidence", input.marker?.gripConfidence);
    setOptionalNumber(point, "tipConfidence", input.marker?.tipConfidence);
    if (input.marker?.inputSource) {
      point.inputSource = input.marker.inputSource;
    }
    if (input.marker?.trackingSource) {
      point.trackingSource = input.marker.trackingSource;
    }
    this.currentStrokePoints.push(point);
    return point;
  }

  private commitStrokeIfNeeded(): CommitPayload {
    if (this.currentStrokePoints.length === 0) {
      return { shouldCommitStroke: false };
    }

    const cleanup = cleanupStrokePoints(this.currentStrokePoints, this.config);
    this.currentStrokePoints = [];
    this.markerState = "STROKE_COMMITTED";
    this.previousVelocity = { x: 0, y: 0 };

    return {
      shouldCommitStroke: true,
      shouldDiscardStroke: cleanup.discard,
      cleanedStrokePoints: cleanup.points,
      cleanupApplied: cleanup.cleanupApplied,
      lineSnapApplied: cleanup.lineSnapApplied,
    };
  }

  private buildDiagnostics(input: {
    handSpeedPxPerSec: number;
    contactScore: number;
    gestureConfidence: number;
    markerGestureDurationMs: number;
    frameTimeMs: number;
    marker?: MarkerFrameInput | undefined;
  }): FrictionDiagnostics {
    const markerLagPx =
      this.virtualMarkerTip && this.previousHandPoint
        ? distance(this.virtualMarkerTip, this.previousHandPoint)
        : 0;
    const diagnostics: FrictionDiagnostics = {
      handSpeedPxPerSec: input.handSpeedPxPerSec,
      speedBucket: getSpeedBucket(input.handSpeedPxPerSec, this.config),
      markerLagPx,
      contactScore: input.contactScore,
      gestureConfidence: input.gestureConfidence,
      markerGestureDurationMs: input.markerGestureDurationMs,
      frictionGain: this.lastGain,
      staticFrictionActive: this.lastDiagnostics.staticFrictionActive,
      velocityLimited: this.lastDiagnostics.velocityLimited,
      accelerationLimited: this.lastDiagnostics.accelerationLimited,
      repositionCount: this.repositionCount,
      strokePointCount: this.currentStrokePoints.length,
      frameTimeMs: input.frameTimeMs,
    };
    if (input.marker?.inputSource) {
      diagnostics.inputSource = input.marker.inputSource;
      diagnostics.inputMode =
        input.marker.inputSource === "physical_marker" ? "physical_marker" : "hand_marker";
    }
    if (input.marker?.trackingSource) {
      diagnostics.trackingSource = input.marker.trackingSource;
    }
    if (input.marker?.gripConfidence !== undefined) {
      diagnostics.gripConfidence = input.marker.gripConfidence;
    }
    if (input.marker?.tipConfidence !== undefined) {
      diagnostics.tipConfidence = input.marker.tipConfidence;
    }
    if (input.marker?.rawTipPoint) {
      diagnostics.rawTipX = input.marker.rawTipPoint.x;
      diagnostics.rawTipY = input.marker.rawTipPoint.y;
    }
    if (input.marker?.gripCenter) {
      diagnostics.gripCenterX = input.marker.gripCenter.x;
      diagnostics.gripCenterY = input.marker.gripCenter.y;
    }
    if (input.marker?.shaftVector) {
      diagnostics.shaftVectorX = input.marker.shaftVector.x;
      diagnostics.shaftVectorY = input.marker.shaftVector.y;
    }
    if (input.marker?.fallbackToHandGesture !== undefined) {
      diagnostics.fallbackToHandGesture = input.marker.fallbackToHandGesture;
    }
    this.lastDiagnostics = diagnostics;
    return diagnostics;
  }

  private output(input: {
    cursorStyle: MarkerCursorStyle;
    shouldDraw: boolean;
    diagnostics: FrictionDiagnostics;
    commit?: CommitPayload;
    rawHandPoint?: CursorPoint;
    virtualMarkerPoint?: CursorPoint;
    strokePoint?: FrictionStrokePoint;
  }): FrictionEngineOutput {
    const output: FrictionEngineOutput = {
      markerState: this.markerState,
      cursorStyle: input.cursorStyle,
      shouldDraw: input.shouldDraw,
      shouldCommitStroke: input.commit?.shouldCommitStroke ?? false,
      diagnostics: input.diagnostics,
    };

    if (input.rawHandPoint) {
      output.rawHandPoint = input.rawHandPoint;
    }
    if (input.virtualMarkerPoint) {
      output.virtualMarkerPoint = input.virtualMarkerPoint;
    }
    if (input.strokePoint) {
      output.strokePoint = input.strokePoint;
    }
    if (input.commit?.shouldDiscardStroke !== undefined) {
      output.shouldDiscardStroke = input.commit.shouldDiscardStroke;
    }
    if (input.commit?.cleanedStrokePoints) {
      output.cleanedStrokePoints = input.commit.cleanedStrokePoints;
    }
    if (input.commit?.cleanupApplied !== undefined) {
      output.cleanupApplied = input.commit.cleanupApplied;
    }
    if (input.commit?.lineSnapApplied !== undefined) {
      output.lineSnapApplied = input.commit.lineSnapApplied;
    }

    return output;
  }
}

function getCursorStyleForMarkerState(markerState: MarkerState): MarkerCursorStyle {
  switch (markerState) {
    case "HAND_DETECTED":
    case "MARKER_GRIP_DETECTED":
      return "hand_detected";
    case "MARKER_HOVER":
      return "hover";
    case "CONTACT_READY":
      return "contact_ready";
    case "WRITING":
      return "writing";
    case "REPOSITIONING":
      return "repositioning";
    case "PAUSED":
      return "paused";
    case "NO_HAND":
      return "hidden";
    case "STROKE_COMMITTED":
      return "hover";
    case "LOW_CONFIDENCE":
      return "low_confidence";
    case "MARKER_LOST":
      return "low_confidence";
  }
}

function getSpeedBucket(
  handSpeedPxPerSec: number,
  config: VirtualSurfaceFrictionConfig,
): SpeedBucket {
  if (handSpeedPxPerSec < config.stillSpeedPxPerSec) {
    return "still";
  }
  if (handSpeedPxPerSec < config.slowSpeedPxPerSec) {
    return "slow";
  }
  if (handSpeedPxPerSec < config.normalSpeedPxPerSec) {
    return "normal";
  }
  if (handSpeedPxPerSec < config.repositionSpeedPxPerSec) {
    return "fast";
  }
  return "reposition";
}

function createEmptyDiagnostics(): FrictionDiagnostics {
  return {
    handSpeedPxPerSec: 0,
    speedBucket: "still",
    markerLagPx: 0,
    contactScore: 0,
    gestureConfidence: 0,
    markerGestureDurationMs: 0,
    frictionGain: 0,
    staticFrictionActive: false,
    velocityLimited: false,
    accelerationLimited: false,
    repositionCount: 0,
    strokePointCount: 0,
    frameTimeMs: 0,
  };
}

function setOptionalNumber<TKey extends keyof FrictionStrokePoint>(
  point: FrictionStrokePoint,
  key: TKey,
  value: number | undefined,
): void {
  if (value !== undefined) {
    point[key] = value as FrictionStrokePoint[TKey];
  }
}

function clampMagnitude(vector: Vector2D, maxMagnitude: number): Vector2D {
  const vectorMagnitude = magnitude(vector);
  if (vectorMagnitude <= maxMagnitude || vectorMagnitude === 0) {
    return vector;
  }
  const scale = maxMagnitude / vectorMagnitude;
  return {
    x: vector.x * scale,
    y: vector.y * scale,
  };
}

function magnitude(vector: Vector2D): number {
  return Math.hypot(vector.x, vector.y);
}

function distance(a: Pick<CursorPoint, "x" | "y">, b: Pick<CursorPoint, "x" | "y">): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
