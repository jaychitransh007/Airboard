import { parseBoardSceneIntent, type BoardSceneIntent, type SceneIntentTarget } from "@airboard/core";

/**
 * Scene-grammar edits whose target is a pronoun or the selection ("make it
 * red", "delete this", "make them bigger"): a following name or placement
 * cannot narrow what they act on, so the voice coalescer runs them at once
 * instead of holding them.
 */
const TARGETED_IMMEDIATE_TYPES: ReadonlySet<string> = new Set([
  "delete",
  "style",
  "resize",
  "focus",
]);

/** View and history commands with no target at all. */
const UNTARGETED_IMMEDIATE_TYPES: ReadonlySet<string> = new Set(["zoom_to_fit", "redo"]);

function cannotBeNarrowed(target: SceneIntentTarget): boolean {
  return target.kind === "selection" || target.kind === "contextual";
}

/**
 * True for a command that is complete as spoken and cannot take a spoken
 * continuation. A command whose target is named ("delete the box", "make the
 * database blue") keeps the hold: "… called Orders" or "… next to the API"
 * may follow after a pause and say which one is meant.
 */
export function isCompleteLocalEditCommand(command: string): boolean {
  const intent: BoardSceneIntent | null = parseBoardSceneIntent(command);
  if (intent === null) {
    return false;
  }
  if (UNTARGETED_IMMEDIATE_TYPES.has(intent.type)) {
    return true;
  }
  if (!TARGETED_IMMEDIATE_TYPES.has(intent.type) || !("target" in intent)) {
    return false;
  }
  return cannotBeNarrowed(intent.target as SceneIntentTarget);
}
