"use client";

import Link from "next/link";
import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  applyDiagramCommand,
  applyDiagramUndo,
  applyBoardEvent,
  createEraseAction,
  createEventEnvelope,
  createInitialBoardState,
  createStroke,
  type AnnotationPoint,
  type AnnotationNodeType,
  type BoardEvent,
  type BoardState,
  type CursorState,
  type DiagramCommand,
  type MeetingProvider,
  type SemanticObjectReference,
  type SemanticPlacement,
  type SemanticPlan,
  type SemanticPlanAction,
  type Stroke,
  type StrokeAnnotation,
  type StrokeCommittedEvent,
  type StrokePoint,
} from "@airboard/core";
import {
  AIRBOARD_TRANSCRIPTION_KEYTERMS,
  classifyBrowserWakeTranscript,
  createBrowserWakeSpeechSession,
  supportsBrowserSpeech,
  type BrowserWakeSpeechSession,
} from "./browserSpeech";
import {
  boardContentChanged,
  buildSemanticIntentContext,
  describeSemanticPlan,
  resolveIntentOperation,
  resolveSemanticPlanAction,
} from "./intentPipeline";
import { parseDesiredGraphCorrection } from "./desiredGraphCorrection";
import {
  snapshotBoardEvents,
  startBoardSync,
  type BoardSyncHandle,
} from "./boardSync";
import {
  boardPointFromScreen,
  clampViewport,
  DEFAULT_VIEWPORT_LIMITS,
  IDENTITY_VIEWPORT,
  panViewport,
  screenPointFromBoard,
  zoomViewport,
  type BoardViewport,
  type ViewportLimits,
} from "./boardViewport";
import { CanvasNavigationTracker } from "./canvasNavigationTracker";
import { arbitrateGestureFrame } from "./gestureFrameArbitration";
import {
  catalogIdForDockGestureHover,
  chooseDockGestureTarget,
  DockGestureActivationTracker,
  type DockGesturePinchPhase,
} from "./dockGestureActivation";
import {
  recordingFileName,
  startLightboardRecording,
  type LightboardRecorderHandle,
} from "./lightboardRecorder";
import {
  describeScreenUnderlayError,
  requestScreenUnderlay,
  stopMediaStream,
} from "./screenUnderlay";
import {
  CAMERA_PRESENTATION_SCRIM,
  cameraCanvasScrim,
  MIN_CAMERA_PRESENTATION_SCRIM,
  SCREEN_PRESENTATION_SCRIM,
  screenFriendlyScrim,
} from "./lightboardComposition";
import {
  probeMeetCameraOverlayInWindow,
  probeMeetMediaBridgeInWindow,
  type MeetCameraOverlay,
  type MeetCameraOverlayState,
  type MeetMediaBridge,
  type MeetMediaBridgeVideoSession,
} from "../meet/meetMediaBridge";
import { CatalogGlyph } from "./catalogGlyphs";
import { boardDeletionSnapshot, validateBoardTitle } from "./boardLifecycle";
import { HoldToEditTracker } from "./holdToEditTracker";
import { selectLandmarkManipulationSignal } from "./landmarkManipulationInput";
import {
  collectLandmarkNavigationHands,
  shouldReserveLandmarkNavigation,
} from "./landmarkNavigationInput";
import { selectSingleLandmarkPose } from "./landmarkPoseSelection";
import {
  UndoGestureTracker,
  type UndoGestureFrame,
  type UndoGestureEvent,
} from "./undoGestureTracker";
import {
  SnapGestureTracker,
  snapLandmarkFrameConfidence,
  type SnapGestureFrame,
  type SnapGestureTrackerResult,
} from "./snapGestureTracker";
import {
  PalmVoiceGestureTracker,
  type PalmVoiceGestureEvent,
  type PalmVoiceGestureFrame,
} from "./palmVoiceGestureTracker";
import {
  VoiceCommandRouter,
  type VoiceGateMode,
  type VoiceRouteDecision,
} from "./voiceCommandRouter";
import {
  createRealtimeSpeechSession,
  fetchRealtimeTranscriptionConfig,
  supportsRealtimeSpeech,
  type RealtimeSpeechMetadata,
  type RealtimeSpeechSession,
  type RealtimeTranscriptionConfig,
} from "./realtimeSpeech";
import {
  fetchSemanticIntentConfig,
  resolveSemanticIntent,
  semanticIntentIssueMessage,
  shouldUseSemanticIntentFallback,
  type SemanticIntentConfig,
  type SemanticIntentContext,
  type SemanticIntentParserIssue,
} from "./semanticIntent";
import {
  exportCanvasPng,
  findAnnotationObjectAtPoint,
  findIntersectingStrokeIds,
  renderBoard,
  type AnnotationRenderObject,
} from "@airboard/drawing-engine";
import {
  defaultGestureConfig,
  defaultVirtualSurfaceFrictionConfig,
  estimatePalmPresentation,
  frictionPresets,
  GesturePipeline,
  HybridGestureController,
  MediaPipeHandTracker,
  type CanvasMapping,
  type DetectedHand,
  type FrictionPreset,
  type FrictionStrokePoint,
  type GestureConfig,
  type GestureResult,
  type HybridGestureControllerOutput,
  type MarkerInputMode,
  type VirtualSurfaceFrictionConfig,
} from "@airboard/gesture-engine";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  finalizeTouchpadStroke,
  getTouchpadModeConfig,
  normalizePointerEvent,
  shouldAddTouchpadPoint,
  smoothLiveTouchpadPoint,
  type AirboardInputMode,
  type TouchpadInputState,
  type TouchpadModeVariant,
  type TouchpadTool,
} from "./touchpadMode";
import {
  annotationNeedsLabel,
  buildAnnotationPoints,
  createObjectFromPlacement,
  getBoundConnectorUpdates,
  getAnnotationLabelAnchor,
  isPlacementTool,
  resizeBoundsAnnotation,
  snapAnnotationToBoard,
  translateAnnotation,
  updateLineEndpoint,
  type AlignmentGuide,
  type AnnotationResizeHandle,
  type GestureAnnotationResult,
  type ObjectDockTool,
} from "./gestureAnnotationMode";
import { buildGestureMoveTargets, resolveResizeHandleForInput } from "./gestureObjectManipulation";
import {
  parseIntentCanvasCommand,
  type IntentCanvasOperation,
  type ParsedIntentCanvasCommand,
} from "./intentCanvasParser";
import { createVoiceTraceReporter } from "./voiceTrace";
import {
  DEFAULT_DESKTOP_OVERLAY_STATE,
  type DesktopOverlayState,
} from "./desktopOverlay";
import {
  mediaPermissionLabel,
  mediaResumeEnabled,
  queryMediaPermission,
  setMediaResumeEnabled,
  shouldResumeMedia,
  type MediaPermissionState,
} from "./mediaPermissionPreference";

type Surface = "standalone" | "meet-side-panel" | "meet-main-stage";

type CameraStatus = "idle" | "starting" | "tracker_loading" | "active" | "blocked" | "tracker_error" | "error";
type ScreenUnderlayStatus = "idle" | "starting" | "active" | "blocked" | "error";

type Stats = {
  strokes: number;
  deleted: number;
  active: number;
  handsDetected: number;
};

type HandControlDiagnostics = {
  trackingConfidence: number;
  grabStrength: number;
  grabConfidence: number;
  focusedTargetId: string | null;
  grabbedTargetId: string | null;
  placementActive: boolean;
  controllerState: HybridGestureControllerOutput["state"];
  requiresPinchRelease: boolean;
};

type ObjectGestureState =
  | "hover"
  | "grab"
  | "placing"
  | "no target"
  | "erase";

type SpeechRecognitionStatus =
  | "idle"
  | "waiting"
  | "hearing"
  | "wake-detected"
  | "wake-missing"
  | "interpreting"
  | "command-recognized"
  | "command-rejected"
  | "error";

type CopilotActivityEntry = {
  id: number;
  source: "Voice" | "Airo" | "Board" | "You";
  title: string;
  detail: string;
  tone: "neutral" | "active" | "success" | "warning";
};

type PrepareIntentCommandResult = "previewed" | "applied" | "rejected";

type IntentPreparationOutcome = {
  result: PrepareIntentCommandResult;
  preparedText: string;
  source: "deterministic" | "semantic";
  stepCount: number;
};

type VoiceCommandTraceContext = {
  voiceTurnId: string;
  transcript: string;
  wakePhrase: string;
  engine: "realtime" | "browser-fallback";
  provider?: string | undefined;
  model?: string | undefined;
  confidence?: number | undefined;
  turnIndex?: number | undefined;
};

type SpeechEngine = "loading" | "realtime" | "browser-fallback" | "unavailable";

type ActiveSpeechSession = BrowserWakeSpeechSession | RealtimeSpeechSession;

type CommitStrokeOptions = {
  points?: StrokePoint[];
  discard?: boolean;
  cleanupApplied?: boolean;
  lineSnapApplied?: boolean;
  frictionProfile?: FrictionPreset;
};

type UndoAction =
  | {
      type: "stroke";
      strokeId: string;
    }
  | {
      type: "erase";
      strokeIds: string[];
    }
  | {
      type: "diagram";
      undoEvents: BoardEvent[];
      selectionBefore: string[];
    };

type PendingIntent = {
  parsed: ParsedIntentCanvasCommand | null;
  parsedSteps: ParsedIntentCanvasCommand[];
  stepCount: number;
  confidenceBand: "high" | "medium" | "low";
  requestText: string;
  message: string;
  baseState: BoardState;
  requiresExplicitConfirmation: boolean;
  commands: DiagramCommand[];
  selectionAfter?: string[];
  ghosts?: AnnotationRenderObject[];
  voiceTurnId?: string;
};

type SemanticExecutionSnapshot = {
  boardState: BoardState;
  selectionIds: string[];
  primarySelectionId: string | null;
  hoverStrokeId: string | null;
  pointer: { x: number; y: number } | null;
  /** Dimensions of the VISIBLE board window (screen size ÷ viewport scale). */
  canvasWidth: number;
  canvasHeight: number;
  /** Board coordinates of the visible window's top-left corner. */
  viewOrigin: { x: number; y: number };
};


type ObjectInteraction =
  | {
      mode: "placing";
      tool: ObjectDockTool;
      start: AnnotationPoint;
    }
  | {
      mode: "catalog_carrying";
      tool: ObjectDockTool;
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

const BOARD_SESSION_ID = "local-standalone-board";
const PARTICIPANT_ID = "local-owner-participant";
const OWNER_USER_ID = "local-owner";
const AIRBOARD_API_URL =
  process.env.NEXT_PUBLIC_AIRBOARD_API_URL?.trim() || "http://127.0.0.1:4000";
const BROWSER_SPEECH_FALLBACK_ENABLED =
  process.env.NEXT_PUBLIC_AIRBOARD_SPEECH_FALLBACK === "browser";
const ERASER_RADIUS = 42;
const OBJECT_GESTURE_GRAB_THRESHOLD = 0.45;
const OBJECT_GESTURE_RELEASE_THRESHOLD = 0.32;
const SEMANTIC_NODE_DOCK_TOOLS: Record<AnnotationNodeType, ObjectDockTool> = {
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
const OBJECT_DOCK: readonly { label: string; tool: ObjectDockTool }[] = [
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

// The dock groups placement tools into three catalogs instead of a flat button
// stack. Select and Eraser stay top-level: they are modes, not shapes.
const OBJECT_CATALOG: readonly {
  id: string;
  label: string;
  iconTool: ObjectDockTool;
  tools: readonly { label: string; tool: ObjectDockTool }[];
}[] = [
  {
    id: "flow",
    label: "Flow",
    iconTool: "connector",
    tools: catalogTools([
      "flow",
      "decision",
      "terminator",
      "io",
      "document",
      "arrow",
      "connector",
    ]),
  },
  {
    id: "system",
    label: "System",
    iconTool: "service",
    tools: catalogTools(["user", "service", "api", "database", "queue"]),
  },
  {
    id: "annotate",
    label: "Annotate",
    iconTool: "note",
    tools: catalogTools(["note", "circle", "box", "highlight"]),
  },
];

function catalogTools(tools: readonly ObjectDockTool[]): { label: string; tool: ObjectDockTool }[] {
  return tools.flatMap((tool) => {
    const entry = OBJECT_DOCK.find((item) => item.tool === tool);
    return entry ? [entry] : [];
  });
}

const CATALOG_DRAG_MIME = "application/x-airboard-tool";
const CATALOG_DROP_EXIT_PX = 12;
const CATALOG_DROP_MIN_TRAVEL_PX = 24;

type DockGestureOutcome =
  | {
      type: "hover";
      targetId: string;
    }
  | {
      type: "activated";
      targetId: string;
      catalogBounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    };

function placementToolFromDockTarget(targetId: string): ObjectDockTool | null {
  if (!targetId.startsWith("tool:")) {
    return null;
  }
  const tool = targetId.slice("tool:".length) as ObjectDockTool;
  return OBJECT_DOCK.some((entry) => entry.tool === tool) && isPlacementTool(tool)
    ? tool
    : null;
}

// ---- Voice gates -----------------------------------------------------------
// A "gate" is an explicit, user-held addressing channel: while a gate is open
// (or within its short grace window after closing), finalized speech routes
// straight to the command pipeline without the "Airo" wake word. All gate
// timing/routing rules live in VoiceCommandRouter + PalmVoiceGestureTracker +
// HoldToEditTracker (unit-tested, React-free); the component only wires them.
type VoiceGateUi =
  | { mode: "ptt" }
  | { mode: "scoped"; strokeId: string; label: string };

/**
 * Realtime STT keyterms for one session: the wake-word head keeps its top
 * priority, the live board labels bias recognition toward the names actually
 * on screen, and the static command vocabulary fills the remainder. The
 * transport layer caps the merged list at the provider limit, keeping earlier
 * entries, which is why the order here matters.
 */
const KEYTERM_WAKE_HEAD_COUNT = 8;
function buildSessionKeyterms(state: BoardState): string[] {
  return [
    ...AIRBOARD_TRANSCRIPTION_KEYTERMS.slice(0, KEYTERM_WAKE_HEAD_COUNT),
    ...collectBoardVoiceKeyterms(state),
    ...AIRBOARD_TRANSCRIPTION_KEYTERMS.slice(KEYTERM_WAKE_HEAD_COUNT),
  ];
}

function collectBoardVoiceKeyterms(state: BoardState): string[] {
  const labels = new Set<string>();
  for (const stroke of Object.values(state.strokes)) {
    if (stroke.status !== "committed") {
      continue;
    }
    const label = stroke.annotation?.label?.trim();
    if (label && label.length <= 40) {
      labels.add(label);
      if (labels.size >= 40) {
        break;
      }
    }
  }
  return [...labels];
}

function parseDiagramVisibilityIntent(text: string): "hide" | "show" | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:please )?hide (?:the )?(?:canvas|diagram)$/.test(normalized) ||
    /^(?:please )?turn (?:the )?(?:canvas|diagram) off$/.test(normalized)
  ) {
    return "hide";
  }
  if (
    /^(?:please )?(?:show|restore) (?:the )?(?:canvas|diagram)$/.test(normalized) ||
    /^(?:please )?bring (?:the )?(?:canvas|diagram) back$/.test(normalized) ||
    /^(?:please )?turn (?:the )?(?:canvas|diagram) on$/.test(normalized)
  ) {
    return "show";
  }
  return null;
}

export function AirboardPrototype({
  surface,
  meetingProvider = "standalone",
  providerMeetingId,
  initialBoardSessionId,
  onBoardSessionReady,
  embeddedMediaCapture = false,
  desktopOverlay = false,
  headlessMeetOverlay = false,
  accessToken,
  accountUserId,
  persistentBoardId,
  persistentWorkspaceId,
  initialBoardState,
  onPersistentBoardChange,
  onRenameBoard,
  onDeleteBoard,
  boardTitle = "Untitled Airboard",
  persistentSaveStatus = "saved",
  initialPreferences,
}: {
  surface: Surface;
  meetingProvider?: MeetingProvider;
  providerMeetingId?: string;
  initialBoardSessionId?: string | null;
  onBoardSessionReady?: (session: {
    boardSessionId: string;
    participantId: string;
    role: string;
  }) => void;
  /**
   * Meeting surfaces only: true when the host client delegates camera and
   * microphone permission to this frame, so explicit gesture/voice capture
   * can run embedded. False routes gesture/voice to the companion window.
   */
  embeddedMediaCapture?: boolean;
  /**
   * Standalone native shell only: render the board as a full-screen transparent
   * desktop layer. The Electron host owns topmost placement and OS click-through.
   */
  desktopOverlay?: boolean;
  /**
   * Extension-owned Meet renderer. It keeps a stable 16:9 canvas offscreen,
   * starts the camera overlay plus gesture/voice inputs automatically, and
   * never renders presenter controls into the outgoing composite.
   */
  headlessMeetOverlay?: boolean;
  /** Verified account access used for durable sessions; never persisted by the board. */
  accessToken?: string;
  accountUserId?: string;
  /** Durable standalone board record associated with this live editing session. */
  persistentBoardId?: string;
  persistentWorkspaceId?: string;
  initialBoardState?: BoardState;
  /** Debounced committed-content snapshot; ephemeral cursors and media never leave the canvas. */
  onPersistentBoardChange?: (state: BoardState) => void | Promise<void>;
  /** Durable board lifecycle is controlled by the authenticated route owner. */
  onRenameBoard?: (title: string) => Promise<void>;
  onDeleteBoard?: (latestState: BoardState) => Promise<void>;
  /** Durable board identity and persistence state shown in the standalone editor chrome. */
  boardTitle?: string;
  persistentSaveStatus?: "saved" | "saving" | "error";
  initialPreferences?: {
    neonTheme?: boolean;
    videoEnabled?: boolean;
    audioEnabled?: boolean;
  };
}) {
  const [bridgedAccessToken, setBridgedAccessToken] = useState<string | undefined>();
  const effectiveAccessToken = accessToken ?? bridgedAccessToken;
  const syncAuthenticationReady = !headlessMeetOverlay || Boolean(effectiveAccessToken);
  useEffect(() => {
    if (typeof window === "undefined" || accessToken) return;
    const receiveHostAuthentication = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.source === window.parent &&
        event.origin.startsWith("chrome-extension://") &&
        data?.bridge === "airboard-extension-auth" &&
        data.type === "installation-token" &&
        typeof data.token === "string" &&
        data.token.length <= 4_096
      ) {
        setBridgedAccessToken(data.token);
      }
    };
    window.addEventListener("message", receiveHostAuthentication);
    return () => window.removeEventListener("message", receiveHostAuthentication);
  }, [accessToken]);
  const reportVoiceTrace = useMemo(
    () => createVoiceTraceReporter(AIRBOARD_API_URL, fetch, effectiveAccessToken),
    [effectiveAccessToken],
  );
  const isMeetSurface = surface !== "standalone";
  // The Meet media bridge extension (a meet.google.com content script) can
  // stream the meeting origin's camera and microphone into this frame when
  // installed; capture always starts from an explicit user action here.
  const [meetMediaBridge, setMeetMediaBridge] = useState<MeetMediaBridge | null>(null);
  const cameraCaptureAvailable = !isMeetSurface || embeddedMediaCapture || meetMediaBridge !== null;
  const voiceCaptureAvailable = !isMeetSurface || embeddedMediaCapture || meetMediaBridge !== null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenUnderlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenUnderlayStreamRef = useRef<MediaStream | null>(null);
  const screenUnderlayStartInProgressRef = useRef(false);
  const meetBridgeSessionRef = useRef<MeetMediaBridgeVideoSession | null>(null);
  const meetBridgeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const intentCommandInputRef = useRef<HTMLTextAreaElement | null>(null);
  const trackerRef = useRef<MediaPipeHandTracker | null>(null);
  // Synchronous guard against a double-start race (state updates lag within a tick).
  const cameraStartInProgressRef = useRef(false);
  // Flipped on unmount so an in-flight startCamera can release what it acquires.
  const cameraMountedRef = useRef(true);
  const headlessCameraRequestedRef = useRef(false);
  const headlessVoiceRequestedRef = useRef(false);
  const standaloneCameraResumeAttemptedRef = useRef(false);
  const standaloneVoiceResumeAttemptedRef = useRef(false);
  const pipelineRef = useRef(new GesturePipeline());
  const hybridGestureControllerRef = useRef<HybridGestureController | null>(null);
  const hybridGestureCanvasSizeRef = useRef({ width: 0, height: 0, minTrackingConfidence: 0 });
  const hybridPinchClosedRef = useRef(false);
  // One dock action per physical hand-close. This lets a user close just
  // before reaching a tool without repeatedly activating adjacent controls.
  const dockGestureActivationTrackerRef = useRef<DockGestureActivationTracker | null>(null);
  if (dockGestureActivationTrackerRef.current === null) {
    dockGestureActivationTrackerRef.current = new DockGestureActivationTracker();
  }
  const speechSessionRef = useRef<ActiveSpeechSession | null>(null);
  const selectedSpeechModelRef = useRef("");
  const selectedSemanticIntentModelRef = useRef("");
  const prepareIntentCommandRef = useRef<
    ((text: string, voiceTurnId?: string) => PrepareIntentCommandResult) | null
  >(null);
  const prepareIntentCommandWithSemanticRef = useRef<
    ((text: string, voiceTurnId?: string) => Promise<IntentPreparationOutcome>) | null
  >(null);
  const wakeCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const semanticIntentConfigRef = useRef<SemanticIntentConfig | null>(null);
  const semanticIntentRequestIdRef = useRef(0);
  const selectedAnnotationIdsRef = useRef<string[]>([]);
  const voiceCorrectionPendingRef = useRef<{
    heard: string;
    suggested: string;
  } | null>(null);
  const pendingIntentRef = useRef<PendingIntent | null>(null);
  const applyPendingIntentRef = useRef<(() => void) | null>(null);
  // The interaction core: gate routing + pose/hold state machines. Lazily
  // constructed once and stable across renders.
  const voiceRouterRef = useRef<VoiceCommandRouter | null>(null);
  if (voiceRouterRef.current === null) {
    voiceRouterRef.current = new VoiceCommandRouter();
  }
  const voiceRouter = voiceRouterRef.current;
  const palmVoiceGestureTrackerRef = useRef<PalmVoiceGestureTracker | null>(null);
  if (palmVoiceGestureTrackerRef.current === null) {
    palmVoiceGestureTrackerRef.current = new PalmVoiceGestureTracker();
  }
  const undoGestureTrackerRef = useRef<UndoGestureTracker | null>(null);
  if (undoGestureTrackerRef.current === null) {
    undoGestureTrackerRef.current = new UndoGestureTracker();
  }
  const snapGestureTrackerRef = useRef<SnapGestureTracker | null>(null);
  if (snapGestureTrackerRef.current === null) {
    snapGestureTrackerRef.current = new SnapGestureTracker();
  }
  const holdToEditTrackerRef = useRef<HoldToEditTracker | null>(null);
  if (holdToEditTrackerRef.current === null) {
    holdToEditTrackerRef.current = new HoldToEditTracker();
  }
  const scopedKeyActiveRef = useRef(false);
  const boardRef = useRef<BoardState>(
    initialBoardState ?? createInitialBoardState(persistentBoardId ?? BOARD_SESSION_ID),
  );
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistenceRef = useRef<BoardState | null>(null);
  const lastPersistenceHashRef = useRef("");
  const persistenceCallbackRef = useRef(onPersistentBoardChange);
  useEffect(() => {
    persistenceCallbackRef.current = onPersistentBoardChange;
  }, [onPersistentBoardChange]);
  // Board sync: a live server session id takes over from the local fallback
  // once a session is created/joined; every event addresses whichever id is
  // current so the server accepts and rebroadcasts it.
  const boardSessionIdRef = useRef(BOARD_SESSION_ID);
  const boardSyncRef = useRef<BoardSyncHandle | null>(null);
  const boardSyncSeededRef = useRef(false);
  const boardSyncSeedEligibleRef = useRef(false);
  const boardSyncConnectedOnceRef = useRef(false);
  const boardSyncStatusRef = useRef("off");
  const lastCursorPublishRef = useRef(0);
  // Pan/zoom camera over the board plane. Gesture mode only; switching input
  // modes resets to identity so the other modes' 1:1 math stays exact.
  const boardViewportRef = useRef<BoardViewport>({ ...IDENTITY_VIEWPORT });
  const canvasNavTrackerRef = useRef<CanvasNavigationTracker | null>(null);
  if (canvasNavTrackerRef.current === null) {
    canvasNavTrackerRef.current = new CanvasNavigationTracker();
  }
  const landmarkTraceRef = useRef<{
    startedAt: number;
    frames: {
      t: number;
      hands: { handedness: string; score: number; landmarks: [number, number, number][] }[];
    }[];
  } | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const pointerStrokeIdRef = useRef<string | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerErasingRef = useRef(false);
  const touchpadPointsRef = useRef<StrokePoint[]>([]);
  const lastTouchpadPointRef = useRef<StrokePoint | null>(null);
  const gesturePathRef = useRef<StrokePoint[]>([]);
  const lastGesturePointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeEraseAffectedStrokeIdsRef = useRef<Set<string>>(new Set());
  const undoStackRef = useRef<UndoAction[]>([]);
  const objectInteractionRef = useRef<ObjectInteraction | null>(null);
  const objectInteractionInitialStateRef = useRef<BoardState | null>(null);
  const cameraGrabActiveRef = useRef(false);
  const cameraPlacementActiveRef = useRef(false);
  const cameraPlacementArmedToolRef = useRef<ObjectDockTool | null>(null);
  const shortcutsActiveRef = useRef(false);
  const temporaryEraserActiveRef = useRef(false);
  const straightLineActiveRef = useRef(false);
  const panActiveRef = useRef(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [inputPaused, setInputPaused] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [gestureResult, setGestureResult] = useState<GestureResult | null>(null);
  const [sensitivity, setSensitivity] = useState(1);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const [inputMode, setInputMode] = useState<AirboardInputMode>("gesture");
  const [lastGestureIntent, setLastGestureIntent] = useState<{
    intent: string;
    confidence: number;
  } | null>(null);
  const [activeObjectTool, setActiveObjectTool] = useState<ObjectDockTool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [hoverStrokeId, setHoverStrokeId] = useState<string | null>(null);
  const [ghostAnnotation, setGhostAnnotation] = useState<AnnotationRenderObject | null>(null);
  const [ghostAnnotations, setGhostAnnotations] = useState<AnnotationRenderObject[]>([]);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [objectGestureState, setObjectGestureState] = useState<ObjectGestureState>("hover");
  const [intentCommandText, setIntentCommandText] = useState("");
  const [commandFeedback, setCommandFeedback] = useState(
    "Speak or type a diagram command. Pointing supplies “here”, “this”, and “that”.",
  );
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [voiceGate, setVoiceGate] = useState<VoiceGateUi | null>(null);
  const [boardSyncStatus, setBoardSyncStatus] = useState("off");
  // Rendered by the companion-window link on meeting surfaces; the ref alone
  // would not re-render when the session becomes available.
  const [activeBoardSessionId, setActiveBoardSessionId] = useState<string | null>(null);
  const [activeJoinToken, setActiveJoinToken] = useState<string | null>(null);
  // Lightboard (neon-on-dark) appearance. Defaults here; stored preferences
  // load after mount so server and client render the same initial tree.
  const [boardTheme, setBoardTheme] = useState<"classic" | "lightboard">(
    desktopOverlay || headlessMeetOverlay || initialPreferences?.neonTheme !== false
      ? "lightboard"
      : "classic",
  );
  const [cameraUnderlayEnabled, setCameraUnderlayEnabled] = useState(
    !desktopOverlay && initialPreferences?.videoEnabled !== false,
  );
  const [scrimOpacity, setScrimOpacity] = useState(CAMERA_PRESENTATION_SCRIM);
  const cameraUnderlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenUnderlayStatus, setScreenUnderlayStatus] =
    useState<ScreenUnderlayStatus>("idle");
  const [screenUnderlayNotice, setScreenUnderlayNotice] = useState<string | null>(null);
  // Studio recording. Refs mirror theme/scrim so the recorder's per-frame
  // compositor reads current values without re-starting on every change.
  const [localContrastPlatesEnabled, setLocalContrastPlatesEnabled] = useState(true);
  const [desktopOverlayState, setDesktopOverlayState] =
    useState<DesktopOverlayState>(DEFAULT_DESKTOP_OVERLAY_STATE);
  // Camera overlay: the extension's MAIN-world compositor blends neon board
  // frames onto the outgoing Meet camera (main stage only).
  const [cameraOverlay, setCameraOverlay] = useState<MeetCameraOverlay | null>(null);
  const [cameraOverlayState, setCameraOverlayState] = useState<MeetCameraOverlayState | null>(
    null,
  );
  const [cameraOverlayEnabled, setCameraOverlayEnabled] = useState(headlessMeetOverlay);
  const [diagramVisible, setDiagramVisible] = useState(true);
  const diagramVisibleRef = useRef(true);
  const [recordingState, setRecordingState] = useState<"idle" | "recording">("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const recorderRef = useRef<LightboardRecorderHandle | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boardThemeRef = useRef(boardTheme);
  const scrimOpacityRef = useRef(scrimOpacity);
  const enforceCameraCanvas = useCallback(() => {
    const nextScrim = cameraCanvasScrim(scrimOpacityRef.current);
    boardThemeRef.current = "lightboard";
    scrimOpacityRef.current = nextScrim;
    setBoardTheme("lightboard");
    setScrimOpacity(nextScrim);
    if (surface === "standalone" && !desktopOverlay) {
      setCameraUnderlayEnabled(true);
    }
    try {
      window.localStorage.setItem("airboard.theme.v1", "lightboard");
      window.localStorage.setItem("airboard.underlay.v1", "on");
      window.localStorage.setItem("airboard.scrim.camera.v1", String(nextScrim));
    } catch {
      // Preference persistence is best-effort.
    }
  }, [desktopOverlay, surface]);
  const [landmarkRecordingActive, setLandmarkRecordingActive] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [viewportScale, setViewportScale] = useState(1);
  const [canvasNavMode, setCanvasNavMode] = useState<"pan" | "zoom" | null>(null);
  const [dockGestureHover, setDockGestureHover] = useState<string | null>(null);
  const dockGestureHoverRef = useRef<string | null>(null);
  const catalogCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const copilotActivitySequenceRef = useRef(1);
  const [copilotActivity, setCopilotActivity] = useState<CopilotActivityEntry[]>([
    {
      id: 1,
      source: "Airo",
      title: "Ready",
      detail: "Hold an open palm for voice, say “Airo…”, or type below.",
      tone: "neutral",
    },
  ]);
  const [openCatalogId, setOpenCatalogId] = useState<string | null>(null);
  const openCatalogIdRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(boardTitle);
  const [titleStatus, setTitleStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting" | "error">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleCancelPendingRef = useRef(false);
  const titleCommitInFlightRef = useRef(false);
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechArmed, setSpeechArmed] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<MediaPermissionState>("unsupported");
  const [cameraPermission, setCameraPermission] =
    useState<MediaPermissionState>("unsupported");
  const [speechEngine, setSpeechEngine] = useState<SpeechEngine>("loading");
  const [realtimeTranscriptionConfig, setRealtimeTranscriptionConfig] =
    useState<RealtimeTranscriptionConfig | null>(null);
  const [semanticIntentConfig, setSemanticIntentConfig] =
    useState<SemanticIntentConfig | null>(null);
  const [selectedSpeechModel, setSelectedSpeechModel] = useState("");
  const [selectedSemanticIntentModel, setSelectedSemanticIntentModel] = useState("");
  const [realtimeSpeechMetadata, setRealtimeSpeechMetadata] =
    useState<RealtimeSpeechMetadata | null>(null);
  const [speechConfigRevision, setSpeechConfigRevision] = useState(0);
  const [speechHeardText, setSpeechHeardText] = useState("");
  const [speechRecognitionStatus, setSpeechRecognitionStatus] =
    useState<SpeechRecognitionStatus>("idle");
  const speechRecognitionStatusRef = useRef<SpeechRecognitionStatus>("idle");
  const [handControlDiagnostics, setHandControlDiagnostics] = useState<HandControlDiagnostics>({
    trackingConfidence: 0,
    grabStrength: 0,
    grabConfidence: 0,
    focusedTargetId: null,
    grabbedTargetId: null,
    placementActive: false,
    controllerState: "idle",
    requiresPinchRelease: false,
  });
  const [labelDraft, setLabelDraft] = useState("");
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [touchpadVariant, setTouchpadVariant] = useState<TouchpadModeVariant>("simple");
  const [touchpadTool, setTouchpadTool] = useState<TouchpadTool>("marker");
  const [touchpadState, setTouchpadState] = useState<TouchpadInputState>("IDLE");
  const [shortcutsActive, setShortcutsActive] = useState(false);
  const [temporaryEraserActive, setTemporaryEraserActive] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#111827");
  const [strokeThickness, setStrokeThickness] = useState(3);
  const [eraserRadius, setEraserRadius] = useState(28);
  const [frictionPreset, setFrictionPreset] = useState<FrictionPreset>("balanced");
  const [autoLiftEnabled, setAutoLiftEnabled] = useState(true);
  const [strokeCleanupEnabled, setStrokeCleanupEnabled] = useState(true);
  const [autoSnapConnectors, setAutoSnapConnectors] = useState(true);
  const [debugVisible, setDebugVisible] = useState(false);
  const [stats, setStats] = useState<Stats>({
    strokes: 0,
    deleted: 0,
    active: 0,
    handsDetected: 0,
  });
  useEffect(() => {
    if (!titleEditing) setTitleDraft(boardTitle);
  }, [boardTitle, titleEditing]);
  useEffect(() => {
    selectedAnnotationIdsRef.current = selectedAnnotationIds;
  }, [selectedAnnotationIds]);
  useEffect(() => {
    openCatalogIdRef.current = openCatalogId;
  }, [openCatalogId]);
  useEffect(() => {
    try {
      window.localStorage.removeItem("airboard.project-glossary.v1");
    } catch {
      // Storage may be disabled; current-board terminology still works in memory.
    }
  }, []);
  const markerInputMode: MarkerInputMode = "hand_marker";
  const touchpadConfig = useMemo(
    () =>
      getTouchpadModeConfig(touchpadVariant, {
        color: strokeColor,
        thickness: strokeThickness,
        eraserRadius,
      }),
    [eraserRadius, strokeColor, strokeThickness, touchpadVariant],
  );
  const gestureConfig = useMemo<GestureConfig>(
    () => ({
      ...defaultGestureConfig,
      markerHand: "either",
      markerGestureConfidenceThreshold: confidenceThreshold,
      dusterGestureConfidenceThreshold: Math.max(0.45, confidenceThreshold * 0.72),
    }),
    [confidenceThreshold, inputMode],
  );
  const frictionConfig = useMemo<Partial<VirtualSurfaceFrictionConfig>>(
    () => ({
      ...defaultVirtualSurfaceFrictionConfig,
      ...frictionPresets[frictionPreset === "custom" ? "balanced" : frictionPreset],
      enableAutoLift: autoLiftEnabled,
      enablePostStrokeSmoothing: strokeCleanupEnabled,
      enableLineSnap: strokeCleanupEnabled,
    }),
    [autoLiftEnabled, frictionPreset, inputMode, strokeCleanupEnabled],
  );

  const broadcastSafe =
    headlessMeetOverlay || (desktopOverlay && desktopOverlayState.clickThrough);
  const standaloneEditor = surface === "standalone" && !desktopOverlay;
  const setCopilotVisibility = useCallback((visible: boolean) => {
    setCopilotOpen(visible);
    try {
      window.localStorage.setItem("airboard.copilot.v1", visible ? "open" : "closed");
    } catch {
      // Preference persistence is best-effort.
    }
  }, []);
  const appendCopilotActivity = useCallback(
    (entry: Omit<CopilotActivityEntry, "id">) => {
      copilotActivitySequenceRef.current += 1;
      const nextEntry = { ...entry, id: copilotActivitySequenceRef.current };
      setCopilotActivity((current) => {
        const previous = current[current.length - 1];
        if (
          previous?.source === nextEntry.source &&
          previous.title === nextEntry.title &&
          previous.detail === nextEntry.detail
        ) {
          return current;
        }
        return [...current, nextEntry].slice(-8);
      });
    },
    [],
  );
  useEffect(() => {
    speechRecognitionStatusRef.current = speechRecognitionStatus;
  }, [speechRecognitionStatus]);
  useEffect(() => {
    if (!standaloneEditor) {
      return;
    }
    try {
      setCopilotOpen(window.localStorage.getItem("airboard.copilot.v1") !== "closed");
    } catch {
      // Keep the default-open copilot when storage is unavailable.
    }
  }, [standaloneEditor]);
  const refreshStandaloneMediaPermissions = useCallback(async () => {
    if (!standaloneEditor) return;
    const [microphone, camera] = await Promise.all([
      queryMediaPermission("microphone"),
      queryMediaPermission("camera"),
    ]);
    setMicrophonePermission(microphone);
    setCameraPermission(camera);
  }, [standaloneEditor]);
  useEffect(() => {
    if (!standaloneEditor) return;
    let cancelled = false;
    const refresh = () => {
      void Promise.all([
        queryMediaPermission("microphone"),
        queryMediaPermission("camera"),
      ]).then(([microphone, camera]) => {
        if (cancelled) return;
        setMicrophonePermission(microphone);
        setCameraPermission(camera);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [standaloneEditor]);
  const cameraCanvasLocked =
    headlessMeetOverlay ||
    cameraOverlayEnabled ||
    cameraStatus === "starting" ||
    cameraStatus === "tracker_loading" ||
    cameraStatus === "active";
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    renderBoard(canvas, boardRef.current, {
      view: boardViewportRef.current,
      // Lightboard content sits on DOM layers (camera underlay + scrim), so
      // the canvas itself stays transparent there.
      background: boardTheme === "lightboard" ? "transparent" : "white",
      theme: boardTheme,
      selectedStrokeId: broadcastSafe ? null : selectedAnnotationId,
      selectedStrokeIds: broadcastSafe ? [] : selectedAnnotationIds,
      hoverStrokeId: broadcastSafe ? null : hoverStrokeId,
      ghostAnnotation: broadcastSafe ? null : ghostAnnotation,
      ghostAnnotations: broadcastSafe ? [] : ghostAnnotations,
      alignmentGuides: broadcastSafe ? [] : alignmentGuides,
      hideCursors: broadcastSafe,
      contrastPlates:
        boardTheme === "lightboard" &&
        localContrastPlatesEnabled &&
        (desktopOverlay || headlessMeetOverlay || screenUnderlayStatus === "active")
          ? { opacity: 0.72, padding: 14, mergeGap: 18 }
          : null,
    });
  }, [
    alignmentGuides,
    boardTheme,
    broadcastSafe,
    desktopOverlay,
    headlessMeetOverlay,
    ghostAnnotation,
    ghostAnnotations,
    hoverStrokeId,
    localContrastPlatesEnabled,
    screenUnderlayStatus,
    selectedAnnotationId,
    selectedAnnotationIds,
  ]);

  const updateStats = useCallback(() => {
    const state = boardRef.current;
    const strokes = Object.values(state.strokes);
    setStats((currentStats) => ({
      strokes: strokes.filter((stroke) => stroke.status !== "deleted").length,
      deleted: strokes.filter((stroke) => stroke.status === "deleted").length,
      active: Object.keys(state.activeStrokes).length,
      handsDetected: currentStats.handsDetected,
    }));
  }, []);

  const schedulePersistentSnapshot = useCallback((state: BoardState) => {
    const callback = persistenceCallbackRef.current;
    if (!callback || !persistentBoardId) return;
    const snapshot: BoardState = {
      ...state,
      boardId: persistentBoardId,
      activeStrokes: {},
      participants: {},
      cursors: {},
    };
    const hash = JSON.stringify({
      strokes: snapshot.strokes,
      eraseActions: snapshot.eraseActions,
      clearedAt: snapshot.clearedAt,
    });
    if (hash === lastPersistenceHashRef.current) return;
    pendingPersistenceRef.current = snapshot;
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = setTimeout(() => {
      const pending = pendingPersistenceRef.current;
      if (!pending) return;
      pendingPersistenceRef.current = null;
      lastPersistenceHashRef.current = hash;
      persistenceCallbackRef.current?.(pending);
    }, 800);
  }, [persistentBoardId]);

  useEffect(() => () => {
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    const pending = pendingPersistenceRef.current;
    if (pending) persistenceCallbackRef.current?.(pending);
  }, []);

  /**
   * Publishes a locally-applied event to the live session (no-op while
   * offline). Cursor presence is throttled: it fires every pointer frame
   * locally but peers only need ~8Hz.
   */
  const publishBoardEvent = useCallback((event: BoardEvent) => {
    const sync = boardSyncRef.current;
    if (!sync || event.boardSessionId !== sync.boardSessionId) {
      return;
    }
    if (event.type === "cursor.moved") {
      const now = performance.now();
      if (now - lastCursorPublishRef.current < 120) {
        return;
      }
      lastCursorPublishRef.current = now;
    }
    sync.publish(event);
  }, []);

  const applyLocalEvent = useCallback(
    (event: BoardEvent) => {
      boardRef.current = applyBoardEvent(boardRef.current, event);
      render();
      updateStats();
      publishBoardEvent(event);
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        schedulePersistentSnapshot(boardRef.current);
      }
    },
    [publishBoardEvent, render, schedulePersistentSnapshot, updateStats],
  );

  /** A peer's event: apply and render, never re-publish (that would loop). */
  const applyRemoteEvent = useCallback(
    (event: BoardEvent) => {
      boardRef.current = applyBoardEvent(boardRef.current, event);
      render();
      updateStats();
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        schedulePersistentSnapshot(boardRef.current);
      }
    },
    [render, schedulePersistentSnapshot, updateStats],
  );
  const applyRemoteEventRef = useRef(applyRemoteEvent);
  useEffect(() => {
    applyRemoteEventRef.current = applyRemoteEvent;
  }, [applyRemoteEvent]);

  /** Screen (canvas CSS px) → board coordinates through the live viewport. */
  const toBoardPoint = useCallback(
    (point: { x: number; y: number }) => boardPointFromScreen(boardViewportRef.current, point),
    [],
  );

  const currentViewportLimits = useCallback((): ViewportLimits => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      ...DEFAULT_VIEWPORT_LIMITS,
      canvasWidth: rect?.width ?? 900,
      canvasHeight: rect?.height ?? 600,
    };
  }, []);

  const applyViewport = useCallback(
    (next: BoardViewport) => {
      const clamped = clampViewport(next, currentViewportLimits());
      const current = boardViewportRef.current;
      if (
        Math.abs(clamped.x - current.x) < 0.01 &&
        Math.abs(clamped.y - current.y) < 0.01 &&
        Math.abs(clamped.scale - current.scale) < 0.0001
      ) {
        return;
      }
      boardViewportRef.current = clamped;
      const rounded = Math.round(clamped.scale * 100) / 100;
      setViewportScale((value) => (value === rounded ? value : rounded));
      render();
    },
    [currentViewportLimits, render],
  );

  // Meet surfaces cannot capture media themselves, but the bridge extension
  // on meet.google.com can stream the meeting's camera in. Probe for it once.
  useEffect(() => {
    if (!isMeetSurface || embeddedMediaCapture) {
      return;
    }
    let cancelled = false;
    void probeMeetMediaBridgeInWindow().then((bridge) => {
      if (!cancelled && bridge) {
        setMeetMediaBridge(bridge);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [embeddedMediaCapture, isMeetSurface]);

  // Camera-overlay compositor probe. Every renderer that arms the compositor
  // also disarms it on teardown so disabling the extension cannot leave a
  // stale bitmap on the user's outgoing camera.
  useEffect(() => {
    if (surface !== "meet-main-stage") {
      return;
    }
    let cancelled = false;
    let handle: MeetCameraOverlay | null = null;
    void probeMeetCameraOverlayInWindow((state) => {
      if (!cancelled) {
        setCameraOverlayState(state);
      }
    }).then((overlay) => {
      if (cancelled) {
        overlay?.dispose();
        return;
      }
      handle = overlay;
      if (overlay) {
        setCameraOverlay(overlay);
      }
    });
    return () => {
      cancelled = true;
      handle?.stop();
      handle?.dispose();
    };
  }, [headlessMeetOverlay, surface]);

  useEffect(() => {
    if (!headlessMeetOverlay || !cameraOverlay || !diagramVisibleRef.current) {
      return;
    }
    enforceCameraCanvas();
    setCameraOverlayEnabled(true);
    cameraOverlay.start();
  }, [cameraOverlay, enforceCameraCanvas, headlessMeetOverlay]);

  // Overlay frame pump: ~15fps of the neon board, downscaled for transfer.
  useEffect(() => {
    if (!cameraOverlay || !cameraOverlayEnabled) {
      return;
    }
    let cancelled = false;
    let busy = false;
    const timer = setInterval(() => {
      const canvas = canvasRef.current;
      if (cancelled || busy || !canvas || canvas.width === 0) {
        return;
      }
      busy = true;
      // Send the complete transparent board. Meet draws camera -> dark scrim ->
      // this bitmap, so diagrams always remain the topmost audience layer.
      const width = Math.min(1280, canvas.width);
      const height = Math.max(2, Math.round((canvas.height * width) / canvas.width));
      void createImageBitmap(canvas, { resizeWidth: width, resizeHeight: height })
        .then((bitmap) => {
          if (cancelled || !cameraOverlay.trySendFrame(bitmap, scrimOpacityRef.current)) {
            bitmap.close();
          }
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 66);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cameraOverlay, cameraOverlayEnabled]);

  // Load stored appearance preferences after mount (SSR-safe).
  useEffect(() => {
    try {
      if (
        desktopOverlay ||
        headlessMeetOverlay ||
        window.localStorage.getItem("airboard.theme.v1") === "lightboard"
      ) {
        setBoardTheme("lightboard");
      }
      if (desktopOverlay || window.localStorage.getItem("airboard.underlay.v1") === "off") {
        setCameraUnderlayEnabled(false);
      }
      // Camera and screen sources intentionally do not share dimming state.
      // Migrate a legacy global value through the camera bounds so a 25%
      // screen preference can never wash out the camera canvas again.
      const storedCameraScrim = window.localStorage.getItem("airboard.scrim.camera.v1");
      const legacyScrim = window.localStorage.getItem("airboard.scrim.v1");
      const cameraScrim = cameraCanvasScrim(
        Number(storedCameraScrim ?? legacyScrim ?? CAMERA_PRESENTATION_SCRIM),
      );
      scrimOpacityRef.current = cameraScrim;
      setScrimOpacity(cameraScrim);
      if (window.localStorage.getItem("airboard.contrast-plates.v1") === "off") {
        setLocalContrastPlatesEnabled(false);
      }
    } catch {
      // Storage may be unavailable; keep defaults.
    }
  }, [desktopOverlay, headlessMeetOverlay]);

  useEffect(() => {
    if (!desktopOverlay) {
      return;
    }
    document.body.classList.add("airboard-desktop-overlay");
    const bridge = window.airboardDesktop;
    if (!bridge) {
      // Direct browser visits to ?desktopOverlay=1 are a safe visual preview;
      // no native host exists there, so keep its controls usable.
      setDesktopOverlayState((current) => ({ ...current, clickThrough: false }));
      return () => document.body.classList.remove("airboard-desktop-overlay");
    }
    setDesktopOverlayState(bridge.initialState);
    const unsubscribe = bridge.onStateChanged(setDesktopOverlayState);
    void bridge.getState().then(setDesktopOverlayState).catch(() => {});
    return () => {
      unsubscribe();
      document.body.classList.remove("airboard-desktop-overlay");
    };
  }, [desktopOverlay]);

  const restoreDesktopClickThrough = useCallback(() => {
    const bridge = window.airboardDesktop;
    if (!bridge) {
      setDesktopOverlayState((current) => ({ ...current, clickThrough: true }));
      return;
    }
    void bridge.setClickThrough(true).then(setDesktopOverlayState).catch(() => {});
  }, []);

  useEffect(() => {
    boardThemeRef.current = boardTheme;
    scrimOpacityRef.current = scrimOpacity;
  }, [boardTheme, scrimOpacity]);

  // Returning from screen capture (including cancellation or OS-level stop)
  // must restore the darker camera glass instead of leaving the screen's 25%
  // dimming over the presenter.
  useEffect(() => {
    const cameraCanvasVisible =
      headlessMeetOverlay ||
      (surface === "standalone" &&
        !desktopOverlay &&
        cameraStatus === "active" &&
        cameraUnderlayEnabled &&
        ["idle", "blocked", "error"].includes(screenUnderlayStatus));
    if (cameraCanvasVisible) {
      enforceCameraCanvas();
    }
  }, [
    cameraStatus,
    cameraUnderlayEnabled,
    boardTheme,
    desktopOverlay,
    enforceCameraCanvas,
    headlessMeetOverlay,
    screenUnderlayStatus,
    surface,
  ]);

  const stopScreenUnderlay = useCallback(
    (notice: string | null = null) => {
      screenUnderlayStartInProgressRef.current = false;
      const stream = screenUnderlayStreamRef.current;
      screenUnderlayStreamRef.current = null;
      const video = screenUnderlayVideoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      stopMediaStream(stream);
      setScreenUnderlayStatus("idle");
      setScreenUnderlayNotice(notice);
    },
    [],
  );

  const startScreenUnderlay = useCallback(async () => {
    if (
      surface !== "standalone" ||
      screenUnderlayStartInProgressRef.current ||
      screenUnderlayStatus === "starting" ||
      screenUnderlayStatus === "active"
    ) {
      return;
    }
    screenUnderlayStartInProgressRef.current = true;
    setScreenUnderlayStatus("starting");
    setScreenUnderlayNotice(
      "Choose the screen or window containing your content — not this Airboard tab.",
    );
    if (boardTheme !== "lightboard") {
      setBoardTheme("lightboard");
      try {
        window.localStorage.setItem("airboard.theme.v1", "lightboard");
      } catch {
        // Preference persistence is best-effort.
      }
    }
    setLocalContrastPlatesEnabled(true);
    let nextScrim = SCREEN_PRESENTATION_SCRIM;
    try {
      const storedScreenScrim = window.localStorage.getItem("airboard.scrim.screen.v1");
      if (storedScreenScrim !== null) {
        nextScrim = screenFriendlyScrim(Number(storedScreenScrim));
      }
    } catch {
      // Use the screen default when storage is unavailable.
    }
    if (nextScrim !== scrimOpacityRef.current) {
      scrimOpacityRef.current = nextScrim;
      setScrimOpacity(nextScrim);
    }
    try {
      window.localStorage.setItem("airboard.contrast-plates.v1", "on");
      window.localStorage.setItem("airboard.scrim.screen.v1", String(nextScrim));
    } catch {
      // Preference persistence is best-effort.
    }

    let stream: MediaStream | null = null;
    try {
      stream = await requestScreenUnderlay();
      if (!cameraMountedRef.current) {
        stopMediaStream(stream);
        return;
      }
      const video = screenUnderlayVideoRef.current;
      if (!video) {
        throw new Error("The Airboard screen layer is unavailable.");
      }
      screenUnderlayStreamRef.current = stream;
      video.srcObject = stream;
      const track = stream.getVideoTracks()[0]!;
      track.addEventListener(
        "ended",
        () => {
          if (screenUnderlayStreamRef.current === stream) {
            stopScreenUnderlay(
              "Screen sharing ended. Choose a screen or window again to restore the background.",
            );
          }
        },
        { once: true },
      );
      await video.play();
      if (screenUnderlayStreamRef.current !== stream) {
        stopMediaStream(stream);
        return;
      }
      setScreenUnderlayStatus("active");
      setScreenUnderlayNotice(
        "Screen background is live with a light global dim and local contrast behind diagram clusters. Share this Airboard tab when you want others to see the composite.",
      );
    } catch (error) {
      // The source may have ended while video.play() was still resolving. Its
      // ended handler already restored the correct idle state and notice.
      if (stream && screenUnderlayStreamRef.current !== stream) {
        stopMediaStream(stream);
        return;
      }
      if (screenUnderlayStreamRef.current === stream) {
        screenUnderlayStreamRef.current = null;
      }
      stopMediaStream(stream);
      const video = screenUnderlayVideoRef.current;
      if (video) {
        video.srcObject = null;
      }
      const name =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name ?? "")
          : "";
      setScreenUnderlayStatus(name === "NotAllowedError" ? "blocked" : "error");
      setScreenUnderlayNotice(describeScreenUnderlayError(error));
    } finally {
      screenUnderlayStartInProgressRef.current = false;
    }
  }, [boardTheme, screenUnderlayStatus, stopScreenUnderlay, surface]);

  // Stop an in-flight recording if the board unmounts.
  useEffect(() => {
    // React development Strict Mode runs an effect setup/cleanup/setup cycle.
    // Re-arm the lifecycle guard on setup so the second mount is not mistaken
    // for a permanently unmounted camera/screen surface.
    cameraMountedRef.current = true;
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
    };
  }, []);

  const startStudioRecording = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || recorderRef.current) {
      return;
    }
    setRecordingNotice(null);
    try {
      const useScreenUnderlay =
        screenUnderlayStatus === "active" &&
        Boolean(screenUnderlayVideoRef.current?.videoWidth);
      const handle = await startLightboardRecording({
        boardCanvas: canvas,
        underlayVideo: useScreenUnderlay
          ? screenUnderlayVideoRef.current
          : cameraUnderlayVideoRef.current,
        underlayMode: useScreenUnderlay ? "screen" : "camera",
        getScrimOpacity: () => scrimOpacityRef.current,
        getTheme: () => boardThemeRef.current,
      });
      recorderRef.current = handle;
      setRecordingState("recording");
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
      if (!handle.hasAudio) {
        setRecordingNotice("Microphone unavailable — recording video only.");
      }
    } catch (error) {
      setRecordingNotice(
        error instanceof Error ? error.message : "Recording could not start.",
      );
    }
  }, [screenUnderlayStatus]);

  const stopStudioRecording = useCallback(async () => {
    const handle = recorderRef.current;
    if (!handle) {
      return;
    }
    recorderRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingState("idle");
    const blob = await handle.stop();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = recordingFileName(new Date());
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setRecordingNotice("Recording saved to your downloads.");
  }, []);

  // The camera underlay mirrors whatever stream feeds the hand tracker. A
  // selected screen/window is a separate, unmirrored video layer above it.
  useEffect(() => {
    const underlay = cameraUnderlayVideoRef.current;
    if (!underlay) {
      return;
    }
    const source = videoRef.current?.srcObject ?? null;
    if (underlay.srcObject !== source) {
      underlay.srcObject = source;
      if (source) {
        void underlay.play().catch(() => {});
      }
    }
  }, [boardTheme, cameraStatus, cameraUnderlayEnabled]);

  // First-run onboarding: the gesture vocabulary is invisible until taught.
  useEffect(() => {
    if (headlessMeetOverlay) {
      setOnboardingVisible(false);
      return;
    }
    if (!cameraCaptureAvailable) {
      setOnboardingVisible(false);
      return;
    }
    try {
      if (window.localStorage.getItem("airboard.onboarding.v1") !== "done") {
        setOnboardingVisible(true);
      }
    } catch {
      // Storage may be unavailable; skip onboarding rather than block.
    }
  }, [cameraCaptureAvailable, headlessMeetOverlay]);

  /**
   * Board sync bootstrap. With ?boardSessionId=… in the URL we join that
   * session and hydrate from the server's state; otherwise we create a new
   * session as owner and stamp its id into the URL so the page becomes a
   * shareable live-board link. If the API is unreachable the board simply
   * stays local — every feature works, nothing syncs.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !syncAuthenticationReady) {
      return;
    }
    let cancelled = false;
    const requestedSessionId =
      initialBoardSessionId ??
      new URLSearchParams(window.location.search).get("boardSessionId");
    const requestedJoinToken = new URLSearchParams(window.location.search).get("joinToken");
    boardSyncStatusRef.current = "connecting";
    setBoardSyncStatus("connecting");

    const trySeed = () => {
      if (
        boardSyncSeededRef.current ||
        !boardSyncSeedEligibleRef.current ||
        !boardSyncConnectedOnceRef.current
      ) {
        return;
      }
      const sync = boardSyncRef.current;
      if (!sync) {
        return;
      }
      boardSyncSeededRef.current = true;
      // Objects drawn before the socket opened still reach the session.
      const seedEvents = snapshotBoardEvents(boardRef.current, {
        boardSessionId: sync.boardSessionId,
        actorParticipantId: PARTICIPANT_ID,
      });
      if (seedEvents.length > 0) {
        sync.publish(seedEvents);
      }
    };

    startBoardSync(
      {
        apiBaseUrl: AIRBOARD_API_URL,
        boardSessionId: requestedSessionId,
        ownerUserId: accountUserId ?? OWNER_USER_ID,
        ...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {}),
        ...(requestedJoinToken ? { joinToken: requestedJoinToken } : {}),
        provider: meetingProvider,
        ...(providerMeetingId ? { providerMeetingId } : {}),
        ...(persistentWorkspaceId ? { workspaceId: persistentWorkspaceId } : {}),
        ...(persistentBoardId ? { boardId: persistentBoardId } : {}),
        displayName: requestedSessionId ? "Guest" : "Owner",
        title: "Airboard",
      },
      {
        onRemoteEvent: (event) => {
          if (!cancelled) {
            applyRemoteEventRef.current(event);
          }
        },
        onStatus: (status) => {
          if (cancelled) {
            return;
          }
          boardSyncStatusRef.current = status;
          setBoardSyncStatus(status);
          if (status === "connected") {
            boardSyncConnectedOnceRef.current = true;
            trySeed();
          }
        },
        onRejection: (rejection) => {
          if (!cancelled) {
            setCommandFeedback(
              `The board server rejected a change (${rejection.reason}). Reload to resync if boards diverge.`,
            );
          }
        },
      },
    )
      .then((result) => {
        if (cancelled) {
          result.handle.stop();
          return;
        }
        boardSyncRef.current = result.handle;
        boardSessionIdRef.current = result.handle.boardSessionId;
        setActiveBoardSessionId(result.handle.boardSessionId);
        setActiveJoinToken(result.handle.joinToken ?? requestedJoinToken);
        if (result.outcome === "joined") {
          boardRef.current = result.initialState;
          undoStackRef.current = [];
          setSelectedAnnotationId(null);
          setSelectedAnnotationIds([]);
          render();
          updateStats();
          setCommandFeedback("Joined the live board session.");
        } else {
          boardSyncSeedEligibleRef.current = true;
          trySeed();
          setCommandFeedback(
            "Live board session ready — share this page's URL to collaborate.",
          );
        }
        const url = new URL(window.location.href);
        url.searchParams.set("boardSessionId", result.handle.boardSessionId);
        if (result.handle.joinToken) {
          url.searchParams.set("joinToken", result.handle.joinToken);
        }
        window.history.replaceState(null, "", url.toString());
        onBoardSessionReady?.({
          boardSessionId: result.handle.boardSessionId,
          participantId: result.handle.participantId,
          role: result.handle.role,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        boardSyncStatusRef.current = "offline";
        setBoardSyncStatus("offline");
        if (requestedSessionId) {
          setCommandFeedback(
            "Could not join the shared board session — working on a local board instead.",
          );
        }
      });

    return () => {
      cancelled = true;
      boardSyncRef.current?.stop();
      boardSyncRef.current = null;
    };
    // Starts once for normal surfaces. The extension-owned engine waits until
    // its scoped installation credential arrives, then starts exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncAuthenticationReady]);

  const makePoint = useCallback((x: number, y: number, confidence?: number): StrokePoint => {
    const point: StrokePoint = {
      x,
      y,
      t: performance.now(),
    };
    if (confidence !== undefined) {
      point.confidence = confidence;
    }
    return point;
  }, []);

  const makeFrictionPoint = useCallback((point: FrictionStrokePoint): StrokePoint => {
    const strokePoint: StrokePoint = {
      x: point.x,
      y: point.y,
      t: point.t,
    };
    assignOptionalNumber(strokePoint, "rawX", point.rawX);
    assignOptionalNumber(strokePoint, "rawY", point.rawY);
    assignOptionalNumber(strokePoint, "rawTipX", point.rawTipX);
    assignOptionalNumber(strokePoint, "rawTipY", point.rawTipY);
    assignOptionalNumber(strokePoint, "confidence", point.confidence);
    assignOptionalNumber(strokePoint, "handSpeedPxPerSec", point.handSpeedPxPerSec);
    assignOptionalNumber(strokePoint, "gestureConfidence", point.gestureConfidence);
    assignOptionalNumber(strokePoint, "gripConfidence", point.gripConfidence);
    assignOptionalNumber(strokePoint, "tipConfidence", point.tipConfidence);
    assignOptionalNumber(strokePoint, "contactScore", point.contactScore);
    assignOptionalNumber(strokePoint, "frictionGain", point.frictionGain);
    if (point.inputSource) {
      strokePoint.inputSource = point.inputSource;
    }
    if (point.trackingSource) {
      strokePoint.trackingSource = point.trackingSource;
    }
    return strokePoint;
  }, []);

  const startStroke = useCallback(
    (
      point: StrokePoint,
      options: {
        color?: string;
        thickness?: number;
      } = {},
    ) => {
      const now = new Date().toISOString();
      const strokeInput: Parameters<typeof createStroke>[0] = {
        id: crypto.randomUUID(),
        boardId: boardSessionIdRef.current,
        userId: OWNER_USER_ID,
        point,
        createdAt: now,
      };
      if (options.color) {
        strokeInput.color = options.color;
      }
      if (options.thickness !== undefined) {
        strokeInput.thickness = options.thickness;
      }
      if (point.inputSource) {
        strokeInput.inputSource = point.inputSource;
      }
      if (point.trackingSource) {
        strokeInput.trackingSource = point.trackingSource;
      }
      const stroke = createStroke(strokeInput);
      activeStrokeIdRef.current = stroke.id;
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
          createdAt: now,
        }),
        type: "stroke.started",
        stroke,
      });
    },
    [applyLocalEvent],
  );

  const appendStrokePoint = useCallback(
    (strokeId: string, point: StrokePoint) => {
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "stroke.point_added",
        strokeId,
        point,
      });
    },
    [applyLocalEvent],
  );

  const commitStroke = useCallback(
    (strokeId: string | null, options: CommitStrokeOptions = {}) => {
      if (!strokeId) {
        return;
      }

      const event: StrokeCommittedEvent = {
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "stroke.committed",
        strokeId,
      };

      if (options.points) {
        event.points = options.points;
      }
      if (options.discard !== undefined) {
        event.discard = options.discard;
      }
      if (options.cleanupApplied !== undefined) {
        event.cleanupApplied = options.cleanupApplied;
      }
      if (options.lineSnapApplied !== undefined) {
        event.lineSnapApplied = options.lineSnapApplied;
      }
      if (options.frictionProfile) {
        event.frictionProfile = options.frictionProfile;
      }

      applyLocalEvent(event);
    },
    [applyLocalEvent],
  );

  const eraseAt = useCallback(
    (point: StrokePoint, radius = ERASER_RADIUS): string[] => {
      const affectedStrokeIds = findIntersectingStrokeIds(boardRef.current, point, radius);
      const cursor: CursorState = {
        participantId: PARTICIPANT_ID,
        x: point.x,
        y: point.y,
        mode: "erasing",
        updatedAt: new Date().toISOString(),
      };
      if (point.inputSource) {
        cursor.inputSource = point.inputSource;
      }

      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "cursor.moved",
        cursor,
      });

      if (affectedStrokeIds.length === 0) {
        return [];
      }

      const now = new Date().toISOString();
      const eraseInput: Parameters<typeof createEraseAction>[0] = {
        id: crypto.randomUUID(),
        boardId: boardSessionIdRef.current,
        userId: OWNER_USER_ID,
        point,
        radius,
        affectedStrokeIds,
        createdAt: now,
      };
      if (point.inputSource) {
        eraseInput.inputSource = point.inputSource;
      }
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
          createdAt: now,
        }),
        type: "erase.committed",
        eraseAction: createEraseAction(eraseInput),
      });
      return affectedStrokeIds;
    },
    [applyLocalEvent],
  );

  const moveCursorPoint = useCallback(
    (input: {
      point: Pick<StrokePoint, "x" | "y">;
      mode: CursorState["mode"];
      inputSource?: CursorState["inputSource"];
    }) => {
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "cursor.moved",
        cursor: {
          participantId: PARTICIPANT_ID,
          x: input.point.x,
          y: input.point.y,
          mode: input.mode,
          ...(input.inputSource ? { inputSource: input.inputSource } : {}),
          updatedAt: new Date().toISOString(),
        },
      });
    },
    [applyLocalEvent],
  );

  const moveCursor = useCallback(
    (result: GestureResult) => {
      moveCursorPoint({
        point: result.cursorPoint,
        mode: result.mode,
        inputSource: result.diagnostics?.inputSource,
      });
    },
    [moveCursorPoint],
  );

  const updateAnnotationObject = useCallback(
    (strokeId: string, annotation: StrokeAnnotation) => {
      const points = buildAnnotationPoints(annotation, performance.now());
      if (points.length === 0) {
        return;
      }

      const previousAnnotation = boardRef.current.strokes[strokeId]?.annotation;
      const connectorUpdates = previousAnnotation
        ? getBoundConnectorUpdates({
            boardState: boardRef.current,
            nodeStrokeId: strokeId,
            previousAnnotation,
            nextAnnotation: annotation,
          })
        : [];

      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "stroke.annotation_updated",
        strokeId,
        annotation,
        points,
      });

      for (const connectorUpdate of connectorUpdates) {
        applyLocalEvent({
          ...createEventEnvelope({
            boardSessionId: boardSessionIdRef.current,
            actorParticipantId: PARTICIPANT_ID,
          }),
          type: "stroke.annotation_updated",
          strokeId: connectorUpdate.strokeId,
          annotation: connectorUpdate.annotation,
          points: buildAnnotationPoints(connectorUpdate.annotation, performance.now()),
        });
      }
    },
    [applyLocalEvent],
  );

  const selectAnnotationObject = useCallback((strokeId: string | null) => {
    setEditingAnnotationId(null);
    setSelectedAnnotationId(strokeId);
    setSelectedAnnotationIds(strokeId ? [strokeId] : []);
    if (!strokeId) {
      setLabelDraft("");
      return;
    }

    const annotation = boardRef.current.strokes[strokeId]?.annotation;
    setLabelDraft(annotation?.label ?? "");
  }, []);

  const toggleAnnotationObject = useCallback((strokeId: string) => {
    setEditingAnnotationId(null);
    setSelectedAnnotationIds((current) => {
      const next = current.includes(strokeId)
        ? current.filter((candidate) => candidate !== strokeId)
        : [...current, strokeId];
      const primary = next[next.length - 1] ?? null;
      setSelectedAnnotationId(primary);
      setLabelDraft(primary ? (boardRef.current.strokes[primary]?.annotation?.label ?? "") : "");
      return next;
    });
  }, []);

  const createPlacementObject = useCallback(
    (
      tool: ObjectDockTool,
      start: AnnotationPoint,
      end?: AnnotationPoint,
    ): GestureAnnotationResult | null =>
      createObjectFromPlacement({
        tool,
        start,
        ...(end ? { end } : {}),
        boardState: boardRef.current,
        color: strokeColor,
        autoSnapConnectors,
      }),
    [autoSnapConnectors, strokeColor],
  );

  const updatePlacementGhost = useCallback(
    (tool: ObjectDockTool, start: AnnotationPoint, end?: AnnotationPoint) => {
      const object = createPlacementObject(tool, start, end);
      const snapped = object?.annotation.bounds
        ? snapAnnotationToBoard({
            annotation: object.annotation,
            boardState: boardRef.current,
          })
        : null;
      const annotation = snapped?.annotation ?? object?.annotation;
      if (snapped) {
        setAlignmentGuides(snapped.guides);
      } else {
        setAlignmentGuides([]);
      }
      setGhostAnnotation(
        object && annotation
          ? {
              annotation,
              points: buildAnnotationPoints(annotation, performance.now()),
              color: object.color,
              thickness: object.thickness,
            }
          : null,
      );
      setLastGestureIntent(object ? { intent: object.intent, confidence: object.confidence } : null);
    },
    [createPlacementObject],
  );

  const createCommittedAnnotation = useCallback(
    (annotationResult: GestureAnnotationResult): string | null => {
      const firstPoint = annotationResult.points[0];
      if (!firstPoint) {
        return null;
      }

      const now = new Date().toISOString();
      const stroke = createStroke({
        id: crypto.randomUUID(),
        boardId: boardSessionIdRef.current,
        userId: OWNER_USER_ID,
        point: firstPoint,
        color: annotationResult.color,
        thickness: annotationResult.thickness,
        inputSource: firstPoint.inputSource ?? "air_gesture",
        annotation: annotationResult.annotation,
        createdAt: now,
      });

      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
          createdAt: now,
        }),
        type: "stroke.started",
        stroke,
      });
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
          createdAt: now,
        }),
        type: "stroke.committed",
        strokeId: stroke.id,
        points: annotationResult.points,
        cleanupApplied: true,
        lineSnapApplied:
          annotationResult.intent === "arrow" || annotationResult.intent === "connector",
      });

      undoStackRef.current.push({
        type: "stroke",
        strokeId: stroke.id,
      });
      setLastGestureIntent({
        intent: annotationResult.intent,
        confidence: annotationResult.confidence,
      });

      // Never auto-open the label editor: the augmented path is to hold the
      // element and say "rename to …" (double-click/F2 still open typing).
      setLabelDraft("");
      setEditingAnnotationId(null);
      if (annotationResult.needsLabel) {
        setCommandFeedback(
          "Placed. Hold it and say “rename to …”, or double-click to type a label.",
        );
      }
      setSelectedAnnotationId(stroke.id);
      setSelectedAnnotationIds([stroke.id]);
      return stroke.id;
    },
    [applyLocalEvent],
  );

  const commitPlacementObject = useCallback(
    (tool: ObjectDockTool, start: AnnotationPoint, end?: AnnotationPoint) => {
      const object = createPlacementObject(tool, start, end);
      if (!object) {
        setGhostAnnotation(null);
        setGhostAnnotations([]);
        setAlignmentGuides([]);
        return;
      }

      const snapped = object.annotation.bounds
        ? snapAnnotationToBoard({
            annotation: object.annotation,
            boardState: boardRef.current,
          })
        : null;
      const annotation = snapped?.annotation ?? object.annotation;
      createCommittedAnnotation({
        ...object,
        annotation,
        points: buildAnnotationPoints(annotation, performance.now()),
      });
      setGhostAnnotation(null);
      setGhostAnnotations([]);
      setAlignmentGuides([]);
      setActiveObjectTool("select");
    },
    [createCommittedAnnotation, createPlacementObject],
  );

  const commitActiveEraseInteraction = useCallback(() => {
    const strokeIds = [...activeEraseAffectedStrokeIdsRef.current];
    if (strokeIds.length > 0) {
      undoStackRef.current.push({
        type: "erase",
        strokeIds,
      });
    }
    activeEraseAffectedStrokeIdsRef.current = new Set();
  }, []);

  const beginObjectInteraction = useCallback(
    (
      point: AnnotationPoint,
      options: {
        inputSource?: CursorState["inputSource"];
        preferSelected?: boolean;
        forcedStrokeId?: string;
        forcedHandle?: AnnotationResizeHandle;
        placementTool?: ObjectDockTool;
        catalogCarry?: {
          pickupScreenPoint: { x: number; y: number };
          catalogBounds: {
            left: number;
            top: number;
            right: number;
            bottom: number;
          };
        };
      } = {},
    ) => {
      lastGesturePointerRef.current = point;
      objectInteractionInitialStateRef.current = null;
      const inputSource = options.inputSource ?? "pointer";

      const placementTool = options.placementTool ?? activeObjectTool;
      if (isPlacementTool(placementTool)) {
        objectInteractionRef.current = options.catalogCarry
          ? {
              mode: "catalog_carrying",
              tool: placementTool,
              point,
              pickupScreenPoint: options.catalogCarry.pickupScreenPoint,
              catalogBounds: options.catalogCarry.catalogBounds,
              enteredCanvas: false,
            }
          : {
              mode: "placing",
              tool: placementTool,
              start: point,
            };
        updatePlacementGhost(placementTool, point, point);
        selectAnnotationObject(null);
        setObjectGestureState("grab");
        return;
      }

      if (activeObjectTool === "eraser") {
        const eraserPoint = makePoint(point.x, point.y);
        eraserPoint.inputSource = inputSource;
        pointerErasingRef.current = true;
        activeEraseAffectedStrokeIdsRef.current = new Set(eraseAt(eraserPoint, ERASER_RADIUS));
        selectAnnotationObject(null);
        setObjectGestureState("erase");
        return;
      }

      const interactionSelectionId =
        options.forcedHandle && options.forcedStrokeId
          ? options.forcedStrokeId
          : selectedAnnotationId;
      const selectedStroke = interactionSelectionId
        ? boardRef.current.strokes[interactionSelectionId]
        : undefined;
      const handle = resolveResizeHandleForInput(
        inputSource,
        options.forcedHandle,
        selectedStroke?.annotation
          ? getAnnotationHandleAtPoint(selectedStroke.annotation, point)
          : null,
      );
      if (selectedStroke?.annotation && handle) {
        objectInteractionInitialStateRef.current = boardRef.current;
        objectInteractionRef.current = {
          mode: "resizing",
          strokeId: selectedStroke.id,
          handle,
          initialAnnotation: selectedStroke.annotation,
        };
        setObjectGestureState("grab");
        return;
      }

      if (options.preferSelected && selectedStroke?.annotation) {
        objectInteractionInitialStateRef.current = boardRef.current;
        objectInteractionRef.current = {
          mode: "moving",
          strokeId: selectedStroke.id,
          start: point,
          initialAnnotation: selectedStroke.annotation,
        };
        setHoverStrokeId(selectedStroke.id);
        setObjectGestureState("grab");
        return;
      }

      const hitStroke = options.forcedStrokeId
        ? boardRef.current.strokes[options.forcedStrokeId]
        : findAnnotationObjectAtPoint(boardRef.current, point);
      if (hitStroke?.annotation) {
        objectInteractionInitialStateRef.current = boardRef.current;
        selectAnnotationObject(hitStroke.id);
        setHoverStrokeId(hitStroke.id);
        objectInteractionRef.current = {
          mode: "moving",
          strokeId: hitStroke.id,
          start: point,
          initialAnnotation: hitStroke.annotation,
        };
        setObjectGestureState("grab");
        return;
      }

      selectAnnotationObject(null);
      setHoverStrokeId(null);
      setObjectGestureState("hover");
    },
    [
      activeObjectTool,
      eraseAt,
      makePoint,
      selectAnnotationObject,
      selectedAnnotationId,
      updatePlacementGhost,
    ],
  );

  const moveObjectInteraction = useCallback(
    (
      point: AnnotationPoint,
      options: {
        inputSource?: CursorState["inputSource"];
      } = {},
    ) => {
      lastGesturePointerRef.current = point;
      const inputSource = options.inputSource ?? "pointer";

      if (pointerErasingRef.current) {
        const eraserPoint = makePoint(point.x, point.y);
        eraserPoint.inputSource = inputSource;
        const affectedStrokeIds = eraseAt(eraserPoint, ERASER_RADIUS);
        affectedStrokeIds.forEach((strokeId) =>
          activeEraseAffectedStrokeIdsRef.current.add(strokeId),
        );
        return;
      }

      const interaction = objectInteractionRef.current;
      if (interaction?.mode === "catalog_carrying") {
        interaction.point = point;
        updatePlacementGhost(interaction.tool, point, point);
        return;
      }

      if (interaction?.mode === "placing") {
        updatePlacementGhost(interaction.tool, interaction.start, point);
        return;
      }

      if (interaction?.mode === "moving") {
        const translated = translateAnnotation(
          interaction.initialAnnotation,
          point.x - interaction.start.x,
          point.y - interaction.start.y,
        );
        const snapped = snapAnnotationToBoard({
          annotation: translated,
          boardState: boardRef.current,
          excludeStrokeId: interaction.strokeId,
          // Hand tracking jitters far more than a pointer: give air-gesture
          // drags a wider capture radius, kept screen-consistent under zoom.
          thresholdPx:
            (inputSource === "air_gesture" ? 22 : 9) / boardViewportRef.current.scale,
        });
        setAlignmentGuides(snapped.guides);
        updateAnnotationObject(
          interaction.strokeId,
          snapped.annotation,
        );
        return;
      }

      if (interaction?.mode === "resizing") {
        const annotation =
          interaction.handle === "start" || interaction.handle === "end"
            ? updateLineEndpoint({
                annotation: interaction.initialAnnotation,
                endpoint: interaction.handle,
                point,
                boardState: boardRef.current,
                autoSnapConnectors,
              })
            : resizeBoundsAnnotation(interaction.initialAnnotation, interaction.handle, point);
        updateAnnotationObject(interaction.strokeId, annotation);
        return;
      }

      if (isPlacementTool(activeObjectTool)) {
        updatePlacementGhost(activeObjectTool, point, point);
        setHoverStrokeId(null);
        return;
      }

      setHoverStrokeId(findAnnotationObjectAtPoint(boardRef.current, point)?.id ?? null);
    },
    [
      activeObjectTool,
      autoSnapConnectors,
      eraseAt,
      makePoint,
      updateAnnotationObject,
      updatePlacementGhost,
    ],
  );

  const endObjectInteraction = useCallback(
    (point: AnnotationPoint) => {
      if (pointerErasingRef.current) {
        commitActiveEraseInteraction();
        pointerErasingRef.current = false;
        setObjectGestureState("hover");
        return;
      }

      const interaction = objectInteractionRef.current;
      if (interaction?.mode === "placing") {
        commitPlacementObject(interaction.tool, interaction.start, point);
      } else if (interaction?.mode === "catalog_carrying") {
        commitPlacementObject(interaction.tool, point);
      } else if (interaction?.mode === "moving" || interaction?.mode === "resizing") {
        const initialState = objectInteractionInitialStateRef.current;
        const undoEvents = initialState
          ? createAnnotationRestoreEvents(boardSessionIdRef.current, initialState, boardRef.current)
          : [];
        if (undoEvents.length > 0) {
          undoStackRef.current.push({
            type: "diagram",
            undoEvents,
            selectionBefore: selectedAnnotationIds,
          });
        }
      }

      objectInteractionRef.current = null;
      objectInteractionInitialStateRef.current = null;
      cameraPlacementActiveRef.current = false;
      cameraPlacementArmedToolRef.current = null;
      setAlignmentGuides([]);
      setObjectGestureState("hover");
    },
    [commitActiveEraseInteraction, commitPlacementObject, selectedAnnotationIds],
  );

  const cancelObjectInteraction = useCallback(() => {
    if (objectInteractionInitialStateRef.current) {
      boardRef.current = objectInteractionInitialStateRef.current;
      render();
      updateStats();
    }
    objectInteractionRef.current = null;
    objectInteractionInitialStateRef.current = null;
    cameraPlacementActiveRef.current = false;
    cameraPlacementArmedToolRef.current = null;
    cameraGrabActiveRef.current = false;
    pointerErasingRef.current = false;
    activeEraseAffectedStrokeIdsRef.current = new Set();
    setGhostAnnotation(null);
    setGhostAnnotations([]);
    setAlignmentGuides([]);
    setActiveObjectTool("select");
    setLastGestureIntent({ intent: "cancel", confidence: 0 });
  }, [render, updateStats]);

  const saveAnnotationLabel = useCallback(() => {
    if (!selectedAnnotationId) {
      return;
    }

    applyLocalEvent({
      ...createEventEnvelope({
        boardSessionId: boardSessionIdRef.current,
        actorParticipantId: PARTICIPANT_ID,
      }),
      type: "stroke.label_updated",
      strokeId: selectedAnnotationId,
      label: labelDraft.trim(),
    });
    setEditingAnnotationId(null);
  }, [applyLocalEvent, labelDraft, selectedAnnotationId]);

  const dismissAnnotationLabelEditor = useCallback(() => {
    setEditingAnnotationId(null);
    const annotation = selectedAnnotationId
      ? boardRef.current.strokes[selectedAnnotationId]?.annotation
      : undefined;
    setLabelDraft(annotation?.label ?? "");
  }, [selectedAnnotationId]);

  const cancelCatalogClose = useCallback(() => {
    if (catalogCloseTimerRef.current !== null) {
      clearTimeout(catalogCloseTimerRef.current);
      catalogCloseTimerRef.current = null;
    }
  }, []);

  const scheduleCatalogClose = useCallback(() => {
    if (catalogCloseTimerRef.current !== null) {
      return;
    }
    catalogCloseTimerRef.current = setTimeout(() => {
      catalogCloseTimerRef.current = null;
      openCatalogIdRef.current = null;
      dockGestureHoverRef.current = null;
      setOpenCatalogId(null);
      setDockGestureHover(null);
    }, 520);
  }, []);

  useEffect(
    () => () => {
      if (catalogCloseTimerRef.current !== null) {
        clearTimeout(catalogCloseTimerRef.current);
      }
    },
    [],
  );

  /**
   * Screen-space hit test of the air cursor against the catalog dock.
   * Category triggers are hover-only and open immediately. A concrete control
   * activates only on a confirmed close edge while the cursor is already over
   * it. The padded nearest-center target keeps the small icon rail forgiving
   * without turning a held hand into a sweep-to-select gesture.
   */
  const handleDockGesture = useCallback(
    (
      screenPoint: { x: number; y: number },
      pinchPhase: DockGesturePinchPhase,
    ): DockGestureOutcome | null => {
      const dock = dockRef.current;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!dock || !canvasRect) {
        return null;
      }
      const x = screenPoint.x + canvasRect.left;
      const y = screenPoint.y + canvasRect.top;
      const hitPadding = 18;
      const activationPadding = 8;
      const candidates: {
        id: string;
        element: HTMLButtonElement;
        bounds: { left: number; top: number; width: number; height: number };
        disabled: boolean;
      }[] = [];
      for (const element of dock.querySelectorAll<HTMLButtonElement>("[data-dock-id]")) {
        const rect = element.getBoundingClientRect();
        candidates.push({
          id: element.dataset.dockId ?? "",
          element,
          disabled: element.disabled,
          bounds: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        });
      }
      const hoveredId = chooseDockGestureTarget({ x, y }, candidates, hitPadding);
      const preciseTargetId = chooseDockGestureTarget(
        { x, y },
        candidates,
        activationPadding,
      );
      const hovered = candidates.find((candidate) => candidate.id === hoveredId) ?? null;
      dockGestureHoverRef.current = hovered?.id ?? null;
      setDockGestureHover((current) => (current === (hovered?.id ?? null) ? current : hovered?.id ?? null));
      if (!hovered) {
        scheduleCatalogClose();
        dockGestureActivationTrackerRef.current!.update(null, pinchPhase);
        return null;
      }
      cancelCatalogClose();
      const hoveredCatalogId = catalogIdForDockGestureHover(hovered.id);
      if (hoveredCatalogId) {
        const preciseCatalogId = catalogIdForDockGestureHover(preciseTargetId);
        const currentCatalogId = openCatalogIdRef.current;
        // First entry opens immediately. Once a category is open, overlapping
        // padded hit areas cannot switch it until the cursor is truly inside
        // the next trigger's visible bounds.
        if (
          !currentCatalogId ||
          currentCatalogId === hoveredCatalogId ||
          preciseCatalogId === hoveredCatalogId
        ) {
          openCatalogIdRef.current = hoveredCatalogId;
          setOpenCatalogId((current) =>
            current === hoveredCatalogId ? current : hoveredCatalogId,
          );
        }
      }
      const activatedId = dockGestureActivationTrackerRef.current!.update(
        preciseTargetId,
        pinchPhase,
      );
      if (activatedId) {
        const activated =
          candidates.find((candidate) => candidate.id === activatedId) ?? null;
        if (!activated) {
          return { type: "hover", targetId: hovered.id };
        }
        // Reuse the click behavior exactly — one code path for mouse and hand.
        activated.element.click();
        const left = Math.min(...candidates.map((candidate) => candidate.bounds.left));
        const top = Math.min(...candidates.map((candidate) => candidate.bounds.top));
        const right = Math.max(
          ...candidates.map((candidate) => candidate.bounds.left + candidate.bounds.width),
        );
        const bottom = Math.max(
          ...candidates.map((candidate) => candidate.bounds.top + candidate.bounds.height),
        );
        return {
          type: "activated",
          targetId: activatedId,
          catalogBounds: {
            left: left - canvasRect.left,
            top: top - canvasRect.top,
            right: right - canvasRect.left,
            bottom: bottom - canvasRect.top,
          },
        };
      }
      return { type: "hover", targetId: hovered.id };
    },
    [cancelCatalogClose, scheduleCatalogClose],
  );

  const setDiagramVisibility = useCallback(
    (visible: boolean, _source: "snap" | "keyboard" | "voice" | "menu" | "test") => {
      if (diagramVisibleRef.current === visible) return;

      if (!visible) {
        const activeStrokeId = activeStrokeIdRef.current;
        if (activeStrokeId) {
          commitStroke(activeStrokeId, { discard: true });
          activeStrokeIdRef.current = null;
        }
        pointerStrokeIdRef.current = null;
        gesturePathRef.current = [];
        touchpadPointsRef.current = [];
        cancelObjectInteraction();
        setSelectedAnnotationId(null);
        setSelectedAnnotationIds([]);
        setHoverStrokeId(null);
        setGhostAnnotation(null);
        setGhostAnnotations([]);
        setAlignmentGuides([]);
        setEditingAnnotationId(null);
        setOpenCatalogId(null);
        semanticIntentRequestIdRef.current += 1;
        pendingIntentRef.current = null;
        applyPendingIntentRef.current = null;
        setPendingIntent(null);
        voiceRouter.reset();
        setVoiceGate(null);
        palmVoiceGestureTrackerRef.current!.reset();
        undoGestureTrackerRef.current!.reset();
        hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
        hybridPinchClosedRef.current = false;
      }

      diagramVisibleRef.current = visible;
      setDiagramVisible(visible);
      if (headlessMeetOverlay && cameraOverlay) {
        setCameraOverlayEnabled(visible);
        if (visible) {
          cameraOverlay.start();
        } else {
          cameraOverlay.stop();
        }
      }
      setCommandFeedback(
        visible
          ? "Diagram visible. Board editing is active."
          : "Diagram hidden. Camera or shared screen remains live; snap again or press Shift+H to restore it.",
      );
    },
    [
      cameraOverlay,
      cancelObjectInteraction,
      commitStroke,
      headlessMeetOverlay,
      voiceRouter,
    ],
  );

  const processSnapGestureFrame = useCallback(
    (frame: SnapGestureFrame): SnapGestureTrackerResult => {
      const voiceSnapshot = voiceRouter.snapshot;
      const result = snapGestureTrackerRef.current!.update({
        ...frame,
        // Visibility remains available while the global voice pose is idle;
        // only a scoped object voice edit is exclusive.
        suppressed:
          frame.suppressed ||
          Boolean(voiceSnapshot?.mode === "scoped" && voiceSnapshot.open),
      });
      if (result === "snap") {
        setDiagramVisibility(!diagramVisibleRef.current, "snap");
        setLastGestureIntent({ intent: "visibility", confidence: 1 });
      }
      return result;
    },
    [setDiagramVisibility, voiceRouter],
  );

  const handleGesture = useCallback(
    (result: GestureResult | null, hybridOutput?: HybridGestureControllerOutput) => {
      setGestureResult(result);

      if (inputPaused) {
        hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
        hybridPinchClosedRef.current = false;
        const lastPoint = lastGesturePointerRef.current;
        if (cameraPlacementActiveRef.current) {
          cancelObjectInteraction();
          cameraPlacementActiveRef.current = false;
          cameraGrabActiveRef.current = false;
        } else if (cameraGrabActiveRef.current && lastPoint) {
          endObjectInteraction(lastPoint);
          cameraGrabActiveRef.current = false;
        }
        setObjectGestureState("hover");
        return;
      }

      if (inputMode === "gesture") {
        if (hybridOutput) {
          const screenPoint = hybridOutput.cursor;
          const point = screenPoint ? toBoardPoint(screenPoint) : null;
          const action = hybridOutput.action;
          const pinchClosed = hybridOutput.pinchState === "closed";
          const pinchJustClosed = pinchClosed && !hybridPinchClosedRef.current;
          hybridPinchClosedRef.current = pinchClosed;

          // The catalog owns the stream only while no board/carry interaction
          // is active. Hover reveals a category; a confirmed close edge on a
          // concrete shape starts one uninterrupted carry.
          if (
            !screenPoint &&
            !cameraPlacementActiveRef.current &&
            !cameraGrabActiveRef.current
          ) {
            scheduleCatalogClose();
          }
          const dockOutcome =
            screenPoint &&
            !cameraPlacementActiveRef.current &&
            !cameraGrabActiveRef.current &&
            !pointerErasingRef.current
              ? handleDockGesture(screenPoint, hybridOutput.pinchState)
            : null;
          if (dockOutcome) {
            const placementTool =
              dockOutcome.type === "activated"
                ? placementToolFromDockTarget(dockOutcome.targetId)
                : null;
            if (
              placementTool &&
              point &&
              screenPoint &&
              dockOutcome.type === "activated"
            ) {
              cameraPlacementArmedToolRef.current = null;
              cameraPlacementActiveRef.current = true;
              cameraGrabActiveRef.current = true;
              hybridPinchClosedRef.current = true;
              cancelCatalogClose();
              openCatalogIdRef.current = null;
              dockGestureHoverRef.current = null;
              setOpenCatalogId(null);
              setDockGestureHover(null);
              beginObjectInteraction(point, {
                inputSource: "air_gesture",
                placementTool,
                catalogCarry: {
                  pickupScreenPoint: screenPoint,
                  catalogBounds: dockOutcome.catalogBounds,
                },
              });
              setCommandFeedback(
                `Holding ${objectToolLabel(placementTool)}. Drag it onto the diagram, then open your hand to place.`,
              );
              setObjectGestureState("placing");
              return;
            }
            if (dockOutcome.type === "activated") {
              hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
              hybridPinchClosedRef.current = true;
            }
            setObjectGestureState("hover");
            return;
          }

          if (action?.type === "grab_cancelled") {
            const interaction = objectInteractionRef.current;
            if (interaction?.mode === "moving" || interaction?.mode === "resizing") {
              updateAnnotationObject(interaction.strokeId, interaction.initialAnnotation);
            }
            cameraGrabActiveRef.current = false;
            cancelObjectInteraction();
            setObjectGestureState("hover");
            return;
          }

          if (hybridOutput.trackingState !== "tracked" && !action) {
            if (hybridOutput.trackingState === "lost") {
              if (cameraPlacementActiveRef.current) {
                cancelObjectInteraction();
                cameraPlacementActiveRef.current = false;
                cameraGrabActiveRef.current = false;
              }
              setHoverStrokeId(null);
              setObjectGestureState("hover");
            }
            return;
          }

          if (!point) {
            if (hybridOutput.trackingState === "lost") {
              setHoverStrokeId(null);
            }
            return;
          }

          lastGesturePointerRef.current = point;
          moveCursorPoint({
            point,
            mode: action && action.type !== "grab_ended" ? "writing" : "marker_hover",
            inputSource: "air_gesture",
          });

          if (pendingIntentRef.current && pinchJustClosed) {
            // Commands commit instantly, so a pending plan is only ever a
            // momentary in-flight state. Closing the hand commits it directly —
            // no confirmation gate. Undo remains the safety net.
            applyPendingIntentRef.current?.();
            hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
            hybridPinchClosedRef.current = true;
            setObjectGestureState("hover");
            return;
          }

          if (cameraPlacementActiveRef.current) {
            const catalogCarry =
              objectInteractionRef.current?.mode === "catalog_carrying"
                ? objectInteractionRef.current
                : null;
            let catalogDropPointValid = catalogCarry === null;
            if (catalogCarry && screenPoint) {
              const outsideCatalog =
                screenPoint.x < catalogCarry.catalogBounds.left - CATALOG_DROP_EXIT_PX ||
                screenPoint.x > catalogCarry.catalogBounds.right + CATALOG_DROP_EXIT_PX ||
                screenPoint.y < catalogCarry.catalogBounds.top - CATALOG_DROP_EXIT_PX ||
                screenPoint.y > catalogCarry.catalogBounds.bottom + CATALOG_DROP_EXIT_PX;
              const canvasRect = canvasRef.current?.getBoundingClientRect();
              catalogDropPointValid =
                outsideCatalog &&
                Boolean(
                  canvasRect &&
                    screenPoint.x >= CATALOG_DROP_EXIT_PX &&
                    screenPoint.x <= canvasRect.width - CATALOG_DROP_EXIT_PX &&
                    screenPoint.y >= CATALOG_DROP_EXIT_PX &&
                    screenPoint.y <= canvasRect.height - CATALOG_DROP_EXIT_PX,
                );
              const traveled =
                Math.hypot(
                  screenPoint.x - catalogCarry.pickupScreenPoint.x,
                  screenPoint.y - catalogCarry.pickupScreenPoint.y,
                ) >= CATALOG_DROP_MIN_TRAVEL_PX;
              if (outsideCatalog && traveled) {
                catalogCarry.enteredCanvas = true;
              }
            }
            if (hybridOutput.pinchState === "open") {
              const placementTool = objectInteractionRef.current?.mode === "placing"
                ? objectInteractionRef.current.tool
                : objectInteractionRef.current?.mode === "catalog_carrying"
                  ? objectInteractionRef.current.tool
                : activeObjectTool;
              if (
                catalogCarry &&
                (!catalogCarry.enteredCanvas || !catalogDropPointValid)
              ) {
                cancelObjectInteraction();
                setCommandFeedback(
                  `${objectToolLabel(placementTool)} returned to the catalog. Drag it onto the diagram before releasing.`,
                );
              } else {
                endObjectInteraction(point);
                setCommandFeedback(
                  `${objectToolLabel(placementTool)} placed. Close your hand over it to move it again.`,
                );
              }
              cameraPlacementActiveRef.current = false;
              cameraGrabActiveRef.current = false;
              setObjectGestureState("hover");
            } else {
              moveObjectInteraction(point, { inputSource: "air_gesture" });
              setObjectGestureState("placing");
            }
            return;
          }

          const armedPlacementTool = cameraPlacementArmedToolRef.current;
          const placementTool =
            armedPlacementTool ?? (isPlacementTool(activeObjectTool) ? activeObjectTool : null);
          if (placementTool && pinchClosed && (pinchJustClosed || Boolean(armedPlacementTool))) {
            cameraPlacementArmedToolRef.current = null;
            cameraPlacementActiveRef.current = true;
            cameraGrabActiveRef.current = true;
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              placementTool,
            });
            setCommandFeedback(
              `Holding ${objectToolLabel(placementTool)}. Move your closed hand, then open it to place.`,
            );
            setObjectGestureState("placing");
            return;
          }

          if (action?.type === "grab_started") {
            cameraGrabActiveRef.current = true;
            if (activeObjectTool === "eraser") {
              beginObjectInteraction(point, {
                inputSource: "air_gesture",
                forcedStrokeId: action.targetId,
              });
              setObjectGestureState("erase");
              setCommandFeedback(
                "Erase locked — sweep the closed hand across targets, then reopen to finish.",
              );
              return;
            }
            selectAnnotationObject(action.targetId);
            setHoverStrokeId(action.targetId);
            setObjectGestureState("grab");
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              forcedStrokeId: action.targetId,
            });
            setCommandFeedback("Move locked — keep your hand closed, then reopen to drop.");
            return;
          }

          if (action?.type === "drag_moved") {
            cameraGrabActiveRef.current = true;
            setObjectGestureState(pointerErasingRef.current ? "erase" : "grab");
            moveObjectInteraction(point, { inputSource: "air_gesture" });
            return;
          }

          if (action?.type === "grab_ended") {
            const erased = pointerErasingRef.current;
            endObjectInteraction(point);
            cameraGrabActiveRef.current = false;
            setObjectGestureState("hover");
            setCommandFeedback(
              erased
                ? "Erase complete. Select another tool before closing over an object."
                : "Move complete. Camera gestures never resize objects.",
            );
            return;
          }

          setHoverStrokeId(hybridOutput.focusedTargetId);
          setObjectGestureState(
            hybridOutput.pinchState === "closed" && !hybridOutput.focusedTargetId
              ? "no target"
              : "hover",
          );
          return;
        }

        if (!result) {
          const lastPoint = lastGesturePointerRef.current;
          if (objectInteractionRef.current?.mode === "catalog_carrying") {
            cancelObjectInteraction();
            cameraPlacementActiveRef.current = false;
            cameraGrabActiveRef.current = false;
            setCommandFeedback("Catalog placement cancelled.");
            setObjectGestureState("hover");
            return;
          }
          if (cameraGrabActiveRef.current && lastPoint) {
            endObjectInteraction(lastPoint);
            cameraGrabActiveRef.current = false;
            setObjectGestureState("hover");
          }
          return;
        }

        const point = toBoardPoint({
          x: result.cursorPoint.x,
          y: result.cursorPoint.y,
        });
        lastGesturePointerRef.current = point;

        const markerHeld = isObjectGestureHeld(result);
        const markerGrabStart = isObjectGestureGrabStart(result);

        if (result.shouldCommitStroke && cameraGrabActiveRef.current) {
          endObjectInteraction(point);
          cameraGrabActiveRef.current = false;
          setObjectGestureState("hover");
          return;
        }

        if (result.mode === "paused" || result.mode === "idle") {
          if (cameraGrabActiveRef.current) {
            endObjectInteraction(point);
            cameraGrabActiveRef.current = false;
            setObjectGestureState("hover");
          }
          return;
        }

        if (result.mode === "erasing") {
          if (cameraGrabActiveRef.current) {
            endObjectInteraction(point);
            cameraGrabActiveRef.current = false;
          }
          setObjectGestureState("erase");
          moveCursorPoint({
            point,
            mode: "erasing",
            inputSource: result.diagnostics?.inputSource,
          });
          const eraserPoint = makePoint(point.x, point.y, result.confidence);
          eraserPoint.inputSource = "air_gesture";
          eraseAt(eraserPoint);
          return;
        }

        if (cameraGrabActiveRef.current && !markerHeld) {
          endObjectInteraction(point);
          cameraGrabActiveRef.current = false;
          setObjectGestureState("hover");
          moveCursorPoint({
            point,
            mode: result.mode,
            inputSource: result.diagnostics?.inputSource,
          });
          moveObjectInteraction(point, { inputSource: "air_gesture" });
          return;
        }

        if (markerGrabStart || cameraGrabActiveRef.current) {
          cameraGrabActiveRef.current = true;
          setObjectGestureState("grab");
          moveCursorPoint({
            point,
            mode: "writing",
            inputSource: result.diagnostics?.inputSource,
          });
          if (!objectInteractionRef.current && !pointerErasingRef.current) {
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              preferSelected: true,
            });
          } else {
            moveObjectInteraction(point, { inputSource: "air_gesture" });
          }
          return;
        }

        setObjectGestureState("hover");
        moveCursorPoint({
          point,
          mode: result.mode,
          inputSource: result.diagnostics?.inputSource,
        });
        moveObjectInteraction(point, { inputSource: "air_gesture" });
        return;
      }

      if (!result) {
        commitStroke(activeStrokeIdRef.current);
        activeStrokeIdRef.current = null;
        return;
      }

      if (result.shouldCommitStroke) {
        const commitOptions: CommitStrokeOptions = {};
        const cleanedPoints = result.cleanedStrokePoints?.map(makeFrictionPoint);
        if (cleanedPoints) {
          commitOptions.points = cleanedPoints;
        }
        if (result.shouldDiscardStroke !== undefined) {
          commitOptions.discard = result.shouldDiscardStroke;
        }
        if (result.cleanupApplied !== undefined) {
          commitOptions.cleanupApplied = result.cleanupApplied;
        }
        if (result.lineSnapApplied !== undefined) {
          commitOptions.lineSnapApplied = result.lineSnapApplied;
        }
        if (result.frictionPreset) {
          commitOptions.frictionProfile = result.frictionPreset;
        }
        commitStroke(activeStrokeIdRef.current, commitOptions);
        activeStrokeIdRef.current = null;
      }

      if (result.mode === "paused" || result.mode === "idle") {
        return;
      }

      moveCursor(result);

      if (result.mode === "erasing") {
        eraseAt(makePoint(result.cursorPoint.x, result.cursorPoint.y, result.confidence));
        return;
      }

      if (result.shouldDraw && result.strokePoint) {
        const point = makeFrictionPoint(result.strokePoint);
        if (!activeStrokeIdRef.current) {
          startStroke(point);
        } else {
          appendStrokePoint(activeStrokeIdRef.current, point);
        }
        return;
      }

    },
    [
      appendStrokePoint,
      beginObjectInteraction,
      activeObjectTool,
      cancelCatalogClose,
      cancelObjectInteraction,
      commitStroke,
      endObjectInteraction,
      eraseAt,
      handleDockGesture,
      inputMode,
      inputPaused,
      makeFrictionPoint,
      makePoint,
      moveObjectInteraction,
      moveCursor,
      moveCursorPoint,
      scheduleCatalogClose,
      startStroke,
      toBoardPoint,
      updateAnnotationObject,
    ],
  );

  const commitTouchpadStroke = useCallback(() => {
    const strokeId = pointerStrokeIdRef.current;
    if (!strokeId) {
      return;
    }

    const finalized = finalizeTouchpadStroke({
      points: touchpadPointsRef.current,
      config: touchpadConfig,
      straightLine: straightLineActiveRef.current,
    });

    commitStroke(strokeId, {
      points: finalized.points,
      discard: finalized.discard,
      cleanupApplied: finalized.cleanupApplied,
      lineSnapApplied: finalized.lineSnapApplied,
      frictionProfile: touchpadVariant === "precision" ? "stable" : "balanced",
    });

    if (!finalized.discard) {
      undoStackRef.current.push({
        type: "stroke",
        strokeId,
      });
    }

    pointerStrokeIdRef.current = null;
    activeStrokeIdRef.current = null;
    touchpadPointsRef.current = [];
    lastTouchpadPointRef.current = null;
  }, [commitStroke, touchpadConfig, touchpadVariant]);

  const commitTouchpadErase = useCallback(() => {
    const strokeIds = [...activeEraseAffectedStrokeIdsRef.current];
    if (strokeIds.length > 0) {
      undoStackRef.current.push({
        type: "erase",
        strokeIds,
      });
    }
    activeEraseAffectedStrokeIdsRef.current = new Set();
  }, []);

  const endActiveTouchpadInteraction = useCallback(
    (nextState: TouchpadInputState = "HOVER") => {
      if (pointerStrokeIdRef.current) {
        commitTouchpadStroke();
      }
      if (pointerErasingRef.current) {
        commitTouchpadErase();
      }
      pointerErasingRef.current = false;
      activePointerIdRef.current = null;
      touchpadPointsRef.current = [];
      lastTouchpadPointRef.current = null;
      setTouchpadState(inputPaused ? "PAUSED" : nextState);
    },
    [commitTouchpadErase, commitTouchpadStroke, inputPaused],
  );

  const undoLastAction = useCallback(() => {
    const action = undoStackRef.current.pop();
    if (!action) {
      setCommandFeedback("There is nothing to undo yet.");
      return;
    }

    if (action.type === "diagram") {
      const result = applyDiagramUndo(boardRef.current, {
        undoEvents: action.undoEvents,
      });
      boardRef.current = result.state;
      if (result.events.length > 0) {
        boardSyncRef.current?.publish(result.events);
      }
      const restoredSelection = action.selectionBefore.filter(
        (strokeId) => boardRef.current.strokes[strokeId]?.status === "committed",
      );
      setSelectedAnnotationIds(restoredSelection);
      setSelectedAnnotationId(restoredSelection[restoredSelection.length - 1] ?? null);
      setCommandFeedback("Undid the last diagram command.");
      render();
      updateStats();
      return;
    }

    if (action.type === "stroke") {
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "stroke.deleted",
        strokeIds: [action.strokeId],
      });
      setCommandFeedback("Undid the last object.");
      return;
    }

    applyLocalEvent({
      ...createEventEnvelope({
        boardSessionId: boardSessionIdRef.current,
        actorParticipantId: PARTICIPANT_ID,
      }),
      type: "stroke.restored",
      strokeIds: action.strokeIds,
    });
    setCommandFeedback("Restored the erased objects.");
  }, [applyLocalEvent, render, updateStats]);

  const processUndoGestureFrame = useCallback(
    (frame: UndoGestureFrame): UndoGestureEvent => {
      const result = undoGestureTrackerRef.current!.update(frame);
      if (result === "tracking") {
        // Open-palm motion has declared possible Undo intent. Cancel any
        // incomplete voice hold, but keep the pointer live until the complete
        // directional swipe actually fires.
        palmVoiceGestureTrackerRef.current!.reset();
        return "tracking";
      }
      if (result !== "undo") {
        return null;
      }

      const wasInterpreting = speechRecognitionStatusRef.current === "interpreting";
      semanticIntentRequestIdRef.current += 1;
      voiceCorrectionPendingRef.current = null;
      voiceRouter.reset();
      setVoiceGate(null);
      palmVoiceGestureTrackerRef.current!.reset();
      hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
      setLastGestureIntent({ intent: "undo", confidence: 1 });

      if (wasInterpreting) {
        setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
        setCommandFeedback("Swipe-left undo stopped the command before it changed the board.");
        appendCopilotActivity({
          source: "Board",
          title: "Command stopped",
          detail: "Open-palm swipe left cancelled the in-progress Airo request.",
          tone: "success",
        });
        return "undo";
      }

      const hadUndo = undoStackRef.current.length > 0;
      undoLastAction();
      setCommandFeedback(
        hadUndo
          ? "Open-palm swipe left recognized — undid the last board change."
          : "Open-palm swipe left recognized, but there is nothing to undo yet.",
      );
      appendCopilotActivity({
        source: "Board",
        title: hadUndo ? "Undo gesture applied" : "Nothing to undo",
        detail: "Recognized one open palm swiping left.",
        tone: hadUndo ? "success" : "warning",
      });
      return "undo";
    },
    [appendCopilotActivity, undoLastAction, voiceRouter],
  );

  const cancelPendingIntent = useCallback((message = "Cancelled the pending command.") => {
    semanticIntentRequestIdRef.current += 1;
    voiceCorrectionPendingRef.current = null;
    pendingIntentRef.current = null;
    setPendingIntent(null);
    setGhostAnnotation(null);
    setGhostAnnotations([]);
    setAlignmentGuides([]);
    setCommandFeedback(message);
  }, []);

  const prepareParsedIntentPlan = useCallback(
    (
      parsedSteps: ParsedIntentCanvasCommand[],
      requestText: string,
      source: "deterministic" | "semantic",
      voiceTurnId?: string,
    ): PrepareIntentCommandResult => {
      const firstParsed = parsedSteps[0];
      if (!firstParsed) {
        cancelPendingIntent("Airo did not produce a diagram plan.");
        return "rejected";
      }

      if (
        source === "semantic" &&
        parsedSteps.some((step) => step.command.kind === "undo" || step.command.kind === "cancel")
      ) {
        cancelPendingIntent("Say undo or cancel directly instead of including it in a generated plan.");
        return "rejected";
      }
      if (
        parsedSteps.length > 1 &&
        parsedSteps.some(
          (step) => step.command.kind !== "create_node" && step.command.kind !== "connect",
        )
      ) {
        cancelPendingIntent(
          "Multi-step generated plans can create and connect objects only. Apply edits separately.",
        );
        return "rejected";
      }

      const baseState = boardRef.current;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const pointer =
        lastGesturePointerRef.current ??
        toBoardPoint({
          x: (canvasRect?.width ?? 900) / 2,
          y: (canvasRect?.height ?? 600) / 2,
        });
      let previewState = baseState;
      let workingSelectionIds = selectedAnnotationIds.filter(
        (strokeId) => previewState.strokes[strokeId]?.status === "committed",
      );
      let workingPrimarySelectionId =
        selectedAnnotationId && workingSelectionIds.includes(selectedAnnotationId)
          ? selectedAnnotationId
          : (workingSelectionIds[workingSelectionIds.length - 1] ?? null);
      let commands: DiagramCommand[] = [];
      let affectedStrokeIds: string[] = [];

      try {
        for (const step of parsedSteps) {
          const resolved = resolveIntentOperation(step.command, {
            boardState: previewState,
            pointer,
            canvasWidth: (canvasRect?.width ?? 900) / boardViewportRef.current.scale,
            canvasHeight: (canvasRect?.height ?? 600) / boardViewportRef.current.scale,
            viewOrigin: toBoardPoint({ x: 0, y: 0 }),
            selectionIds: workingSelectionIds,
            primarySelectionId: workingPrimarySelectionId,
            hoverStrokeId,
            strokeColor,
          });
          if ("error" in resolved) {
            if (voiceTurnId) {
              reportVoiceTrace(voiceTurnId, "action_failed", {
                phase: "grounding",
                stepKind: step.command.kind,
                message: resolved.error,
              });
            }
            cancelPendingIntent(`Plan could not be resolved: ${resolved.error}`);
            return "rejected";
          }
          if (commands.length + resolved.commands.length > 30) {
            cancelPendingIntent(
              "That plan expands to too many board changes. Split it into two requests.",
            );
            return "rejected";
          }

          for (const command of resolved.commands) {
            const result = applyDiagramCommand(previewState, command, diagramCommandContext(boardSessionIdRef.current));
            previewState = result.state;
            affectedStrokeIds = [...affectedStrokeIds, ...result.affectedStrokeIds];
          }
          commands = [...commands, ...resolved.commands];
          if (resolved.selectionAfter) {
            workingSelectionIds = resolved.selectionAfter.filter(
              (strokeId) => previewState.strokes[strokeId]?.status === "committed",
            );
            workingPrimarySelectionId =
              workingSelectionIds[workingSelectionIds.length - 1] ?? null;
          }
        }

        const previewIds = [
          ...new Set([...affectedStrokeIds, ...workingSelectionIds]),
        ];
        const ghosts = previewIds.flatMap((strokeId): AnnotationRenderObject[] => {
          const previewStroke = previewState.strokes[strokeId];
          const currentStroke = baseState.strokes[strokeId];
          const stroke = previewStroke?.status === "deleted" ? currentStroke : previewStroke;
          if (!stroke?.annotation) {
            return [];
          }
          return [
            {
              annotation: stroke.annotation,
              points: stroke.points,
              color: stroke.color,
              thickness: stroke.thickness,
              previewKind:
                previewStroke?.status === "deleted" ? "delete" : currentStroke ? "change" : "add",
            },
          ];
        });
        const message =
          parsedSteps.length === 1
            ? firstParsed.message
            : `Build a ${parsedSteps.length}-step explanatory diagram.`;
        const pending: PendingIntent = {
          parsed: firstParsed,
          parsedSteps,
          stepCount: parsedSteps.length,
          confidenceBand: firstParsed.confidence.band,
          requestText,
          message,
          baseState,
          requiresExplicitConfirmation: false,
          commands,
          selectionAfter: workingSelectionIds,
          ...(ghosts.length > 0 ? { ghosts } : {}),
          ...(voiceTurnId ? { voiceTurnId } : {}),
        };
        pendingIntentRef.current = pending;
        setPendingIntent(pending);
        setGhostAnnotations(ghosts);
        setCommandFeedback(message);
        appendCopilotActivity({
          source: "Airo",
          title: "Applying graph changes",
          detail: message,
          tone: "active",
        });
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "preview", {
            source,
            stepCount: parsedSteps.length,
            actionCount: commands.length,
            requiresExplicitConfirmation: false,
          });
        }
        // No confirmation gate: commit the grounded plan immediately (typed,
        // voice, and gesture all land here). Undo remains available.
        applyPendingIntentRef.current?.();
        return "applied";
      } catch (error) {
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "preview",
            message: error instanceof Error ? error.message : "Plan preview failed.",
          });
        }
        cancelPendingIntent(
          error instanceof Error ? error.message : "That diagram plan cannot be applied.",
        );
        return "rejected";
      }
    },
    [
      cancelPendingIntent,
      hoverStrokeId,
      selectedAnnotationId,
      selectedAnnotationIds,
      strokeColor,
    ],
  );

  const prepareSemanticActionPlan = useCallback(
    (
      plan: SemanticPlan,
      requestText: string,
      voiceTurnId?: string,
      executionSnapshot?: SemanticExecutionSnapshot,
    ): PrepareIntentCommandResult => {
      if (plan.status !== "resolved" || plan.actions.length === 0) {
        return "rejected";
      }
      if (plan.actions.some((action) => action.type === "undo" || action.type === "cancel")) {
        if (plan.actions.length !== 1) {
          cancelPendingIntent("Undo and cancel must be requested as separate voice actions.");
          return "rejected";
        }
        const action = plan.actions[0]!;
        if (action.type === "undo") {
          cancelPendingIntent("Undoing the last board change.");
          undoLastAction();
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "action_undone", { source: "semantic" });
            reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "undone" });
          }
        } else {
          cancelPendingIntent();
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "cancelled" });
          }
        }
        setIntentCommandText("");
        return "applied";
      }

      const baseState = executionSnapshot?.boardState ?? boardRef.current;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const viewScale = boardViewportRef.current.scale;
      const canvasWidth =
        executionSnapshot?.canvasWidth ?? (canvasRect?.width ?? 900) / viewScale;
      const canvasHeight =
        executionSnapshot?.canvasHeight ?? (canvasRect?.height ?? 600) / viewScale;
      const viewOrigin = executionSnapshot?.viewOrigin ?? toBoardPoint({ x: 0, y: 0 });
      const actualPointer = executionSnapshot
        ? executionSnapshot.pointer
        : lastGesturePointerRef.current;
      const pointer = actualPointer ?? {
        x: viewOrigin.x + canvasWidth / 2,
        y: viewOrigin.y + canvasHeight / 2,
      };
      let previewState = baseState;
      const initialSelectionIds = executionSnapshot?.selectionIds ?? selectedAnnotationIds;
      let workingSelectionIds = initialSelectionIds.filter(
        (strokeId) => previewState.strokes[strokeId]?.status === "committed",
      );
      const initialPrimarySelectionId =
        executionSnapshot?.primarySelectionId ?? selectedAnnotationId;
      let workingPrimarySelectionId =
        initialPrimarySelectionId && workingSelectionIds.includes(initialPrimarySelectionId)
          ? initialPrimarySelectionId
          : (workingSelectionIds[workingSelectionIds.length - 1] ?? null);
      const workingHoverStrokeId = executionSnapshot?.hoverStrokeId ?? hoverStrokeId;
      const planHandles = new Map<string, string[]>();
      let commands: DiagramCommand[] = [];
      let affectedStrokeIds: string[] = [];

      try {
        for (const action of plan.actions) {
          const resolved = resolveSemanticPlanAction(
            action,
            {
              boardState: previewState,
              pointer,
              pointerAvailable: Boolean(actualPointer),
              canvasWidth,
              canvasHeight,
              viewOrigin,
              selectionIds: workingSelectionIds,
              primarySelectionId: workingPrimarySelectionId,
              hoverStrokeId: workingHoverStrokeId,
              strokeColor,
            },
            planHandles,
          );
          if ("error" in resolved) {
            if (voiceTurnId) {
              reportVoiceTrace(voiceTurnId, "action_failed", {
                phase: "semantic_grounding",
                actionType: action.type,
                message: resolved.error,
              });
            }
            cancelPendingIntent(`Plan could not be grounded: ${resolved.error}`);
            return "rejected";
          }
          if (commands.length + resolved.commands.length > 40) {
            cancelPendingIntent("That plan expands to too many board changes. Split it into two requests.");
            return "rejected";
          }
          for (const command of resolved.commands) {
            const result = applyDiagramCommand(previewState, command, diagramCommandContext(boardSessionIdRef.current));
            previewState = result.state;
            affectedStrokeIds = [...affectedStrokeIds, ...result.affectedStrokeIds];
          }
          commands = [...commands, ...resolved.commands];
          for (const [handle, ids] of Object.entries(resolved.handleAssignments ?? {})) {
            planHandles.set(handle, ids);
          }
          if (resolved.selectionAfter) {
            workingSelectionIds = resolved.selectionAfter.filter(
              (strokeId) => previewState.strokes[strokeId]?.status === "committed",
            );
            workingPrimarySelectionId =
              workingSelectionIds[workingSelectionIds.length - 1] ?? null;
          }
        }

        if (commands.length === 0) {
          setSelectedAnnotationIds(workingSelectionIds);
          setSelectedAnnotationId(workingPrimarySelectionId);
          setCommandFeedback("Applied the requested selection.");
          setIntentCommandText("");
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "action_applied", {
              actionCount: plan.actions.length,
              affectedObjectCount: workingSelectionIds.length,
            });
            reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "applied" });
          }
          return "applied";
        }

        const previewIds = [...new Set([...affectedStrokeIds, ...workingSelectionIds])];
        const ghosts = previewIds.flatMap((strokeId): AnnotationRenderObject[] => {
          const previewStroke = previewState.strokes[strokeId];
          const currentStroke = baseState.strokes[strokeId];
          const stroke = previewStroke?.status === "deleted" ? currentStroke : previewStroke;
          if (!stroke?.annotation) {
            return [];
          }
          return [
            {
              annotation: stroke.annotation,
              points: stroke.points,
              color: stroke.color,
              thickness: stroke.thickness,
              previewKind:
                previewStroke?.status === "deleted" ? "delete" : currentStroke ? "change" : "add",
            },
          ];
        });
        const message = describeSemanticPlan(plan.actions);
        const pending: PendingIntent = {
          parsed: null,
          parsedSteps: [],
          stepCount: plan.actions.length,
          confidenceBand: "high",
          requestText,
          message,
          baseState,
          requiresExplicitConfirmation: false,
          commands,
          selectionAfter: workingSelectionIds,
          ...(ghosts.length > 0 ? { ghosts } : {}),
          ...(voiceTurnId ? { voiceTurnId } : {}),
        };
        pendingIntentRef.current = pending;
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "preview", {
            source: "semantic",
            stepCount: plan.actions.length,
            actionTypes: plan.actions.map((action) => action.type),
            diagramCommandCount: commands.length,
            requiresExplicitConfirmation: false,
          });
        }
        // Render the exact graph-change summary once before committing. The
        // complete command list still lands as one undo-stack transaction.
        requestAnimationFrame(() => {
          if (pendingIntentRef.current === pending) {
            applyPendingIntentRef.current?.();
          }
        });
        return "previewed";
      } catch (error) {
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "semantic_preview",
            message: error instanceof Error ? error.message : "Semantic plan preview failed.",
          });
        }
        cancelPendingIntent(
          error instanceof Error ? error.message : "That semantic diagram plan cannot be applied.",
        );
        return "rejected";
      }
    },
    [
      appendCopilotActivity,
      cancelPendingIntent,
      hoverStrokeId,
      selectedAnnotationId,
      selectedAnnotationIds,
      strokeColor,
      undoLastAction,
    ],
  );

  const prepareIntentCommand = useCallback(
    (text: string, voiceTurnId?: string): PrepareIntentCommandResult => {
      const visibilityIntent = parseDiagramVisibilityIntent(text);
      if (visibilityIntent) {
        setDiagramVisibility(visibilityIntent === "show", "voice");
        setIntentCommandText("");
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "turn_completed", {
            outcome: visibilityIntent === "show" ? "diagram_shown" : "diagram_hidden",
          });
        }
        return "applied";
      }
      if (!diagramVisibleRef.current) {
        cancelPendingIntent(
          "The diagram is hidden, so board-editing commands are suspended. Say “show canvas” or press Shift+H first.",
        );
        return "rejected";
      }
      if (
        cameraPlacementActiveRef.current ||
        cameraPlacementArmedToolRef.current ||
        objectInteractionRef.current?.mode === "placing"
      ) {
        cancelObjectInteraction();
        cameraPlacementActiveRef.current = false;
        cameraGrabActiveRef.current = false;
        hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
        hybridPinchClosedRef.current = true;
      }
      const linkedCreate = expandSpokenCreateAndConnect(text);
      if (linkedCreate) {
        const parsedSteps = linkedCreate.map((step) =>
          parseIntentCanvasCommand(step, {
            activationPolicy: "externally_activated",
          }),
        );
        if (
          parsedSteps.every(
            (step): step is ParsedIntentCanvasCommand => step.status === "parsed",
          )
        ) {
          return prepareParsedIntentPlan(
            parsedSteps,
            text.trim(),
            "deterministic",
            voiceTurnId,
          );
        }
      }
      const parsed = parseIntentCanvasCommand(text, {
        activationPolicy: "externally_activated",
      });
      if (voiceTurnId) {
        reportVoiceTrace(voiceTurnId, "parser_outcome", {
          status: parsed.status,
          normalizedText: parsed.normalizedText,
          ...(parsed.status === "parsed"
            ? { operationKind: parsed.command.kind, confidence: parsed.confidence.score }
            : { issueCode: parsed.issue.code }),
        });
      }
      if (parsed.status !== "parsed") {
        cancelPendingIntent(parsed.issue.message);
        return "rejected";
      }

      if (parsed.command.kind === "undo") {
        cancelPendingIntent("Undoing the last board change.");
        undoLastAction();
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "action_undone", { source: "voice" });
          reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "undone" });
        }
        setIntentCommandText("");
        return "applied";
      }
      if (parsed.command.kind === "cancel") {
        cancelPendingIntent();
        setIntentCommandText("");
        return "applied";
      }

      return prepareParsedIntentPlan([parsed], text.trim(), "deterministic", voiceTurnId);
    },
    [
      cancelPendingIntent,
      cancelObjectInteraction,
      prepareParsedIntentPlan,
      setDiagramVisibility,
      undoLastAction,
    ],
  );

  useEffect(() => {
    prepareIntentCommandRef.current = prepareIntentCommand;
    return () => {
      prepareIntentCommandRef.current = null;
    };
  }, [prepareIntentCommand]);

  const prepareIntentCommandWithSemantic = useCallback(
    async (text: string, voiceTurnId?: string): Promise<IntentPreparationOutcome> => {
      const instruction = text.trim();
      const visibilityIntent = parseDiagramVisibilityIntent(instruction);
      if (visibilityIntent || !diagramVisibleRef.current) {
        const visibilityResult = prepareIntentCommand(instruction, voiceTurnId);
        return {
          result: visibilityResult,
          preparedText: instruction,
          source: "deterministic",
          stepCount: visibilityIntent ? 1 : 0,
        };
      }
      const desiredGraphCorrection = parseDesiredGraphCorrection(instruction);
      if (desiredGraphCorrection) {
        setIntentCommandText(instruction);
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "parser_outcome", {
            status: "parsed",
            operationKind: "desired_graph_correction",
            confidence: 1,
          });
        }
        const correctionResult = prepareSemanticActionPlan(
          desiredGraphCorrection,
          instruction,
          voiceTurnId,
        );
        return {
          result: correctionResult,
          preparedText: instruction,
          source: "deterministic",
          stepCount: desiredGraphCorrection.actions.length,
        };
      }
      const directResult = prepareIntentCommand(instruction, voiceTurnId);
      if (directResult !== "rejected") {
        return {
          result: directResult,
          preparedText: instruction,
          source: "deterministic",
          stepCount: 1,
        };
      }

      const deterministic = parseIntentCanvasCommand(instruction, {
        activationPolicy: "externally_activated",
      });
      const deterministicGroundingFailed = deterministic.status === "parsed";
      if (!deterministicGroundingFailed && !shouldUseSemanticIntentFallback(deterministic)) {
        return {
          result: "rejected",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }
      const parserIssue = (
        deterministic.status === "parsed" ? "grounding_failed" : deterministic.issue.code
      ) as SemanticIntentParserIssue;

      const semanticConfig = semanticIntentConfigRef.current;
      if (!semanticConfig?.available) {
        return {
          result: "rejected",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }

      const requestBoardState = boardRef.current;
      const requestSelectionIds = [...selectedAnnotationIdsRef.current];
      const requestPointer = lastGesturePointerRef.current
        ? { ...lastGesturePointerRef.current }
        : null;
      const requestCanvasRect = canvasRef.current?.getBoundingClientRect();
      const executionSnapshot: SemanticExecutionSnapshot = {
        boardState: requestBoardState,
        selectionIds: requestSelectionIds,
        primarySelectionId: requestSelectionIds[requestSelectionIds.length - 1] ?? null,
        hoverStrokeId,
        pointer: requestPointer,
        canvasWidth: (requestCanvasRect?.width ?? 900) / boardViewportRef.current.scale,
        canvasHeight: (requestCanvasRect?.height ?? 600) / boardViewportRef.current.scale,
        viewOrigin: toBoardPoint({ x: 0, y: 0 }),
      };

      const requestId = semanticIntentRequestIdRef.current + 1;
      semanticIntentRequestIdRef.current = requestId;
      const semanticModel =
        selectedSemanticIntentModelRef.current || semanticConfig.defaultModel;
      setSpeechRecognitionStatus("interpreting");
      setCommandFeedback(
        `Understanding “${truncateSpeechTranscript(instruction)}” with ${semanticConfig.provider ?? "AI"} / ${semanticModel ?? "semantic model"}…`,
      );
      if (voiceTurnId) {
        reportVoiceTrace(voiceTurnId, "semantic_request", {
          transcript: instruction,
          parserIssue,
          deterministicGroundingFailed,
          provider: semanticConfig.provider,
          model: semanticModel,
        });
      }

      try {
        const resolution = await resolveSemanticIntent({
          apiBaseUrl: AIRBOARD_API_URL,
          ...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {}),
          voiceTurnId: voiceTurnId ?? crypto.randomUUID(),
          transcript: instruction,
          parserIssue,
          context: buildSemanticIntentContext(
            requestBoardState,
            requestSelectionIds,
            Boolean(requestPointer),
          ),
          ...(semanticModel ? { model: semanticModel } : {}),
        });
        if (semanticIntentRequestIdRef.current !== requestId) {
          return {
            result: "rejected",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
          };
        }
        const boardChangedDuringPlanning = boardContentChanged(
          boardRef.current,
          requestBoardState,
        );
        const currentSelectionIds = selectedAnnotationIdsRef.current;
        const selectionChangedDuringPlanning =
          currentSelectionIds.length !== requestSelectionIds.length ||
          currentSelectionIds.some((strokeId, index) => strokeId !== requestSelectionIds[index]);
        if (boardChangedDuringPlanning || selectionChangedDuringPlanning) {
          setSpeechRecognitionStatus("command-rejected");
          setCommandFeedback("The board changed while Airo was planning. Please repeat the command for the current board.");
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "action_failed", {
              phase: "stale_semantic_context",
              boardChangedDuringPlanning,
              selectionChangedDuringPlanning,
            });
            reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "stale_context" });
          }
          return {
            result: "rejected",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
          };
        }
        const plan = resolution.plan;
        if (plan.status !== "resolved") {
          // Airo never asks the user to confirm a voice command. If the model
          // still declines to produce actions (unsupported, or a stray
          // clarification the prompt forbids), that turn simply has nothing to
          // apply: report a plain rejection the user can repeat. There is no
          // pending-confirmation state and no click anywhere in this path.
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "semantic_result", {
              status: plan.status,
              issueCode: plan.issueCode,
              provider: resolution.provider,
              model: resolution.model,
              responseId: resolution.metadata.responseId,
              providerRequestId: resolution.metadata.providerRequestId,
              providerProcessingMs: resolution.metadata.providerProcessingMs,
              totalLatencyMs: resolution.metadata.totalLatencyMs,
              usage: resolution.metadata.usage,
            });
          }
          setSpeechRecognitionStatus("command-rejected");
          setCommandFeedback(
            plan.status === "clarification" && plan.clarificationQuestion
              ? plan.clarificationQuestion
              : semanticIntentIssueMessage(plan.issueCode),
          );
          return {
            result: "rejected",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
          };
        }

        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "semantic_result", {
            status: plan.status,
            issueCode: plan.issueCode,
            provider: resolution.provider,
            model: resolution.model,
            actionCount: plan.actions.length,
            actionTypes: plan.actions.map((action) => action.type),
            responseId: resolution.metadata.responseId,
            providerRequestId: resolution.metadata.providerRequestId,
            providerProcessingMs: resolution.metadata.providerProcessingMs,
            totalLatencyMs: resolution.metadata.totalLatencyMs,
            usage: resolution.metadata.usage,
          });
        }
        setIntentCommandText(instruction);
        const semanticResult = prepareSemanticActionPlan(
          plan,
          instruction,
          voiceTurnId,
          executionSnapshot,
        );
        setSpeechRecognitionStatus(
          semanticResult === "rejected" ? "command-rejected" : "command-recognized",
        );
        return {
          result: semanticResult,
          preparedText: instruction,
          source: "semantic",
          stepCount: plan.actions.length,
        };
      } catch (caught) {
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "semantic_failure", {
            code:
              caught instanceof Error && "code" in caught
                ? String(caught.code)
                : "SEMANTIC_INTENT_FAILED",
            status:
              caught instanceof Error && "status" in caught
                ? Number(caught.status)
                : undefined,
            message: caught instanceof Error ? caught.message : "Semantic interpretation failed.",
          });
        }
        if (semanticIntentRequestIdRef.current === requestId) {
          setSpeechRecognitionStatus("command-rejected");
          setCommandFeedback(
            caught instanceof Error
              ? caught.message
              : "Airo's semantic command interpreter is temporarily unavailable.",
          );
        }
        return {
          result: "rejected",
          preparedText: instruction,
          source: "semantic",
          stepCount: 0,
        };
      }
    },
    [hoverStrokeId, prepareIntentCommand, prepareSemanticActionPlan],
  );

  useEffect(() => {
    prepareIntentCommandWithSemanticRef.current = prepareIntentCommandWithSemantic;
    return () => {
      prepareIntentCommandWithSemanticRef.current = null;
    };
  }, [prepareIntentCommandWithSemantic]);

  // Fire-and-forget entry point for the typed/example command paths. The
  // underlying preparer handles expected failures internally, but any unexpected
  // rejection must still surface to the user instead of becoming an unhandled
  // promise rejection.
  const runIntentCommand = useCallback(
    (text: string) => {
      const instruction = text.trim();
      if (!instruction) {
        return;
      }
      appendCopilotActivity({
        source: "You",
        title: "Typed command",
        detail: instruction,
        tone: "neutral",
      });
      prepareIntentCommandWithSemantic(instruction)
        .then((outcome) => {
          if (outcome.result === "rejected") {
            appendCopilotActivity({
              source: "Airo",
              title: "Could not apply",
              detail: "The board was not changed. Edit the command and try again.",
              tone: "warning",
            });
          }
        })
        .catch(() => {
          setSpeechRecognitionStatus("command-rejected");
          setCommandFeedback("Something went wrong preparing that command. Please try again.");
          appendCopilotActivity({
            source: "Airo",
            title: "Command failed",
            detail: "Something went wrong while preparing the board update.",
            tone: "warning",
          });
        });
    },
    [appendCopilotActivity, prepareIntentCommandWithSemantic],
  );

  const applyPendingIntent = useCallback(() => {
    const pending = pendingIntentRef.current;
    if (!pending) {
      setCommandFeedback("Create a command preview first.");
      return;
    }
    if (boardContentChanged(boardRef.current, pending.baseState)) {
      if (pending.voiceTurnId) {
        reportVoiceTrace(pending.voiceTurnId, "action_failed", {
          phase: "apply",
          code: "STALE_PREVIEW",
        });
        reportVoiceTrace(pending.voiceTurnId, "turn_completed", { outcome: "failed" });
      }
      cancelPendingIntent("The board changed after this preview. Ask Airo to plan it again.");
      return;
    }

    try {
      let nextState = boardRef.current;
      let undoEvents: BoardEvent[] = [];
      let affectedStrokeIds: string[] = [];
      let forwardEvents: BoardEvent[] = [];
      for (const command of pending.commands) {
        const result = applyDiagramCommand(nextState, command, diagramCommandContext(boardSessionIdRef.current));
        nextState = result.state;
        undoEvents = [...result.undoEvents, ...undoEvents];
        forwardEvents = [...forwardEvents, ...result.events];
        affectedStrokeIds = [...affectedStrokeIds, ...result.affectedStrokeIds];
      }
      // One atomic batch: peers replay the compound command in sequence order.
      if (forwardEvents.length > 0) {
        boardSyncRef.current?.publish(forwardEvents);
      }

      if (undoEvents.length > 0) {
        undoStackRef.current.push({
          type: "diagram",
          undoEvents,
          selectionBefore: selectedAnnotationIds,
        });
      }
      boardRef.current = nextState;
      const requestedSelection = pending.selectionAfter ?? selectedAnnotationIds;
      const nextSelection = requestedSelection.filter(
        (strokeId) => nextState.strokes[strokeId]?.status === "committed",
      );
      const fallbackSelection = affectedStrokeIds.filter(
        (strokeId) => nextState.strokes[strokeId]?.status === "committed",
      );
      const finalSelection = nextSelection.length > 0 ? nextSelection : fallbackSelection.slice(-1);
      const primary = finalSelection[finalSelection.length - 1] ?? null;
      setSelectedAnnotationIds(finalSelection);
      setSelectedAnnotationId(primary);
      setLabelDraft(primary ? (nextState.strokes[primary]?.annotation?.label ?? "") : "");
      setEditingAnnotationId(null);
      setActiveObjectTool("select");
      setIntentCommandText("");
      setCommandFeedback(`Applied: ${pending.message}`);
      appendCopilotActivity({
        source: "Board",
        title: "Board updated",
        detail: pending.message,
        tone: "success",
      });
      voiceCorrectionPendingRef.current = null;
      pendingIntentRef.current = null;
      setPendingIntent(null);
      setGhostAnnotation(null);
      setGhostAnnotations([]);
      setAlignmentGuides([]);
      if (pending.voiceTurnId) {
        reportVoiceTrace(pending.voiceTurnId, "action_applied", {
          actionCount: pending.commands.length,
          affectedObjectCount: new Set(affectedStrokeIds).size,
        });
        reportVoiceTrace(pending.voiceTurnId, "turn_completed", { outcome: "applied" });
      }
      render();
      updateStats();
    } catch (error) {
      if (pending.voiceTurnId) {
        reportVoiceTrace(pending.voiceTurnId, "action_failed", {
          phase: "apply",
          message: error instanceof Error ? error.message : "Diagram command failed.",
        });
        reportVoiceTrace(pending.voiceTurnId, "turn_completed", { outcome: "failed" });
      }
      setCommandFeedback(error instanceof Error ? error.message : "The diagram command failed.");
    }
  }, [
    appendCopilotActivity,
    cancelPendingIntent,
    render,
    selectedAnnotationIds,
    updateStats,
  ]);

  useEffect(() => {
    applyPendingIntentRef.current = applyPendingIntent;
    return () => {
      applyPendingIntentRef.current = null;
    };
  }, [applyPendingIntent]);

  const queueVoiceCommand = useCallback((command: string, traceContext?: VoiceCommandTraceContext) => {
    const voiceTurnId = traceContext?.voiceTurnId;
    if (traceContext) {
      reportVoiceTrace(traceContext.voiceTurnId, "capture_metadata", {
        engine: traceContext.engine,
        provider: traceContext.provider,
        model: traceContext.model,
      });
      reportVoiceTrace(traceContext.voiceTurnId, "stt_final", {
        transcript: traceContext.transcript,
        confidence: traceContext.confidence,
        turnIndex: traceContext.turnIndex,
        provider: traceContext.provider,
        model: traceContext.model,
      });
      reportVoiceTrace(traceContext.voiceTurnId, "wake_classification", {
        wakeDetected: true,
        wakePhrase: traceContext.wakePhrase,
        command,
      });
    }
    wakeCommandQueueRef.current = wakeCommandQueueRef.current
      .then(async () => {
        const instruction = command.trim();
        appendCopilotActivity({
          source: "Voice",
          title: "Final transcript",
          detail: traceContext?.transcript?.trim() || instruction,
          tone: "neutral",
        });
        voiceCorrectionPendingRef.current = null;
        setIntentCommandText(instruction);
        setSpeechRecognitionStatus("interpreting");
        setCommandFeedback(
          `Understanding “${truncateSpeechTranscript(instruction)}” and applying it automatically…`,
        );
        appendCopilotActivity({
          source: "Airo",
          title: "Understanding command",
          detail: instruction,
          tone: "active",
        });
        const outcome =
          (await prepareIntentCommandWithSemanticRef.current?.(instruction, voiceTurnId)) ?? {
            result: "rejected" as const,
            preparedText: instruction,
            source: "deterministic" as const,
            stepCount: 0,
          };
        // Commands commit instantly inside the preparer — there is no pending
        // plan to confirm and no "did you mean?" prompt. Airo applies its best
        // interpretation automatically; a turn that produced nothing to apply
        // reports a plain rejection and the user simply repeats it. Undo is the
        // safety net for a wrong best-guess.
        setSpeechRecognitionStatus(
          outcome.result === "rejected" ? "command-rejected" : "command-recognized",
        );
        if (outcome.result === "rejected" && voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "interpretation",
            outcome: "rejected",
          });
          reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "rejected" });
        }
        if (outcome.result === "rejected") {
          appendCopilotActivity({
            source: "Airo",
            title: "Could not apply",
            detail: "Edit the transcript below or repeat the command.",
            tone: "warning",
          });
        }
        await nextAnimationFrame();
      })
      .catch(() => {
        setSpeechRecognitionStatus("command-rejected");
        setCommandFeedback("Airo could not apply that command. Try the typed command field.");
        appendCopilotActivity({
          source: "Airo",
          title: "Automatic command failed",
          detail: "The transcript is still available to edit and send.",
          tone: "warning",
        });
      });
  }, [appendCopilotActivity]);

  /** Mirrors the router's gate state into the pill UI. */
  const syncVoiceGateUi = useCallback(() => {
    const snapshot = voiceRouter.snapshot;
    if (!snapshot || (snapshot.mode === "ptt" && !snapshot.open)) {
      // Push-to-talk reads as released when the open palm drops; the scoped
      // pill stays visible through its grace window ("grab, let go, speak").
      setVoiceGate(null);
      return;
    }
    if (snapshot.mode === "ptt") {
      setVoiceGate({ mode: "ptt" });
      return;
    }
    const strokeId = snapshot.strokeId ?? "";
    const label =
      (strokeId && boardRef.current.strokes[strokeId]?.annotation?.label?.trim()) ||
      "this object";
    setVoiceGate({ mode: "scoped", strokeId, label });
  }, [voiceRouter]);

  const openVoiceGate = useCallback(
    (gate: { mode: VoiceGateMode; strokeId?: string }) => {
      voiceRouter.openGate(gate);
      syncVoiceGateUi();
      const micArmed = Boolean(speechSessionRef.current);
      if (gate.mode === "ptt") {
        setCommandFeedback(
          micArmed
            ? "Open palm recognized — speak a board command, then relax your hand."
            : "Open palm recognized. Press Start Airo once to enable voice commands.",
        );
        return;
      }
      const label =
        (gate.strokeId &&
          boardRef.current.strokes[gate.strokeId]?.annotation?.label?.trim()) ||
        "this object";
      setCommandFeedback(
        micArmed
          ? `Editing “${label}”: say “rename to …”, “delete”, “duplicate”, or “connect to …”.`
          : `Holding “${label}”. Press Start Airo once to enable voice edits.`,
      );
    },
    [syncVoiceGateUi, voiceRouter],
  );

  const closeVoiceGate = useCallback(
    (mode: VoiceGateMode) => {
      voiceRouter.closeGate(mode);
      syncVoiceGateUi();
    },
    [syncVoiceGateUi, voiceRouter],
  );

  const processPalmVoiceGestureFrame = useCallback(
    (frame: PalmVoiceGestureFrame): PalmVoiceGestureEvent => {
      const event = palmVoiceGestureTrackerRef.current!.update(frame);
      if (event === "activate") {
        openVoiceGate({ mode: "ptt" });
      } else if (event === "release") {
        closeVoiceGate("ptt");
      }
      return event;
    },
    [closeVoiceGate, openVoiceGate],
  );

  const dispatchVoiceDecision = useCallback(
    (
      decision: VoiceRouteDecision,
      metadata: {
        engine: VoiceCommandTraceContext["engine"];
        provider?: string | undefined;
        model?: string | undefined;
        confidence?: number | undefined;
        turnIndex?: number | undefined;
      },
    ) => {
      queueVoiceCommand(decision.command, {
        voiceTurnId: crypto.randomUUID(),
        transcript: decision.transcript,
        wakePhrase: decision.wakePhrase,
        engine: metadata.engine,
        provider: metadata.provider,
        model: metadata.model,
        confidence: metadata.confidence,
        turnIndex: metadata.turnIndex,
      });
    },
    [queueVoiceCommand],
  );

  /**
   * The single entry point for finalized transcripts from engines that do not
   * wake-route internally (realtime transcription, e2e test hooks). All
   * channel priority and dedup rules live in VoiceCommandRouter.
   */
  const routeFinalTranscript = useCallback(
    (
      transcript: string,
      metadata: {
        engine: VoiceCommandTraceContext["engine"];
        provider?: string | undefined;
        model?: string | undefined;
        confidence?: number | undefined;
        turnIndex?: number | undefined;
      },
    ): { routed: boolean; wakeDetected: boolean } => {
      const { decisions, wakeDetected } = voiceRouter.handleFinalTranscript(transcript);
      syncVoiceGateUi();
      for (const decision of decisions) {
        dispatchVoiceDecision(decision, metadata);
      }
      return { routed: decisions.length > 0, wakeDetected };
    },
    [dispatchVoiceDecision, syncVoiceGateUi, voiceRouter],
  );

  // E2E seam: lets Playwright drive the exact same transcript-routing path a
  // realtime speech session uses, without a microphone or provider. Only
  // exposed when the test-hooks env flag is set (never in normal builds).
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS !== "1") {
      return;
    }
    const target = window as unknown as { __airboardTestHooks?: unknown };
    target.__airboardTestHooks = {
      emitFinalTranscript: (transcript: string) => {
        setSpeechHeardText(transcript);
        return routeFinalTranscript(transcript, { engine: "realtime" });
      },
      openPttGate: () => openVoiceGate({ mode: "ptt" }),
      emitPalmVoiceGestureFrame: (frame: PalmVoiceGestureFrame) =>
        processPalmVoiceGestureFrame(frame),
      emitUndoGestureFrame: (frame: UndoGestureFrame) =>
        processUndoGestureFrame(frame) === "undo",
      emitSnapGestureFrame: (frame: SnapGestureFrame) =>
        processSnapGestureFrame(frame) === "snap",
      emitHybridGestureOutput: (output: HybridGestureControllerOutput) =>
        handleGesture(null, output),
      setDiagramVisible: (visible: boolean) =>
        setDiagramVisibility(visible, "test"),
      getDiagramVisible: () => diagramVisibleRef.current,
      resetVoiceRouting: () => {
        voiceRouter.reset();
        setVoiceGate(null);
      },
      getViewport: () => ({ ...boardViewportRef.current }),
      getCatalogGestureState: () => {
        const interaction = objectInteractionRef.current;
        const ghostBounds = ghostAnnotation?.annotation.bounds;
        return {
          openCatalogId,
          activeTool: activeObjectTool,
          interactionMode: interaction?.mode ?? null,
          carriedTool:
            interaction?.mode === "catalog_carrying" ? interaction.tool : null,
          enteredCanvas:
            interaction?.mode === "catalog_carrying"
              ? interaction.enteredCanvas
              : false,
          placementActive: cameraPlacementActiveRef.current,
          ghostCenter: ghostBounds
            ? {
                x: ghostBounds.x + ghostBounds.width / 2,
                y: ghostBounds.y + ghostBounds.height / 2,
              }
            : null,
        };
      },
      setViewport: (viewport: BoardViewport) => {
        boardViewportRef.current = clampViewport(viewport, currentViewportLimits());
        setViewportScale(Math.round(boardViewportRef.current.scale * 100) / 100);
        render();
      },
      getBoardSummary: () => {
        const committed = Object.values(boardRef.current.strokes).filter(
          (stroke) => stroke.status === "committed" && stroke.annotation,
        );
        return {
          objectCount: committed.length,
          labels: committed.map((stroke) => stroke.annotation?.label ?? ""),
          positions: committed.map((stroke) => {
            const bounds = stroke.annotation?.bounds;
            return bounds
              ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
              : null;
          }),
          selectedCount: selectedAnnotationIdsRef.current.length,
          boardSessionId: boardSessionIdRef.current,
          syncStatus: boardSyncStatusRef.current,
        };
      },
    };
    return () => {
      delete target.__airboardTestHooks;
    };
  }, [
    activeObjectTool,
    currentViewportLimits,
    ghostAnnotation,
    handleGesture,
    openVoiceGate,
    openCatalogId,
    processPalmVoiceGestureFrame,
    processSnapGestureFrame,
    processUndoGestureFrame,
    render,
    routeFinalTranscript,
    setDiagramVisibility,
    voiceRouter,
  ]);

  const startVoiceCommand = useCallback(() => {
    if (!voiceCaptureAvailable) {
      setSpeechRecognitionStatus("idle");
      setCommandFeedback(
        "This meeting surface cannot capture the microphone yet. Type commands here, or open the gesture & voice companion window from the sidebar.",
      );
      return;
    }
    const activeSession = speechSessionRef.current;
    if (activeSession) {
      semanticIntentRequestIdRef.current += 1;
      activeSession.stop();
      speechSessionRef.current = null;
      voiceRouter.reset();
      setVoiceGate(null);
      setSpeechArmed(false);
      setSpeechListening(false);
      setSpeechRecognitionStatus("idle");
      setCommandFeedback("Airo stopped. Typed commands remain available.");
      return;
    }

    if (!speechSupported || speechEngine === "loading" || speechEngine === "unavailable") {
      setSpeechRecognitionStatus("error");
      setCommandFeedback(
        speechEngine === "loading"
          ? "Checking the realtime transcription service…"
          : "Realtime voice is not configured. Add a provider key to the Airboard API; typed commands still work.",
      );
      return;
    }

    const reportFinalTranscript = (
      transcript: string,
      commandWasRouted: boolean,
      metadata?: {
        engine: VoiceCommandTraceContext["engine"];
        provider?: string | undefined;
        model?: string | undefined;
        confidence?: number | undefined;
        turnIndex?: number | undefined;
      },
    ) => {
      setSpeechHeardText(transcript);
      if (commandWasRouted) {
        return;
      }
      const classification = classifyBrowserWakeTranscript(transcript);
      if (classification.commands.length > 0) {
        return;
      }
      const voiceTurnId = crypto.randomUUID();
      reportVoiceTrace(voiceTurnId, "capture_metadata", {
        engine: metadata?.engine ?? "browser-fallback",
        provider: metadata?.provider,
        model: metadata?.model,
      });
      reportVoiceTrace(voiceTurnId, "stt_final", {
        transcript,
        confidence: metadata?.confidence,
        turnIndex: metadata?.turnIndex,
        provider: metadata?.provider,
        model: metadata?.model,
      });
      reportVoiceTrace(voiceTurnId, "wake_classification", {
        wakeDetected: classification.wakeDetected,
        wakePhrases: classification.wakePhrases,
        commandCount: 0,
      });
      if (!classification.wakeDetected) {
        setSpeechRecognitionStatus("wake-missing");
        setCommandFeedback(
          `Mic heard “${truncateSpeechTranscript(transcript)}”, but it wasn't addressed to the board. Hold an open palm for voice, or say “Airo, add a user.”`,
        );
      } else if (classification.commands.length === 0) {
        setSpeechRecognitionStatus("wake-detected");
        setCommandFeedback("Airo heard the wake word. Say the diagram command now.");
      }
      reportVoiceTrace(voiceTurnId, "turn_completed", {
        outcome: classification.wakeDetected ? "wake_only" : "wake_missing",
      });
    };

    if (speechEngine === "realtime") {
      let realtimeSession: RealtimeSpeechSession | null = null;
      realtimeSession = createRealtimeSpeechSession(
        {
          onReady: (metadata) => {
            setRealtimeSpeechMetadata(metadata);
            setSpeechArmed(true);
            setSpeechRecognitionStatus("waiting");
            setCommandFeedback(
              `${metadata.provider} / ${metadata.model} connected. Preparing realtime microphone capture…`,
            );
          },
          onListening: (listening) => {
            setSpeechListening(listening);
            if (listening) {
              if (standaloneEditor) {
                setMediaResumeEnabled("microphone", true, window.localStorage);
                void refreshStandaloneMediaPermissions();
              }
              setSpeechRecognitionStatus("waiting");
              const metadata = realtimeSession?.getMetadata();
              setCommandFeedback(
                `Airo is listening${metadata ? ` via ${metadata.provider} / ${metadata.model}` : ""}. Say “Airo, add a user.”`,
              );
            }
          },
          onInterim: (transcript) => {
            voiceRouter.noteSpeechActivity();
            setSpeechHeardText(transcript);
            setSpeechRecognitionStatus("hearing");
          },
          onFinal: (transcript, event) => {
            const metadata = realtimeSession?.getMetadata();
            const traceMetadata = {
              engine: "realtime" as const,
              provider: event.provider ?? metadata?.provider,
              model: event.model ?? metadata?.model,
              confidence: event.confidence,
              turnIndex: event.turnIndex,
            };
            // Channel priority and dedup live in the router: gates outrank
            // the wake word, and one transcript routes at most one command.
            const { routed } = routeFinalTranscript(transcript, traceMetadata);
            reportFinalTranscript(transcript, routed, traceMetadata);
          },
          onProviderStatus: (event) => {
            if (event.provider && event.model) {
              setRealtimeSpeechMetadata((current) => ({
                provider: event.provider!,
                model: event.model!,
                sampleRate: current?.sampleRate ?? 16_000,
              }));
            }
          },
          onError: (message) => {
            if (standaloneEditor) {
              void refreshStandaloneMediaPermissions();
            }
            setSpeechRecognitionStatus("error");
            setCommandFeedback(message);
          },
          onAudioDropped: () => {
            setCommandFeedback(
              "Your network is slow, so some microphone audio was dropped. A command may be cut off — pause briefly and say it again.",
            );
          },
          onEnd: (reason) => {
            voiceRouter.reset();
            setVoiceGate(null);
            // If this session was already superseded (e.g. a model switch aborted
            // it and started a fresh one), it must not touch shared UI state — the
            // current session owns it. This prevents a stale "connection closed"
            // message from overwriting a freshly-starting session.
            if (speechSessionRef.current !== realtimeSession) {
              return;
            }
            speechSessionRef.current = null;
            setSpeechListening(false);
            setSpeechArmed(false);
            if (reason === "error" || reason === "closed") {
              setSpeechRecognitionStatus("error");
              if (reason === "closed") {
                setCommandFeedback(
                  "The realtime transcription connection closed. Start Airo to reconnect; typed commands still work.",
                );
              }
            } else {
              setSpeechRecognitionStatus("idle");
            }
          },
        },
        {
          apiBaseUrl: AIRBOARD_API_URL,
          ...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {}),
          language: typeof navigator === "undefined" ? "en-US" : navigator.language,
          model:
            selectedSpeechModelRef.current ||
            realtimeTranscriptionConfig?.defaultModel ||
            undefined,
          // Board labels bias this session's recognition toward the names on
          // screen; the transport bounds the merged list to the provider cap.
          keyterms: buildSessionKeyterms(boardRef.current),
        },
        // On Meet surfaces the iframe cannot capture the microphone itself;
        // the bridge extension streams it from the meeting page instead.
        isMeetSurface && !embeddedMediaCapture && meetMediaBridge
          ? {
              startPcmInput: (handlers: {
                onChunk: (samples: Float32Array, sampleRate: number) => void;
                onEnded: (reason: string) => void;
              }) => meetMediaBridge.startAudio(handlers),
            }
          : {},
      );
      if (!realtimeSession) {
        setSpeechRecognitionStatus("error");
        setCommandFeedback(
          "This browser cannot stream microphone audio. Typed commands remain available.",
        );
        return;
      }
      speechSessionRef.current = realtimeSession;
      setSpeechArmed(true);
      setSpeechHeardText("");
      setSpeechRecognitionStatus("waiting");
      setCommandFeedback("Connecting Airo to the realtime transcription service…");
      realtimeSession.start();
      return;
    }

    const browserSession = createBrowserWakeSpeechSession({
      onStart: () => {
        if (standaloneEditor) {
          setMediaResumeEnabled("microphone", true, window.localStorage);
          void refreshStandaloneMediaPermissions();
        }
        setSpeechArmed(true);
        setSpeechHeardText("");
        setSpeechRecognitionStatus("waiting");
        setCommandFeedback(
          "Airo is listening through the explicit Chrome fallback. Say “Airo, add a user.”",
        );
      },
      onListening: (listening) => setSpeechListening(listening),
      onHeard: ({ transcript, isFinal }) => {
        setSpeechHeardText(transcript);
        if (!isFinal) {
          voiceRouter.noteSpeechActivity();
          setSpeechRecognitionStatus("hearing");
          return;
        }
        // Gates outrank the wake word here too. Claiming the transcript in
        // the router is what deduplicates the session's own internal
        // wake-routing of the same transcript (see onCommand below).
        const gated = voiceRouter.routeGatedOnly(transcript);
        syncVoiceGateUi();
        if (gated) {
          dispatchVoiceDecision(gated, {
            engine: "browser-fallback",
            provider: "browser",
            model: "Web Speech API",
          });
          return;
        }
        reportFinalTranscript(transcript, false, {
          engine: "browser-fallback",
          provider: "browser",
          model: "Web Speech API",
        });
      },
      onWake: () => {
        setSpeechRecognitionStatus("wake-detected");
        setCommandFeedback("Airo heard the wake word…");
      },
      onCommand: ({ command, transcript, wakePhrase }) => {
        // The session wake-routes internally; the router enforces the
        // invariant that a gate-claimed transcript never routes twice.
        const decision = voiceRouter.acceptExternalWakeCommand({
          transcript,
          command,
          wakePhrase,
        });
        if (!decision) {
          return;
        }
        dispatchVoiceDecision(decision, {
          engine: "browser-fallback",
          provider: "browser",
          model: "Web Speech API",
        });
      },
      onEnd: (reason) => {
        voiceRouter.reset();
        setVoiceGate(null);
        setSpeechListening(false);
        setSpeechArmed(false);
        if (speechSessionRef.current === browserSession) {
          speechSessionRef.current = null;
        }
        if (reason === "error") {
          setSpeechRecognitionStatus("error");
          setCommandFeedback(
            "Airo stopped after a speech-recognition error. Typed commands still work.",
          );
        } else {
          setSpeechRecognitionStatus("idle");
        }
      },
      onError: (message, code) => {
        if (standaloneEditor) {
          void refreshStandaloneMediaPermissions();
        }
        setSpeechRecognitionStatus(code === "no-speech" ? "waiting" : "error");
        setCommandFeedback(message);
      },
    });
    if (!browserSession) {
      setSpeechRecognitionStatus("error");
      setCommandFeedback("Speech recognition is unavailable here. Type the same command instead.");
      return;
    }
    speechSessionRef.current = browserSession;
    setSpeechArmed(true);
    try {
      browserSession.start();
    } catch {
      speechSessionRef.current = null;
      setSpeechArmed(false);
      setSpeechListening(false);
      setSpeechRecognitionStatus("error");
      setCommandFeedback("Speech recognition is already active. Try again in a moment.");
    }
  }, [
    dispatchVoiceDecision,
    realtimeTranscriptionConfig?.defaultModel,
    refreshStandaloneMediaPermissions,
    routeFinalTranscript,
    speechEngine,
    speechSupported,
    standaloneEditor,
    embeddedMediaCapture,
    isMeetSurface,
    meetMediaBridge,
    syncVoiceGateUi,
    voiceCaptureAvailable,
    voiceRouter,
  ]);

  const toggleVoiceInput = useCallback(() => {
    if (standaloneEditor && (speechSessionRef.current || speechArmed)) {
      setMediaResumeEnabled("microphone", false, window.localStorage);
    }
    startVoiceCommand();
  }, [speechArmed, standaloneEditor, startVoiceCommand]);

  useEffect(() => {
    if (
      !standaloneEditor ||
      initialPreferences?.audioEnabled === false ||
      !speechSupported ||
      speechEngine === "loading" ||
      speechEngine === "unavailable" ||
      speechSessionRef.current ||
      standaloneVoiceResumeAttemptedRef.current
    ) {
      return;
    }
    standaloneVoiceResumeAttemptedRef.current = true;
    void queryMediaPermission("microphone").then((permission) => {
      setMicrophonePermission(permission);
      if (
        shouldResumeMedia(
          permission,
          mediaResumeEnabled("microphone", window.localStorage),
        ) &&
        !speechSessionRef.current
      ) {
        startVoiceCommand();
      }
    });
  }, [
    initialPreferences?.audioEnabled,
    speechEngine,
    speechSupported,
    standaloneEditor,
    startVoiceCommand,
  ]);

  const changeSpeechModel = useCallback((nextModel: string) => {
    const normalizedModel = nextModel.trim();
    if (!normalizedModel) {
      return;
    }
    const activeSession = speechSessionRef.current;
    if (activeSession) {
      speechSessionRef.current = null;
      activeSession.abort();
      setSpeechArmed(false);
      setSpeechListening(false);
      setSpeechRecognitionStatus("idle");
    }
    selectedSpeechModelRef.current = normalizedModel;
    setSelectedSpeechModel(normalizedModel);
    setRealtimeSpeechMetadata(null);
    if (activeSession) {
      setCommandFeedback(`Switching Airo to ${normalizedModel}…`);
      startVoiceCommand();
      return;
    }
    setCommandFeedback(`Voice model set to ${normalizedModel}. The next Airo session will use it.`);
  }, [startVoiceCommand]);

  const changeSemanticIntentModel = useCallback((nextModel: string) => {
    const normalizedModel = nextModel.trim();
    if (
      !normalizedModel ||
      !semanticIntentConfigRef.current?.allowedModels.includes(normalizedModel)
    ) {
      return;
    }
    semanticIntentRequestIdRef.current += 1;
    selectedSemanticIntentModelRef.current = normalizedModel;
    setSelectedSemanticIntentModel(normalizedModel);
    setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
    setCommandFeedback(
      `Intent model set to ${normalizedModel}. The next unclear command will use it.`,
    );
  }, []);

  const stopCamera = useCallback(() => {
    cameraStartInProgressRef.current = false;
    meetBridgeSessionRef.current?.stop();
    meetBridgeSessionRef.current = null;
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (video) {
      video.srcObject = null;
    }
    trackerRef.current?.close();
    trackerRef.current = null;
    canvasNavTrackerRef.current?.reset();
    setCanvasNavMode(null);
    snapGestureTrackerRef.current?.reset();
    undoGestureTrackerRef.current?.reset();
    if (palmVoiceGestureTrackerRef.current?.engaged) {
      closeVoiceGate("ptt");
    }
    palmVoiceGestureTrackerRef.current?.reset();
    setCameraStatus("idle");
    setCameraError(null);
  }, [closeVoiceGate]);

  const startCamera = useCallback(async () => {
    if (!cameraCaptureAvailable) {
      setCameraStatus("idle");
      setCameraError(null);
      return;
    }
    // Guard synchronously (state updates lag within a tick) and cover the whole
    // busy window including tracker_loading — the slow WASM/model download — so an
    // impatient second click cannot acquire a second stream + tracker.
    if (
      cameraStartInProgressRef.current ||
      cameraStatus === "starting" ||
      cameraStatus === "tracker_loading" ||
      cameraStatus === "active"
    ) {
      return;
    }
    cameraStartInProgressRef.current = true;
    enforceCameraCanvas();

    setCameraStatus("starting");
    setCameraError(null);

    // Release anything acquired if the component unmounted during an await.
    const releaseIfUnmounted = (stream: MediaStream | null, tracker: MediaPipeHandTracker | null) => {
      if (cameraMountedRef.current) {
        return false;
      }
      stream?.getTracks().forEach((track) => track.stop());
      tracker?.close();
      return true;
    };

    // On Meet surfaces without delegated permission, video arrives from the
    // bridge extension as ImageBitmaps; a canvas capture stream feeds the same
    // video element so the tracker and preview code stay identical.
    const bridge = isMeetSurface && !embeddedMediaCapture ? meetMediaBridge : null;
    const acquireBridgedStream = async (): Promise<MediaStream> => {
      if (!bridge) {
        throw new Error("Meet media bridge is unavailable");
      }
      const canvas = meetBridgeCanvasRef.current ?? document.createElement("canvas");
      meetBridgeCanvasRef.current = canvas;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context is unavailable");
      }
      const session = await bridge.startVideo({
        onFrame: (bitmap) => {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
        },
        onEnded: () => {
          meetBridgeSessionRef.current = null;
          stopCamera();
          setCameraError("The Meet camera bridge stopped. Click Enable hands to restart.");
        },
      });
      meetBridgeSessionRef.current = session;
      return canvas.captureStream(30);
    };

    try {
      const stream = bridge
        ? await acquireBridgedStream()
        : await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
      if (releaseIfUnmounted(stream, null)) {
        meetBridgeSessionRef.current?.stop();
        meetBridgeSessionRef.current = null;
        return;
      }
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element is unavailable");
      }

      video.srcObject = stream;
      await video.play();
      setCameraStatus("tracker_loading");
      const tracker = await MediaPipeHandTracker.create({
        wasmBaseUrl: "/vendor/mediapipe/wasm",
      });
      if (releaseIfUnmounted(stream, tracker)) {
        meetBridgeSessionRef.current?.stop();
        meetBridgeSessionRef.current = null;
        video.srcObject = null;
        return;
      }
      trackerRef.current = tracker;
      setCameraStatus("active");
      if (standaloneEditor) {
        setMediaResumeEnabled("camera", true, window.localStorage);
        void refreshStandaloneMediaPermissions();
      }
    } catch (error) {
      const isPermissionError = error instanceof DOMException && error.name === "NotAllowedError";
      const hadVideoStream = Boolean(videoRef.current?.srcObject);
      // Release the camera on any failure (commonly a MediaPipe WASM/model load
      // error). Otherwise the acquired MediaStream keeps the camera light on with
      // no live tracking, and a retry acquires a second stream, orphaning this one.
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) {
        video.srcObject = null;
      }
      meetBridgeSessionRef.current?.stop();
      meetBridgeSessionRef.current = null;
      trackerRef.current?.close();
      trackerRef.current = null;
      setCameraStatus(isPermissionError ? "blocked" : hadVideoStream ? "tracker_error" : "error");
      setCameraError(describeCameraError(error, hadVideoStream));
      if (standaloneEditor) {
        void refreshStandaloneMediaPermissions();
      }
    } finally {
      cameraStartInProgressRef.current = false;
    }
  }, [cameraCaptureAvailable, cameraStatus, embeddedMediaCapture, enforceCameraCanvas, isMeetSurface, meetMediaBridge, refreshStandaloneMediaPermissions, standaloneEditor, stopCamera]);

  const toggleCameraInput = useCallback(() => {
    if (cameraStatus === "active") {
      if (standaloneEditor) {
        setMediaResumeEnabled("camera", false, window.localStorage);
      }
      stopCamera();
      return;
    }
    void startCamera();
  }, [cameraStatus, standaloneEditor, startCamera, stopCamera]);

  useEffect(() => {
    if (
      !standaloneEditor ||
      initialPreferences?.videoEnabled === false ||
      cameraStatus !== "idle" ||
      standaloneCameraResumeAttemptedRef.current
    ) {
      return;
    }
    standaloneCameraResumeAttemptedRef.current = true;
    void queryMediaPermission("camera").then((permission) => {
      setCameraPermission(permission);
      if (
        shouldResumeMedia(
          permission,
          mediaResumeEnabled("camera", window.localStorage),
        ) &&
        cameraStatus === "idle"
      ) {
        void startCamera();
      }
    });
  }, [
    cameraStatus,
    initialPreferences?.videoEnabled,
    standaloneEditor,
    startCamera,
  ]);

  // The extension-owned engine has no visible controls by design. Once its
  // bridge and transcription configuration are ready, enable both Airboard
  // inputs using the same lifecycle paths as the former buttons.
  useEffect(() => {
    if (
      headlessMeetOverlay &&
      meetMediaBridge &&
      cameraStatus === "idle" &&
      !headlessCameraRequestedRef.current
    ) {
      headlessCameraRequestedRef.current = true;
      void startCamera();
    }
  }, [cameraStatus, headlessMeetOverlay, meetMediaBridge, startCamera]);

  useEffect(() => {
    if (
      headlessMeetOverlay &&
      meetMediaBridge &&
      speechSupported &&
      speechEngine === "realtime" &&
      !speechSessionRef.current &&
      !headlessVoiceRequestedRef.current
    ) {
      headlessVoiceRequestedRef.current = true;
      startVoiceCommand();
    }
  }, [headlessMeetOverlay, meetMediaBridge, speechEngine, speechSupported, startVoiceCommand]);

  const clearBoard = useCallback(() => {
    semanticIntentRequestIdRef.current += 1;
    voiceCorrectionPendingRef.current = null;
    setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
    commitStroke(activeStrokeIdRef.current);
    // Capture every committed stroke (including the one just committed above) and
    // the current selection so the clear can be undone as a single action.
    const clearedStrokeIds = Object.values(boardRef.current.strokes)
      .filter((stroke) => stroke.status === "committed")
      .map((stroke) => stroke.id);
    const selectionBeforeClear = selectedAnnotationIdsRef.current.slice();
    activeStrokeIdRef.current = null;
    pointerStrokeIdRef.current = null;
    touchpadPointsRef.current = [];
    gesturePathRef.current = [];
    lastGesturePointerRef.current = null;
    objectInteractionRef.current = null;
    objectInteractionInitialStateRef.current = null;
    cameraPlacementActiveRef.current = false;
    cameraPlacementArmedToolRef.current = null;
    cameraGrabActiveRef.current = false;
    pendingIntentRef.current = null;
    setActiveObjectTool("select");
    setSelectedAnnotationId(null);
    setSelectedAnnotationIds([]);
    setHoverStrokeId(null);
    setGhostAnnotation(null);
    setGhostAnnotations([]);
    setAlignmentGuides([]);
    setLabelDraft("");
    setEditingAnnotationId(null);
    setLastGestureIntent(null);
    setPendingIntent(null);
    setIntentCommandText("");
    applyLocalEvent({
      ...createEventEnvelope({
        boardSessionId: boardSessionIdRef.current,
        actorParticipantId: PARTICIPANT_ID,
      }),
      type: "board.cleared",
    });
    // The clear is now a single undoable action: restoring the cleared strokes
    // rebuilds the board. Prior history is dropped because those events no longer
    // apply to the cleared board, but the clear itself can be reverted.
    if (clearedStrokeIds.length > 0) {
      undoStackRef.current = [
        {
          type: "diagram",
          selectionBefore: selectionBeforeClear,
          undoEvents: [
            {
              ...createEventEnvelope({
                boardSessionId: boardSessionIdRef.current,
                actorParticipantId: PARTICIPANT_ID,
              }),
              type: "stroke.restored",
              strokeIds: clearedStrokeIds,
            },
          ],
        },
      ];
      setCommandFeedback(
        "Board cleared. Press Undo or Cmd/Ctrl+Z to restore it.",
      );
    } else {
      undoStackRef.current = [];
      setCommandFeedback("Board cleared. Describe the next diagram you want to create.");
    }
    setClearArmed(false);
  }, [applyLocalEvent, commitStroke]);

  // Two-step confirm so a single misclick can't wipe the board. The first click
  // arms the button; a second click within a few seconds performs the clear. The
  // clear itself is also undoable as a safety net.
  const handleClearClick = useCallback(() => {
    if (clearArmTimeoutRef.current) {
      clearTimeout(clearArmTimeoutRef.current);
      clearArmTimeoutRef.current = null;
    }
    if (clearArmed) {
      clearBoard();
      return;
    }
    setClearArmed(true);
    setCommandFeedback("Press Clear again to confirm clearing the board.");
    clearArmTimeoutRef.current = setTimeout(() => {
      setClearArmed(false);
      clearArmTimeoutRef.current = null;
    }, 4000);
  }, [clearArmed, clearBoard]);

  useEffect(
    () => () => {
      if (clearArmTimeoutRef.current) {
        clearTimeout(clearArmTimeoutRef.current);
      }
    },
    [],
  );

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = exportCanvasPng(canvas);
    anchor.download = `airboard-${new Date().toISOString().replaceAll(":", "-")}.png`;
    anchor.click();
  }, []);

  useEffect(() => {
    render();
    const handleResize = () => render();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [render]);

  useEffect(() => {
    let cancelled = false;
    setSpeechEngine("loading");
    setSpeechSupported(false);

    const useExplicitBrowserFallback = (reason: string) => {
      if (BROWSER_SPEECH_FALLBACK_ENABLED && supportsBrowserSpeech()) {
        setSpeechEngine("browser-fallback");
        setSpeechSupported(true);
        setCommandFeedback(
          `${reason} Using the explicitly enabled Chrome speech fallback; typed commands still work.`,
        );
        return true;
      }
      return false;
    };

    void fetchRealtimeTranscriptionConfig(AIRBOARD_API_URL)
      .then((config) => {
        if (cancelled) {
          return;
        }
        setRealtimeTranscriptionConfig(config);
        const configuredModel =
          config.defaultModel ?? config.allowedModels[0] ?? "";
        setSelectedSpeechModel((current) => {
          const resolvedModel =
            current && config.allowedModels.includes(current) ? current : configuredModel;
          selectedSpeechModelRef.current = resolvedModel;
          return resolvedModel;
        });

        if (config.available && supportsRealtimeSpeech()) {
          setSpeechEngine("realtime");
          setSpeechSupported(true);
          setCommandFeedback(
            `Realtime Airo is ready (${config.provider ?? "provider"} / ${configuredModel || "default model"}). Typed commands also work.`,
          );
          return;
        }

        const reason = config.available
          ? "This browser cannot stream microphone audio."
          : "Realtime voice is not configured on the Airboard API.";
        if (useExplicitBrowserFallback(reason)) {
          return;
        }
        setSpeechEngine("unavailable");
        setSpeechSupported(false);
        setCommandFeedback(
          `${reason} Add the provider key on the API to enable Airo; typed commands remain available.`,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const reason = "The realtime transcription service is unreachable.";
        if (useExplicitBrowserFallback(reason)) {
          return;
        }
        setSpeechEngine("unavailable");
        setSpeechSupported(false);
        setCommandFeedback(
          `${reason} Start the Airboard API, or keep using typed commands.`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [speechConfigRevision]);

  useEffect(() => {
    let cancelled = false;
    void fetchSemanticIntentConfig(AIRBOARD_API_URL)
      .then((config) => {
        if (cancelled) {
          return;
        }
        semanticIntentConfigRef.current = config;
        setSemanticIntentConfig(config);
        const configuredModel = config.defaultModel ?? config.allowedModels[0] ?? "";
        setSelectedSemanticIntentModel((current) => {
          const resolvedModel =
            current && config.allowedModels.includes(current) ? current : configuredModel;
          selectedSemanticIntentModelRef.current = resolvedModel;
          return resolvedModel;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        semanticIntentConfigRef.current = null;
        setSemanticIntentConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [speechConfigRevision]);

  useEffect(() => {
    if (inputMode !== "touchpad") {
      return;
    }

    if (inputPaused) {
      endActiveTouchpadInteraction("PAUSED");
      setTouchpadState("PAUSED");
      return;
    }

    if (touchpadState === "PAUSED") {
      setTouchpadState(shortcutsActiveRef.current ? "HOVER" : "IDLE");
    }
  }, [endActiveTouchpadInteraction, inputMode, inputPaused, touchpadState]);

  /**
   * Gesture ground-truth recorder: captures 5s of raw hand landmarks to a
   * downloadable JSON trace for the gesture-engine replay harness, so pose
   * thresholds can be calibrated against real hands instead of synthetic
   * fixtures.
   */
  const startLandmarkTraceRecording = useCallback(() => {
    landmarkTraceRef.current = { startedAt: performance.now(), frames: [] };
    setLandmarkRecordingActive(true);
    setCommandFeedback(
      "Recording hand landmarks for 5 seconds — perform the pose you want to calibrate.",
    );
  }, []);

  const captureLandmarkFrame = useCallback(
    (hands: readonly DetectedHand[], timestampMs: number) => {
      const recording = landmarkTraceRef.current;
      if (!recording) {
        return;
      }
      recording.frames.push({
        t: Math.round(timestampMs - recording.startedAt),
        hands: hands.map((hand) => ({
          handedness: hand.handedness,
          score: hand.handednessScore,
          landmarks: hand.landmarks.map(
            (landmark) => [landmark.x, landmark.y, landmark.z ?? 0] as [number, number, number],
          ),
        })),
      });
      if (timestampMs - recording.startedAt < 5_000) {
        return;
      }
      landmarkTraceRef.current = null;
      setLandmarkRecordingActive(false);
      const framesWithHands = recording.frames.filter(
        (frame) => frame.hands.length > 0,
      ).length;
      if (framesWithHands === 0) {
        setCommandFeedback(
          "No hand landmarks were detected during the 5-second recording, so no empty trace was downloaded. Keep one full hand inside the camera frame and try again.",
        );
        return;
      }
      const trace = {
        schemaVersion: "1.0",
        recordedAt: new Date().toISOString(),
        captureSummary: {
          totalFrames: recording.frames.length,
          framesWithHands,
        },
        frames: recording.frames,
      };
      const blob = new Blob([JSON.stringify(trace)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `landmark-trace-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setCommandFeedback(
        "Landmark trace downloaded. Add it to packages/gesture-engine/test/fixtures to extend the replay harness.",
      );
    },
    [],
  );

  const updateSnapGesture = useCallback(
    (
      hands: readonly DetectedHand[],
      timestampMs: number,
    ): SnapGestureTrackerResult => {
      return processSnapGestureFrame({
        hands: hands.map((hand) => ({
          handedness: hand.handedness,
          confidence: snapLandmarkFrameConfidence(hand.landmarks),
          landmarks: hand.landmarks,
        })),
        timestampMs,
        suppressed:
          inputPaused ||
          canvasNavTrackerRef.current?.engaged === true ||
          objectInteractionRef.current !== null ||
          cameraGrabActiveRef.current ||
          cameraPlacementActiveRef.current ||
          activeStrokeIdRef.current !== null ||
          pointerStrokeIdRef.current !== null ||
          pointerErasingRef.current,
      });
    },
    [inputPaused, processSnapGestureFrame],
  );

  /**
   * Airboard's landmark-defined open palm moving left is Undo. A stationary
   * open palm can still arm Voice and drive the cursor. Only a completed
   * directional swipe owns the frame and preempts pointer manipulation.
   */
  const updateUndoGesture = useCallback(
    (hands: readonly DetectedHand[], timestampMs: number): UndoGestureEvent => {
      const openPalm = selectSingleLandmarkPose(
        hands,
        estimatePalmPresentation,
      );
      const voiceSnapshot = voiceRouter.snapshot;
      return processUndoGestureFrame({
        score: openPalm.score,
        point: openPalm.point,
        timestampMs,
        suppressed:
          openPalm.trackedHands !== 1 ||
          inputPaused ||
          Boolean(voiceSnapshot?.open) ||
          canvasNavTrackerRef.current?.reserving === true ||
          objectInteractionRef.current !== null ||
          cameraGrabActiveRef.current ||
          cameraPlacementActiveRef.current ||
          activeStrokeIdRef.current !== null ||
          pointerStrokeIdRef.current !== null ||
          pointerErasingRef.current,
      });
    },
    [inputPaused, processUndoGestureFrame, voiceRouter],
  );

  /**
   * Airboard's landmark-defined open palm held still briefly opens the command
   * mic gate. Dropping the palm closes it after a short release debounce, with
   * one activation per neutral-hand reset. Undo owns the same open palm swept
   * left, so a still palm means "talk" and a leftward sweep means "undo".
   */
  const updatePalmVoiceGesture = useCallback(
    (hands: readonly DetectedHand[], timestampMs: number) => {
      const palm = selectSingleLandmarkPose(
        hands,
        estimatePalmPresentation,
      );
      const snapshot = voiceRouter.snapshot;
      return processPalmVoiceGestureFrame({
        score: palm.score,
        point: palm.point,
        timestampMs,
        suppressed:
          inputPaused ||
          (snapshot?.mode === "scoped" && snapshot.open) ||
          palm.trackedHands !== 1 ||
          canvasNavTrackerRef.current?.reserving === true ||
          objectInteractionRef.current !== null ||
          cameraGrabActiveRef.current ||
          cameraPlacementActiveRef.current ||
          activeStrokeIdRef.current !== null ||
          pointerStrokeIdRef.current !== null ||
          pointerErasingRef.current,
      });
    },
    [inputPaused, processPalmVoiceGestureFrame, voiceRouter],
  );

  useEffect(() => {
    if (inputMode === "gesture" && !inputPaused) {
      return;
    }
    if (palmVoiceGestureTrackerRef.current!.engaged) {
      closeVoiceGate("ptt");
    }
    palmVoiceGestureTrackerRef.current!.reset();
    undoGestureTrackerRef.current!.reset();
  }, [closeVoiceGate, inputMode, inputPaused]);

  /**
   * Hold-to-edit and gate housekeeping. Grabbing an element (hand or pointer)
   * and holding it still scopes the mic to that element; the scoped gate then
   * survives release for a grace window so "grab, let go, speak" works.
   * Closed gates expire here once their grace lapses.
   */
  useEffect(() => {
    if (inputMode !== "gesture") {
      return;
    }
    const timer = setInterval(() => {
      if (voiceRouter.expire()) {
        syncVoiceGateUi();
      }

      const interaction = objectInteractionRef.current;
      const snapshot = voiceRouter.snapshot;
      const movingStrokeId = interaction?.mode === "moving" ? interaction.strokeId : null;
      const event = holdToEditTrackerRef.current!.update({
        interaction: movingStrokeId
          ? { strokeId: movingStrokeId, point: lastGesturePointerRef.current }
          : null,
        now: Date.now(),
        scopedActiveForStroke:
          snapshot?.mode === "scoped" &&
          snapshot.open &&
          snapshot.strokeId === movingStrokeId,
      });
      if (event?.type === "scope") {
        openVoiceGate({ mode: "scoped", strokeId: event.strokeId });
      } else if (
        event?.type === "released" &&
        snapshot?.mode === "scoped" &&
        snapshot.open &&
        !scopedKeyActiveRef.current
      ) {
        closeVoiceGate("scoped");
      }
    }, 150);
    return () => clearInterval(timer);
  }, [closeVoiceGate, inputMode, openVoiceGate, syncVoiceGateUi, voiceRouter]);

  useEffect(() => {
    // Only run the detection loop while the camera is actually active. Previously
    // the loop rescheduled every frame regardless of camera state, waking the main
    // thread continuously (and draining battery) even in touchpad mode.
    if (cameraStatus !== "active") {
      return;
    }

    let animationFrame = 0;
    let lastDetectionAt = 0;

    const loop = (timestampMs: number) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const tracker = trackerRef.current;

      if (
        canvas &&
        video &&
        tracker &&
        cameraStatus === "active" &&
        timestampMs - lastDetectionAt >= 32
      ) {
        lastDetectionAt = timestampMs;
        const hands = tracker.detect(video, timestampMs);
        setStats((currentStats) => ({
          ...currentStats,
          handsDetected: hands.length,
        }));
        const rect = canvas.getBoundingClientRect();
        const cameraMapping: CanvasMapping = {
          canvasWidth: rect.width,
          canvasHeight: rect.height,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
          fitMode: "cover",
          mirrorInput: true,
          sensitivity,
        };
        const result = pipelineRef.current.process({
          hands,
          timestampMs,
          config: gestureConfig,
          frictionConfig,
          frictionPreset,
          markerInputMode,
          paused: inputPaused,
          mapping: cameraMapping,
        });
        let hybridOutput: HybridGestureControllerOutput | undefined;
        if (inputMode === "gesture") {
          const roundedWidth = Math.max(1, Math.round(rect.width));
          const roundedHeight = Math.max(1, Math.round(rect.height));
          const controllerSize = hybridGestureCanvasSizeRef.current;
          if (
            !hybridGestureControllerRef.current ||
            controllerSize.width !== roundedWidth ||
            controllerSize.height !== roundedHeight ||
            controllerSize.minTrackingConfidence !== confidenceThreshold
          ) {
            hybridGestureControllerRef.current = new HybridGestureController({
              canvasWidth: roundedWidth,
              canvasHeight: roundedHeight,
              mirrorX: true,
              minTrackingConfidence: confidenceThreshold,
              hoverSmoothingTimeMs: 72,
              hoverDeadZonePx: 2.25,
              dragGain: 0.74,
              dragSmoothingTimeMs: 58,
              dragDeadZonePx: 1.25,
              areaCursorRadiusPx: 54,
              stickyReleaseRadiusPx: 88,
              trackingLossTimeoutMs: 420,
              grabReacquireGraceMs: 620,
              pinch: {
                engageThreshold: 0.6,
                releaseThreshold: 0.3,
                engageDebounceMs: 55,
                releaseDebounceMs: 80,
              },
            });
            hybridGestureCanvasSizeRef.current = {
              width: roundedWidth,
              height: roundedHeight,
              minTrackingConfidence: confidenceThreshold,
            };
          }

          const signal = selectLandmarkManipulationSignal(
            hands,
            result?.hand,
            cameraMapping,
          );
          captureLandmarkFrame(hands, timestampMs);

          // Visibility remains available while the diagram is hidden, but all
          // other board gestures stay suspended so no invisible edit can occur.
          if (!diagramVisibleRef.current) {
            canvasNavTrackerRef.current!.reset();
            updateSnapGesture(hands, timestampMs);
            handleGesture(null, undefined);
            animationFrame = requestAnimationFrame(loop);
            return;
          }

          const navTracker = canvasNavTrackerRef.current!;
          const frameOwner = arbitrateGestureFrame({
            // Two-hand navigation outranks every one-hand gesture. Its
            // reservation window prevents pan/zoom from grabbing an object or
            // opening the command microphone.
            navigation: {
              update: () => {
                const navigationHands = collectLandmarkNavigationHands(
                  hands,
                  cameraMapping,
                );
                const navUpdate = navTracker.update({
                  hands: navigationHands,
                  timestampMs,
                });
                if (
                  !shouldReserveLandmarkNavigation(
                    hands.length,
                    navTracker.reserving,
                  )
                ) {
                  setCanvasNavMode((mode) => (mode === null ? mode : null));
                  return false;
                }
                if (navTracker.engaged) {
                  setCanvasNavMode((mode) =>
                    mode === navTracker.mode ? mode : navTracker.mode,
                  );
                  const viewport = boardViewportRef.current;
                  if (navUpdate.mode === "pan") {
                    applyViewport(
                      panViewport(
                        viewport,
                        navUpdate.dx,
                        navUpdate.dy,
                        currentViewportLimits(),
                      ),
                    );
                  } else if (navUpdate.mode === "zoom") {
                    applyViewport(
                      zoomViewport(
                        viewport,
                        navUpdate.factor,
                        navUpdate.anchor,
                        currentViewportLimits(),
                      ),
                    );
                  }
                } else {
                  setCanvasNavMode((mode) => (mode === null ? mode : null));
                }
                return true;
              },
            },
            // A pending snap owns its complete contact→release window. Curled
            // contact frames therefore cannot fall through into manipulation.
            snap: {
              update: () => updateSnapGesture(hands, timestampMs) !== null,
              onPreempted: () => {
                snapGestureTrackerRef.current!.reset();
              },
            },
            undo: {
              update: () => updateUndoGesture(hands, timestampMs) === "undo",
              onPreempted: () => {
                undoGestureTrackerRef.current!.reset();
              },
            },
            voice: {
              // Voice observes the same open-palm frames that drive normal
              // hover. A still hold can open the mic without freezing the air
              // cursor; closing the hand remains the only grab/drag edge.
              observe: () => {
                updatePalmVoiceGesture(hands, timestampMs);
              },
              onPreempted: () => {
                if (palmVoiceGestureTrackerRef.current!.engaged) {
                  closeVoiceGate("ptt");
                }
                palmVoiceGestureTrackerRef.current!.reset();
              },
            },
            manipulation: {
              onPreempted: () => {
                hybridGestureControllerRef.current!.reset({
                  requirePinchRelease: true,
                });
                hybridPinchClosedRef.current = false;
              },
              run: () => {
                const viewportForTargets = boardViewportRef.current;
                const catalogOwnsPointer =
                  dockGestureHoverRef.current !== null ||
                  objectInteractionRef.current?.mode === "catalog_carrying";
                const screenTargets = catalogOwnsPointer
                  ? []
                  : buildGestureMoveTargets(boardRef.current).map((target) => ({
                      ...target,
                      bounds: {
                        x:
                          target.bounds.x * viewportForTargets.scale +
                          viewportForTargets.x,
                        y:
                          target.bounds.y * viewportForTargets.scale +
                          viewportForTargets.y,
                        width:
                          target.bounds.width * viewportForTargets.scale,
                        height:
                          target.bounds.height * viewportForTargets.scale,
                      },
                    }));
                hybridOutput = hybridGestureControllerRef.current!.update({
                  handPoint: signal?.point ?? null,
                  trackingConfidence: signal?.trackingConfidence ?? 0,
                  pinchStrength: signal?.grabStrength ?? 0,
                  grabConfidence: signal?.grabConfidence ?? 0,
                  timestampMs,
                  // Camera targeting exposes committed object bodies only.
                  // There are no resize handles or empty-canvas targets.
                  targets: screenTargets,
                });
                setHandControlDiagnostics({
                  trackingConfidence: signal?.trackingConfidence ?? 0,
                  grabStrength: signal?.grabStrength ?? 0,
                  grabConfidence: signal?.grabConfidence ?? 0,
                  focusedTargetId: hybridOutput.focusedTargetId,
                  grabbedTargetId: hybridOutput.grabbedTargetId,
                  placementActive: cameraPlacementActiveRef.current,
                  controllerState: hybridOutput.state,
                  requiresPinchRelease: hybridOutput.requiresPinchRelease,
                });
              },
            },
          });
          if (frameOwner !== "manipulation") {
            handleGesture(null, undefined);
            animationFrame = requestAnimationFrame(loop);
            return;
          }
        }
        handleGesture(result, hybridOutput);
      }

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    cameraStatus,
    confidenceThreshold,
    frictionConfig,
    frictionPreset,
    gestureConfig,
    handleGesture,
    inputPaused,
    inputMode,
    markerInputMode,
    applyViewport,
    captureLandmarkFrame,
    currentViewportLimits,
    sensitivity,
    closeVoiceGate,
    updateSnapGesture,
    updateUndoGesture,
    updatePalmVoiceGesture,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isEditableTarget) {
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "h" && !event.repeat) {
        event.preventDefault();
        setDiagramVisibility(!diagramVisibleRef.current, "keyboard");
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        undoLastAction();
        return;
      }

      if (inputMode === "touchpad" && shortcutsActiveRef.current && event.key.toLowerCase() === "e") {
        event.preventDefault();
        temporaryEraserActiveRef.current = true;
        setTemporaryEraserActive(true);
        return;
      }

      if (inputMode === "touchpad" && shortcutsActiveRef.current && event.key === "Shift") {
        straightLineActiveRef.current = true;
        return;
      }

      if (inputMode === "touchpad" && shortcutsActiveRef.current && event.code === "Space") {
        event.preventDefault();
        panActiveRef.current = true;
        if (!pointerStrokeIdRef.current && !pointerErasingRef.current) {
          setTouchpadState("PANNING");
        }
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setInputPaused((value) => !value);
      }

      if (inputMode === "gesture" && (event.key === "Delete" || event.key === "Backspace")) {
        if (selectedAnnotationIds.length === 0) {
          return;
        }
        event.preventDefault();
        prepareIntentCommand("delete selected");
        return;
      }

      // Camera-off parity for hold-to-edit: holding V with a single selected
      // object scopes the mic to it, exactly like grab-and-hold does by hand.
      if (
        voiceCaptureAvailable &&
        inputMode === "gesture" &&
        shortcutsActiveRef.current &&
        event.key.toLowerCase() === "v" &&
        !event.repeat
      ) {
        const selected = selectedAnnotationIdsRef.current;
        if (selected.length === 1 && selected[0]) {
          event.preventDefault();
          scopedKeyActiveRef.current = true;
          openVoiceGate({ mode: "scoped", strokeId: selected[0] });
        }
        return;
      }

      // Keyboard object navigation while the canvas is focused: Tab / Shift+Tab
      // step the selection through committed objects so a keyboard-only user can
      // reach, then label, any object without a pointer. Crucially this is NOT a
      // focus trap — at the ends of the list Tab is allowed to fall through to the
      // browser's native focus movement, so focus can always leave the canvas
      // (WCAG 2.1.2). Enter/exit follows the standard composite-widget pattern.
      if (shortcutsActiveRef.current && event.key === "Tab") {
        const objectIds = getSelectableAnnotationIds(boardRef.current);
        if (objectIds.length > 0) {
          const current = selectedAnnotationIdsRef.current;
          const currentId = current.length === 1 ? current[0] : null;
          const currentIndex = currentId ? objectIds.indexOf(currentId) : -1;
          const selectAt = (index: number) => {
            const nextId = objectIds[index]!;
            setSelectedAnnotationId(nextId);
            setSelectedAnnotationIds([nextId]);
            setEditingAnnotationId(null);
          };
          if (!event.shiftKey) {
            if (currentIndex === -1) {
              event.preventDefault();
              selectAt(0);
              return;
            }
            if (currentIndex < objectIds.length - 1) {
              event.preventDefault();
              selectAt(currentIndex + 1);
              return;
            }
            // At the last object: let focus leave the canvas forward.
          } else {
            if (currentIndex > 0) {
              event.preventDefault();
              selectAt(currentIndex - 1);
              return;
            }
            // At the first object (or none selected): let focus leave backward.
          }
        }
      }

      // Enter / F2 open the label editor for the single selected object, mirroring
      // double-click. The auto-focus effect then puts the cursor in the input.
      if (shortcutsActiveRef.current && (event.key === "Enter" || event.key === "F2")) {
        const current = selectedAnnotationIdsRef.current;
        if (current.length === 1) {
          const stroke = boardRef.current.strokes[current[0]!];
          if (stroke?.annotation && annotationNeedsLabel(stroke.annotation)) {
            event.preventDefault();
            setLabelDraft(stroke.annotation.label ?? "");
            setEditingAnnotationId(current[0]!);
            return;
          }
        }
      }

      if (event.key === "Escape") {
        if (pendingIntentRef.current) {
          cancelPendingIntent();
          return;
        }
        endActiveTouchpadInteraction("HOVER");
        commitStroke(activeStrokeIdRef.current, {
          discard: inputMode === "gesture",
        });
        activeStrokeIdRef.current = null;
        pointerStrokeIdRef.current = null;
        gesturePathRef.current = [];
        setSelectedAnnotationId(null);
        setSelectedAnnotationIds([]);
        setLabelDraft("");
        setEditingAnnotationId(null);
        if (inputMode === "gesture") {
          cancelObjectInteraction();
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "e") {
        temporaryEraserActiveRef.current = false;
        setTemporaryEraserActive(false);
      }

      if (event.key.toLowerCase() === "v" && scopedKeyActiveRef.current) {
        scopedKeyActiveRef.current = false;
        closeVoiceGate("scoped");
      }

      if (event.key === "Shift") {
        straightLineActiveRef.current = false;
      }

      if (event.code === "Space") {
        panActiveRef.current = false;
        if (inputMode === "touchpad" && touchpadState === "PANNING") {
          setTouchpadState("HOVER");
        }
      }
    };

    const handleBlur = () => {
      endActiveTouchpadInteraction("PAUSED");
      setTouchpadState("PAUSED");
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    cancelObjectInteraction,
    cancelPendingIntent,
    closeVoiceGate,
    commitStroke,
    endActiveTouchpadInteraction,
    inputMode,
    openVoiceGate,
    prepareIntentCommand,
    selectedAnnotationIds,
    setDiagramVisibility,
    touchpadState,
    undoLastAction,
    voiceCaptureAvailable,
  ]);

  useEffect(() => {
    return () => {
      // Signal any in-flight startCamera to release what it acquires after its await.
      cameraMountedRef.current = false;
      speechSessionRef.current?.abort();
      trackerRef.current?.close();
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      screenUnderlayStartInProgressRef.current = false;
      stopMediaStream(screenUnderlayStreamRef.current);
      screenUnderlayStreamRef.current = null;
      if (screenUnderlayVideoRef.current) {
        screenUnderlayVideoRef.current.srcObject = null;
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.currentTarget.focus();
      shortcutsActiveRef.current = true;
      setShortcutsActive(true);

      if (inputPaused) {
        setTouchpadState("PAUSED");
        return;
      }

      if (inputMode === "gesture") {
        event.preventDefault();
        const point = toBoardPoint(getCanvasPoint(event));
        if (event.shiftKey) {
          const hitStroke = findAnnotationObjectAtPoint(boardRef.current, point);
          if (hitStroke) {
            toggleAnnotationObject(hitStroke.id);
            setHoverStrokeId(hitStroke.id);
          }
          moveCursorPoint({ point, mode: "marker_hover", inputSource: "pointer" });
          return;
        }
        activePointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.altKey) {
          const eraserPoint = makePoint(point.x, point.y);
          eraserPoint.inputSource = "pointer";
          pointerErasingRef.current = true;
          activeEraseAffectedStrokeIdsRef.current = new Set(eraseAt(eraserPoint, ERASER_RADIUS));
          selectAnnotationObject(null);
          moveCursorPoint({ point, mode: "erasing", inputSource: "pointer" });
          return;
        }
        beginObjectInteraction(point);
        moveCursorPoint({ point, mode: "writing", inputSource: "pointer" });
        return;
      }

      if (inputMode !== "touchpad") {
        const point = toBoardPoint(getCanvasPoint(event));
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.altKey || event.shiftKey) {
          pointerErasingRef.current = true;
          eraseAt(makePoint(point.x, point.y));
          return;
        }

        pointerErasingRef.current = false;
        startStroke(makePoint(point.x, point.y));
        pointerStrokeIdRef.current = activeStrokeIdRef.current;
        return;
      }

      event.preventDefault();
      const point = normalizePointerEvent(event.nativeEvent, event.currentTarget);
      activePointerIdRef.current = event.pointerId;
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      if (panActiveRef.current) {
        setTouchpadState("PANNING");
        moveCursorPoint({ point, mode: "panning", inputSource: "touchpad" });
        return;
      }

      if (touchpadTool === "eraser" || temporaryEraserActiveRef.current || event.altKey) {
        pointerErasingRef.current = true;
        setTouchpadState("ERASING");
        activeEraseAffectedStrokeIdsRef.current = new Set(
          eraseAt(point, touchpadConfig.eraser.defaultRadiusPx),
        );
        return;
      }

      pointerErasingRef.current = false;
      setTouchpadState("DRAWING");
      touchpadPointsRef.current = [point];
      lastTouchpadPointRef.current = point;
      startStroke(point, {
        color: touchpadConfig.stroke.defaultColor,
        thickness: touchpadConfig.stroke.defaultThickness,
      });
      pointerStrokeIdRef.current = activeStrokeIdRef.current;
      moveCursorPoint({ point, mode: "writing", inputSource: "touchpad" });
    },
    [
      eraseAt,
      beginObjectInteraction,
      inputMode,
      inputPaused,
      makePoint,
      moveCursorPoint,
      selectAnnotationObject,
      startStroke,
      touchpadConfig,
      touchpadTool,
      toggleAnnotationObject,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (inputMode === "touchpad") {
        if (inputPaused) {
          return;
        }

        const point = normalizePointerEvent(event.nativeEvent, event.currentTarget);
        if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
          return;
        }

        if (pointerErasingRef.current) {
          event.preventDefault();
          const affectedStrokeIds = eraseAt(point, touchpadConfig.eraser.defaultRadiusPx);
          affectedStrokeIds.forEach((strokeId) =>
            activeEraseAffectedStrokeIdsRef.current.add(strokeId),
          );
          return;
        }

        if (pointerStrokeIdRef.current) {
          event.preventDefault();
          const smoothedPoint = smoothLiveTouchpadPoint(
            lastTouchpadPointRef.current,
            point,
            touchpadConfig,
          );
          if (
            shouldAddTouchpadPoint(
              lastTouchpadPointRef.current,
              smoothedPoint,
              touchpadConfig.stroke.minPointDistancePx,
            )
          ) {
            touchpadPointsRef.current.push(smoothedPoint);
            lastTouchpadPointRef.current = smoothedPoint;
            appendStrokePoint(pointerStrokeIdRef.current, smoothedPoint);
            moveCursorPoint({ point: smoothedPoint, mode: "writing", inputSource: "touchpad" });
          }
          return;
        }

        moveCursorPoint({
          point,
          mode: touchpadTool === "eraser" || temporaryEraserActiveRef.current ? "erasing" : "marker_hover",
          inputSource: "touchpad",
        });
        setTouchpadState("HOVER");
        return;
      }

      if (inputMode === "gesture") {
        if (inputPaused) {
          return;
        }

        if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
          return;
        }

        const canvasPoint = toBoardPoint(getCanvasPoint(event));
        event.preventDefault();
        moveObjectInteraction(canvasPoint);
        moveCursorPoint({
          point: canvasPoint,
          mode: pointerErasingRef.current ? "erasing" : "marker_hover",
          inputSource: "pointer",
        });
        return;
      }

      if (pointerErasingRef.current) {
        const point = toBoardPoint(getCanvasPoint(event));
        eraseAt(makePoint(point.x, point.y));
        return;
      }

      if (!pointerStrokeIdRef.current) {
        return;
      }

      const point = toBoardPoint(getCanvasPoint(event));
      appendStrokePoint(pointerStrokeIdRef.current, makePoint(point.x, point.y));
    },
    [
      appendStrokePoint,
      eraseAt,
      inputMode,
      inputPaused,
      makePoint,
      moveObjectInteraction,
      moveCursorPoint,
      touchpadConfig,
      touchpadTool,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (inputMode === "touchpad") {
        event.preventDefault();
        endActiveTouchpadInteraction("HOVER");
        return;
      }

      if (inputMode === "gesture") {
        event.preventDefault();
        endObjectInteraction(toBoardPoint(getCanvasPoint(event)));
        pointerStrokeIdRef.current = null;
        activePointerIdRef.current = null;
        return;
      }

      commitStroke(pointerStrokeIdRef.current);
      pointerStrokeIdRef.current = null;
      pointerErasingRef.current = false;
    },
    [commitStroke, endActiveTouchpadInteraction, endObjectInteraction, inputMode],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (inputMode !== "gesture") {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const point = toBoardPoint({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      const hitStroke = findAnnotationObjectAtPoint(boardRef.current, point);
      if (!hitStroke?.annotation || !annotationNeedsLabel(hitStroke.annotation)) {
        return;
      }

      event.preventDefault();
      setSelectedAnnotationId(hitStroke.id);
      setSelectedAnnotationIds([hitStroke.id]);
      setLabelDraft(hitStroke.annotation.label ?? "");
      setEditingAnnotationId(hitStroke.id);
    },
    [inputMode],
  );

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (inputMode !== "touchpad" || activePointerIdRef.current === null) {
        return;
      }

      if (!event.currentTarget.hasPointerCapture?.(activePointerIdRef.current)) {
        endActiveTouchpadInteraction("HOVER");
      }
    },
    [endActiveTouchpadInteraction, inputMode],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      if (inputMode === "gesture") {
        // Mouse/trackpad parity for canvas navigation: pinch (ctrl/cmd+wheel)
        // zooms anchored at the cursor; plain two-finger scroll pans.
        const rect = event.currentTarget.getBoundingClientRect();
        const viewport = boardViewportRef.current;
        if (event.ctrlKey || event.metaKey) {
          applyViewport(
            zoomViewport(
              viewport,
              Math.exp(-event.deltaY * 0.01),
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              currentViewportLimits(),
            ),
          );
          return;
        }
        applyViewport(
          panViewport(viewport, -event.deltaX, -event.deltaY, currentViewportLimits()),
        );
        return;
      }

      if (inputMode !== "touchpad") {
        return;
      }

      if (event.ctrlKey) {
        return;
      }

      event.preventDefault();
    },
    [applyViewport, currentViewportLimits, inputMode],
  );

  const activateObjectTool = useCallback(
    (tool: ObjectDockTool) => {
      if (objectInteractionRef.current || cameraGrabActiveRef.current) {
        cancelObjectInteraction();
        hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
        hybridPinchClosedRef.current = true;
      }
      objectInteractionRef.current = null;
      cameraPlacementActiveRef.current = false;
      cameraPlacementArmedToolRef.current = isPlacementTool(tool) ? tool : null;
      cameraGrabActiveRef.current = false;
      hybridPinchClosedRef.current = false;
      pointerErasingRef.current = false;
      setAlignmentGuides([]);
      setActiveObjectTool(tool);
      if (!isPlacementTool(tool)) {
        setGhostAnnotation(null);
        setGhostAnnotations([]);
        setLastGestureIntent(tool === "eraser" ? { intent: "erase", confidence: 1 } : null);
        setCommandFeedback(
          tool === "eraser"
            ? "Eraser ready. Move over an object while holding the erase gesture."
            : "Select ready. Hover a highlighted object, close your hand, move it, then reopen to drop.",
        );
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      const center =
        lastGesturePointerRef.current ??
        toBoardPoint({
          x: (rect?.width ?? 760) / 2,
          y: (rect?.height ?? 520) / 2,
        });
      updatePlacementGhost(tool, center, center);
      setCommandFeedback(
        `${objectToolLabel(tool)} preview ready. Close your hand anywhere, move it, then open to place.`,
      );
    },
    [cancelObjectInteraction, updatePlacementGhost],
  );

  // Catalog drag-and-drop: dropping a shape thumbnail commits a default-size
  // object at the drop point, reusing the placement pipeline (snap included).
  const handleCatalogDrop = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>) => {
      const tool = event.dataTransfer.getData(CATALOG_DRAG_MIME) as ObjectDockTool;
      if (!tool || !isPlacementTool(tool)) {
        return;
      }
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setOpenCatalogId(null);
      commitPlacementObject(
        tool,
        toBoardPoint({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }),
      );
    },
    [commitPlacementObject, toBoardPoint],
  );

  const markerStatus = getMarkerStatus(gestureResult);
  const inputModeLabel = getInputModeLabel(inputMode);
  const touchpadStatus = getTouchpadStatus({
    state: touchpadState,
    tool: touchpadTool,
    temporaryEraserActive,
    shortcutsActive,
  });
  const selectedStroke = selectedAnnotationId ? boardRef.current.strokes[selectedAnnotationId] : undefined;
  const selectedAnnotation = selectedStroke?.annotation;
  const labelAnchor = selectedAnnotation ? getAnnotationLabelAnchor(selectedAnnotation) : null;
  const showFloatingLabelEditor =
    selectedAnnotationIds.length === 1 &&
    editingAnnotationId === selectedAnnotationId &&
    Boolean(selectedAnnotation && annotationNeedsLabel(selectedAnnotation)) &&
    labelAnchor;
  const labelAnchorScreen = labelAnchor
    ? screenPointFromBoard(boardViewportRef.current, labelAnchor)
    : null;
  const floatingLabelStyle = labelAnchorScreen
    ? {
        left: Math.max(14, labelAnchorScreen.x + 10),
        top: Math.max(14, labelAnchorScreen.y + 10),
      }
    : undefined;

  // Auto-focus the label editor when it opens (double-click or a new node created
  // by voice/gesture) so the user can type/speak the label without an extra click.
  useEffect(() => {
    if (editingAnnotationId) {
      const input = labelInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [editingAnnotationId]);

  const handControlCoach = getHandControlCoach({
    cameraStatus,
    handsDetected: stats.handsDetected,
    diagnostics: handControlDiagnostics,
  });
  const activeVoiceProvider =
    realtimeSpeechMetadata?.provider ?? realtimeTranscriptionConfig?.provider ?? null;
  const configuredVoiceModel =
    realtimeSpeechMetadata?.model ??
    (selectedSpeechModel || realtimeTranscriptionConfig?.defaultModel || null);
  const activeVoiceModel =
    speechEngine === "browser-fallback" ? "browser-managed" : configuredVoiceModel;
  const voiceEngineLabel =
    speechEngine === "realtime"
      ? activeVoiceProvider ?? "realtime"
      : speechEngine === "browser-fallback"
        ? "Chrome fallback"
        : speechEngine === "loading"
          ? "checking"
          : "not configured";

  const beginTitleEdit = useCallback(() => {
    if (!onRenameBoard || titleStatus === "saving") return;
    titleCancelPendingRef.current = false;
    setTitleDraft(boardTitle);
    setTitleError(null);
    setTitleStatus("idle");
    setTitleEditing(true);
  }, [boardTitle, onRenameBoard, titleStatus]);

  const commitTitleEdit = useCallback(async () => {
    if (
      !onRenameBoard ||
      titleCancelPendingRef.current ||
      titleCommitInFlightRef.current
    ) {
      return;
    }
    const validation = validateBoardTitle(titleDraft);
    if (!validation.valid) {
      setTitleStatus("error");
      setTitleError(validation.message);
      return;
    }
    const nextTitle = validation.title;
    if (nextTitle === boardTitle) {
      setTitleEditing(false);
      setTitleStatus("idle");
      return;
    }
    titleCommitInFlightRef.current = true;
    setTitleStatus("saving");
    setTitleError(null);
    try {
      await onRenameBoard(nextTitle);
      setTitleEditing(false);
      setTitleStatus("saved");
    } catch (caught) {
      setTitleStatus("error");
      setTitleError(
        caught instanceof Error ? caught.message : "Could not rename this canvas.",
      );
    } finally {
      titleCommitInFlightRef.current = false;
    }
  }, [boardTitle, onRenameBoard, titleDraft]);

  const cancelTitleEdit = useCallback(() => {
    titleCancelPendingRef.current = true;
    setTitleDraft(boardTitle);
    setTitleError(null);
    setTitleStatus("idle");
    setTitleEditing(false);
  }, [boardTitle]);

  const confirmDeleteBoard = useCallback(async () => {
    if (!onDeleteBoard || deleteStatus === "deleting") return;
    if (persistenceTimerRef.current) {
      clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    pendingPersistenceRef.current = null;
    const latestState = boardDeletionSnapshot(
      boardRef.current,
      persistentBoardId ?? boardRef.current.boardId,
    );
    setDeleteStatus("deleting");
    setDeleteError(null);
    try {
      await onDeleteBoard(latestState);
    } catch (caught) {
      setDeleteStatus("error");
      setDeleteError(
        caught instanceof Error ? caught.message : "Could not move this canvas to Trash.",
      );
    }
  }, [deleteStatus, onDeleteBoard, persistentBoardId]);

  if (surface === "meet-side-panel") {
    return (
      <main className="airboard-meet-panel">
        <header className="airboard-meet-panel-header">
          <span className="eyebrow">Google Meet add-on</span>
          <h1>Airboard</h1>
          <p>Start a shared visual workspace, then collaborate in Meet&apos;s main stage.</p>
        </header>

        <section className="meet-panel-card" aria-live="polite">
          <div className="meet-panel-status-row">
            <span>Board connection</span>
            <strong className="pill">
              {boardSyncStatus === "connected" ? "Ready" : boardSyncStatus}
            </strong>
          </div>
          <p>
            Airboard uses typed commands, pointer, keyboard, and direct canvas controls inside
            Meet. The shared board opens for everyone when the activity starts.
          </p>
        </section>

        <section className="meet-panel-card meet-media-policy">
          {embeddedMediaCapture ? (
            <>
              <h2>Gesture and voice on the shared board</h2>
              <p>
                This Meet client shares camera and microphone permission with Airboard. Start
                gesture or voice from the main-stage board; capture begins only when you turn it
                on and always shows an on-screen indicator.
              </p>
            </>
          ) : meetMediaBridge ? (
            <>
              <h2>Gesture and voice are on the shared board</h2>
              <p>
                The Airboard extension connects this meeting&apos;s camera and microphone to the
                main-stage board. Click Enable hands or Start Airo there; capture starts only
                when you turn it on and stops the moment you turn it off.
              </p>
            </>
          ) : (
            <>
              <h2>Gesture and voice run in a companion window</h2>
              <p>
                This Meet client does not delegate camera or microphone to add-ons, so Airboard
                cannot capture media inside Meet. The companion window connects to this same
                board — gestures and voice commands there appear for everyone in Meet. Installing
                the Airboard extension brings gesture directly into Meet.
              </p>
              <CompanionMediaLink boardSessionId={activeBoardSessionId} joinToken={activeJoinToken} />
            </>
          )}
        </section>

        <section className="meet-panel-card">
          <h2>On the shared board</h2>
          <ul>
            <li>Type a command such as “add a payment service”.</li>
            <li>Drag, select, label, connect, undo, and export with ordinary controls.</li>
            <li>Camera and microphone are optional to the meeting, not required by Airboard.</li>
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`airboard-shell${isMeetSurface ? " airboard-meet-embedded" : ""}${
        desktopOverlay ? " desktop-overlay" : ""
      }${
        desktopOverlay && !desktopOverlayState.clickThrough ? " desktop-overlay-interactive" : ""
      }${desktopOverlay && desktopOverlayState.clickThrough ? " broadcast-safe" : ""}${
        headlessMeetOverlay ? " meet-overlay-engine broadcast-safe" : ""
      }${diagramVisible ? "" : " diagram-hidden"}`}
    >
      {deleteDialogOpen ? (
        <div className="board-lifecycle-backdrop">
          <section
            className="board-lifecycle-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-canvas-title"
          >
            <span className="eyebrow">Move to Trash</span>
            <h2 id="delete-canvas-title">Delete “{boardTitle}”?</h2>
            <p>
              This canvas can be restored from Trash until your workspace retention policy
              permanently purges it.
            </p>
            {deleteError ? <p className="board-lifecycle-error" role="alert">{deleteError}</p> : null}
            <div className="board-lifecycle-actions">
              <button
                type="button"
                disabled={deleteStatus === "deleting"}
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setDeleteStatus("idle");
                  setDeleteError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={deleteStatus === "deleting"}
                onClick={() => void confirmDeleteBoard()}
              >
                {deleteStatus === "deleting" ? "Saving and moving…" : "Move to Trash"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <header className={`topbar${standaloneEditor ? " canvas-topbar" : ""}`}>
        {standaloneEditor ? (
          <>
            <div className="canvas-topbar-identity">
              <Link className="canvas-back-link" href="/app/boards" aria-label="Back to boards">
                <span aria-hidden="true">←</span>
              </Link>
              <span className="canvas-brand-orbit" aria-hidden="true" />
              <div className="canvas-title-stack">
                {titleEditing ? (
                  <input
                    className="canvas-title-input"
                    aria-label="Canvas name"
                    autoFocus
                    maxLength={240}
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => {
                      if (titleCancelPendingRef.current) {
                        titleCancelPendingRef.current = false;
                        return;
                      }
                      void commitTitleEdit();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitTitleEdit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelTitleEdit();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="canvas-title-button"
                    aria-label={`Rename canvas ${boardTitle}`}
                    title="Rename canvas"
                    disabled={!onRenameBoard}
                    onClick={beginTitleEdit}
                  >
                    {boardTitle}
                  </button>
                )}
                <span
                  className={`canvas-save-state ${
                    titleStatus === "saving"
                      ? "saving"
                      : titleStatus === "error"
                        ? "error"
                        : persistentSaveStatus
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {titleError ??
                  (titleStatus === "saving"
                    ? "Renaming…"
                    : titleStatus === "saved"
                      ? "Renamed"
                  : persistentSaveStatus === "saving"
                    ? "Saving…"
                    : persistentSaveStatus === "error"
                      ? "Save interrupted"
                      : "Saved")}
                </span>
              </div>
            </div>
            <div className="toolbar canvas-toolbar">
              <button type="button" className="toolbar-button" onClick={undoLastAction}>
                <span aria-hidden="true">↶</span>
                <span>Undo</span>
              </button>
              <button
                type="button"
                className="toolbar-button"
                aria-label={
                  speechArmed
                    ? "Stop Airo listening"
                    : speechSupported
                      ? "Start Airo listening"
                      : "Airo listening unavailable; focus the typed command"
                }
                onClick={() => {
                  if (speechSupported) {
                    toggleVoiceInput();
                  } else {
                    setCopilotVisibility(true);
                    requestAnimationFrame(() => intentCommandInputRef.current?.focus());
                  }
                }}
              >
                <span aria-hidden="true">✦</span>
                <span>Airo</span>
              </button>
              {cameraCaptureAvailable ? (
                <button
                  type="button"
                  className={`toolbar-button${cameraStatus === "active" ? " active" : ""}`}
                  disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                  aria-label={
                    cameraStatus === "active"
                      ? "Turn off the camera"
                      : "Enable hand tracking with the camera"
                  }
                  onClick={toggleCameraInput}
                >
                  <span aria-hidden="true">◎</span>
                  <span>Hands</span>
                </button>
              ) : null}
              <button
                type="button"
                className={`toolbar-button${screenUnderlayStatus === "active" ? " active" : ""}`}
                data-testid="screen-underlay-toggle"
                disabled={screenUnderlayStatus === "starting" || recordingState === "recording"}
                aria-label={
                  screenUnderlayStatus === "active"
                    ? "Stop using the shared screen behind Airboard"
                    : "Choose a screen or window to show behind Airboard"
                }
                onClick={() =>
                  screenUnderlayStatus === "active"
                    ? stopScreenUnderlay("Screen background stopped.")
                    : void startScreenUnderlay()
                }
              >
                <span aria-hidden="true">▣</span>
                <span>
                  {screenUnderlayStatus === "starting"
                    ? "Choosing…"
                    : screenUnderlayStatus === "active"
                      ? "Stop screen"
                      : "Use screen"}
                  </span>
              </button>
              {!diagramVisible ? (
                <button
                  type="button"
                  className="toolbar-button diagram-visibility-button active"
                  data-testid="diagram-visibility-status"
                  onClick={() => setDiagramVisibility(true, "menu")}
                >
                  <span aria-hidden="true">◉</span>
                  <span>Show diagram</span>
                </button>
              ) : null}
              <button
                type="button"
                className={`toolbar-icon-button${settingsOpen ? " active" : ""}`}
                aria-label={settingsOpen ? "Close board settings" : "Open board settings"}
                aria-expanded={settingsOpen}
                aria-controls="canvas-settings"
                onClick={() => {
                  setSettingsOpen((value) => !value);
                  setMoreMenuOpen(false);
                }}
              >
                <span aria-hidden="true">⚙</span>
              </button>
              <div className="canvas-more">
                <button
                  type="button"
                  className={`toolbar-icon-button${moreMenuOpen ? " active" : ""}`}
                  aria-label="More board actions"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  onClick={() => {
                    setMoreMenuOpen((value) => !value);
                    setSettingsOpen(false);
                  }}
                >
                  <span aria-hidden="true">•••</span>
                </button>
                {moreMenuOpen ? (
                  <div className="canvas-more-menu" role="menu">
                    {cameraCaptureAvailable ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                        onClick={() => {
                          setMoreMenuOpen(false);
                          toggleCameraInput();
                        }}
                      >
                        <span aria-hidden="true">◎</span>
                        {cameraStatus === "active" ? "Disable hands" : "Enable hands"}
                      </button>
                    ) : null}
                    {voiceCaptureAvailable ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!speechSupported}
                        onClick={() => {
                          setMoreMenuOpen(false);
                          toggleVoiceInput();
                        }}
                      >
                        <span aria-hidden="true">◉</span>
                        {speechArmed ? "Stop Airo listening" : "Start Airo listening"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="diagram-visibility-menu-action"
                      onClick={() => {
                        setDiagramVisibility(!diagramVisibleRef.current, "menu");
                        setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">{diagramVisible ? "◌" : "◉"}</span>
                      {diagramVisible ? "Hide diagram" : "Show diagram"}
                    </button>
                    {onRenameBoard ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          beginTitleEdit();
                        }}
                      >
                        <span aria-hidden="true">✎</span>
                        Rename canvas
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setInputPaused((value) => !value);
                        setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">{inputPaused ? "▶" : "Ⅱ"}</span>
                      {inputPaused ? "Resume inputs" : "Pause inputs"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        exportPng();
                        setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">⇩</span>
                      Export PNG
                    </button>
                    {onDeleteBoard ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          setDeleteStatus("idle");
                          setDeleteError(null);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <span aria-hidden="true">⌫</span>
                        Move to Trash
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        handleClearClick();
                        if (clearArmed) setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">⌫</span>
                      {clearArmed ? "Confirm clear board" : "Clear board…"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="brand">
              <h1>Airboard</h1>
              <span className="surface-label">{surfaceLabel(surface)}</span>
            </div>
            <div className="toolbar">
              {cameraCaptureAvailable ? (
                <button
                  className={inputMode === "touchpad" ? undefined : "primary"}
                  type="button"
                  onClick={cameraStatus === "active" ? stopCamera : startCamera}
                  disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                  aria-label={
                    cameraStatus === "active"
                      ? "Turn off the camera"
                      : "Enable hand tracking with the camera"
                  }
                >
                  {cameraStatus === "starting" || cameraStatus === "tracker_loading"
                    ? "Starting…"
                    : cameraStatus === "active"
                      ? "Turn off camera"
                      : "Enable hands"}
                </button>
              ) : null}
              {voiceCaptureAvailable ? (
                <button
                  className={speechArmed ? "voice-button listening" : "voice-button"}
                  type="button"
                  onClick={startVoiceCommand}
                  disabled={!speechSupported}
                  aria-label={speechArmed ? "Stop Airo listening" : "Start Airo listening"}
                >
                  {speechArmed ? "Stop Airo" : "Start Airo"}
                </button>
              ) : null}
              <button type="button" onClick={undoLastAction}>Undo</button>
              <button type="button" onClick={() => setInputPaused((value) => !value)}>
                {inputPaused ? "Resume" : "Pause"}
              </button>
              <button type="button" onClick={exportPng}>Export PNG</button>
              <button className="danger" type="button" onClick={handleClearClick}>
                {clearArmed ? "Confirm clear?" : "Clear"}
              </button>
            </div>
          </>
        )}
      </header>

      <div
        className={`content${standaloneEditor ? " canvas-workspace" : ""}${
          standaloneEditor && settingsOpen ? " settings-open" : ""
        }${standaloneEditor && copilotOpen ? " copilot-open" : ""}`}
      >
        <section
          className={`board-area${boardTheme === "lightboard" ? " lightboard" : ""}`}
          aria-label="Airboard canvas"
        >
          {standaloneEditor && inputMode === "gesture" && !broadcastSafe ? (
            copilotOpen ? (
              <aside
                className="canvas-copilot"
                data-testid="canvas-copilot"
                aria-label="Airo copilot"
              >
                <header className="canvas-copilot-header">
                  <div>
                    <span className="canvas-copilot-orbit" aria-hidden="true">✦</span>
                    <span>
                      <strong>Airo</strong>
                      <small>{speechArmed ? "Listening continuously" : "Voice ready when started"}</small>
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Hide Airo copilot"
                    onClick={() => setCopilotVisibility(false)}
                  >
                    ›
                  </button>
                </header>

                <section className="canvas-copilot-heard" data-testid="copilot-transcript">
                  <span>What I heard</span>
                  <p>
                    {speechHeardText
                      ? `“${truncateSpeechTranscript(speechHeardText, 180)}”`
                      : speechArmed
                        ? "Listening for your next command…"
                        : "Start Airo, then hold an open palm for 0.4 seconds and speak."}
                  </p>
                  <small className={`copilot-status ${speechRecognitionStatus}`}>
                    {speechRecognitionLabel(speechRecognitionStatus)}
                  </small>
                </section>

                <section className="canvas-copilot-progress" aria-live="polite">
                  <div className="canvas-copilot-section-title">
                    <span>Activity</span>
                    <small>What Airo is doing</small>
                  </div>
                  <ol data-testid="copilot-activity">
                    {copilotActivity.map((entry) => (
                      <li key={entry.id} className={entry.tone}>
                        <span className="copilot-activity-source">{entry.source}</span>
                        <div>
                          <strong>{entry.title}</strong>
                          <p>{entry.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="canvas-copilot-current">
                  <span>Current status</span>
                  <p
                    id="canvas-command-feedback"
                    className="intent-feedback"
                  >
                    {commandFeedback}
                  </p>
                </section>

                <form
                  className="canvas-copilot-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (speechRecognitionStatus !== "interpreting") {
                      runIntentCommand(intentCommandText);
                    }
                  }}
                >
                  <label className="sr-only" htmlFor="canvas-command-input">
                    Type a board command
                  </label>
                  <textarea
                    id="canvas-command-input"
                    ref={intentCommandInputRef}
                    data-testid="intent-command-input"
                    value={intentCommandText}
                    rows={2}
                    onChange={(event) => {
                      semanticIntentRequestIdRef.current += 1;
                      if (speechRecognitionStatus === "interpreting") {
                        setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
                      }
                      setIntentCommandText(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (
                          intentCommandText.trim() &&
                          speechRecognitionStatus !== "interpreting"
                        ) {
                          runIntentCommand(intentCommandText);
                        }
                      }
                    }}
                    placeholder="Type only when you want to…"
                    aria-describedby="canvas-command-feedback"
                  />
                  <button
                    className="primary"
                    data-testid="intent-primary-action"
                    type="submit"
                    aria-label="Send typed command"
                    disabled={!intentCommandText.trim() || speechRecognitionStatus === "interpreting"}
                  >
                    {speechRecognitionStatus === "interpreting" ? "…" : "↑"}
                  </button>
                </form>
                <footer className="canvas-copilot-hint">
                  <span><strong>Undo:</strong> show one open palm and swipe left</span>
                  <span>Shift+Enter for a new line</span>
                </footer>
              </aside>
            ) : (
              <button
                type="button"
                className="canvas-copilot-toggle"
                data-testid="canvas-copilot-toggle"
                aria-label="Open Airo copilot"
                onClick={() => setCopilotVisibility(true)}
              >
                <span aria-hidden="true">✦</span>
                <span>Airo</span>
                {speechRecognitionStatus === "hearing" ||
                speechRecognitionStatus === "interpreting" ? (
                  <i aria-hidden="true" />
                ) : null}
              </button>
            )
          ) : null}
          {standaloneEditor && inputMode === "gesture" && !broadcastSafe ? (
            <div className="canvas-zoom-controls" aria-label="Canvas zoom controls">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  applyViewport(
                    zoomViewport(
                      boardViewportRef.current,
                      0.8,
                      { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
                      currentViewportLimits(),
                    ),
                  );
                }}
              >
                −
              </button>
              <button
                type="button"
                className="canvas-zoom-value"
                aria-label="Reset canvas zoom"
                onClick={() => applyViewport({ ...IDENTITY_VIEWPORT })}
              >
                {Math.round(viewportScale * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  applyViewport(
                    zoomViewport(
                      boardViewportRef.current,
                      1.25,
                      { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
                      currentViewportLimits(),
                    ),
                  );
                }}
              >
                +
              </button>
            </div>
          ) : null}
          {boardTheme === "lightboard" &&
          surface === "standalone" &&
          !desktopOverlay &&
          cameraUnderlayEnabled ? (
            <video
              ref={cameraUnderlayVideoRef}
              className="lightboard-underlay"
              data-testid="lightboard-underlay"
              aria-hidden="true"
              muted
              playsInline
            />
          ) : null}
          {surface === "standalone" && !desktopOverlay ? (
            <video
              ref={screenUnderlayVideoRef}
              className={`lightboard-underlay lightboard-screen-underlay${
                boardTheme === "lightboard" && screenUnderlayStatus === "active"
                  ? " active"
                  : ""
              }`}
              data-testid="screen-underlay"
              aria-hidden="true"
              muted
              playsInline
            />
          ) : null}
          {boardTheme === "lightboard" ? (
            <div
              className="lightboard-scrim"
              data-testid="lightboard-scrim"
              style={{ opacity: scrimOpacity }}
              aria-hidden="true"
            />
          ) : null}
          {recordingState === "recording" && !broadcastSafe ? (
            <div className="recording-badge" data-testid="recording-badge" role="status">
              <span className="recording-dot" aria-hidden="true" />
              REC {formatRecordingClock(recordingSeconds)}
            </div>
          ) : null}
          {desktopOverlay && !desktopOverlayState.clickThrough ? (
            <div className="desktop-overlay-controls" data-testid="desktop-overlay-controls">
              <div className="desktop-overlay-controls-header">
                <div>
                  <strong>Airboard overlay controls</strong>
                  <span>Pointer control is temporarily on</span>
                </div>
                <button className="primary" type="button" onClick={restoreDesktopClickThrough}>
                  Return to click-through
                </button>
              </div>
              <div className="desktop-overlay-actions">
                <button
                  type="button"
                  onClick={cameraStatus === "active" ? stopCamera : startCamera}
                  disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                >
                  {cameraStatus === "active" ? "Turn off hands" : "Enable hands"}
                </button>
                <button type="button" onClick={startVoiceCommand} disabled={!speechSupported}>
                  {speechArmed ? "Stop Airo" : "Start Airo"}
                </button>
                <button type="button" onClick={undoLastAction}>Undo</button>
                <label className="desktop-overlay-scrim-control" htmlFor="desktop-scrim-opacity">
                  <span>Dark overlay</span>
                  <input
                    id="desktop-scrim-opacity"
                    data-testid="desktop-scrim-opacity"
                    type="range"
                    min={MIN_CAMERA_PRESENTATION_SCRIM}
                    max={1}
                    step={0.05}
                    value={scrimOpacity}
                    onChange={(event) => {
                      const next = cameraCanvasScrim(Number(event.target.value));
                      scrimOpacityRef.current = next;
                      setScrimOpacity(next);
                      try {
                        window.localStorage.setItem("airboard.scrim.camera.v1", String(next));
                      } catch {
                        // Preference persistence is best-effort.
                      }
                    }}
                  />
                  <output htmlFor="desktop-scrim-opacity">{Math.round(scrimOpacity * 100)}%</output>
                </label>
              </div>
              <form
                className="intent-command-form desktop-overlay-command"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (speechRecognitionStatus !== "interpreting") {
                    runIntentCommand(intentCommandText);
                  }
                }}
              >
                <input
                  type="text"
                  value={intentCommandText}
                  onChange={(event) => setIntentCommandText(event.target.value)}
                  placeholder="Type a diagram command"
                  aria-label="Desktop overlay diagram command"
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={!intentCommandText.trim() || speechRecognitionStatus === "interpreting"}
                >
                  {speechRecognitionStatus === "interpreting" ? "…" : "Run"}
                </button>
              </form>
              <small>
                {desktopOverlayState.shortcuts.toggleInteraction
                  ? `${desktopOverlayState.shortcuts.toggleInteraction} toggles these controls.`
                  : "Use the Airboard tray menu to return to click-through mode."}
              </small>
            </div>
          ) : null}
          {inputMode === "gesture" ? (
            <div ref={dockRef} className="object-dock catalog-dock" role="toolbar" aria-label="Shape catalog">
              <button
                data-dock-id="select"
                className={`catalog-dock-button ${
                  dockButtonClass(activeObjectTool === "select", dockGestureHover === "select") ?? ""
                }`}
                type="button"
                aria-pressed={activeObjectTool === "select"}
                aria-label="Select"
                data-tooltip="Select"
                title="Select"
                onClick={() => {
                  setOpenCatalogId(null);
                  activateObjectTool("select");
                }}
              >
                <CatalogGlyph tool="select" />
                <span className="sr-only">Select</span>
              </button>
              <span className="catalog-dock-divider" aria-hidden="true" />
              {OBJECT_CATALOG.map((category) => {
                const isOpen = openCatalogId === category.id;
                const holdsActiveTool = category.tools.some(
                  (item) => item.tool === activeObjectTool,
                );
                const categoryIconTool = holdsActiveTool ? activeObjectTool : category.iconTool;
                return (
                  <div key={category.id} className="catalog-category" data-catalog-id={category.id}>
                    <button
                      data-dock-id={`category:${category.id}`}
                      className={`catalog-dock-button catalog-category-trigger ${
                        dockButtonClass(
                          isOpen || holdsActiveTool,
                          dockGestureHover === `category:${category.id}`,
                        ) ?? ""
                      }`}
                      type="button"
                      aria-expanded={isOpen}
                      aria-haspopup="menu"
                      aria-label={category.label}
                      data-tooltip={`${category.label} elements`}
                      title={`${category.label} elements`}
                      onClick={() =>
                        setOpenCatalogId((current) =>
                          current === category.id ? null : category.id,
                        )
                      }
                    >
                      <CatalogGlyph tool={categoryIconTool} />
                      <span className="sr-only">{category.label} elements</span>
                      <span aria-hidden="true" className="catalog-menu-indicator">+</span>
                    </button>
                    {isOpen ? (
                      <div className="catalog-flyout" role="menu" aria-label={`${category.label} shapes`}>
                        {category.tools.map((item) => (
                          <button
                            key={item.tool}
                            data-dock-id={`tool:${item.tool}`}
                            role="menuitem"
                            className={`catalog-tile ${
                              dockButtonClass(
                                activeObjectTool === item.tool,
                                dockGestureHover === `tool:${item.tool}`,
                              ) ?? ""
                            }`}
                            type="button"
                            aria-label={item.label}
                            data-tooltip={item.label}
                            title={`${item.label} — click or pinch to arm placement, or drag onto the board`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData(CATALOG_DRAG_MIME, item.tool);
                              event.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() => {
                              activateObjectTool(item.tool);
                              setOpenCatalogId(null);
                            }}
                          >
                            <CatalogGlyph tool={item.tool} />
                            <span className="sr-only">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <span className="catalog-dock-divider" aria-hidden="true" />
              <button
                data-dock-id="eraser"
                className={`catalog-dock-button ${
                  dockButtonClass(activeObjectTool === "eraser", dockGestureHover === "eraser") ?? ""
                }`}
                type="button"
                aria-pressed={activeObjectTool === "eraser"}
                aria-label="Eraser"
                data-tooltip="Eraser"
                title="Eraser"
                onClick={() => {
                  setOpenCatalogId(null);
                  activateObjectTool("eraser");
                }}
              >
                <CatalogGlyph tool="eraser" />
                <span className="sr-only">Eraser</span>
              </button>
            </div>
          ) : null}
          {voiceCaptureAvailable && voiceGate && !broadcastSafe ? (
            <div
              className={`voice-gate-pill ${speechArmed ? "armed" : "unarmed"}`}
              role="status"
              data-testid="voice-gate-pill"
            >
              <span className="voice-gate-dot" aria-hidden="true" />
              {voiceGate.mode === "ptt"
                ? speechArmed
                  ? "Listening — speak a board command"
                  : "Open palm detected — press Start Airo once to enable voice commands"
                : speechArmed
                  ? `Editing “${voiceGate.label}” — “rename to …”, “delete”, “connect to …”`
                  : `Holding “${voiceGate.label}” — press Start Airo once to enable voice edits`}
            </div>
          ) : null}
          {inputMode === "gesture" &&
          cameraStatus === "active" &&
          objectGestureState !== "hover" &&
          objectGestureState !== "no target" &&
          !broadcastSafe ? (
            <div
              className={`object-gesture-pill ${voiceGate ? "with-voice" : ""}`}
              role="status"
              aria-live="polite"
            >
              {objectGestureState === "placing"
                ? "Placement locked — move, then reopen"
                : objectGestureState === "erase"
                  ? "Erase locked — sweep, then reopen"
                  : "Move locked — move, then reopen"}
            </div>
          ) : null}
          {cameraCaptureAvailable &&
          onboardingVisible &&
          !desktopOverlay &&
          inputMode === "gesture" ? (
            <div className="onboarding-overlay" role="dialog" aria-label="How to use Airboard">
              <div className="onboarding-card">
                <h2>Talk to the board, not to software</h2>
                <ul>
                  <li>
                    <strong>Hold an open palm still for 0.4 seconds</strong> and speak — no wake word.
                    “Add a payment service next to the API.”
                  </li>
                  <li>
                    <strong>Grab an element and hold it still</strong> to edit it by voice:
                    “rename to Payments”, “delete”, “connect to the database.”
                  </li>
                  <li>
                    <strong>Close your hand over an object to move it</strong>; reopen to drop.
                    Camera gestures do not resize objects.
                  </li>
                  <li>
                    <strong>Two open palms</strong> move the canvas; <strong>two closed
                    hands</strong> spread apart or together to zoom.
                  </li>
                  <li>
                    <strong>One open palm swiped left</strong> undoes the last change.
                    Release the palm before swiping again.
                  </li>
                  <li>
                    Everything applies instantly. Use the toolbar, Cmd/Ctrl+Z, or an
                    open-palm swipe to undo; the Airo panel shows each board action.
                  </li>
                </ul>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setOnboardingVisible(false);
                    try {
                      window.localStorage.setItem("airboard.onboarding.v1", "done");
                    } catch {
                      // Best-effort persistence only.
                    }
                  }}
                >
                  Got it — let me try
                </button>
              </div>
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            role="application"
            aria-label="Airboard diagram canvas. Press Tab or Shift+Tab to cycle through objects and Enter or F2 to edit the selected object's label. Type commands such as add, move, or delete in the Intent Canvas field to create and change objects."
            className={`board-canvas ${inputMode === "touchpad" ? "touchpad-mode" : ""} ${
              inputMode === "gesture" ? "gesture-mode" : ""
            }`}
            tabIndex={0}
            onContextMenu={(event) => event.preventDefault()}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(CATALOG_DRAG_MIME)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={handleCatalogDrop}
            onFocus={() => {
              shortcutsActiveRef.current = true;
              setShortcutsActive(true);
              if (inputMode === "touchpad" && touchpadState === "IDLE") {
                setTouchpadState("HOVER");
              }
            }}
            onBlur={() => {
              shortcutsActiveRef.current = false;
              setShortcutsActive(false);
              temporaryEraserActiveRef.current = false;
              setTemporaryEraserActive(false);
            }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleCanvasDoubleClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onLostPointerCapture={() => {
              if (inputMode === "touchpad" && activePointerIdRef.current !== null) {
                endActiveTouchpadInteraction("HOVER");
              }
            }}
            onWheel={handleWheel}
          />
          {debugVisible && !broadcastSafe && gestureResult?.rawCursorPoint ? (
            <span
              className="debug-point raw"
              style={{
                left: gestureResult.rawCursorPoint.x + 14,
                top: gestureResult.rawCursorPoint.y + 14,
              }}
            />
          ) : null}
          {debugVisible && !broadcastSafe && gestureResult?.diagnostics?.rawTipX !== undefined ? (
            <span
              className="debug-point tip"
              style={{
                left: gestureResult.diagnostics.rawTipX + 14,
                top: (gestureResult.diagnostics.rawTipY ?? 0) + 14,
              }}
            />
          ) : null}
          {debugVisible && !broadcastSafe && gestureResult?.diagnostics?.gripCenterX !== undefined ? (
            <span
              className="debug-point grip"
              style={{
                left: gestureResult.diagnostics.gripCenterX + 14,
                top: (gestureResult.diagnostics.gripCenterY ?? 0) + 14,
              }}
            />
          ) : null}
          {debugVisible && !broadcastSafe && gestureResult?.cursorPoint ? (
            <span
              className="debug-point virtual"
              style={{
                left: gestureResult.cursorPoint.x + 14,
                top: gestureResult.cursorPoint.y + 14,
              }}
            />
          ) : null}
          {debugVisible && !broadcastSafe && gestureResult?.rawCursorPoint ? (
            <svg className="debug-spring" aria-hidden="true">
              <line
                x1={gestureResult.rawCursorPoint.x + 14}
                y1={gestureResult.rawCursorPoint.y + 14}
                x2={gestureResult.cursorPoint.x + 14}
                y2={gestureResult.cursorPoint.y + 14}
              />
            </svg>
          ) : null}
          {cameraCaptureAvailable ? (
            // Inside a meeting the client already shows the user's self-view;
            // a second preview is noise. The element stays mounted (opacity 0)
            // because the tracker reads its frames.
            cameraStatus !== "idle" &&
            !isMeetSurface &&
            !desktopOverlay &&
            !broadcastSafe &&
            !(
              boardTheme === "lightboard" &&
              (cameraUnderlayEnabled || screenUnderlayStatus === "active")
            ) ? (
              <video ref={videoRef} className="camera-preview" muted playsInline />
            ) : (
              <video ref={videoRef} className="camera-preview hidden" muted playsInline />
            )
          ) : null}
          {showFloatingLabelEditor && floatingLabelStyle && !broadcastSafe ? (
            <div className="floating-label-editor" style={floatingLabelStyle}>
              <label htmlFor="floating-annotation-label">Say or type label</label>
              <input
                id="floating-annotation-label"
                ref={labelInputRef}
                type="text"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    saveAnnotationLabel();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    dismissAnnotationLabelEditor();
                  }
                }}
                placeholder="Label"
              />
              <div className="label-actions">
                <button type="button" onClick={saveAnnotationLabel}>
                  Save
                </button>
                <button type="button" onClick={dismissAnnotationLabelEditor}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {!standaloneEditor || settingsOpen ? (
        <aside
          id={standaloneEditor ? "canvas-settings" : undefined}
          className={`sidebar${standaloneEditor ? " canvas-inspector open" : ""}`}
        >
          {standaloneEditor ? (
            <div className="canvas-inspector-heading">
              <div>
                <span>Board</span>
                <h2>Settings</h2>
              </div>
              <button
                type="button"
                aria-label="Close board settings"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>
          ) : null}
          {inputMode === "gesture" && !standaloneEditor ? (
            <section className="section">
              <h2>Command</h2>
              <form
                className="intent-command-form sidebar-command-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (speechRecognitionStatus !== "interpreting") {
                    runIntentCommand(intentCommandText);
                  }
                }}
              >
                <input
                  data-testid="intent-command-input"
                  type="text"
                  value={intentCommandText}
                  onChange={(event) => {
                    semanticIntentRequestIdRef.current += 1;
                    if (speechRecognitionStatus === "interpreting") {
                      setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
                    }
                    setIntentCommandText(event.target.value);
                  }}
                  placeholder="Add a payment service here"
                  aria-label="Typed board command"
                />
                <button
                  className="primary"
                  data-testid="intent-primary-action"
                  type="submit"
                  disabled={!intentCommandText.trim() || speechRecognitionStatus === "interpreting"}
                >
                  {speechRecognitionStatus === "interpreting" ? "…" : "Run"}
                </button>
              </form>
              <p className="intent-feedback" aria-live="polite">
                {commandFeedback}
              </p>
              {voiceCaptureAvailable &&
              (speechArmed || speechHeardText || speechRecognitionStatus === "error") ? (
                <p
                  className={`voice-heard ${speechRecognitionStatus}`}
                  data-testid="voice-heard"
                  aria-live="polite"
                >
                  <strong>Mic heard:</strong>{" "}
                  {speechHeardText
                    ? `“${truncateSpeechTranscript(speechHeardText)}”`
                    : "waiting for speech…"}
                  <span>{speechRecognitionLabel(speechRecognitionStatus)}</span>
                </p>
              ) : null}
            </section>
          ) : null}
          <section className="section sidebar-diagnostics">
            <h2>Status</h2>
            <div className="status-grid">
              {cameraCaptureAvailable ? (
                <>
                  <span>Camera</span>
                  <strong className={cameraStatus === "active" ? "pill" : "pill warning"}>
                    {cameraStatusLabel(cameraStatus)}
                  </strong>
                </>
              ) : null}
              <span>Input</span>
              <strong>{inputModeLabel}</strong>
              <span>Touchpad</span>
              <strong className="pill">{inputMode === "touchpad" ? touchpadStatus : "inactive"}</strong>
              {inputMode === "gesture" ? (
                <>
                  <span>Intent Canvas</span>
                  <strong className="pill">active</strong>
                  <span>Object control</span>
                  <strong className="pill">{objectGestureState}</strong>
                  <span>Selection</span>
                  <strong>{selectedAnnotationIds.length}</strong>
                  <span>Live sync</span>
                  <strong className="pill">{boardSyncStatus}</strong>
                  <span>Zoom</span>
                  <strong>{`${Math.round(viewportScale * 100)}%${canvasNavMode ? ` · ${canvasNavMode}` : ""}`}</strong>
                  <span>Command</span>
                  <strong>
                    {speechRecognitionStatus === "interpreting"
                      ? "interpreting"
                      : pendingIntent
                        ? "preview"
                        : speechArmed
                          ? "waiting for Airo"
                          : "ready"}
                  </strong>
                  {voiceCaptureAvailable ? (
                    <>
                      <span>Voice</span>
                      <strong className="pill">
                        {speechArmed ? (speechListening ? "listening" : "connecting") : "off"}
                      </strong>
                      <span>Voice engine</span>
                      <strong>{voiceEngineLabel}</strong>
                      <span>Voice model</span>
                      <strong>{activeVoiceModel ?? "-"}</strong>
                    </>
                  ) : null}
                  <span>Intent AI</span>
                  <strong>
                    {semanticIntentConfig?.available
                      ? `${semanticIntentConfig.provider ?? "provider"} / ${selectedSemanticIntentModel || semanticIntentConfig.defaultModel || "default"}`
                      : "not configured"}
                  </strong>
                </>
              ) : null}
              {cameraCaptureAvailable && inputMode === "gesture" ? (
                <>
                  <span>Hand cursor</span>
                  <strong className="pill">{handControlDiagnostics.controllerState}</strong>
                  <span>Tracking confidence</span>
                  <strong>{handControlDiagnostics.trackingConfidence.toFixed(2)}</strong>
                  <span>Grab strength</span>
                  <strong>{handControlDiagnostics.grabStrength.toFixed(2)}</strong>
                  <span>Active hand</span>
                  <strong>{gestureResult?.hand ?? "either"}</strong>
                </>
              ) : null}
              {cameraCaptureAvailable ? (
                <>
                  <span>Hands detected</span>
                  <strong>{stats.handsDetected}</strong>
                </>
              ) : null}
            </div>
            {cameraCaptureAvailable && cameraError ? <p className="hint">{cameraError}</p> : null}
            {cameraCaptureAvailable && inputMode === "gesture" ? (
              <p className="hint">{handControlCoach}</p>
            ) : null}
          </section>

          <section className="section sidebar-diagnostics">
            <h2>Board</h2>
            <div className="status-grid">
              <span>Visible strokes</span>
              <strong>{stats.strokes}</strong>
              <span>Deleted strokes</span>
              <strong>{stats.deleted}</strong>
              <span>Active strokes</span>
              <strong>{stats.active}</strong>
            </div>
          </section>

          {standaloneEditor ? (
            <section className="section media-permission-section">
              <div className="section-heading-inline">
                <div>
                  <h2>Camera & microphone</h2>
                  <p>Granted once for this site, then reused on every Airboard.</p>
                </div>
              </div>
              <div className="media-permission-row">
                <span className="media-permission-icon" aria-hidden="true">◉</span>
                <div>
                  <strong>Microphone</strong>
                  <small>Airo voice commands</small>
                </div>
                <span className={`permission-state ${microphonePermission}`}>
                  {mediaPermissionLabel(microphonePermission)}
                </span>
                <button
                  type="button"
                  disabled={!speechSupported}
                  onClick={toggleVoiceInput}
                >
                  {speechArmed ? "Turn off" : microphonePermission === "granted" ? "Use" : "Allow"}
                </button>
              </div>
              <div className="media-permission-row">
                <span className="media-permission-icon" aria-hidden="true">◎</span>
                <div>
                  <strong>Camera</strong>
                  <small>Hands and presenter view</small>
                </div>
                <span className={`permission-state ${cameraPermission}`}>
                  {mediaPermissionLabel(cameraPermission)}
                </span>
                <button
                  type="button"
                  disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                  onClick={toggleCameraInput}
                >
                  {cameraStatus === "starting" || cameraStatus === "tracker_loading"
                    ? "Starting…"
                    : cameraStatus === "active"
                      ? "Turn off"
                      : cameraPermission === "granted"
                        ? "Use"
                        : "Allow"}
                </button>
              </div>
              <p className="permission-note">
                Choose <strong>Allow while visiting the site</strong> in the browser prompt.
                Airboard will then resume an input you previously enabled without asking again.
                Screen/window sharing must still be chosen for each capture session.
              </p>
              {microphonePermission === "denied" || cameraPermission === "denied" ? (
                <p className="permission-warning">
                  A blocked permission can only be changed from the site controls beside the
                  browser address.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="section">
            <h2>Appearance</h2>
            <label className="check-row" htmlFor="lightboard-theme">
              <input
                id="lightboard-theme"
                type="checkbox"
                checked={boardTheme === "lightboard"}
                disabled={cameraCanvasLocked}
                onChange={(event) => {
                  const nextTheme = event.target.checked ? "lightboard" : "classic";
                  if (nextTheme === "classic" && cameraCanvasLocked) {
                    return;
                  }
                  if (nextTheme === "classic" && screenUnderlayStatus === "active") {
                    stopScreenUnderlay("Screen background stopped because Lightboard was turned off.");
                  }
                  setBoardTheme(nextTheme);
                  try {
                    window.localStorage.setItem("airboard.theme.v1", nextTheme);
                  } catch {
                    // Preference persistence is best-effort.
                  }
                }}
              />
              <span>
                Lightboard (neon) theme
                {cameraCanvasLocked ? " · required while camera overlay is on" : ""}
              </span>
            </label>
            {surface === "meet-main-stage" && cameraOverlay ? (
              <>
                <label className="check-row" htmlFor="camera-overlay-toggle">
                  <input
                    id="camera-overlay-toggle"
                    type="checkbox"
                    checked={cameraOverlayEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setCameraOverlayEnabled(enabled);
                      if (enabled) {
                        enforceCameraCanvas();
                        cameraOverlay.start();
                      } else {
                        cameraOverlay.stop();
                      }
                    }}
                  />
                  <span>Lightboard on my camera</span>
                </label>
                {cameraOverlayEnabled && cameraOverlayState && !cameraOverlayState.engaged ? (
                  <p className="hint" data-testid="camera-overlay-pending">
                    Turn your Meet camera off and on once — the lightboard rides the next
                    camera start.
                  </p>
                ) : null}
                {cameraOverlayEnabled && cameraOverlayState?.engaged ? (
                  <p className="hint" data-testid="camera-overlay-live">
                    {cameraOverlayState.verification?.senderAttached &&
                    cameraOverlayState.verification.framesEncoded > 0 &&
                    cameraOverlayState.verification.bytesSent > 0
                      ? "Verified in this Meet client: the composited camera track is attached to Meet and encoding outbound video."
                      : cameraOverlayState.verification
                        ? "The compositor is engaged. Waiting for Meet to attach and encode its output track…"
                        : "The compositor is engaged. Reload extension 0.5.0 for real outbound-track verification."}
                  </p>
                ) : null}
                {cameraOverlayEnabled && cameraOverlayState?.verification ? (
                  <div
                    className="status-grid camera-overlay-verification"
                    data-testid="camera-overlay-verification"
                  >
                    <span>Extension</span>
                    <strong>{cameraOverlayState.verification.extensionVersion}</strong>
                    <span>Composite frames</span>
                    <strong>{Math.round(cameraOverlayState.verification.framesComposited)}</strong>
                    <span>Meet sender</span>
                    <strong>
                      {cameraOverlayState.verification.senderAttached ? "attached" : "waiting"}
                    </strong>
                    <span>Encoded frames</span>
                    <strong>{Math.round(cameraOverlayState.verification.framesEncoded)}</strong>
                    <span>Outbound bytes</span>
                    <strong>{Math.round(cameraOverlayState.verification.bytesSent)}</strong>
                  </div>
                ) : null}
              </>
            ) : null}
            {boardTheme === "lightboard" ? (
              <>
                {surface === "standalone" ? (
                  <div className="status-grid screen-underlay-status" data-testid="screen-underlay-status">
                    <span>Screen/window</span>
                    <strong
                      className={
                        screenUnderlayStatus === "active"
                          ? "pill"
                          : screenUnderlayStatus === "blocked" || screenUnderlayStatus === "error"
                            ? "pill warning"
                            : undefined
                      }
                    >
                      {screenUnderlayStatusLabel(screenUnderlayStatus)}
                    </strong>
                  </div>
                ) : null}
                {surface === "standalone" ? (
                  <label className="check-row" htmlFor="camera-underlay">
                    <input
                      id="camera-underlay"
                      type="checkbox"
                      checked={cameraUnderlayEnabled}
                      disabled={cameraStatus === "active"}
                      onChange={(event) => {
                        setCameraUnderlayEnabled(event.target.checked);
                        try {
                          window.localStorage.setItem(
                            "airboard.underlay.v1",
                            event.target.checked ? "on" : "off",
                          );
                        } catch {
                          // Preference persistence is best-effort.
                        }
                      }}
                    />
                    <span>Camera behind the dark canvas when no screen is selected</span>
                  </label>
                ) : null}
                {surface === "standalone" ? (
                  <label className="check-row" htmlFor="local-contrast-plates">
                    <input
                      id="local-contrast-plates"
                      data-testid="local-contrast-plates"
                      type="checkbox"
                      checked={localContrastPlatesEnabled}
                      onChange={(event) => {
                        setLocalContrastPlatesEnabled(event.target.checked);
                        try {
                          window.localStorage.setItem(
                            "airboard.contrast-plates.v1",
                            event.target.checked ? "on" : "off",
                          );
                        } catch {
                          // Preference persistence is best-effort.
                        }
                      }}
                    />
                    <span>Local contrast behind diagram clusters</span>
                  </label>
                ) : null}
                <div className="control-row">
                  <label htmlFor="scrim-opacity">Dark overlay</label>
                  <div className="range-with-value">
                    <input
                      id="scrim-opacity"
                      type="range"
                      min={screenUnderlayStatus === "active" ? 0 : MIN_CAMERA_PRESENTATION_SCRIM}
                      max={1}
                      step={0.05}
                      value={scrimOpacity}
                      onChange={(event) => {
                        const requested = Number(event.target.value);
                        const next =
                          screenUnderlayStatus === "active"
                            ? screenFriendlyScrim(requested)
                            : cameraCanvasScrim(requested);
                        scrimOpacityRef.current = next;
                        setScrimOpacity(next);
                        try {
                          window.localStorage.setItem(
                            screenUnderlayStatus === "active"
                              ? "airboard.scrim.screen.v1"
                              : "airboard.scrim.camera.v1",
                            String(next),
                          );
                        } catch {
                          // Preference persistence is best-effort.
                        }
                      }}
                    />
                    <output htmlFor="scrim-opacity" data-testid="scrim-value">
                      {Math.round(scrimOpacity * 100)}%
                    </output>
                  </div>
                </div>
                {surface === "standalone" ? (
                  <p className="hint" data-testid="screen-underlay-notice">
                    {screenUnderlayNotice ??
                      (cameraUnderlayEnabled && cameraStatus === "active"
                        ? "Camera is behind the board. Use screen to replace it with a screen or window."
                        : "No live background is selected, so the dark overlay appears solid. Click Use screen, or enable hands for the camera background.")}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          {surface === "standalone" ? (
            <section className="section">
              <h2>Studio</h2>
              <p className="hint">
                Record what a viewer sees — your selected screen or camera behind the glowing
                board, with your microphone — as a local WebM file. Nothing is uploaded.
              </p>
              <button
                type="button"
                className={recordingState === "recording" ? "danger" : "primary"}
                data-testid="studio-record"
                onClick={() =>
                  recordingState === "recording"
                    ? void stopStudioRecording()
                    : void startStudioRecording()
                }
              >
                {recordingState === "recording"
                  ? `Stop recording (${formatRecordingClock(recordingSeconds)})`
                  : "Start recording"}
              </button>
              {recordingNotice ? <p className="hint">{recordingNotice}</p> : null}
            </section>
          ) : null}

          <section className="section">
            <h2>Input Controls</h2>
            <div className="control-row">
              <label htmlFor="input-mode">Input Mode</label>
              <select
                id="input-mode"
                value={inputMode}
                onChange={(event) => {
                  const nextMode = event.target.value as AirboardInputMode;
                  if (inputMode === "gesture") {
                    if (objectInteractionRef.current || cameraGrabActiveRef.current) {
                      cancelObjectInteraction();
                    }
                    if (pendingIntentRef.current) {
                      cancelPendingIntent("Switched input mode; the command preview was cancelled.");
                    }
                    hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
                    if (activeStrokeIdRef.current) {
                      commitStroke(activeStrokeIdRef.current, { discard: true });
                      activeStrokeIdRef.current = null;
                    }
                    pointerStrokeIdRef.current = null;
                    gesturePathRef.current = [];
                    objectInteractionRef.current = null;
                    cameraPlacementActiveRef.current = false;
                    cameraPlacementArmedToolRef.current = null;
                    cameraGrabActiveRef.current = false;
                    setGhostAnnotation(null);
                    setGhostAnnotations([]);
                    setHoverStrokeId(null);
                  } else {
                    endActiveTouchpadInteraction(nextMode === "touchpad" ? "HOVER" : "IDLE");
                  }
                  boardViewportRef.current = { ...IDENTITY_VIEWPORT };
                  canvasNavTrackerRef.current?.reset();
                  setViewportScale(1);
                  setCanvasNavMode(null);
                  setInputMode(nextMode);
                  render();
                }}
              >
                <option value="touchpad">Touchpad Writing</option>
                <option value="gesture">Intent Canvas</option>
              </select>
            </div>
            {inputMode === "touchpad" ? (
              <>
                <p className="hint">Touchpad Writing - most reliable. Press and drag to draw.</p>
                <div className="segmented-control" role="group" aria-label="Touchpad tool">
                  <button
                    className={touchpadTool === "marker" ? "selected" : undefined}
                    type="button"
                    aria-pressed={touchpadTool === "marker"}
                    onClick={() => setTouchpadTool("marker")}
                  >
                    Marker
                  </button>
                  <button
                    className={touchpadTool === "eraser" ? "selected" : undefined}
                    type="button"
                    aria-pressed={touchpadTool === "eraser"}
                    onClick={() => setTouchpadTool("eraser")}
                  >
                    Eraser
                  </button>
                </div>
                <div className="control-row">
                  <label htmlFor="touchpad-variant">Mode</label>
                  <select
                    id="touchpad-variant"
                    value={touchpadVariant}
                    onChange={(event) => setTouchpadVariant(event.target.value as TouchpadModeVariant)}
                  >
                    <option value="simple">Simple</option>
                    <option value="presenter">Presenter</option>
                    <option value="precision">Precision</option>
                  </select>
                </div>
                <div className="control-row">
                  <label htmlFor="stroke-color">Color</label>
                  <input
                    id="stroke-color"
                    className="color-input"
                    type="color"
                    value={strokeColor}
                    onChange={(event) => setStrokeColor(event.target.value)}
                  />
                </div>
                <div className="control-row">
                  <label htmlFor="stroke-thickness">Thickness</label>
                  <input
                    id="stroke-thickness"
                    type="range"
                    min="2"
                    max="10"
                    step="1"
                    value={strokeThickness}
                    onChange={(event) => setStrokeThickness(Number(event.target.value))}
                  />
                </div>
                <div className="control-row">
                  <label htmlFor="eraser-radius">Eraser</label>
                  <input
                    id="eraser-radius"
                    type="range"
                    min="18"
                    max="64"
                    step="2"
                    value={eraserRadius}
                    onChange={(event) => setEraserRadius(Number(event.target.value))}
                  />
                </div>
              </>
            ) : (
              <>
                {inputMode === "gesture" ? (
                  !cameraCaptureAvailable ? (
                    <>
                      <p className="hint">
                        Type a command or use pointer, keyboard, and direct canvas controls.
                        This meeting surface cannot capture camera or microphone, so gesture and
                        voice run in a companion window connected to this same board.
                      </p>
                      <CompanionMediaLink boardSessionId={activeBoardSessionId} joinToken={activeJoinToken} />
                      <label className="check-row" htmlFor="auto-snap-connectors">
                        <input
                          id="auto-snap-connectors"
                          type="checkbox"
                          checked={autoSnapConnectors}
                          onChange={(event) => setAutoSnapConnectors(event.target.checked)}
                        />
                        <span>Object, grid, and connector snapping</span>
                      </label>
                    </>
                  ) : (
                    <>
                    <p className="hint">
                      {voiceCaptureAvailable
                        ? "Start Airo once. Hold an open palm still for 0.4 seconds to speak; sweep that same open palm left to undo. Use a relaxed hand to aim and a closed hand to move."
                        : "Click Enable hands to use the meeting camera. Use a relaxed hand to aim and a closed hand to move. Voice is not available on this surface yet."}
                    </p>
                    <details className="advanced-settings gesture-guide">
                      <summary>Gesture guide</summary>
                      <dl>
                        <div>
                          <dt>Aim</dt>
                          <dd>Move one relaxed hand without holding a command pose.</dd>
                        </div>
                        <div>
                          <dt>Choose or select</dt>
                          <dd>
                            Aim near a dock control or object and start closing one hand. The first
                            highlighted target activates; reopen before choosing another. Camera
                            gestures select one object only and never draw a lasso.
                          </dd>
                        </div>
                        <div>
                          <dt>Move</dt>
                          <dd>
                            Keep Select active. Close over the object body, wait for “Move locked,”
                            move it, then reopen.
                          </dd>
                        </div>
                        <div>
                          <dt>Place</dt>
                          <dd>
                            Choose a shape first. Move onto the canvas, close one hand, wait for
                            “Holding,” position the preview, then reopen.
                          </dd>
                        </div>
                        <div>
                          <dt>Erase</dt>
                          <dd>
                            Choose Eraser first. Close over an object, wait for the erase state,
                            sweep across targets, then reopen.
                          </dd>
                        </div>
                        {voiceCaptureAvailable ? (
                          <>
                            <div>
                              <dt>Speak to Airo</dt>
                              <dd>
                                Start Airo once, then hold one open palm still (no
                                sideways motion) for about 0.4 seconds. Lower or relax it
                                when finished.
                              </dd>
                            </div>
                            <div>
                              <dt>Voice-edit one object</dt>
                              <dd>
                                Close one hand over the object and hold it still for about
                                0.6 seconds, then say the change.
                              </dd>
                            </div>
                          </>
                        ) : null}
                        <div>
                          <dt>Undo</dt>
                          <dd>
                            Show one open palm and sweep it left in one clear horizontal
                            motion (no pause). Release before another undo.
                          </dd>
                        </div>
                        <div>
                          <dt>Hide or show diagram</dt>
                          <dd>
                            With one hand, touch thumb to middle finger while keeping the index
                            separated. Then flick the middle finger away quickly—the touch alone
                            does nothing. Fully relax before snapping again.
                          </dd>
                        </div>
                        <div>
                          <dt>Pan</dt>
                          <dd>Hold two open hands briefly, then move them together.</dd>
                        </div>
                        <div>
                          <dt>Zoom</dt>
                          <dd>
                            Hold two closed hands briefly, then spread them apart or bring them
                            together.
                          </dd>
                        </div>
                      </dl>
                      <p>
                        Camera gestures do not resize objects or select an area. Use pointer
                        handles or a typed or voice resize command. Shift+H toggles diagram
                        visibility, and Cmd/Ctrl+Z always undoes.
                      </p>
                    </details>
                    <details className="advanced-settings">
                      <summary>Advanced settings</summary>
                    <div className="control-row">
                      <label htmlFor="voice-model">Voice model</label>
                      <select
                        id="voice-model"
                        value={selectedSpeechModel}
                        disabled={
                          speechEngine !== "realtime" ||
                          !realtimeTranscriptionConfig?.allowedModels.length
                        }
                        onChange={(event) => changeSpeechModel(event.target.value)}
                      >
                        {realtimeTranscriptionConfig?.allowedModels.length ? (
                          realtimeTranscriptionConfig.allowedModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))
                        ) : (
                          <option value="">
                            {speechEngine === "loading" ? "Checking API…" : "Not configured"}
                          </option>
                        )}
                      </select>
                    </div>
                    <div className="control-row">
                      <label htmlFor="intent-model">Intent model</label>
                      <select
                        id="intent-model"
                        value={selectedSemanticIntentModel}
                        disabled={!semanticIntentConfig?.available || !semanticIntentConfig.allowedModels.length}
                        onChange={(event) => changeSemanticIntentModel(event.target.value)}
                      >
                        {semanticIntentConfig?.allowedModels.length ? (
                          semanticIntentConfig.allowedModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))
                        ) : (
                          <option value="">Not configured</option>
                        )}
                      </select>
                    </div>
                    <div className="control-row">
                      <label htmlFor="refresh-voice-config">Voice configuration</label>
                      <button
                        id="refresh-voice-config"
                        type="button"
                        aria-label="Refresh voice models"
                        disabled={speechArmed}
                        onClick={() => setSpeechConfigRevision((revision) => revision + 1)}
                      >
                        Refresh models
                      </button>
                    </div>
                    <p className="hint">
                      Engine: {voiceEngineLabel}. Model changes take effect in a fresh realtime
                      session; changing it while Airo is active switches sessions automatically.
                      Intent model changes apply to the next unclear command without reconnecting.
                    </p>
                    <div className="control-row">
                      <label htmlFor="confidence">Hand confidence</label>
                      <input
                        id="confidence"
                        type="range"
                        min="0.4"
                        max="0.95"
                        step="0.01"
                        value={confidenceThreshold}
                        onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                      />
                    </div>
                    <label className="check-row" htmlFor="auto-snap-connectors">
                      <input
                        id="auto-snap-connectors"
                        type="checkbox"
                        checked={autoSnapConnectors}
                        onChange={(event) => setAutoSnapConnectors(event.target.checked)}
                      />
                      <span>Object, grid, and connector snapping</span>
                    </label>
                    <div className="control-row">
                      <label htmlFor="record-landmarks">Gesture calibration</label>
                      <button
                        id="record-landmarks"
                        type="button"
                        disabled={cameraStatus !== "active" || landmarkRecordingActive}
                        onClick={startLandmarkTraceRecording}
                        title="Record 5 seconds of hand-landmark frames to a JSON file for the gesture-engine replay harness"
                      >
                        {landmarkRecordingActive ? "Recording…" : "Record 5s landmark trace"}
                      </button>
                    </div>
                      </details>
                    </>
                  )
                ) : null}
              </>
            )}
            {cameraCaptureAvailable ? (
              <label className="check-row" htmlFor="debug-visible">
                <input
                  id="debug-visible"
                  type="checkbox"
                  checked={debugVisible}
                  onChange={(event) => setDebugVisible(event.target.checked)}
                />
                <span>Debug</span>
              </label>
            ) : null}
          </section>

          {cameraCaptureAvailable && debugVisible ? (
            <section className="section">
              <h2>Friction Debug</h2>
              <div className="status-grid">
                <span>Contact</span>
                <strong>{formatDiagnostic(gestureResult?.diagnostics?.contactScore, 2)}</strong>
                <span>Input source</span>
                <strong>{gestureResult?.diagnostics?.inputSource ?? "-"}</strong>
                <span>Tracking</span>
                <strong>{gestureResult?.diagnostics?.trackingSource ?? "-"}</strong>
                <span>Raw tip</span>
                <strong>
                  {formatPoint(
                    gestureResult?.diagnostics?.rawTipX,
                    gestureResult?.diagnostics?.rawTipY,
                  )}
                </strong>
                <span>Grip center</span>
                <strong>
                  {formatPoint(
                    gestureResult?.diagnostics?.gripCenterX,
                    gestureResult?.diagnostics?.gripCenterY,
                  )}
                </strong>
                <span>Speed</span>
                <strong>{formatDiagnostic(gestureResult?.diagnostics?.handSpeedPxPerSec, 0)}</strong>
                <span>Bucket</span>
                <strong>{gestureResult?.diagnostics?.speedBucket ?? "-"}</strong>
                <span>Gain</span>
                <strong>{formatDiagnostic(gestureResult?.diagnostics?.frictionGain, 2)}</strong>
                <span>Lag</span>
                <strong>{formatDiagnostic(gestureResult?.diagnostics?.markerLagPx, 1)}</strong>
                <span>Static</span>
                <strong>{gestureResult?.diagnostics?.staticFrictionActive ? "on" : "off"}</strong>
                <span>Points</span>
                <strong>{gestureResult?.diagnostics?.strokePointCount ?? 0}</strong>
                <span>Repositions</span>
                <strong>{gestureResult?.diagnostics?.repositionCount ?? 0}</strong>
                <span>Fallback</span>
                <strong>{gestureResult?.diagnostics?.fallbackToHandGesture ? "yes" : "no"}</strong>
              </div>
            </section>
          ) : null}

          <section className="section">
            <h2>Shortcuts</h2>
            {!cameraCaptureAvailable ? (
              <p className="hint">
                Type commands in the Command field, drag shapes from the catalogs, Shift-click
                to multi-select, and press Cmd/Ctrl+Z to undo. Gesture and voice are available
                through the companion window.
              </p>
            ) : inputMode === "touchpad" ? (
              <p className="hint">
                Press and drag to draw. Hold E to erase. Hold Shift while drawing for a straight
                line. Cmd/Ctrl+Z undoes the last local action.
              </p>
            ) : inputMode === "gesture" ? (
              <p className="hint">
                {voiceCaptureAvailable
                  ? "Use the Gesture guide above for exact poses. A held open palm activates voice; sweeping that same open palm left undoes. A relaxed hand aims, a closed hand moves, and thumb-middle snaps hide or restore the diagram."
                  : "Use the Gesture guide above for exact poses. A relaxed hand aims, a closed hand moves, a flat-palm swipe left undoes, and thumb-middle snaps hide or restore the diagram."}
              </p>
            ) : (
              <p className="hint">Mouse or trackpad draws. Hold Shift or Alt while dragging to erase.</p>
            )}
            {inputMode === "touchpad" && !shortcutsActive ? (
              <p className="hint warning-text">Click the board once to activate shortcuts.</p>
            ) : null}
          </section>
        </aside>
        ) : null}
      </div>
    </main>
  );
}

function diagramCommandContext(boardSessionId: string) {
  return {
    boardSessionId,
    actorParticipantId: PARTICIPANT_ID,
    userId: OWNER_USER_ID,
  };
}

function createAnnotationRestoreEvents(boardSessionId: string, initial: BoardState, current: BoardState): BoardEvent[] {
  const events: BoardEvent[] = [];
  for (const [strokeId, initialStroke] of Object.entries(initial.strokes)) {
    const currentStroke = current.strokes[strokeId];
    if (
      !initialStroke.annotation ||
      !currentStroke?.annotation ||
      initialStroke === currentStroke
    ) {
      continue;
    }
    events.push({
      ...createEventEnvelope({
        boardSessionId,
        actorParticipantId: PARTICIPANT_ID,
      }),
      type: "stroke.annotation_updated",
      strokeId,
      annotation: initialStroke.annotation,
      points: initialStroke.points,
    });
  }
  return events;
}

function cameraStatusLabel(status: CameraStatus): string {
  switch (status) {
    case "idle":
      return "Off";
    case "starting":
      return "Starting…";
    case "tracker_loading":
      return "Loading tracker…";
    case "active":
      return "On";
    case "blocked":
      return "Permission blocked";
    case "tracker_error":
      return "Tracker failed";
    case "error":
      return "Unavailable";
  }
}

function screenUnderlayStatusLabel(status: ScreenUnderlayStatus): string {
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

function describeCameraError(error: unknown, hasVideoStream: boolean): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission is blocked. Allow camera access for localhost and click Camera again.";
  }

  if (hasVideoStream) {
    const detail = error instanceof Error ? error.message : "Unknown tracker error";
    if (/chunkloaderror|loading chunk .+ failed/iu.test(detail)) {
      return "Airboard was updated while this page was open. Reload the page, then click Enable hands again.";
    }
    return `Camera started, but hand tracking failed: ${detail}`;
  }

  return error instanceof Error ? error.message : "Unable to start camera";
}

function assignOptionalNumber(
  point: StrokePoint,
  key:
    | "rawX"
    | "rawY"
    | "rawTipX"
    | "rawTipY"
    | "confidence"
    | "handSpeedPxPerSec"
    | "gestureConfidence"
    | "gripConfidence"
    | "tipConfidence"
    | "contactScore"
    | "frictionGain",
  value: number | undefined,
): void {
  if (value !== undefined) {
    point[key] = value;
  }
}

function formatDiagnostic(value: number | undefined, digits: number): string {
  return value === undefined ? "-" : value.toFixed(digits);
}

function formatPoint(x: number | undefined, y: number | undefined): string {
  if (x === undefined || y === undefined) {
    return "-";
  }
  return `${x.toFixed(0)}, ${y.toFixed(0)}`;
}

function getMarkerStatus(result: GestureResult | null): string {
  if (!result) {
    return "Not detected";
  }

  if (result.mode === "writing") {
    return "Writing";
  }

  if (result.mode === "repositioning") {
    return "Repositioning";
  }

  if (result.mode === "low_confidence") {
    return "Low confidence";
  }

  if (result.markerState === "MARKER_GRIP_DETECTED") {
    return "Grip detected";
  }

  if (result.markerState === "CONTACT_READY" || result.markerState === "MARKER_HOVER") {
    return "Ready";
  }

  if (result.markerState === "MARKER_LOST") {
    return "Marker lost";
  }

  return result.markerState === "HAND_DETECTED" ? "Hand detected" : "Not detected";
}

function isObjectGestureGrabStart(result: GestureResult): boolean {
  return getObjectGestureConfidence(result) >= OBJECT_GESTURE_GRAB_THRESHOLD;
}

function isObjectGestureHeld(result: GestureResult): boolean {
  return getObjectGestureConfidence(result) >= OBJECT_GESTURE_RELEASE_THRESHOLD;
}

function getObjectGestureConfidence(result: GestureResult): number {
  if (result.hand === "left" || result.gesture !== "marker") {
    return 0;
  }

  if (result.mode === "idle" || result.mode === "paused") {
    return 0;
  }

  return Math.max(
    result.confidence,
    result.diagnostics?.gestureConfidence ?? 0,
    result.diagnostics?.contactScore ?? 0,
  );
}

function objectToolLabel(tool: ObjectDockTool): string {
  return OBJECT_DOCK.find((item) => item.tool === tool)?.label ?? "Object";
}

function truncateSpeechTranscript(transcript: string, maxLength = 64): string {
  const normalized = transcript.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Speech recognizers commonly render “add a database, uh, later that is
 * connected to service” as one sentence. Convert that safe, explicit pattern
 * into the same atomic create+connect plan the semantic planner would produce,
 * so it never falls back to a manual Send click when the semantic provider is
 * unavailable.
 */
function expandSpokenCreateAndConnect(text: string): [string, string] | null {
  const match =
    /^(?:add|create|insert|place|make)\s+(?:(?:a|an|the)\s+)?(process|service|database|queue|user|api|decision|note|component|circle|rectangle|document)\b[\s,]*(?:(?:uh|um|er|erm|like|then|later|layer)[\s,]*)*(?:that\s+)?(?:is\s+)?connected\s+to\s+(?:the\s+)?(.+?)\s*[.!?]?$/i.exec(
      text.trim(),
    );
  const nodeType = match?.[1]?.trim();
  const target = match?.[2]?.trim().replace(/[.!?]+$/, "");
  if (!nodeType || !target) {
    return null;
  }
  return [`add a ${nodeType} here`, `connect this to ${target}`];
}

function speechRecognitionLabel(status: SpeechRecognitionStatus): string {
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getHandControlCoach(input: {
  cameraStatus: CameraStatus;
  handsDetected: number;
  diagnostics: HandControlDiagnostics;
}): string {
  if (input.cameraStatus !== "active") {
    return "Enable hands, then keep one full hand visible in the camera.";
  }
  if (input.handsDetected === 0) {
    return "No hand detected. Raise one open hand, keep every fingertip in frame, and face the palm toward the camera.";
  }
  if (input.diagnostics.trackingConfidence < 0.55) {
    return "Hand found, but tracking is weak. Move closer and improve front lighting.";
  }
  if (input.diagnostics.controllerState === "tracking_frozen") {
    return "Tracking paused briefly. Hold still and bring the whole hand back into frame.";
  }
  if (input.diagnostics.controllerState === "tracking_lost") {
    return "Grab cancelled because the hand was lost. Reopen the hand and reacquire the object.";
  }
  if (input.diagnostics.placementActive) {
    return "Placement preview grabbed. Move your closed hand, then open it to create the object.";
  }
  if (input.diagnostics.grabbedTargetId) {
    return "Object grabbed. Move your closed hand; open it fully to drop.";
  }
  if (input.diagnostics.requiresPinchRelease) {
    return "Open your hand to resume. A grab must be released before a new one can start.";
  }
  if (input.diagnostics.controllerState === "pinched") {
    return "Your hand is closed, but no committed object is targeted. Reopen, hover a highlighted object, then close again.";
  }
  if (input.diagnostics.focusedTargetId) {
    return "Object targeted. Close all four fingers into a fist and hold briefly to grab.";
  }
  if (input.diagnostics.grabConfidence < 0.55) {
    return "Keep the complete hand visible. Open it to point, then close the whole hand to grab.";
  }
  return "Move the open-hand cursor onto an object; its outline will highlight when it is targetable.";
}

function getInputModeLabel(mode: AirboardInputMode): string {
  switch (mode) {
    case "touchpad":
      return "Touchpad Writing";
    case "gesture":
      return "Intent Canvas";
  }
}

function getTouchpadStatus(input: {
  state: TouchpadInputState;
  tool: TouchpadTool;
  temporaryEraserActive: boolean;
  shortcutsActive: boolean;
}): string {
  if (!input.shortcutsActive && input.state !== "DRAWING" && input.state !== "ERASING") {
    return "click board";
  }

  if (input.temporaryEraserActive || input.tool === "eraser" || input.state === "ERASING") {
    return input.state === "ERASING" ? "erasing" : "eraser ready";
  }

  if (input.state === "DRAWING") {
    return "drawing";
  }

  if (input.state === "PANNING") {
    return "panning";
  }

  if (input.state === "PAUSED") {
    return "paused";
  }

  return "press + drag";
}

function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getAnnotationHandleAtPoint(
  annotation: StrokeAnnotation,
  point: AnnotationPoint,
): AnnotationResizeHandle | null {
  const hitRadius = 12;
  if (annotation.bounds) {
    const { x, y, width, height } = annotation.bounds;
    const handles: readonly { handle: AnnotationResizeHandle; point: AnnotationPoint }[] = [
      { handle: "nw", point: { x, y } },
      { handle: "ne", point: { x: x + width, y } },
      { handle: "sw", point: { x, y: y + height } },
      { handle: "se", point: { x: x + width, y: y + height } },
    ];
    return (
      handles.find((item) => Math.hypot(item.point.x - point.x, item.point.y - point.y) <= hitRadius)
        ?.handle ?? null
    );
  }

  if (annotation.start && Math.hypot(annotation.start.x - point.x, annotation.start.y - point.y) <= hitRadius) {
    return "start";
  }
  if (annotation.end && Math.hypot(annotation.end.x - point.x, annotation.end.y - point.y) <= hitRadius) {
    return "end";
  }

  return null;
}

function dockButtonClass(selected: boolean, gestureHover: boolean): string | undefined {
  const classes = [selected ? "selected" : null, gestureHover ? "gesture-hover" : null].filter(
    Boolean,
  );
  return classes.length > 0 ? classes.join(" ") : undefined;
}

// Committed diagram objects in a stable order, for keyboard Tab cycling.
function getSelectableAnnotationIds(state: BoardState): string[] {
  return Object.values(state.strokes)
    .filter((stroke) => stroke.status === "committed" && stroke.annotation)
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.id < b.id
            ? -1
            : 1,
    )
    .map((stroke) => stroke.id);
}

function formatRecordingClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function surfaceLabel(surface: Surface): string {
  if (surface === "meet-main-stage") {
    return "Meet main stage";
  }

  if (surface === "meet-side-panel") {
    return "Meet side panel";
  }

  return "Standalone prototype";
}

/**
 * Opens the standalone surface bound to the same live board session. On
 * meeting surfaces that cannot capture media, this window is where gesture
 * and voice run; edits sync back to the shared stage for everyone.
 */
function CompanionMediaLink({
  boardSessionId,
  joinToken,
}: {
  boardSessionId: string | null;
  joinToken?: string | null;
}) {
  if (!boardSessionId) {
    return <p className="hint">The companion link appears once the board connects.</p>;
  }
  return (
    <a
      className="companion-link"
      href={`/app/boards/live?boardSessionId=${encodeURIComponent(boardSessionId)}${
        joinToken ? `&joinToken=${encodeURIComponent(joinToken)}` : ""
      }`}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="companion-media-link"
    >
      Open gesture &amp; voice companion
    </a>
  );
}
