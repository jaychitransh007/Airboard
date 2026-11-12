/**
 * Internal types and constants of the board component, moved verbatim out of
 * AirboardPrototype.tsx (board split, phase 1). No behaviour lives here.
 */
import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  type AnnotationNodeType,
  type AnnotationPoint,
  type BoardSceneElement,
  type BoardState,
  type CursorState,
  type DiagramCommand,
  type StrokeAnnotation,
} from "@airboard/core";
import type { AnnotationRenderObject } from "@airboard/drawing-engine";
import type {
  DetectedHand,
  GestureResult,
  HybridGestureControllerOutput,
} from "@airboard/gesture-engine";
import type { CreationToolId } from "../creationToolCatalog.ts";
import type { GestureFrameOwner } from "../gestureFrameArbitration.ts";
import type {
  RawLandmarkFrameGeometry,
  RawLandmarkFrameSource,
} from "../gestureFrameCoordinator.ts";
import type { AnnotationResizeHandle, ObjectDockTool } from "../gestureAnnotationMode.ts";
import type { ParsedIntentCanvasCommand } from "../intentCanvasParser.ts";
import type { RealtimeSpeechSession } from "../realtimeSpeech.ts";
import type { SemanticIntentPendingClarification } from "../semanticIntent.ts";

export type CameraStatus = "idle" | "starting" | "tracker_loading" | "active" | "blocked" | "tracker_error" | "error";

export type ScreenUnderlayStatus = "idle" | "starting" | "active" | "blocked" | "error";

export type RawLandmarkFrameRequest = {
  hands: readonly DetectedHand[];
  timestampMs: number;
  inferenceMs?: number;
  source: RawLandmarkFrameSource;
  geometry: RawLandmarkFrameGeometry;
};

export type RawLandmarkFrameOutcome = {
  owner: GestureFrameOwner | null;
  pipelineGesture: GestureResult["gesture"] | null;
  hybridState: HybridGestureControllerOutput["state"] | null;
};

export type ObjectGestureState =
  | "hover"
  | "grab"
  | "placing"
  | "no target"
  | "erase";

export type SpeechRecognitionStatus =
  | "idle"
  | "waiting"
  | "hearing"
  | "wake-detected"
  | "wake-missing"
  | "interpreting"
  | "command-recognized"
  | "command-rejected"
  | "error";

export type CopilotActivityEntry = {
  id: number;
  source: "Voice" | "Airo" | "Board" | "You";
  title: string;
  detail: string;
  tone: "neutral" | "active" | "success" | "warning";
  /** Applied a board change; offer the one-tap undo toast. */
  undoable?: boolean;
};

export type PrepareIntentCommandResult = "previewed" | "applied" | "no-op" | "rejected";

export type IntentPreparationOutcome = {
  result: PrepareIntentCommandResult;
  preparedText: string;
  source: "deterministic" | "semantic";
  stepCount: number;
};

export type SceneIntentExecutionResult =
  | "applied"
  | "rejected"
  | "deferred"
  | "unrecognized";

export type VoiceCommandTraceContext = {
  voiceTurnId: string;
  transcript: string;
  wakePhrase: string;
  engine: "realtime";
  provider?: string | undefined;
  model?: string | undefined;
  confidence?: number | undefined;
  turnIndex?: number | undefined;
  /** Pointing captured when the command was routed, not when it runs. */
  reference?: VoiceReference | undefined;
};

export type SpeechEngine = "loading" | "realtime" | "unavailable";

export type ActiveSpeechSession = RealtimeSpeechSession;

export type SceneMoveSnapshot = {
  pointerId: number;
  inputSource: NonNullable<CursorState["inputSource"]>;
  elementId: string;
  start: AnnotationPoint;
  element: BoardSceneElement;
  relatedElements: BoardSceneElement[];
  boundConnectors: Extract<BoardSceneElement, { kind: "connector" }>[];
  /** Where the latest preview put the pointer. */
  lastPoint?: AnnotationPoint;
};

export type PendingIntent = {
  parsed: ParsedIntentCanvasCommand | null;
  parsedSteps: ParsedIntentCanvasCommand[];
  stepCount: number;
  confidenceBand: "high" | "medium" | "low";
  requestText: string;
  message: string;
  baseState: BoardState;
  baseSelectionIds: string[];
  requiresExplicitConfirmation: boolean;
  commands: DiagramCommand[];
  selectionAfter?: string[];
  ghosts?: AnnotationRenderObject[];
  voiceTurnId?: string;
};

export type SemanticExecutionSnapshot = {
  boardState: BoardState;
  /** What "current_selection" means in the plan: the request-time selection. */
  selectionIds: string[];
  /**
   * The selection the commit is checked against. It is the live selection when
   * a turn was rebased because the selection changed during planning, so the
   * rebased turn is not rejected as stale for that very change.
   */
  baseSelectionIds?: string[];
  /**
   * The selection when the person spoke, kept through a rebase: when it held
   * anything, "this" never falls back to guessing the newest shape.
   */
  requestSelectionIds?: string[];
  primarySelectionId: string | null;
  hoverStrokeId: string | null;
  pointer: { x: number; y: number } | null;
  /** Dimensions of the VISIBLE board window (screen size ÷ viewport scale). */
  canvasWidth: number;
  canvasHeight: number;
  /** Board coordinates of the visible window's top-left corner. */
  viewOrigin: { x: number; y: number };
};

export type PendingSemanticClarification = {
  request: SemanticIntentPendingClarification;
  boardState: BoardState;
  selectionIds: string[];
  askedAt: number;
};

/** How long Airo's question waits for an answer, whatever else happens on the board. */
export const CLARIFICATION_ANSWER_MS = 30_000;

export type ObjectInteraction =
  | {
      mode: "placing";
      tool: ObjectDockTool;
      creationTool?: CreationToolId;
      start: AnnotationPoint;
    }
  | {
      mode: "catalog_carrying";
      tool: ObjectDockTool;
      creationTool?: CreationToolId;
      point: AnnotationPoint;
      pickupScreenPoint: { x: number; y: number };
      catalogBounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
      enteredCanvas: boolean;
    }
  | {
      mode: "moving";
      strokeId: string;
      start: AnnotationPoint;
      initialAnnotation: StrokeAnnotation;
    }
  | {
      mode: "resizing";
      strokeId: string;
      handle: AnnotationResizeHandle;
      initialAnnotation: StrokeAnnotation;
    };

export const BOARD_SESSION_ID = "local-standalone-board";

export const PARTICIPANT_ID = "local-owner-participant";

export const OWNER_USER_ID = "local-owner";

export const AIRBOARD_API_URL =
  process.env.NEXT_PUBLIC_AIRBOARD_API_URL?.trim() || "http://127.0.0.1:4000";

export const ERASER_RADIUS = 42;

export const OBJECT_GESTURE_GRAB_THRESHOLD = 0.45;

export const OBJECT_GESTURE_RELEASE_THRESHOLD = 0.32;

export const SEMANTIC_NODE_DOCK_TOOLS: Record<AnnotationNodeType, ObjectDockTool> = {
  process: "flow",
  service: "service",
  database: "database",
  queue: "queue",
  user: "user",
  api: "api",
  decision: "decision",
  terminator: "terminator",
  io: "io",
  document: "document",
  note: "note",
  circle: "circle",
  custom: "box",
};

export const OBJECT_DOCK: readonly { label: string; tool: ObjectDockTool }[] = [
  { label: "Select", tool: "select" },
  ...[...AIRBOARD_SEMANTIC_NODE_CAPABILITIES]
    .sort((left, right) => left.palette.order - right.palette.order)
    .map(({ title, nodeType }) => ({
      label: title,
      tool: SEMANTIC_NODE_DOCK_TOOLS[nodeType],
    })),
  { label: "Arrow", tool: "arrow" },
  { label: "Connector", tool: "connector" },
  { label: "Highlight", tool: "highlight" },
  { label: "Eraser", tool: "eraser" },
];

/** How long the browser may take to answer for the camera before Airboard explains the wait. */
export const CAMERA_PROMPT_HINT_DELAY_MS = 1_500;

export const CAMERA_PROMPT_HINT =
  "Your browser is asking to use the camera. Choose Allow in its prompt near the address bar. No prompt? Another app or tab may be using the camera.";

/**
 * When a voice stream reaches the server's time limit and nobody has spoken
 * for this long, voice pauses instead of reconnecting: the tab is probably
 * forgotten, and streaming an empty room spends voice minutes.
 */
export const VOICE_QUIET_PAUSE_MS = 20 * 60_000;

export type SpeechPointing = { at: number; point: { x: number; y: number } | null; targetId: string | null };

/** What the hand pointed at for one voice command: at speech start, then now. */
export type VoiceReference = {
  point: { x: number; y: number } | null;
  /** The shape under the hand when speech began: what "it" and "this" mean. */
  startTargetId: string | null;
  /** Up to two shapes pointed at during the command, in order. */
  pointedIds: string[];
};

/** Words that mean "what I'm pointing at". */
export const DEICTIC_REFERENCE_PATTERN = /\b(?:this|that|it|these|those|them)\b/i;

/** The planner accepts up to this much dialogue for a clarification answer. */
export const MAX_CLARIFICATION_TRANSCRIPT_CHARS = 2_000;

/** Pointing older than this when speech starts is ignored. */
export const SPEECH_POINTING_MAX_AGE_MS = 4_000;

export type VoiceDecisionMetadata = {
  engine: VoiceCommandTraceContext["engine"];
  /**
   * What the hand pointed at for this decision, captured when it was routed.
   * The coalescer may hold the command and an earlier planner call may delay
   * it; by then the next sentence's pointing has replaced the shared refs.
   */
  reference?: VoiceReference | undefined;
  voiceTurnId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  confidence?: number | undefined;
  turnIndex?: number | undefined;
};

export const CATALOG_DROP_EXIT_PX = 12;

/** Synthetic pointer id for v2 scene moves driven by the camera hand. */
export const HAND_SCENE_POINTER_ID = -7;

/** How long a hand cue (why a carry ended, nothing to grab) stays by the hand. */
export const HAND_CUE_MS = 2_600;

export const CATALOG_DROP_MIN_TRAVEL_PX = 24;

export const UNDO_TOAST_VISIBLE_MS = 6_000;

/** Board changes one spoken request may make (a narrated flow of ~25 steps). */
export const MAX_PLAN_BOARD_CHANGES = 150;

export const AIRO_NOTICE_VISIBLE_MS = 6_000;

/** Matches the router's answer window: after it, a reply needs "Airo" again. */
export const AIRO_QUESTION_VISIBLE_MS = 12_000;

export type DockGestureOutcome =
  | {
      type: "hover";
      targetId: string;
    }
  | {
      type: "activated";
      targetId: string;
      creationTool?: CreationToolId;
      catalogBounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    };

// ---- Voice gates -----------------------------------------------------------
// A "gate" is an explicit, user-held addressing channel: while a gate is open
// (or within its short grace window after closing), finalized speech routes
// straight to the command pipeline without the "Airo" wake word. All gate
// timing/routing rules live in VoiceCommandRouter + PalmVoiceGestureTracker +
// HoldToEditTracker (unit-tested, React-free); the component only wires them.
export type VoiceGateUi =
  | { mode: "ptt" }
  | { mode: "scoped"; strokeId: string; label: string };

/** The most board words listed for screen readers beside the canvas. */
export const BOARD_TEXT_LIST_LIMIT = 200;

export const EXPORTS_BLOCKED_MESSAGE = "Your workspace admin turned off downloading and copying boards.";
