/**
 * The one authoritative ownership order for a camera gesture frame.
 *
 * Exclusive stage updates are evaluated only until one stage wins. Each update
 * owns its recognizer advancement and any effects caused by that recognizer,
 * then reports whether it reserved the frame. Lower-priority participants
 * receive an explicit preemption callback so their state can be reset without
 * observing the winning frame.
 *
 * Voice is deliberately a passive observer after the exclusive stages. Its
 * open-palm hold must be able to advance while that same open palm drives the
 * air cursor, so observing voice can never preempt manipulation. Manipulation
 * remains the final fallback and runs after every voice observation.
 *
 * Keeping advancement and effects together matches the stateful trackers used
 * by the board: a Snap tracker can cross its threshold and toggle visibility
 * in the same callback, while lower-priority trackers never observe that frame.
 */
export const GESTURE_FRAME_PRIORITY = [
  "navigation",
  "snap",
  "voice",
  "manipulation",
] as const;

export type GestureFrameParticipant = (typeof GESTURE_FRAME_PRIORITY)[number];
export type GestureFrameOwner = Exclude<GestureFrameParticipant, "voice">;

type ClaimingGestureFrameOwner = Exclude<GestureFrameOwner, "manipulation">;

export type GestureFrameStage = Readonly<{
  update: () => boolean;
  onPreempted?: () => void;
}>;

export type GestureFrameObserverStage = Readonly<{
  observe: () => void;
  onPreempted?: () => void;
}>;

export type GestureFrameManipulationStage = Readonly<{
  run: () => void;
  onPreempted?: () => void;
}>;

export type GestureFrameArbitrationInput = Readonly<
  Record<ClaimingGestureFrameOwner, GestureFrameStage> & {
    /**
     * Passive open-palm voice observation. It may open or close the voice gate,
     * but it never owns the pointer frame.
     */
    voice: GestureFrameObserverStage;
    /** Normal hover, selection, placement, erase, or object movement fallback. */
    manipulation: GestureFrameManipulationStage;
  }
>;

const CLAIMING_PRIORITY: readonly ClaimingGestureFrameOwner[] = [
  "navigation",
  "snap",
];

/**
 * Assign one and only one owner to the current gesture frame.
 *
 * The helper is stateless and deterministic for the supplied stages. A
 * higher-priority exclusive claim prevents every lower-priority observation or
 * action from running. If no exclusive gesture claims the frame, voice first
 * observes the palm and manipulation always receives the same frame.
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

  input.voice.observe();
  input.manipulation.run();
  return "manipulation";
}
