export type Handedness = "left" | "right";

export type GestureName = "marker" | "duster" | "open_palm" | "unknown";

export type GestureMode =
  | "idle"
  | "hand_detected"
  | "marker_grip_detected"
  | "marker_ready"
  | "marker_hover"
  | "contact_ready"
  | "writing"
  | "repositioning"
  | "stroke_committed"
  | "paused"
  | "low_confidence"
  | "marker_lost"
  | "duster_ready"
  | "erasing";

export type HandLandmark = {
  x: number;
  y: number;
  z?: number;
};

export type MediaPipeCannedGestureName =
  | "None"
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou"
  | "Unknown";

export type MediaPipeCannedGesture = {
  name: MediaPipeCannedGestureName;
  score: number;
};

export type DetectedHand = {
  handedness: Handedness;
  handednessScore: number;
  landmarks: HandLandmark[];
  worldLandmarks?: HandLandmark[];
  /** MediaPipe's top canned static-gesture classification for this hand. */
  cannedGesture?: MediaPipeCannedGesture;
};

export type CursorPoint = {
  x: number;
  y: number;
  t: number;
};

export type Vector2D = {
  x: number;
  y: number;
};

export type MarkerInputMode = "hand_marker" | "physical_marker";

export type MarkerInputSource = "hand_gesture" | "physical_marker" | "pointer";

export type MarkerTipSource =
  | "finger_heuristic"
  | "hand_heuristic"
  | "colored_tip"
  | "fiducial"
  | "manual"
  | "fused";

export type GestureConfig = {
  markerGestureConfidenceThreshold: number;
  dusterGestureConfidenceThreshold: number;
  activationDurationMs: number;
  minTrackingConfidence: number;
  predictionWindowMs: number;
  deadZonePx: number;
  markerHand: Handedness | "either";
  dusterHand: Handedness;
};

export type GestureResult = {
  hand?: Handedness;
  gesture: GestureName;
  confidence: number;
  cursorPoint: CursorPoint;
  rawCursorPoint?: CursorPoint;
  mode: GestureMode;
  markerState?: MarkerState;
  cursorStyle?: MarkerCursorStyle;
  shouldDraw?: boolean;
  shouldCommitStroke?: boolean;
  shouldDiscardStroke?: boolean;
  strokePoint?: FrictionStrokePoint;
  cleanedStrokePoints?: FrictionStrokePoint[];
  cleanupApplied?: boolean;
  lineSnapApplied?: boolean;
  frictionPreset?: FrictionPreset;
  diagnostics?: FrictionDiagnostics;
};

export type GestureClassifierOutput = {
  hand: Handedness;
  handednessConfidence: number;
  gesture: GestureName;
  confidence: number;
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

export type CanvasMapping = {
  canvasWidth: number;
  canvasHeight: number;
  mirrorInput: boolean;
  sensitivity: number;
  /** Source video dimensions. When present, fitMode is applied before mapping. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Matches the CSS fit used by the visible camera layer. */
  fitMode?: "stretch" | "cover" | "contain";
};

export type SmoothedPoint = CursorPoint & {
  rawX: number;
  rawY: number;
  predicted: boolean;
};

export type MarkerState =
  | "NO_HAND"
  | "HAND_DETECTED"
  | "MARKER_GRIP_DETECTED"
  | "MARKER_HOVER"
  | "CONTACT_READY"
  | "WRITING"
  | "REPOSITIONING"
  | "STROKE_COMMITTED"
  | "LOW_CONFIDENCE"
  | "MARKER_LOST"
  | "PAUSED";

export type MarkerCursorStyle =
  | "hidden"
  | "hand_detected"
  | "hover"
  | "contact_ready"
  | "writing"
  | "repositioning"
  | "paused"
  | "low_confidence";

export type SpeedBucket = "still" | "slow" | "normal" | "fast" | "reposition";

export type FrictionPreset = "stable" | "balanced" | "responsive" | "custom";

export type FrictionStrokePoint = CursorPoint & {
  rawX?: number;
  rawY?: number;
  rawTipX?: number;
  rawTipY?: number;
  confidence?: number;
  handSpeedPxPerSec?: number;
  gestureConfidence?: number;
  gripConfidence?: number;
  tipConfidence?: number;
  contactScore?: number;
  frictionGain?: number;
  inputSource?: MarkerInputSource;
  trackingSource?: MarkerTipSource;
};

export type FrictionDiagnostics = {
  handSpeedPxPerSec: number;
  speedBucket: SpeedBucket;
  markerLagPx: number;
  contactScore: number;
  gestureConfidence: number;
  markerGestureDurationMs: number;
  frictionGain: number;
  staticFrictionActive: boolean;
  velocityLimited: boolean;
  accelerationLimited: boolean;
  repositionCount: number;
  strokePointCount: number;
  frameTimeMs: number;
  inputMode?: MarkerInputMode;
  inputSource?: MarkerInputSource;
  trackingSource?: MarkerTipSource;
  gripConfidence?: number;
  tipConfidence?: number;
  rawTipX?: number;
  rawTipY?: number;
  gripCenterX?: number;
  gripCenterY?: number;
  shaftVectorX?: number;
  shaftVectorY?: number;
  fallbackToHandGesture?: boolean;
};

export type MarkerGripFeatures = {
  thumbIndexDistance: number;
  thumbMiddleDistance: number;
  indexCurl: number;
  middleCurl: number;
  ringCurl: number;
  pinkyCurl: number;
  palmOrientation: number;
  handScale: number;
  gripStability: number;
  thumbIndexProximityScore: number;
  fingerCurlScore: number;
  shaftDirectionScore: number;
  handednessScore: number;
};

export type MarkerGripResult = {
  detected: boolean;
  confidence: number;
  handedness: Handedness;
  handednessConfidence: number;
  gripCenter: CursorPoint;
  handScale: number;
  shaftVector: Vector2D;
  stability: number;
  features: MarkerGripFeatures;
};

export type MarkerTipCalibration = {
  gripToTipOffsetNorm: Vector2D;
  gripToTipOffsetPx?: Vector2D;
  handScaleAtCalibration: number;
  markerLengthEstimatePx?: number;
  confidence: number;
  updatedAt: string;
};

export type MarkerTipEstimate = {
  point: CursorPoint;
  source: MarkerTipSource;
  confidence: number;
  rawPoint?: CursorPoint;
  smoothedPoint?: CursorPoint;
};

export type PhysicalMarkerModeConfig = {
  camera: {
    width: number;
    height: number;
    frameRate: number;
  };
  grip: {
    markerHand: Handedness | "either";
    minMarkerGripConfidence: number;
    minHandednessConfidence: number;
    stabilityWindowMs: number;
    maxGripFeatureJitter: number;
  };
  tip: {
    minMarkerTipConfidence: number;
    markerLengthHandScaleMultiplier: number;
    maxTipJumpHandScaleMultiplier: number;
    calibrationEnabled: boolean;
  };
  contact: {
    readyThreshold: number;
    writingThreshold: number;
    lostThreshold: number;
    activationDurationMs: number;
    lossGraceMs: number;
  };
  motion: {
    maxWritingSpeedPxPerSec: number;
    maxAccelerationPxPerSec2: number;
    repositionSpeedPxPerSec: number;
  };
  friction: Partial<VirtualSurfaceFrictionConfig>;
  coloredTip: {
    enabled: boolean;
    targetHue?: number;
    tolerance?: number;
  };
  debug: {
    enabled: boolean;
  };
  fallbackToHandGesture: boolean;
};

export type MarkerUserProfile = {
  id: string;
  userId?: string;
  inputTopLeft?: CursorPoint;
  inputBottomRight?: CursorPoint;
  boardWidth?: number;
  boardHeight?: number;
  mirrorLocalPreview: boolean;
  tipCalibration?: MarkerTipCalibration;
  createdAt: string;
  updatedAt: string;
};

export type PhysicalMarkerDetection = {
  classifierOutput: GestureClassifierOutput;
  grip: MarkerGripResult;
  tip: MarkerTipEstimate;
  contactScore: number;
};

export type VirtualSurfaceFrictionConfig = {
  minMarkerConfidence: number;
  minHandednessConfidence: number;
  activationDurationMs: number;
  lowConfidenceGraceMs: number;
  contactReadyThreshold: number;
  contactLostThreshold: number;
  staticFrictionRadiusPx: number;
  stillSpeedPxPerSec: number;
  minWritingSpeedPxPerSec: number;
  slowSpeedPxPerSec: number;
  normalSpeedPxPerSec: number;
  repositionSpeedPxPerSec: number;
  gainSlow: number;
  gainNormal: number;
  gainFast: number;
  maxWritingSpeedPxPerSec: number;
  maxAccelerationPxPerSec2: number;
  minStrokePointDistancePx: number;
  minStrokeDurationMs: number;
  minStrokePoints: number;
  enableAutoLift: boolean;
  enablePostStrokeSmoothing: boolean;
  enableLineSnap: boolean;
  enableShapeCleanup: boolean;
  lineSnapErrorThresholdPx: number;
  rdpTolerancePx: number;
  chaikinPasses: number;
  showRawHandCursorInDebug: boolean;
  showVirtualMarkerCursor: boolean;
  showContactAnimation: boolean;
};

export type FrictionEngineOutput = {
  markerState: MarkerState;
  virtualMarkerPoint?: CursorPoint;
  rawHandPoint?: CursorPoint;
  cursorStyle: MarkerCursorStyle;
  shouldDraw: boolean;
  shouldCommitStroke: boolean;
  shouldDiscardStroke?: boolean;
  strokePoint?: FrictionStrokePoint;
  cleanedStrokePoints?: FrictionStrokePoint[];
  cleanupApplied?: boolean;
  lineSnapApplied?: boolean;
  diagnostics: FrictionDiagnostics;
};

export const defaultGestureConfig: GestureConfig = {
  markerGestureConfidenceThreshold: 0.75,
  dusterGestureConfidenceThreshold: 0.75,
  activationDurationMs: 150,
  minTrackingConfidence: 0.6,
  predictionWindowMs: 20,
  deadZonePx: 1.5,
  markerHand: "right",
  dusterHand: "left",
};

export const defaultVirtualSurfaceFrictionConfig: VirtualSurfaceFrictionConfig = {
  minMarkerConfidence: 0.75,
  minHandednessConfidence: 0.65,
  activationDurationMs: 180,
  lowConfidenceGraceMs: 80,
  contactReadyThreshold: 0.72,
  contactLostThreshold: 0.55,
  staticFrictionRadiusPx: 4,
  stillSpeedPxPerSec: 40,
  minWritingSpeedPxPerSec: 20,
  slowSpeedPxPerSec: 150,
  normalSpeedPxPerSec: 600,
  repositionSpeedPxPerSec: 1200,
  gainSlow: 0.08,
  gainNormal: 0.16,
  gainFast: 0.28,
  maxWritingSpeedPxPerSec: 900,
  maxAccelerationPxPerSec2: 2500,
  minStrokePointDistancePx: 2,
  minStrokeDurationMs: 80,
  minStrokePoints: 3,
  enableAutoLift: true,
  enablePostStrokeSmoothing: true,
  enableLineSnap: true,
  enableShapeCleanup: false,
  lineSnapErrorThresholdPx: 8,
  rdpTolerancePx: 1.8,
  chaikinPasses: 1,
  showRawHandCursorInDebug: false,
  showVirtualMarkerCursor: true,
  showContactAnimation: true,
};

export const markerModeFrictionConfig: Partial<VirtualSurfaceFrictionConfig> = {
  staticFrictionRadiusPx: 5,
  gainSlow: 0.07,
  gainNormal: 0.14,
  gainFast: 0.24,
  maxWritingSpeedPxPerSec: 800,
  maxAccelerationPxPerSec2: 2200,
  repositionSpeedPxPerSec: 1100,
  activationDurationMs: 180,
  lowConfidenceGraceMs: 100,
  contactReadyThreshold: 0.72,
  contactLostThreshold: 0.55,
};

export const defaultPhysicalMarkerModeConfig: PhysicalMarkerModeConfig = {
  camera: {
    width: 1280,
    height: 720,
    frameRate: 30,
  },
  grip: {
    markerHand: "right",
    minMarkerGripConfidence: 0.72,
    minHandednessConfidence: 0.65,
    stabilityWindowMs: 240,
    maxGripFeatureJitter: 0.4,
  },
  tip: {
    minMarkerTipConfidence: 0.7,
    markerLengthHandScaleMultiplier: 0.68,
    maxTipJumpHandScaleMultiplier: 2.4,
    calibrationEnabled: true,
  },
  contact: {
    readyThreshold: 0.72,
    writingThreshold: 0.78,
    lostThreshold: 0.55,
    activationDurationMs: 180,
    lossGraceMs: 100,
  },
  motion: {
    maxWritingSpeedPxPerSec: 800,
    maxAccelerationPxPerSec2: 2200,
    repositionSpeedPxPerSec: 1100,
  },
  friction: markerModeFrictionConfig,
  coloredTip: {
    enabled: false,
  },
  debug: {
    enabled: false,
  },
  fallbackToHandGesture: true,
};

export const frictionPresets: Record<
  Exclude<FrictionPreset, "custom">,
  Partial<VirtualSurfaceFrictionConfig>
> = {
  stable: {
    staticFrictionRadiusPx: 6,
    gainSlow: 0.06,
    gainNormal: 0.12,
    gainFast: 0.22,
    maxWritingSpeedPxPerSec: 700,
    maxAccelerationPxPerSec2: 2000,
    lineSnapErrorThresholdPx: 9,
  },
  balanced: {
    staticFrictionRadiusPx: 4,
    gainSlow: 0.08,
    gainNormal: 0.16,
    gainFast: 0.28,
    maxWritingSpeedPxPerSec: 900,
    maxAccelerationPxPerSec2: 2500,
    lineSnapErrorThresholdPx: 8,
  },
  responsive: {
    staticFrictionRadiusPx: 3,
    gainSlow: 0.12,
    gainNormal: 0.24,
    gainFast: 0.38,
    maxWritingSpeedPxPerSec: 1200,
    maxAccelerationPxPerSec2: 4200,
    lineSnapErrorThresholdPx: 6,
  },
};
