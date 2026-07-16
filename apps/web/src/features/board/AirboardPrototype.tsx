"use client";

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
  isAirboardVoiceConfirmation,
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
import { CatalogGlyph } from "./catalogGlyphs";
import { HoldToEditTracker } from "./holdToEditTracker";
import { PalmGateTracker } from "./palmGateTracker";
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
  type SemanticIntentPendingClarification,
  type SemanticIntentParserIssue,
} from "./semanticIntent";
import {
  exportCanvasPng,
  findAnnotationObjectAtPoint,
  findIntersectingStrokeIds,
  getConnectorRoutePoints,
  renderBoard,
  type AnnotationRenderObject,
} from "@airboard/drawing-engine";
import {
  defaultGestureConfig,
  defaultVirtualSurfaceFrictionConfig,
  estimateGrabStrength,
  estimatePalmPresentation,
  frictionPresets,
  GesturePipeline,
  HybridGestureController,
  MediaPipeHandTracker,
  type DetectedHand,
  type FrictionPreset,
  type FrictionStrokePoint,
  type GestureTarget,
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
import {
  parseIntentCanvasCommand,
  type IntentCanvasOperation,
  type ParsedIntentCanvasCommand,
} from "./intentCanvasParser";
import { createVoiceTraceReporter } from "./voiceTrace";

type Surface = "standalone" | "meet-side-panel" | "meet-main-stage";

type CameraStatus = "idle" | "starting" | "tracker_loading" | "active" | "blocked" | "tracker_error" | "error";

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

type ObjectGestureState = "hover" | "grab" | "placing" | "no target" | "erase";

type SpeechRecognitionStatus =
  | "idle"
  | "waiting"
  | "hearing"
  | "wake-detected"
  | "wake-missing"
  | "interpreting"
  | "command-recognized"
  | "confirmation-needed"
  | "command-rejected"
  | "error";

type PrepareIntentCommandResult = "previewed" | "applied" | "rejected";

type IntentPreparationOutcome = {
  result: PrepareIntentCommandResult;
  preparedText: string;
  source: "deterministic" | "semantic";
  stepCount: number;
  clarificationPending?: boolean;
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

type PendingSemanticClarificationState = SemanticIntentPendingClarification & {
  boardState: BoardState;
  expiresAt: number;
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

const SEMANTIC_CLARIFICATION_TTL_MS = 2 * 60 * 1_000;

type ObjectInteraction =
  | {
      mode: "placing";
      tool: ObjectDockTool;
      start: AnnotationPoint;
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
const reportVoiceTrace = createVoiceTraceReporter(AIRBOARD_API_URL);
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
    .map(({ palette, nodeType }) => ({
      label: palette.title,
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
  tools: readonly { label: string; tool: ObjectDockTool }[];
}[] = [
  {
    id: "flow",
    label: "Flow",
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
  { id: "system", label: "System", tools: catalogTools(["user", "service", "api", "database", "queue"]) },
  { id: "annotate", label: "Annotate", tools: catalogTools(["note", "circle", "box", "highlight"]) },
];

function catalogTools(tools: readonly ObjectDockTool[]): { label: string; tool: ObjectDockTool }[] {
  return tools.flatMap((tool) => {
    const entry = OBJECT_DOCK.find((item) => item.tool === tool);
    return entry ? [entry] : [];
  });
}

const CATALOG_DRAG_MIME = "application/x-airboard-tool";

// ---- Voice gates -----------------------------------------------------------
// A "gate" is an explicit, user-held addressing channel: while a gate is open
// (or within its short grace window after closing), finalized speech routes
// straight to the command pipeline without the "Airo" wake word. All gate
// timing/routing rules live in VoiceCommandRouter + PalmGateTracker +
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

export function AirboardPrototype({
  surface,
  meetingProvider = "standalone",
  providerMeetingId,
  initialBoardSessionId,
  onBoardSessionReady,
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
}) {
  const usesHostMeetingMedia = surface !== "standalone";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const trackerRef = useRef<MediaPipeHandTracker | null>(null);
  // Synchronous guard against a double-start race (state updates lag within a tick).
  const cameraStartInProgressRef = useRef(false);
  // Flipped on unmount so an in-flight startCamera can release what it acquires.
  const cameraMountedRef = useRef(true);
  const pipelineRef = useRef(new GesturePipeline());
  const hybridGestureControllerRef = useRef<HybridGestureController | null>(null);
  const hybridGestureCanvasSizeRef = useRef({ width: 0, height: 0, minTrackingConfidence: 0 });
  const hybridPinchClosedRef = useRef(false);
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
  const pendingSemanticClarificationRef = useRef<PendingSemanticClarificationState | null>(null);
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
  const palmGateTrackerRef = useRef<PalmGateTracker | null>(null);
  if (palmGateTrackerRef.current === null) {
    palmGateTrackerRef.current = new PalmGateTracker();
  }
  const holdToEditTrackerRef = useRef<HoldToEditTracker | null>(null);
  if (holdToEditTrackerRef.current === null) {
    holdToEditTrackerRef.current = new HoldToEditTracker();
  }
  const scopedKeyActiveRef = useRef(false);
  // Gesture lasso: close the hand on EMPTY canvas (Select tool) and drag a
  // selection rectangle. Board-space origin while active.
  const lassoOriginRef = useRef<{ x: number; y: number } | null>(null);
  const boardRef = useRef<BoardState>(createInitialBoardState(BOARD_SESSION_ID));
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
  const [landmarkRecordingActive, setLandmarkRecordingActive] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [viewportScale, setViewportScale] = useState(1);
  const [canvasNavMode, setCanvasNavMode] = useState<"pan" | "zoom" | null>(null);
  const [dockGestureHover, setDockGestureHover] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [actionToast, setActionToast] = useState<{ id: number; message: string } | null>(null);
  const [openCatalogId, setOpenCatalogId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechArmed, setSpeechArmed] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
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
    selectedAnnotationIdsRef.current = selectedAnnotationIds;
  }, [selectedAnnotationIds]);
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

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    renderBoard(canvas, boardRef.current, {
      view: boardViewportRef.current,
      background: "white",
      selectedStrokeId: selectedAnnotationId,
      selectedStrokeIds: selectedAnnotationIds,
      hoverStrokeId,
      ghostAnnotation,
      ghostAnnotations,
      alignmentGuides,
    });
  }, [
    alignmentGuides,
    ghostAnnotation,
    ghostAnnotations,
    hoverStrokeId,
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
    },
    [publishBoardEvent, render, updateStats],
  );

  /** A peer's event: apply and render, never re-publish (that would loop). */
  const applyRemoteEvent = useCallback(
    (event: BoardEvent) => {
      boardRef.current = applyBoardEvent(boardRef.current, event);
      render();
      updateStats();
    },
    [render, updateStats],
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

  // First-run onboarding: the gesture vocabulary is invisible until taught.
  useEffect(() => {
    if (usesHostMeetingMedia) {
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
  }, [usesHostMeetingMedia]);

  /**
   * Board sync bootstrap. With ?boardSessionId=… in the URL we join that
   * session and hydrate from the server's state; otherwise we create a new
   * session as owner and stamp its id into the URL so the page becomes a
   * shareable live-board link. If the API is unreachable the board simply
   * stays local — every feature works, nothing syncs.
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let cancelled = false;
    const requestedSessionId =
      initialBoardSessionId ??
      new URLSearchParams(window.location.search).get("boardSessionId");
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
        ownerUserId: OWNER_USER_ID,
        provider: meetingProvider,
        ...(providerMeetingId ? { providerMeetingId } : {}),
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
    // Mount-once by design: session lifetime == page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      } = {},
    ) => {
      lastGesturePointerRef.current = point;
      objectInteractionInitialStateRef.current = null;
      const inputSource = options.inputSource ?? "pointer";

      const placementTool = options.placementTool ?? activeObjectTool;
      if (isPlacementTool(placementTool)) {
        objectInteractionRef.current = {
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

      const selectedStroke = selectedAnnotationId
        ? boardRef.current.strokes[selectedAnnotationId]
        : undefined;
      const handle =
        options.forcedHandle ??
        (selectedStroke?.annotation
          ? getAnnotationHandleAtPoint(selectedStroke.annotation, point)
          : null);
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

  /**
   * Screen-space hit test of the air cursor against the catalog dock. A pinch
   * edge over a dock button activates it (open category / arm tool); mere
   * hovering highlights. Returns true when the dock consumed the pinch so the
   * caller must not also start a board grab.
   */
  const handleDockGesture = useCallback(
    (screenPoint: { x: number; y: number }, pinchJustClosed: boolean): boolean => {
      const dock = dockRef.current;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!dock || !canvasRect) {
        return false;
      }
      let hovered: { id: string; element: HTMLButtonElement } | null = null;
      for (const element of dock.querySelectorAll<HTMLButtonElement>("[data-dock-id]")) {
        const rect = element.getBoundingClientRect();
        const x = screenPoint.x + canvasRect.left;
        const y = screenPoint.y + canvasRect.top;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          hovered = { id: element.dataset.dockId ?? "", element };
          break;
        }
      }
      setDockGestureHover((current) => (current === (hovered?.id ?? null) ? current : hovered?.id ?? null));
      if (!hovered) {
        return false;
      }
      if (pinchJustClosed) {
        // Reuse the click behavior exactly — one code path for mouse and hand.
        hovered.element.click();
      }
      return true;
    },
    [],
  );

  const cancelLasso = useCallback(() => {
    if (lassoOriginRef.current) {
      lassoOriginRef.current = null;
      setGhostAnnotation(null);
    }
  }, []);

  const finalizeLasso = useCallback(
    (point: { x: number; y: number }) => {
      const origin = lassoOriginRef.current;
      lassoOriginRef.current = null;
      setGhostAnnotation(null);
      if (!origin) {
        return;
      }
      const rect = {
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
      };
      if (rect.width < 12 && rect.height < 12) {
        // A stray pinch, not a marquee.
        return;
      }
      const ids = Object.values(boardRef.current.strokes)
        .filter((stroke) => {
          const annotation = stroke.annotation;
          if (stroke.status !== "committed" || !annotation) {
            return false;
          }
          const bounds =
            annotation.bounds ??
            (annotation.start && annotation.end
              ? {
                  x: Math.min(annotation.start.x, annotation.end.x),
                  y: Math.min(annotation.start.y, annotation.end.y),
                  width: Math.abs(annotation.end.x - annotation.start.x),
                  height: Math.abs(annotation.end.y - annotation.start.y),
                }
              : null);
          if (!bounds) {
            return false;
          }
          return (
            bounds.x < rect.x + rect.width &&
            bounds.x + bounds.width > rect.x &&
            bounds.y < rect.y + rect.height &&
            bounds.y + bounds.height > rect.y
          );
        })
        .map((stroke) => stroke.id);
      setSelectedAnnotationIds(ids);
      setSelectedAnnotationId(ids[ids.length - 1] ?? null);
      setCommandFeedback(
        ids.length === 0
          ? "Nothing inside the selection area."
          : `Selected ${ids.length} object${ids.length === 1 ? "" : "s"}.`,
      );
    },
    [],
  );

  const updateLassoGhost = useCallback(
    (point: { x: number; y: number }) => {
      const origin = lassoOriginRef.current;
      if (!origin) {
        return;
      }
      const annotation: StrokeAnnotation = {
        type: "rectangle",
        source: "gesture",
        bounds: {
          x: Math.min(origin.x, point.x),
          y: Math.min(origin.y, point.y),
          width: Math.max(1, Math.abs(point.x - origin.x)),
          height: Math.max(1, Math.abs(point.y - origin.y)),
        },
      };
      setGhostAnnotation({
        annotation,
        points: buildAnnotationPoints(annotation, performance.now()),
        color: "#0f766e",
        thickness: 1,
      });
    },
    [],
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

          // The catalog dock lives in screen space and outranks board
          // interactions while the cursor is over it: pinching a dock button
          // opens/picks instead of grabbing whatever object sits beneath.
          if (screenPoint && handleDockGesture(screenPoint, pinchJustClosed)) {
            hybridGestureControllerRef.current?.reset({ requirePinchRelease: pinchJustClosed });
            setObjectGestureState("hover");
            return;
          }

          if (action?.type === "grab_cancelled") {
            cancelLasso();
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
              cancelLasso();
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
            if (hybridOutput.pinchState === "open") {
              const placementTool = objectInteractionRef.current?.mode === "placing"
                ? objectInteractionRef.current.tool
                : activeObjectTool;
              endObjectInteraction(point);
              cameraPlacementActiveRef.current = false;
              cameraGrabActiveRef.current = false;
              setCommandFeedback(
                `${objectToolLabel(placementTool)} placed. Close your hand over it to move it again.`,
              );
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
            const handleTarget = parseHandleTargetId(action.targetId);
            if (handleTarget) {
              // Grabbing a resize handle of the selected object: same
              // resizing interaction the pointer path uses.
              setObjectGestureState("grab");
              beginObjectInteraction(point, {
                inputSource: "air_gesture",
                forcedHandle: handleTarget.handle,
              });
              return;
            }
            selectAnnotationObject(action.targetId);
            setHoverStrokeId(action.targetId);
            setObjectGestureState("grab");
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              forcedStrokeId: action.targetId,
            });
            return;
          }

          if (action?.type === "drag_moved") {
            cameraGrabActiveRef.current = true;
            setObjectGestureState("grab");
            moveObjectInteraction(point, { inputSource: "air_gesture" });
            return;
          }

          if (action?.type === "grab_ended") {
            endObjectInteraction(point);
            cameraGrabActiveRef.current = false;
            setObjectGestureState("hover");
            return;
          }

          // Lasso: a closed hand over empty canvas with the Select tool drags
          // a selection marquee. Separable by definition — every other pinch
          // meaning requires a target, a dock button, or an armed tool.
          if (lassoOriginRef.current) {
            if (pinchClosed && point) {
              updateLassoGhost(point);
              setObjectGestureState("grab");
            } else if (point) {
              finalizeLasso(point);
              setObjectGestureState("hover");
            } else {
              cancelLasso();
            }
            return;
          }
          if (
            pinchJustClosed &&
            point &&
            !hybridOutput.focusedTargetId &&
            activeObjectTool === "select" &&
            !cameraPlacementArmedToolRef.current &&
            !cameraPlacementActiveRef.current &&
            !objectInteractionRef.current
          ) {
            lassoOriginRef.current = point;
            updateLassoGhost(point);
            setObjectGestureState("grab");
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
          cancelLasso();
          const lastPoint = lastGesturePointerRef.current;
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
      cancelObjectInteraction,
      commitStroke,
      endObjectInteraction,
      cancelLasso,
      eraseAt,
      finalizeLasso,
      handleDockGesture,
      updateLassoGhost,
      inputMode,
      inputPaused,
      makeFrictionPoint,
      makePoint,
      moveObjectInteraction,
      moveCursor,
      moveCursorPoint,
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
        // No confirmation gate: commit the grounded semantic plan immediately.
        applyPendingIntentRef.current?.();
        return "applied";
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
      const directResult = prepareIntentCommand(instruction, voiceTurnId);
      if (directResult !== "rejected") {
        pendingSemanticClarificationRef.current = null;
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
      const pendingClarificationState = pendingSemanticClarificationRef.current;
      const pendingClarificationForRequest =
        pendingClarificationState &&
        !boardContentChanged(pendingClarificationState.boardState, requestBoardState) &&
        pendingClarificationState.expiresAt > Date.now()
          ? {
              previousTranscript: pendingClarificationState.previousTranscript,
              question: pendingClarificationState.question,
              missingSlots: [...pendingClarificationState.missingSlots],
            }
          : null;
      // A pending clarification is dropped when the board changed or the
      // two-minute window lapsed. Surface that so a late "yes/left/user one"
      // answer is not silently reinterpreted as a brand-new command.
      let droppedClarificationNote = "";
      if (pendingClarificationState && !pendingClarificationForRequest) {
        pendingSemanticClarificationRef.current = null;
        droppedClarificationNote =
          pendingClarificationState.expiresAt <= Date.now()
            ? "Your earlier question expired, so I'm treating this as a new command. "
            : "The board changed, so I dropped my earlier question and am treating this as a new command. ";
      }

      const requestId = semanticIntentRequestIdRef.current + 1;
      semanticIntentRequestIdRef.current = requestId;
      const semanticModel =
        selectedSemanticIntentModelRef.current || semanticConfig.defaultModel;
      setSpeechRecognitionStatus("interpreting");
      setCommandFeedback(
        `${droppedClarificationNote}Understanding “${truncateSpeechTranscript(instruction)}” with ${semanticConfig.provider ?? "AI"} / ${semanticModel ?? "semantic model"}…`,
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
          voiceTurnId: voiceTurnId ?? crypto.randomUUID(),
          transcript: instruction,
          parserIssue,
          context: buildSemanticIntentContext(
            requestBoardState,
            requestSelectionIds,
            Boolean(requestPointer),
          ),
          ...(pendingClarificationForRequest
            ? { pendingClarification: pendingClarificationForRequest }
            : {}),
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
          pendingSemanticClarificationRef.current = null;
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
          if (plan.status === "clarification" && plan.clarificationQuestion) {
            pendingSemanticClarificationRef.current = {
              previousTranscript: instruction,
              question: plan.clarificationQuestion,
              missingSlots: [...plan.missingSlots],
              boardState: requestBoardState,
              expiresAt: Date.now() + SEMANTIC_CLARIFICATION_TTL_MS,
            };
            if (voiceTurnId) {
              reportVoiceTrace(voiceTurnId, "clarification", {
                question: plan.clarificationQuestion,
                issueCode: plan.issueCode,
                missingSlots: plan.missingSlots,
              });
            }
            setSpeechRecognitionStatus("confirmation-needed");
            setCommandFeedback(plan.clarificationQuestion);
          } else {
            pendingSemanticClarificationRef.current = null;
            setSpeechRecognitionStatus("command-rejected");
            setCommandFeedback(semanticIntentIssueMessage(plan.issueCode));
          }
          return {
            result: "rejected",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
            clarificationPending: plan.status === "clarification",
          };
        }

        if (
          pendingClarificationForRequest &&
          plan.actions.some((action) => action.type === "cancel" || action.type === "undo")
        ) {
          setSpeechRecognitionStatus("confirmation-needed");
          setCommandFeedback(
            `I treated “${truncateSpeechTranscript(instruction)}” as the clarification answer. ${pendingClarificationForRequest.question}`,
          );
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "semantic_failure", {
              code: "CLARIFICATION_ANSWER_MISROUTED",
              actionTypes: plan.actions.map((action) => action.type),
            });
          }
          return {
            result: "rejected",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
            clarificationPending: true,
          };
        }

        pendingSemanticClarificationRef.current = null;
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
      prepareIntentCommandWithSemantic(text).catch(() => {
        setSpeechRecognitionStatus("command-rejected");
        setCommandFeedback("Something went wrong preparing that command. Please try again.");
      });
    },
    [prepareIntentCommandWithSemantic],
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
      // Instant-commit's confirmation substitute: show what happened with a
      // one-tap escape hatch.
      setActionToast({ id: Date.now(), message: pending.message });
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
  }, [cancelPendingIntent, render, selectedAnnotationIds, updateStats]);

  useEffect(() => {
    applyPendingIntentRef.current = applyPendingIntent;
    return () => {
      applyPendingIntentRef.current = null;
    };
  }, [applyPendingIntent]);

  useEffect(() => {
    if (!actionToast) {
      return;
    }
    const timer = setTimeout(() => {
      setActionToast((current) => (current?.id === actionToast.id ? null : current));
    }, 6_000);
    return () => clearTimeout(timer);
  }, [actionToast]);


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
        if (
          pendingIntentRef.current &&
          isAirboardVoiceConfirmation(instruction)
        ) {
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "parser_outcome", {
              status: "parsed",
              operationKind: "confirm",
            });
          }
          voiceCorrectionPendingRef.current = null;
          setIntentCommandText("");
          setSpeechRecognitionStatus("command-recognized");
          applyPendingIntentRef.current?.();
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "confirmation_routed" });
          }
          await nextAnimationFrame();
          return;
        }

        voiceCorrectionPendingRef.current = null;
        setIntentCommandText(instruction);
        const outcome =
          (await prepareIntentCommandWithSemanticRef.current?.(instruction, voiceTurnId)) ?? {
            result: "rejected" as const,
            preparedText: instruction,
            source: "deterministic" as const,
            stepCount: 0,
          };
        // Commands commit instantly inside the preparer — there is no pending
        // plan to confirm and no mishear "did you mean?" prompt. A rejected
        // command just reports the rejection; the user simply repeats it.
        setSpeechRecognitionStatus(
          outcome.clarificationPending
            ? "confirmation-needed"
            : outcome.result === "rejected"
            ? "command-rejected"
            : "command-recognized",
        );
        if (outcome.clarificationPending && voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "turn_completed", {
            outcome: "awaiting_clarification",
          });
        } else if (outcome.result === "rejected" && voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "interpretation",
            outcome: "rejected",
          });
          reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "rejected" });
        }
        await nextAnimationFrame();
      })
      .catch(() => {
        setSpeechRecognitionStatus("command-rejected");
        setCommandFeedback("Airo could not apply that command. Try the typed command field.");
      });
  }, []);

  /** Mirrors the router's gate state into the pill UI. */
  const syncVoiceGateUi = useCallback(() => {
    const snapshot = voiceRouter.snapshot;
    if (!snapshot || (snapshot.mode === "ptt" && !snapshot.open)) {
      // Push-to-talk reads as released the moment the palm drops; the scoped
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
            ? "Push-to-talk: speak a board command, then relax your hand."
            : "Palm detected. Press Start Airo once to enable push-to-talk.",
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
      emitFinalTranscript: (transcript: string) =>
        routeFinalTranscript(transcript, { engine: "realtime" }),
      openPttGate: () => openVoiceGate({ mode: "ptt" }),
      resetVoiceRouting: () => {
        voiceRouter.reset();
        setVoiceGate(null);
      },
      getViewport: () => ({ ...boardViewportRef.current }),
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
  }, [currentViewportLimits, openVoiceGate, render, routeFinalTranscript, voiceRouter]);

  const startVoiceCommand = useCallback(() => {
    if (usesHostMeetingMedia) {
      setSpeechRecognitionStatus("idle");
      setCommandFeedback(
        "Google Meet owns camera and microphone access. Use typed commands or direct canvas controls in Airboard.",
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
          `Mic heard “${truncateSpeechTranscript(transcript)}”, but it wasn't addressed to the board. Raise an open palm while speaking, or say “Airo, add a user.”`,
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
              setSpeechRecognitionStatus("waiting");
              const metadata = realtimeSession?.getMetadata();
              setCommandFeedback(
                `Airo is listening${metadata ? ` via ${metadata.provider} / ${metadata.model}` : ""}. Say “Airo, add a user.”`,
              );
            }
          },
          onInterim: (transcript) => {
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
          language: typeof navigator === "undefined" ? "en-US" : navigator.language,
          model:
            selectedSpeechModelRef.current ||
            realtimeTranscriptionConfig?.defaultModel ||
            undefined,
          // Board labels bias this session's recognition toward the names on
          // screen; the transport bounds the merged list to the provider cap.
          keyterms: buildSessionKeyterms(boardRef.current),
        },
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
    routeFinalTranscript,
    speechEngine,
    speechSupported,
    syncVoiceGateUi,
    usesHostMeetingMedia,
    voiceRouter,
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
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (video) {
      video.srcObject = null;
    }
    trackerRef.current?.close();
    trackerRef.current = null;
    setCameraStatus("idle");
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (usesHostMeetingMedia) {
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (releaseIfUnmounted(stream, null)) {
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
        modelAssetPath: "/vendor/mediapipe/models/hand_landmarker.task",
      });
      if (releaseIfUnmounted(stream, tracker)) {
        video.srcObject = null;
        return;
      }
      trackerRef.current = tracker;
      setCameraStatus("active");
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
      trackerRef.current?.close();
      trackerRef.current = null;
      setCameraStatus(isPermissionError ? "blocked" : hadVideoStream ? "tracker_error" : "error");
      setCameraError(describeCameraError(error, hadVideoStream));
    } finally {
      cameraStartInProgressRef.current = false;
    }
  }, [cameraStatus, usesHostMeetingMedia]);

  const clearBoard = useCallback(() => {
    semanticIntentRequestIdRef.current += 1;
    pendingSemanticClarificationRef.current = null;
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
      const trace = {
        schemaVersion: "1.0",
        recordedAt: new Date().toISOString(),
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

  /**
   * Palm push-to-talk: an open, flat, upright hand held still briefly opens
   * the command mic gate; dropping the pose (with hysteresis) closes it. The
   * pose estimator gates hard on openness, so grabs and pointing never arm it,
   * and the stillness requirement keeps ordinary hover movement from opening
   * the mic mid-gesture.
   */
  const updatePalmPushToTalk = useCallback(
    (hands: readonly DetectedHand[], timestampMs: number) => {
      let bestScore = 0;
      let bestPoint: { x: number; y: number } | null = null;
      for (const hand of hands) {
        if (hand.landmarks.length < 21) {
          continue;
        }
        const estimate = estimatePalmPresentation(hand.landmarks);
        if (estimate.score > bestScore) {
          bestScore = estimate.score;
          const wrist = hand.landmarks[0];
          bestPoint = wrist ? { x: wrist.x, y: wrist.y } : null;
        }
      }

      // Push-to-talk requires the palm to be the ONLY tracked hand: with two
      // hands visible the user is navigating (or about to).
      const trackedHands = hands.reduce(
        (count, hand) => (hand.landmarks.length >= 21 ? count + 1 : count),
        0,
      );
      const snapshot = voiceRouter.snapshot;
      const event = palmGateTrackerRef.current!.update({
        score: bestScore,
        point: bestPoint,
        timestampMs,
        gateOpen: snapshot?.mode === "ptt" && snapshot.open,
        suppressed: (snapshot?.mode === "scoped" && snapshot.open) || trackedHands >= 2,
      });
      if (event === "engage") {
        openVoiceGate({ mode: "ptt" });
      } else if (event === "release") {
        closeVoiceGate("ptt");
      }
    },
    [closeVoiceGate, openVoiceGate, voiceRouter],
  );

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
        const result = pipelineRef.current.process({
          hands,
          timestampMs,
          config: gestureConfig,
          frictionConfig,
          frictionPreset,
          markerInputMode,
          paused: inputPaused,
          mapping: {
            canvasWidth: rect.width,
            canvasHeight: rect.height,
            mirrorInput: true,
            sensitivity,
          },
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
              hoverSmoothingTimeMs: 30,
              dragGain: 0.68,
              dragDeadZonePx: 0.5,
              areaCursorRadiusPx: 40,
              stickyReleaseRadiusPx: 64,
              trackingLossTimeoutMs: 260,
              pinch: {
                engageThreshold: 0.68,
                releaseThreshold: 0.38,
                engageDebounceMs: 75,
                releaseDebounceMs: 90,
              },
            });
            hybridGestureCanvasSizeRef.current = {
              width: roundedWidth,
              height: roundedHeight,
              minTrackingConfidence: confidenceThreshold,
            };
          }

          const signal = getHybridHandSignal(hands, result?.hand);
          captureLandmarkFrame(hands, timestampMs);

          // Two-hand canvas navigation outranks every single-hand gesture:
          // while engaged, the object controller and voice gate are suppressed
          // so pan/zoom can never grab an object or open the mic.
          const navTracker = canvasNavTrackerRef.current!;
          const navUpdate = navTracker.update({
            hands: collectNavHands(hands, rect.width, rect.height),
            timestampMs,
          });
          if (navTracker.engaged) {
            setCanvasNavMode((mode) => (mode === navTracker.mode ? mode : navTracker.mode));
            const viewport = boardViewportRef.current;
            if (navUpdate.mode === "pan") {
              applyViewport(
                panViewport(viewport, navUpdate.dx, navUpdate.dy, currentViewportLimits()),
              );
            } else if (navUpdate.mode === "zoom") {
              applyViewport(
                zoomViewport(viewport, navUpdate.factor, navUpdate.anchor, currentViewportLimits()),
              );
            }
            hybridGestureControllerRef.current.reset({ requirePinchRelease: true });
            hybridPinchClosedRef.current = false;
            palmGateTrackerRef.current!.reset();
            handleGesture(null, undefined);
            animationFrame = requestAnimationFrame(loop);
            return;
          }
          setCanvasNavMode((mode) => (mode === null ? mode : null));

          updatePalmPushToTalk(hands, timestampMs);
          const viewportForTargets = boardViewportRef.current;
          hybridOutput = hybridGestureControllerRef.current.update({
            handPoint: signal?.point ?? null,
            trackingConfidence: signal?.trackingConfidence ?? 0,
            pinchStrength: signal?.grabStrength ?? 0,
            grabConfidence: signal?.grabConfidence ?? 0,
            timestampMs,
            // The controller hit-tests in screen space; board-space object
            // bounds go through the viewport transform.
            targets: buildGestureTargets(
              boardRef.current,
              selectedAnnotationIdsRef.current.length === 1
                ? (selectedAnnotationIdsRef.current[0] ?? null)
                : null,
            ).map((target) => ({
              ...target,
              bounds: {
                x: target.bounds.x * viewportForTargets.scale + viewportForTargets.x,
                y: target.bounds.y * viewportForTargets.scale + viewportForTargets.y,
                width: target.bounds.width * viewportForTargets.scale,
                height: target.bounds.height * viewportForTargets.scale,
              },
            })),
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
    updatePalmPushToTalk,
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
        !usesHostMeetingMedia &&
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
    touchpadState,
    undoLastAction,
    usesHostMeetingMedia,
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
          <h2>Meet controls camera and microphone</h2>
          <p>
            Use Google Meet&apos;s own media buttons. Airboard does not request separate camera or
            microphone access and does not show a second video preview in Meet.
          </p>
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
    <main className={`airboard-shell${usesHostMeetingMedia ? " airboard-meet-embedded" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <h1>Airboard</h1>
          <span className="surface-label">{surfaceLabel(surface)}</span>
        </div>
        <div className="toolbar">
          {!usesHostMeetingMedia ? (
            <>
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
              <button
                className={speechArmed ? "voice-button listening" : "voice-button"}
                type="button"
                onClick={startVoiceCommand}
                disabled={!speechSupported}
                title={
                  speechSupported
                    ? speechArmed
                      ? "Stop realtime Airo listening"
                      : `Start Airo with ${voiceEngineLabel}${activeVoiceModel ? ` / ${activeVoiceModel}` : ""}`
                    : "Realtime voice is not configured; type instead"
                }
                aria-label={speechArmed ? "Stop Airo listening" : "Start Airo listening"}
              >
                {speechArmed ? "Stop Airo" : "Start Airo"}
              </button>
            </>
          ) : null}
          <button type="button" onClick={undoLastAction}>
            Undo
          </button>
          <button type="button" onClick={() => setInputPaused((value) => !value)}>
            {inputPaused ? "Resume" : "Pause"}
          </button>
          <button type="button" onClick={exportPng}>
            Export PNG
          </button>
          <button
            className="danger"
            type="button"
            onClick={handleClearClick}
            aria-label={clearArmed ? "Confirm clearing the board" : "Clear the board"}
          >
            {clearArmed ? "Confirm clear?" : "Clear"}
          </button>
        </div>
      </header>

      <div className="content">
        <section className="board-area" aria-label="Airboard canvas">
          {inputMode === "gesture" ? (
            <div ref={dockRef} className="object-dock catalog-dock" role="toolbar" aria-label="Shape catalog">
              <button
                data-dock-id="select"
                className={dockButtonClass(activeObjectTool === "select", dockGestureHover === "select")}
                type="button"
                aria-pressed={activeObjectTool === "select"}
                onClick={() => {
                  setOpenCatalogId(null);
                  activateObjectTool("select");
                }}
              >
                Select
              </button>
              {OBJECT_CATALOG.map((category) => {
                const isOpen = openCatalogId === category.id;
                const holdsActiveTool = category.tools.some(
                  (item) => item.tool === activeObjectTool,
                );
                return (
                  <div key={category.id} className="catalog-category">
                    <button
                      data-dock-id={`category:${category.id}`}
                      className={dockButtonClass(
                        isOpen || holdsActiveTool,
                        dockGestureHover === `category:${category.id}`,
                      )}
                      type="button"
                      aria-expanded={isOpen}
                      aria-haspopup="menu"
                      onClick={() =>
                        setOpenCatalogId((current) =>
                          current === category.id ? null : category.id,
                        )
                      }
                    >
                      {category.label}
                      <span aria-hidden="true" className="catalog-caret">
                        ▸
                      </span>
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
                            <span className="catalog-tile-label">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <button
                data-dock-id="eraser"
                className={dockButtonClass(activeObjectTool === "eraser", dockGestureHover === "eraser")}
                type="button"
                aria-pressed={activeObjectTool === "eraser"}
                onClick={() => {
                  setOpenCatalogId(null);
                  activateObjectTool("eraser");
                }}
              >
                Eraser
              </button>
            </div>
          ) : null}
          {!usesHostMeetingMedia && voiceGate ? (
            <div
              className={`voice-gate-pill ${speechArmed ? "armed" : "unarmed"}`}
              role="status"
              data-testid="voice-gate-pill"
            >
              <span className="voice-gate-dot" aria-hidden="true" />
              {voiceGate.mode === "ptt"
                ? speechArmed
                  ? "Listening — speak a board command"
                  : "Palm detected — press Start Airo once to enable push-to-talk"
                : speechArmed
                  ? `Editing “${voiceGate.label}” — “rename to …”, “delete”, “connect to …”`
                  : `Holding “${voiceGate.label}” — press Start Airo once to enable voice edits`}
            </div>
          ) : null}
          {!usesHostMeetingMedia && onboardingVisible && inputMode === "gesture" ? (
            <div className="onboarding-overlay" role="dialog" aria-label="How to use Airboard">
              <div className="onboarding-card">
                <h2>Talk to the board, not to software</h2>
                <ul>
                  <li>
                    <strong>Raise a flat palm</strong> and speak — no wake word.
                    “Add a payment service next to the API.”
                  </li>
                  <li>
                    <strong>Grab an element and hold it still</strong> to edit it by voice:
                    “rename to Payments”, “delete”, “connect to the database.”
                  </li>
                  <li>
                    <strong>Open hand points, closed hand grabs</strong>; reopen to drop.
                    Drag shapes from the catalogs on the left.
                  </li>
                  <li>
                    <strong>Two open palms</strong> move the canvas; <strong>two closed
                    hands</strong> spread apart or together to zoom.
                  </li>
                  <li>
                    Everything applies instantly — <strong>every change shows an Undo
                    toast</strong>, and “Airo, …” always works as a fallback.
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
          {actionToast ? (
            <div className="action-toast" role="status" data-testid="action-toast">
              <span>{actionToast.message}</span>
              <button
                type="button"
                onClick={() => {
                  undoLastAction();
                  setActionToast(null);
                }}
              >
                Undo
              </button>
              <button
                type="button"
                className="action-toast-dismiss"
                aria-label="Dismiss"
                onClick={() => setActionToast(null)}
              >
                ×
              </button>
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
          {debugVisible && gestureResult?.rawCursorPoint ? (
            <span
              className="debug-point raw"
              style={{
                left: gestureResult.rawCursorPoint.x + 14,
                top: gestureResult.rawCursorPoint.y + 14,
              }}
            />
          ) : null}
          {debugVisible && gestureResult?.diagnostics?.rawTipX !== undefined ? (
            <span
              className="debug-point tip"
              style={{
                left: gestureResult.diagnostics.rawTipX + 14,
                top: (gestureResult.diagnostics.rawTipY ?? 0) + 14,
              }}
            />
          ) : null}
          {debugVisible && gestureResult?.diagnostics?.gripCenterX !== undefined ? (
            <span
              className="debug-point grip"
              style={{
                left: gestureResult.diagnostics.gripCenterX + 14,
                top: (gestureResult.diagnostics.gripCenterY ?? 0) + 14,
              }}
            />
          ) : null}
          {debugVisible && gestureResult?.cursorPoint ? (
            <span
              className="debug-point virtual"
              style={{
                left: gestureResult.cursorPoint.x + 14,
                top: gestureResult.cursorPoint.y + 14,
              }}
            />
          ) : null}
          {debugVisible && gestureResult?.rawCursorPoint ? (
            <svg className="debug-spring" aria-hidden="true">
              <line
                x1={gestureResult.rawCursorPoint.x + 14}
                y1={gestureResult.rawCursorPoint.y + 14}
                x2={gestureResult.cursorPoint.x + 14}
                y2={gestureResult.cursorPoint.y + 14}
              />
            </svg>
          ) : null}
          {!usesHostMeetingMedia ? (
            cameraStatus !== "idle" ? (
              <video ref={videoRef} className="camera-preview" muted playsInline />
            ) : (
              <video ref={videoRef} className="camera-preview hidden" muted playsInline />
            )
          ) : null}
          {showFloatingLabelEditor && floatingLabelStyle ? (
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

        <aside className="sidebar">
          {inputMode === "gesture" ? (
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
              {!usesHostMeetingMedia &&
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
          <section className="section">
            <h2>Status</h2>
            <div className="status-grid">
              {!usesHostMeetingMedia ? (
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
                  {!usesHostMeetingMedia ? (
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
              {!usesHostMeetingMedia && inputMode === "gesture" ? (
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
              {!usesHostMeetingMedia ? (
                <>
                  <span>Hands detected</span>
                  <strong>{stats.handsDetected}</strong>
                </>
              ) : null}
            </div>
            {!usesHostMeetingMedia && cameraError ? <p className="hint">{cameraError}</p> : null}
            {!usesHostMeetingMedia && inputMode === "gesture" ? (
              <p className="hint">{handControlCoach}</p>
            ) : null}
          </section>

          <section className="section">
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
                  usesHostMeetingMedia ? (
                    <>
                      <p className="hint">
                        Type a command or use pointer, keyboard, and direct canvas controls.
                        Google Meet owns camera and microphone access; Airboard does not request
                        separate media permissions in this surface.
                      </p>
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
                      Start Airo once. Then raise a flat palm and speak (no wake word), hold an
                      element still to voice-edit it, or say “Airo, …” hands-free. Open hand
                      points, closed hand grabs; reopen to drop. Shift-click remains the
                      deterministic multi-select fallback.
                    </p>
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
            {!usesHostMeetingMedia ? (
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

          {!usesHostMeetingMedia && debugVisible ? (
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
            {usesHostMeetingMedia ? (
              <p className="hint">
                Type commands in the Command field, drag shapes from the catalogs, Shift-click
                to multi-select, and press Cmd/Ctrl+Z to undo. Use Google Meet&apos;s controls for
                camera and microphone.
              </p>
            ) : inputMode === "touchpad" ? (
              <p className="hint">
                Press and drag to draw. Hold E to erase. Hold Shift while drawing for a straight
                line. Cmd/Ctrl+Z undoes the last local action.
              </p>
            ) : inputMode === "gesture" ? (
              <p className="hint">
                Start Airo once, then talk to the board without a wake word: raise a flat, open
                palm (push-to-talk) and speak, or grab an element and hold it still to edit it by
                voice — “rename to Payments”, “delete”, “connect to the database”. Commands apply
                instantly; every change shows an Undo toast. Camera off? Select an object and hold
                V for the same scoped mic, or say “Airo, …”. Drag shapes from the catalogs on the
                left. Shift-click multi-selects; Cmd/Ctrl+Z undoes.
              </p>
            ) : (
              <p className="hint">Mouse or trackpad draws. Hold Shift or Alt while dragging to erase.</p>
            )}
            {inputMode === "touchpad" && !shortcutsActive ? (
              <p className="hint warning-text">Click the board once to activate shortcuts.</p>
            ) : null}
          </section>
        </aside>
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

function speechRecognitionLabel(status: SpeechRecognitionStatus): string {
  switch (status) {
    case "wake-detected":
      return "wake word detected";
    case "wake-missing":
      return "wake word not detected";
    case "command-recognized":
      return "command recognized";
    case "confirmation-needed":
      return "confirm suggested command";
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

function getHybridHandSignal(
  hands: readonly DetectedHand[],
  preferredHand: GestureResult["hand"],
): {
  point: { x: number; y: number };
  trackingConfidence: number;
  grabStrength: number;
  grabConfidence: number;
} | null {
  const hand =
    hands.find((candidate) => candidate.handedness === preferredHand && candidate.landmarks.length >= 21) ??
    [...hands]
      .filter((candidate) => candidate.landmarks.length >= 21)
      .sort((left, right) => right.handednessScore - left.handednessScore)[0];
  if (!hand) {
    return null;
  }

  const indexMcp = hand.landmarks[5];
  const middleMcp = hand.landmarks[9];
  const ringMcp = hand.landmarks[13];
  const pinkyMcp = hand.landmarks[17];
  if (!indexMcp || !middleMcp || !ringMcp || !pinkyMcp) {
    return null;
  }

  const grab = estimateGrabStrength(hand.landmarks);
  return {
    point: {
      x: (indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 4,
      y: (indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 4,
    },
    trackingConfidence: hand.handednessScore,
    // Report the real strength; the controller decides how to treat a
    // low-confidence frame (hold an active grab vs. allow release when idle),
    // because only it knows whether a grab is in progress.
    grabStrength: grab.strength,
    grabConfidence: grab.confidence,
  };
}

// Committed diagram objects in a stable order, for keyboard Tab cycling.
/**
 * Maps up to two tracked hands into navigation inputs: mirrored full-frame
 * canvas coordinates (matching the on-screen sense of motion) plus the grab
 * signal that separates pan (open) from zoom (closed).
 */
function dockButtonClass(selected: boolean, gestureHover: boolean): string | undefined {
  const classes = [selected ? "selected" : null, gestureHover ? "gesture-hover" : null].filter(
    Boolean,
  );
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function collectNavHands(
  hands: readonly DetectedHand[],
  canvasWidth: number,
  canvasHeight: number,
): { point: { x: number; y: number }; grabStrength: number }[] {
  const tracked = hands.filter((hand) => hand.landmarks.length >= 21);
  if (tracked.length !== 2) {
    return [];
  }
  return tracked.map((hand) => {
    const indexMcp = hand.landmarks[5]!;
    const middleMcp = hand.landmarks[9]!;
    const ringMcp = hand.landmarks[13]!;
    const pinkyMcp = hand.landmarks[17]!;
    return {
      point: {
        x: (1 - (indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 4) * canvasWidth,
        y: ((indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 4) * canvasHeight,
      },
      grabStrength: estimateGrabStrength(hand.landmarks).strength,
    };
  });
}

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

const HANDLE_TARGET_PREFIX = "handle:";

function parseHandleTargetId(
  targetId: string,
): { strokeId: string; handle: AnnotationResizeHandle } | null {
  if (!targetId.startsWith(HANDLE_TARGET_PREFIX)) {
    return null;
  }
  const separator = targetId.lastIndexOf(":");
  if (separator <= HANDLE_TARGET_PREFIX.length - 1) {
    return null;
  }
  return {
    strokeId: targetId.slice(HANDLE_TARGET_PREFIX.length, separator),
    handle: targetId.slice(separator + 1) as AnnotationResizeHandle,
  };
}

function buildGestureTargets(
  state: BoardState,
  selectedStrokeId: string | null,
): GestureTarget[] {
  const targets: GestureTarget[] = [];

  // Resize handles of the (single) selected object outrank every other
  // target, mirroring the pointer path where handles win inside the shape.
  const selected = selectedStrokeId ? state.strokes[selectedStrokeId] : undefined;
  const selectedAnnotation =
    selected?.status === "committed" ? selected.annotation : undefined;
  if (selected && selectedAnnotation) {
    const handleAnchors: { handle: AnnotationResizeHandle; x: number; y: number }[] = [];
    if (selectedAnnotation.bounds) {
      const { x, y, width, height } = selectedAnnotation.bounds;
      handleAnchors.push(
        { handle: "nw", x, y },
        { handle: "ne", x: x + width, y },
        { handle: "sw", x, y: y + height },
        { handle: "se", x: x + width, y: y + height },
      );
    } else if (selectedAnnotation.start && selectedAnnotation.end) {
      handleAnchors.push(
        { handle: "start", x: selectedAnnotation.start.x, y: selectedAnnotation.start.y },
        { handle: "end", x: selectedAnnotation.end.x, y: selectedAnnotation.end.y },
      );
    }
    for (const anchor of handleAnchors) {
      targets.push({
        id: `${HANDLE_TARGET_PREFIX}${selected.id}:${anchor.handle}`,
        bounds: { x: anchor.x - 10, y: anchor.y - 10, width: 20, height: 20 },
        priority: 3,
        capturePaddingPx: 8,
        releasePaddingPx: 14,
      });
    }
  }
  for (const stroke of Object.values(state.strokes)) {
    const annotation = stroke.annotation;
    if (stroke.status !== "committed" || !annotation) {
      continue;
    }

    if (annotation.bounds) {
      targets.push({
        id: stroke.id,
        bounds: annotation.bounds,
        priority: annotation.type === "flow_node" || annotation.type === "sticky_note" ? 2 : 1,
        capturePaddingPx: 12,
        releasePaddingPx: 18,
      });
      continue;
    }

    if (annotation.start && annotation.end) {
      // A connector is grabbable along its ENTIRE routed elbow, not just the
      // straight-line midpoint (which often sits in empty space or under a
      // node). One inflated target per route segment; all share the stroke id
      // so acquisition is seamless across corners. Priority stays below nodes
      // so a line hugging a shape never steals the shape's grab.
      const route = getConnectorRoutePoints(annotation);
      const inflate = 10;
      for (let index = 1; index < route.length; index += 1) {
        const from = route[index - 1]!;
        const to = route[index]!;
        targets.push({
          id: stroke.id,
          bounds: {
            x: Math.min(from.x, to.x) - inflate,
            y: Math.min(from.y, to.y) - inflate,
            width: Math.abs(to.x - from.x) + inflate * 2,
            height: Math.abs(to.y - from.y) + inflate * 2,
          },
          priority: annotation.type === "connector" ? 0.9 : 0.8,
          capturePaddingPx: 10,
          releasePaddingPx: 16,
        });
      }
    }
  }
  return targets;
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
