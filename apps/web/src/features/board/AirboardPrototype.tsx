"use client";

import Link from "next/link";
import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  applyDiagramCommand,
  applyDiagramUndo,
  applyBoardEvent,
  createBoardSceneElement,
  createDefaultTableData,
  createEraseAction,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  createStroke,
  invertBoardElementPatches,
  parseBoardSceneIntent,
  richTextToPlainText,
  shapeCatalogEntry,
  type AnnotationPoint,
  type AnnotationNodeType,
  type BoardElementPatchOperation,
  type BoardEvent,
  type BoardSceneElement,
  type BoardSceneIntent,
  type BoardState,
  type CodeLanguage,
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
  classifyBrowserWakeTranscript,
  createBrowserWakeSpeechSession,
  supportsBrowserSpeech,
  type BrowserWakeSpeechSession,
} from "./browserSpeech";
import {
  allowsSemanticFallbackAfterGroundingFailure,
  boardContentChanged,
  buildSemanticIntentContext,
  describeSemanticPlan,
  resolveIntentOperation,
  resolveSemanticPlanAction,
} from "./intentPipeline";
import { computeSemanticAutoLayout } from "./semanticAutoLayout";
import { commitCommandTurn } from "./commandTurnCoordinator";
import { strokeInputSourceForPointer } from "./inputCapabilities";
import { parseDesiredGraphCorrection } from "./desiredGraphCorrection";
import { resolveExistingBoardFanIn } from "./existingBoardFanIn";
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
import {
  GestureTraceJournal,
  coordinateRawLandmarkFrame,
  reportGestureInferenceFailure,
  type RawLandmarkFrameGeometry,
  type RawLandmarkFrameSource,
  type GestureTraceStage,
} from "./gestureFrameCoordinator";
import type { GestureFrameOwner } from "./gestureFrameArbitration";
import { createGestureTraceReporter } from "./gestureTrace";
import { handPerceptionOptions } from "./gesturePerceptionConfig";
import {
  GestureActionEvidenceTracker,
  holdToEditActionEvidence,
} from "./gestureActionEvidence";
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
import {
  CONFIGURED_CHROME_EXTENSION_ORIGIN,
  extensionRelayMessageFields,
  extensionRelayNonceFromHash,
  isTrustedExtensionRelayMessage,
  UNPACKED_EXTENSION_RELAY_ALLOWED,
} from "../meet/extensionRelayTrust.ts";
import { CreationToolbar } from "./CreationToolbar";
import { SceneContextToolbar } from "./SceneContextToolbar";
import { ScenePlaybackOverlay } from "./ScenePlaybackOverlay";
import {
  ALL_SHAPES,
  CREATION_DRAG_MIME,
  creationToolLabel,
  legacyToolForCreationTool,
  resolveCreationShortcut,
  type CreationToolId,
} from "./creationToolCatalog";
import { centeredTransform, createSceneElementForTool } from "./sceneCreation.ts";
import {
  linkPreviewFields,
  loadBoardAssetObjectUrl,
  resolveBoardLink,
  uploadBoardAsset,
} from "./boardContentClient.ts";
import { boardDeletionSnapshot, validateBoardTitle } from "./boardLifecycle";
import { HoldToEditTracker } from "./holdToEditTracker";
import { selectLandmarkManipulationSignal } from "./landmarkManipulationInput";
import {
  collectLandmarkNavigationHands,
  shouldReserveLandmarkNavigation,
} from "./landmarkNavigationInput";
import { selectSingleLandmarkPose } from "./landmarkPoseSelection";
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
import { buildSessionKeyterms } from "./voiceSessionKeyterms";
import {
  headlessMeetVoiceRetryDelayMs,
  shouldRetryHeadlessMeetSpeechConfig,
  shouldRetryHeadlessMeetVoiceAfterEnd,
  shouldStartHeadlessMeetVoice,
} from "./headlessMeetVoice";
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
  findSceneElementAtPoint,
  findIntersectingStrokeIds,
  renderBoard,
  sceneElementsForRender,
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
import {
  createVoiceTraceReporter,
  type VoiceTraceEvent,
} from "./voiceTrace";
import {
  InteractionAttributionTracker,
  createInteractionIntentKey,
  isExplicitInteractionCorrection,
  type InteractionFollowUpKind,
} from "./interactionAttribution";
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

type RawLandmarkFrameRequest = {
  hands: readonly DetectedHand[];
  timestampMs: number;
  inferenceMs?: number;
  source: RawLandmarkFrameSource;
  geometry: RawLandmarkFrameGeometry;
  gestureModeEnabled: boolean;
  captureLandmarks: boolean;
};

type RawLandmarkFrameOutcome = {
  owner: GestureFrameOwner | null;
  pipelineGesture: GestureResult["gesture"] | null;
  hybridState: HybridGestureControllerOutput["state"] | null;
};

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

type PrepareIntentCommandResult = "previewed" | "applied" | "no-op" | "rejected";

type IntentPreparationOutcome = {
  result: PrepareIntentCommandResult;
  preparedText: string;
  source: "deterministic" | "semantic";
  stepCount: number;
};

type SceneIntentExecutionResult =
  | "applied"
  | "rejected"
  | "deferred"
  | "unrecognized";

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
      originatingInteractionId?: string;
    }
  | {
      type: "scene_created";
      elementId: string;
    }
  | {
      type: "scene_deleted";
      elementId: string;
    }
  | {
      type: "scene_created_batch" | "scene_deleted_batch";
      elementIds: string[];
      selectionBefore?: string[];
      selectionAfter?: string[];
    }
  | {
      type: "scene_patched";
      elementId: string;
      inversePatches: BoardElementPatchOperation[];
    }
  | {
      type: "scene_batch";
      entries: { elementId: string; inversePatches: BoardElementPatchOperation[] }[];
    };

type UndoSource = "button" | "keyboard" | "voice" | "semantic";

type SceneMoveSnapshot = {
  pointerId: number;
  inputSource: NonNullable<CursorState["inputSource"]>;
  elementId: string;
  start: AnnotationPoint;
  element: BoardSceneElement;
  relatedElements: BoardSceneElement[];
  boundConnectors: Extract<BoardSceneElement, { kind: "connector" }>[];
};

type PendingIntent = {
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

type PendingSemanticClarification = {
  request: SemanticIntentPendingClarification;
  boardState: BoardState;
  selectionIds: string[];
};


type ObjectInteraction =
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
      creationTool?: CreationToolId;
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
    if (typeof window === "undefined" || accessToken || !headlessMeetOverlay) return;
    const relayNonce = extensionRelayNonceFromHash(window.location.hash);
    const relayTrust = {
      configuredOrigin: CONFIGURED_CHROME_EXTENSION_ORIGIN,
      relayNonce,
      allowNonceBoundUnpacked: UNPACKED_EXTENSION_RELAY_ALLOWED,
    };
    const receiveHostAuthentication = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.source === window.parent &&
        isTrustedExtensionRelayMessage(event, relayTrust) &&
        data?.bridge === "airboard-extension-auth" &&
        data.v === 1 &&
        data.type === "installation-token"
      ) {
        if (typeof data.token === "string" && data.token.length <= 4_096) {
          setBridgedAccessToken(data.token);
        } else if (data.token === null) {
          setBridgedAccessToken(undefined);
        }
      }
    };
    window.addEventListener("message", receiveHostAuthentication);
    // The extension may have posted its credential before React hydrated this
    // frame. Request the current value after the listener is attached so
    // authentication never depends on iframe/load timing.
    window.parent.postMessage(
      {
        bridge: "airboard-extension-auth",
        v: 1,
        type: "installation-token-request",
        ...extensionRelayMessageFields(relayNonce),
      },
      CONFIGURED_CHROME_EXTENSION_ORIGIN ?? "*",
    );
    return () => window.removeEventListener("message", receiveHostAuthentication);
  }, [accessToken, headlessMeetOverlay]);
  const gestureInteractionIdRef = useRef<string | null>(null);
  const voiceCaptureInteractionIdRef = useRef<string | null>(null);
  const gestureTraceJournalRef = useRef<GestureTraceJournal | null>(null);
  if (gestureTraceJournalRef.current === null) {
    gestureTraceJournalRef.current = new GestureTraceJournal();
  }
  const voiceTraceJournalRef = useRef<VoiceTraceEvent[]>([]);
  const reportVoiceTrace = useMemo(
    () =>
      createVoiceTraceReporter(
        AIRBOARD_API_URL,
        fetch,
        effectiveAccessToken,
        (event) => {
          voiceTraceJournalRef.current.push(structuredClone(event));
          if (voiceTraceJournalRef.current.length > 256) {
            voiceTraceJournalRef.current.shift();
          }
        },
      ),
    [effectiveAccessToken],
  );
  const interactionAttributionRef = useRef<InteractionAttributionTracker | null>(null);
  if (interactionAttributionRef.current === null) {
    interactionAttributionRef.current = new InteractionAttributionTracker();
  }
  const reportAttributedVoiceFollowUp = useCallback(
    (
      kind: Exclude<InteractionFollowUpKind, "undo">,
      followUpInteractionId: string,
      intentKey?: string,
    ) => {
      const attribution = interactionAttributionRef.current!.attribute({
        kind,
        followUpInteractionId,
        ...(intentKey ? { intentKey } : {}),
        occurredAtMs: Date.now(),
      });
      if (!attribution) {
        return;
      }
      reportVoiceTrace(attribution.originatingInteractionId, kind, {
        attributionKind: attribution.kind,
        followUpInteractionId,
        delayMs: attribution.delayMs,
      });
    },
    [reportVoiceTrace],
  );
  const reportGestureTrace = useMemo(
    () =>
      createGestureTraceReporter({
        observe: gestureTraceJournalRef.current!.append,
        post: reportVoiceTrace,
      }),
    [reportVoiceTrace],
  );
  const reportGestureStage = useCallback(
    (
      stage: GestureTraceStage,
      data: Record<string, unknown>,
      frameAtMs = performance.now(),
    ) => {
      const interactionId =
        gestureInteractionIdRef.current ?? crypto.randomUUID();
      gestureInteractionIdRef.current = interactionId;
      reportGestureTrace({ interactionId, frameAtMs, stage, data });
    },
    [reportGestureTrace],
  );
  const isMeetSurface = surface !== "standalone";
  // The Meet media bridge extension (a meet.google.com content script) can
  // stream the meeting origin's camera and microphone into this frame when
  // installed; capture always starts from an explicit user action here.
  const [meetMediaBridge, setMeetMediaBridge] = useState<MeetMediaBridge | null>(null);
  const cameraCaptureAvailable = !isMeetSurface || embeddedMediaCapture || meetMediaBridge !== null;
  const voiceCaptureAvailable = !isMeetSurface || embeddedMediaCapture || meetMediaBridge !== null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resolvedSceneImagesRef = useRef<Record<string, CanvasImageSource>>({});
  const resolvedSceneImageUrlsRef = useRef<Map<string, string>>(new Map());
  const resolvedSceneImageSourcesRef = useRef<Map<string, CanvasImageSource>>(new Map());
  const focusedSectionHashRef = useRef<string | null>(null);
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
  const pendingCameraConfidenceRestartRef = useRef(false);
  // Flipped on unmount so an in-flight startCamera can release what it acquires.
  const cameraMountedRef = useRef(true);
  const headlessCameraRequestedRef = useRef(false);
  const headlessVoiceRequestedCredentialRef = useRef<string | null>(null);
  const headlessVoiceCredentialRef = useRef<string | undefined>(effectiveAccessToken);
  const headlessVoiceRetryAttemptRef = useRef(0);
  const headlessVoiceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headlessSpeechConfigRetryAttemptRef = useRef(0);
  const headlessSpeechConfigRetryTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const [headlessVoiceRetryRevision, setHeadlessVoiceRetryRevision] = useState(0);
  const standaloneCameraResumeAttemptedRef = useRef(false);
  const standaloneVoiceResumeAttemptedRef = useRef(false);
  const pipelineRef = useRef(new GesturePipeline());
  const rawLandmarkFrameProcessorRef = useRef<
    ((frame: RawLandmarkFrameRequest) => RawLandmarkFrameOutcome) | null
  >(null);
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
  const pendingSemanticClarificationRef =
    useRef<PendingSemanticClarification | null>(null);
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
  const boardEventLogRef = useRef<BoardEvent[]>([]);
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
  const gestureActionEvidenceTrackerRef =
    useRef<GestureActionEvidenceTracker | null>(null);
  if (canvasNavTrackerRef.current === null) {
    canvasNavTrackerRef.current = new CanvasNavigationTracker();
  }
  if (gestureActionEvidenceTrackerRef.current === null) {
    gestureActionEvidenceTrackerRef.current =
      new GestureActionEvidenceTracker();
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
  const sceneDrawingRef = useRef<{
    pointerId: number;
    elementId: string;
    drawingKind: "marker" | "highlighter" | "washi";
    points: StrokePoint[];
    straight: boolean;
  } | null>(null);
  const sceneMoveRef = useRef<SceneMoveSnapshot | null>(null);
  const touchpadPointsRef = useRef<StrokePoint[]>([]);
  const lastTouchpadPointRef = useRef<StrokePoint | null>(null);
  const gesturePathRef = useRef<StrokePoint[]>([]);
  const lastGesturePointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeEraseAffectedStrokeIdsRef = useRef<Set<string>>(new Set());
  const undoStackRef = useRef<UndoAction[]>([]);
  const sceneRedoStackRef = useRef<UndoAction[]>([]);
  const objectInteractionRef = useRef<ObjectInteraction | null>(null);
  const objectInteractionInitialStateRef = useRef<BoardState | null>(null);
  const cameraGrabActiveRef = useRef(false);
  const cameraPlacementActiveRef = useRef(false);
  const cameraPlacementArmedToolRef = useRef<ObjectDockTool | null>(null);
  const shortcutsActiveRef = useRef(false);
  const temporaryEraserActiveRef = useRef(false);
  const straightLineActiveRef = useRef(false);
  const panActiveRef = useRef(false);
  const handPanRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    viewport: BoardViewport;
  } | null>(null);
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
  const [activeCreationTool, setActiveCreationTool] = useState<CreationToolId>("move");
  const activeCreationToolRef = useRef<CreationToolId>("move");
  const [temporaryHandActive, setTemporaryHandActive] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const selectedElementIdsRef = useRef<string[]>([]);
  const [hoverElementId, setHoverElementId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [sceneRenderVersion, setSceneRenderVersion] = useState(0);
  const [selectedStampEmoji, setSelectedStampEmoji] = useState("👍");
  const pendingTableSizeRef = useRef({ rows: 3, columns: 3 });
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const washiPatternInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWashiElementIdRef = useRef<string | null>(null);
  const stampHoldRef = useRef<{
    pointerId: number;
    elementId: string;
    startedAt: number;
    transform: BoardSceneElement["transform"];
  } | null>(null);
  const pendingMediaPointRef = useRef<AnnotationPoint | null>(null);
  const pendingMediaReplaceIdRef = useRef<string | null>(null);
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
  const [viewportRevision, setViewportRevision] = useState(0);
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
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);
  useEffect(() => {
    openCatalogIdRef.current = openCatalogId;
  }, [openCatalogId]);
  useEffect(() => {
    activeCreationToolRef.current = activeCreationTool;
  }, [activeCreationTool]);
  const selectedSceneElement = selectedElementId
    ? boardRef.current.elements[selectedElementId] ?? null
    : null;
  const playbackViewport = useMemo(
    () => ({ ...boardViewportRef.current }),
    [viewportRevision],
  );
  // Scene events live in a mutable board ref; reading this state makes their
  // contextual DOM controls update after patches without duplicating the board.
  void sceneRenderVersion;
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
      selectedElementId: broadcastSafe ? null : selectedElementId,
      selectedElementIds: broadcastSafe ? [] : selectedElementIds,
      hoverElementId: broadcastSafe ? null : hoverElementId,
      resolvedImages: resolvedSceneImagesRef.current,
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
    hoverElementId,
    localContrastPlatesEnabled,
    screenUnderlayStatus,
    selectedAnnotationId,
    selectedAnnotationIds,
    selectedElementId,
    selectedElementIds,
  ]);

  // Board media lives in a private bucket. Resolve authenticated blobs into
  // canvas-safe image sources and retain them until their scene references go
  // away so redraws and PNG export use the exact same pixels.
  useEffect(() => {
    const controller = new AbortController();
    const desired = new Map<string, string[]>();
    for (const element of Object.values(boardRef.current.elements)) {
      if (element.status !== "active") continue;
      if (element.kind === "media") {
        const sourceUrl =
          element.mediaKind === "video"
            ? element.asset.posterUrl
            : element.asset.thumbnailUrl ?? element.asset.url;
        if (sourceUrl) {
          desired.set(sourceUrl, [
            element.asset.id,
            element.asset.url,
            ...(element.asset.thumbnailUrl ? [element.asset.thumbnailUrl] : []),
            ...(element.asset.posterUrl ? [element.asset.posterUrl] : []),
          ]);
        }
      } else if (element.kind === "stamp" && element.faceAsset) {
        desired.set(element.faceAsset.thumbnailUrl ?? element.faceAsset.url, [
          element.faceAsset.id,
          element.faceAsset.url,
          ...(element.faceAsset.thumbnailUrl ? [element.faceAsset.thumbnailUrl] : []),
        ]);
      } else if (element.kind === "drawing" && element.style.patternAsset) {
        desired.set(element.style.patternAsset.url, [
          element.style.patternAsset.id,
          element.style.patternAsset.url,
        ]);
      }
    }

    for (const [sourceUrl, objectUrl] of resolvedSceneImageUrlsRef.current) {
      if (desired.has(sourceUrl)) continue;
      URL.revokeObjectURL(objectUrl);
      resolvedSceneImageUrlsRef.current.delete(sourceUrl);
      resolvedSceneImageSourcesRef.current.delete(sourceUrl);
    }

    const refreshResolvedImages = () => {
      const resolved: Record<string, CanvasImageSource> = {};
      for (const [sourceUrl, aliases] of desired) {
        const image = resolvedSceneImageSourcesRef.current.get(sourceUrl);
        if (!image) continue;
        for (const alias of aliases) resolved[alias] = image;
      }
      resolvedSceneImagesRef.current = resolved;
    };
    refreshResolvedImages();

    if (!effectiveAccessToken) {
      for (const objectUrl of resolvedSceneImageUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      resolvedSceneImageUrlsRef.current.clear();
      resolvedSceneImageSourcesRef.current.clear();
      resolvedSceneImagesRef.current = {};
      render();
      return () => controller.abort();
    }

    for (const sourceUrl of desired.keys()) {
      if (resolvedSceneImageSourcesRef.current.has(sourceUrl)) continue;
      void loadBoardAssetObjectUrl({
        asset: { url: sourceUrl },
        accessToken: effectiveAccessToken,
        signal: controller.signal,
      }).then(async (objectUrl) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        try {
          const image = await decodeCanvasImage(objectUrl, controller.signal);
          if (controller.signal.aborted || !desired.has(sourceUrl)) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          resolvedSceneImageUrlsRef.current.set(sourceUrl, objectUrl);
          resolvedSceneImageSourcesRef.current.set(sourceUrl, image);
          refreshResolvedImages();
          render();
        } catch {
          URL.revokeObjectURL(objectUrl);
        }
      }).catch(() => undefined);
    }

    return () => controller.abort();
  }, [effectiveAccessToken, render, sceneRenderVersion]);

  useEffect(() => () => {
    for (const objectUrl of resolvedSceneImageUrlsRef.current.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    resolvedSceneImageUrlsRef.current.clear();
    resolvedSceneImageSourcesRef.current.clear();
    resolvedSceneImagesRef.current = {};
  }, []);

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
      sceneVersion: snapshot.sceneVersion,
      elements: snapshot.elements,
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

  const refreshRealtimeSpeechKeyterms = useCallback(
    (
      state: BoardState = boardRef.current,
      selectedIds: readonly string[] = selectedAnnotationIdsRef.current,
    ) => {
      const session = speechSessionRef.current;
      if (session && "updateKeyterms" in session) {
        session.updateKeyterms(buildSessionKeyterms(state, selectedIds));
      }
    },
    [],
  );

  const applyLocalEvent = useCallback(
    (event: BoardEvent) => {
      boardRef.current = applyBoardEvent(boardRef.current, event);
      if (event.type.startsWith("element.") || event.type.startsWith("stroke.") || event.type === "board.cleared") {
        setSceneRenderVersion((version) => version + 1);
      }
      appendBoundedBoardEvents(boardEventLogRef.current, [event]);
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        refreshRealtimeSpeechKeyterms();
      }
      render();
      updateStats();
      publishBoardEvent(event);
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        schedulePersistentSnapshot(boardRef.current);
      }
    },
    [
      publishBoardEvent,
      refreshRealtimeSpeechKeyterms,
      render,
      schedulePersistentSnapshot,
      updateStats,
    ],
  );

  /** A peer's event: apply and render, never re-publish (that would loop). */
  const applyRemoteEvent = useCallback(
    (event: BoardEvent) => {
      boardRef.current = applyBoardEvent(boardRef.current, event);
      if (event.type.startsWith("element.") || event.type.startsWith("stroke.") || event.type === "board.cleared") {
        setSceneRenderVersion((version) => version + 1);
      }
      appendBoundedBoardEvents(boardEventLogRef.current, [event]);
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        refreshRealtimeSpeechKeyterms();
      }
      render();
      updateStats();
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        schedulePersistentSnapshot(boardRef.current);
      }
    },
    [
      refreshRealtimeSpeechKeyterms,
      render,
      schedulePersistentSnapshot,
      updateStats,
    ],
  );
  const applyRemoteEventRef = useRef(applyRemoteEvent);
  useEffect(() => {
    applyRemoteEventRef.current = applyRemoteEvent;
  }, [applyRemoteEvent]);

  const selectSceneElements = useCallback((ids: string[], primary = ids.at(-1) ?? null) => {
    const activeIds = ids.filter((id) => boardRef.current.elements[id]?.status === "active");
    setSelectedElementIds(activeIds);
    setSelectedElementId(primary && activeIds.includes(primary) ? primary : activeIds.at(-1) ?? null);
    setSelectedAnnotationId(null);
    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);
  }, []);

  const patchSceneElement = useCallback(
    (elementId: string, patches: BoardElementPatchOperation[]) => {
      const element = boardRef.current.elements[elementId];
      if (!element || patches.length === 0) return;
      const unlockOnly = patches.every(
        (patch) =>
          patch.op === "field.set" &&
          patch.path.length === 1 &&
          ((patch.path[0] === "locked" && patch.value === false) ||
            (patch.path[0] === "lockMode" && patch.value === "none")),
      );
      if (sceneElementLockedForMutation(boardRef.current, element) && !unlockOnly) {
        setCommandFeedback("Unlock this element before changing it.");
        return;
      }
      const inversePatches = invertBoardElementPatches(element, patches);
      if (inversePatches.length > 0) {
        undoStackRef.current.push({ type: "scene_patched", elementId, inversePatches });
        sceneRedoStackRef.current = [];
      }
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "element.patched",
        elementId,
        patches,
        baseRevision: element.revision,
      });
    },
    [applyLocalEvent],
  );

  const patchSceneElements = useCallback(
    (
      changes: readonly { elementId: string; patches: BoardElementPatchOperation[] }[],
      options: { recordHistory?: boolean } = {},
    ) => {
      const combined = new Map<string, BoardElementPatchOperation[]>();
      for (const change of changes) {
        if (change.patches.length === 0) continue;
        combined.set(change.elementId, [
          ...(combined.get(change.elementId) ?? []),
          ...change.patches,
        ]);
      }
      const entries = [...combined].flatMap(([elementId, patches]) => {
        const element = boardRef.current.elements[elementId];
        if (!element) return [];
        return [{ elementId, patches, inversePatches: invertBoardElementPatches(element, patches) }];
      });
      if (entries.length === 0) return;
      if (options.recordHistory !== false) {
        const inverseEntries = entries.flatMap(({ elementId, inversePatches }) =>
          inversePatches.length > 0 ? [{ elementId, inversePatches }] : [],
        );
        if (inverseEntries.length > 0) {
          undoStackRef.current.push({ type: "scene_batch", entries: inverseEntries });
          sceneRedoStackRef.current = [];
        }
      }
      for (const { elementId, patches } of entries) {
        const element = boardRef.current.elements[elementId];
        if (!element) continue;
        applyLocalEvent({
          ...createEventEnvelope({
            boardSessionId: boardSessionIdRef.current,
            actorParticipantId: PARTICIPANT_ID,
          }),
          type: "element.patched",
          elementId,
          patches,
          baseRevision: element.revision,
        });
      }
    },
    [applyLocalEvent],
  );

  const applySceneElementLifecycle = useCallback(
    (elementId: string, type: "element.deleted" | "element.restored") => {
      const element = boardRef.current.elements[elementId];
      if (!element) return;
      if (type === "element.deleted") {
        if (element.kind === "section") {
          patchSceneElements(
            element.memberIds.flatMap((memberId) => {
              const member = boardRef.current.elements[memberId];
              return member?.status === "active" && member.sectionId === element.id
                ? [{
                    elementId: member.id,
                    patches: [{ op: "field.unset" as const, path: ["sectionId"] }],
                  }]
                : [];
            }),
            { recordHistory: false },
          );
        } else if (element.sectionId) {
          const section = boardRef.current.elements[element.sectionId];
          if (section?.kind === "section" && section.status === "active") {
            patchSceneElements([{
              elementId: section.id,
              patches: [{
                op: "field.set",
                path: ["memberIds"],
                value: section.memberIds.filter((id) => id !== element.id),
              }],
            }], { recordHistory: false });
          }
        }
      }
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type,
        elementId,
      });
      if (type === "element.restored") {
        if (element.kind === "section") {
          patchSceneElements(
            element.memberIds.flatMap((memberId) => {
              const member = boardRef.current.elements[memberId];
              return member?.status === "active" && !member.sectionId
                ? [{
                    elementId: member.id,
                    patches: [{
                      op: "field.set" as const,
                      path: ["sectionId"],
                      value: element.id,
                    }],
                  }]
                : [];
            }),
            { recordHistory: false },
          );
        } else if (element.sectionId) {
          const section = boardRef.current.elements[element.sectionId];
          if (section?.kind === "section" && section.status === "active") {
            patchSceneElements([{
              elementId: section.id,
              patches: [{
                op: "field.set",
                path: ["memberIds"],
                value: [...new Set([...section.memberIds, element.id])],
              }],
            }], { recordHistory: false });
          }
        }
      }
    },
    [applyLocalEvent, patchSceneElements],
  );

  const deleteSceneElement = useCallback(
    (elementId: string) => {
      const element = boardRef.current.elements[elementId];
      if (!element || element.status !== "active") return;
      if (sceneElementLockedForMutation(boardRef.current, element)) {
        setCommandFeedback("Unlock this element before deleting it.");
        return;
      }
      undoStackRef.current.push({ type: "scene_deleted", elementId });
      sceneRedoStackRef.current = [];
      applySceneElementLifecycle(elementId, "element.deleted");
      selectSceneElements(selectedElementIdsRef.current.filter((id) => id !== elementId));
      if (editingElementId === elementId) setEditingElementId(null);
    },
    [applySceneElementLifecycle, editingElementId, selectSceneElements],
  );

  const deleteSceneElementsAsBatch = useCallback(
    (elementIds: readonly string[]) => {
      const activeIds = [...new Set(elementIds)].filter(
        (id) => {
          const element = boardRef.current.elements[id];
          return Boolean(
            element?.status === "active" &&
            !sceneElementLockedForMutation(boardRef.current, element),
          );
        },
      );
      if (activeIds.length === 0) return [];
      const selectionBefore = [...selectedElementIdsRef.current];
      const selectionAfter = selectionBefore.filter((id) => !activeIds.includes(id));
      undoStackRef.current.push({
        type: "scene_deleted_batch",
        elementIds: activeIds,
        selectionBefore,
        selectionAfter,
      });
      sceneRedoStackRef.current = [];
      for (const elementId of activeIds) {
        applySceneElementLifecycle(elementId, "element.deleted");
      }
      selectSceneElements(selectionAfter);
      setEditingElementId((current) => current && activeIds.includes(current) ? null : current);
      return activeIds;
    },
    [applySceneElementLifecycle, selectSceneElements],
  );

  const deleteSectionWithContents = useCallback(
    (section: Extract<BoardSceneElement, { kind: "section" }>) => {
      const elementIds = [
        section.id,
        ...sceneSectionMembers(boardRef.current, section).map(({ id }) => id),
      ].filter((id, index, values) => values.indexOf(id) === index);
      const activeIds = deleteSceneElementsAsBatch(elementIds);
      if (activeIds.length === 0) return;
      setCommandFeedback(`Deleted the section and ${Math.max(0, activeIds.length - 1)} contained element${activeIds.length === 2 ? "" : "s"}.`);
    },
    [deleteSceneElementsAsBatch],
  );

  const copySectionLink = useCallback(
    (section: Extract<BoardSceneElement, { kind: "section" }>) => {
      const url = new URL(window.location.href);
      url.hash = `section=${encodeURIComponent(section.id)}`;
      void navigator.clipboard.writeText(url.toString()).then(
        () => setCommandFeedback("Section link copied."),
        () => setCommandFeedback("Could not copy the section link."),
      );
    },
    [],
  );

  const commitSceneElement = useCallback(
    (draft: BoardSceneElement, options: { edit?: boolean; select?: boolean } = {}) => {
      const zIndex = Object.values(boardRef.current.elements).reduce(
        (maximum, element) => Math.max(maximum, element.zIndex),
        0,
      ) + 1;
      let element = {
        ...draft,
        boardId: boardSessionIdRef.current,
        zIndex,
      } as BoardSceneElement;
      const containingSection = element.kind === "section"
        ? undefined
        : Object.values(boardRef.current.elements)
          .filter(
            (candidate): candidate is Extract<BoardSceneElement, { kind: "section" }> =>
              candidate.kind === "section" &&
              candidate.status === "active" &&
              candidate.visible &&
              sceneElementFitsInside(element, candidate),
          )
          .sort((a, b) => b.zIndex - a.zIndex)[0];
      if (containingSection) {
        element = { ...element, sectionId: containingSection.id } as BoardSceneElement;
      }
      undoStackRef.current.push({ type: "scene_created", elementId: element.id });
      sceneRedoStackRef.current = [];
      applyLocalEvent({
        ...createEventEnvelope({
          boardSessionId: boardSessionIdRef.current,
          actorParticipantId: PARTICIPANT_ID,
        }),
        type: "element.created",
        element,
      });
      if (containingSection) {
        patchSceneElements([{
          elementId: containingSection.id,
          patches: [{
            op: "field.set",
            path: ["memberIds"],
            value: [...new Set([...containingSection.memberIds, element.id])],
          }],
        }], { recordHistory: false });
      }
      if (options.select !== false) selectSceneElements([element.id], element.id);
      if (options.edit) setEditingElementId(element.id);
      setActiveCreationTool("move");
      activeCreationToolRef.current = "move";
      setActiveObjectTool("select");
      setCommandFeedback(`${sceneElementKindLabel(element.kind)} added.`);
      return element;
    },
    [applyLocalEvent, patchSceneElements, selectSceneElements],
  );

  const commitSceneElementsAsBatch = useCallback(
    (
      drafts: readonly BoardSceneElement[],
      options: { select?: boolean } = {},
    ) => {
      if (drafts.length === 0) return [];
      const selectionBefore = [...selectedElementIdsRef.current];
      const historyStart = undoStackRef.current.length;
      const created = drafts.map((draft) => commitSceneElement(draft, { select: false }));
      const elementIds = created.map(({ id }) => id);
      const selectionAfter = options.select === false ? selectionBefore : elementIds;
      undoStackRef.current.splice(historyStart);
      undoStackRef.current.push({
        type: "scene_created_batch",
        elementIds,
        selectionBefore,
        selectionAfter,
      });
      sceneRedoStackRef.current = [];
      const last = created.at(-1);
      if (last && options.select !== false) selectSceneElements(elementIds, last.id);
      return created;
    },
    [commitSceneElement, selectSceneElements],
  );

  const createSceneElementAtPoint = useCallback(
    (
      tool: CreationToolId,
      point: AnnotationPoint,
      options: { table?: { rows: number; columns: number }; label?: string; language?: CodeLanguage } = {},
    ) => {
      const attachmentTarget = tool === "stamp" || tool === "insert:face-stamp"
        ? findSceneElementAtPoint(boardRef.current, point)
        : null;
      const element = createSceneElementForTool(tool, {
        boardId: boardSessionIdRef.current,
        ...(accountUserId ? { creatorId: accountUserId } : {}),
        point,
        stampEmoji: selectedStampEmoji,
        ...(tool === "table" && !options.table ? { table: pendingTableSizeRef.current } : {}),
        ...options,
      });
      if (!element) return null;
      const created = commitSceneElement(element, {
        edit: ["sticky", "shape", "text", "code_block", "mind_map_node"].includes(element.kind),
      });
      if (created.kind === "stamp" && attachmentTarget && attachmentTarget.id !== created.id) {
        const cellId = attachmentTarget.kind === "table"
          ? tableCellIdAtPoint(attachmentTarget, point)
          : null;
        patchSceneElements([{
          elementId: created.id,
          patches: [{
            op: "attachment.changed",
            attachment: cellId
              ? { kind: "table_cell", tableId: attachmentTarget.id, cellId }
              : { kind: "element", elementId: attachmentTarget.id, anchor: "auto" },
          }],
        }], { recordHistory: false });
      }
      return created;
    },
    [accountUserId, commitSceneElement, patchSceneElements, selectedStampEmoji],
  );

  const duplicateSceneElement = useCallback(
    (elementId: string) => {
      const source = boardRef.current.elements[elementId];
      if (!source) return;
      const now = new Date().toISOString();
      const shifted = structuredClone(source);
      shifted.id = crypto.randomUUID();
      shifted.status = "active";
      shifted.transform.x += 24;
      shifted.transform.y += 24;
      shifted.createdAt = now;
      shifted.updatedAt = now;
      shifted.revision = 1;
      delete shifted.legacyStrokeId;
      if (shifted.kind === "connector") {
        shifted.start.point = { x: shifted.start.point.x + 24, y: shifted.start.point.y + 24 };
        shifted.end.point = { x: shifted.end.point.x + 24, y: shifted.end.point.y + 24 };
        shifted.controlPoints = shifted.controlPoints.map((point) => ({ x: point.x + 24, y: point.y + 24 }));
      } else if (shifted.kind === "section") {
        shifted.memberIds = [];
      } else if (shifted.kind === "mind_map_node") {
        shifted.relation = {
          direction: shifted.relation.direction,
          childIds: [],
          connectorIds: [],
        };
      }
      commitSceneElement(shifted);
    },
    [commitSceneElement],
  );

  const quickCreateSceneElement = useCallback(
    (element: BoardSceneElement, direction: "left" | "right" | "up" | "down") => {
      const source = boardRef.current.elements[element.id];
      if (!source || (source.kind !== "sticky" && source.kind !== "shape")) return;
      const gap = 72;
      const offset = direction === "left"
        ? { x: -(source.transform.width + gap), y: 0 }
        : direction === "right"
          ? { x: source.transform.width + gap, y: 0 }
          : direction === "up"
            ? { x: 0, y: -(source.transform.height + gap) }
            : { x: 0, y: source.transform.height + gap };
      const now = new Date().toISOString();
      const duplicate = structuredClone(source);
      duplicate.id = crypto.randomUUID();
      duplicate.createdAt = now;
      duplicate.updatedAt = now;
      duplicate.revision = 1;
      duplicate.transform.x += offset.x;
      duplicate.transform.y += offset.y;
      delete duplicate.legacyStrokeId;
      const created = commitSceneElement(duplicate);
      if (source.kind === "shape" && created.kind === "shape") {
        const start = connectorAnchorPoint(source, "auto", elementCenter(created));
        const end = connectorAnchorPoint(created, "auto", elementCenter(source));
        commitSceneElement(createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "connector",
          pathKind: "bent",
          transform: boundsBetween(start, end),
          start: { point: start, binding: { elementId: source.id, anchor: "auto" }, decoration: "none" },
          end: { point: end, binding: { elementId: created.id, anchor: "auto" }, decoration: "solid_arrow" },
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        }), { select: false });
        selectSceneElements([created.id], created.id);
      }
      setEditingElementId(created.id);
    },
    [accountUserId, commitSceneElement, selectSceneElements],
  );

  const connectMindMapTarget = useCallback(
    (
      parent: Extract<BoardSceneElement, { kind: "mind_map_node" }>,
      target: BoardSceneElement,
    ) => {
      const parentCenter = elementCenter(parent);
      const targetCenter = elementCenter(target);
      const start = connectorAnchorPoint(parent, "auto", targetCenter);
      const end = connectorAnchorPoint(target, "auto", parentCenter);
      const connector = commitSceneElement(createBoardSceneElement({
        id: crypto.randomUUID(),
        boardId: boardSessionIdRef.current,
        kind: "connector",
        pathKind: "curved",
        transform: boundsBetween(start, end),
        start: { point: start, binding: { elementId: parent.id, anchor: "auto" }, decoration: "none" },
        end: { point: end, binding: { elementId: target.id, anchor: "auto" }, decoration: "none" },
        style: {
          color: parent.style.lineColor,
          opacity: 1,
          thickness: "thin",
          strokeStyle: "solid",
          labelBackground: "none",
        },
        ...(accountUserId ? { creatorId: accountUserId } : {}),
      }), { select: false });
      const currentParent = boardRef.current.elements[parent.id];
      const parentRelation = currentParent?.kind === "mind_map_node"
        ? currentParent.relation
        : parent.relation;
      patchSceneElement(parent.id, [{
        op: "mind_map.relation.changed",
        relation: {
          ...parentRelation,
          childIds: [...new Set([...parentRelation.childIds, target.id])],
          connectorIds: [...new Set([...parentRelation.connectorIds, connector.id])],
        },
      }]);
      if (target.kind === "mind_map_node") {
        patchSceneElement(target.id, [{
          op: "mind_map.relation.changed",
          relation: {
            ...target.relation,
            parentId: parent.id,
            connectorIds: [...new Set([...target.relation.connectorIds, connector.id])],
          },
        }]);
      } else {
        patchSceneElement(target.id, [{
          op: "attachment.changed",
          attachment: { kind: "element", elementId: parent.id, anchor: "auto" },
        }]);
      }
      return connector;
    },
    [accountUserId, commitSceneElement, patchSceneElement],
  );

  const addMindMapChild = useCallback(
    (parent: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => {
      const offset = mindMapDirectionOffset(parent.relation.direction, parent.transform);
      const child = commitSceneElement(createBoardSceneElement({
        id: crypto.randomUUID(),
        boardId: boardSessionIdRef.current,
        kind: "mind_map_node",
        transform: {
          x: parent.transform.x + offset.x,
          y: parent.transform.y + offset.y,
          width: parent.transform.width,
          height: parent.transform.height,
          rotation: 0,
        },
        relation: { parentId: parent.id, childIds: [], direction: parent.relation.direction, connectorIds: [] },
        style: { ...parent.style },
        content: createRichTextDocument("New idea"),
        ...(accountUserId ? { creatorId: accountUserId } : {}),
      }));
      connectMindMapTarget(parent, child);
      selectSceneElements([child.id], child.id);
      setEditingElementId(child.id);
    },
    [accountUserId, commitSceneElement, connectMindMapTarget, selectSceneElements],
  );

  const addMindMapSibling = useCallback(
    (node: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => {
      const parent = node.relation.parentId
        ? boardRef.current.elements[node.relation.parentId]
        : null;
      if (parent?.kind === "mind_map_node") {
        const siblingCount = parent.relation.childIds.length;
        const sibling = commitSceneElement(createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "mind_map_node",
          transform: {
            ...node.transform,
            x: node.transform.x + (node.relation.direction === "up" || node.relation.direction === "down" ? node.transform.width + 36 : 0),
            y: node.transform.y + (node.relation.direction === "left" || node.relation.direction === "right" ? node.transform.height + 32 : 0),
          },
          relation: { parentId: parent.id, childIds: [], direction: node.relation.direction, connectorIds: [] },
          style: { ...node.style },
          content: createRichTextDocument(`Idea ${siblingCount + 1}`),
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        }));
        connectMindMapTarget(parent, sibling);
        selectSceneElements([sibling.id], sibling.id);
        setEditingElementId(sibling.id);
        return;
      }
      addMindMapChild(node);
    },
    [accountUserId, addMindMapChild, commitSceneElement, connectMindMapTarget, selectSceneElements],
  );

  const attachMindMapSelection = useCallback(
    (node: Extract<BoardSceneElement, { kind: "mind_map_node" }>) => {
      const targets = selectedElementIdsRef.current
        .filter((id) => id !== node.id)
        .flatMap((id) => boardRef.current.elements[id] ? [boardRef.current.elements[id]!] : [])
        .filter((element) => ["sticky", "shape", "text", "mind_map_node"].includes(element.kind));
      if (targets.length === 0) {
        setCommandFeedback("Select this node with a sticky, shape, text item, or mind-map node to attach it.");
        return;
      }
      targets.forEach((target) => connectMindMapTarget(node, target));
      selectSceneElements([node.id, ...targets.map(({ id }) => id)], node.id);
      setCommandFeedback(`Attached ${targets.length} object${targets.length === 1 ? "" : "s"} to the mind map.`);
    },
    [connectMindMapTarget, selectSceneElements],
  );

  const requestMediaAtPoint = useCallback((point: AnnotationPoint) => {
    pendingMediaReplaceIdRef.current = null;
    pendingMediaPointRef.current = point;
    mediaInputRef.current?.click();
  }, []);

  const requestMediaReplacement = useCallback((element: Extract<BoardSceneElement, { kind: "media" }>) => {
    pendingMediaReplaceIdRef.current = element.id;
    pendingMediaPointRef.current = elementCenter(element);
    mediaInputRef.current?.click();
  }, []);

  const setMediaPlayback = useCallback(
    (media: Extract<BoardSceneElement, { kind: "media" }>, playing: boolean) => {
      const changes: { elementId: string; patches: BoardElementPatchOperation[] }[] = [{
        elementId: media.id,
        patches: [{ op: "field.set", path: ["playing"], value: playing }],
      }];
      if (playing) {
        for (const candidate of Object.values(boardRef.current.elements)) {
          if (
            candidate.kind === "media" &&
            candidate.id !== media.id &&
            candidate.status === "active" &&
            candidate.playing
          ) {
            changes.push({
              elementId: candidate.id,
              patches: [{ op: "field.set", path: ["playing"], value: false }],
            });
          }
        }
      }
      patchSceneElements(changes);
    },
    [patchSceneElements],
  );

  const requestWashiPatternReplacement = useCallback(
    (drawing: Extract<BoardSceneElement, { kind: "drawing" }>) => {
      pendingWashiElementIdRef.current = drawing.id;
      washiPatternInputRef.current?.click();
    },
    [],
  );

  const handleWashiPatternSelected = useCallback(
    async (file: File | null) => {
      const elementId = pendingWashiElementIdRef.current;
      pendingWashiElementIdRef.current = null;
      if (!file || !elementId) return;
      if (!file.type.startsWith("image/")) {
        setCommandFeedback("Washi patterns must be an image.");
        return;
      }
      if (!effectiveAccessToken || !persistentBoardId) {
        setCommandFeedback("Custom washi patterns require a saved, signed-in Airboard.");
        return;
      }
      try {
        const uploaded = await uploadBoardAsset({
          boardId: persistentBoardId,
          accessToken: effectiveAccessToken,
          file,
        });
        const { mediaKind: _mediaKind, ...asset } = uploaded;
        patchSceneElement(elementId, [{
          op: "field.set",
          path: ["style", "patternAsset"],
          value: asset,
        }]);
        setCommandFeedback("Custom washi pattern applied.");
      } catch (caught) {
        setCommandFeedback(caught instanceof Error ? caught.message : "Could not upload that pattern.");
      }
    },
    [effectiveAccessToken, patchSceneElement, persistentBoardId],
  );

  const insertLinkAtPoint = useCallback(
    async (point: AnnotationPoint) => {
      if (!effectiveAccessToken) {
        setCommandFeedback("Sign in to add a protected link preview.");
        return;
      }
      const requested = window.prompt("Paste an http(s) link");
      if (!requested?.trim()) return;
      setCommandFeedback("Resolving a safe link preview…");
      try {
        const preview = await resolveBoardLink({ url: requested.trim(), accessToken: effectiveAccessToken });
        const id = crypto.randomUUID();
        commitSceneElement(createBoardSceneElement({
          id,
          boardId: boardSessionIdRef.current,
          kind: "link_preview",
          transform: centeredTransform(point, { width: 340, height: 168 }),
          ...linkPreviewFields(preview),
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        }));
      } catch (caught) {
        setCommandFeedback(
          caught instanceof Error ? `Could not add link: ${caught.message}` : "Could not add that link.",
        );
      }
    },
    [accountUserId, commitSceneElement, effectiveAccessToken],
  );

  const handleMediaFileSelected = useCallback(
    async (file: File | null) => {
      const point = pendingMediaPointRef.current;
      const replacementId = pendingMediaReplaceIdRef.current;
      pendingMediaPointRef.current = null;
      pendingMediaReplaceIdRef.current = null;
      if (!file || !point) return;
      if (!effectiveAccessToken || !persistentBoardId) {
        setCommandFeedback("Media uploads require a saved, signed-in Airboard.");
        return;
      }
      setCommandFeedback(`Uploading ${file.name}…`);
      try {
        const uploaded = await uploadBoardAsset({
          boardId: persistentBoardId,
          accessToken: effectiveAccessToken,
          file,
        });
        const { mediaKind, ...asset } = uploaded;
        if (replacementId && boardRef.current.elements[replacementId]?.kind === "media") {
          patchSceneElement(replacementId, [
            { op: "field.set", path: ["mediaKind"], value: mediaKind },
            { op: "field.set", path: ["asset"], value: asset },
            { op: "field.set", path: ["altText"], value: file.name },
            { op: "field.set", path: ["crop"], value: { x: 0, y: 0, width: 1, height: 1, zoom: 1 } },
          ]);
          setCommandFeedback(`${file.name} replaced the selected media.`);
          return;
        }
        commitSceneElement(createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "media",
          transform: centeredTransform(point, { width: 320, height: 240 }),
          mediaKind,
          asset,
          altText: file.name,
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        }));
      } catch (caught) {
        setCommandFeedback(
          caught instanceof Error ? `Media upload failed: ${caught.message}` : "Media upload failed.",
        );
      } finally {
        if (mediaInputRef.current) mediaInputRef.current.value = "";
      }
    },
    [
      accountUserId,
      commitSceneElement,
      effectiveAccessToken,
      patchSceneElement,
      persistentBoardId,
    ],
  );

  const beginSceneDrawing = useCallback(
    (
      pointerId: number,
      point: StrokePoint,
      drawingKind: "marker" | "highlighter" | "washi",
      straight: boolean,
    ) => {
      const elementId = crypto.randomUUID();
      const thickness = drawingKind === "marker" ? strokeThickness : drawingKind === "highlighter" ? 24 : 18;
      const color = drawingKind === "marker" ? strokeColor : drawingKind === "highlighter" ? "#facc15" : "#a78bfa";
      sceneDrawingRef.current = { pointerId, elementId, drawingKind, points: [point], straight };
      boardRef.current = {
        ...boardRef.current,
        activeStrokes: {
          ...boardRef.current.activeStrokes,
          [elementId]: createStroke({
            id: elementId,
            boardId: boardSessionIdRef.current,
            userId: accountUserId ?? PARTICIPANT_ID,
            point,
            color,
            thickness,
            createdAt: new Date().toISOString(),
          }),
        },
      };
      render();
    },
    [accountUserId, render, strokeColor, strokeThickness],
  );

  const appendSceneDrawingPoint = useCallback(
    (pointerId: number, point: StrokePoint) => {
      const active = sceneDrawingRef.current;
      if (!active || active.pointerId !== pointerId) return false;
      const previous = active.points.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return true;
      active.points.push(point);
      const transient = boardRef.current.activeStrokes[active.elementId];
      if (transient) {
        boardRef.current = {
          ...boardRef.current,
          activeStrokes: {
            ...boardRef.current.activeStrokes,
            [active.elementId]: { ...transient, points: [...active.points], updatedAt: new Date().toISOString() },
          },
        };
        render();
      }
      return true;
    },
    [render],
  );

  const commitSceneDrawing = useCallback(
    (pointerId: number) => {
      const active = sceneDrawingRef.current;
      if (!active || active.pointerId !== pointerId) return false;
      sceneDrawingRef.current = null;
      const { [active.elementId]: _transient, ...activeStrokes } = boardRef.current.activeStrokes;
      boardRef.current = { ...boardRef.current, activeStrokes };
      const rawPoints = active.points;
      if (rawPoints.length === 0) {
        render();
        return true;
      }
      const points = active.straight && rawPoints.length > 1
        ? [rawPoints[0]!, rawPoints.at(-1)!]
        : rawPoints;
      const bounds = strokePointBounds(points, active.drawingKind === "highlighter" ? 24 : 8);
      const touched = active.drawingKind === "highlighter"
        ? points.map((point) => findSceneElementAtPoint(boardRef.current, point)).find(Boolean)
        : null;
      commitSceneElement(createBoardSceneElement({
        id: active.elementId,
        boardId: boardSessionIdRef.current,
        kind: "drawing",
        drawingKind: active.drawingKind,
        points,
        transform: { ...bounds, rotation: 0 },
        style: {
          color: active.drawingKind === "marker" ? strokeColor : active.drawingKind === "highlighter" ? "#facc15" : "#a78bfa",
          thickness: active.drawingKind === "marker" ? strokeThickness : active.drawingKind === "highlighter" ? 24 : 18,
          opacity: active.drawingKind === "highlighter" ? 0.35 : 1,
          straight: active.straight,
        },
        ...(touched ? { attachment: { kind: "element", elementId: touched.id, anchor: "auto" } as const } : {}),
        ...(accountUserId ? { creatorId: accountUserId } : {}),
      }), { select: false });
      return true;
    },
    [accountUserId, commitSceneElement, render, strokeColor, strokeThickness],
  );

  const eraseSceneDrawingsAt = useCallback(
    (point: AnnotationPoint, radius = ERASER_RADIUS) => {
      const hits = Object.values(boardRef.current.elements).filter(
        (element) =>
          element.kind === "drawing" &&
          element.status === "active" &&
          drawingElementIntersectsCircle(element, point, radius),
      );
      for (const element of hits) deleteSceneElement(element.id);
      return hits.length > 0;
    },
    [deleteSceneElement],
  );

  const beginSceneMove = useCallback((
    pointerId: number,
    element: BoardSceneElement,
    point: AnnotationPoint,
    inputSource: NonNullable<CursorState["inputSource"]>,
  ) => {
    const parentSection = element.sectionId
      ? boardRef.current.elements[element.sectionId]
      : null;
    if (
      element.locked ||
      (parentSection?.kind === "section" && parentSection.status === "active" && parentSection.lockMode === "all") ||
      (element.kind === "section" && element.lockMode !== "none")
    ) {
      setCommandFeedback("This element is locked.");
      return false;
    }
    const sectionMembers = element.kind === "section"
      ? sceneSectionMembers(boardRef.current, element).map((member) => structuredClone(member))
      : [];
    const movingIds = new Set([element.id, ...sectionMembers.map(({ id }) => id)]);
    const attachedElements = Object.values(boardRef.current.elements)
      .filter((candidate) => {
        if (candidate.status !== "active" || movingIds.has(candidate.id) || !candidate.attachment) return false;
        return candidate.attachment.kind === "element"
          ? movingIds.has(candidate.attachment.elementId)
          : movingIds.has(candidate.attachment.tableId);
      })
      .map((candidate) => structuredClone(candidate));
    const relatedElements = [...sectionMembers, ...attachedElements];
    for (const related of attachedElements) movingIds.add(related.id);
    const boundConnectors = Object.values(boardRef.current.elements).filter(
      (candidate): candidate is Extract<BoardSceneElement, { kind: "connector" }> =>
        candidate.kind === "connector" &&
        candidate.status === "active" &&
        !movingIds.has(candidate.id) &&
        Boolean(
          (candidate.start.binding && movingIds.has(candidate.start.binding.elementId)) ||
          (candidate.end.binding && movingIds.has(candidate.end.binding.elementId)),
        ),
    ).map((connector) => structuredClone(connector));
    sceneMoveRef.current = {
      pointerId,
      inputSource,
      elementId: element.id,
      start: point,
      element: structuredClone(element),
      relatedElements,
      boundConnectors,
    };
    selectSceneElements([element.id], element.id);
    return true;
  }, [selectSceneElements]);

  const previewSceneMove = useCallback((pointerId: number, point: AnnotationPoint) => {
    const movement = sceneMoveRef.current;
    if (!movement || movement.pointerId !== pointerId) return false;
    const dx = point.x - movement.start.x;
    const dy = point.y - movement.start.y;
    const previewElements = buildSceneMovePreview(
      movement,
      dx,
      dy,
      boardRef.current.elements,
    );
    boardRef.current = {
      ...boardRef.current,
      elements: previewElements,
    };
    render();
    return true;
  }, [render]);

  const commitSceneMove = useCallback((pointerId: number, point: AnnotationPoint) => {
    const movement = sceneMoveRef.current;
    if (!movement || movement.pointerId !== pointerId) return false;
    sceneMoveRef.current = null;
    const dx = point.x - movement.start.x;
    const dy = point.y - movement.start.y;
    const finalElements = buildSceneMovePreview(
      movement,
      dx,
      dy,
      boardRef.current.elements,
    );
    const restoredElements = { ...boardRef.current.elements };
    for (const original of [movement.element, ...movement.relatedElements, ...movement.boundConnectors]) {
      restoredElements[original.id] = original;
    }
    boardRef.current = {
      ...boardRef.current,
      elements: restoredElements,
    };
    const changes: { elementId: string; patches: BoardElementPatchOperation[] }[] = [
      movement.element,
      ...movement.relatedElements,
    ].map((original) => ({
      elementId: original.id,
      patches: [
        ...sceneElementMovePatches(original, dx, dy),
        ...(original.id === movement.element.id
          ? [{
              op: "field.set" as const,
              path: ["metadata", "lastInputSource"] as [string, string],
              value: movement.inputSource,
            }]
          : []),
      ],
    }));
    for (const original of movement.boundConnectors) {
      const rebound = finalElements[original.id];
      if (rebound?.kind !== "connector") continue;
      changes.push({
        elementId: original.id,
        patches: connectorGeometryPatches(rebound),
      });
    }
    if (movement.element.kind !== "section") {
      const moved = finalElements[movement.element.id];
      if (moved) appendSectionContainmentChanges(boardRef.current, movement.element, moved, changes);
    }
    patchSceneElements(changes);
    return true;
  }, [patchSceneElements]);

  const executeSceneIntent = useCallback(
    (intent: BoardSceneIntent): SceneIntentExecutionResult => {
      if (intent.type === "invalid") {
        setCommandFeedback(
          intent.reason === "TABLE_CELL_LIMIT_EXCEEDED"
            ? "Tables can contain at most 500 cells."
            : "Use positive row and column counts.",
        );
        return "rejected";
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = boardPointFromScreen(boardViewportRef.current, {
        x: (rect?.width ?? 960) / 2,
        y: (rect?.height ?? 640) / 2,
      });
      const targetIds = (target: Extract<BoardSceneIntent, { type: "rename" | "delete" | "move" | "resize" | "style" | "group" | "layout" }>["target"]) =>
        resolveSceneIntentTargetIds(boardRef.current, target, selectedElementIdsRef.current);

      if (intent.type === "create_connected") {
        const targetMatches = resolveSceneIntentTargetIds(
          boardRef.current,
          intent.to,
          selectedElementIdsRef.current,
        );
        if (targetMatches.length !== 1) {
          setCommandFeedback(
            targetMatches.length === 0
              ? "I couldn't find the element to connect to."
              : "More than one element matches that name; select one and try again.",
          );
          return "rejected";
        }
        const targetId = targetMatches[0];
        const target = targetId ? boardRef.current.elements[targetId] : null;
        const definition = ALL_SHAPES.find(({ kind }) => kind === intent.shapeKind);
        if (!target || !definition) return "unrecognized";
        const targetCenter = elementCenter(target);
        const createPoint = {
          x: targetCenter.x + target.transform.width / 2 + 180,
          y: targetCenter.y,
        };
        const created = createSceneElementForTool(`shape:${definition.id}`, {
          boardId: boardSessionIdRef.current,
          ...(accountUserId ? { creatorId: accountUserId } : {}),
          point: createPoint,
          ...(intent.label ? { label: intent.label } : {}),
        });
        if (!created) return "unrecognized";
        const createdCenter = elementCenter(created);
        const start = connectorAnchorPoint(created, "auto", targetCenter);
        const end = connectorAnchorPoint(target, "auto", createdCenter);
        const connector = createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "connector",
          pathKind: intent.pathKind,
          transform: boundsBetween(start, end),
          start: {
            point: start,
            binding: { elementId: created.id, anchor: "auto" },
            decoration: "none",
          },
          end: {
            point: end,
            binding: { elementId: target.id, anchor: "auto" },
            decoration: "solid_arrow",
          },
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        });
        commitSceneElementsAsBatch([created, connector]);
        return "applied";
      }

      if (intent.type === "create") {
        const selectedPlacementTarget = intent.placement
          ? [...selectedElementIdsRef.current]
            .reverse()
            .map((id) => boardRef.current.elements[id])
            .find((element): element is BoardSceneElement => Boolean(element?.status === "active"))
          : null;
        if (intent.placement && !selectedPlacementTarget) {
          setCommandFeedback("Select an element before using relative placement.");
          return "rejected";
        }
        const placementCenter = selectedPlacementTarget && intent.placement
          ? sceneIntentPlacementPoint(selectedPlacementTarget, intent.placement.direction)
          : center;
        if (intent.kind === "media") {
          setCommandFeedback("Choose an image, GIF, or video to add.");
          requestMediaAtPoint(placementCenter);
          return "deferred";
        }
        if (intent.kind === "link_preview") {
          void insertLinkAtPoint(placementCenter);
          return "deferred";
        }
        if (intent.kind === "section" && selectedElementIdsRef.current.length > 0) {
          const members = selectedElementIdsRef.current.flatMap((id) =>
            boardRef.current.elements[id] ? [boardRef.current.elements[id]!] : [],
          );
          if (members.some((member) => sceneElementLockedForMutation(boardRef.current, member))) {
            setCommandFeedback("Unlock the selected elements before placing them in a section.");
            return "rejected";
          }
          if (members.length > 0) {
            const sectionBounds = sceneElementUnionBounds(members, 48);
            const section = commitSceneElement(createBoardSceneElement({
              id: crypto.randomUUID(),
              boardId: boardSessionIdRef.current,
              kind: "section",
              transform: { ...sectionBounds, rotation: 0 },
              memberIds: members.map(({ id }) => id),
              title: createRichTextDocument(intent.label ?? "Section"),
              ...(accountUserId ? { creatorId: accountUserId } : {}),
            }));
            patchSceneElements(members.map((member) => ({
              elementId: member.id,
              patches: [{ op: "field.set" as const, path: ["sectionId"], value: section.id }],
            })), { recordHistory: false });
            return "applied";
          }
        }
        let tool: CreationToolId | null = null;
        if (intent.kind === "shape" && intent.shapeKind) {
          const definition = ALL_SHAPES.find(({ kind }) => kind === intent.shapeKind);
          tool = definition ? `shape:${definition.id}` : null;
        } else {
          tool = ({
            sticky: "sticky",
            text: "text",
            section: "section",
            table: "table",
            stamp: "stamp",
            code_block: "insert:code-block",
            mind_map_node: "insert:mind-map",
          } as Partial<Record<BoardSceneElement["kind"], CreationToolId>>)[intent.kind] ?? null;
          if (intent.kind === "stamp" && intent.stampKind === "face") {
            tool = "insert:face-stamp";
          }
        }
        if (!tool) return "unrecognized";
        const created = createSceneElementAtPoint(tool, placementCenter, {
          ...(intent.label ? { label: intent.label } : {}),
          ...(intent.table ? { table: intent.table } : {}),
          ...(intent.language ? { language: intent.language } : {}),
        });
        return created ? "applied" : "unrecognized";
      }

      if (intent.type === "connect") {
        const fromIds = resolveSceneIntentTargetIds(
          boardRef.current,
          intent.from,
          selectedElementIdsRef.current,
        );
        const toIds = resolveSceneIntentTargetIds(
          boardRef.current,
          intent.to,
          selectedElementIdsRef.current,
        );
        if (
          (intent.from.kind === "visible_label" && fromIds.length !== 1) ||
          (intent.to.kind === "visible_label" && toIds.length !== 1)
        ) {
          setCommandFeedback("Use unique visible names, or select the two elements to connect.");
          return "rejected";
        }
        const fromId = fromIds[0];
        const sameSelection =
          intent.from.kind === "selection" && intent.to.kind === "selection";
        const toId = sameSelection
          ? toIds.find((id) => id !== fromId)
          : toIds.find((id) => id !== fromId) ?? toIds.at(-1);
        const from = fromId ? boardRef.current.elements[fromId] : null;
        const to = toId ? boardRef.current.elements[toId] : null;
        if (!from || !to || from.id === to.id) {
          setCommandFeedback("Select two different elements to connect.");
          return "rejected";
        }
        const fromCenter = elementCenter(from);
        const toCenter = elementCenter(to);
        const start = connectorAnchorPoint(from, "auto", toCenter);
        const end = connectorAnchorPoint(to, "auto", fromCenter);
        commitSceneElementsAsBatch([createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "connector",
          pathKind: intent.pathKind,
          transform: boundsBetween(start, end),
          start: { point: start, binding: { elementId: from.id, anchor: "auto" }, decoration: "none" },
          end: { point: end, binding: { elementId: to.id, anchor: "auto" }, decoration: "solid_arrow" },
          label: createRichTextDocument(intent.label ?? ""),
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        })]);
        return "applied";
      }

      if (intent.type === "select_all") {
        const ids = Object.values(boardRef.current.elements)
          .filter((element) =>
            element.status === "active" && element.visible && !element.legacyStrokeId,
          )
          .sort((left, right) => left.zIndex - right.zIndex)
          .map(({ id }) => id);
        selectSceneElements(ids);
        return "applied";
      }

      const ids = targetIds(intent.target);
      if (ids.length === 0) {
        setCommandFeedback("I couldn't find a visible element matching that request.");
        return "rejected";
      }
      if (intent.target.kind === "visible_label" && ids.length > 1) {
        setCommandFeedback("More than one visible element matches that name; select one first.");
        return "rejected";
      }
      if (intent.type === "delete") {
        const deleted = deleteSceneElementsAsBatch(ids);
        if (deleted.length === 0) {
          setCommandFeedback("Unlock the requested element before deleting it.");
          return "rejected";
        }
        return "applied";
      }
      if (intent.type === "rename") {
        const changes = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element && !sceneElementLockedForMutation(boardRef.current, element)
            ? [{ elementId: id, patches: sceneElementRenamePatches(element, intent.label) }]
            : [];
        });
        if (changes.length === 0) {
          setCommandFeedback("Unlock the requested element before renaming it.");
          return "rejected";
        }
        patchSceneElements(changes);
        return "applied";
      }
      if (intent.type === "move") {
        const elements = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element && !sceneElementLockedForMutation(boardRef.current, element) ? [element] : [];
        });
        if (elements.length === 0) {
          setCommandFeedback("Unlock the requested element before moving it.");
          return "rejected";
        }
        patchSceneElements(buildUniformSceneMoveChanges(
          boardRef.current,
          elements,
          intent.dx,
          intent.dy,
        ));
        return "applied";
      }
      if (intent.type === "resize") {
        const changes: { elementId: string; patches: BoardElementPatchOperation[] }[] = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          if (!element || sceneElementLockedForMutation(boardRef.current, element)) return [];
          const width = Math.max(1, element.transform.width * intent.scaleX);
          const height = Math.max(1, element.transform.height * intent.scaleY);
          return [{
            elementId: id,
            patches: [
              { op: "field.set" as const, path: ["transform", "x"], value: element.transform.x - (width - element.transform.width) / 2 },
              { op: "field.set" as const, path: ["transform", "y"], value: element.transform.y - (height - element.transform.height) / 2 },
              { op: "field.set" as const, path: ["transform", "width"], value: width },
              { op: "field.set" as const, path: ["transform", "height"], value: height },
            ],
          }];
        });
        if (changes.length === 0) {
          setCommandFeedback("Unlock the requested element before resizing it.");
          return "rejected";
        }
        patchSceneElements(changes);
        return "applied";
      }
      if (intent.type === "style") {
        const changes = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element && !sceneElementLockedForMutation(boardRef.current, element)
            ? [{ elementId: id, patches: sceneElementColorPatches(element, intent.color) }]
            : [];
        });
        if (changes.length === 0) {
          setCommandFeedback("Unlock the requested element before styling it.");
          return "rejected";
        }
        patchSceneElements(changes);
        return "applied";
      }
      if (intent.type === "group") {
        const members = ids.flatMap((id) => boardRef.current.elements[id] ? [boardRef.current.elements[id]!] : []);
        if (
          members.length === 0 ||
          members.some((member) => sceneElementLockedForMutation(boardRef.current, member))
        ) {
          setCommandFeedback("Unlock the selected elements before grouping them.");
          return "rejected";
        }
        const bounds = sceneElementUnionBounds(members, 48);
        const section = commitSceneElement(createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "section",
          transform: { ...bounds, rotation: 0 },
          memberIds: ids,
          title: createRichTextDocument(intent.label ?? "Section"),
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        }));
        patchSceneElements(ids.map((memberId) => ({
          elementId: memberId,
          patches: [{ op: "field.set" as const, path: ["sectionId"], value: section.id }],
        })), { recordHistory: false });
        return "applied";
      }
      if (intent.type === "layout") {
        const elements = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element && !sceneElementLockedForMutation(boardRef.current, element)
            ? [element]
            : [];
        });
        if (elements.length === 0) {
          setCommandFeedback("Unlock the selected elements before laying them out.");
          return "rejected";
        }
        const placements = layoutSceneElements(elements, intent.direction);
        patchSceneElements([...placements].flatMap(([id, point]) => {
          const element = boardRef.current.elements[id];
          return element ? [{
            elementId: id,
            patches: sceneElementMovePatches(
              element,
              point.x - element.transform.x,
              point.y - element.transform.y,
            ),
          }] : [];
        }));
        return "applied";
      }
      return "unrecognized";
    },
    [
      accountUserId,
      commitSceneElement,
      commitSceneElementsAsBatch,
      createSceneElementAtPoint,
      deleteSceneElementsAsBatch,
      insertLinkAtPoint,
      patchSceneElements,
      requestMediaAtPoint,
      selectSceneElements,
    ],
  );

  const prepareSceneFanIn = useCallback(
    (instruction: string, voiceTurnId?: string): IntentPreparationOutcome | null => {
      const resolution = resolveExistingBoardFanIn(
        instruction,
        buildSceneFanInContext(boardRef.current, selectedElementIdsRef.current),
      );
      if (resolution.status === "unrecognized") return null;
      if (resolution.status === "already_satisfied") {
        pendingSemanticClarificationRef.current = null;
        setIntentCommandText("");
        setSpeechRecognitionStatus("command-recognized");
        setCommandFeedback("The requested connections are already present.");
        appendCopilotActivity({
          source: voiceTurnId ? "Voice" : "Airo",
          title: "Board already up to date",
          detail: "The requested connections are already present.",
          tone: "success",
        });
        return {
          result: "no-op",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }
      const drafts = resolution.plan.actions.flatMap((action) => {
        if (action.type !== "connect") return [];
        const fromId = action.from.kind === "visible_label"
          ? resolveSceneIntentTargetIds(
              boardRef.current,
              { kind: "visible_label", label: action.from.label },
              selectedElementIdsRef.current,
            )[0]
          : undefined;
        const toId = action.to.kind === "visible_label"
          ? resolveSceneIntentTargetIds(
              boardRef.current,
              { kind: "visible_label", label: action.to.label },
              selectedElementIdsRef.current,
            )[0]
          : undefined;
        const from = fromId ? boardRef.current.elements[fromId] : null;
        const to = toId ? boardRef.current.elements[toId] : null;
        if (!from || !to || from.id === to.id) return [];
        const fromCenter = elementCenter(from);
        const toCenter = elementCenter(to);
        const start = connectorAnchorPoint(from, "auto", toCenter);
        const end = connectorAnchorPoint(to, "auto", fromCenter);
        return [createBoardSceneElement({
          id: crypto.randomUUID(),
          boardId: boardSessionIdRef.current,
          kind: "connector",
          pathKind: "bent",
          transform: boundsBetween(start, end),
          start: { point: start, binding: { elementId: from.id, anchor: "auto" }, decoration: "none" },
          end: { point: end, binding: { elementId: to.id, anchor: "auto" }, decoration: "solid_arrow" },
          label: createRichTextDocument(action.label ?? ""),
          ...(accountUserId ? { creatorId: accountUserId } : {}),
        })];
      });
      if (drafts.length !== resolution.plan.actions.length || drafts.length === 0) return null;
      pendingSemanticClarificationRef.current = null;
      setIntentCommandText("");
      setSpeechRecognitionStatus("command-recognized");
      commitSceneElementsAsBatch(drafts, { select: false });
      setCommandFeedback(`Applied: Connect ${drafts.length} relationship${drafts.length === 1 ? "" : "s"}.`);
      appendCopilotActivity({
        source: voiceTurnId ? "Voice" : "Airo",
        title: "Board updated",
        detail: `Connected ${drafts.length} relationship${drafts.length === 1 ? "" : "s"}.`,
        tone: "success",
      });
      return {
        result: "applied",
        preparedText: instruction,
        source: "deterministic",
        stepCount: drafts.length,
      };
    },
    [accountUserId, appendCopilotActivity, commitSceneElementsAsBatch],
  );

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
      setViewportRevision((revision) => revision + 1);
      render();
    },
    [currentViewportLimits, render],
  );

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || focusedSectionHashRef.current === hash) return;
    const sectionId = new URLSearchParams(hash.slice(1)).get("section");
    if (!sectionId) return;
    const section = boardRef.current.elements[sectionId];
    if (section?.kind !== "section" || section.status !== "active") return;
    focusedSectionHashRef.current = hash;
    selectSceneElements([section.id], section.id);
    const limits = currentViewportLimits();
    const scale = Math.min(
      1.5,
      Math.max(0.2, Math.min(
        (limits.canvasWidth - 80) / Math.max(1, section.transform.width),
        (limits.canvasHeight - 80) / Math.max(1, section.transform.height),
      )),
    );
    applyViewport({
      x: limits.canvasWidth / 2 - (section.transform.x + section.transform.width / 2) * scale,
      y: limits.canvasHeight / 2 - (section.transform.y + section.transform.height / 2) * scale,
      scale,
    });
  }, [applyViewport, currentViewportLimits, sceneRenderVersion, selectSceneElements]);

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
          setSelectedElementId(null);
          setSelectedElementIds([]);
          setEditingElementId(null);
          setSceneRenderVersion((version) => version + 1);
          refreshRealtimeSpeechKeyterms(result.initialState, []);
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
        creationTool?: CreationToolId;
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

      const creationTool = options.creationTool ?? (
        !options.placementTool && isScenePlacementTool(activeCreationToolRef.current)
          ? activeCreationToolRef.current
          : null
      );
      const placementTool = options.placementTool ?? (
        creationTool ? scenePlacementPreviewTool(creationTool) : activeObjectTool
      );
      if (isPlacementTool(placementTool)) {
        objectInteractionRef.current = options.catalogCarry
          ? {
              mode: "catalog_carrying",
              tool: placementTool,
              ...(creationTool ? { creationTool } : {}),
              point,
              pickupScreenPoint: options.catalogCarry.pickupScreenPoint,
              catalogBounds: options.catalogCarry.catalogBounds,
              enteredCanvas: false,
            }
          : {
              mode: "placing",
              tool: placementTool,
              ...(creationTool ? { creationTool } : {}),
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
        if (interaction.creationTool) {
          createSceneElementAtPoint(interaction.creationTool, point);
          setGhostAnnotation(null);
          setGhostAnnotations([]);
        } else {
          commitPlacementObject(interaction.tool, interaction.start, point);
        }
      } else if (interaction?.mode === "catalog_carrying") {
        if (interaction.creationTool) {
          createSceneElementAtPoint(interaction.creationTool, point);
          setGhostAnnotation(null);
          setGhostAnnotations([]);
        } else {
          commitPlacementObject(interaction.tool, point);
        }
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
    [
      commitActiveEraseInteraction,
      commitPlacementObject,
      createSceneElementAtPoint,
      selectedAnnotationIds,
    ],
  );

  const cancelObjectInteraction = useCallback(() => {
    const cancelledCreationTool =
      (objectInteractionRef.current?.mode === "placing" ||
        objectInteractionRef.current?.mode === "catalog_carrying")
        ? objectInteractionRef.current.creationTool
        : null;
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
    if (cancelledCreationTool) {
      setActiveCreationTool("move");
      activeCreationToolRef.current = "move";
    }
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
      const hitPadding = 26;
      const activationPadding = 14;
      const candidates: {
        id: string;
        element: HTMLButtonElement;
        creationTool?: CreationToolId;
        bounds: { left: number; top: number; width: number; height: number };
        disabled: boolean;
      }[] = [];
      const creationSurface = dock.closest(".creation-surface") ?? dock;
      for (const element of creationSurface.querySelectorAll<HTMLButtonElement>("[data-dock-id]")) {
        const rect = element.getBoundingClientRect();
        const creationTool = element.dataset.creationTool as CreationToolId | undefined;
        candidates.push({
          id: element.dataset.dockId ?? "",
          element,
          ...(creationTool ? { creationTool } : {}),
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
        const catalogRegion =
          activated.element.closest<HTMLElement>(
            ".creation-popover, .creation-shape-sidebar",
          ) ?? dock;
        const catalogRect = catalogRegion.getBoundingClientRect();
        return {
          type: "activated",
          targetId: activatedId,
          ...(activated.creationTool ? { creationTool: activated.creationTool } : {}),
          catalogBounds: {
            left: catalogRect.left - canvasRect.left,
            top: catalogRect.top - canvasRect.top,
            right: catalogRect.right - canvasRect.left,
            bottom: catalogRect.bottom - canvasRect.top,
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
        pendingSemanticClarificationRef.current = null;
        pendingIntentRef.current = null;
        applyPendingIntentRef.current = null;
        setPendingIntent(null);
        voiceRouter.reset();
        setVoiceGate(null);
        palmVoiceGestureTrackerRef.current!.reset();
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
      reportGestureStage(
        "candidate_scores",
        {
          candidate: "visibility_toggle",
          handCount: frame.hands.length,
          suppressed: frame.suppressed,
          state: result ?? "idle",
        },
        frame.timestampMs,
      );
      if (frame.suppressed) {
        reportGestureStage(
          "suppression",
          { candidate: "visibility_toggle", reason: "higher_priority_owner" },
          frame.timestampMs,
        );
      }
      if (result === "snap") {
        setDiagramVisibility(!diagramVisibleRef.current, "snap");
        setLastGestureIntent({ intent: "visibility", confidence: 1 });
        reportGestureStage(
          "action",
          { gesture: "visibility_toggle", applied: true },
          frame.timestampMs,
        );
      }
      return result;
    },
    [reportGestureStage, setDiagramVisibility, voiceRouter],
  );

  const handleGesture = useCallback(
    (result: GestureResult | null, hybridOutput?: HybridGestureControllerOutput) => {
      setGestureResult(result);

      if (inputPaused) {
        reportGestureStage("suppression", { reason: "input_paused" });
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
          reportGestureStage(
            "candidate_scores",
            {
              candidate: "manipulation",
              state: hybridOutput.state,
              trackingState: hybridOutput.trackingState,
              pinchState: hybridOutput.pinchState,
              hasTarget: Boolean(
                hybridOutput.focusedTargetId ?? hybridOutput.grabbedTargetId,
              ),
            },
            hybridOutput.timestampMs,
          );
          if (action) {
            const targetId =
              "targetId" in action && typeof action.targetId === "string"
                ? action.targetId
                : null;
            reportGestureStage(
              "transition",
              { gesture: "manipulation", transition: action.type },
              hybridOutput.timestampMs,
            );
            if (targetId) {
              reportGestureStage(
                "target",
                { gesture: "manipulation", targetId },
                hybridOutput.timestampMs,
              );
            }
          }
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
            const activatedCreationTool =
              dockOutcome.type === "activated" ? dockOutcome.creationTool : undefined;
            const sceneCreationTool =
              activatedCreationTool && isScenePlacementTool(activatedCreationTool)
                ? activatedCreationTool
                : null;
            const placementTool = sceneCreationTool
              ? scenePlacementPreviewTool(sceneCreationTool)
              : dockOutcome.type === "activated" && !activatedCreationTool
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
                ...(sceneCreationTool ? { creationTool: sceneCreationTool } : {}),
                catalogCarry: {
                  pickupScreenPoint: screenPoint,
                  catalogBounds: dockOutcome.catalogBounds,
                },
              });
              setCommandFeedback(
                `Holding ${sceneCreationTool ? creationToolLabel(sceneCreationTool) : objectToolLabel(placementTool)}. Drag it onto the diagram, then open your hand to place.`,
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
            reportGestureStage(
              "cancellation",
              { reason: "grab_cancelled" },
              hybridOutput.timestampMs,
            );
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
              const placementInteraction =
                objectInteractionRef.current?.mode === "placing" ||
                objectInteractionRef.current?.mode === "catalog_carrying"
                  ? objectInteractionRef.current
                  : null;
              const placementTool = placementInteraction?.tool ?? activeObjectTool;
              const placementLabel = placementInteraction?.creationTool
                ? creationToolLabel(placementInteraction.creationTool)
                : objectToolLabel(placementTool);
              if (
                catalogCarry &&
                (!catalogCarry.enteredCanvas || !catalogDropPointValid)
              ) {
                cancelObjectInteraction();
                setCommandFeedback(
                  `${placementLabel} returned to the catalog. Drag it onto the diagram before releasing.`,
                );
              } else {
                endObjectInteraction(point);
                setCommandFeedback(
                  `${placementLabel} placed. Close your hand over it to move it again.`,
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
          const armedCreationTool = isScenePlacementTool(activeCreationToolRef.current)
            ? activeCreationToolRef.current
            : null;
          const placementTool =
            armedCreationTool
              ? scenePlacementPreviewTool(armedCreationTool)
              : armedPlacementTool ?? (isPlacementTool(activeObjectTool) ? activeObjectTool : null);
          if (placementTool && pinchClosed && (pinchJustClosed || Boolean(armedPlacementTool))) {
            cameraPlacementArmedToolRef.current = null;
            cameraPlacementActiveRef.current = true;
            cameraGrabActiveRef.current = true;
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              placementTool,
              ...(armedCreationTool ? { creationTool: armedCreationTool } : {}),
            });
            setCommandFeedback(
              `Holding ${armedCreationTool ? creationToolLabel(armedCreationTool) : objectToolLabel(placementTool)}. Move your closed hand, then open it to place.`,
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
              reportGestureStage(
                "action",
                { gesture: "erase_grab_started", applied: true },
                hybridOutput.timestampMs,
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
            reportGestureStage(
              "action",
              { gesture: "grab_started", applied: true },
              hybridOutput.timestampMs,
            );
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
            reportGestureStage(
              "action",
              { gesture: erased ? "erase_commit" : "move_commit", applied: true },
              hybridOutput.timestampMs,
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

        reportGestureStage("candidate_scores", {
          candidate: "legacy_pipeline",
          confidence: result.confidence,
          mode: result.mode,
          gesture: result.gesture,
        });

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
          reportGestureStage("action", {
            gesture: "object_interaction_commit",
            applied: true,
          });
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
      reportGestureStage,
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

  const undoLastAction = useCallback(
    (source: UndoSource = "button", followUpInteractionId?: string) => {
      const action = undoStackRef.current.pop();
      if (!action) {
        setCommandFeedback("There is nothing to undo yet.");
        return;
      }

      if (action.type === "scene_created") {
        sceneRedoStackRef.current.push({ type: "scene_deleted", elementId: action.elementId });
        applySceneElementLifecycle(action.elementId, "element.deleted");
        selectSceneElements(selectedElementIdsRef.current.filter((id) => id !== action.elementId));
        setCommandFeedback("Undid the last scene element.");
        return;
      }

      if (action.type === "scene_deleted") {
        sceneRedoStackRef.current.push({ type: "scene_created", elementId: action.elementId });
        applySceneElementLifecycle(action.elementId, "element.restored");
        selectSceneElements([action.elementId], action.elementId);
        setCommandFeedback("Restored the deleted scene element.");
        return;
      }

      if (action.type === "scene_created_batch" || action.type === "scene_deleted_batch") {
        const deleting = action.type === "scene_created_batch";
        sceneRedoStackRef.current.push({
          type: deleting ? "scene_deleted_batch" : "scene_created_batch",
          elementIds: action.elementIds,
          ...(action.selectionBefore ? { selectionBefore: action.selectionBefore } : {}),
          ...(action.selectionAfter ? { selectionAfter: action.selectionAfter } : {}),
        });
        const lifecycleIds = deleting
          ? action.elementIds
          : [...action.elementIds].reverse();
        for (const elementId of lifecycleIds) {
          applySceneElementLifecycle(
            elementId,
            deleting ? "element.deleted" : "element.restored",
          );
        }
        selectSceneElements(
          action.selectionBefore ?? (deleting ? [] : action.elementIds),
        );
        setCommandFeedback(deleting ? "Undid the grouped creation." : "Restored the section contents.");
        return;
      }

      if (action.type === "scene_patched") {
        const element = boardRef.current.elements[action.elementId];
        if (element && action.inversePatches.length > 0) {
          const redoPatches = invertBoardElementPatches(element, action.inversePatches);
          if (redoPatches.length > 0) {
            sceneRedoStackRef.current.push({
              type: "scene_patched",
              elementId: action.elementId,
              inversePatches: redoPatches,
            });
          }
          applyLocalEvent({
            ...createEventEnvelope({
              boardSessionId: boardSessionIdRef.current,
              actorParticipantId: PARTICIPANT_ID,
            }),
            type: "element.patched",
            elementId: action.elementId,
            patches: action.inversePatches,
            baseRevision: element.revision,
          });
          selectSceneElements([action.elementId], action.elementId);
        }
        setCommandFeedback("Undid the last element edit.");
        return;
      }

      if (action.type === "scene_batch") {
        const redoEntries = action.entries.flatMap(({ elementId, inversePatches }) => {
          const element = boardRef.current.elements[elementId];
          if (!element) return [];
          const redoPatches = invertBoardElementPatches(element, inversePatches);
          return redoPatches.length > 0 ? [{ elementId, inversePatches: redoPatches }] : [];
        });
        if (redoEntries.length > 0) {
          sceneRedoStackRef.current.push({ type: "scene_batch", entries: redoEntries });
        }
        for (const { elementId, inversePatches } of [...action.entries].reverse()) {
          const element = boardRef.current.elements[elementId];
          if (!element || inversePatches.length === 0) continue;
          applyLocalEvent({
            ...createEventEnvelope({
              boardSessionId: boardSessionIdRef.current,
              actorParticipantId: PARTICIPANT_ID,
            }),
            type: "element.patched",
            elementId,
            patches: inversePatches,
            baseRevision: element.revision,
          });
        }
        selectSceneElements(action.entries.map(({ elementId }) => elementId));
        setCommandFeedback("Undid the grouped element edit.");
        return;
      }

      if (action.type === "diagram") {
        const result = applyDiagramUndo(boardRef.current, {
          undoEvents: action.undoEvents,
        });
        boardRef.current = result.state;
        appendBoundedBoardEvents(boardEventLogRef.current, result.events);
        if (result.events.length > 0) {
          boardSyncRef.current?.publish(result.events);
          if (action.originatingInteractionId) {
            const attribution = interactionAttributionRef.current!.attribute({
              kind: "undo",
              originatingInteractionId: action.originatingInteractionId,
              ...(followUpInteractionId ? { followUpInteractionId } : {}),
              occurredAtMs: Date.now(),
            });
            if (attribution) {
              reportVoiceTrace(attribution.originatingInteractionId, "action_undone", {
                attributionKind: attribution.kind,
                source,
                delayMs: attribution.delayMs,
                ...(attribution.followUpInteractionId
                  ? { followUpInteractionId: attribution.followUpInteractionId }
                  : {}),
              });
            }
          }
        }
        const restoredSelection = action.selectionBefore.filter(
          (strokeId) => boardRef.current.strokes[strokeId]?.status === "committed",
        );
        refreshRealtimeSpeechKeyterms(boardRef.current, restoredSelection);
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

      if (action.type === "erase") {
        applyLocalEvent({
          ...createEventEnvelope({
            boardSessionId: boardSessionIdRef.current,
            actorParticipantId: PARTICIPANT_ID,
          }),
          type: "stroke.restored",
          strokeIds: action.strokeIds,
        });
        setCommandFeedback("Restored the erased objects.");
      }
    },
    [
      applyLocalEvent,
      applySceneElementLifecycle,
      refreshRealtimeSpeechKeyterms,
      render,
      reportVoiceTrace,
      selectSceneElements,
      updateStats,
    ],
  );

  const redoLastSceneAction = useCallback(() => {
    const action = sceneRedoStackRef.current.pop();
    if (!action || !action.type.startsWith("scene_")) {
      setCommandFeedback("There is nothing to redo yet.");
      return;
    }
    if (action.type === "scene_created") {
      undoStackRef.current.push({ type: "scene_deleted", elementId: action.elementId });
      applySceneElementLifecycle(action.elementId, "element.deleted");
      selectSceneElements(selectedElementIdsRef.current.filter((id) => id !== action.elementId));
    } else if (action.type === "scene_deleted") {
      undoStackRef.current.push({ type: "scene_created", elementId: action.elementId });
      applySceneElementLifecycle(action.elementId, "element.restored");
      selectSceneElements([action.elementId], action.elementId);
    } else if (action.type === "scene_created_batch" || action.type === "scene_deleted_batch") {
      const deleting = action.type === "scene_created_batch";
      undoStackRef.current.push({
        type: deleting ? "scene_deleted_batch" : "scene_created_batch",
        elementIds: action.elementIds,
        ...(action.selectionBefore ? { selectionBefore: action.selectionBefore } : {}),
        ...(action.selectionAfter ? { selectionAfter: action.selectionAfter } : {}),
      });
      const lifecycleIds = deleting
        ? action.elementIds
        : [...action.elementIds].reverse();
      for (const elementId of lifecycleIds) {
        applySceneElementLifecycle(
          elementId,
          deleting ? "element.deleted" : "element.restored",
        );
      }
      selectSceneElements(
        action.selectionAfter ?? (deleting ? [] : action.elementIds),
      );
    } else if (action.type === "scene_patched") {
      const element = boardRef.current.elements[action.elementId];
      if (element) {
        const inversePatches = invertBoardElementPatches(element, action.inversePatches);
        undoStackRef.current.push({
          type: "scene_patched",
          elementId: action.elementId,
          inversePatches,
        });
        applyLocalEvent({
          ...createEventEnvelope({
            boardSessionId: boardSessionIdRef.current,
            actorParticipantId: PARTICIPANT_ID,
          }),
          type: "element.patched",
          elementId: action.elementId,
          patches: action.inversePatches,
          baseRevision: element.revision,
        });
        selectSceneElements([action.elementId], action.elementId);
      }
    } else if (action.type === "scene_batch") {
      const inverseEntries = action.entries.flatMap(({ elementId, inversePatches }) => {
        const element = boardRef.current.elements[elementId];
        if (!element) return [];
        const nextInverse = invertBoardElementPatches(element, inversePatches);
        return nextInverse.length > 0 ? [{ elementId, inversePatches: nextInverse }] : [];
      });
      if (inverseEntries.length > 0) {
        undoStackRef.current.push({ type: "scene_batch", entries: inverseEntries });
      }
      for (const { elementId, inversePatches } of action.entries) {
        const element = boardRef.current.elements[elementId];
        if (!element || inversePatches.length === 0) continue;
        applyLocalEvent({
          ...createEventEnvelope({
            boardSessionId: boardSessionIdRef.current,
            actorParticipantId: PARTICIPANT_ID,
          }),
          type: "element.patched",
          elementId,
          patches: inversePatches,
          baseRevision: element.revision,
        });
      }
      selectSceneElements(action.entries.map(({ elementId }) => elementId));
    }
    setCommandFeedback("Redid the last scene change.");
  }, [applyLocalEvent, applySceneElementLifecycle, selectSceneElements]);

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
      let alreadySatisfied = false;

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
              reportVoiceTrace(voiceTurnId, "grounding", {
                status: "rejected",
                source,
                stepKind: step.command.kind,
              });
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
          alreadySatisfied = alreadySatisfied || resolved.alreadySatisfied === true;
          if (resolved.selectionAfter) {
            workingSelectionIds = resolved.selectionAfter.filter(
              (strokeId) => previewState.strokes[strokeId]?.status === "committed",
            );
            workingPrimarySelectionId =
              workingSelectionIds[workingSelectionIds.length - 1] ?? null;
          }
        }

        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "grounding", {
            status: "resolved",
            source,
            stepCount: parsedSteps.length,
            diagramCommandCount: commands.length,
            selectionCount: workingSelectionIds.length,
          });
        }
        if (commands.length === 0 && alreadySatisfied) {
          setSelectedAnnotationIds(workingSelectionIds);
          setSelectedAnnotationId(workingPrimarySelectionId);
          setCommandFeedback("That line is already attached to those objects.");
          setIntentCommandText("");
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "feedback", {
              category: "no-op",
              actionable: false,
            });
            reportVoiceTrace(voiceTurnId, "turn_completed", {
              outcome: "no-op",
            });
          }
          return "no-op";
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
          baseSelectionIds: [...selectedAnnotationIdsRef.current],
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
          undoLastAction("semantic", voiceTurnId);
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
      // current_selection is a reference to the user's request-time snapshot.
      // Actions may change the final UI selection, but those incidental
      // selectionAfter values must not retarget later actions in the same plan.
      const referenceSelectionIds = [...initialSelectionIds];
      let workingSelectionIds = initialSelectionIds.filter(
        (strokeId) => previewState.strokes[strokeId]?.status === "committed",
      );
      const initialPrimarySelectionId =
        executionSnapshot?.primarySelectionId ?? selectedAnnotationId;
      const referencePrimarySelectionId =
        initialPrimarySelectionId &&
        referenceSelectionIds.includes(initialPrimarySelectionId)
          ? initialPrimarySelectionId
          : (referenceSelectionIds[referenceSelectionIds.length - 1] ?? null);
      let workingPrimarySelectionId =
        initialPrimarySelectionId && workingSelectionIds.includes(initialPrimarySelectionId)
          ? initialPrimarySelectionId
          : (workingSelectionIds[workingSelectionIds.length - 1] ?? null);
      const workingHoverStrokeId = executionSnapshot?.hoverStrokeId ?? hoverStrokeId;
      const autoCreateCenters = computeSemanticAutoLayout({
        actions: plan.actions,
        boardState: baseState,
        canvasWidth,
        canvasHeight,
        viewOrigin,
      });
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
              autoCreateCenters,
              selectionIds: referenceSelectionIds,
              primarySelectionId: referencePrimarySelectionId,
              hoverStrokeId: workingHoverStrokeId,
              strokeColor,
            },
            planHandles,
          );
          if ("error" in resolved) {
            if (voiceTurnId) {
              reportVoiceTrace(voiceTurnId, "grounding", {
                status: "rejected",
                source: "semantic",
                actionType: action.type,
                issueCode: resolved.errorCode ?? "grounding_failed",
                ...(resolved.candidateCount !== undefined
                  ? { candidateCount: resolved.candidateCount }
                  : {}),
              });
              reportVoiceTrace(voiceTurnId, "action_failed", {
                phase: "semantic_grounding",
                actionType: action.type,
                issueCode: resolved.errorCode ?? "grounding_failed",
              });
            }
            cancelPendingIntent(`Plan could not be grounded: ${resolved.error}`);
            return "rejected";
          }
          if (voiceTurnId && resolved.repairKinds?.length) {
            reportVoiceTrace(voiceTurnId, "grounding", {
              status: "repaired",
              source: "semantic",
              actionType: action.type,
              repairKinds: resolved.repairKinds,
            });
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

        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "grounding", {
            status: "resolved",
            source: "semantic",
            actionCount: plan.actions.length,
            diagramCommandCount: commands.length,
            selectionCount: workingSelectionIds.length,
          });
        }
        if (commands.length === 0) {
          setSelectedAnnotationIds(workingSelectionIds);
          setSelectedAnnotationId(workingPrimarySelectionId);
          const selectionOnly = plan.actions.every(
            (action) => action.type === "select",
          );
          setCommandFeedback(
            selectionOnly
              ? "Applied the requested selection."
              : "The requested board state is already satisfied.",
          );
          setIntentCommandText("");
          if (voiceTurnId) {
            if (selectionOnly) {
              reportVoiceTrace(voiceTurnId, "action_applied", {
                actionCount: plan.actions.length,
                affectedObjectCount: workingSelectionIds.length,
              });
            } else {
              reportVoiceTrace(voiceTurnId, "feedback", {
                category: "no-op",
                actionable: false,
              });
            }
            reportVoiceTrace(voiceTurnId, "turn_completed", {
              outcome: selectionOnly ? "applied" : "no-op",
            });
          }
          return selectionOnly ? "applied" : "no-op";
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
          baseSelectionIds: [...initialSelectionIds],
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
        undoLastAction("voice", voiceTurnId);
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
        pendingSemanticClarificationRef.current = null;
        const visibilityResult = prepareIntentCommand(instruction, voiceTurnId);
        return {
          result: visibilityResult,
          preparedText: instruction,
          source: "deterministic",
          stepCount: visibilityIntent ? 1 : 0,
        };
      }
      const sceneFanIn = prepareSceneFanIn(instruction, voiceTurnId);
      if (sceneFanIn) return sceneFanIn;
      const sceneIntent = parseBoardSceneIntent(instruction);
      const sceneExecution = sceneIntent
        ? executeSceneIntent(sceneIntent)
        : "unrecognized";
      if (sceneIntent && sceneExecution !== "unrecognized") {
        pendingSemanticClarificationRef.current = null;
        setIntentCommandText("");
        setSpeechRecognitionStatus(
          sceneExecution === "rejected" ? "command-rejected" : "command-recognized",
        );
        if (sceneExecution === "applied" && sceneIntent.type !== "invalid") {
          setCommandFeedback(`Applied: ${sceneIntentFeedback(sceneIntent)}.`);
          appendCopilotActivity({
            source: voiceTurnId ? "Voice" : "Airo",
            title: "Board updated",
            detail: instruction,
            tone: "success",
          });
        }
        return {
          result:
            sceneExecution === "applied"
              ? "applied"
              : sceneExecution === "rejected"
                ? "rejected"
                : "no-op",
          preparedText: instruction,
          source: "deterministic",
          stepCount: sceneExecution === "applied" ? 1 : 0,
        };
      }
      const desiredGraphCorrection = parseDesiredGraphCorrection(instruction);
      if (desiredGraphCorrection) {
        pendingSemanticClarificationRef.current = null;
        setIntentCommandText(instruction);
        if (voiceTurnId) {
          reportAttributedVoiceFollowUp("correction", voiceTurnId);
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
      const deterministicFanIn = resolveExistingBoardFanIn(
        instruction,
        buildSemanticIntentContext(
          boardRef.current,
          selectedAnnotationIdsRef.current,
          false,
        ),
      );
      if (deterministicFanIn.status === "already_satisfied") {
        pendingSemanticClarificationRef.current = null;
        setIntentCommandText(instruction);
        setSpeechRecognitionStatus("command-recognized");
        setCommandFeedback("The requested connections are already present.");
        appendCopilotActivity({
          source: "Airo",
          title: "Diagram already up to date",
          detail: "The requested connections are already present.",
          tone: "success",
        });
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "parser_outcome", {
            status: "parsed",
            operationKind: "existing_board_fan_in",
            confidence: 1,
          });
          reportVoiceTrace(voiceTurnId, "grounding", {
            status: "already_satisfied",
            source: "deterministic",
            sourceCount: deterministicFanIn.sourceLabels.length,
          });
          reportVoiceTrace(voiceTurnId, "feedback", {
            category: "no-op",
            actionable: false,
          });
          reportVoiceTrace(voiceTurnId, "turn_completed", {
            outcome: "no-op",
          });
        }
        return {
          result: "no-op",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }
      if (deterministicFanIn.status === "resolved") {
        pendingSemanticClarificationRef.current = null;
        setIntentCommandText(instruction);
        if (voiceTurnId) {
          reportVoiceTrace(voiceTurnId, "parser_outcome", {
            status: "parsed",
            operationKind: "existing_board_fan_in",
            confidence: 1,
          });
        }
        const fanInResult = prepareSemanticActionPlan(
          deterministicFanIn.plan,
          instruction,
          voiceTurnId,
        );
        return {
          result: fanInResult,
          preparedText: instruction,
          source: "deterministic",
          stepCount: deterministicFanIn.plan.actions.length,
        };
      }
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
      const terminalConnectionGroundingFailure =
        deterministic.status === "parsed" &&
        !allowsSemanticFallbackAfterGroundingFailure(deterministic.command);
      if (terminalConnectionGroundingFailure) {
        // These requests identify an existing line. If deterministic
        // grounding cannot identify it uniquely, semantic fallback has no
        // loose-line reference and could create/delete the wrong connector.
        pendingSemanticClarificationRef.current = null;
        return {
          result: "rejected",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }
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
      const pendingClarificationRecord =
        pendingSemanticClarificationRef.current;
      const pendingClarificationIsCurrent =
        pendingClarificationRecord !== null &&
        !boardContentChanged(
          pendingClarificationRecord.boardState,
          requestBoardState,
        ) &&
        pendingClarificationRecord.selectionIds.length ===
          requestSelectionIds.length &&
        pendingClarificationRecord.selectionIds.every(
          (strokeId, index) => strokeId === requestSelectionIds[index],
        );
      const pendingClarification = pendingClarificationIsCurrent
        ? pendingClarificationRecord.request
        : undefined;
      if (
        pendingClarificationRecord !== null &&
        !pendingClarificationIsCurrent
      ) {
        pendingSemanticClarificationRef.current = null;
      }
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
          ...(pendingClarification ? { pendingClarification } : {}),
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
        if (resolution.outcome === "already_satisfied") {
          pendingSemanticClarificationRef.current = null;
          setIntentCommandText(instruction);
          setSpeechRecognitionStatus("command-recognized");
          setCommandFeedback("The requested connections are already present.");
          appendCopilotActivity({
            source: "Airo",
            title: "Diagram already up to date",
            detail: "The requested connections are already present.",
            tone: "success",
          });
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "semantic_result", {
              status: "already_satisfied",
              issueCode: "none",
              provider: resolution.provider,
              model: resolution.model,
              actionCount: 0,
              responseId: resolution.metadata.responseId,
              providerRequestId: resolution.metadata.providerRequestId,
              providerProcessingMs: resolution.metadata.providerProcessingMs,
              totalLatencyMs: resolution.metadata.totalLatencyMs,
              usage: resolution.metadata.usage,
            });
            reportVoiceTrace(voiceTurnId, "feedback", {
              category: "no-op",
              actionable: false,
            });
            reportVoiceTrace(voiceTurnId, "turn_completed", {
              outcome: "no-op",
            });
          }
          return {
            result: "no-op",
            preparedText: instruction,
            source: "semantic",
            stepCount: 0,
          };
        }
        const plan = resolution.plan;
        if (plan.status !== "resolved") {
          // Clarification is a focused request for missing/ambiguous structure,
          // never a general confirmation gate. Unsupported and clarification
          // outcomes are both mutation-free.
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
            if (plan.status === "clarification") {
              reportVoiceTrace(voiceTurnId, "clarification", {
                issueCode: plan.issueCode,
                missingSlots: plan.missingSlots,
              });
            }
            reportVoiceTrace(voiceTurnId, "feedback", {
              category: plan.status,
              issueCode: plan.issueCode,
              actionable: true,
            });
          }
          setSpeechRecognitionStatus("command-rejected");
          pendingSemanticClarificationRef.current =
            plan.status === "clarification" &&
            plan.clarificationQuestion
              ? {
                  request: {
                    previousTranscript: pendingClarification
                      ? `${pendingClarification.previousTranscript} Follow-up: ${instruction}`.slice(
                          0,
                          500,
                        )
                      : instruction,
                    question: plan.clarificationQuestion,
                    missingSlots: [...plan.missingSlots],
                  },
                  boardState: requestBoardState,
                  selectionIds: requestSelectionIds,
                }
              : null;
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
    [
      appendCopilotActivity,
      executeSceneIntent,
      hoverStrokeId,
      prepareIntentCommand,
      prepareSceneFanIn,
      prepareSemanticActionPlan,
      reportAttributedVoiceFollowUp,
    ],
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
    try {
      const commit = commitCommandTurn({
        snapshot: {
          boardState: pending.baseState,
          selectionIds: pending.baseSelectionIds,
        },
        currentState: boardRef.current,
        currentSelectionIds: selectedAnnotationIdsRef.current,
        commands: pending.commands,
        ...(pending.selectionAfter
          ? { requestedSelectionIds: pending.selectionAfter }
          : {}),
        contextForCommand: () =>
          diagramCommandContext(boardSessionIdRef.current),
      });
      if (commit.status === "stale") {
        if (pending.voiceTurnId) {
          reportVoiceTrace(pending.voiceTurnId, "action_failed", {
            phase: "apply",
            code: "STALE_PREVIEW",
            boardChanged: commit.boardChanged,
            selectionChanged: commit.selectionChanged,
          });
          reportVoiceTrace(pending.voiceTurnId, "feedback", {
            category: "stale_context",
            actionable: true,
          });
          reportVoiceTrace(pending.voiceTurnId, "turn_completed", { outcome: "failed" });
        }
        cancelPendingIntent("The board changed after this preview. Ask Airo to plan it again.");
        return;
      }
      const nextState = commit.state;
      const undoEvents = commit.undoEvents;
      const affectedStrokeIds = commit.affectedStrokeIds;
      const forwardEvents = commit.events;
      // One atomic batch: peers replay the compound command in sequence order.
      if (forwardEvents.length > 0) {
        boardSyncRef.current?.publish(forwardEvents);
      }
      appendBoundedBoardEvents(boardEventLogRef.current, forwardEvents);

      const committedAtMs = Date.now();
      if (undoEvents.length > 0) {
        undoStackRef.current.push({
          type: "diagram",
          undoEvents,
          selectionBefore: [...pending.baseSelectionIds],
          ...(pending.voiceTurnId
            ? { originatingInteractionId: pending.voiceTurnId }
            : {}),
        });
      }
      boardRef.current = nextState;
      if (pending.voiceTurnId && undoEvents.length > 0) {
        interactionAttributionRef.current!.record({
          interactionId: pending.voiceTurnId,
          outcome: "applied",
          occurredAtMs: committedAtMs,
        });
      }
      const finalSelection = commit.selectionIds;
      refreshRealtimeSpeechKeyterms(nextState, finalSelection);
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
        reportVoiceTrace(pending.voiceTurnId, "feedback", {
          category: "applied",
          actionable: false,
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
        reportVoiceTrace(pending.voiceTurnId, "feedback", {
          category: "error",
          actionable: true,
        });
        reportVoiceTrace(pending.voiceTurnId, "turn_completed", { outcome: "failed" });
      }
      setCommandFeedback(error instanceof Error ? error.message : "The diagram command failed.");
    }
  }, [
    appendCopilotActivity,
    cancelPendingIntent,
    refreshRealtimeSpeechKeyterms,
    render,
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
    const intentKey = createInteractionIntentKey(command);
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
        if (voiceTurnId) {
          reportAttributedVoiceFollowUp("retry", voiceTurnId, intentKey);
          if (isExplicitInteractionCorrection(instruction)) {
            reportAttributedVoiceFollowUp("correction", voiceTurnId);
          }
        }
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
          interactionAttributionRef.current!.record({
            interactionId: voiceTurnId,
            outcome: "rejected",
            intentKey,
            occurredAtMs: Date.now(),
          });
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "interpretation",
            outcome: "rejected",
          });
          reportVoiceTrace(voiceTurnId, "feedback", {
            category: "rejected",
            actionable: true,
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
        if (voiceTurnId) {
          interactionAttributionRef.current!.record({
            interactionId: voiceTurnId,
            outcome: "rejected",
            intentKey,
            occurredAtMs: Date.now(),
          });
          reportVoiceTrace(voiceTurnId, "action_failed", {
            phase: "command_queue",
            outcome: "rejected",
          });
          reportVoiceTrace(voiceTurnId, "feedback", {
            category: "error",
            actionable: true,
          });
          reportVoiceTrace(voiceTurnId, "turn_completed", { outcome: "rejected" });
        }
        setSpeechRecognitionStatus("command-rejected");
        setCommandFeedback("Airo could not apply that command. Try the typed command field.");
        appendCopilotActivity({
          source: "Airo",
          title: "Automatic command failed",
          detail: "The transcript is still available to edit and send.",
          tone: "warning",
        });
      });
  }, [appendCopilotActivity, reportAttributedVoiceFollowUp, reportVoiceTrace]);

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
      reportGestureStage(
        "candidate_scores",
        {
          candidate: "voice_gate",
          score: frame.score,
          suppressed: frame.suppressed,
          state: event ?? "idle",
        },
        frame.timestampMs,
      );
      if (frame.suppressed) {
        reportGestureStage(
          "suppression",
          { candidate: "voice_gate", reason: "higher_priority_owner" },
          frame.timestampMs,
        );
      }
      if (event === "activate") {
        openVoiceGate({ mode: "ptt" });
        reportGestureStage(
          "action",
          { gesture: "voice_gate", applied: true, outcome: "opened" },
          frame.timestampMs,
        );
      } else if (event === "release") {
        closeVoiceGate("ptt");
        reportGestureStage(
          "action",
          { gesture: "voice_gate", applied: true, outcome: "closed" },
          frame.timestampMs,
        );
      }
      return event;
    },
    [closeVoiceGate, openVoiceGate, reportGestureStage],
  );

  const dispatchVoiceDecision = useCallback(
    (
      decision: VoiceRouteDecision,
      metadata: {
        engine: VoiceCommandTraceContext["engine"];
        voiceTurnId?: string | undefined;
        provider?: string | undefined;
        model?: string | undefined;
        confidence?: number | undefined;
        turnIndex?: number | undefined;
      },
    ) => {
      queueVoiceCommand(decision.command, {
        voiceTurnId: metadata.voiceTurnId ?? crypto.randomUUID(),
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
        voiceTurnId?: string | undefined;
        provider?: string | undefined;
        model?: string | undefined;
        confidence?: number | undefined;
        turnIndex?: number | undefined;
      },
    ): { routed: boolean; wakeDetected: boolean; voiceTurnId: string } => {
      const voiceTurnId =
        metadata.voiceTurnId ??
        voiceCaptureInteractionIdRef.current ??
        crypto.randomUUID();
      voiceCaptureInteractionIdRef.current = null;
      reportVoiceTrace(voiceTurnId, "stt_finalization", {
        status: "final",
        provider: metadata.provider,
        model: metadata.model,
        turnIndex: metadata.turnIndex,
      });
      const { decisions, wakeDetected } = voiceRouter.handleFinalTranscript(transcript);
      syncVoiceGateUi();
      for (const decision of decisions) {
        dispatchVoiceDecision(decision, { ...metadata, voiceTurnId });
      }
      reportVoiceTrace(voiceTurnId, "routing", {
        routed: decisions.length > 0,
        wakeDetected,
        decisionCount: decisions.length,
        channel:
          decisions[0]?.wakePhrase === "push-to-talk"
            ? "ptt"
            : decisions[0]?.wakePhrase === "hold-to-edit"
              ? "scoped"
              : decisions.length > 0
                ? "wake"
                : "none",
      });
      return { routed: decisions.length > 0, wakeDetected, voiceTurnId };
    },
    [
      dispatchVoiceDecision,
      reportVoiceTrace,
      syncVoiceGateUi,
      voiceRouter,
    ],
  );

  /**
   * Raw-landmark browser-eval seam. It intentionally enters below MediaPipe
   * (recorded-video runs cover that provider) but above every production
   * estimator, tracker, arbitration rule, target resolver, and board action.
   */
  const processDetectedHandsForTest = useCallback(
    (
      hands: readonly DetectedHand[],
      timestampMs = performance.now(),
      metadata: {
        inferenceMs?: number;
        sourceWidth?: number;
        sourceHeight?: number;
      } = {},
    ) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect?.width ?? 900));
      const height = Math.max(1, Math.round(rect?.height ?? 600));
      const video = videoRef.current;
      const processor = rawLandmarkFrameProcessorRef.current;
      if (!processor) {
        throw new Error("Raw landmark frame coordinator is not ready.");
      }
      return processor({
        hands,
        timestampMs,
        ...(metadata.inferenceMs === undefined
          ? {}
          : { inferenceMs: metadata.inferenceMs }),
        source: "eval_landmark_injection",
        geometry: {
          canvasWidth: width,
          canvasHeight: height,
          sourceWidth:
            metadata.sourceWidth ?? video?.videoWidth ?? width,
          sourceHeight:
            metadata.sourceHeight ?? video?.videoHeight ?? height,
          fitMode: "cover",
          mirrorInput: true,
          sensitivity,
        },
        gestureModeEnabled: true,
        captureLandmarks: false,
      });
    },
    [sensitivity],
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
      emitTranscriptionProviderEvent: (event: {
        type: string;
        transcript?: string;
        provider?: string;
        model?: string;
        confidence?: number;
        turnIndex?: number;
      }) => {
        if (event.type !== "transcription.final" || !event.transcript?.trim()) {
          return { routed: false, wakeDetected: false };
        }
        setSpeechHeardText(event.transcript);
        return routeFinalTranscript(event.transcript, {
          engine: "realtime",
          provider: event.provider,
          model: event.model,
          confidence: event.confidence,
          turnIndex: event.turnIndex,
        });
      },
      emitRawLandmarkFrame: (
        hands: readonly DetectedHand[],
        timestampMs?: number,
        metadata?: {
          inferenceMs?: number;
          sourceWidth?: number;
          sourceHeight?: number;
        },
      ) => processDetectedHandsForTest(hands, timestampMs, metadata),
      emitRemoteBoardEvent: (event: BoardEvent) =>
        applyRemoteEventRef.current(event),
      prepareLegacyIntentCommandForEval: (instruction: string) =>
        prepareIntentCommand(instruction),
      openPttGate: () => openVoiceGate({ mode: "ptt" }),
      emitPalmVoiceGestureFrame: (frame: PalmVoiceGestureFrame) =>
        processPalmVoiceGestureFrame(frame),
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
      getCanonicalBoardState: () => structuredClone(boardRef.current),
      getBoardEventLog: () => structuredClone(boardEventLogRef.current),
      getInteractionDiagnostics: () => {
        const gestureTrace = gestureTraceJournalRef.current?.snapshot() ?? [];
        const gestureSummary =
          gestureTraceJournalRef.current?.summary() ?? null;
        return {
          selectionIds: [...selectedAnnotationIdsRef.current],
          viewport: { ...boardViewportRef.current },
          gestureOwner:
            [...gestureTrace]
              .reverse()
              .find((event) => event.stage === "arbitration_owner")
              ?.data.owner ?? null,
          gestureTrace,
          gestureSummary,
          voiceStages: structuredClone(voiceTraceJournalRef.current),
          undoDepth: undoStackRef.current.length,
          pendingInteraction: pendingIntentRef.current
            ? {
                requestText: pendingIntentRef.current.requestText,
                commandCount: pendingIntentRef.current.commands.length,
              }
            : null,
        };
      },
      undoLastActionForEval: () => {
        const depthBefore = undoStackRef.current.length;
        undoLastAction("button");
        return {
          applied: depthBefore > undoStackRef.current.length,
          depthBefore,
          depthAfter: undoStackRef.current.length,
        };
      },
      clearEvalJournals: () => {
        boardEventLogRef.current = [];
        gestureTraceJournalRef.current?.clear();
        voiceTraceJournalRef.current = [];
      },
      getCatalogGestureState: () => {
        const interaction = objectInteractionRef.current;
        const ghostBounds = ghostAnnotation?.annotation.bounds;
        return {
          openCatalogId,
          activeTool: activeObjectTool,
          interactionMode: interaction?.mode ?? null,
          carriedTool:
            interaction?.mode === "catalog_carrying"
              ? interaction.creationTool ?? interaction.tool
              : null,
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
        setViewportRevision((revision) => revision + 1);
        render();
      },
      getBoardSummary: () => {
        const committed = Object.values(boardRef.current.strokes).filter(
          (stroke) => stroke.status === "committed" && stroke.annotation,
        );
        const sceneElements = Object.values(boardRef.current.elements)
          .filter((element) => element.status === "active" && !element.legacyStrokeId)
          .sort((left, right) => left.zIndex - right.zIndex);
        return {
          objectCount: committed.length + sceneElements.length,
          labels: [
            ...committed.map((stroke) => stroke.annotation?.label ?? ""),
            ...sceneElements.map(sceneElementReferenceLabel),
          ],
          positions: [
            ...committed.map((stroke) => {
              const bounds = stroke.annotation?.bounds;
              return bounds
                ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
                : null;
            }),
            ...sceneElements.map(elementCenter),
          ],
          selectedCount:
            selectedAnnotationIdsRef.current.length + selectedElementIdsRef.current.length,
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
    processDetectedHandsForTest,
    processPalmVoiceGestureFrame,
    processSnapGestureFrame,
    prepareIntentCommand,
    render,
    routeFinalTranscript,
    setDiagramVisibility,
    undoLastAction,
    voiceRouter,
  ]);

  const cancelHeadlessVoiceRetry = useCallback(() => {
    if (headlessVoiceRetryTimerRef.current !== null) {
      clearTimeout(headlessVoiceRetryTimerRef.current);
      headlessVoiceRetryTimerRef.current = null;
    }
  }, []);

  const scheduleHeadlessVoiceRetry = useCallback(() => {
    if (
      !headlessMeetOverlay ||
      !effectiveAccessToken ||
      !cameraMountedRef.current ||
      headlessVoiceRetryTimerRef.current !== null
    ) {
      return;
    }
    const delayMs = headlessMeetVoiceRetryDelayMs(
      headlessVoiceRetryAttemptRef.current,
    );
    headlessVoiceRetryAttemptRef.current += 1;
    headlessVoiceRetryTimerRef.current = setTimeout(() => {
      headlessVoiceRetryTimerRef.current = null;
      headlessVoiceRequestedCredentialRef.current = null;
      setHeadlessVoiceRetryRevision((revision) => revision + 1);
    }, delayMs);
  }, [effectiveAccessToken, headlessMeetOverlay]);

  const cancelHeadlessSpeechConfigRetry = useCallback(() => {
    if (headlessSpeechConfigRetryTimerRef.current !== null) {
      clearTimeout(headlessSpeechConfigRetryTimerRef.current);
      headlessSpeechConfigRetryTimerRef.current = null;
    }
  }, []);

  const scheduleHeadlessSpeechConfigRetry = useCallback(() => {
    if (
      !headlessMeetOverlay ||
      !cameraMountedRef.current ||
      headlessSpeechConfigRetryTimerRef.current !== null
    ) {
      return;
    }
    const delayMs = headlessMeetVoiceRetryDelayMs(
      headlessSpeechConfigRetryAttemptRef.current,
    );
    headlessSpeechConfigRetryAttemptRef.current += 1;
    headlessSpeechConfigRetryTimerRef.current = setTimeout(() => {
      headlessSpeechConfigRetryTimerRef.current = null;
      setSpeechConfigRevision((revision) => revision + 1);
    }, delayMs);
  }, [headlessMeetOverlay]);

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
      speechSessionRef.current = null;
      // Clear ownership before stop(): a session that has not opened its socket
      // can report "stopped" synchronously. That intentional stop must never be
      // mistaken for an unexpected provider close by the headless retry path.
      activeSession.stop();
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
        voiceTurnId?: string | undefined;
        finalizationReported?: boolean | undefined;
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
      const voiceTurnId =
        metadata?.voiceTurnId ??
        voiceCaptureInteractionIdRef.current ??
        crypto.randomUUID();
      voiceCaptureInteractionIdRef.current = null;
      if (!metadata?.finalizationReported) {
        reportVoiceTrace(voiceTurnId, "stt_finalization", {
          status: "final",
          provider: metadata?.provider,
          model: metadata?.model,
          turnIndex: metadata?.turnIndex,
        });
      }
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
      if (!metadata?.finalizationReported) {
        reportVoiceTrace(voiceTurnId, "routing", {
          routed: false,
          wakeDetected: classification.wakeDetected,
          decisionCount: 0,
          channel: "none",
        });
      }
      if (!classification.wakeDetected) {
        setSpeechRecognitionStatus("wake-missing");
        setCommandFeedback(
          `Mic heard “${truncateSpeechTranscript(transcript)}”, but it wasn't addressed to the board. Hold an open palm for voice, or say “Airo, add a user.”`,
        );
      } else if (classification.commands.length === 0) {
        setSpeechRecognitionStatus("wake-detected");
        setCommandFeedback("Airo heard the wake word. Say the diagram command now.");
      }
      reportVoiceTrace(voiceTurnId, "feedback", {
        category: classification.wakeDetected ? "wake_only" : "wake_missing",
        actionable: true,
      });
      reportVoiceTrace(voiceTurnId, "turn_completed", {
        outcome: classification.wakeDetected ? "wake_only" : "wake_missing",
      });
    };

    const captureVoiceTurnId = crypto.randomUUID();
    voiceCaptureInteractionIdRef.current = captureVoiceTurnId;
    reportVoiceTrace(captureVoiceTurnId, "capture_started", {
      engine:
        speechEngine === "realtime" ? "realtime" : "browser-fallback",
      surface: isMeetSurface ? "meet" : "standalone",
      source:
        isMeetSurface && !embeddedMediaCapture && meetMediaBridge
          ? "meet_bridge"
          : "browser_media",
    });

    if (speechEngine === "realtime") {
      let realtimeSession: RealtimeSpeechSession | null = null;
      realtimeSession = createRealtimeSpeechSession(
        {
          onReady: (metadata) => {
            const voiceTurnId =
              voiceCaptureInteractionIdRef.current ?? captureVoiceTurnId;
            reportVoiceTrace(voiceTurnId, "stt_connection", {
              status: "ready",
              provider: metadata.provider,
              model: metadata.model,
              sampleRate: metadata.sampleRate,
            });
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
              if (headlessMeetOverlay) {
                cancelHeadlessVoiceRetry();
                headlessVoiceRetryAttemptRef.current = 0;
              }
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
            if (!voiceCaptureInteractionIdRef.current) {
              const voiceTurnId = crypto.randomUUID();
              voiceCaptureInteractionIdRef.current = voiceTurnId;
              reportVoiceTrace(voiceTurnId, "capture_started", {
                engine: "realtime",
                surface: isMeetSurface ? "meet" : "standalone",
                source:
                  isMeetSurface && !embeddedMediaCapture && meetMediaBridge
                    ? "meet_bridge"
                    : "browser_media",
                continuedSession: true,
              });
            }
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
            const { routed, voiceTurnId } = routeFinalTranscript(
              transcript,
              traceMetadata,
            );
            reportFinalTranscript(transcript, routed, {
              ...traceMetadata,
              voiceTurnId,
              finalizationReported: true,
            });
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
            const voiceTurnId =
              voiceCaptureInteractionIdRef.current ?? crypto.randomUUID();
            voiceCaptureInteractionIdRef.current = voiceTurnId;
            reportVoiceTrace(voiceTurnId, "audio_dropped", {
              reason: "client_backpressure",
            });
            setCommandFeedback(
              "Your network is slow, so some microphone audio was dropped. A command may be cut off — pause briefly and say it again.",
            );
          },
          onEnd: (reason) => {
            // A rotated credential or model switch may already have installed
            // a replacement session. The stale callback must not attribute its
            // close to the new voice turn or reset the new session's router/UI.
            if (speechSessionRef.current !== realtimeSession) {
              return;
            }
            const voiceTurnId = voiceCaptureInteractionIdRef.current;
            if (voiceTurnId) {
              reportVoiceTrace(voiceTurnId, "stt_connection", {
                status: "ended",
                reason,
              });
            }
            voiceRouter.reset();
            setVoiceGate(null);
            speechSessionRef.current = null;
            setSpeechListening(false);
            setSpeechArmed(false);
            const shouldRetryHeadless =
              shouldRetryHeadlessMeetVoiceAfterEnd(
                headlessMeetOverlay,
                reason,
              );
            if (
              reason === "error" ||
              reason === "closed" ||
              shouldRetryHeadless
            ) {
              if (shouldRetryHeadless) {
                scheduleHeadlessVoiceRetry();
              }
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
          keyterms: buildSessionKeyterms(
            boardRef.current,
            selectedAnnotationIdsRef.current,
          ),
          dynamicKeyterms:
            realtimeTranscriptionConfig?.dynamicKeyterms === true,
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
        if (headlessMeetOverlay) {
          scheduleHeadlessVoiceRetry();
        }
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
        const voiceTurnId =
          voiceCaptureInteractionIdRef.current ?? captureVoiceTurnId;
        reportVoiceTrace(voiceTurnId, "stt_connection", {
          status: "ready",
          provider: "browser",
          model: "Web Speech API",
        });
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
          if (!voiceCaptureInteractionIdRef.current) {
            const voiceTurnId = crypto.randomUUID();
            voiceCaptureInteractionIdRef.current = voiceTurnId;
            reportVoiceTrace(voiceTurnId, "capture_started", {
              engine: "browser-fallback",
              surface: isMeetSurface ? "meet" : "standalone",
              source: "browser_speech",
              continuedSession: true,
            });
          }
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
          const voiceTurnId =
            voiceCaptureInteractionIdRef.current ?? crypto.randomUUID();
          voiceCaptureInteractionIdRef.current = null;
          reportVoiceTrace(voiceTurnId, "stt_finalization", {
            status: "final",
            provider: "browser",
            model: "Web Speech API",
          });
          dispatchVoiceDecision(gated, {
            engine: "browser-fallback",
            voiceTurnId,
            provider: "browser",
            model: "Web Speech API",
          });
          reportVoiceTrace(voiceTurnId, "routing", {
            routed: true,
            wakeDetected: false,
            decisionCount: 1,
            channel:
              gated.wakePhrase === "hold-to-edit" ? "scoped" : "ptt",
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
        const voiceTurnId =
          voiceCaptureInteractionIdRef.current ?? crypto.randomUUID();
        voiceCaptureInteractionIdRef.current = null;
        reportVoiceTrace(voiceTurnId, "stt_finalization", {
          status: "final",
          provider: "browser",
          model: "Web Speech API",
        });
        dispatchVoiceDecision(decision, {
          engine: "browser-fallback",
          voiceTurnId,
          provider: "browser",
          model: "Web Speech API",
        });
        reportVoiceTrace(voiceTurnId, "routing", {
          routed: true,
          wakeDetected: true,
          decisionCount: 1,
          channel: "wake",
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
    cancelHeadlessVoiceRetry,
    dispatchVoiceDecision,
    effectiveAccessToken,
    headlessMeetOverlay,
    realtimeTranscriptionConfig?.defaultModel,
    realtimeTranscriptionConfig?.dynamicKeyterms,
    refreshStandaloneMediaPermissions,
    routeFinalTranscript,
    speechEngine,
    speechSupported,
    standaloneEditor,
    embeddedMediaCapture,
    isMeetSurface,
    meetMediaBridge,
    reportVoiceTrace,
    scheduleHeadlessVoiceRetry,
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
    gestureActionEvidenceTrackerRef.current?.reset();
    setCanvasNavMode(null);
    snapGestureTrackerRef.current?.reset();
    if (palmVoiceGestureTrackerRef.current?.engaged) {
      closeVoiceGate("ptt");
    }
    palmVoiceGestureTrackerRef.current?.reset();
    holdToEditTrackerRef.current?.reset();
    hybridGestureControllerRef.current?.reset({ requirePinchRelease: false });
    hybridGestureControllerRef.current = null;
    hybridPinchClosedRef.current = false;
    dockGestureActivationTrackerRef.current?.reset();
    cancelObjectInteraction();
    const gestureInteractionId = gestureInteractionIdRef.current;
    if (gestureInteractionId) {
      reportGestureTrace({
        interactionId: gestureInteractionId,
        frameAtMs: performance.now(),
        stage: "cancellation",
        data: { reason: "camera_stopped" },
      });
    }
    gestureInteractionIdRef.current = null;
    setCameraStatus("idle");
    setCameraError(null);
  }, [cancelObjectInteraction, closeVoiceGate, reportGestureTrace]);

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
        ...handPerceptionOptions(confidenceThreshold),
      });
      if (releaseIfUnmounted(stream, tracker)) {
        meetBridgeSessionRef.current?.stop();
        meetBridgeSessionRef.current = null;
        video.srcObject = null;
        return;
      }
      trackerRef.current = tracker;
      gestureTraceJournalRef.current?.clear();
      gestureInteractionIdRef.current = crypto.randomUUID();
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
  }, [cameraCaptureAvailable, cameraStatus, confidenceThreshold, embeddedMediaCapture, enforceCameraCanvas, isMeetSurface, meetMediaBridge, refreshStandaloneMediaPermissions, standaloneEditor, stopCamera]);

  useEffect(() => {
    if (
      cameraStatus !== "idle" ||
      !pendingCameraConfidenceRestartRef.current
    ) {
      return;
    }
    pendingCameraConfidenceRestartRef.current = false;
    void startCamera();
  }, [cameraStatus, startCamera]);

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

  const airoVoiceAvailable = voiceCaptureAvailable && speechSupported;
  const airoHandsAvailable = cameraCaptureAvailable;
  const airoInputsActive =
    (airoVoiceAvailable || airoHandsAvailable) &&
    (speechArmed || cameraStatus === "active");

  const toggleAiroInputs = useCallback(() => {
    if (airoInputsActive) {
      if (airoVoiceAvailable && speechArmed) {
        toggleVoiceInput();
      }
      if (airoHandsAvailable && cameraStatus === "active") {
        toggleCameraInput();
      }
      return;
    }

    if (airoVoiceAvailable) {
      toggleVoiceInput();
    }
    if (airoHandsAvailable) {
      toggleCameraInput();
    }
    if (!airoVoiceAvailable && !airoHandsAvailable) {
      setCopilotVisibility(true);
      requestAnimationFrame(() => intentCommandInputRef.current?.focus());
    }
  }, [
    airoHandsAvailable,
    airoInputsActive,
    airoVoiceAvailable,
    cameraStatus,
    speechArmed,
    toggleCameraInput,
    toggleVoiceInput,
  ]);

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
      !headlessMeetOverlay ||
      headlessVoiceCredentialRef.current === effectiveAccessToken
    ) {
      return;
    }

    // Installation credentials rotate and are cleared on revoke. Never keep a
    // WebSocket authenticated with the superseded token, and let the following
    // auto-start effect establish a new session only after a replacement token
    // has arrived.
    headlessVoiceCredentialRef.current = effectiveAccessToken;
    headlessVoiceRequestedCredentialRef.current = null;
    headlessVoiceRetryAttemptRef.current = 0;
    cancelHeadlessVoiceRetry();
    const activeSession = speechSessionRef.current;
    if (activeSession) {
      speechSessionRef.current = null;
      activeSession.abort();
      setSpeechArmed(false);
      setSpeechListening(false);
      setSpeechRecognitionStatus("idle");
    }
  }, [cancelHeadlessVoiceRetry, effectiveAccessToken, headlessMeetOverlay]);

  useEffect(() => {
    const credential = effectiveAccessToken ?? null;
    if (shouldStartHeadlessMeetVoice({
      headlessMeetOverlay,
      bridgeReady: meetMediaBridge !== null,
      authenticationReady: syncAuthenticationReady,
      credential,
      speechSupported,
      speechEngine,
      hasActiveSession: speechSessionRef.current !== null,
      requestedCredential: headlessVoiceRequestedCredentialRef.current,
    })) {
      headlessVoiceRequestedCredentialRef.current = credential;
      startVoiceCommand();
    }
  }, [
    effectiveAccessToken,
    headlessMeetOverlay,
    headlessVoiceRetryRevision,
    meetMediaBridge,
    speechEngine,
    speechSupported,
    startVoiceCommand,
    syncAuthenticationReady,
  ]);

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
    cancelHeadlessSpeechConfigRetry();
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
        cancelHeadlessSpeechConfigRetry();
        headlessSpeechConfigRetryAttemptRef.current = 0;
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
      .catch((error: unknown) => {
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
        if (
          headlessMeetOverlay &&
          shouldRetryHeadlessMeetSpeechConfig(error)
        ) {
          scheduleHeadlessSpeechConfigRetry();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    cancelHeadlessSpeechConfigRetry,
    headlessMeetOverlay,
    scheduleHeadlessSpeechConfigRetry,
    speechConfigRevision,
  ]);

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
   * Airboard's landmark-defined open palm held still briefly opens the command
   * mic gate. Dropping the palm closes it after a short release debounce, with
   * one activation per neutral-hand reset. Moving the palm remains pointer
   * input and never mutates the board as an Undo action.
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

  /**
   * The single production raw-landmark path. Live HandLandmarker frames and
   * browser-eval injections both enter here, so mapping, pipeline state,
   * tracker advancement, arbitration, targeting, and effects cannot drift.
   */
  const processRawLandmarkFrame = useCallback(
    (frame: RawLandmarkFrameRequest): RawLandmarkFrameOutcome => {
      const interactionId =
        gestureInteractionIdRef.current ??
        (frame.source === "eval_landmark_injection"
          ? "gesture-browser-eval"
          : crypto.randomUUID());
      gestureInteractionIdRef.current = interactionId;

      const coordinated = coordinateRawLandmarkFrame<
        DetectedHand,
        GestureResult | null,
        {
          signal: ReturnType<typeof selectLandmarkManipulationSignal>;
          navTracker: CanvasNavigationTracker;
        },
        HybridGestureControllerOutput
      >({
        interactionId,
        source: frame.source,
        timestampMs: frame.timestampMs,
        ...(frame.inferenceMs === undefined
          ? {}
          : { inferenceMs: frame.inferenceMs }),
        hands: frame.hands,
        geometry: frame.geometry,
        gestureModeEnabled: frame.gestureModeEnabled,
        diagramVisible: diagramVisibleRef.current,
        processPipeline: ({ hands, timestampMs, mapping }) =>
          pipelineRef.current.process({
            hands: [...hands],
            timestampMs,
            config: gestureConfig,
            frictionConfig,
            frictionPreset,
            markerInputMode,
            paused: inputPaused,
            mapping,
          }),
        ...(frame.captureLandmarks
          ? {
              observeFrame: ({
                hands,
                timestampMs,
              }: {
                hands: readonly DetectedHand[];
                timestampMs: number;
              }) => captureLandmarkFrame(hands, timestampMs),
            }
          : {}),
        prepareGesture: ({ hands, mapping, pipelineResult }) => {
          const width = Math.max(1, Math.round(mapping.canvasWidth));
          const height = Math.max(1, Math.round(mapping.canvasHeight));
          const controllerSize = hybridGestureCanvasSizeRef.current;
          if (
            !hybridGestureControllerRef.current ||
            controllerSize.width !== width ||
            controllerSize.height !== height ||
            controllerSize.minTrackingConfidence !== confidenceThreshold
          ) {
            hybridGestureControllerRef.current = new HybridGestureController({
              canvasWidth: width,
              canvasHeight: height,
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
              width,
              height,
              minTrackingConfidence: confidenceThreshold,
            };
          }

          return {
            signal: selectLandmarkManipulationSignal(
              hands,
              pipelineResult?.hand,
              mapping,
            ),
            navTracker: canvasNavTrackerRef.current!,
          };
        },
        processHiddenFrame: ({ hands, timestampMs }) => {
          // Visibility remains available while the diagram is hidden, but all
          // other board gestures stay suspended so no invisible edit can occur.
          reportGestureStage(
            "suppression",
            {
              reason: "diagram_hidden",
              allowedCandidate: "visibility_toggle",
            },
            timestampMs,
          );
          canvasNavTrackerRef.current!.reset();
          gestureActionEvidenceTrackerRef.current?.reset();
          updateSnapGesture(hands, timestampMs);
        },
        createStages: ({
          hands,
          timestampMs,
          mapping,
          gestureContext: { signal, navTracker },
          setManipulationResult,
        }) => ({
          // Two-hand navigation outranks every one-hand gesture. Its
          // reservation window prevents pan/zoom from grabbing an object or
          // opening the command microphone.
          navigation: {
            update: () => {
              const navigationHands = collectLandmarkNavigationHands(
                hands,
                mapping,
              );
              const navUpdate = navTracker.update({
                hands: navigationHands,
                timestampMs,
              });
              const reserving = shouldReserveLandmarkNavigation(
                hands.length,
                navTracker.reserving,
              );
              const actionEvidence =
                gestureActionEvidenceTrackerRef.current!.observeNavigation({
                  reserving,
                  engaged: navTracker.engaged,
                  updateMode: navUpdate.mode,
                });
              if (actionEvidence) {
                reportGestureStage(
                  "action",
                  { gesture: actionEvidence, applied: true },
                  timestampMs,
                );
              }
              if (!reserving) {
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
                      width: target.bounds.width * viewportForTargets.scale,
                      height: target.bounds.height * viewportForTargets.scale,
                    },
                  }));
              const hybridOutput =
                hybridGestureControllerRef.current!.update({
                  handPoint: signal?.point ?? null,
                  trackingConfidence: signal?.trackingConfidence ?? 0,
                  pinchStrength: signal?.grabStrength ?? 0,
                  grabConfidence: signal?.grabConfidence ?? 0,
                  timestampMs,
                  // Camera targeting exposes committed object bodies only.
                  // There are no resize handles or empty-canvas targets.
                  targets: screenTargets,
                });
              setManipulationResult(hybridOutput);
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
        }),
        applyFrame: ({
          disposition,
          owner,
          pipelineResult,
          manipulationResult,
        }) => {
          if (disposition === "pipeline_only") {
            handleGesture(pipelineResult, undefined);
            return;
          }
          handleGesture(
            disposition === "arbitrated" && owner === "manipulation"
              ? pipelineResult
              : null,
            disposition === "arbitrated" && owner === "manipulation"
              ? manipulationResult
              : undefined,
          );
        },
        report: reportGestureTrace,
      });

      return {
        owner: coordinated.owner,
        pipelineGesture: coordinated.pipelineResult?.gesture ?? null,
        hybridState: coordinated.manipulationResult?.state ?? null,
      };
    },
    [
      applyViewport,
      captureLandmarkFrame,
      closeVoiceGate,
      confidenceThreshold,
      currentViewportLimits,
      frictionConfig,
      frictionPreset,
      gestureConfig,
      handleGesture,
      inputPaused,
      markerInputMode,
      reportGestureStage,
      reportGestureTrace,
      updatePalmVoiceGesture,
      updateSnapGesture,
    ],
  );
  rawLandmarkFrameProcessorRef.current = processRawLandmarkFrame;

  useEffect(() => {
    if (inputMode === "gesture" && !inputPaused) {
      return;
    }
    if (palmVoiceGestureTrackerRef.current!.engaged) {
      closeVoiceGate("ptt");
    }
    palmVoiceGestureTrackerRef.current!.reset();
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
        const actionEvidence = holdToEditActionEvidence(event);
        if (actionEvidence) {
          reportGestureStage("target", {
            gesture: actionEvidence,
            targetId: event.strokeId,
          });
          reportGestureStage("action", {
            gesture: actionEvidence,
            applied: true,
          });
        }
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
  }, [
    closeVoiceGate,
    inputMode,
    openVoiceGate,
    reportGestureStage,
    syncVoiceGateUi,
    voiceRouter,
  ]);

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
        const inferenceStartedAt = performance.now();
        let hands: DetectedHand[];
        try {
          hands = tracker.detect(video, timestampMs);
        } catch (error) {
          const interactionId =
            gestureInteractionIdRef.current ?? crypto.randomUUID();
          gestureInteractionIdRef.current = interactionId;
          reportGestureInferenceFailure(
            {
              interactionId,
              timestampMs,
              report: reportGestureTrace,
            },
            error,
          );
          stopCamera();
          setCameraStatus("tracker_error");
          setCameraError(
            "Hand tracking stopped after an inference error. Click Enable hands to retry.",
          );
          return;
        }
        const inferenceMs = performance.now() - inferenceStartedAt;
        setStats((currentStats) => ({
          ...currentStats,
          handsDetected: hands.length,
        }));
        const rect = canvas.getBoundingClientRect();
        processRawLandmarkFrame({
          hands,
          timestampMs,
          inferenceMs,
          source: "live_hand_landmarker",
          geometry: {
            canvasWidth: rect.width,
            canvasHeight: rect.height,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
            fitMode: "cover",
            mirrorInput: true,
            sensitivity,
          },
          gestureModeEnabled: inputMode === "gesture",
          captureLandmarks: inputMode === "gesture",
        });
      }

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    cameraStatus,
    inputMode,
    processRawLandmarkFrame,
    sensitivity,
    reportGestureTrace,
    stopCamera,
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
        if (event.shiftKey) redoLastSceneAction();
        else undoLastAction("keyboard");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoLastSceneAction();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        const elementId = selectedElementIdsRef.current.at(-1);
        if (elementId) {
          event.preventDefault();
          duplicateSceneElement(elementId);
        }
        return;
      }

      if (inputMode === "touchpad" && shortcutsActiveRef.current && event.key === "Shift") {
        straightLineActiveRef.current = true;
        return;
      }

      if (shortcutsActiveRef.current && event.code === "Space") {
        event.preventDefault();
        panActiveRef.current = true;
        setTemporaryHandActive(true);
        if (
          inputMode === "touchpad" &&
          !pointerStrokeIdRef.current &&
          !pointerErasingRef.current
        ) {
          setTouchpadState("PANNING");
        }
        return;
      }

      if (
        inputMode === "gesture" &&
        !event.shiftKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        if (selectedElementIdsRef.current.length > 0) {
          event.preventDefault();
          selectedElementIdsRef.current.forEach(deleteSceneElement);
          return;
        }
        if (selectedAnnotationIds.length === 0) {
          return;
        }
        event.preventDefault();
        prepareIntentCommand("delete selected");
        return;
      }

      // Keyboard object navigation while the canvas is focused: Tab / Shift+Tab
      // step the selection through committed objects so a keyboard-only user can
      // reach, then label, any object without a pointer. Crucially this is NOT a
      // focus trap — at the ends of the list Tab is allowed to fall through to the
      // browser's native focus movement, so focus can always leave the canvas
      // (WCAG 2.1.2). Enter/exit follows the standard composite-widget pattern.
      if (shortcutsActiveRef.current && event.key === "Tab") {
        const objects = [
          ...getSelectableAnnotationIds(boardRef.current).map((id) => ({ source: "stroke" as const, id })),
          ...sceneElementsForRender(boardRef.current)
            .filter((element) => !element.legacyStrokeId)
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((element) => ({ source: "element" as const, id: element.id })),
        ];
        if (objects.length > 0) {
          const currentId = selectedElementIdsRef.current.length === 1
            ? selectedElementIdsRef.current[0]
            : selectedAnnotationIdsRef.current.length === 1
              ? selectedAnnotationIdsRef.current[0]
              : null;
          const currentIndex = currentId ? objects.findIndex(({ id }) => id === currentId) : -1;
          const selectAt = (index: number) => {
            const next = objects[index]!;
            if (next.source === "element") {
              selectSceneElements([next.id], next.id);
            } else {
              setSelectedElementId(null);
              setSelectedElementIds([]);
              setSelectedAnnotationId(next.id);
              setSelectedAnnotationIds([next.id]);
              setEditingAnnotationId(null);
            }
          };
          if (!event.shiftKey) {
            if (currentIndex === -1) {
              event.preventDefault();
              selectAt(0);
              return;
            }
            if (currentIndex < objects.length - 1) {
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
        const selectedSceneId = selectedElementIdsRef.current.length === 1
          ? selectedElementIdsRef.current[0]
          : null;
        if (selectedSceneId) {
          event.preventDefault();
          setEditingElementId(selectedSceneId);
          return;
        }
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
        handPanRef.current = null;
        setCanvasNavMode(null);
        gesturePathRef.current = [];
        setSelectedAnnotationId(null);
        setSelectedAnnotationIds([]);
        setSelectedElementId(null);
        setSelectedElementIds([]);
        setHoverElementId(null);
        setEditingElementId(null);
        if (sceneDrawingRef.current) {
          const transientId = sceneDrawingRef.current.elementId;
          sceneDrawingRef.current = null;
          const { [transientId]: _transient, ...activeStrokes } = boardRef.current.activeStrokes;
          boardRef.current = { ...boardRef.current, activeStrokes };
          render();
        }
        setLabelDraft("");
        setEditingAnnotationId(null);
        if (inputMode === "gesture") {
          cancelObjectInteraction();
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "v" && scopedKeyActiveRef.current) {
        scopedKeyActiveRef.current = false;
        closeVoiceGate("scoped");
      }

      if (event.key === "Shift") {
        straightLineActiveRef.current = false;
      }

      if (event.code === "Space") {
        panActiveRef.current = false;
        setTemporaryHandActive(false);
        if (inputMode === "touchpad" && touchpadState === "PANNING") {
          setTouchpadState("HOVER");
        }
      }
    };

    const handleBlur = () => {
      handPanRef.current = null;
      panActiveRef.current = false;
      setTemporaryHandActive(false);
      setCanvasNavMode(null);
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
      deleteSceneElement,
      duplicateSceneElement,
    endActiveTouchpadInteraction,
    inputMode,
    openVoiceGate,
    prepareIntentCommand,
    redoLastSceneAction,
    render,
    selectSceneElements,
    selectedAnnotationIds,
    setDiagramVisibility,
    touchpadState,
    undoLastAction,
    voiceCaptureAvailable,
  ]);

  useEffect(() => {
    cameraMountedRef.current = true;
    return () => {
      // Signal any in-flight startCamera to release what it acquires after its await.
      cameraMountedRef.current = false;
      cancelHeadlessVoiceRetry();
      cancelHeadlessSpeechConfigRetry();
      const activeSpeechSession = speechSessionRef.current;
      speechSessionRef.current = null;
      activeSpeechSession?.abort();
      meetBridgeSessionRef.current?.stop();
      meetBridgeSessionRef.current = null;
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
  }, [cancelHeadlessSpeechConfigRetry, cancelHeadlessVoiceRetry]);

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
        const screenPoint = getCanvasPoint(event);
        const point = toBoardPoint(screenPoint);
        const inputSource = strokeInputSourceForPointer(
          event.pointerType,
          inputMode,
        );
        if (activeCreationToolRef.current === "hand" || panActiveRef.current) {
          activePointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          handPanRef.current = {
            pointerId: event.pointerId,
            start: screenPoint,
            viewport: { ...boardViewportRef.current },
          };
          setCanvasNavMode("pan");
          moveCursorPoint({ point, mode: "panning", inputSource });
          return;
        }
        const creationTool = activeCreationToolRef.current;
        if (creationTool === "draw:eraser") {
          activePointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerErasingRef.current = true;
          eraseSceneDrawingsAt(point);
          moveCursorPoint({ point, mode: "erasing", inputSource });
          return;
        }
        if (
          creationTool === "draw:marker" ||
          creationTool === "draw:highlighter" ||
          creationTool === "draw:washi"
        ) {
          activePointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          beginSceneDrawing(
            event.pointerId,
            { ...makePoint(point.x, point.y), inputSource },
            creationTool.slice("draw:".length) as "marker" | "highlighter" | "washi",
            event.shiftKey,
          );
          return;
        }
        if (creationTool === "insert:media") {
          requestMediaAtPoint(point);
          return;
        }
        if (creationTool === "insert:link") {
          void insertLinkAtPoint(point);
          return;
        }
        if (creationTool === "stamp" || creationTool === "insert:face-stamp") {
          const created = createSceneElementAtPoint(creationTool, point);
          if (created?.kind === "stamp") {
            activePointerIdRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            stampHoldRef.current = {
              pointerId: event.pointerId,
              elementId: created.id,
              startedAt: performance.now(),
              transform: { ...created.transform },
            };
          }
          return;
        }
        if (isScenePlacementTool(creationTool)) {
          createSceneElementAtPoint(creationTool, point);
          return;
        }
        const sceneHit = findSceneElementAtPoint(boardRef.current, point);
        const v2SceneHit = sceneHit?.legacyStrokeId ? null : sceneHit;
        if (event.shiftKey) {
          if (v2SceneHit) {
            const next = selectedElementIdsRef.current.includes(v2SceneHit.id)
              ? selectedElementIdsRef.current.filter((id) => id !== v2SceneHit.id)
              : [...selectedElementIdsRef.current, v2SceneHit.id];
            selectSceneElements(next, v2SceneHit.id);
            setHoverElementId(v2SceneHit.id);
            return;
          }
          const hitStroke = findAnnotationObjectAtPoint(boardRef.current, point);
          if (hitStroke) {
            toggleAnnotationObject(hitStroke.id);
            setHoverStrokeId(hitStroke.id);
          }
          moveCursorPoint({ point, mode: "marker_hover", inputSource });
          return;
        }
        activePointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.altKey) {
          const eraserPoint = makePoint(point.x, point.y);
          eraserPoint.inputSource = inputSource;
          pointerErasingRef.current = true;
          activeEraseAffectedStrokeIdsRef.current = new Set(eraseAt(eraserPoint, ERASER_RADIUS));
          selectAnnotationObject(null);
          moveCursorPoint({ point, mode: "erasing", inputSource });
          return;
        }
        if (v2SceneHit && beginSceneMove(event.pointerId, v2SceneHit, point, inputSource)) {
          setHoverElementId(v2SceneHit.id);
          moveCursorPoint({ point, mode: "writing", inputSource });
          return;
        }
        if (!v2SceneHit) selectSceneElements([]);
        beginObjectInteraction(point, { inputSource });
        moveCursorPoint({ point, mode: "writing", inputSource });
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
      const inputSource = strokeInputSourceForPointer(
        event.pointerType,
        inputMode,
      );
      point.inputSource = inputSource;
      activePointerIdRef.current = event.pointerId;
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      if (panActiveRef.current) {
        setTouchpadState("PANNING");
        moveCursorPoint({ point, mode: "panning", inputSource });
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
      moveCursorPoint({ point, mode: "writing", inputSource });
    },
    [
      eraseAt,
      beginSceneDrawing,
      beginSceneMove,
      beginObjectInteraction,
      createSceneElementAtPoint,
      eraseSceneDrawingsAt,
      inputMode,
      inputPaused,
      insertLinkAtPoint,
      makePoint,
      moveCursorPoint,
      patchSceneElements,
      requestMediaAtPoint,
      selectAnnotationObject,
      selectSceneElements,
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
        const inputSource = strokeInputSourceForPointer(
          event.pointerType,
          inputMode,
        );
        point.inputSource = inputSource;
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
            moveCursorPoint({ point: smoothedPoint, mode: "writing", inputSource });
          }
          return;
        }

        moveCursorPoint({
          point,
          mode: touchpadTool === "eraser" || temporaryEraserActiveRef.current ? "erasing" : "marker_hover",
          inputSource,
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

        const screenPoint = getCanvasPoint(event);
        const canvasPoint = toBoardPoint(screenPoint);
        const inputSource = strokeInputSourceForPointer(
          event.pointerType,
          inputMode,
        );
        event.preventDefault();
        if (activePointerIdRef.current === null) {
          const hovered = findSceneElementAtPoint(boardRef.current, canvasPoint);
          setHoverElementId(hovered?.legacyStrokeId ? null : hovered?.id ?? null);
        }
        const handPan = handPanRef.current;
        if (handPan && handPan.pointerId === event.pointerId) {
          applyViewport(
            panViewport(
              handPan.viewport,
              screenPoint.x - handPan.start.x,
              screenPoint.y - handPan.start.y,
              currentViewportLimits(),
            ),
          );
          moveCursorPoint({ point: canvasPoint, mode: "panning", inputSource });
          return;
        }
        if (pointerErasingRef.current && activeCreationToolRef.current === "draw:eraser") {
          eraseSceneDrawingsAt(canvasPoint);
          moveCursorPoint({ point: canvasPoint, mode: "erasing", inputSource });
          return;
        }
        if (
          appendSceneDrawingPoint(event.pointerId, {
            ...makePoint(canvasPoint.x, canvasPoint.y),
            inputSource,
          })
        ) {
          moveCursorPoint({ point: canvasPoint, mode: "writing", inputSource });
          return;
        }
        if (previewSceneMove(event.pointerId, canvasPoint)) {
          moveCursorPoint({ point: canvasPoint, mode: "writing", inputSource });
          return;
        }
        moveObjectInteraction(canvasPoint, { inputSource });
        moveCursorPoint({
          point: canvasPoint,
          mode: pointerErasingRef.current ? "erasing" : "marker_hover",
          inputSource,
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
      appendSceneDrawingPoint,
      applyViewport,
      currentViewportLimits,
      eraseAt,
      eraseSceneDrawingsAt,
      inputMode,
      inputPaused,
      makePoint,
      moveObjectInteraction,
      moveCursorPoint,
      previewSceneMove,
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
        if (handPanRef.current?.pointerId === event.pointerId) {
          handPanRef.current = null;
          activePointerIdRef.current = null;
          setCanvasNavMode(null);
          return;
        }
        const boardPoint = toBoardPoint(getCanvasPoint(event));
        const stampHold = stampHoldRef.current;
        if (stampHold?.pointerId === event.pointerId) {
          stampHoldRef.current = null;
          const heldMs = Math.max(0, performance.now() - stampHold.startedAt);
          const scale = Math.min(3, 1 + Math.max(0, heldMs - 180) / 650);
          if (scale > 1.02) {
            const width = stampHold.transform.width * scale;
            const height = stampHold.transform.height * scale;
            patchSceneElements([{
              elementId: stampHold.elementId,
              patches: [
                { op: "field.set", path: ["transform", "x"], value: stampHold.transform.x - (width - stampHold.transform.width) / 2 },
                { op: "field.set", path: ["transform", "y"], value: stampHold.transform.y - (height - stampHold.transform.height) / 2 },
                { op: "field.set", path: ["transform", "width"], value: width },
                { op: "field.set", path: ["transform", "height"], value: height },
              ],
            }], { recordHistory: false });
          }
          activePointerIdRef.current = null;
          return;
        }
        if (commitSceneDrawing(event.pointerId)) {
          pointerStrokeIdRef.current = null;
          activePointerIdRef.current = null;
          return;
        }
        if (pointerErasingRef.current && activeCreationToolRef.current === "draw:eraser") {
          pointerErasingRef.current = false;
          activePointerIdRef.current = null;
          return;
        }
        if (commitSceneMove(event.pointerId, boardPoint)) {
          activePointerIdRef.current = null;
          return;
        }
        endObjectInteraction(boardPoint);
        pointerStrokeIdRef.current = null;
        activePointerIdRef.current = null;
        return;
      }

      commitStroke(pointerStrokeIdRef.current);
      pointerStrokeIdRef.current = null;
      pointerErasingRef.current = false;
    },
    [
      commitSceneDrawing,
      commitSceneMove,
      commitStroke,
      endActiveTouchpadInteraction,
      endObjectInteraction,
      inputMode,
      patchSceneElements,
    ],
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
      const sceneElement = findSceneElementAtPoint(boardRef.current, point);
      if (sceneElement && !sceneElement.legacyStrokeId) {
        event.preventDefault();
        selectSceneElements([sceneElement.id], sceneElement.id);
        setEditingElementId(sceneElement.id);
        return;
      }
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
    [inputMode, selectSceneElements],
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

  const activateCreationTool = useCallback(
    (tool: CreationToolId) => {
      if (isScenePlacementTool(tool)) {
        activateObjectTool(scenePlacementPreviewTool(tool));
        setActiveCreationTool(tool);
        activeCreationToolRef.current = tool;
        return;
      }
      if (tool === "draw:eraser") {
        activateObjectTool("eraser");
        setActiveCreationTool(tool);
        activeCreationToolRef.current = tool;
        return;
      }

      activateObjectTool("select");
      setActiveCreationTool(tool);
      activeCreationToolRef.current = tool;
      setCommandFeedback(
        `${creationToolLabel(tool)} ready. Click the board to place it, or drag it from the shape library.`,
      );
    },
    [activateObjectTool],
  );

  useEffect(() => {
    const legacyTool = legacyToolForCreationTool(activeCreationTool);
    if (
      activeObjectTool === "select" &&
      isScenePlacementTool(activeCreationTool) &&
      legacyTool &&
      legacyTool !== "select" &&
      activeCreationTool !== "hand"
    ) {
      setActiveCreationTool("move");
    }
  }, [activeCreationTool, activeObjectTool]);

  useEffect(() => {
    const handleCreationShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !shortcutsActiveRef.current ||
        event.repeat ||
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      const tool = resolveCreationShortcut(event);
      if (!tool) return;
      event.preventDefault();
      setOpenCatalogId(null);
      activateCreationTool(tool);
    };
    window.addEventListener("keydown", handleCreationShortcut);
    return () => window.removeEventListener("keydown", handleCreationShortcut);
  }, [activateCreationTool]);

  // Catalog drag-and-drop: dropping a shape thumbnail commits a default-size
  // object at the drop point, reusing the placement pipeline (snap included).
  const handleCatalogDrop = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>) => {
      const creationTool = event.dataTransfer.getData(CREATION_DRAG_MIME) as CreationToolId;
      const tool = event.dataTransfer.getData(CATALOG_DRAG_MIME) as ObjectDockTool;
      if ((!tool || !isPlacementTool(tool)) && !creationTool) {
        return;
      }
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setOpenCatalogId(null);
      const boardPoint = toBoardPoint({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (creationTool) {
        if (creationTool === "insert:media") {
          requestMediaAtPoint(boardPoint);
          return;
        }
        if (creationTool === "insert:link") {
          void insertLinkAtPoint(boardPoint);
          return;
        }
        const created = createSceneElementAtPoint(creationTool, boardPoint);
        if (created) return;
        activateCreationTool(creationTool);
        setCommandFeedback(
          `${creationToolLabel(creationTool)} armed at the drop point. Click to place it.`,
        );
        return;
      }
      commitPlacementObject(
        tool,
        boardPoint,
      );
    },
    [
      activateCreationTool,
      commitPlacementObject,
      createSceneElementAtPoint,
      insertLinkAtPoint,
      requestMediaAtPoint,
      toBoardPoint,
    ],
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
              <button
                type="button"
                className={`toolbar-button${airoInputsActive ? " active" : ""}`}
                disabled={cameraStatus === "starting" || cameraStatus === "tracker_loading"}
                aria-label={
                  airoInputsActive
                    ? "Turn off Airo voice and hand tracking"
                    : "Enable Airo voice and hand tracking"
                }
                onClick={toggleAiroInputs}
              >
                <span aria-hidden="true">✦</span>
                <span>Airo</span>
              </button>
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
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        undoLastAction("button");
                        setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">↶</span>
                      Undo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        redoLastSceneAction();
                        setMoreMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">↷</span>
                      Redo
                    </button>
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
                    <Link
                      href="/help/using-the-board/commands"
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={() => setMoreMenuOpen(false)}
                    >
                      <span aria-hidden="true">?</span>
                      Help center
                    </Link>
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
                  </div>
                ) : null}
              </div>
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
              <button type="button" onClick={() => undoLastAction("button")}>Undo</button>
              <button type="button" onClick={redoLastSceneAction}>Redo</button>
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
                  <span><strong>Undo:</strong> toolbar, Cmd/Ctrl+Z, or say “Airo, undo”</span>
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
                <button type="button" onClick={() => undoLastAction("button")}>Undo</button>
                <button type="button" onClick={redoLastSceneAction}>Redo</button>
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
          {!broadcastSafe ? (
            <SceneContextToolbar
              selected={selectedSceneElement}
              onPatch={(patches) => {
                if (selectedElementId) patchSceneElement(selectedElementId, patches);
              }}
              onDelete={() => {
                if (selectedElementId) deleteSceneElement(selectedElementId);
              }}
              onDuplicate={() => {
                if (selectedElementId) duplicateSceneElement(selectedElementId);
              }}
              onCopySectionLink={copySectionLink}
              onDeleteSectionWithContents={deleteSectionWithContents}
              onMediaReplace={requestMediaReplacement}
              onMediaPlaybackChange={setMediaPlayback}
              onWashiPatternReplace={requestWashiPatternReplacement}
              onQuickCreate={quickCreateSceneElement}
              onMindMapAddChild={addMindMapChild}
              onMindMapAddSibling={addMindMapSibling}
              onMindMapAttachSelection={attachMindMapSelection}
            />
          ) : null}
          {inputMode === "gesture" ? (
            <>
              <CreationToolbar
                dockRef={dockRef}
                activeTool={temporaryHandActive ? "hand" : activeCreationTool}
                openPanel={openCatalogId}
                gestureHover={dockGestureHover}
                onOpenPanelChange={setOpenCatalogId}
                onToolSelect={activateCreationTool}
                onStampSelect={(emoji) => {
                  setSelectedStampEmoji(emoji);
                  setCommandFeedback(`${emoji} stamp ready. Click the board to place it.`);
                }}
                onTableSizeSelect={(rows, columns) => {
                  pendingTableSizeRef.current = { rows, columns };
                  activateCreationTool("table");
                  setOpenCatalogId(null);
                  setCommandFeedback(`${rows} × ${columns} table ready. Click the board to place it.`);
                }}
              />
              <input
                ref={mediaInputRef}
                className="sr-only"
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                accept=".png,.jpg,.jpeg,.heic,.heif,.tif,.tiff,.webp,.gif,.mp4,.mov,.webm,image/png,image/jpeg,image/heic,image/heif,image/tiff,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                onChange={(event) => {
                  void handleMediaFileSelected(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={washiPatternInputRef}
                className="sr-only"
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                onChange={(event) => {
                  void handleWashiPatternSelected(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
            </>
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
                    Everything applies instantly. Use the toolbar, Cmd/Ctrl+Z, or say
                    “Airo, undo”; the Airo panel shows each board action.
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
            } ${activeCreationTool === "hand" || temporaryHandActive ? "hand-mode" : ""}`}
            tabIndex={0}
            onContextMenu={(event) => event.preventDefault()}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(CATALOG_DRAG_MIME) ||
                event.dataTransfer.types.includes(CREATION_DRAG_MIME)
              ) {
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
          {!broadcastSafe ? (
            <div className="scene-playback-layer">
              <ScenePlaybackOverlay
                selected={selectedSceneElement}
                {...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {})}
                viewport={playbackViewport}
              />
            </div>
          ) : null}
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
                    cameraOverlayState.verification.framesComposited > 0 &&
                    cameraOverlayState.verification.lastCompositeAt > 0 &&
                    cameraOverlayState.verification.lastVerifiedAt > 0 &&
                    cameraOverlayState.verification.framesEncoded > 0 &&
                    cameraOverlayState.verification.bytesSent > 0
                      ? "Verified in this Meet client: the composited camera track is attached to Meet and encoding outbound video."
                      : cameraOverlayState.verification
                        ? "The compositor is engaged. Waiting for Meet to attach and encode its output track…"
                        : "The compositor is engaged. Reload the current extension for real outbound-track verification."}
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
                  gestureActionEvidenceTrackerRef.current?.reset();
                  setViewportScale(1);
                  setViewportRevision((revision) => revision + 1);
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
                        ? "Start Airo once. Hold an open palm still for 0.4 seconds to speak. Use a relaxed hand to aim and a closed hand to move."
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
                        onChange={(event) => {
                          const nextConfidence = Number(event.target.value);
                          setConfidenceThreshold(nextConfidence);
                          if (cameraStatus === "active") {
                            pendingCameraConfidenceRestartRef.current = true;
                            stopCamera();
                          }
                        }}
                      />
                    </div>
                    <p className="hint">
                      This controls HandLandmarker detection, presence, and tracking thresholds.
                      An active camera restarts so the new threshold takes effect immediately.
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
                  ? "Use the Gesture guide above for exact poses. A held open palm activates voice. A relaxed hand aims, a closed hand moves, and thumb-middle snaps hide or restore the diagram. Use Cmd/Ctrl+Z or the toolbar to undo."
                  : "Use the Gesture guide above for exact poses. A relaxed hand aims, a closed hand moves, and thumb-middle snaps hide or restore the diagram. Use Cmd/Ctrl+Z or the toolbar to undo."}
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

function appendBoundedBoardEvents(
  journal: BoardEvent[],
  events: readonly BoardEvent[],
  maxEvents = 2_000,
): void {
  journal.push(...events.map((event) => structuredClone(event)));
  if (journal.length > maxEvents) {
    journal.splice(0, journal.length - maxEvents);
  }
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

function isScenePlacementTool(tool: CreationToolId): boolean {
  return (
    tool === "sticky" ||
    tool.startsWith("shape:") ||
    tool.startsWith("connector:") ||
    tool === "text" ||
    tool === "section" ||
    tool === "table" ||
    tool === "stamp" ||
    tool === "insert:face-stamp" ||
    tool === "insert:code-block" ||
    tool === "insert:mind-map"
  );
}

function scenePlacementPreviewTool(tool: CreationToolId): ObjectDockTool {
  const legacyTool = legacyToolForCreationTool(tool) as ObjectDockTool | null;
  if (legacyTool && isPlacementTool(legacyTool)) return legacyTool;
  if (tool === "connector:straight") return "arrow";
  if (tool.startsWith("connector:")) return "connector";
  if (tool === "stamp" || tool === "insert:face-stamp") return "circle";
  return "box";
}

function sceneElementKindLabel(kind: BoardSceneElement["kind"]): string {
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

function strokePointBounds(
  points: readonly Pick<StrokePoint, "x" | "y">[],
  padding = 0,
): { x: number; y: number; width: number; height: number } {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

function drawingElementIntersectsCircle(
  element: Extract<BoardSceneElement, { kind: "drawing" }>,
  center: AnnotationPoint,
  radius: number,
): boolean {
  const hitRadius = radius + element.style.thickness / 2;
  if (element.points.length === 1) {
    const point = element.points[0]!;
    return Math.hypot(point.x - center.x, point.y - center.y) <= hitRadius;
  }
  for (let index = 1; index < element.points.length; index += 1) {
    const start = element.points[index - 1];
    const end = element.points[index];
    if (start && end && pointToSegmentDistance(center, start, end) <= hitRadius) return true;
  }
  return false;
}

function pointToSegmentDistance(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
}

function decodeCanvasImage(source: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const abort = () => {
      image.src = "";
      reject(new DOMException("Image loading aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", abort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("BOARD_ASSET_IMAGE_DECODE_FAILED"));
    };
    image.src = source;
  });
}

function translateSceneElement(
  source: BoardSceneElement,
  dx: number,
  dy: number,
): BoardSceneElement {
  const element = structuredClone(source);
  element.transform.x += dx;
  element.transform.y += dy;
  if (element.kind === "connector") {
    element.start.point.x += dx;
    element.start.point.y += dy;
    element.end.point.x += dx;
    element.end.point.y += dy;
    element.controlPoints = element.controlPoints.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
  if (element.kind === "drawing") {
    element.points = element.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
  return element;
}

function sceneSectionMembers(
  state: BoardState,
  section: Extract<BoardSceneElement, { kind: "section" }>,
): BoardSceneElement[] {
  const memberIds = new Set<string>();
  const pendingSections = [section.id];
  const visitedSections = new Set<string>();
  while (pendingSections.length > 0) {
    const sectionId = pendingSections.shift()!;
    if (visitedSections.has(sectionId)) continue;
    visitedSections.add(sectionId);
    const current = state.elements[sectionId];
    if (current?.kind === "section") {
      for (const memberId of current.memberIds) memberIds.add(memberId);
    }
    for (const element of Object.values(state.elements)) {
      if (element.sectionId === sectionId) memberIds.add(element.id);
    }
    for (const memberId of memberIds) {
      if (state.elements[memberId]?.kind === "section" && !visitedSections.has(memberId)) {
        pendingSections.push(memberId);
      }
    }
  }
  memberIds.delete(section.id);
  return [...memberIds].flatMap((id) => {
    const element = state.elements[id];
    return element?.status === "active" ? [element] : [];
  });
}

function buildSceneMovePreview(
  movement: SceneMoveSnapshot,
  dx: number,
  dy: number,
  baseElements: Readonly<Record<string, BoardSceneElement>>,
): Record<string, BoardSceneElement> {
  const elements = { ...baseElements };
  for (const original of [movement.element, ...movement.relatedElements, ...movement.boundConnectors]) {
    elements[original.id] = structuredClone(original);
  }
  for (const original of [movement.element, ...movement.relatedElements]) {
    elements[original.id] = translateSceneElement(original, dx, dy);
  }
  for (const connector of movement.boundConnectors) {
    elements[connector.id] = rebindSceneConnector(connector, elements);
  }
  return elements;
}

function buildUniformSceneMoveChanges(
  state: BoardState,
  roots: readonly BoardSceneElement[],
  dx: number,
  dy: number,
): { elementId: string; patches: BoardElementPatchOperation[] }[] {
  const moving = new Map<string, BoardSceneElement>();
  const enqueue = (element: BoardSceneElement) => {
    if (element.status === "active" && !moving.has(element.id)) moving.set(element.id, element);
  };
  roots.forEach(enqueue);
  for (const root of roots) {
    if (root.kind === "section") sceneSectionMembers(state, root).forEach(enqueue);
  }
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const candidate of Object.values(state.elements)) {
      if (candidate.status !== "active" || moving.has(candidate.id) || !candidate.attachment) continue;
      const follows = candidate.attachment.kind === "element"
        ? moving.has(candidate.attachment.elementId)
        : moving.has(candidate.attachment.tableId);
      if (follows) {
        enqueue(candidate);
        discovered = true;
      }
    }
  }
  const previewElements = { ...state.elements };
  for (const element of moving.values()) {
    previewElements[element.id] = translateSceneElement(element, dx, dy);
  }
  const boundConnectors = Object.values(state.elements).filter(
    (candidate): candidate is Extract<BoardSceneElement, { kind: "connector" }> =>
      candidate.kind === "connector" &&
      candidate.status === "active" &&
      !moving.has(candidate.id) &&
      Boolean(
        (candidate.start.binding && moving.has(candidate.start.binding.elementId)) ||
        (candidate.end.binding && moving.has(candidate.end.binding.elementId)),
      ),
  );
  for (const connector of boundConnectors) {
    previewElements[connector.id] = rebindSceneConnector(connector, previewElements);
  }
  const changes = [...moving.values()].map((element) => ({
    elementId: element.id,
    patches: sceneElementMovePatches(element, dx, dy),
  }));
  for (const connector of boundConnectors) {
    const rebound = previewElements[connector.id];
    if (rebound?.kind === "connector") {
      changes.push({ elementId: connector.id, patches: connectorGeometryPatches(rebound) });
    }
  }
  for (const root of roots) {
    if (root.kind === "section") continue;
    const moved = previewElements[root.id];
    if (moved) appendSectionContainmentChanges(state, root, moved, changes);
  }
  return changes;
}

function rebindSceneConnector(
  source: Extract<BoardSceneElement, { kind: "connector" }>,
  elements: Readonly<Record<string, BoardSceneElement>>,
): Extract<BoardSceneElement, { kind: "connector" }> {
  const connector = structuredClone(source);
  if (connector.start.binding) {
    const target = elements[connector.start.binding.elementId];
    if (target?.status === "active") {
      const previous = connector.start.point;
      const next = connectorAnchorPoint(target, connector.start.binding.anchor, connector.end.point);
      connector.start.point = next;
      if (connector.controlPoints[0]) {
        connector.controlPoints[0] = {
          x: connector.controlPoints[0].x + next.x - previous.x,
          y: connector.controlPoints[0].y + next.y - previous.y,
        };
      }
    }
  }
  if (connector.end.binding) {
    const target = elements[connector.end.binding.elementId];
    if (target?.status === "active") {
      const previous = connector.end.point;
      const next = connectorAnchorPoint(target, connector.end.binding.anchor, connector.start.point);
      connector.end.point = next;
      const lastIndex = connector.controlPoints.length - 1;
      if (lastIndex >= 0 && connector.controlPoints[lastIndex]) {
        connector.controlPoints[lastIndex] = {
          x: connector.controlPoints[lastIndex]!.x + next.x - previous.x,
          y: connector.controlPoints[lastIndex]!.y + next.y - previous.y,
        };
      }
    }
  }
  const points = [connector.start.point, ...connector.controlPoints, connector.end.point];
  const bounds = strokePointBounds(points);
  connector.transform = { ...bounds, rotation: 0 };
  return connector;
}

function connectorAnchorPoint(
  element: BoardSceneElement,
  anchor: "top" | "right" | "bottom" | "left" | "center" | "auto" | undefined,
  toward: AnnotationPoint,
): AnnotationPoint {
  const center = elementCenter(element);
  const { x, y, width, height } = element.transform;
  if (anchor === "top") return { x: center.x, y };
  if (anchor === "right") return { x: x + width, y: center.y };
  if (anchor === "bottom") return { x: center.x, y: y + height };
  if (anchor === "left") return { x, y: center.y };
  if (anchor === "center") return center;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const halfWidth = Math.max(0.5, width / 2);
  const halfHeight = Math.max(0.5, height / 2);
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function connectorGeometryPatches(
  connector: Extract<BoardSceneElement, { kind: "connector" }>,
): BoardElementPatchOperation[] {
  return [
    { op: "field.set", path: ["transform"], value: connector.transform },
    { op: "field.set", path: ["start", "point"], value: connector.start.point },
    { op: "field.set", path: ["end", "point"], value: connector.end.point },
    { op: "field.set", path: ["controlPoints"], value: connector.controlPoints },
  ];
}

function appendSectionContainmentChanges(
  state: BoardState,
  original: BoardSceneElement,
  moved: BoardSceneElement,
  changes: { elementId: string; patches: BoardElementPatchOperation[] }[],
): void {
  const nextSection = Object.values(state.elements)
    .filter(
      (candidate): candidate is Extract<BoardSceneElement, { kind: "section" }> =>
        candidate.kind === "section" &&
        candidate.status === "active" &&
        candidate.visible &&
        candidate.id !== moved.id &&
        sceneElementFitsInside(moved, candidate),
    )
    .sort((a, b) => b.zIndex - a.zIndex)[0];
  const previousSection = original.sectionId
    ? state.elements[original.sectionId]
    : null;
  const previousSectionId = previousSection?.kind === "section" ? previousSection.id : undefined;
  if (previousSectionId === nextSection?.id) return;

  const movedChange = changes.find(({ elementId }) => elementId === moved.id);
  const membershipPatch: BoardElementPatchOperation = nextSection
    ? { op: "field.set", path: ["sectionId"], value: nextSection.id }
    : { op: "field.unset", path: ["sectionId"] };
  if (movedChange) movedChange.patches.push(membershipPatch);
  else changes.push({ elementId: moved.id, patches: [membershipPatch] });

  if (previousSection?.kind === "section") {
    changes.push({
      elementId: previousSection.id,
      patches: [{
        op: "field.set",
        path: ["memberIds"],
        value: previousSection.memberIds.filter((id) => id !== moved.id),
      }],
    });
  }
  if (nextSection) {
    changes.push({
      elementId: nextSection.id,
      patches: [{
        op: "field.set",
        path: ["memberIds"],
        value: [...new Set([...nextSection.memberIds, moved.id])],
      }],
    });
  }
}

function sceneElementFitsInside(
  element: BoardSceneElement,
  section: Extract<BoardSceneElement, { kind: "section" }>,
): boolean {
  const outer = section.transform;
  const inner = element.transform;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function tableCellIdAtPoint(
  table: Extract<BoardSceneElement, { kind: "table" }>,
  point: AnnotationPoint,
): string | null {
  const relativeX = (point.x - table.transform.x) / Math.max(1, table.transform.width);
  const relativeY = (point.y - table.transform.y) / Math.max(1, table.transform.height);
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return null;
  const totalWidth = table.columns.reduce((sum, column) => sum + Math.max(1, column.width), 0);
  const totalHeight = table.rows.reduce((sum, row) => sum + Math.max(1, row.height), 0);
  const targetX = relativeX * totalWidth;
  const targetY = relativeY * totalHeight;
  let width = 0;
  const column = table.columns.find((candidate) => {
    width += Math.max(1, candidate.width);
    return targetX <= width;
  });
  let height = 0;
  const row = table.rows.find((candidate) => {
    height += Math.max(1, candidate.height);
    return targetY <= height;
  });
  if (!row || !column) return null;
  return Object.values(table.cells).find(
    (cell) => cell.rowId === row.id && cell.columnId === column.id,
  )?.id ?? null;
}

function resolveSceneIntentTargetIds(
  state: BoardState,
  target: { kind: "selection" } | { kind: "visible_label"; label: string },
  selectionIds: readonly string[],
): string[] {
  if (target.kind === "selection") {
    return selectionIds.filter((id) => state.elements[id]?.status === "active");
  }
  const requested = normalizeSceneReference(target.label);
  return Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      sceneElementVisibleForIntent(state, element) &&
      !element.legacyStrokeId &&
      sceneElementReferenceLabels(element).some(
        (label) => normalizeSceneReference(label) === requested,
      ),
    )
    .sort((a, b) => b.zIndex - a.zIndex)
    .map(({ id }) => id);
}

function sceneElementVisibleForIntent(
  state: BoardState,
  element: BoardSceneElement,
): boolean {
  if (!element.visible) return false;
  const parent = element.sectionId ? state.elements[element.sectionId] : null;
  return !(
    parent?.kind === "section" &&
    parent.status === "active" &&
    (!parent.visible || parent.collapsed)
  );
}

function sceneElementReferenceLabels(element: BoardSceneElement): string[] {
  const plain = sceneElementPlainLabel(element).trim();
  if (element.kind === "shape") {
    const catalog = shapeCatalogEntry(element.shapeKind);
    return [plain, catalog.name, catalog.kind, ...catalog.aliases].filter(Boolean);
  }
  return [plain || sceneElementKindLabel(element.kind)];
}

function sceneElementLockedForMutation(
  state: BoardState,
  element: BoardSceneElement,
): boolean {
  if (element.locked) return true;
  if (element.kind === "section" && element.lockMode !== "none") return true;
  const parent = element.sectionId ? state.elements[element.sectionId] : null;
  return Boolean(
    parent?.kind === "section" &&
    parent.status === "active" &&
    parent.lockMode === "all",
  );
}

function sceneElementReferenceLabel(element: BoardSceneElement): string {
  return sceneElementReferenceLabels(element)[0] || sceneElementKindLabel(element.kind);
}

function normalizeSceneReference(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(?:(?:the|a|an|another)\s+)+/, "")
    .replace(/\b(?:dataset|datasets)\b/g, "data")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSceneFanInContext(state: BoardState, selectionIds: readonly string[]) {
  const selectedSet = new Set(selectionIds);
  const elements = Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      sceneElementVisibleForIntent(state, element) &&
      !element.legacyStrokeId &&
      element.kind !== "connector" &&
      element.kind !== "drawing",
    )
    .sort((left, right) => left.zIndex - right.zIndex);
  const ordinals = new Map<string, number>();
  const objects = elements.map((element) => {
    const nodeType = element.kind === "shape" ? element.shapeKind : element.kind;
    const ordinal = (ordinals.get(nodeType) ?? 0) + 1;
    ordinals.set(nodeType, ordinal);
    return {
      label: sceneElementReferenceLabel(element),
      nodeType,
      ordinal,
    };
  });
  const labelsById = new Map(elements.map((element) => [element.id, sceneElementReferenceLabel(element)]));
  const edges = Object.values(state.elements).flatMap((element) => {
    if (
      element.kind !== "connector" ||
      element.status !== "active" ||
      !sceneElementVisibleForIntent(state, element) ||
      element.legacyStrokeId ||
      !element.start.binding ||
      !element.end.binding
    ) return [];
    const from = labelsById.get(element.start.binding.elementId);
    const to = labelsById.get(element.end.binding.elementId);
    if (!from || !to) return [];
    const label = richTextToPlainText(element.label).trim();
    return [{ from: { label: from }, to: { label: to }, ...(label ? { label } : {}) }];
  });
  const selected = elements
    .filter((element) => selectedSet.has(element.id))
    .map((element) => {
      const object = objects[elements.indexOf(element)];
      return object!;
    });
  return {
    selectionCount: selected.length,
    selected,
    objects,
    edges,
  };
}

function sceneIntentPlacementPoint(
  target: BoardSceneElement,
  direction: "left" | "right" | "up" | "down",
): AnnotationPoint {
  const center = elementCenter(target);
  const horizontal = target.transform.width / 2 + 180;
  const vertical = target.transform.height / 2 + 130;
  return {
    x: center.x + (direction === "left" ? -horizontal : direction === "right" ? horizontal : 0),
    y: center.y + (direction === "up" ? -vertical : direction === "down" ? vertical : 0),
  };
}

function sceneIntentFeedback(intent: Exclude<BoardSceneIntent, { type: "invalid" }>): string {
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
  }
}

function sceneElementPlainLabel(element: BoardSceneElement): string {
  switch (element.kind) {
    case "sticky":
    case "shape":
    case "text":
    case "mind_map_node":
      return richTextToPlainText(element.content);
    case "connector":
      return richTextToPlainText(element.label);
    case "section":
      return richTextToPlainText(element.title);
    case "table":
      return Object.values(element.cells).map((cell) => richTextToPlainText(cell.content)).find(Boolean) ?? "Table";
    case "stamp":
      return element.label ?? element.emoji;
    case "media":
      return element.altText || element.asset.fileName || "Media";
    case "link_preview":
      return element.title ?? element.url;
    case "code_block":
      return element.code.split("\n", 1)[0] ?? "Code block";
    case "drawing":
      return element.drawingKind;
  }
}

function sceneElementRenamePatches(
  element: BoardSceneElement,
  label: string,
): BoardElementPatchOperation[] {
  switch (element.kind) {
    case "sticky":
    case "shape":
    case "text":
    case "mind_map_node":
      return [{ op: "field.set", path: ["content"], value: createRichTextDocument(label) }];
    case "connector":
      return [{ op: "field.set", path: ["label"], value: createRichTextDocument(label) }];
    case "section":
      return [{ op: "field.set", path: ["title"], value: createRichTextDocument(label) }];
    case "table": {
      const cell = Object.values(element.cells)[0];
      return cell
        ? [{ op: "table.cell.patched", cellId: cell.id, patch: { content: createRichTextDocument(label) } }]
        : [];
    }
    case "stamp":
      return [{ op: "field.set", path: ["label"], value: label }];
    case "media":
      return [{ op: "field.set", path: ["altText"], value: label }];
    case "link_preview":
      return [{ op: "field.set", path: ["title"], value: label }];
    case "code_block":
      return [{ op: "field.set", path: ["code"], value: label }];
    case "drawing":
      return [{ op: "field.set", path: ["metadata", "label"], value: label }];
  }
}

function sceneElementMovePatches(
  element: BoardSceneElement,
  dx: number,
  dy: number,
): BoardElementPatchOperation[] {
  const moved = translateSceneElement(element, dx, dy);
  const patches: BoardElementPatchOperation[] = [
    { op: "field.set", path: ["transform", "x"], value: moved.transform.x },
    { op: "field.set", path: ["transform", "y"], value: moved.transform.y },
  ];
  if (moved.kind === "connector") {
    patches.push(
      { op: "field.set", path: ["start", "point"], value: moved.start.point },
      { op: "field.set", path: ["end", "point"], value: moved.end.point },
      { op: "field.set", path: ["controlPoints"], value: moved.controlPoints },
    );
  }
  if (moved.kind === "drawing") {
    patches.push({ op: "field.set", path: ["points"], value: moved.points });
  }
  return patches;
}

function sceneElementColorPatches(
  element: BoardSceneElement,
  color: string,
): BoardElementPatchOperation[] {
  switch (element.kind) {
    case "drawing":
    case "connector":
      return [{ op: "field.set", path: ["style", "color"], value: color }];
    case "sticky":
      return [{ op: "field.set", path: ["color"], value: color }];
    case "shape":
    case "section":
      return [{ op: "field.set", path: ["style", "fill"], value: color }];
    case "text":
      return [{ op: "field.set", path: ["style", "color"], value: color }];
    case "mind_map_node":
      return [{ op: "field.set", path: ["style", "fill"], value: color }];
    case "table":
      return Object.values(element.cells).map((cell) => ({
        op: "table.cell.patched" as const,
        cellId: cell.id,
        patch: { style: { ...cell.style, fill: color } },
      }));
    default:
      return [{ op: "field.set", path: ["metadata", "accentColor"], value: color }];
  }
}

function elementCenter(element: BoardSceneElement): AnnotationPoint {
  if (element.kind === "connector") {
    return {
      x: (element.start.point.x + element.end.point.x) / 2,
      y: (element.start.point.y + element.end.point.y) / 2,
    };
  }
  return {
    x: element.transform.x + element.transform.width / 2,
    y: element.transform.y + element.transform.height / 2,
  };
}

function boundsBetween(
  start: AnnotationPoint,
  end: AnnotationPoint,
): BoardSceneElement["transform"] {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
    rotation: 0,
  };
}

function sceneElementUnionBounds(
  elements: readonly BoardSceneElement[],
  padding = 0,
): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...elements.map((element) => element.transform.x));
  const top = Math.min(...elements.map((element) => element.transform.y));
  const right = Math.max(...elements.map((element) => element.transform.x + element.transform.width));
  const bottom = Math.max(...elements.map((element) => element.transform.y + element.transform.height));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

function layoutSceneElements(
  elements: readonly BoardSceneElement[],
  direction: Extract<BoardSceneIntent, { type: "layout" }>["direction"],
): Map<string, AnnotationPoint> {
  const ordered = [...elements].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const originX = Math.min(...ordered.map((element) => element.transform.x));
  const originY = Math.min(...ordered.map((element) => element.transform.y));
  const gap = 48;
  const positions = new Map<string, AnnotationPoint>();
  const columns = direction === "grid" ? Math.max(1, Math.ceil(Math.sqrt(ordered.length))) : ordered.length;
  let horizontalCursor = originX;
  let verticalCursor = originY;
  ordered.forEach((element, index) => {
    if (direction === "grid") {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const maxWidth = Math.max(...ordered.map((candidate) => candidate.transform.width));
      const maxHeight = Math.max(...ordered.map((candidate) => candidate.transform.height));
      positions.set(element.id, { x: originX + column * (maxWidth + gap), y: originY + row * (maxHeight + gap) });
      return;
    }
    if (direction === "left_to_right" || direction === "right_to_left") {
      positions.set(element.id, { x: horizontalCursor, y: originY });
      horizontalCursor += element.transform.width + gap;
    } else {
      positions.set(element.id, { x: originX, y: verticalCursor });
      verticalCursor += element.transform.height + gap;
    }
  });
  if (direction === "right_to_left" || direction === "bottom_to_top") {
    const values = [...positions.values()].reverse();
    ordered.forEach((element, index) => positions.set(element.id, values[index]!));
  }
  return positions;
}

function mindMapDirectionOffset(
  direction: Extract<BoardSceneElement, { kind: "mind_map_node" }>["relation"]["direction"],
  transform: BoardSceneElement["transform"],
): AnnotationPoint {
  const horizontal = transform.width + 120;
  const vertical = transform.height + 96;
  if (direction === "left") return { x: -horizontal, y: 0 };
  if (direction === "up") return { x: 0, y: -vertical };
  if (direction === "down") return { x: 0, y: vertical };
  return { x: horizontal, y: 0 };
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
