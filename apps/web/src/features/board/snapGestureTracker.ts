export type SnapLandmark = { x: number; y: number; z?: number };

export type SnapHand = {
  handedness: string;
  confidence: number;
  landmarks: readonly SnapLandmark[];
};

export type SnapGestureFrame = {
  hands: readonly SnapHand[];
  timestampMs: number;
  suppressed: boolean;
};

export type SnapGestureTrackerResult = "tracking" | "snap" | null;

export type SnapGestureTrackerConfig = {
  minConfidence: number;
  contactFrames: number;
  contactRatio: number;
  releaseRatio: number;
  maxReleaseMs: number;
  minTravelRatio: number;
  contactMotionTravelRatio: number;
  minVelocityRatioPerSecond: number;
  precisionPinchRatio: number;
  trackingGapMs: number;
  cooldownMs: number;
  neutralFrames: number;
};

export const defaultSnapGestureTrackerConfig: SnapGestureTrackerConfig = {
  minConfidence: 0.72,
  contactFrames: 2,
  contactRatio: 0.46,
  releaseRatio: 0.62,
  maxReleaseMs: 450,
  minTravelRatio: 0.12,
  contactMotionTravelRatio: 0.2,
  minVelocityRatioPerSecond: 0.45,
  precisionPinchRatio: 0.3,
  trackingGapMs: 180,
  cooldownMs: 900,
  neutralFrames: 2,
};

type Candidate = {
  contactFrames: number;
  armedAt: number | null;
  middleAtContact: SnapLandmark;
  lastSeenAt: number;
  peakTravelRatio: number;
};

/**
 * Pure on-device visual snap recognizer. It observes thumb-to-middle contact
 * and a fast release; no audio, landmarks, or media leave this instance.
 */
export class SnapGestureTracker {
  private readonly config: SnapGestureTrackerConfig;
  private candidate: Candidate | null = null;
  private cooldownUntil = 0;
  private neutralFrames = 0;
  private requiresNeutral = false;

  constructor(config: Partial<SnapGestureTrackerConfig> = {}) {
    this.config = { ...defaultSnapGestureTrackerConfig, ...config };
  }

  update(frame: SnapGestureFrame): SnapGestureTrackerResult {
    if (frame.suppressed) {
      this.candidate = null;
      this.neutralFrames = 0;
      return null;
    }

    const hand = this.pickHand(frame.hands);
    if (!hand) {
      return this.handleTrackingGap(frame);
    }

    const pose = snapPose(hand.landmarks);
    if (!pose) {
      return this.handleTrackingGap(frame);
    }

    if (this.requiresNeutral || frame.timestampMs < this.cooldownUntil) {
      const neutral = pose.thumbMiddleRatio >= this.config.releaseRatio;
      this.neutralFrames = neutral ? this.neutralFrames + 1 : 0;
      if (
        frame.timestampMs >= this.cooldownUntil &&
        this.neutralFrames >= this.config.neutralFrames
      ) {
        this.requiresNeutral = false;
        this.neutralFrames = 0;
      }
      return null;
    }

    const inContact = pose.thumbMiddleRatio <= this.config.contactRatio;
    const precisionPinch = pose.thumbIndexRatio <= this.config.precisionPinchRatio;
    if (!this.candidate) {
      if (pose.closedFist || precisionPinch) return null;
      if (!inContact) return null;
      this.candidate = {
        contactFrames: 1,
        armedAt: null,
        middleAtContact: pose.middleRelativeToPalm,
        lastSeenAt: frame.timestampMs,
        peakTravelRatio: 0,
      };
      return "tracking";
    }

    const candidate = this.candidate;
    candidate.lastSeenAt = frame.timestampMs;
    if (candidate.armedAt === null) {
      if (!inContact) {
        this.candidate = null;
        return null;
      }
      if (pose.closedFist || precisionPinch) {
        this.candidate = null;
        return null;
      }
      candidate.contactFrames += 1;
      candidate.middleAtContact = pose.middleRelativeToPalm;
      if (
        candidate.contactFrames >= this.config.contactFrames &&
        candidate.armedAt === null
      ) {
        candidate.armedAt = frame.timestampMs;
      }
      return "tracking";
    }

    const elapsedMs = frame.timestampMs - candidate.armedAt;
    const travel = distance(candidate.middleAtContact, pose.middleRelativeToPalm);
    candidate.peakTravelRatio = Math.max(candidate.peakTravelRatio, travel);
    const velocity =
      elapsedMs > 0 ? (candidate.peakTravelRatio * 1_000) / elapsedMs : 0;
    const released = pose.thumbMiddleRatio >= this.config.releaseRatio;
    // MediaPipe frequently keeps the occluded thumb and middle fingertips
    // virtually touching throughout a real snap. The middle fingertip still
    // travels sharply relative to the palm, which is the reliable visual
    // signal. Accept that motion without requiring a synthetic wide-gap frame.
    const releasedByContactMotion =
      candidate.peakTravelRatio >= this.config.contactMotionTravelRatio;
    if (elapsedMs > this.config.maxReleaseMs) {
      this.candidate = null;
      return null;
    }
    // A webcam usually observes one or more frames between fingertip contact
    // and full release. Keep the armed candidate alive through that hysteresis
    // band instead of treating the first non-contact frame as a failed snap.
    if (
      (!released || candidate.peakTravelRatio < this.config.minTravelRatio) &&
      !releasedByContactMotion
    ) {
      return "tracking";
    }
    if (
      velocity < this.config.minVelocityRatioPerSecond
    ) {
      return "tracking";
    }

    this.candidate = null;
    this.cooldownUntil = frame.timestampMs + this.config.cooldownMs;
    this.requiresNeutral = true;
    this.neutralFrames = 0;
    return "snap";
  }

  reset(): void {
    this.candidate = null;
    this.cooldownUntil = 0;
    this.neutralFrames = 0;
    this.requiresNeutral = false;
  }

  private handleTrackingGap(frame: SnapGestureFrame): SnapGestureTrackerResult {
    const candidate = this.candidate;
    if (
      frame.hands.length === 0 &&
      candidate?.armedAt !== null &&
      candidate?.armedAt !== undefined &&
      frame.timestampMs - candidate.lastSeenAt <= this.config.trackingGapMs &&
      frame.timestampMs - candidate.armedAt <= this.config.maxReleaseMs
    ) {
      // A fast snap often creates one or two motion-blurred frames. Preserve
      // the armed pose until the hand is reacquired instead of handing those
      // frames to move/resize or cancelling the snap.
      return "tracking";
    }
    this.candidate = null;
    this.neutralFrames = 0;
    return null;
  }

  private pickHand(hands: readonly SnapHand[]): SnapHand | null {
    const tracked = hands
      .filter(
        (hand) =>
          hand.confidence >= this.config.minConfidence &&
          snapLandmarkFrameConfidence(hand.landmarks) >= this.config.minConfidence,
      )
      .sort((left, right) => right.confidence - left.confidence);
    return tracked.length === 1 ? tracked[0]! : null;
  }
}

/**
 * MediaPipe exposes handedness certainty, not per-frame landmark certainty.
 * Snap recognition therefore gates on complete, finite and plausible hand
 * geometry instead of incorrectly treating handedness classification as
 * tracking quality.
 */
export function snapLandmarkFrameConfidence(
  landmarks: readonly SnapLandmark[],
): number {
  if (landmarks.length < 21) return 0;
  const required = landmarks.slice(0, 21);
  if (!required.every(validLandmark)) return 0;
  const wrist = required[0]!;
  const indexMcp = required[5]!;
  const middleMcp = required[9]!;
  const pinkyMcp = required[17]!;
  const scale = Math.max(
    distance(wrist, middleMcp),
    distance(indexMcp, pinkyMcp),
  );
  return scale >= 0.04 && scale <= 0.8 ? 1 : 0;
}

function snapPose(landmarks: readonly SnapLandmark[]) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const indexPip = landmarks[6];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const middlePip = landmarks[10];
  const middleTip = landmarks[12];
  const ringPip = landmarks[14];
  const ringTip = landmarks[16];
  const pinkyMcp = landmarks[17];
  const pinkyPip = landmarks[18];
  const pinkyTip = landmarks[20];
  if (
    !wrist ||
    !thumbTip ||
    !indexMcp ||
    !indexPip ||
    !indexTip ||
    !middleMcp ||
    !middlePip ||
    !middleTip ||
    !ringPip ||
    !ringTip ||
    !pinkyMcp ||
    !pinkyPip ||
    !pinkyTip ||
    ![
      wrist,
      thumbTip,
      indexMcp,
      indexPip,
      indexTip,
      middleMcp,
      middlePip,
      middleTip,
      ringPip,
      ringTip,
      pinkyMcp,
      pinkyPip,
      pinkyTip,
    ].every(validLandmark)
  ) {
    return null;
  }
  const scale = Math.max(
    distance(wrist, middleMcp),
    distance(indexMcp, pinkyMcp),
    0.04,
  );
  const thumbMiddleRatio = distance(thumbTip, middleTip) / scale;
  const thumbIndexRatio = distance(thumbTip, indexTip) / scale;
  const folded = [
    [indexTip, indexPip],
    [middleTip, middlePip],
    [ringTip, ringPip],
    [pinkyTip, pinkyPip],
  ].filter(([tip, pip]) => distance(wrist, tip!) <= distance(wrist, pip!) + scale * 0.06).length;
  const palmCenter = {
    x: (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4,
    y: (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4,
  };
  return {
    scale,
    middleRelativeToPalm: {
      x: (middleTip.x - palmCenter.x) / scale,
      y: (middleTip.y - palmCenter.y) / scale,
    },
    thumbMiddleRatio,
    thumbIndexRatio,
    // A real snap commonly curls the middle, ring and pinky fingers. Reject
    // only a fully closed hand with the thumb tucked into the palm.
    closedFist:
      folded === 4 && distance(thumbTip, palmCenter) <= scale * 0.72,
  };
}

function validLandmark(landmark: SnapLandmark): boolean {
  return (
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.z === undefined || Number.isFinite(landmark.z))
  );
}

function distance(left: SnapLandmark, right: SnapLandmark): number {
  // Relative landmark Z is model-estimated depth, not a metric coordinate.
  // It becomes especially noisy when fingertips overlap during a snap, so
  // recognition deliberately uses the camera-plane geometry the user sees.
  return Math.hypot(left.x - right.x, left.y - right.y);
}
