import type {
  DetectedHand,
  MediaPipeCannedGestureName,
} from "@airboard/gesture-engine";

export type CannedGestureSelection = {
  score: number;
  point: { x: number; y: number } | null;
  trackedHands: number;
};

/**
 * Selects one exact MediaPipe canned pose without geometric fallbacks.
 *
 * Gesture actions require exactly one fully tracked hand. This makes the
 * static labels mutually exclusive at the action boundary: Open_Palm can feed
 * Undo only, while Victory can feed voice only.
 */
export function selectSingleCannedGesture(
  hands: readonly DetectedHand[],
  gestureName: MediaPipeCannedGestureName,
): CannedGestureSelection {
  const tracked = hands.filter((hand) => hand.landmarks.length >= 21);
  if (tracked.length !== 1) {
    return { score: 0, point: null, trackedHands: tracked.length };
  }

  const hand = tracked[0]!;
  const wrist = hand.landmarks[0];
  if (
    !wrist ||
    hand.cannedGesture?.name !== gestureName
  ) {
    return { score: 0, point: null, trackedHands: 1 };
  }

  return {
    score: hand.cannedGesture.score,
    point: { x: wrist.x, y: wrist.y },
    trackedHands: 1,
  };
}
