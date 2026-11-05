import { clamp } from "./math.ts";
import type { HandLandmark } from "./types.ts";

// All geometry here is deliberately 2D image-plane geometry: the estimator
// reasons about *projection* (what the camera sees), so MediaPipe's relative
// z must not contribute to any distance.
function planarDistance(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type PalmPresentationLandmarks = readonly (
  | HandLandmark
  | null
  | undefined
)[];

export type PalmPresentationEstimate = {
  /**
   * Normalized 0..1 signal for a "presented palm": an open, flat hand facing
   * the camera at any in-plane rotation. 0 for fists, pinches, edge-on hands,
   * and foreshortened pointing poses.
   */
  score: number;
  /** Finger extension evidence (0 = curled fist, 1 = fully open hand). */
  opennessScore: number;
  /**
   * How parallel the palm plane is to the image plane. Deliberately ignores
   * whether the palm or the knuckles face the lens — either way the user is
   * presenting a flat hand to the camera, and MediaPipe handedness labels are
   * too mirroring-dependent to disambiguate reliably.
   */
  flatnessScore: number;
  /** Fingertips-above-wrist diagnostic; not required by the runtime pose. */
  uprightScore: number;
  /** Landmark coverage quality, independent of the pose itself. */
  confidence: number;
};

const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

const FINGERS: readonly [mcp: number, pip: number, tip: number][] = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];

const ZERO_ESTIMATE: PalmPresentationEstimate = {
  score: 0,
  opennessScore: 0,
  flatnessScore: 0,
  uprightScore: 0,
  confidence: 0,
};

/**
 * Estimates a deliberately presented open hand from the canonical landmark
 * stream. Runtime Undo routing and offline trace diagnostics use this same
 * definition so production behavior can be replayed without a classifier.
 *
 * The pose must be simultaneously open (fingers extended) and flat to the
 * camera (projected palm area near its physical maximum). In-plane rotation is
 * deliberately allowed: the leftward swipe supplies intent, so users should
 * not also have to keep their fingertips vertically above the wrist.
 */
export function estimatePalmPresentation(
  landmarks: PalmPresentationLandmarks,
): PalmPresentationEstimate {
  const wrist = validLandmark(landmarks[WRIST]);
  const indexMcp = validLandmark(landmarks[INDEX_MCP]);
  const middleMcp = validLandmark(landmarks[MIDDLE_MCP]);
  const pinkyMcp = validLandmark(landmarks[PINKY_MCP]);
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) {
    return ZERO_ESTIMATE;
  }

  // Foreshortening-resistant hand scale: knuckle span and wrist reach shrink
  // together only when the whole hand moves away from the camera.
  const knuckleSpan = planarDistance(indexMcp, pinkyMcp);
  const wristReach = planarDistance(wrist, middleMcp);
  const handScale = Math.max(knuckleSpan, wristReach);
  if (!(handScale > 1e-4)) {
    return ZERO_ESTIMATE;
  }

  // Projected palm-quadrilateral area via the 2D cross product. A palm plane
  // parallel to the image plane projects at full area; an edge-on or
  // camera-pointing hand collapses toward zero.
  const v1 = { x: indexMcp.x - wrist.x, y: indexMcp.y - wrist.y };
  const v2 = { x: pinkyMcp.x - wrist.x, y: pinkyMcp.y - wrist.y };
  const projectedArea = Math.abs(v1.x * v2.y - v1.y * v2.x);
  // A physically flat palm projects roughly 0.30–0.45 of handScale² for adult
  // hand proportions; the ramp reaches 1 at 0.34 to tolerate narrow palms.
  const flatnessScore = clamp(projectedArea / (handScale * handScale * 0.34));

  const fingerOpennessScores: number[] = [];
  let uprightSum = 0;
  let observedFingers = 0;
  for (const [mcpIndex, pipIndex, tipIndex] of FINGERS) {
    const mcp = validLandmark(landmarks[mcpIndex]);
    const pip = validLandmark(landmarks[pipIndex]);
    const tip = validLandmark(landmarks[tipIndex]);
    if (!mcp || !pip || !tip) {
      continue;
    }
    observedFingers += 1;

    // Extension: a straight finger's chord matches its joint path, and its
    // projected length stays comparable to the knuckle span. Reach is the key
    // foreshortening discriminator — a hand pointing at the camera keeps its
    // knuckle span but its projected finger length collapses, while a
    // presented palm keeps finger length ≈ palm width.
    const pathLength = planarDistance(mcp, pip) + planarDistance(pip, tip);
    const straightness =
      pathLength > 1e-6 ? clamp(planarDistance(mcp, tip) / pathLength) : 0;
    const reach = clamp((planarDistance(mcp, tip) / knuckleSpan - 0.45) / 0.4);
    fingerOpennessScores.push(clamp(straightness * 0.45 + reach * 0.55));

    // Upright: fingertip meaningfully above the wrist in image space
    // (image y grows downward).
    uprightSum += clamp((wrist.y - tip.y) / handScale / 0.85);
  }

  // Undo deliberately requires a complete four-finger observation. Missing
  // landmarks must fail closed rather than letting the remaining fingers
  // inflate an otherwise ambiguous pose score.
  if (observedFingers < FINGERS.length || !(knuckleSpan > 1e-4)) {
    return { ...ZERO_ESTIMATE, flatnessScore };
  }

  // The two weakest fingers are authoritative. Averaging all four would allow
  // a partial or pointing transition to masquerade as an open palm because two
  // strongly extended fingers could hide two folded fingers.
  const weakestFingerScores = [...fingerOpennessScores]
    .sort((left, right) => left - right)
    .slice(0, 2);
  const weakestIndividualScore = weakestFingerScores[0] ?? 0;
  const opennessScore = clamp(
    weakestFingerScores.reduce((sum, value) => sum + value, 0) /
      weakestFingerScores.length,
  );
  const uprightScore = clamp(uprightSum / observedFingers);
  const confidence = clamp(observedFingers / FINGERS.length);

  // Both required components must individually hold — a flat fist,
  // foreshortened pointing hand, or edge-on open hand is not the pose. Below
  // either floor the score collapses to zero so motion tracking never
  // accumulates weak evidence.
  if (
    weakestIndividualScore < 0.35 ||
    opennessScore < 0.5 ||
    flatnessScore < 0.35
  ) {
    return { score: 0, opennessScore, flatnessScore, uprightScore, confidence };
  }

  const score = clamp(
    opennessScore * 0.58 + flatnessScore * 0.32 + confidence * 0.1,
  );
  return { score, opennessScore, flatnessScore, uprightScore, confidence };
}

function validLandmark(
  landmark: HandLandmark | null | undefined,
): HandLandmark | null {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    (landmark.z !== undefined && !Number.isFinite(landmark.z))
  ) {
    return null;
  }
  return landmark;
}
