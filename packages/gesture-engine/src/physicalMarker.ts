import { average, clamp, distance } from "./math.ts";
import type {
  CursorPoint,
  DetectedHand,
  HandLandmark,
  MarkerGripFeatures,
  MarkerGripResult,
  MarkerTipEstimate,
  MarkerUserProfile,
  PhysicalMarkerDetection,
  PhysicalMarkerModeConfig,
  Vector2D,
} from "./types.ts";
import { defaultPhysicalMarkerModeConfig } from "./types.ts";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

type GripHistoryFrame = {
  timestampMs: number;
  thumbIndexDistance: number;
  thumbMiddleDistance: number;
  shaftAngle: number;
};

export class PhysicalMarkerTracker {
  private gripHistory: GripHistoryFrame[] = [];
  private previousTipPoint: CursorPoint | undefined;

  reset(): void {
    this.gripHistory = [];
    this.previousTipPoint = undefined;
  }

  detect(input: {
    hand: DetectedHand;
    timestampMs: number;
    config?: Partial<PhysicalMarkerModeConfig> | undefined;
    profile?: MarkerUserProfile | undefined;
  }): PhysicalMarkerDetection | null {
    const config = mergePhysicalMarkerConfig(input.config);
    const hand = input.hand;

    if (
      hand.landmarks.length < 21 ||
      hand.handednessScore < config.grip.minHandednessConfidence ||
      !isAllowedMarkerHand(hand, config)
    ) {
      return null;
    }

    const grip = this.detectGrip(hand, input.timestampMs, config);
    if (!grip) {
      return null;
    }

    const tip = this.estimateTip({
      grip,
      timestampMs: input.timestampMs,
      config,
      profile: input.profile,
    });
    const contactScore = computeInitialContactScore(grip, tip);
    const confidence = clamp(grip.confidence * 0.5 + tip.confidence * 0.35 + grip.stability * 0.15);
    const markerConfidenceFloor = Math.max(0.38, config.grip.minMarkerGripConfidence * 0.72);
    const tipConfidenceFloor = Math.max(0.38, config.tip.minMarkerTipConfidence * 0.68);
    const markerActive =
      grip.confidence >= markerConfidenceFloor && tip.confidence >= tipConfidenceFloor;

    return {
      grip,
      tip,
      contactScore,
      classifierOutput: {
        hand: hand.handedness,
        handednessConfidence: hand.handednessScore,
        gesture: markerActive ? "marker" : "unknown",
        confidence,
        cursorPoint: tip.smoothedPoint ?? tip.point,
        inputSource: "physical_marker",
        trackingSource: tip.source,
        gripConfidence: grip.confidence,
        tipConfidence: tip.confidence,
        contactScore,
        rawTipPoint: tip.rawPoint ?? tip.point,
        gripCenter: grip.gripCenter,
        shaftVector: grip.shaftVector,
      },
    };
  }

  private detectGrip(
    hand: DetectedHand,
    timestampMs: number,
    config: PhysicalMarkerModeConfig,
  ): MarkerGripResult | null {
    const landmarks = hand.landmarks;
    const wrist = landmarks[WRIST];
    const thumbTip = landmarks[THUMB_TIP];
    const indexMcp = landmarks[INDEX_MCP];
    const indexPip = landmarks[INDEX_PIP];
    const indexTip = landmarks[INDEX_TIP];
    const middleMcp = landmarks[MIDDLE_MCP];
    const middlePip = landmarks[MIDDLE_PIP];
    const middleTip = landmarks[MIDDLE_TIP];
    const ringMcp = landmarks[RING_MCP];
    const ringPip = landmarks[RING_PIP];
    const ringTip = landmarks[RING_TIP];
    const pinkyMcp = landmarks[PINKY_MCP];
    const pinkyPip = landmarks[PINKY_PIP];
    const pinkyTip = landmarks[PINKY_TIP];

    if (
      !wrist ||
      !thumbTip ||
      !indexMcp ||
      !indexPip ||
      !indexTip ||
      !middleMcp ||
      !middlePip ||
      !middleTip ||
      !ringMcp ||
      !ringPip ||
      !ringTip ||
      !pinkyMcp ||
      !pinkyPip ||
      !pinkyTip
    ) {
      return null;
    }

    const handScale = Math.max(
      distance(wrist, middleMcp),
      distance(indexMcp, pinkyMcp),
      distance(wrist, indexMcp),
      0.001,
    );
    const palmCenter = average([wrist, indexMcp, middleMcp, ringMcp, pinkyMcp]);
    const gripCenterLandmark = average([thumbTip, indexTip, middleTip]);
    const gripCenter: CursorPoint = {
      x: gripCenterLandmark.x,
      y: gripCenterLandmark.y,
      t: timestampMs,
    };
    const thumbIndexDistance = distance(thumbTip, indexTip) / handScale;
    const thumbMiddleDistance = distance(thumbTip, middleTip) / handScale;
    const thumbIndexProximityScore = clamp(1 - (thumbIndexDistance - 0.15) / 0.85);
    const thumbMiddleProximityScore = clamp(1 - (thumbMiddleDistance - 0.2) / 1.05);
    const proximityScore = Math.max(thumbIndexProximityScore, thumbMiddleProximityScore * 0.9);
    const indexCurl = fingerCurl(indexMcp, indexPip, indexTip);
    const middleCurl = fingerCurl(middleMcp, middlePip, middleTip);
    const ringCurl = fingerCurl(ringMcp, ringPip, ringTip);
    const pinkyCurl = fingerCurl(pinkyMcp, pinkyPip, pinkyTip);
    const fingerCurlScore = clamp(
      indexCurl * 0.12 + middleCurl * 0.4 + ringCurl * 0.26 + pinkyCurl * 0.22,
    );
    const shaftVector = estimateShaftVector({
      palmCenter,
      gripCenter,
      indexMcp,
      indexTip,
    });
    const shaftAngle = Math.atan2(shaftVector.y, shaftVector.x);
    const palmToGripDistance = distance(palmCenter, gripCenterLandmark) / handScale;
    const indexReach = distance(indexMcp, indexTip) / handScale;
    const shaftDirectionScore = clamp(
      clamp((palmToGripDistance - 0.18) / 0.75) * 0.62 +
        clamp((indexReach - 0.35) / 0.8) * 0.38,
    );
    const gripStability = this.computeGripStability({
      timestampMs,
      thumbIndexDistance,
      thumbMiddleDistance,
      shaftAngle,
      config,
    });
    const handednessScore = hand.handedness === "right" ? hand.handednessScore : hand.handednessScore * 0.45;
    const gripConfidence = clamp(
      proximityScore * 0.3 +
        fingerCurlScore * 0.2 +
        gripStability * 0.2 +
        shaftDirectionScore * 0.15 +
        handednessScore * 0.15,
    );
    const features: MarkerGripFeatures = {
      thumbIndexDistance,
      thumbMiddleDistance,
      indexCurl,
      middleCurl,
      ringCurl,
      pinkyCurl,
      palmOrientation: shaftAngle,
      handScale,
      gripStability,
      thumbIndexProximityScore: proximityScore,
      fingerCurlScore,
      shaftDirectionScore,
      handednessScore,
    };

    this.pushGripHistory({
      timestampMs,
      thumbIndexDistance,
      thumbMiddleDistance,
      shaftAngle,
      config,
    });

    return {
      detected: gripConfidence >= Math.max(0.35, config.grip.minMarkerGripConfidence * 0.58),
      confidence: gripConfidence,
      handedness: hand.handedness,
      handednessConfidence: hand.handednessScore,
      gripCenter,
      handScale,
      shaftVector,
      stability: gripStability,
      features,
    };
  }

  private estimateTip(input: {
    grip: MarkerGripResult;
    timestampMs: number;
    config: PhysicalMarkerModeConfig;
    profile?: MarkerUserProfile | undefined;
  }): MarkerTipEstimate {
    const calibration = input.profile?.tipCalibration;
    const offset =
      calibration && input.config.tip.calibrationEnabled
        ? scaleVector(
            calibration.gripToTipOffsetNorm,
            input.grip.handScale / Math.max(calibration.handScaleAtCalibration, 0.001),
          )
        : scaleVector(input.grip.shaftVector, input.grip.handScale * input.config.tip.markerLengthHandScaleMultiplier);
    const rawPoint: CursorPoint = {
      x: input.grip.gripCenter.x + offset.x,
      y: input.grip.gripCenter.y + offset.y,
      t: input.timestampMs,
    };
    const point: CursorPoint = {
      x: clamp(rawPoint.x),
      y: clamp(rawPoint.y),
      t: input.timestampMs,
    };
    const smoothedPoint = this.smoothTip(point, input.grip.handScale, input.config);
    const tipConfidence = clamp(
      input.grip.confidence * 0.35 +
        input.grip.features.shaftDirectionScore * 0.25 +
        input.grip.stability * 0.2 +
        input.grip.handednessConfidence * 0.2,
    );

    return {
      point: smoothedPoint,
      source: calibration && input.config.tip.calibrationEnabled ? "manual" : "hand_heuristic",
      confidence: tipConfidence,
      rawPoint,
      smoothedPoint,
    };
  }

  private smoothTip(
    point: CursorPoint,
    handScale: number,
    config: PhysicalMarkerModeConfig,
  ): CursorPoint {
    const previousPoint = this.previousTipPoint;
    if (!previousPoint) {
      this.previousTipPoint = point;
      return point;
    }

    const maxJump = Math.max(handScale * config.tip.maxTipJumpHandScaleMultiplier, 0.02);
    const delta = {
      x: point.x - previousPoint.x,
      y: point.y - previousPoint.y,
    };
    const jump = Math.hypot(delta.x, delta.y);
    const smoothedPoint =
      jump > maxJump
        ? {
            x: previousPoint.x + (delta.x / jump) * maxJump,
            y: previousPoint.y + (delta.y / jump) * maxJump,
            t: point.t,
          }
        : point;

    this.previousTipPoint = smoothedPoint;
    return smoothedPoint;
  }

  private computeGripStability(input: {
    timestampMs: number;
    thumbIndexDistance: number;
    thumbMiddleDistance: number;
    shaftAngle: number;
    config: PhysicalMarkerModeConfig;
  }): number {
    const recentFrames = this.gripHistory.filter(
      (frame) => input.timestampMs - frame.timestampMs <= input.config.grip.stabilityWindowMs,
    );
    if (recentFrames.length === 0) {
      return 0.74;
    }

    const averageJitter =
      recentFrames.reduce((sum, frame) => {
        const distanceJitter =
          Math.abs(input.thumbIndexDistance - frame.thumbIndexDistance) +
          Math.abs(input.thumbMiddleDistance - frame.thumbMiddleDistance);
        const angleJitter = angleDistance(input.shaftAngle, frame.shaftAngle) / Math.PI;
        return sum + distanceJitter * 0.35 + angleJitter * 0.3;
      }, 0) / recentFrames.length;

    return clamp(1 - averageJitter / input.config.grip.maxGripFeatureJitter);
  }

  private pushGripHistory(input: GripHistoryFrame & { config: PhysicalMarkerModeConfig }): void {
    this.gripHistory.push({
      timestampMs: input.timestampMs,
      thumbIndexDistance: input.thumbIndexDistance,
      thumbMiddleDistance: input.thumbMiddleDistance,
      shaftAngle: input.shaftAngle,
    });
    this.gripHistory = this.gripHistory.filter(
      (frame) => input.timestampMs - frame.timestampMs <= input.config.grip.stabilityWindowMs,
    );
  }
}

function mergePhysicalMarkerConfig(
  config: Partial<PhysicalMarkerModeConfig> | undefined,
): PhysicalMarkerModeConfig {
  if (!config) {
    return defaultPhysicalMarkerModeConfig;
  }

  return {
    camera: { ...defaultPhysicalMarkerModeConfig.camera, ...config.camera },
    grip: { ...defaultPhysicalMarkerModeConfig.grip, ...config.grip },
    tip: { ...defaultPhysicalMarkerModeConfig.tip, ...config.tip },
    contact: { ...defaultPhysicalMarkerModeConfig.contact, ...config.contact },
    motion: { ...defaultPhysicalMarkerModeConfig.motion, ...config.motion },
    friction: { ...defaultPhysicalMarkerModeConfig.friction, ...config.friction },
    coloredTip: { ...defaultPhysicalMarkerModeConfig.coloredTip, ...config.coloredTip },
    debug: { ...defaultPhysicalMarkerModeConfig.debug, ...config.debug },
    fallbackToHandGesture:
      config.fallbackToHandGesture ?? defaultPhysicalMarkerModeConfig.fallbackToHandGesture,
  };
}

function isAllowedMarkerHand(hand: DetectedHand, config: PhysicalMarkerModeConfig): boolean {
  return config.grip.markerHand === "either" || hand.handedness === config.grip.markerHand;
}

function estimateShaftVector(input: {
  palmCenter: HandLandmark;
  gripCenter: CursorPoint;
  indexMcp: HandLandmark;
  indexTip: HandLandmark;
}): Vector2D {
  const indexVector = normalize({
    x: input.indexTip.x - input.indexMcp.x,
    y: input.indexTip.y - input.indexMcp.y,
  });
  const palmVector = normalize({
    x: input.gripCenter.x - input.palmCenter.x,
    y: input.gripCenter.y - input.palmCenter.y,
  });
  const combined = normalize({
    x: indexVector.x * 0.68 + palmVector.x * 0.32,
    y: indexVector.y * 0.68 + palmVector.y * 0.32,
  });

  return magnitude(combined) > 0 ? combined : { x: 0, y: -1 };
}

function fingerCurl(mcp: HandLandmark, pip: HandLandmark, tip: HandLandmark): number {
  const first = {
    x: mcp.x - pip.x,
    y: mcp.y - pip.y,
  };
  const second = {
    x: tip.x - pip.x,
    y: tip.y - pip.y,
  };
  const firstMagnitude = Math.max(magnitude(first), 0.001);
  const secondMagnitude = Math.max(magnitude(second), 0.001);
  const cosine = clamp(
    (first.x * second.x + first.y * second.y) / (firstMagnitude * secondMagnitude),
    -1,
    1,
  );
  const angle = Math.acos(cosine);
  return clamp((Math.PI - angle) / (Math.PI * 0.58));
}

function computeInitialContactScore(grip: MarkerGripResult, tip: MarkerTipEstimate): number {
  return clamp(
    grip.confidence * 0.3 +
      tip.confidence * 0.25 +
      grip.stability * 0.2 +
      grip.features.shaftDirectionScore * 0.15 +
      0.1,
  );
}

function normalize(vector: Vector2D): Vector2D {
  const vectorMagnitude = magnitude(vector);
  if (vectorMagnitude === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: vector.x / vectorMagnitude,
    y: vector.y / vectorMagnitude,
  };
}

function scaleVector(vector: Vector2D, scale: number): Vector2D {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
  };
}

function magnitude(vector: Vector2D): number {
  return Math.hypot(vector.x, vector.y);
}

function angleDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % (Math.PI * 2);
  return difference > Math.PI ? Math.PI * 2 - difference : difference;
}
