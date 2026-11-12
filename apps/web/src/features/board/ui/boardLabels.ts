/**
 * Display labels and plain-word messages of the board component, moved
 * verbatim out of AirboardPrototype.tsx (board split, phase 1).
 */
import type { BoardSceneElement, BoardSceneIntent, BoardState } from "@airboard/core";
import type { ObjectDockTool } from "../gestureAnnotationMode.ts";
import { sceneNodeLabel } from "../semanticBoardObjects.ts";
import {
  OBJECT_DOCK,
  type ScreenUnderlayStatus,
  type SpeechRecognitionStatus,
} from "../engine/boardTypes.ts";

/** The live socket dropped after connecting and is trying again on its own. */
export function liveLinkDropped(status: string): boolean {
  return status === "reconnecting" || status === "closed" || status === "error";
}

/**
 * The name of a board target id for the scoped voice pill: a legacy stroke's
 * label, or a v2 scene element's text (or its kind when blank).
 */
export function boardTargetLabel(state: BoardState, targetId: string): string {
  const strokeLabel = state.strokes[targetId]?.annotation?.label?.trim();
  if (strokeLabel) return strokeLabel;
  const element = state.elements[targetId];
  return element?.status === "active" ? sceneNodeLabel(element) : "";
}

/** Limits people can act on get plain words; anything else keeps its code for support. */
export function mediaUploadFailure(code: string): string {
  if (code === "ASSET_QUOTA_EXCEEDED") return "This workspace has used its 2 GB for board images and videos. Delete boards you no longer need to free space.";
  if (code === "RATE_LIMITED") return "That's a lot of uploads at once. Wait a minute, then add the rest.";
  if (code === "BOARD_READ_ONLY_ROLE") return "Your role in this workspace can view boards but not add to them.";
  return code ? `Media upload failed: ${code}` : "Media upload failed.";
}

export function screenUnderlayStatusLabel(status: ScreenUnderlayStatus): string {
  switch (status) {
    case "idle":
      return "not selected";
    case "starting":
      return "choosing…";
    case "active":
      return "live";
    case "blocked":
      return "cancelled / blocked";
    case "error":
      return "unavailable";
  }
}

export function objectToolLabel(tool: ObjectDockTool): string {
  return OBJECT_DOCK.find((item) => item.tool === tool)?.label ?? "Object";
}

export function sceneElementKindLabel(kind: BoardSceneElement["kind"]): string {
  return {
    drawing: "Drawing",
    sticky: "Sticky note",
    shape: "Shape",
    connector: "Connector",
    text: "Text",
    section: "Section",
    table: "Table",
    stamp: "Stamp",
    media: "Media",
    link_preview: "Link preview",
    code_block: "Code block",
    mind_map_node: "Mind map",
  }[kind];
}

export function sceneIntentFeedback(intent: Exclude<BoardSceneIntent, { type: "invalid" }>): string {
  switch (intent.type) {
    case "create": return `Add ${intent.kind.replaceAll("_", " ")}`;
    case "create_connected": return "Add and connect shape";
    case "connect": return "Connect board elements";
    case "rename": return "Rename board element";
    case "delete": return "Delete board element";
    case "move": return "Move board element";
    case "resize": return "Resize selected object";
    case "style": return "Color selected object";
    case "select_all": return "Select every object";
    case "group": return "Create section around selection";
    case "layout": return "Lay out board elements";
    case "move_to": return "Move board element";
    case "change_shape": return "Change shape type";
    case "reorder": return intent.position === "front" ? "Bring to front" : "Send to back";
    case "undo": return intent.count > 1 ? `Undo ${intent.count} changes` : "Undo";
    case "redo": return intent.count > 1 ? `Redo ${intent.count} changes` : "Redo";
    case "correct": return "Correct the last change";
    case "zoom_to_fit": return "Zoom to fit";
    case "focus": return "Focus";
  }
}

export function speechRecognitionLabel(status: SpeechRecognitionStatus): string {
  switch (status) {
    case "wake-detected":
      return "wake word detected";
    case "wake-missing":
      return "wake word not detected";
    case "command-recognized":
      return "command recognized";
    case "interpreting":
      return "understanding command";
    case "command-rejected":
      return "command not understood";
    case "hearing":
      return "hearing speech";
    case "waiting":
      return "listening";
    case "error":
      return "speech error";
    case "idle":
      return "stopped";
  }
}

export function formatRecordingClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function truncateSpeechTranscript(transcript: string, maxLength = 64): string {
  const normalized = transcript.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
