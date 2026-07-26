/**
 * The one authoritative ownership order for a camera gesture frame.
 *
 * Stage updates are evaluated only until one stage wins. Each update owns its
 * recognizer advancement and any effects caused by that recognizer, then
 * reports whether it reserved the frame. Lower-priority stages receive an
 * explicit preemption callback so their state can be reset without observing
 * the winning frame. Manipulation is the final fallback.
 *
 * Keeping advancement and effects together matches the stateful trackers used
 * by the board: an Undo tracker can cross its threshold and apply Undo in the
 * same callback, while lower-priority trackers never observe that frame.
 */
export const GESTURE_FRAME_PRIORITY = [
  "navigation",
  "snap",
  "undo",
  "voice",
  "manipulation",
] as const;

export type GestureFrameOwner = (typeof GESTURE_FRAME_PRIORITY)[number];

type ClaimingGestureFrameOwner = Exclude<GestureFrameOwner, "manipulation">;

export type GestureFrameStage = Readonly<{
  update: () => boolean;
  onPreempted?: () => void;
}>;

export type GestureFrameManipulationStage = Readonly<{
  run: () => void;
  onPreempted?: () => void;
}>;

export type GestureFrameArbitrationInput = Readonly<
  Record<ClaimingGestureFrameOwner, GestureFrameStage> & {
    /** Normal hover, selection, placement, erase, or object movement fallback. */
    manipulation: GestureFrameManipulationStage;
  }
>;

const CLAIMING_PRIORITY: readonly ClaimingGestureFrameOwner[] =
  GESTURE_FRAME_PRIORITY.slice(0, -1) as ClaimingGestureFrameOwner[];

/**
 * Assign one and only one owner to the current gesture frame.
 *
 * The helper is stateless and deterministic for the supplied stages. A
 * higher-priority claim prevents every lower-priority claim and action from
 * running. If no global gesture claims the frame, manipulation always receives
 * it as the fallback.
 */
export function arbitrateGestureFrame(
  input: GestureFrameArbitrationInput,
): GestureFrameOwner {
  for (const [ownerIndex, owner] of CLAIMING_PRIORITY.entries()) {
    const stage = input[owner];
    if (!stage.update()) {
      continue;
    }
    for (const lowerOwner of GESTURE_FRAME_PRIORITY.slice(ownerIndex + 1)) {
      input[lowerOwner].onPreempted?.();
    }
    return owner;
  }

  input.manipulation.run();
  return "manipulation";
}
