"use client";

import {
  applyDiagramCommand,
  applyDiagramUndo,
  applyBoardEvent,
  boardPreview,
  createBoardSceneElement,
  isSceneOnlyElement,
  createEraseAction,
  createEventEnvelope,
  createInitialBoardState,
  createRichTextDocument,
  createStroke,
  invertBoardElementPatches,
  isCompoundBoardCommand,
  parseBoardSceneIntent,
  type AnnotationPoint,
  type BoardElementPatchOperation,
  type BoardEvent,
  type BoardSceneElement,
  type BoardSceneIntent,
  type SceneIntentTarget,
  type BoardState,
  type SceneIntentPlacementDirection,
  type CodeLanguage,
  type CursorState,
  type DiagramCommand,
  type SemanticPlan,
  type StrokeAnnotation,
  type StrokePoint,
} from "@airboard/core";
import { classifyBrowserWakeTranscript } from "./browserSpeech";
import {
  allowsSemanticFallbackAfterGroundingFailure,
  boardContentChanged,
  buildSemanticIntentContext,
  describeSemanticPlan,
  resolveIntentOperation,
  groundSemanticPlan,
} from "./intentPipeline";
import { commitCommandTurn, diagramRedoEvents } from "./commandTurnCoordinator";
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
  boundsFitViewport,
  fitViewportToBounds,
  unobscuredCanvasCenter,
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
  type GestureTraceStage,
} from "./gestureFrameCoordinator";
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
  SCREEN_PRESENTATION_SCRIM,
  screenFriendlyScrim,
} from "./lightboardComposition";
import { CreationToolbar } from "./CreationToolbar";
import { SceneContextToolbar } from "./SceneContextToolbar";
import {
  replaceRichTextPlainValue,
  richTextPlainValue,
  stickyHeightForText,
} from "./sceneContextToolbarHelpers";
import { SceneTextEditor } from "./SceneTextEditor";
import { AiroPanel } from "./ui/AiroPanel";
import { BoardNotices } from "./ui/BoardNotices";
import { BoardSettingsDrawer } from "./ui/BoardSettingsDrawer";
import { BoardTopBar } from "./ui/BoardTopBar";
import { CanvasHistoryControls } from "./ui/CanvasHistoryControls";
import { DeleteBoardDialog } from "./ui/DeleteBoardDialog";
import { ShareDialog, type BoardShareAccess, type LiveLinkControls } from "./ShareDialog";
import { forgetLiveSession, liveBoardLink, liveStartFailure, rememberedLiveSession, rememberLiveSession, type LiveStartFailure } from "./shareLinks";
import { ScenePlaybackOverlay } from "./ScenePlaybackOverlay";
import {
  ALL_SHAPES,
  CREATION_DRAG_MIME,
  creationToolForPlacementTool,
  creationToolLabel,
  legacyToolForCreationTool,
  resolveCreationShortcut,
  type CreationToolId,
  type LegacyPlacementTool,
} from "./creationToolCatalog";
import {
  centeredTransform,
  createSceneElementForTool,
  type SceneCreationOptions,
} from "./sceneCreation.ts";
import {
  linkPreviewFields,
  loadBoardAssetObjectUrl,
  resolveBoardLink,
  uploadBoardAsset,
} from "./boardContentClient.ts";
import { validateBoardTitle } from "./boardLifecycle";
import { HoldToEditTracker } from "./holdToEditTracker";
import { LooseGrabHold, selectLandmarkManipulationSignal } from "./landmarkManipulationInput";
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
  VoiceCommandCoalescer,
  VoiceCommandRouter,
  type VoiceGateMode,
  type VoiceRouteDecision,
} from "./voiceCommandRouter";
import { airoSoundsEnabled, playAiroCue } from "./airoCues";
import {
  createRealtimeSpeechSession,
  fetchRealtimeTranscriptionConfig,
  supportsRealtimeSpeech,
  type RealtimeSpeechReconnectCause,
  type RealtimeSpeechSession,
  type RealtimeTranscriptionConfig,
} from "./realtimeSpeech";
import { buildSessionKeyterms } from "./voiceSessionKeyterms";
import {
  loadSemanticIntentConfigWithRetry,
  resolveSemanticIntent,
  semanticIntentIssueMessage,
  shouldUseSemanticIntentFallback,
  type SemanticIntentConfig,
  type SemanticIntentAddressedBy,
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
import { useMenuKeyboard } from "../../platform/menuKeyboard";
import { useModalFocus } from "../../platform/modalFocus";
import { copyCanvasImage, downloadCanvasPdf } from "./boardExport";
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
  buildGestureMoveTargets,
  gestureTargetWorld,
  resolveHandConnectorEnds,
  resolveResizeHandleForInput,
} from "./gestureObjectManipulation";
import {
  HandDwellSelectTracker,
  HandPointingRecorder,
  resolveHandPointing,
  type HandPointingSnapshot,
} from "./handPointing";
import {
  CAMERA_RECOVERY_MAX_ATTEMPTS,
  CAMERA_RECOVERY_STABLE_MS,
  cameraRecoveryDelayMs,
  shouldRetryCameraStart,
  type CameraRecoveryReason,
} from "./cameraRecovery";
import {
  parseIntentCanvasCommand,
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
  airoStartPlan,
  queryMediaPermission,
  requestMediaAccess,
  type MediaPermissionState,
} from "./mediaPermissionPreference";
import {
  AIRBOARD_API_URL,
  AIRO_NOTICE_VISIBLE_MS,
  AIRO_QUESTION_VISIBLE_MS,
  BOARD_SESSION_ID,
  BOARD_TEXT_LIST_LIMIT,
  CAMERA_PROMPT_HINT,
  CAMERA_PROMPT_HINT_DELAY_MS,
  CATALOG_DROP_EXIT_PX,
  CATALOG_DROP_MIN_TRAVEL_PX,
  CLARIFICATION_ANSWER_MS,
  DEICTIC_REFERENCE_PATTERN,
  ERASER_RADIUS,
  EXPORTS_BLOCKED_MESSAGE,
  HAND_CUE_MS,
  HAND_SCENE_POINTER_ID,
  MAX_CLARIFICATION_TRANSCRIPT_CHARS,
  MAX_PLAN_BOARD_CHANGES,
  OBJECT_GESTURE_GRAB_THRESHOLD,
  OBJECT_GESTURE_RELEASE_THRESHOLD,
  OWNER_USER_ID,
  PARTICIPANT_ID,
  SPEECH_POINTING_MAX_AGE_MS,
  UNDO_TOAST_VISIBLE_MS,
  VOICE_QUIET_PAUSE_MS,
  type ActiveSpeechSession,
  type CameraStatus,
  type CopilotActivityEntry,
  type DockGestureOutcome,
  type IntentPreparationOutcome,
  type ObjectGestureState,
  type ObjectInteraction,
  type PendingIntent,
  type PendingSemanticClarification,
  type PrepareIntentCommandResult,
  type RawLandmarkFrameOutcome,
  type RawLandmarkFrameRequest,
  type SceneIntentExecutionResult,
  type SceneMoveSnapshot,
  type ScreenUnderlayStatus,
  type SemanticExecutionSnapshot,
  type SpeechEngine,
  type SpeechPointing,
  type SpeechRecognitionStatus,
  type VoiceCommandTraceContext,
  type VoiceDecisionMetadata,
  type VoiceGateUi,
  type VoiceReference,
} from "./engine/boardTypes";
import {
  appendBoundedBoardEvents,
  diagramCommandContext,
  undoEntryCanBeRedone,
  type UndoAction,
  type UndoSource,
} from "./history/boardHistory";
import {
  boardTargetLabel,
  formatRecordingClock,
  truncateSpeechTranscript,
  mediaUploadFailure,
  objectToolLabel,
  sceneElementKindLabel,
  sceneIntentFeedback,
} from "./ui/boardLabels";
import {
  isScenePlacementTool,
  scenePlacementPreviewTool,
} from "./scene/scenePlacement";
import {
  COPILOT_VISIBILITY_KEY,
  copilotRightInset,
  copilotStartsOpen,
} from "./ui/copilotPanel";
import {
  OPEN_SPOT_KINDS,
  boundsBetween,
  buildSceneMovePreview,
  connectorAnchorPoint,
  drawingElementIntersectsCircle,
  elementCenter,
  isInlineTextEditable,
  layoutSceneElements,
  mindMapDirectionOffset,
  openSceneTransform,
  sceneElementFitsInside,
  sceneElementUnionBounds,
  sceneIntentPlacementPoint,
  sceneSectionMembers,
  sceneTextEditorBounds,
  strokePointBounds,
  tableCellIdAtPoint,
} from "./scene/sceneGeometry";
import {
  appendSectionContainmentChanges,
  buildUniformSceneMoveChanges,
  connectorGeometryPatches,
  sceneElementColorPatches,
  sceneElementMovePatches,
  sceneElementRenamePatches,
} from "./scene/sceneIntentPatches";
import {
  buildSceneFanInContext,
  resolveContextualSceneTarget,
  resolveSceneIntentTargetIds,
  sceneElementLockedForMutation,
  sceneElementReferenceLabel,
  uniqueGeneratedSceneLabel,
} from "./scene/sceneTargets";

/** Trace label for how a command reached Airo. */
function voiceTraceChannel(decision: VoiceRouteDecision | undefined): string {
  if (!decision) return "none";
  if (decision.channel === "gated-ptt") return "ptt";
  if (decision.channel === "gated-scoped") return "scoped";
  return decision.channel;
}

/** Backoff for retrying a settings load: 2 s, 4 s, 8 s … capped at a minute. */
function configRetryDelayMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
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
  initialBoardSessionId,
  pendingSessionStart,
  onBoardSessionReady,
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
  shareAccess,
  liveGuest = false,
  participantName,
  onLiveJoinFailed,
  onGuestEditingChange,
  organizationPolicy,
}: {
  initialBoardSessionId?: string | null;
  /** A live-session start the page sent while the board was loading. */
  pendingSessionStart?: Promise<Response> | null;
  onBoardSessionReady?: (session: {
    boardSessionId: string;
    participantId: string;
    role: string;
  }) => void;
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
  /** Deletes the saved board for good. */
  onDeleteBoard?: () => Promise<void>;
  /** Durable board identity and persistence state shown in the standalone editor chrome. */
  boardTitle?: string;
  persistentSaveStatus?: "saved" | "saving" | "error";
  initialPreferences?: {
    neonTheme?: boolean;
    videoEnabled?: boolean;
    audioEnabled?: boolean;
  };
  /** Who can open the saved board; drives the Share dialog's access section. */
  shareAccess?: BoardShareAccess;
  /** Joined from a live link: no saved board, so the chrome shows live status instead. */
  liveGuest?: boolean;
  /** Name other participants see for this person in the live session. */
  participantName?: string;
  /** Live-link guests leave the board when joining fails rather than edit a local copy. */
  onLiveJoinFailed?: (message: string) => void;
  /**
   * Live-link guests: whether the host lets them edit, on joining and each
   * time the host changes it in Share. The page swaps to a view-only board.
   */
  onGuestEditingChange?: (allowed: boolean) => void;
  /**
   * The signed-in person's Admin → Organization policy. Camera, gestures and
   * downloads never reach the API, so the board itself honours those switches;
   * the API enforces voice and guests.
   */
  organizationPolicy?: { cameraEnabled: boolean; gestureEnabled: boolean; exportsEnabled: boolean; voiceEnabled?: boolean };
}) {
  const exportsBlocked = organizationPolicy?.exportsEnabled === false;
  const cameraBlockedMessage =
    organizationPolicy?.cameraEnabled === false
      ? "Your workspace admin turned off the camera for Airboard."
      : organizationPolicy?.gestureEnabled === false
        ? "Your workspace admin turned off gesture control."
        : null;
  const effectiveAccessToken = accessToken;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resolvedSceneImagesRef = useRef<Record<string, CanvasImageSource>>({});
  const resolvedSceneImageUrlsRef = useRef<Map<string, string>>(new Map());
  const resolvedSceneImageSourcesRef = useRef<Map<string, CanvasImageSource>>(new Map());
  const focusedSectionHashRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenUnderlayVideoRef = useRef<HTMLVideoElement | null>(null);
  // The live camera stream, kept apart from the <video> element: React clears
  // element refs before unmount cleanups run, and the camera must still stop.
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenUnderlayStreamRef = useRef<MediaStream | null>(null);
  const screenUnderlayStartInProgressRef = useRef(false);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const intentCommandInputRef = useRef<HTMLTextAreaElement | null>(null);
  const trackerRef = useRef<MediaPipeHandTracker | null>(null);
  // Synchronous guard against a double-start race (state updates lag within a tick).
  const cameraStartInProgressRef = useRef(false);
  const pendingCameraConfidenceRestartRef = useRef(false);
  // Flipped on unmount so an in-flight startCamera can release what it acquires.
  const cameraMountedRef = useRef(true);
  // The latest sign-in token, so a voice reconnect after a token refresh
  // still gets a ticket.
  const latestAccessTokenRef = useRef<string | undefined>(effectiveAccessToken);
  // Voice ended on its own in a way trying again can fix (it paused after a
  // quiet stretch, or gave up reconnecting), so an open palm or the Airo
  // power button brings it back. The ref serves callbacks; the state, labels.
  const voiceDroppedRef = useRef(false);
  const [voiceDropped, setVoiceDropped] = useState(false);
  const markVoiceDropped = useCallback((dropped: boolean) => {
    voiceDroppedRef.current = dropped;
    setVoiceDropped(dropped);
  }, []);
  const startVoiceCommandRef = useRef<(() => void) | null>(null);
  // Read by callbacks defined before the values they need.
  const voiceOffReasonRef = useRef("");
  // False while another Airboard tab is the one in use: only one tab listens.
  const voiceOwnerRef = useRef(true);
  // What the board started on opening, so a failed camera can be retried.
  const airoCameraWantedRef = useRef(false);
  useEffect(() => {
    latestAccessTokenRef.current = effectiveAccessToken;
  }, [effectiveAccessToken]);
  const airoAutoStartAttemptedRef = useRef(false);
  // Set false on unmount, so a permission prompt answered after leaving the
  // board starts nothing.
  const boardMountedRef = useRef(true);
  useEffect(() => {
    boardMountedRef.current = true;
    return () => {
      boardMountedRef.current = false;
    };
  }, []);
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
  const runVoiceDecisionRef = useRef<
    ((decision: VoiceRouteDecision, metadata: VoiceDecisionMetadata) => void) | null
  >(null);
  const heldVoiceMetaRef = useRef<VoiceDecisionMetadata | null>(null);
  const incomingVoiceMetaRef = useRef<VoiceDecisionMetadata | null>(null);
  const voiceCoalescerRef = useRef<VoiceCommandCoalescer | null>(null);
  if (voiceCoalescerRef.current === null) {
    voiceCoalescerRef.current = new VoiceCommandCoalescer({
      onFlush: (decision) => {
        const metadata = heldVoiceMetaRef.current ?? incomingVoiceMetaRef.current ?? {
          engine: "realtime",
        };
        heldVoiceMetaRef.current = null;
        runVoiceDecisionRef.current?.(decision, metadata);
      },
    });
  }
  const voiceCoalescer = voiceCoalescerRef.current;
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
  const pendingPersistenceHashRef = useRef("");
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
  /**
   * A v2 element the closed hand still holds after a voice edit committed its
   * grab (see settleHandSceneMove); the next hand movement picks it up again.
   */
  const handSceneMoveResumeRef = useRef<string | null>(null);
  const gesturePathRef = useRef<StrokePoint[]>([]);
  const lastGesturePointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastGesturePointerAtRef = useRef(0);
  /**
   * Where the hand or mouse pointed when the person started speaking, so
   * "here", "this" and "that" mean what they pointed at, not the selection
   * or the middle of the view.
   */
  const speechStartPointingRef = useRef<SpeechPointing | null>(null);
  /** The pointing a running voice command resolves "here/this/that" against. */
  const voiceReferenceRef = useRef<VoiceReference | null>(null);
  /**
   * How the running voice command reached Airo, for the planner. `addressedBy`
   * is undefined for follow-ups and answers (no wake word), so the planner
   * keeps its room-talk filter for them.
   */
  const voiceAddressedByRef = useRef<{ addressedBy: SemanticIntentAddressedBy | undefined } | null>(null);
  const currentPointingRef = useRef<(() => SpeechPointing | null) | null>(null);
  const undoRedoRef = useRef<{ undo: (count: number) => void; redo: (count: number) => void } | null>(null);
  const executeSceneIntentRef = useRef<((intent: BoardSceneIntent) => SceneIntentExecutionResult) | null>(null);
  const frameBoardBoundsRef = useRef<((bounds: { x: number; y: number; width: number; height: number }) => void) | null>(null);
  const activeEraseAffectedStrokeIdsRef = useRef<Set<string>>(new Set());
  const undoStackRef = useRef<UndoAction[]>([]);
  const sceneRedoStackRef = useRef<UndoAction[]>([]);
  const objectInteractionRef = useRef<ObjectInteraction | null>(null);
  const objectInteractionInitialStateRef = useRef<BoardState | null>(null);
  const cameraGrabActiveRef = useRef(false);
  const cameraPlacementActiveRef = useRef(false);
  const cameraPlacementArmedToolRef = useRef<ObjectDockTool | null>(null);
  /**
   * What the hand points at, for voice deixis ("here", "this", "that"). The
   * snapshot object is replaced, never mutated, on every manipulation frame,
   * so a voice turn can keep the one it read when speech started and resolve
   * it later with `resolveHandPointing` (./handPointing). `targetIds` holds
   * legacy stroke ids and v2 scene element ids alike.
   */
  const handPointingRecorderRef = useRef(new HandPointingRecorder());
  const handPointingSnapshotRef = useRef<HandPointingSnapshot>(
    handPointingRecorderRef.current.snapshot,
  );
  const handDwellSelectTrackerRef = useRef(new HandDwellSelectTracker());
  const looseGrabHoldRef = useRef(new LooseGrabHold());
  /** The holding hand's last normalized point, so a second hand can't take a grab over. */
  const handSignalAnchorRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * The dock tile the hand is aiming at: an open palm there aims, it doesn't
   * talk. A palm over a shape still opens the voice gate ("make this red"
   * while pointing at it); grabs, carries and hold-to-edit suppress it.
   */
  const handAimTargetRef = useRef<string | null>(null);
  /** Last canvas-local screen point of the hand cursor, for cues by the hand. */
  const handScreenPointRef = useRef<{ x: number; y: number } | null>(null);
  /** The dock tool a hand placement left armed for the next placement. */
  const handRearmedToolRef = useRef<CreationToolId | ObjectDockTool | null>(null);
  const [handCue, setHandCue] = useState<{
    id: number;
    text: string;
    x: number;
    y: number;
    tone: "info" | "warning";
  } | null>(null);
  const handCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraRecoveryRef = useRef<{
    attempt: number;
    timer: ReturnType<typeof setTimeout> | null;
    stableTimer: ReturnType<typeof setTimeout> | null;
    pending: boolean;
  }>({ attempt: 0, timer: null, stableTimer: null, pending: false });
  const startCameraRef = useRef<(() => Promise<void>) | null>(null);
  const recoverCameraRef = useRef<((reason: CameraRecoveryReason) => void) | null>(null);
  const shortcutsActiveRef = useRef(false);
  const panActiveRef = useRef(false);
  const handPanRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    viewport: BoardViewport;
  } | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraPromptWaiting, setCameraPromptWaiting] = useState(false);
  const [sensitivity] = useState(1);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const [activeObjectTool, setActiveObjectTool] = useState<ObjectDockTool>("select");
  const [activeCreationTool, setActiveCreationTool] = useState<CreationToolId>("move");
  const activeCreationToolRef = useRef<CreationToolId>("move");
  const [temporaryHandActive, setTemporaryHandActive] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const selectedElementIdsRef = useRef<string[]>([]);
  /**
   * What Airo counts as selected: its own nodes and the shapes the toolbar or
   * typed commands made (RGB-039). Every snapshot and every staleness check
   * uses this same list, so a selected shape never looks like a change.
   */
  const currentSemanticSelectionIds = useCallback(() => [
    ...selectedAnnotationIdsRef.current,
    ...selectedElementIdsRef.current.filter((id) => isSceneOnlyElement(boardRef.current, id)),
  ], []);
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
  // Read after a render by the voice queue, to repeat the reason on the board.
  const commandFeedbackRef = useRef(commandFeedback);
  commandFeedbackRef.current = commandFeedback;
  const [voiceGate, setVoiceGate] = useState<VoiceGateUi | null>(null);
  const [boardSyncStatus, setBoardSyncStatus] = useState("off");
  // Rendered by the Share dialog's live link; the ref alone would not
  // re-render when the session becomes available.
  const [activeBoardSessionId, setActiveBoardSessionId] = useState<string | null>(null);
  const [activeJoinToken, setActiveJoinToken] = useState<string | null>(null);
  // The owner's Share setting for people who join with the live link.
  const [guestsCanEdit, setGuestsCanEdit] = useState(false);
  const [liveSessionRole, setLiveSessionRole] = useState<string | null>(null);
  const onGuestEditingChangeRef = useRef(onGuestEditingChange);
  onGuestEditingChangeRef.current = onGuestEditingChange;
  // Lightboard (neon-on-dark) appearance. Defaults here; stored preferences
  // load after mount so server and client render the same initial tree.
  const [boardTheme, setBoardTheme] = useState<"classic" | "lightboard">(
    initialPreferences?.neonTheme !== false
      ? "lightboard"
      : "classic",
  );
  const [cameraUnderlayEnabled, setCameraUnderlayEnabled] = useState(
    initialPreferences?.videoEnabled !== false,
  );
  const [scrimOpacity, setScrimOpacity] = useState(CAMERA_PRESENTATION_SCRIM);
  const cameraUnderlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenUnderlayStatus, setScreenUnderlayStatus] =
    useState<ScreenUnderlayStatus>("idle");
  const [screenUnderlayNotice, setScreenUnderlayNotice] = useState<string | null>(null);
  // Studio recording. Refs mirror theme/scrim so the recorder's per-frame
  // compositor reads current values without re-starting on every change.
  const [localContrastPlatesEnabled, setLocalContrastPlatesEnabled] = useState(true);
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
    setCameraUnderlayEnabled(true);
    try {
      window.localStorage.setItem("airboard.theme.v1", "lightboard");
      window.localStorage.setItem("airboard.underlay.v1", "on");
      window.localStorage.setItem("airboard.scrim.camera.v1", String(nextScrim));
    } catch {
      // Preference persistence is best-effort.
    }
  }, []);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [dockGestureHover, setDockGestureHover] = useState<string | null>(null);
  const dockGestureHoverRef = useRef<string | null>(null);
  const catalogCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // The Airo panel is shown or hidden, nothing in between; it starts hidden
  // so the board (and the presented tab) stays clear.
  const [copilotOpen, setCopilotOpen] = useState(false);
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
  // Hand tracking may close only a menu a hand opened. With the camera on from
  // the moment a board opens, a menu opened with the mouse must stay open
  // while no hand is over the dock.
  const catalogOpenedByHandRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  useMenuKeyboard(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));
  // Share is a menu: sharing with people, and every way to take the board out.
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  useMenuKeyboard(shareMenuRef, shareMenuOpen, () => {
    setShareMenuOpen(false);
    shareButtonRef.current?.focus();
  });
  useEffect(() => {
    if (!shareMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !shareButtonRef.current?.parentElement?.contains(target)) {
        setShareMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [shareMenuOpen]);
  const [shareOpen, setShareOpen] = useState(false);
  const [liveStartProblem, setLiveStartProblem] = useState<LiveStartFailure | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  // Enter or Escape in the rename field hands focus back to the title.
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreTitleFocusRef = useRef(false);
  useEffect(() => {
    if (!titleEditing && restoreTitleFocusRef.current) {
      restoreTitleFocusRef.current = false;
      titleButtonRef.current?.focus();
    }
  }, [titleEditing]);
  const [titleDraft, setTitleDraft] = useState(boardTitle);
  const [titleStatus, setTitleStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting" | "error">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLElement | null>(null);
  // Escape cancels like the Cancel button, except while the move is under way.
  useModalFocus(deleteDialogRef, deleteDialogOpen, () => {
    if (deleteStatus === "deleting") return;
    setDeleteDialogOpen(false);
    setDeleteStatus("idle");
    setDeleteError(null);
  });
  const titleCancelPendingRef = useRef(false);
  const titleCommitInFlightRef = useRef(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechArmed, setSpeechArmed] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<MediaPermissionState>("unsupported");
  const [cameraPermission, setCameraPermission] =
    useState<MediaPermissionState>("unsupported");
  const [speechEngine, setSpeechEngine] = useState<SpeechEngine>("loading");
  const [realtimeTranscriptionConfig, setRealtimeTranscriptionConfig] =
    useState<RealtimeTranscriptionConfig | null>(null);
  const [speechHeardText, setSpeechHeardText] = useState("");
  const [speechRecognitionStatus, setSpeechRecognitionStatus] =
    useState<SpeechRecognitionStatus>("idle");
  const speechRecognitionStatusRef = useRef<SpeechRecognitionStatus>("idle");
  const [labelDraft, setLabelDraft] = useState("");
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [strokeColor] = useState("#111827");
  const [strokeThickness] = useState(3);
  const [frictionPreset] = useState<FrictionPreset>("balanced");
  const [autoLiftEnabled] = useState(true);
  const [strokeCleanupEnabled] = useState(true);
  const [autoSnapConnectors, setAutoSnapConnectors] = useState(true);
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
  // Screen readers can't see the canvas: they hear what is selected, and can
  // read the board's words in a list beside it.
  const selectedAnnotationStroke = selectedAnnotationId ? boardRef.current.strokes[selectedAnnotationId] : undefined;
  const selectionAnnouncement = selectedSceneElement
    ? `Selected “${sceneElementReferenceLabel(selectedSceneElement)}”.`
    : selectedAnnotationStroke
      ? `Selected “${selectedAnnotationStroke.annotation?.label?.trim() || selectedAnnotationStroke.annotation?.type || "drawing"}”.`
      : "";
  const boardTextForScreenReaders = useMemo(
    () => boardPreview(boardRef.current).text.slice(0, BOARD_TEXT_LIST_LIMIT),
    // sceneRenderVersion is the trigger: the board itself lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneRenderVersion],
  );
  const playbackViewport = useMemo(
    () => ({ ...boardViewportRef.current }),
    // viewportRevision is the trigger: the viewport itself lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewportRevision],
  );
  // The selected element's box in the window, so its toolbar can float beside it.
  const selectedTransform = selectedSceneElement?.transform;
  const selectionAnchor = useMemo(
    () => {
      const canvas = canvasRef.current;
      if (!selectedTransform || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const { x, y, width, height } = selectedTransform;
      const topLeft = screenPointFromBoard(boardViewportRef.current, { x, y });
      const bottomRight = screenPointFromBoard(boardViewportRef.current, { x: x + width, y: y + height });
      return {
        left: rect.left + topLeft.x,
        top: rect.top + topLeft.y,
        right: rect.left + bottomRight.x,
        bottom: rect.top + bottomRight.y,
      };
    },
    // The transform's numbers and viewportRevision are the triggers; the
    // viewport lives in a ref and the element is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedSceneElement?.id,
      selectedTransform?.x,
      selectedTransform?.y,
      selectedTransform?.width,
      selectedTransform?.height,
      viewportRevision,
    ],
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
  const gestureConfig = useMemo<GestureConfig>(
    () => ({
      ...defaultGestureConfig,
      markerHand: "either",
      markerGestureConfidenceThreshold: confidenceThreshold,
      dusterGestureConfidenceThreshold: Math.max(0.45, confidenceThreshold * 0.72),
    }),
    [confidenceThreshold],
  );
  const frictionConfig = useMemo<Partial<VirtualSurfaceFrictionConfig>>(
    () => ({
      ...defaultVirtualSurfaceFrictionConfig,
      ...frictionPresets[frictionPreset === "custom" ? "balanced" : frictionPreset],
      enableAutoLift: autoLiftEnabled,
      enablePostStrokeSmoothing: strokeCleanupEnabled,
      enableLineSnap: strokeCleanupEnabled,
    }),
    [autoLiftEnabled, frictionPreset, strokeCleanupEnabled],
  );

  const setCopilotVisibility = useCallback((visible: boolean) => {
    setCopilotOpen(visible);
    try {
      window.localStorage.setItem(COPILOT_VISIBILITY_KEY, visible ? "open" : "closed");
    } catch {
      // Preference persistence is best-effort.
    }
  }, []);
  // No command ever asks for confirmation, so every applied change gets a
  // short-lived, one-tap undo right where the person is looking.
  const [undoToast, setUndoToast] = useState<{ id: number; detail: string } | null>(null);
  useEffect(() => {
    if (!undoToast) return;
    const timer = window.setTimeout(() => {
      setUndoToast((current) => (current?.id === undoToast.id ? null : current));
    }, UNDO_TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [undoToast]);
  // Voice failures and questions show on the board itself, so a presenter
  // facing the audience (or with the panel hidden) still sees them.
  const [airoSounds, setAiroSounds] = useState(true);
  useEffect(() => setAiroSounds(airoSoundsEnabled()), []);
  const [airoNotice, setAiroNotice] = useState<
    { id: number; tone: "warning" | "question"; detail: string } | null
  >(null);
  const airoNoticeSequenceRef = useRef(0);
  const showAiroNotice = useCallback(
    (notice: { tone: "warning" | "question"; detail: string }) => {
      airoNoticeSequenceRef.current += 1;
      setAiroNotice({ id: airoNoticeSequenceRef.current, ...notice });
    },
    [],
  );
  useEffect(() => {
    if (!airoNotice) return;
    const timer = window.setTimeout(() => {
      setAiroNotice((current) => (current?.id === airoNotice.id ? null : current));
    }, airoNotice.tone === "question" ? AIRO_QUESTION_VISIBLE_MS : AIRO_NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [airoNotice]);
  const finishOnboarding = useCallback(() => {
    setOnboardingVisible(false);
    try {
      window.localStorage.setItem("airboard.onboarding.v1", "done");
    } catch {
      // Best-effort persistence only.
    }
  }, []);
  const appendCopilotActivity = useCallback(
    (entry: Omit<CopilotActivityEntry, "id">) => {
      copilotActivitySequenceRef.current += 1;
      const nextEntry = { ...entry, id: copilotActivitySequenceRef.current };
      if (entry.undoable) {
        // The first change made by any means ends the first-run card.
        finishOnboarding();
        setUndoToast({ id: nextEntry.id, detail: entry.detail });
        setAiroNotice(null);
      }
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
    [finishOnboarding],
  );
  useEffect(() => {
    speechRecognitionStatusRef.current = speechRecognitionStatus;
  }, [speechRecognitionStatus]);
  useEffect(() => {
    setCopilotOpen(copilotStartsOpen());
  }, []);
  const refreshStandaloneMediaPermissions = useCallback(async () => {
    const [microphone, camera] = await Promise.all([
      queryMediaPermission("microphone"),
      queryMediaPermission("camera"),
    ]);
    setMicrophonePermission(microphone);
    setCameraPermission(camera);
  }, []);
  useEffect(() => {
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
  }, []);
  const cameraCanvasLocked =
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
      selectedStrokeId: selectedAnnotationId,
      selectedStrokeIds: selectedAnnotationIds,
      hoverStrokeId,
      selectedElementId,
      selectedElementIds,
      hoverElementId,
      resolvedImages: resolvedSceneImagesRef.current,
      ghostAnnotation,
      ghostAnnotations,
      alignmentGuides,
      contrastPlates:
        boardTheme === "lightboard" &&
        localContrastPlatesEnabled &&
        screenUnderlayStatus === "active"
          ? { opacity: 0.72, padding: 14, mergeGap: 18 }
          : null,
    });
  }, [
    alignmentGuides,
    boardTheme,
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

  /**
   * Hands the pending snapshot to the host immediately. A rejected save clears
   * the dedupe hash so the same content is not skipped on the next attempt;
   * the host owns retry and conflict handling.
   */
  const flushPersistentSnapshot = useCallback(() => {
    if (persistenceTimerRef.current) {
      clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    const pending = pendingPersistenceRef.current;
    const hash = pendingPersistenceHashRef.current;
    if (!pending) return;
    pendingPersistenceRef.current = null;
    lastPersistenceHashRef.current = hash;
    void Promise.resolve(persistenceCallbackRef.current?.(pending)).catch(() => {
      if (lastPersistenceHashRef.current === hash) lastPersistenceHashRef.current = "";
    });
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
    pendingPersistenceHashRef.current = hash;
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = setTimeout(flushPersistentSnapshot, 800);
  }, [flushPersistentSnapshot, persistentBoardId]);

  // Leaving the tab or closing the window must not wait out the debounce.
  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPersistentSnapshot();
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingPersistenceRef.current) return;
      flushPersistentSnapshot();
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushPersistentSnapshot);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushPersistentSnapshot);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [flushPersistentSnapshot]);

  useEffect(() => () => flushPersistentSnapshot(), [flushPersistentSnapshot]);

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
      if (event.type !== "cursor.moved" && !event.type.startsWith("participant.")) {
        schedulePersistentSnapshot(boardRef.current);
      }
    },
    [
      refreshRealtimeSpeechKeyterms,
      render,
      schedulePersistentSnapshot,
    ],
  );
  const applyRemoteEventRef = useRef(applyRemoteEvent);
  /**
   * After a reconnect that missed too much to replay, the session's whole
   * state replaces the local board. The host saves it, so the guests' changes
   * made meanwhile reach the saved board.
   */
  const applyResyncedBoard = useCallback(
    (state: BoardState) => {
      boardRef.current = state;
      sceneRedoStackRef.current = [];
      undoStackRef.current = [];
      setSelectedAnnotationId(null);
      setSelectedAnnotationIds([]);
      setSelectedElementId(null);
      setSelectedElementIds([]);
      setEditingElementId(null);
      setSceneRenderVersion((version) => version + 1);
      refreshRealtimeSpeechKeyterms(state, []);
      render();
      schedulePersistentSnapshot(state);
    },
    [refreshRealtimeSpeechKeyterms, render, schedulePersistentSnapshot],
  );
  const applyResyncedBoardRef = useRef(applyResyncedBoard);
  useEffect(() => {
    applyResyncedBoardRef.current = applyResyncedBoard;
  }, [applyResyncedBoard]);
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
      options: {
        table?: { rows: number; columns: number };
        label?: string;
        language?: CodeLanguage;
        /** Shift away from existing elements, trying this direction first. */
        avoidOverlap?: SceneIntentPlacementDirection;
        /** Open the on-canvas text editor; commands leave focus in the Airo field. */
        edit?: boolean;
        /** Attached ends for a connector placed between shapes. */
        connector?: NonNullable<SceneCreationOptions["connector"]>;
      } = {},
    ) => {
      const { avoidOverlap, edit = true, ...creationOptions } = options;
      const attachmentTarget = tool === "stamp" || tool === "insert:face-stamp"
        ? findSceneElementAtPoint(boardRef.current, point)
        : null;
      const drafted = createSceneElementForTool(tool, {
        boardId: boardSessionIdRef.current,
        ...(accountUserId ? { creatorId: accountUserId } : {}),
        point,
        stampEmoji: selectedStampEmoji,
        ...(tool === "table" && !creationOptions.table ? { table: pendingTableSizeRef.current } : {}),
        ...creationOptions,
      });
      if (!drafted) return null;
      const element = avoidOverlap && OPEN_SPOT_KINDS.has(drafted.kind)
        ? { ...drafted, transform: openSceneTransform(boardRef.current, drafted.transform, avoidOverlap) }
        : drafted;
      const created = commitSceneElement(element, {
        edit: edit && ["sticky", "shape", "text", "code_block", "mind_map_node"].includes(element.kind),
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

  const commitSceneText = useCallback(
    (elementId: string, text: string) => {
      const element = boardRef.current.elements[elementId];
      if (!element || element.status !== "active") return;
      if (element.kind === "section") {
        patchSceneElement(elementId, [{
          op: "field.set",
          path: ["title"],
          value: replaceRichTextPlainValue(element.title, text),
        }]);
        return;
      }
      if (!isInlineTextEditable(element)) return;
      patchSceneElement(elementId, [
        { op: "field.set", path: ["content"], value: replaceRichTextPlainValue(element.content, text) },
        ...(element.kind === "sticky"
          ? [{ op: "field.set" as const, path: ["transform", "height"] as [string, string], value: stickyHeightForText(element, text) }]
          : []),
      ]);
    },
    [patchSceneElement],
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
        setCommandFeedback(mediaUploadFailure(caught instanceof Error ? caught.message : ""));
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
    movement.lastPoint = point;
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

  /**
   * A voice edit (hold-to-edit "rename to …", "delete") while the hand holds a
   * v2 element: the grab's snapshot would write the pre-edit element back on
   * the next frame and on release. Commit the move so far first, so the edit
   * applies to the moved element and undo steps back edit, then move. The
   * hand, still closed, picks the element up again on its next movement.
   */
  const settleHandSceneMove = useCallback(() => {
    const movement = sceneMoveRef.current;
    if (!movement || movement.pointerId !== HAND_SCENE_POINTER_ID) return;
    commitSceneMove(HAND_SCENE_POINTER_ID, movement.lastPoint ?? movement.start);
    handSceneMoveResumeRef.current = movement.elementId;
  }, [commitSceneMove]);

  /** Puts a hand-moved v2 element back where the grab began (hand lost). */
  const cancelSceneMove = useCallback((pointerId: number) => {
    const movement = sceneMoveRef.current;
    if (!movement || movement.pointerId !== pointerId) return false;
    sceneMoveRef.current = null;
    const restoredElements = { ...boardRef.current.elements };
    for (const original of [movement.element, ...movement.relatedElements, ...movement.boundConnectors]) {
      restoredElements[original.id] = original;
    }
    boardRef.current = { ...boardRef.current, elements: restoredElements };
    render();
    return true;
  }, [render]);

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
      const panel = canvasRef.current
        ?.closest(".canvas-workspace")
        ?.querySelector(".canvas-copilot")
        ?.getBoundingClientRect();
      const center = boardPointFromScreen(
        boardViewportRef.current,
        rect
          ? unobscuredCanvasCenter(rect, panel ?? null)
          : { x: 480, y: 320 },
      );
      const reference = voiceReferenceRef.current;
      // A shape Airo drew (a legacy stroke) also has a hidden scene copy under
      // the same id; editing that copy changes nothing visible. When "this"
      // or a name lands on one, resolve to nothing so the command is rejected
      // here and the legacy grammar or the planner handles it.
      const targetIds = (target: SceneIntentTarget) => {
        const ids = resolveSceneIntentTargetIds(boardRef.current, target, selectedElementIdsRef.current, reference);
        return ids.some((id) => isLegacyStrokeSceneCopy(boardRef.current, id)) ? [] : ids;
      };
      // "here": where the hand pointed while speaking; typed commands and
      // speech with no recent pointing land in the middle of the view.
      const pointerPoint = reference?.point ?? center;

      if (intent.type === "undo" || intent.type === "redo") {
        const step = undoRedoRef.current;
        if (!step) return "unrecognized";
        if (intent.type === "undo") step.undo(intent.count);
        else step.redo(intent.count);
        return "applied";
      }
      if (intent.type === "correct") {
        // "No, I meant …": take back the last change, then do what was meant.
        // Only a change redo can put back is taken back here, so a correction
        // that turns out not to apply leaves the board exactly as it was and
        // the later stages (the legacy correction grammar, the planner) read
        // the sentence against that board. Anything else goes to them as is.
        const last = undoStackRef.current.at(-1);
        if (!last || !undoEntryCanBeRedone(last)) return "rejected";
        const definition = intent.shapeKind
          ? ALL_SHAPES.find(({ kind }) => kind === intent.shapeKind)
          : undefined;
        if (!intent.intent && !definition) return "rejected";
        const replaced = resolveContextualSceneTarget(boardRef.current, "it", [], null)[0];
        const replacedElement = replaced ? boardRef.current.elements[replaced] : undefined;
        const redoDepth = sceneRedoStackRef.current.length;
        undoRedoRef.current?.undo(1);
        let corrected: SceneIntentExecutionResult;
        if (intent.intent) {
          corrected = executeSceneIntentRef.current?.(intent.intent) ?? "unrecognized";
        } else {
          const created = createSceneElementAtPoint(
            `shape:${definition!.id}`,
            replacedElement ? elementCenter(replacedElement) : center,
            { avoidOverlap: "right", edit: false, label: uniqueGeneratedSceneLabel(boardRef.current, definition!.label) },
          );
          corrected = created ? "applied" : "rejected";
        }
        if (corrected === "rejected" || corrected === "unrecognized") {
          // Put the undone change back before anything else reads the sentence.
          if (sceneRedoStackRef.current.length > redoDepth) undoRedoRef.current?.redo(1);
          return "rejected";
        }
        return corrected;
      }
      if (intent.type === "zoom_to_fit") {
        const placed = Object.values(boardRef.current.elements).filter(
          (element) => element.status === "active" && element.visible && element.kind !== "connector",
        );
        if (placed.length === 0) {
          setCommandFeedback("The board is empty, so there's nothing to fit.");
          return "applied";
        }
        frameBoardBoundsRef.current?.(sceneElementUnionBounds(placed, 0));
        return "applied";
      }
      if (intent.type === "focus") {
        const ids = targetIds(intent.target);
        const elements = ids.flatMap((id) => boardRef.current.elements[id] ? [boardRef.current.elements[id]!] : []);
        if (elements.length === 0) return "rejected";
        frameBoardBoundsRef.current?.(sceneElementUnionBounds(elements, 120));
        return "applied";
      }

      if (intent.type === "create_connected") {
        const targetMatches = targetIds(intent.to);
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
        const label = intent.label && intent.generatedLabel
          ? uniqueGeneratedSceneLabel(boardRef.current, intent.label)
          : intent.label;
        const drafted = createSceneElementForTool(`shape:${definition.id}`, {
          boardId: boardSessionIdRef.current,
          ...(accountUserId ? { creatorId: accountUserId } : {}),
          point: createPoint,
          ...(label ? { label } : {}),
        });
        if (!drafted) return "unrecognized";
        const created = {
          ...drafted,
          transform: openSceneTransform(boardRef.current, drafted.transform, "right"),
        };
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
        const placement = intent.placement;
        const relative = placement && "direction" in placement ? placement : null;
        const placementAnchorIds = !relative
          ? []
          : relative.target === "selection"
            ? [...selectedElementIdsRef.current].reverse()
            : targetIds(
              relative.target === "contextual"
                ? { kind: "contextual", pronoun: relative.pronoun }
                : { kind: "visible_label", label: relative.label },
            );
        const placementAnchor = placementAnchorIds
          .map((id) => boardRef.current.elements[id])
          .find((element): element is BoardSceneElement => Boolean(element?.status === "active"));
        if (relative && !placementAnchor) {
          // Possibly a shape Airo drew: the planner sees those.
          setCommandFeedback(
            relative.target === "visible_label"
              ? `I couldn't find “${relative.label}” on the board, so nothing was added.`
              : "Point at, or select, the shape to place it next to.",
          );
          return "rejected";
        }
        const placementCenter = placementAnchor && relative
          ? sceneIntentPlacementPoint(placementAnchor, relative.direction)
          : placement?.target === "pointer"
            ? pointerPoint
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
        const label = intent.label && intent.generatedLabel
          ? uniqueGeneratedSceneLabel(boardRef.current, intent.label)
          : intent.label;
        const created = createSceneElementAtPoint(tool, placementCenter, {
          avoidOverlap: relative?.direction ?? "right",
          edit: false,
          ...(label ? { label } : {}),
          ...(intent.table ? { table: intent.table } : {}),
          ...(intent.language ? { language: intent.language } : {}),
        });
        return created ? "applied" : "unrecognized";
      }

      if (intent.type === "connect") {
        const fromIds = targetIds(intent.from);
        let toIds = targetIds(intent.to);
        if (intent.from.kind === "contextual" && intent.to.kind === "contextual") {
          // "connect this to that": two things pointed at, else two selected.
          const pointed = (reference?.pointedIds ?? []).filter((id) => boardRef.current.elements[id]?.status === "active");
          const pair = pointed.length >= 2 ? pointed : selectedElementIdsRef.current;
          toIds = pair.filter((id) => id !== fromIds[0]).slice(-1);
          if (toIds.some((id) => isLegacyStrokeSceneCopy(boardRef.current, id))) toIds = [];
        }
        if (
          (intent.from.kind === "visible_label" && fromIds.length !== 1) ||
          (intent.to.kind === "visible_label" && toIds.length !== 1)
        ) {
          setCommandFeedback("Use unique visible names, or select the two elements to connect.");
          return "rejected";
        }
        const fromId = fromIds[0];
        const sameSelection =
          intent.from.kind !== "visible_label" && intent.to.kind !== "visible_label";
        const toId = sameSelection
          ? toIds.find((id) => id !== fromId)
          : toIds.find((id) => id !== fromId) ?? toIds.at(-1);
        const from = fromId ? boardRef.current.elements[fromId] : null;
        const to = toId ? boardRef.current.elements[toId] : null;
        if (!from || !to || from.id === to.id) {
          setCommandFeedback("Point at, name, or select two different shapes to connect.");
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
        // A name shared by several shapes: let the planner pick its best guess.
        setCommandFeedback("More than one visible element matches that name.");
        return "rejected";
      }
      if (intent.type === "move_to") {
        const elements = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element && !sceneElementLockedForMutation(boardRef.current, element) ? [element] : [];
        });
        const destination = intent.destination;
        let to: { x: number; y: number } | null = null;
        if (destination.target === "pointer") {
          to = reference?.point ?? null;
        } else {
          const anchorId = targetIds(
            destination.target === "selection"
              ? { kind: "selection" }
              : destination.target === "contextual"
                ? { kind: "contextual", pronoun: destination.pronoun }
                : { kind: "visible_label", label: destination.label },
          ).find((id) => !ids.includes(id));
          const anchor = anchorId ? boardRef.current.elements[anchorId] : undefined;
          to = anchor ? sceneIntentPlacementPoint(anchor, destination.direction) : null;
        }
        const moving = elements[0];
        if (!moving || !to) {
          setCommandFeedback("I couldn't tell where to move it. Point at the spot, or name a shape.");
          return "rejected";
        }
        const from = elementCenter(moving);
        patchSceneElements(buildUniformSceneMoveChanges(boardRef.current, elements, to.x - from.x, to.y - from.y));
        return "applied";
      }
      if (intent.type === "change_shape") {
        const changes = ids.flatMap((id) => {
          const element = boardRef.current.elements[id];
          return element?.kind === "shape" && !sceneElementLockedForMutation(boardRef.current, element)
            ? [{ elementId: id, patches: [{ op: "field.set" as const, path: ["shapeKind"] as ["shapeKind"], value: intent.shapeKind }] }]
            : [];
        });
        if (changes.length === 0) {
          setCommandFeedback("Only shapes can change type.");
          return "rejected";
        }
        patchSceneElements(changes);
        return "applied";
      }
      if (intent.type === "reorder") {
        const all = Object.values(boardRef.current.elements).filter((element) => element.status === "active");
        const edge = intent.position === "front"
          ? Math.max(...all.map(({ zIndex }) => zIndex)) + 1
          : Math.min(...all.map(({ zIndex }) => zIndex)) - ids.length;
        patchSceneElements(ids.map((id, index) => ({
          elementId: id,
          patches: [{ op: "field.set" as const, path: ["zIndex"], value: edge + index }],
        })));
        return "applied";
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
        if (!voiceTurnId) setIntentCommandText("");
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
      if (!voiceTurnId) setIntentCommandText("");
      setSpeechRecognitionStatus("command-recognized");
      commitSceneElementsAsBatch(drafts, { select: false });
      setCommandFeedback(`Applied: Connect ${drafts.length} relationship${drafts.length === 1 ? "" : "s"}.`);
      appendCopilotActivity({
        source: voiceTurnId ? "Voice" : "Airo",
        title: "Board updated",
        undoable: true,
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

  // A board opens framed on its content when part of it would start off
  // screen, as boards made on a laptop do on a phone. Content already in view
  // keeps the viewport the person expects.
  const frameHiddenContent = useCallback(
    (panelOpen: boolean) => {
      const placed = Object.values(boardRef.current.elements).filter(
        (element) => element.status === "active" && element.kind !== "connector",
      );
      if (placed.length === 0) return;
      const limits = currentViewportLimits();
      const bounds = sceneElementUnionBounds(placed, 0);
      const rightInset = copilotRightInset(panelOpen, limits.canvasWidth);
      if (boundsFitViewport(bounds, boardViewportRef.current, limits, rightInset)) return;
      applyViewport(fitViewportToBounds(bounds, limits, { rightInset }));
    },
    [applyViewport, currentViewportLimits],
  );
  const frameHiddenContentRef = useRef(frameHiddenContent);
  useEffect(() => {
    frameHiddenContentRef.current = frameHiddenContent;
  }, [frameHiddenContent]);
  const openingFrameDoneRef = useRef(false);
  useEffect(() => {
    if (openingFrameDoneRef.current) return;
    openingFrameDoneRef.current = true;
    frameHiddenContent(copilotStartsOpen());
  }, [frameHiddenContent]);

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

  // Load stored appearance preferences after mount (SSR-safe).
  useEffect(() => {
    try {
      if (window.localStorage.getItem("airboard.theme.v1") === "lightboard") {
        setBoardTheme("lightboard");
      }
      if (window.localStorage.getItem("airboard.underlay.v1") === "off") {
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
      cameraStatus === "active" &&
      cameraUnderlayEnabled &&
      ["idle", "blocked", "error"].includes(screenUnderlayStatus);
    if (cameraCanvasVisible) {
      enforceCameraCanvas();
    }
  }, [
    cameraStatus,
    cameraUnderlayEnabled,
    boardTheme,
    enforceCameraCanvas,
    screenUnderlayStatus,
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
  }, [boardTheme, screenUnderlayStatus, stopScreenUnderlay]);

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
    // Live-link guests join someone else's board; the first-diagram card is for owners.
    if (liveGuest) {
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
  }, [liveGuest]);

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
    const addressParams = new URLSearchParams(window.location.search);
    // A saved board's owner rejoins their live session after a reload from
    // this tab's memory, never from the address bar.
    const remembered =
      persistentBoardId && !initialBoardSessionId && !addressParams.get("boardSessionId")
        ? rememberedLiveSession(persistentBoardId)
        : null;
    const requestedSessionId =
      initialBoardSessionId ??
      addressParams.get("boardSessionId") ??
      remembered?.boardSessionId ??
      null;
    const requestedJoinToken = addressParams.get("joinToken") ?? remembered?.joinToken ?? null;
    // Back in the session they started: rejoin as its owner, not as a guest.
    const resumeParticipantId = remembered?.participantId && effectiveAccessToken ? remembered.participantId : null;
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
        ...(!requestedSessionId && pendingSessionStart ? { pendingStart: pendingSessionStart } : {}),
        ownerUserId: accountUserId ?? OWNER_USER_ID,
        ...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {}),
        // The owner's ticket refresh carries their current sign-in.
        getAccessToken: () => latestAccessTokenRef.current,
        ...(requestedJoinToken ? { joinToken: requestedJoinToken } : {}),
        ...(resumeParticipantId ? { resumeParticipantId } : {}),
        // A saved board's live link lets people watch until its owner lets them edit.
        ...(persistentBoardId ? { allowParticipantDrawing: false } : {}),
        provider: "standalone",
        ...(persistentWorkspaceId ? { workspaceId: persistentWorkspaceId } : {}),
        ...(persistentBoardId ? { boardId: persistentBoardId } : {}),
        displayName: participantName ?? (requestedSessionId ? "Guest" : "Owner"),
        title: "Airboard",
      },
      {
        onRemoteEvent: (event) => {
          if (!cancelled) {
            if (event.type === "permission.changed") {
              setGuestsCanEdit(event.allowParticipantDrawing);
              onGuestEditingChangeRef.current?.(event.allowParticipantDrawing);
            }
            applyRemoteEventRef.current(event);
          }
        },
        onSessionPermission: (allow) => {
          if (cancelled) return;
          setGuestsCanEdit(allow);
          onGuestEditingChangeRef.current?.(allow);
        },
        onResync: (state) => {
          if (!cancelled) applyResyncedBoardRef.current(state);
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
        setGuestsCanEdit(result.handle.allowParticipantDrawing);
        setLiveSessionRole(result.handle.role);
        if (result.handle.role !== "owner") onGuestEditingChangeRef.current?.(result.handle.allowParticipantDrawing);
        if (result.outcome === "joined") {
          boardRef.current = result.initialState;
          sceneRedoStackRef.current = [];
          undoStackRef.current = [];
          setSelectedAnnotationId(null);
          setSelectedAnnotationIds([]);
          setSelectedElementId(null);
          setSelectedElementIds([]);
          setEditingElementId(null);
          setSceneRenderVersion((version) => version + 1);
          refreshRealtimeSpeechKeyterms(result.initialState, []);
          render();
          frameHiddenContentRef.current(copilotStartsOpen());
          setCommandFeedback(
            result.handle.role === "owner" ? "Back in your live board session." : "Joined the live board session.",
          );
        } else {
          boardSyncSeedEligibleRef.current = true;
          trySeed();
          setCommandFeedback("Live board ready. Use Share to invite people to work with you.");
        }
        const url = new URL(window.location.href);
        const joinToken = result.handle.joinToken ?? requestedJoinToken;
        if (persistentBoardId) {
          // Keep the live link out of the address bar and history: copying a
          // saved board's address must not hand out edit access.
          if (joinToken) {
            rememberLiveSession(persistentBoardId, {
              boardSessionId: result.handle.boardSessionId,
              joinToken,
              ...(result.handle.role === "owner" ? { participantId: result.handle.participantId } : {}),
            });
          }
          url.searchParams.delete("boardSessionId");
          url.searchParams.delete("joinToken");
        } else {
          url.searchParams.set("boardSessionId", result.handle.boardSessionId);
          if (result.handle.joinToken) {
            url.searchParams.set("joinToken", result.handle.joinToken);
          }
        }
        window.history.replaceState(null, "", url.toString());
        onBoardSessionReady?.({
          boardSessionId: result.handle.boardSessionId,
          participantId: result.handle.participantId,
          role: result.handle.role,
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (remembered && persistentBoardId) {
          // The remembered session ended or its link expired: start afresh.
          forgetLiveSession(persistentBoardId);
          window.location.reload();
          return;
        }
        boardSyncStatusRef.current = "offline";
        setBoardSyncStatus("offline");
        if (!requestedSessionId) {
          setLiveStartProblem(liveStartFailure(caught instanceof Error ? caught.message : String(caught)));
        }
        if (requestedSessionId && onLiveJoinFailed) {
          onLiveJoinFailed(caught instanceof Error ? caught.message : String(caught));
        } else if (requestedSessionId) {
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
    // Starts once, when the board mounts.
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
    },
    [createPlacementObject],
  );

  const commitActiveEraseInteraction = useCallback(() => {
    const strokeIds = [...activeEraseAffectedStrokeIdsRef.current];
    if (strokeIds.length > 0) {
      undoStackRef.current.push({
        type: "erase",
        strokeIds,
      });
      sceneRedoStackRef.current = [];
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
        /** Grab and move only, even while a placement tool or the eraser is armed. */
        moveOnly?: boolean;
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
      lastGesturePointerAtRef.current = Date.now();
      objectInteractionInitialStateRef.current = null;
      const inputSource = options.inputSource ?? "pointer";

      const creationTool = options.moveOnly ? null : options.creationTool ?? (
        !options.placementTool && isScenePlacementTool(activeCreationToolRef.current)
          ? activeCreationToolRef.current
          : null
      );
      const placementTool = options.moveOnly ? "select" : options.placementTool ?? (
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

      if (activeObjectTool === "eraser" && !options.moveOnly) {
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
      lastGesturePointerAtRef.current = Date.now();
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
    (
      point: AnnotationPoint,
      options: { inputSource?: CursorState["inputSource"] } = {},
    ) => {
      if (pointerErasingRef.current) {
        commitActiveEraseInteraction();
        pointerErasingRef.current = false;
        setObjectGestureState("hover");
        return;
      }

      // A hand placement never opens the typing box: the new shape is
      // selected so the presenter can name it by voice ("Airo, call it …").
      // A connector attaches its ends to the shapes under the hand.
      const byHand = options.inputSource === "air_gesture";
      const placeSceneElement = (
        tool: CreationToolId,
        connectorInput: { mode: "drag" | "drop"; from: AnnotationPoint },
      ) => {
        const connector = tool.startsWith("connector:")
          ? resolveHandConnectorEnds(boardRef.current, { ...connectorInput, to: point })
          : undefined;
        createSceneElementAtPoint(tool, point, {
          edit: !byHand,
          ...(connector ? { connector } : {}),
        });
      };
      const interaction = objectInteractionRef.current;
      // Placing always makes a v2 object. An interaction armed with only an
      // older placement tool (not reachable from the dock or the toolbar
      // today) places the toolbar's equivalent rather than a legacy stroke.
      const placedTool = (
        target: Extract<ObjectInteraction, { mode: "placing" | "catalog_carrying" }>,
      ): CreationToolId | null => {
        const tool = target.creationTool ?? creationToolForPlacementTool(target.tool as LegacyPlacementTool);
        return tool && isScenePlacementTool(tool) ? tool : null;
      };
      if (interaction?.mode === "placing" || interaction?.mode === "catalog_carrying") {
        const tool = placedTool(interaction);
        if (tool) {
          placeSceneElement(
            tool,
            interaction.mode === "placing"
              ? { mode: "drag", from: interaction.start }
              : { mode: "drop", from: point },
          );
        }
        setGhostAnnotation(null);
        setGhostAnnotations([]);
        setAlignmentGuides([]);
        if (!tool) setActiveObjectTool("select");
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
          sceneRedoStackRef.current = [];
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
    }
    objectInteractionRef.current = null;
    objectInteractionInitialStateRef.current = null;
    // A hand grab of a v2 element puts it back too.
    cancelSceneMove(HAND_SCENE_POINTER_ID);
    handSceneMoveResumeRef.current = null;
    // A placement tool kept armed after the last hand placement is put away
    // with the interaction, so later closed hands don't keep placing it.
    const rearmedCreationTool =
      handRearmedToolRef.current !== null && isScenePlacementTool(activeCreationToolRef.current)
        ? activeCreationToolRef.current
        : null;
    handRearmedToolRef.current = null;
    cameraPlacementActiveRef.current = false;
    cameraPlacementArmedToolRef.current = null;
    cameraGrabActiveRef.current = false;
    pointerErasingRef.current = false;
    activeEraseAffectedStrokeIdsRef.current = new Set();
    setGhostAnnotation(null);
    setGhostAnnotations([]);
    setAlignmentGuides([]);
    setActiveObjectTool("select");
    if (cancelledCreationTool || rearmedCreationTool) {
      setActiveCreationTool("move");
      activeCreationToolRef.current = "move";
    }
  }, [cancelSceneMove, render]);

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
      dockGestureHoverRef.current = null;
      setDockGestureHover(null);
      if (!catalogOpenedByHandRef.current) return;
      catalogOpenedByHandRef.current = false;
      openCatalogIdRef.current = null;
      setOpenCatalogId(null);
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
          if (currentCatalogId !== hoveredCatalogId) catalogOpenedByHandRef.current = true;
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
        gesturePathRef.current = [];
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
        voiceRouter.reset();
        voiceCoalescer.cancel();
        heldVoiceMetaRef.current = null;
        setVoiceGate(null);
        palmVoiceGestureTrackerRef.current!.reset();
        hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
        hybridPinchClosedRef.current = false;
      }

      diagramVisibleRef.current = visible;
      setDiagramVisible(visible);
      setCommandFeedback(
        visible
          ? "Diagram visible. Board editing is active."
          : "Diagram hidden. Camera or shared screen remains live; snap again or press Shift+H to restore it.",
      );
    },
    [
      cancelObjectInteraction,
      voiceCoalescer,
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

  /**
   * A short cue drawn beside the hand: why a carry ended, or that a closed
   * hand found nothing to grab. Shown on the board, not in a hidden panel.
   */
  const showHandCue = useCallback(
    (text: string, tone: "info" | "warning" = "info") => {
      const at = handScreenPointRef.current;
      if (handCueTimerRef.current !== null) clearTimeout(handCueTimerRef.current);
      setHandCue((current) => ({
        id: (current?.id ?? 0) + 1,
        text,
        tone,
        x: at?.x ?? 0,
        y: at?.y ?? 0,
      }));
      handCueTimerRef.current = setTimeout(() => {
        handCueTimerRef.current = null;
        setHandCue(null);
      }, HAND_CUE_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (handCueTimerRef.current !== null) clearTimeout(handCueTimerRef.current);
    },
    [],
  );

  /**
   * After a hand placement the dock tool stays armed: the next closed hand on
   * empty board places another of the same shape. The hand leaving for the
   * dock (or picking another tile) disarms it.
   */
  const rearmHandPlacementTool = useCallback(
    (tool: { creationTool?: CreationToolId; placementTool: ObjectDockTool }) => {
      cameraPlacementArmedToolRef.current = null;
      if (tool.creationTool && isScenePlacementTool(tool.creationTool)) {
        handRearmedToolRef.current = tool.creationTool;
        activeCreationToolRef.current = tool.creationTool;
        setActiveCreationTool(tool.creationTool);
        setActiveObjectTool(scenePlacementPreviewTool(tool.creationTool));
        return;
      }
      if (isPlacementTool(tool.placementTool)) {
        handRearmedToolRef.current = tool.placementTool;
        setActiveObjectTool(tool.placementTool);
      }
    },
    [],
  );

  const disarmHandPlacementTool = useCallback(() => {
    if (handRearmedToolRef.current === null) return;
    handRearmedToolRef.current = null;
    cameraPlacementArmedToolRef.current = null;
    if (isScenePlacementTool(activeCreationToolRef.current)) {
      activeCreationToolRef.current = "move";
      setActiveCreationTool("move");
    }
    setActiveObjectTool("select");
    setGhostAnnotation(null);
    setGhostAnnotations([]);
  }, []);

  /** Ends a hand grab of a v2 element; false when no hand scene move is active. */
  const finishHandSceneMove = useCallback(
    (point: AnnotationPoint, outcome: "commit" | "cancel") => {
      const resumed = handSceneMoveResumeRef.current !== null;
      handSceneMoveResumeRef.current = null;
      const finished = outcome === "commit"
        ? commitSceneMove(HAND_SCENE_POINTER_ID, point)
        : cancelSceneMove(HAND_SCENE_POINTER_ID);
      // A grab a voice edit already committed has nothing left to finish.
      return finished || resumed;
    },
    [cancelSceneMove, commitSceneMove],
  );

  /** The hand eraser removes v2 elements under it, through the mouse's delete path. */
  const eraseSceneElementsUnderHand = useCallback(
    (point: AnnotationPoint, targetId?: string | null) => {
      const ids = new Set<string>();
      if (targetId && gestureTargetWorld(boardRef.current, targetId) === "scene") ids.add(targetId);
      const hit = findSceneElementAtPoint(boardRef.current, point);
      if (hit && gestureTargetWorld(boardRef.current, hit.id) === "scene") ids.add(hit.id);
      for (const id of ids) {
        deleteSceneElement(id);
        handPointingRecorderRef.current.forget(id);
      }
      return ids.size > 0;
    },
    [deleteSceneElement],
  );

  /**
   * Hand multi-select: with a selection already made, resting the open hand
   * still on another shape adds it. Selections stay in one shape world.
   */
  const addHandTargetToSelection = useCallback(
    (targetId: string) => {
      const world = gestureTargetWorld(boardRef.current, targetId);
      if (world === "scene" && selectedElementIdsRef.current.length > 0) {
        if (selectedElementIdsRef.current.includes(targetId)) return false;
        selectSceneElements([...selectedElementIdsRef.current, targetId], targetId);
        setHoverElementId(targetId);
        return true;
      }
      if (world === "stroke" && selectedAnnotationIdsRef.current.length > 0) {
        if (selectedAnnotationIdsRef.current.includes(targetId)) return false;
        toggleAnnotationObject(targetId);
        setHoverStrokeId(targetId);
        return true;
      }
      return false;
    },
    [selectSceneElements, toggleAnnotationObject],
  );

  const handleGesture = useCallback(
    (result: GestureResult | null, hybridOutput?: HybridGestureControllerOutput) => {
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
        if (screenPoint) handScreenPointRef.current = screenPoint;
        // Record what the hand points at for voice "here / this / that".
        const pointedTargetId =
          hybridOutput.grabbedTargetId ?? hybridOutput.focusedTargetId ?? null;
        handPointingSnapshotRef.current = handPointingRecorderRef.current.observe({
          now: Date.now(),
          boardPoint: point,
          targetId: pointedTargetId,
          // A lost hand leaves a frozen cursor behind: it must go stale.
          tracked: hybridOutput.trackingState === "tracked" && point !== null,
        });

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
        handAimTargetRef.current = dockOutcome?.targetId ?? null;
        if (dockOutcome) {
          // The hand left the board for the dock: a placement tool kept armed
          // after the last hand placement is put away (a tile pick re-arms).
          if (dockOutcome.type === "hover") disarmHandPlacementTool();
          const activatedCreationTool =
            dockOutcome.type === "activated" ? dockOutcome.creationTool : undefined;
          const sceneCreationTool =
            activatedCreationTool && isScenePlacementTool(activatedCreationTool)
              ? activatedCreationTool
              : null;
          // Every dock tile that places something carries its creation tool
          // (the catalogDock e2e guards this), so a carry always makes a v2 object.
          const placementTool = sceneCreationTool
            ? scenePlacementPreviewTool(sceneCreationTool)
            : null;
          if (
            placementTool &&
            point &&
            screenPoint &&
            dockOutcome.type === "activated"
          ) {
            cameraPlacementArmedToolRef.current = null;
            handRearmedToolRef.current = null;
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
          const wasCarrying = cameraGrabActiveRef.current || cameraPlacementActiveRef.current;
          finishHandSceneMove(point ?? lastGesturePointerRef.current ?? { x: 0, y: 0 }, "cancel");
          cameraGrabActiveRef.current = false;
          cancelObjectInteraction();
          setObjectGestureState("hover");
          if (wasCarrying) {
            showHandCue("Hand lost — the shape went back where it was.", "warning");
          }
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
              showHandCue("Hand lost — placement cancelled.", "warning");
            }
            handAimTargetRef.current = null;
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
        lastGesturePointerAtRef.current = Date.now();
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
              showHandCue(`${placementLabel} went back — open your hand over the board to place it.`, "warning");
            } else {
              const loosened = looseGrabHoldRef.current.bridging;
              endObjectInteraction(point, { inputSource: "air_gesture" });
              rearmHandPlacementTool({
                ...(placementInteraction?.creationTool
                  ? { creationTool: placementInteraction.creationTool }
                  : {}),
                placementTool,
              });
              const isConnector = Boolean(
                placementInteraction?.creationTool?.startsWith("connector:"),
              );
              setCommandFeedback(
                isConnector
                  ? `${placementLabel} placed. Close your hand on a shape and open it on another to connect them, or reach for the dock to stop.`
                  : `${placementLabel} placed and selected — say “Airo, call it …” to name it. Close your hand on empty board for another, or over a shape to move it.`,
              );
              showHandCue(
                loosened ? `Hand loosened — ${placementLabel} placed here.` : `${placementLabel} placed.`,
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
        const armedConnector = Boolean(armedCreationTool?.startsWith("connector:"));
        const closingOnShape =
          action?.type === "grab_started" || Boolean(hybridOutput.grabbedTargetId);
        if (
          placementTool &&
          pinchClosed &&
          (pinchJustClosed || Boolean(armedPlacementTool)) &&
          (armedConnector || !closingOnShape)
        ) {
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
          handDwellSelectTrackerRef.current.reset();
          if (activeObjectTool === "eraser") {
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              forcedStrokeId: action.targetId,
            });
            eraseSceneElementsUnderHand(point, action.targetId);
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
          if (gestureTargetWorld(boardRef.current, action.targetId) === "scene") {
            // v2 elements move through the same scene move commands as the
            // mouse, so the move syncs and undoes like a mouse drag.
            const element = boardRef.current.elements[action.targetId]!;
            if (!beginSceneMove(HAND_SCENE_POINTER_ID, element, point, "air_gesture")) {
              cameraGrabActiveRef.current = false;
              hybridGestureControllerRef.current?.reset({ requirePinchRelease: true });
              hybridPinchClosedRef.current = true;
              showHandCue("This shape is locked.", "warning");
              setObjectGestureState("hover");
              return;
            }
            setHoverElementId(element.id);
          } else {
            selectAnnotationObject(action.targetId);
            setHoverStrokeId(action.targetId);
            beginObjectInteraction(point, {
              inputSource: "air_gesture",
              forcedStrokeId: action.targetId,
              moveOnly: true,
            });
          }
          setObjectGestureState("grab");
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
          if (previewSceneMove(HAND_SCENE_POINTER_ID, point)) return;
          const resumeId = handSceneMoveResumeRef.current;
          if (resumeId) {
            // A voice edit committed the grab; the hand is still closed, so
            // carry the shape on from where it is now, edit included.
            handSceneMoveResumeRef.current = null;
            const live = boardRef.current.elements[resumeId];
            if (live?.status === "active" && beginSceneMove(HAND_SCENE_POINTER_ID, live, point, "air_gesture")) {
              previewSceneMove(HAND_SCENE_POINTER_ID, point);
            }
            return;
          }
          if (pointerErasingRef.current) eraseSceneElementsUnderHand(point);
          moveObjectInteraction(point, { inputSource: "air_gesture" });
          return;
        }

        if (action?.type === "grab_ended") {
          const erased = pointerErasingRef.current;
          const loosened = looseGrabHoldRef.current.bridging;
          if (!finishHandSceneMove(point, "commit")) {
            endObjectInteraction(point, { inputSource: "air_gesture" });
          }
          cameraGrabActiveRef.current = false;
          setObjectGestureState("hover");
          if (loosened && !erased) showHandCue("Hand loosened — dropped here.");
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

        const focusedWorld = gestureTargetWorld(boardRef.current, hybridOutput.focusedTargetId);
        setHoverStrokeId(focusedWorld === "stroke" ? hybridOutput.focusedTargetId : null);
        setHoverElementId(focusedWorld === "scene" ? hybridOutput.focusedTargetId : null);
        const dwellTargetId = handDwellSelectTrackerRef.current.update({
          now: hybridOutput.timestampMs,
          targetId: hybridOutput.pinchState === "open" ? hybridOutput.focusedTargetId : null,
          screenPoint,
          eligible:
            !cameraGrabActiveRef.current &&
            (selectedElementIdsRef.current.length > 0 ||
              selectedAnnotationIdsRef.current.length > 0),
        });
        if (dwellTargetId && addHandTargetToSelection(dwellTargetId)) {
          showHandCue("Added to the selection.");
          setCommandFeedback(
            "Added to the selection. Rest your open hand on another shape to add more.",
          );
        }
        const nothingToGrab =
          hybridOutput.pinchState === "closed" && !hybridOutput.focusedTargetId;
        if (nothingToGrab && pinchJustClosed) {
          showHandCue("Nothing to grab here — close your hand over a shape.", "warning");
        }
        setObjectGestureState(nothingToGrab ? "no target" : "hover");
        return;
      }

      if (!result) {
        const lastPoint = lastGesturePointerRef.current;
        if (objectInteractionRef.current?.mode === "catalog_carrying") {
          cancelObjectInteraction();
          cameraPlacementActiveRef.current = false;
          cameraGrabActiveRef.current = false;
          setCommandFeedback("Catalog placement cancelled.");
          showHandCue("Placement cancelled.", "warning");
          setObjectGestureState("hover");
          return;
        }
        if (cameraGrabActiveRef.current && lastPoint) {
          if (!finishHandSceneMove(lastPoint, "commit")) endObjectInteraction(lastPoint);
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
      lastGesturePointerAtRef.current = Date.now();

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
    },
    [
      activeObjectTool,
      addHandTargetToSelection,
      beginObjectInteraction,
      beginSceneMove,
      cancelCatalogClose,
      cancelObjectInteraction,
      disarmHandPlacementTool,
      endObjectInteraction,
      eraseAt,
      eraseSceneElementsUnderHand,
      finishHandSceneMove,
      handleDockGesture,
      makePoint,
      moveCursorPoint,
      moveObjectInteraction,
      previewSceneMove,
      rearmHandPlacementTool,
      reportGestureStage,
      scheduleCatalogClose,
      selectAnnotationObject,
      showHandCue,
      toBoardPoint,
      updateAnnotationObject,
    ],
  );

  const endActivePointerInteraction = useCallback(() => {
    if (pointerErasingRef.current) {
      commitActiveEraseInteraction();
    }
    pointerErasingRef.current = false;
    activePointerIdRef.current = null;
  }, [commitActiveEraseInteraction]);

  const undoLastAction = useCallback(
    (source: UndoSource = "button", followUpInteractionId?: string) => {
      setUndoToast(null);
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
        // The undo changes the saved board too, not only the live session.
        schedulePersistentSnapshot(result.state);
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
        if (action.redoEvents?.length) {
          sceneRedoStackRef.current.push({
            type: "diagram",
            undoEvents: action.redoEvents,
            redoEvents: action.undoEvents,
            selectionBefore: restoredSelection,
          });
        }
        refreshRealtimeSpeechKeyterms(boardRef.current, restoredSelection);
        setSelectedAnnotationIds(restoredSelection);
        setSelectedAnnotationId(restoredSelection[restoredSelection.length - 1] ?? null);
        setCommandFeedback("Undid the last diagram command.");
        render();
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
      schedulePersistentSnapshot,
      render,
      reportVoiceTrace,
      selectSceneElements,
    ],
  );

  const redoLastSceneAction = useCallback(() => {
    const action = sceneRedoStackRef.current.pop();
    if (action?.type === "diagram") {
      // Re-apply an undone Airo change with fresh event ids, so peers replay it.
      // Elements the turn created are still there, marked deleted by the undo:
      // bring them back rather than replaying their creation (a no-op).
      const result = applyDiagramUndo(
        boardRef.current,
        { undoEvents: diagramRedoEvents(boardRef.current, action.undoEvents) },
        diagramCommandContext(boardSessionIdRef.current),
      );
      boardRef.current = result.state;
      appendBoundedBoardEvents(boardEventLogRef.current, result.events);
      schedulePersistentSnapshot(result.state);
      if (result.events.length > 0) boardSyncRef.current?.publish(result.events);
      undoStackRef.current.push({
        type: "diagram",
        undoEvents: action.redoEvents ?? [],
        redoEvents: action.undoEvents,
        selectionBefore: action.selectionBefore,
      });
      refreshRealtimeSpeechKeyterms(boardRef.current, action.selectionBefore);
      setCommandFeedback("Redid the last diagram command.");
      render();
      return;
    }
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
  }, [applyLocalEvent, applySceneElementLifecycle, refreshRealtimeSpeechKeyterms, render, schedulePersistentSnapshot, selectSceneElements]);

  const cancelPendingIntent = useCallback((message = "Cancelled the pending command.") => {
    semanticIntentRequestIdRef.current += 1;
    voiceCorrectionPendingRef.current = null;
    pendingIntentRef.current = null;
    setGhostAnnotation(null);
    setGhostAnnotations([]);
    setAlignmentGuides([]);
    setCommandFeedback(message);
  }, []);

  /**
   * Selects what a command left selected. The board selects one kind of
   * object at a time: v2 objects as scene elements (with their toolbar), or
   * legacy nodes from a board saved before Airo drew v2 shapes, which win.
   */
  const applyIntentSelection = useCallback((ids: string[], primary: string | null) => {
    const annotationSelection = ids.filter((id) => !isSceneOnlyElement(boardRef.current, id));
    if (annotationSelection.length === 0 && ids.length > 0) {
      selectSceneElements(ids, primary && ids.includes(primary) ? primary : ids.at(-1) ?? null);
      return;
    }
    setSelectedAnnotationIds(annotationSelection);
    setSelectedAnnotationId(
      primary && annotationSelection.includes(primary) ? primary : annotationSelection.at(-1) ?? null,
    );
  }, [selectSceneElements]);

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
      // The selection, Airo's older legacy nodes or v2 objects alike.
      let workingSelectionIds = currentSemanticSelectionIds().filter(
        (id) => previewState.strokes[id]?.status === "committed" || isSceneOnlyElement(previewState, id),
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
              (id) => previewState.strokes[id]?.status === "committed" || isSceneOnlyElement(previewState, id),
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
          applyIntentSelection(workingSelectionIds, workingPrimarySelectionId);
          setCommandFeedback("That line is already attached to those objects.");
          if (!voiceTurnId) setIntentCommandText("");
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
          baseSelectionIds: currentSemanticSelectionIds(),
          requiresExplicitConfirmation: false,
          commands,
          selectionAfter: workingSelectionIds,
          ...(ghosts.length > 0 ? { ghosts } : {}),
          ...(voiceTurnId ? { voiceTurnId } : {}),
        };
        pendingIntentRef.current = pending;
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
      applyIntentSelection,
      currentSemanticSelectionIds,
      appendCopilotActivity,
      cancelPendingIntent,
      hoverStrokeId,
      reportVoiceTrace,
      selectedAnnotationId,
      strokeColor,
      toBoardPoint,
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
        if (!voiceTurnId) setIntentCommandText("");
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
      const initialSelectionIds = executionSnapshot?.selectionIds ?? currentSemanticSelectionIds();
      // current_selection is a reference to the user's request-time snapshot.
      // Actions may change the final UI selection, but those incidental
      // selectionAfter values must not retarget later actions in the same plan.
      const referenceSelectionIds = [...initialSelectionIds];
      const initialPrimarySelectionId =
        executionSnapshot?.primarySelectionId ?? selectedAnnotationId;
      const referencePrimarySelectionId =
        initialPrimarySelectionId &&
        referenceSelectionIds.includes(initialPrimarySelectionId)
          ? initialPrimarySelectionId
          : (referenceSelectionIds[referenceSelectionIds.length - 1] ?? null);

      try {
        // The tested grounding helper: it applies the steps it can match, skips
        // a step whose names it can't find (and the steps built on it), and
        // rejects the plan only when nothing, or a needed first step, fails.
        const grounding = groundSemanticPlan({
          actions: plan.actions,
          context: {
            boardState: baseState,
            pointer,
            pointerAvailable: Boolean(actualPointer),
            canvasWidth,
            canvasHeight,
            viewOrigin,
            selectionIds: referenceSelectionIds,
            ...(executionSnapshot?.requestSelectionIds
              ? { requestSelectionIds: executionSnapshot.requestSelectionIds }
              : {}),
            primarySelectionId: referencePrimarySelectionId,
            hoverStrokeId: executionSnapshot?.hoverStrokeId ?? hoverStrokeId,
            strokeColor,
          },
          applyCommand: (state, command) =>
            applyDiagramCommand(state, command, diagramCommandContext(boardSessionIdRef.current)),
          maxCommands: MAX_PLAN_BOARD_CHANGES,
        });
        if (voiceTurnId) {
          for (const step of grounding.skipped) {
            reportVoiceTrace(voiceTurnId, "grounding", {
              status: "rejected",
              source: "semantic",
              actionType: step.actionType,
              issueCode: step.errorCode,
            });
            reportVoiceTrace(voiceTurnId, "action_failed", {
              phase: "semantic_grounding",
              actionType: step.actionType,
              issueCode: step.errorCode,
            });
          }
          if (grounding.status === "grounded") {
            for (const repair of grounding.repairs) {
              reportVoiceTrace(voiceTurnId, "grounding", {
                status: "repaired",
                source: "semantic",
                actionType: repair.actionType,
                repairKinds: repair.repairKinds,
              });
            }
          }
        }
        if (grounding.status === "rejected") {
          cancelPendingIntent(`Plan could not be grounded: ${grounding.reason}`);
          return "rejected";
        }
        const { previewState, commands, affectedStrokeIds } = grounding;
        const skippedSteps = grounding.skipped.map((step) => step.reason);
        const workingSelectionIds = grounding.selectionIds;
        const workingPrimarySelectionId =
          initialPrimarySelectionId && workingSelectionIds.includes(initialPrimarySelectionId)
            ? initialPrimarySelectionId
            : grounding.primarySelectionId;

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
          applyIntentSelection(workingSelectionIds, workingPrimarySelectionId);
          const selectionOnly = plan.actions.every(
            (action) => action.type === "select",
          );
          setCommandFeedback(
            selectionOnly
              ? "Applied the requested selection."
              : "The requested board state is already satisfied.",
          );
          if (!voiceTurnId) setIntentCommandText("");
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
        const message = skippedSteps.length > 0
          ? `${describeSemanticPlan(plan.actions)} (skipped ${skippedSteps.length} of ${plan.actions.length} steps: ${skippedSteps[0]})`
          : describeSemanticPlan(plan.actions);
        const pending: PendingIntent = {
          parsed: null,
          parsedSteps: [],
          stepCount: plan.actions.length,
          confidenceBand: "high",
          requestText,
          message,
          baseState,
          baseSelectionIds: [...(executionSnapshot?.baseSelectionIds ?? initialSelectionIds)],
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
      applyIntentSelection,
      cancelPendingIntent,
      currentSemanticSelectionIds,
      hoverStrokeId,
      reportVoiceTrace,
      selectedAnnotationId,
      strokeColor,
      toBoardPoint,
      undoLastAction,
    ],
  );

  const prepareIntentCommand = useCallback(
    (text: string, voiceTurnId?: string): PrepareIntentCommandResult => {
      const visibilityIntent = parseDiagramVisibilityIntent(text);
      if (visibilityIntent) {
        setDiagramVisibility(visibilityIntent === "show", "voice");
        if (!voiceTurnId) setIntentCommandText("");
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
        if (!voiceTurnId) setIntentCommandText("");
        return "applied";
      }
      if (parsed.command.kind === "cancel") {
        cancelPendingIntent();
        if (!voiceTurnId) setIntentCommandText("");
        return "applied";
      }

      return prepareParsedIntentPlan([parsed], text.trim(), "deterministic", voiceTurnId);
    },
    [
      cancelObjectInteraction,
      cancelPendingIntent,
      prepareParsedIntentPlan,
      reportVoiceTrace,
      setDiagramVisibility,
      undoLastAction,
    ],
  );

  useEffect(() => {
    executeSceneIntentRef.current = executeSceneIntent;
  }, [executeSceneIntent]);
  useEffect(() => {
    undoRedoRef.current = {
      undo: (count) => {
        for (let index = 0; index < count; index += 1) undoLastAction("semantic");
      },
      redo: (count) => {
        for (let index = 0; index < count; index += 1) redoLastSceneAction();
      },
    };
  }, [redoLastSceneAction, undoLastAction]);
  useEffect(() => {
    frameBoardBoundsRef.current = (bounds) => {
      const limits = currentViewportLimits();
      const rightInset = copilotRightInset(copilotOpen, limits.canvasWidth);
      applyViewport(fitViewportToBounds(bounds, limits, { rightInset }));
    };
  }, [applyViewport, copilotOpen, currentViewportLimits]);

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
      // A short command the fast rules couldn't apply (usually a name they
      // can't find among toolbar shapes, such as one Airo drew) goes on to
      // the next stages and the AI planner, which see every shape.
      if (sceneIntent && sceneExecution !== "unrecognized" && sceneExecution !== "rejected") {
        pendingSemanticClarificationRef.current = null;
        if (!voiceTurnId) setIntentCommandText("");
        setSpeechRecognitionStatus("command-recognized");
        if (sceneExecution === "applied" && sceneIntent.type !== "invalid") {
          setCommandFeedback(`Applied: ${sceneIntentFeedback(sceneIntent)}.`);
          appendCopilotActivity({
            source: voiceTurnId ? "Voice" : "Airo",
            title: "Board updated",
            // Undo, redo and view changes aren't themselves offered for undo.
            undoable: !["undo", "redo", "zoom_to_fit", "focus"].includes(sceneIntent.type),
            detail: instruction,
            tone: "success",
          });
        }
        return {
          result: sceneExecution === "applied" ? "applied" : "no-op",
          preparedText: instruction,
          source: "deterministic",
          stepCount: sceneExecution === "applied" ? 1 : 0,
        };
      }
      const desiredGraphCorrection = parseDesiredGraphCorrection(instruction);
      if (desiredGraphCorrection) {
        pendingSemanticClarificationRef.current = null;
        if (!voiceTurnId) setIntentCommandText(instruction);
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
        if (!voiceTurnId) setIntentCommandText(instruction);
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
        if (!voiceTurnId) setIntentCommandText(instruction);
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
      // Compound sentences skip the older phrase grammar, which would
      // misread them, and go straight to the AI planner when it's on.
      // So do pointing words the fast rules read but couldn't resolve: the
      // older grammar takes "make it a queue" as a new queue labelled "it a".
      const pointingWords =
        sceneIntent !== null &&
        sceneExecution === "rejected" &&
        /\b(?:it|this|that|them|these|those|here|there)\b/i.test(instruction);
      // Only creating a shape is what the older grammar gets wrong in a
      // compound sentence ("and a cache" as a label); its other compound
      // forms, such as repairing a disconnected line, it reads reliably.
      const olderParse = parseIntentCanvasCommand(instruction, { activationPolicy: "externally_activated" });
      const compound =
        (pointingWords ||
          (isCompoundBoardCommand(instruction) &&
            olderParse.status === "parsed" &&
            olderParse.command.kind === "create_node")) &&
        Boolean(semanticIntentConfigRef.current?.available);
      const directResult = compound ? "rejected" : prepareIntentCommand(instruction, voiceTurnId);
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
      const deterministicGroundingFailed = !compound && deterministic.status === "parsed";
      const terminalConnectionGroundingFailure =
        !compound &&
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
      if (!compound && !deterministicGroundingFailed && !shouldUseSemanticIntentFallback(deterministic)) {
        return {
          result: "rejected",
          preparedText: instruction,
          source: "deterministic",
          stepCount: 0,
        };
      }
      const parserIssue = (
        compound
          ? "compound_command"
          : deterministic.status === "parsed" ? "grounding_failed" : deterministic.issue.code
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
      const requestLiveSelectionIds = currentSemanticSelectionIds();
      // "this"/"that" said while pointing at shapes Airo drew: the scene rules
      // can't edit those, so the planner gets them as the selection it reads
      // "this" from. The commit still checks the live selection.
      const pointedLegacyIds = DEICTIC_REFERENCE_PATTERN.test(instruction)
        ? pointedLegacyStrokeIds(requestBoardState, voiceReferenceRef.current)
        : [];
      const requestSelectionIds =
        pointedLegacyIds.length > 0 ? pointedLegacyIds : requestLiveSelectionIds;
      const pendingClarificationRecord =
        pendingSemanticClarificationRef.current;
      // A question stays open while the person answers, even if a hand or a
      // collaborator changes the board meanwhile; the planner gets the current
      // board with the question.
      const pendingClarificationIsCurrent =
        pendingClarificationRecord !== null &&
        Date.now() - pendingClarificationRecord.askedAt <= CLARIFICATION_ANSWER_MS;
      const pendingClarification = pendingClarificationIsCurrent
        ? pendingClarificationRecord.request
        : undefined;
      if (
        pendingClarificationRecord !== null &&
        !pendingClarificationIsCurrent
      ) {
        pendingSemanticClarificationRef.current = null;
      }
      const requestPointer = voiceReferenceRef.current
        ? voiceReferenceRef.current.point
        : lastGesturePointerRef.current
          ? { ...lastGesturePointerRef.current }
          : null;
      const requestCanvasRect = canvasRef.current?.getBoundingClientRect();
      const executionSnapshot: SemanticExecutionSnapshot = {
        boardState: requestBoardState,
        selectionIds: requestSelectionIds,
        baseSelectionIds: requestLiveSelectionIds,
        requestSelectionIds: [...requestSelectionIds],
        primarySelectionId: requestSelectionIds[requestSelectionIds.length - 1] ?? null,
        hoverStrokeId: pointedLegacyIds.at(-1) ?? hoverStrokeId,
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
          // Speech meant for Airo is a board request: a narrated flow is drawn.
          ...(() => {
            const addressedBy = !voiceTurnId
              ? "typed"
              : voiceAddressedByRef.current
                ? voiceAddressedByRef.current.addressedBy
                : "wake";
            return addressedBy ? { addressedBy } : {};
          })(),
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
        const currentSelectionIds = currentSemanticSelectionIds();
        const selectionChangedDuringPlanning =
          currentSelectionIds.length !== requestLiveSelectionIds.length ||
          currentSelectionIds.some((strokeId, index) => strokeId !== requestLiveSelectionIds[index]);
        if (boardChangedDuringPlanning || selectionChangedDuringPlanning) {
          // Someone edited, or a hand changed the selection, while Airo was
          // planning. Apply the plan to the board as it is now, still aimed at
          // what was selected when the person spoke; steps whose shapes are
          // gone are skipped rather than the whole command being dropped.
          const stillThere = requestSelectionIds.filter(
            (id) => boardRef.current.strokes[id]?.status === "committed" || isSceneOnlyElement(boardRef.current, id),
          );
          executionSnapshot.boardState = boardRef.current;
          executionSnapshot.selectionIds = stillThere;
          executionSnapshot.primarySelectionId = stillThere[stillThere.length - 1] ?? null;
          // The commit compares against the selection as it is now; plan
          // targets still resolve against `stillThere`.
          executionSnapshot.baseSelectionIds = currentSelectionIds;
          executionSnapshot.requestSelectionIds = [...requestSelectionIds];
          if (voiceTurnId) {
            reportVoiceTrace(voiceTurnId, "grounding", {
              status: "rebased",
              source: "semantic",
              boardChangedDuringPlanning,
              selectionChangedDuringPlanning,
            });
          }
        }
        if (resolution.outcome === "already_satisfied") {
          pendingSemanticClarificationRef.current = null;
          if (!voiceTurnId) setIntentCommandText(instruction);
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
                          MAX_CLARIFICATION_TRANSCRIPT_CHARS,
                        )
                      : instruction,
                    question: plan.clarificationQuestion,
                    missingSlots: [...plan.missingSlots],
                  },
                  boardState: requestBoardState,
                  selectionIds: requestSelectionIds,
                  askedAt: Date.now(),
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
        if (!voiceTurnId) setIntentCommandText(instruction);
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
      currentSemanticSelectionIds,
      appendCopilotActivity,
      effectiveAccessToken,
      executeSceneIntent,
      hoverStrokeId,
      prepareIntentCommand,
      prepareSceneFanIn,
      prepareSemanticActionPlan,
      reportAttributedVoiceFollowUp,
      reportVoiceTrace,
      toBoardPoint,
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
        currentSelectionIds: currentSemanticSelectionIds(),
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
        sceneRedoStackRef.current = [];
        undoStackRef.current.push({
          type: "diagram",
          undoEvents,
          redoEvents: forwardEvents,
          selectionBefore: [...pending.baseSelectionIds],
          ...(pending.voiceTurnId
            ? { originatingInteractionId: pending.voiceTurnId }
            : {}),
        });
      }
      boardRef.current = nextState;
      // Compound and Airo commands apply as one batch, outside applyLocalEvent,
      // so they schedule the save themselves.
      schedulePersistentSnapshot(nextState);
      if (pending.voiceTurnId && undoEvents.length > 0) {
        interactionAttributionRef.current!.record({
          interactionId: pending.voiceTurnId,
          outcome: "applied",
          occurredAtMs: committedAtMs,
        });
      }
      const finalSelection = commit.selectionIds;
      refreshRealtimeSpeechKeyterms(nextState, finalSelection);
      // Shapes from typed commands and the toolbar are selected as scene
      // elements; the board selects one kind at a time, and Airo's own nodes win.
      const annotationSelection = finalSelection.filter((id) => !isSceneOnlyElement(nextState, id));
      if (annotationSelection.length === 0 && finalSelection.length > 0) {
        selectSceneElements(finalSelection);
      } else {
        const primary = annotationSelection[annotationSelection.length - 1] ?? null;
        setSelectedAnnotationIds(annotationSelection);
        setSelectedAnnotationId(primary);
        setLabelDraft(primary ? (nextState.strokes[primary]?.annotation?.label ?? "") : "");
      }
      setEditingAnnotationId(null);
      setActiveObjectTool("select");
      setIntentCommandText("");
      setCommandFeedback(`Applied: ${pending.message}`);
      appendCopilotActivity({
        source: "Board",
        title: "Board updated",
        undoable: true,
        detail: pending.message,
        tone: "success",
      });
      voiceCorrectionPendingRef.current = null;
      pendingIntentRef.current = null;
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
    currentSemanticSelectionIds,
    appendCopilotActivity,
    cancelPendingIntent,
    refreshRealtimeSpeechKeyterms,
    render,
    reportVoiceTrace,
    schedulePersistentSnapshot,
    selectSceneElements,
  ]);

  useEffect(() => {
    applyPendingIntentRef.current = applyPendingIntent;
    return () => {
      applyPendingIntentRef.current = null;
    };
  }, [applyPendingIntent]);

  /**
   * "here", "this" and "that": what was pointed at when speech began, the
   * shapes the hand visited while speaking ("this", then "that"), and what is
   * pointed at now. Read once, when the command is routed.
   */
  const captureVoiceReference = useCallback((): VoiceReference => {
    const started = speechStartPointingRef.current;
    speechStartPointingRef.current = null;
    const now = currentPointingRef.current?.() ?? null;
    const visited = resolveHandPointing(handPointingSnapshotRef.current, {
      now: Date.now(),
      count: 2,
    }).targetIds;
    return {
      point: started?.point ?? now?.point ?? null,
      startTargetId: started?.targetId ?? null,
      pointedIds: [
        ...new Set([started?.targetId, ...visited, now?.targetId].filter((id): id is string => Boolean(id))),
      ].slice(-2),
    };
  }, []);

  const queueVoiceCommand = useCallback((command: string, traceContext?: VoiceCommandTraceContext) => {
    const voiceTurnId = traceContext?.voiceTurnId;
    // Captured now, never when the queued command runs.
    const reference = traceContext?.reference ?? captureVoiceReference();
    const addressedBy: SemanticIntentAddressedBy | undefined =
      traceContext?.wakePhrase === "push-to-talk"
        ? "palm"
        : traceContext?.wakePhrase === "hold-to-edit"
          ? "hold"
          : traceContext?.wakePhrase === "follow-up" || traceContext?.wakePhrase === "answer"
            ? undefined
            : "wake";
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
        // What Airo heard is shown as status, never put in the typing box:
        // a voice command is not a draft waiting for Send.
        setSpeechHeardText(instruction);
        setSpeechRecognitionStatus("interpreting");
        setCommandFeedback(`Working on “${truncateSpeechTranscript(instruction)}”…`);
        playAiroCue("heard");
        appendCopilotActivity({
          source: "Airo",
          title: "Understanding command",
          detail: instruction,
          tone: "active",
        });
        voiceAddressedByRef.current = { addressedBy };
        voiceReferenceRef.current = reference;
        // A voice edit while the hand holds a v2 element applies after the grab.
        settleHandSceneMove();
        let outcome: IntentPreparationOutcome;
        try {
          outcome =
            (await prepareIntentCommandWithSemanticRef.current?.(instruction, voiceTurnId)) ?? {
              result: "rejected" as const,
              preparedText: instruction,
              source: "deterministic" as const,
              stepCount: 0,
            };
        } finally {
          voiceReferenceRef.current = null;
          voiceAddressedByRef.current = null;
        }
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
        // Let the preparer's own status line render, then read it back.
        await nextAnimationFrame();
        if (outcome.result === "rejected") {
          const question = pendingSemanticClarificationRef.current?.request.question;
          if (question) {
            // Airo needs one detail: the next sentence answers it, no "Airo" needed.
            voiceRouter.openAnswerWindow?.();
            showAiroNotice({ tone: "question", detail: question });
            playAiroCue("question");
          } else {
            const reason = commandFeedbackRef.current;
            showAiroNotice({
              tone: "warning",
              detail: reason && !reason.startsWith("Working on")
                ? `${reason} Say it again in other words.`
                : "Didn't get that. Say it again in other words.",
            });
            playAiroCue("failed");
          }
          appendCopilotActivity({
            source: "Airo",
            title: question ? "Question" : "Could not apply",
            detail: question ?? "Say the command again, in other words if you can.",
            tone: "warning",
          });
        } else {
          playAiroCue("applied");
        }
        // The follow-up window counts from the visible result, and only a
        // command that worked opens it.
        if (outcome.result !== "rejected") voiceRouter.noteCommandSettled();
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
        setCommandFeedback("Something went wrong applying that. Say it again.");
        showAiroNotice({ tone: "warning", detail: "Something went wrong applying that. Say it again." });
        playAiroCue("failed");
        appendCopilotActivity({
          source: "Airo",
          title: "Automatic command failed",
          detail: "Say the command again.",
          tone: "warning",
        });
      });
  }, [appendCopilotActivity, captureVoiceReference, reportAttributedVoiceFollowUp, reportVoiceTrace, settleHandSceneMove, showAiroNotice, voiceRouter]);

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
    const label = (strokeId && boardTargetLabel(boardRef.current, strokeId)) || "this object";
    setVoiceGate({ mode: "scoped", strokeId, label });
  }, [voiceRouter]);

  /**
   * The panel is on the presented tab, so it only ever shows speech meant for
   * Airo: a gate is open, the wake word was said, or a follow-up is expected.
   * Everything else in the room stays off screen.
   */
  const showHeardSpeech = useCallback(
    (transcript: string) => {
      const addressed =
        voiceRouter.snapshot !== null ||
        voiceRouter.expectsFollowUp?.() === true ||
        classifyBrowserWakeTranscript(transcript).wakeDetected;
      setSpeechHeardText(addressed ? transcript : "");
    },
    [voiceRouter],
  );

  const openVoiceGate = useCallback(
    (gate: { mode: VoiceGateMode; strokeId?: string }) => {
      voiceRouter.openGate(gate);
      voiceCoalescer.setGateOpen(true);
      syncVoiceGateUi();
      const micArmed = Boolean(speechSessionRef.current);
      // Only the tab in use wakes: a second visible window sees the same palm.
      if (!micArmed && voiceDroppedRef.current && voiceOwnerRef.current && startVoiceCommandRef.current) {
        // Voice paused or dropped on its own; an open palm means the person
        // wants to talk, so wake it. The gate stays open for the command.
        startVoiceCommandRef.current();
        setCommandFeedback("Waking Airo's voice… speak once it's listening.");
        return;
      }
      if (gate.mode === "ptt") {
        setCommandFeedback(
          micArmed
            ? "Open palm recognized — speak a board command, then relax your hand."
            : `Open palm recognized, but Airo's voice is off: ${voiceOffReasonRef.current}`,
        );
        return;
      }
      const label =
        (gate.strokeId && boardTargetLabel(boardRef.current, gate.strokeId)) || "this object";
      setCommandFeedback(
        micArmed
          ? `Editing “${label}”: say “rename to …”, “delete”, “duplicate”, or “connect to …”.`
          : `Holding “${label}”, but Airo's voice is off: ${voiceOffReasonRef.current}`,
      );
    },
    [syncVoiceGateUi, voiceCoalescer, voiceRouter],
  );

  const closeVoiceGate = useCallback(
    (mode: VoiceGateMode) => {
      voiceRouter.closeGate(mode);
      // Dropping the palm sends what was said, after a short trailing grace.
      voiceCoalescer.setGateOpen(false);
      syncVoiceGateUi();
    },
    [syncVoiceGateUi, voiceCoalescer, voiceRouter],
  );

  const processPalmVoiceGestureFrame = useCallback(
    (frame: PalmVoiceGestureFrame): PalmVoiceGestureEvent => {
      // An open palm aimed at a dock tile is pointing, not talking. With
      // `aiming` the tracker never latches there, so the hold starts again
      // as soon as the hand leaves the dock, without lowering it.
      const event = palmVoiceGestureTrackerRef.current!.update({
        ...frame,
        aiming: frame.aiming === true || handAimTargetRef.current !== null,
      });
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

  const runVoiceDecision = useCallback(
    (decision: VoiceRouteDecision, metadata: VoiceDecisionMetadata) => {
      queueVoiceCommand(decision.command, {
        voiceTurnId: metadata.voiceTurnId ?? crypto.randomUUID(),
        transcript: decision.transcript,
        wakePhrase: decision.wakePhrase,
        engine: metadata.engine,
        provider: metadata.provider,
        model: metadata.model,
        confidence: metadata.confidence,
        turnIndex: metadata.turnIndex,
        reference: metadata.reference,
      });
    },
    [queueVoiceCommand],
  );
  runVoiceDecisionRef.current = runVoiceDecision;

  /**
   * Every routed command passes through the coalescer, which holds it for a
   * moment so a thinking pause doesn't cut it ("Airo, add a database…
   * called Orders" is one command). It keeps each command's trace metadata.
   */
  const dispatchVoiceDecision = useCallback(
    (decision: VoiceRouteDecision, metadata: VoiceDecisionMetadata) => {
      const withReference: VoiceDecisionMetadata = {
        ...metadata,
        reference: metadata.reference ?? captureVoiceReference(),
      };
      // Nothing held means no metadata either (a cancel may have dropped the
      // held command), so a stale record never labels this one.
      if (!voiceCoalescer.pending) heldVoiceMetaRef.current = null;
      incomingVoiceMetaRef.current = withReference;
      voiceCoalescer.push(decision);
      incomingVoiceMetaRef.current = null;
      if (voiceCoalescer.pending && !heldVoiceMetaRef.current) {
        heldVoiceMetaRef.current = withReference;
      }
    },
    [captureVoiceReference, voiceCoalescer],
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
      // One sentence, one pointing record, shared by every command in it.
      const reference = decisions.length > 0 ? captureVoiceReference() : undefined;
      for (const decision of decisions) {
        dispatchVoiceDecision(decision, { ...metadata, voiceTurnId, reference });
      }
      // Speech after a pause that finishes the held command ("called Orders").
      const continued = decisions.length === 0 && voiceCoalescer.offerContinuation(transcript);
      reportVoiceTrace(voiceTurnId, "routing", {
        routed: decisions.length > 0 || continued,
        wakeDetected,
        decisionCount: decisions.length,
        channel: continued ? "continuation" : voiceTraceChannel(decisions[0]),
      });
      return { routed: decisions.length > 0 || continued, wakeDetected, voiceTurnId };
    },
    [
      captureVoiceReference,
      dispatchVoiceDecision,
      reportVoiceTrace,
      syncVoiceGateUi,
      voiceCoalescer,
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
        voiceCoalescer.cancel();
        heldVoiceMetaRef.current = null;
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
          activeCreationTool: activeCreationToolRef.current,
          selectedElementIds: [...selectedElementIdsRef.current],
          selectedAnnotationIds: [...selectedAnnotationIdsRef.current],
        };
      },
      getHandPointingSnapshot: () => structuredClone(handPointingSnapshotRef.current),
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
    voiceCoalescer,
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

  // Voice starts as the board opens, so it can connect just after a first
  // typed command; its start-up messages keep that command's result.
  const showVoiceStartFeedback = useCallback((text: string) => {
    setCommandFeedback((current) => (current.startsWith("Applied:") ? current : text));
  }, []);

  /** The hand's (or mouse's) recent pointing, with the shape under it. */
  const currentPointing = useCallback((): SpeechPointing | null => {
    // The hand first: its recorder knows which shape it is over.
    const hand = resolveHandPointing(handPointingSnapshotRef.current, {
      now: Date.now(),
      maxAgeMs: SPEECH_POINTING_MAX_AGE_MS,
    });
    if (hand.here) {
      return { at: Date.now(), point: hand.here, targetId: hand.targetIds.at(-1) ?? null };
    }
    const point = lastGesturePointerRef.current;
    if (!point || Date.now() - lastGesturePointerAtRef.current > SPEECH_POINTING_MAX_AGE_MS) return null;
    const target = findSceneElementAtPoint(boardRef.current, point);
    return { at: Date.now(), point: { ...point }, targetId: target?.id ?? null };
  }, []);
  currentPointingRef.current = currentPointing;
  /** Called on the first sound of a new utterance. */
  const captureSpeechStartPointing = useCallback(() => {
    speechStartPointingRef.current = currentPointing();
  }, [currentPointing]);

  const startVoiceCommand = useCallback(() => {
    const activeSession = speechSessionRef.current;
    if (activeSession) {
      semanticIntentRequestIdRef.current += 1;
      speechSessionRef.current = null;
      // Clear ownership before stop(): a session that has not opened its socket
      // can report "stopped" synchronously. That intentional stop must never be
      // mistaken for an unexpected provider close.
      activeSession.stop();
      markVoiceDropped(false);
      voiceRouter.reset();
      voiceCoalescer.cancel();
      heldVoiceMetaRef.current = null;
      setVoiceGate(null);
      setSpeechArmed(false);
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
      if (commandWasRouted) {
        return;
      }
      showHeardSpeech(transcript);
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
        engine: metadata?.engine ?? "realtime",
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
        // Room talk: nothing to show or say. It isn't echoed to the presented
        // tab, and it doesn't replace Airo's last result or question.
        setSpeechRecognitionStatus("waiting");
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
      engine: "realtime",
      surface: "standalone",
      source: "browser_media",
    });

    markVoiceDropped(false);
    let realtimeSession: RealtimeSpeechSession | null = null;
    // Why this session's stream is reconnecting, until it listens again,
    // and whether it has listened yet: a retry before the first listen is
    // still the first connection, with its first-run hint.
    let reconnectCause: RealtimeSpeechReconnectCause | null = null;
    let listenedOnce = false;
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
          setSpeechArmed(true);
          setSpeechRecognitionStatus("waiting");
          showVoiceStartFeedback("Starting Airo's voice…");
        },
        onListening: (listening) => {
          if (listening) {
            void refreshStandaloneMediaPermissions();
            setSpeechRecognitionStatus("waiting");
            const resumedFrom = listenedOnce ? reconnectCause : null;
            reconnectCause = null;
            listenedOnce = true;
            if (resumedFrom) {
              // A time-limit rollover is silent; after a drop, say voice is back.
              if (resumedFrom !== "rollover") {
                setCommandFeedback("Airo is listening again.");
              }
              return;
            }
            // Voice now starts as the board opens, so it can connect just
            // after a first typed command; keep that command's result.
            showVoiceStartFeedback("Airo is listening. Say “Airo, add a user.”");
          }
        },
        onAllowanceWarning: (warning) => {
          // Voice keeps working; this only says the day's minutes are low.
          setCommandFeedback(warning.message);
          showAiroNotice({ tone: "warning", detail: warning.message });
        },
        onInterim: (transcript) => {
          if (!voiceCaptureInteractionIdRef.current) {
            captureSpeechStartPointing();
            const voiceTurnId = crypto.randomUUID();
            voiceCaptureInteractionIdRef.current = voiceTurnId;
            reportVoiceTrace(voiceTurnId, "capture_started", {
              engine: "realtime",
              surface: "standalone",
              source: "browser_media",
              continuedSession: true,
            });
          }
          voiceRouter.noteSpeechActivity();
          voiceCoalescer.noteSpeechActivity();
          showHeardSpeech(transcript);
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
        onReconnecting: (cause) => {
          reconnectCause = cause;
          setSpeechRecognitionStatus("waiting");
          if (cause === "busy") {
            setCommandFeedback(
              "Airo's voice is busy right now. Retrying in a moment; typed commands still work.",
            );
          } else if (cause === "dropped") {
            setCommandFeedback("Reconnecting Airo's voice…");
          }
        },
        onError: (message) => {
          void refreshStandaloneMediaPermissions();
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
        onEnd: (reason, detail) => {
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
          voiceCoalescer.cancel();
          heldVoiceMetaRef.current = null;
          setVoiceGate(null);
          speechSessionRef.current = null;
          setSpeechArmed(false);
          // Only an end that trying again can fix lets a palm or the power
          // button bring voice back; a used-up allowance, an admin's switch
          // or a blocked microphone must not restart it on every palm.
          markVoiceDropped(detail?.wakeable === true);
          if (reason === "paused") {
            setSpeechRecognitionStatus("idle");
            setCommandFeedback(
              "Airo's voice paused after a long quiet stretch. Hold an open palm to resume; typed commands still work.",
            );
            return;
          }
          if (reason === "error" || reason === "closed") {
            setSpeechRecognitionStatus("error");
            if (reason === "closed") {
              setCommandFeedback(
                "Airo's voice connection closed. Hold an open palm to reconnect, or reload the board; typed commands still work.",
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
        getAccessToken: () => latestAccessTokenRef.current,
        // Server restarts, network drops, a busy server and the per-stream
        // time limit replace the stream instead of ending voice, and a
        // forgotten, quiet tab stops streaming.
        reconnect: true,
        quietPauseMs: VOICE_QUIET_PAUSE_MS,
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
    showVoiceStartFeedback("Starting Airo's voice…");
    realtimeSession.start();
  }, [
    showVoiceStartFeedback,
    showHeardSpeech,
    captureSpeechStartPointing,
    showAiroNotice,
    voiceCoalescer,
    effectiveAccessToken,
    markVoiceDropped,
    realtimeTranscriptionConfig?.defaultModel,
    realtimeTranscriptionConfig?.dynamicKeyterms,
    refreshStandaloneMediaPermissions,
    routeFinalTranscript,
    speechEngine,
    speechSupported,
    reportVoiceTrace,
    voiceRouter,
  ]);

  useEffect(() => {
    startVoiceCommandRef.current = startVoiceCommand;
  }, [startVoiceCommand]);

  const stopCamera = useCallback(() => {
    cameraStartInProgressRef.current = false;
    const video = videoRef.current;
    stopMediaStream(cameraStreamRef.current ?? (video?.srcObject as MediaStream | null));
    cameraStreamRef.current = null;
    if (video) {
      video.srcObject = null;
    }
    trackerRef.current?.close();
    trackerRef.current = null;
    canvasNavTrackerRef.current?.reset();
    gestureActionEvidenceTrackerRef.current?.reset();
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
  }, [cancelObjectInteraction, closeVoiceGate, reportGestureTrace]);

  const startCamera = useCallback(async () => {
    if (cameraBlockedMessage) {
      setCameraStatus("idle");
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

    // Release anything acquired if the component unmounted during an await.
    const releaseIfUnmounted = (stream: MediaStream | null, tracker: MediaPipeHandTracker | null) => {
      if (cameraMountedRef.current) {
        return false;
      }
      stream?.getTracks().forEach((track) => track.stop());
      tracker?.close();
      return true;
    };

    // Load hand tracking (about 11 MB on a first visit) while the browser asks
    // for the camera, so the download overlaps the prompt instead of following
    // it. A tracker nobody adopts is closed once it arrives (see finally).
    let trackerLoad: Promise<MediaPipeHandTracker> | null = null;
    let trackerSettled = false;
    try {
      trackerLoad = MediaPipeHandTracker.create({
        wasmBaseUrl: "/vendor/mediapipe/wasm",
        ...handPerceptionOptions(confidenceThreshold),
      });
      // Awaited below; this only keeps a load failed before then from going unhandled.
      trackerLoad.catch(() => undefined);
      // Some browsers take seconds to show their prompt (opening the camera,
      // or another app holding it), so say what Airboard is waiting for.
      const promptHint = window.setTimeout(() => {
        setCameraPromptWaiting(true);
        appendCopilotActivity({
          source: "Airo",
          title: "Waiting for the camera",
          detail: CAMERA_PROMPT_HINT,
          tone: "warning",
        });
      }, CAMERA_PROMPT_HINT_DELAY_MS);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
      } finally {
        window.clearTimeout(promptHint);
        setCameraPromptWaiting(false);
      }
      if (releaseIfUnmounted(stream, null)) {
        return;
      }
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element is unavailable");
      }

      cameraStreamRef.current = stream;
      // Unplugged, taken by another app, or revoked by the OS: the track
      // ends on its own (stopping it ourselves never fires "ended").
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (cameraStreamRef.current === stream) recoverCameraRef.current?.("track_ended");
        });
      }
      video.srcObject = stream;
      await video.play();
      setCameraStatus("tracker_loading");
      const tracker = await trackerLoad;
      trackerSettled = true;
      if (releaseIfUnmounted(stream, tracker)) {
        video.srcObject = null;
        return;
      }
      trackerRef.current = tracker;
      gestureTraceJournalRef.current?.clear();
      gestureInteractionIdRef.current = crypto.randomUUID();
      setCameraStatus("active");
      void refreshStandaloneMediaPermissions();
    } catch (error) {
      const isPermissionError = error instanceof DOMException && error.name === "NotAllowedError";
      const hadVideoStream = Boolean(videoRef.current?.srcObject);
      // Release the camera on any failure (commonly a MediaPipe WASM/model load
      // error). Otherwise the acquired MediaStream keeps the camera light on with
      // no live tracking, and a retry acquires a second stream, orphaning this one.
      const video = videoRef.current;
      stopMediaStream(cameraStreamRef.current ?? (video?.srcObject as MediaStream | null));
      cameraStreamRef.current = null;
      if (video) {
        video.srcObject = null;
      }
      trackerRef.current?.close();
      trackerRef.current = null;
      setCameraStatus(isPermissionError ? "blocked" : hadVideoStream ? "tracker_error" : "error");
      void refreshStandaloneMediaPermissions();
      if (cameraRecoveryRef.current.attempt > 0 && shouldRetryCameraStart(error)) {
        // A restart attempt failed (the camera is still busy or unplugged):
        // keep backing off instead of leaving hands off until a reload.
        const retry = recoverCameraRef.current;
        window.setTimeout(() => retry?.("start_failed"), 0);
      } else if (cameraRecoveryRef.current.attempt > 0) {
        cameraRecoveryRef.current.attempt = 0;
      }
    } finally {
      cameraStartInProgressRef.current = false;
      if (!trackerSettled) {
        void trackerLoad?.then((tracker) => tracker.close(), () => undefined);
      }
    }
  }, [appendCopilotActivity, cameraBlockedMessage, cameraStatus, confidenceThreshold, enforceCameraCanvas, refreshStandaloneMediaPermissions]);

  startCameraRef.current = startCamera;

  const cancelCameraRecovery = useCallback(() => {
    const recovery = cameraRecoveryRef.current;
    if (recovery.timer !== null) clearTimeout(recovery.timer);
    if (recovery.stableTimer !== null) clearTimeout(recovery.stableTimer);
    cameraRecoveryRef.current = { attempt: 0, timer: null, stableTimer: null, pending: false };
  }, []);

  /**
   * Camera and hand-tracker auto-recovery (gap 12). A tracker error or an ended
   * camera track restarts both on their own with
   * backoff, no click needed. The palm voice gate comes back with the tracker
   * because every frame again flows through the same coordinator.
   */
  const recoverCamera = useCallback(
    (reason: CameraRecoveryReason) => {
      const recovery = cameraRecoveryRef.current;
      if (recovery.timer !== null) return;
      if (recovery.stableTimer !== null) {
        clearTimeout(recovery.stableTimer);
        recovery.stableTimer = null;
      }
      if (reason !== "start_failed") stopCamera();
      if (recovery.attempt >= CAMERA_RECOVERY_MAX_ATTEMPTS) {
        cameraRecoveryRef.current = { attempt: 0, timer: null, stableTimer: null, pending: false };
        setCameraStatus("tracker_error");
        return;
      }
      const delayMs = cameraRecoveryDelayMs(recovery.attempt);
      recovery.attempt += 1;
      recovery.pending = true;
      setCameraStatus("tracker_error");
      reportGestureTrace({
        interactionId: gestureInteractionIdRef.current ?? "camera-recovery",
        frameAtMs: performance.now(),
        stage: "cancellation",
        data: { reason: `camera_recovery_${reason}`, attempt: recovery.attempt },
      });
      recovery.timer = setTimeout(() => {
        recovery.timer = null;
        recovery.pending = false;
        void startCameraRef.current?.();
      }, delayMs);
    },
    [reportGestureTrace, stopCamera],
  );
  recoverCameraRef.current = recoverCamera;

  useEffect(() => {
    // A camera that keeps running after a restart resets the backoff.
    if (cameraStatus !== "active" || cameraRecoveryRef.current.attempt === 0) return;
    const recovery = cameraRecoveryRef.current;
    recovery.stableTimer = setTimeout(() => {
      recovery.stableTimer = null;
      recovery.attempt = 0;
    }, CAMERA_RECOVERY_STABLE_MS);
    return () => {
      if (recovery.stableTimer !== null) {
        clearTimeout(recovery.stableTimer);
        recovery.stableTimer = null;
      }
    };
  }, [cameraStatus]);

  useEffect(() => {
    // A camera plugged back in shortens the wait: retry now.
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!devices?.addEventListener) return;
    const retryNow = () => {
      const recovery = cameraRecoveryRef.current;
      if (!recovery.pending || recovery.timer === null) return;
      clearTimeout(recovery.timer);
      recovery.timer = null;
      recovery.pending = false;
      void startCameraRef.current?.();
    };
    devices.addEventListener("devicechange", retryNow);
    return () => devices.removeEventListener("devicechange", retryNow);
  }, []);

  useEffect(() => () => cancelCameraRecovery(), [cancelCameraRecovery]);

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

  const airoInputsActive = speechArmed || cameraStatus === "active";
  // Without a switch, a blocked camera or microphone is the one thing the
  // panel must explain.
  const airoBlockedByBrowser =
    !airoInputsActive &&
    (cameraPermission === "denied" || microphonePermission === "denied" || cameraStatus === "blocked");

  // Airo's voice and hands start as soon as a board opens: the first time,
  // the browser asks once for the camera and microphone together. There is no
  // switch to turn them on. Only an input the person blocked in the browser,
  // turned off in Settings → Preferences, or their workspace admin turned off,
  // stays off; a board opened in a background tab waits until it is shown.
  const cameraStatusRef = useRef(cameraStatus);
  cameraStatusRef.current = cameraStatus;
  const [boardTabVisible, setBoardTabVisible] = useState(true);
  // The browser didn't allow an input it was asked for (dismissed or refused).
  const [airoAskDeclined, setAiroAskDeclined] = useState(false);
  // Voice needs an Airboard sign-in; an anonymous live-link guest has none.
  const voiceSignInMissing = liveGuest && !effectiveAccessToken;
  useEffect(() => {
    if (
      !boardTabVisible ||
      airoAutoStartAttemptedRef.current ||
      speechEngine === "loading"
    ) {
      return;
    }
    airoAutoStartAttemptedRef.current = true;
    void (async () => {
      const [microphone, camera] = await Promise.all([
        queryMediaPermission("microphone"),
        queryMediaPermission("camera"),
      ]);
      const plan = airoStartPlan({
        voice:
          speechSupported &&
          !voiceSignInMissing &&
          initialPreferences?.audioEnabled !== false &&
          organizationPolicy?.voiceEnabled !== false,
        camera: initialPreferences?.videoEnabled !== false && !cameraBlockedMessage,
        microphonePermission: microphone,
        cameraPermission: camera,
      });
      const access = await requestMediaAccess(
        plan.ask,
        navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices),
      );
      if (!boardMountedRef.current) return;
      void refreshStandaloneMediaPermissions();
      airoCameraWantedRef.current = plan.camera && access.video;
      // The Airo panel explains it; the command line keeps whatever the person
      // did while the prompt was open.
      // Declined means nothing asked for came through; a missing camera with a
      // working microphone is not a refusal.
      const askedAny = plan.ask.audio || plan.ask.video;
      if (askedAny && !(plan.ask.audio && access.audio) && !(plan.ask.video && access.video)) {
        setAiroAskDeclined(true);
      }
      if (plan.camera && access.video) void startCameraRef.current?.();
      if (plan.voice && access.audio && !speechSessionRef.current) {
        // Another board tab took voice while this one was starting: wake it
        // when this tab is used again.
        if (voiceOwnerRef.current) startVoiceCommandRef.current?.();
        else markVoiceDropped(true);
      }
    })();
  }, [
    boardTabVisible,
    cameraBlockedMessage,
    markVoiceDropped,
    initialPreferences?.audioEnabled,
    initialPreferences?.videoEnabled,
    organizationPolicy?.voiceEnabled,
    refreshStandaloneMediaPermissions,
    speechEngine,
    speechSupported,
    voiceSignInMissing,
  ]);

  // Without a switch, the Airo panel must say why an input is off.
  const airoNotAllowed = airoBlockedByBrowser || (airoAskDeclined && !airoInputsActive);
  const voiceOffReason =
    organizationPolicy?.voiceEnabled === false
      ? "your workspace admin turned voice off."
      : initialPreferences?.audioEnabled === false
        ? "Airboard audio input is off in Settings → Preferences."
        : voiceSignInMissing
          ? "sign in to Airboard to use voice on a live board."
          : microphonePermission === "denied"
            ? "the microphone is blocked for this site in your browser."
            : !speechSupported && speechEngine !== "loading"
              ? "voice isn't available right now."
              : airoAskDeclined
                ? "the browser didn't allow the microphone. Reload the board to be asked again."
                : null;
  voiceOffReasonRef.current = voiceOffReason ?? "it isn't listening right now. Type the command below.";

  // One board tab listens at a time: the one in use. Coming back to a tab,
  // or clicking or typing on its board, wakes voice that paused, dropped or
  // moved to another tab, and retries a camera that failed to start.
  useEffect(() => {
    const tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(performance.now());
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("airboard.voice-tab.v1");
    const wakeVoice = () => {
      if (
        boardMountedRef.current &&
        voiceOwnerRef.current &&
        voiceDroppedRef.current &&
        !speechSessionRef.current
      ) {
        startVoiceCommandRef.current?.();
      }
    };
    const claimVoice = () => {
      if (!voiceOwnerRef.current) {
        voiceOwnerRef.current = true;
      }
      channel?.postMessage({ type: "claim", tabId });
    };
    const onShown = () => {
      const visible = document.visibilityState === "visible";
      setBoardTabVisible(visible);
      if (!visible) return;
      // Uncovering a window isn't using it; focus claims too.
      if (document.hasFocus()) claimVoice();
      wakeVoice();
      const camera = cameraStatusRef.current;
      if (airoCameraWantedRef.current && (camera === "error" || camera === "tracker_error")) {
        void startCameraRef.current?.();
      }
    };
    const onInteract = () => {
      if (!voiceOwnerRef.current) claimVoice();
      wakeVoice();
    };
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; tabId?: unknown } | null;
        if (data?.type !== "claim" || data.tabId === tabId) return;
        voiceOwnerRef.current = false;
        if (speechSessionRef.current) {
          // startVoiceCommand stops a running session.
          startVoiceCommandRef.current?.();
          markVoiceDropped(true);
          setCommandFeedback(
            "Airo's voice moved to your other Airboard tab. Come back to this tab to bring it back; typed commands still work.",
          );
        }
      };
    }
    onShown();
    window.addEventListener("focus", onShown);
    document.addEventListener("visibilitychange", onShown);
    window.addEventListener("pointerdown", onInteract, true);
    window.addEventListener("keydown", onInteract, true);
    return () => {
      window.removeEventListener("focus", onShown);
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("pointerdown", onInteract, true);
      window.removeEventListener("keydown", onInteract, true);
      channel?.close();
    };
  }, [markVoiceDropped]);

  const closeShareDialog = useCallback(() => setShareOpen(false), []);

  // The owner's live-link controls in Share: whether guests may edit, and a
  // fresh link that stops the old one admitting anyone new.
  const liveLinkControls = useMemo<LiveLinkControls | undefined>(() => {
    if (!persistentBoardId || !activeBoardSessionId || liveSessionRole !== "owner" || !effectiveAccessToken) {
      return undefined;
    }
    return {
      guestsCanEdit,
      onGuestsCanEditChange: (allow) => {
        const sync = boardSyncRef.current;
        const sent = sync?.publish({
          ...createEventEnvelope({ boardSessionId: sync.boardSessionId, actorParticipantId: sync.participantId }),
          type: "permission.changed",
          allowParticipantDrawing: allow,
        });
        if (!sent) throw new Error("LIVE_SESSION_OFFLINE");
        setGuestsCanEdit(allow);
      },
      onNewLink: async () => {
        const response = await fetch(
          new URL(`/sessions/${encodeURIComponent(activeBoardSessionId)}/join-link`, AIRBOARD_API_URL).toString(),
          { method: "POST", headers: { Authorization: `Bearer ${effectiveAccessToken}` } },
        );
        const body = (await response.json().catch(() => null)) as { joinToken?: unknown } | null;
        if (!response.ok || typeof body?.joinToken !== "string") throw new Error("JOIN_LINK_RENEW_FAILED");
        setActiveJoinToken(body.joinToken);
        const participantId = boardSyncRef.current?.participantId;
        rememberLiveSession(persistentBoardId, {
          boardSessionId: activeBoardSessionId,
          joinToken: body.joinToken,
          ...(participantId ? { participantId } : {}),
        });
      },
    };
  }, [activeBoardSessionId, effectiveAccessToken, guestsCanEdit, liveSessionRole, persistentBoardId]);

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (exportsBlocked) {
      setCommandFeedback(EXPORTS_BLOCKED_MESSAGE);
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = exportCanvasPng(canvas);
    anchor.download = `airboard-${new Date().toISOString().replaceAll(":", "-")}.png`;
    anchor.click();
  }, [exportsBlocked]);

  const exportPdf = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (exportsBlocked) {
      setCommandFeedback(EXPORTS_BLOCKED_MESSAGE);
      return;
    }
    void downloadCanvasPdf(canvas).catch(() =>
      setCommandFeedback("The PDF couldn't be made in this browser. Export PNG still works."),
    );
  }, [exportsBlocked]);

  const copyBoardImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (exportsBlocked) {
      setCommandFeedback(EXPORTS_BLOCKED_MESSAGE);
      return;
    }
    void copyCanvasImage(canvas).then(
      () => setCommandFeedback("Copied the board as an image. Paste it into chat, a doc or slides."),
      () => setCommandFeedback("This browser blocked copying images. Use Export PNG instead."),
    );
  }, [exportsBlocked]);

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

    // A failed load is retried on its own (2 s, 4 s … up to a minute), so a
    // blip while the board opens doesn't leave voice off until a reload.
    let retryTimer: number | undefined;
    let attempt = 0;
    const loadConfig = (): void => { void fetchRealtimeTranscriptionConfig(AIRBOARD_API_URL)
      .then((config) => {
        if (cancelled) {
          return;
        }
        setRealtimeTranscriptionConfig(config);
        // The API's default model; there is no picker to change it.
        selectedSpeechModelRef.current = config.defaultModel ?? config.allowedModels[0] ?? "";

        if (config.available && supportsRealtimeSpeech()) {
          setSpeechEngine("realtime");
          setSpeechSupported(true);
          setCommandFeedback("Airo is ready. Hold an open palm and speak, or type below.");
          return;
        }

        const reason = config.available
          ? "This browser cannot stream microphone audio."
          : "Realtime voice is not configured on the Airboard API.";
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
        setSpeechEngine("unavailable");
        setSpeechSupported(false);
        setCommandFeedback(
          `${reason} Start the Airboard API, or keep using typed commands.`,
        );
        attempt += 1;
        retryTimer = window.setTimeout(loadConfig, configRetryDelayMs(attempt));
      }); };
    loadConfig();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    // Without these settings every command the fast rules miss is refused, so
    // a failed load keeps retrying in the background (1, 2, 4, 8, 15, then
    // every 30 s) until it works or the board closes.
    const controller = new AbortController();
    void loadSemanticIntentConfigWithRetry({
      apiBaseUrl: AIRBOARD_API_URL,
      signal: controller.signal,
      onAttemptFailed: () => {
        semanticIntentConfigRef.current = null;
      },
    })
      .then((config) => {
        if (controller.signal.aborted) return;
        semanticIntentConfigRef.current = config;
        // The API's default model; there is no picker to change it.
        selectedSemanticIntentModelRef.current = config.defaultModel ?? config.allowedModels[0] ?? "";
      })
      .catch(() => {
        // Aborted when the board closes or the settings are reloaded.
      });
    return () => controller.abort();
  }, []);

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
          canvasNavTrackerRef.current?.engaged === true ||
          objectInteractionRef.current !== null ||
          cameraGrabActiveRef.current ||
          cameraPlacementActiveRef.current ||
          pointerErasingRef.current,
      });
    },
    [processSnapGestureFrame],
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
          (snapshot?.mode === "scoped" && snapshot.open) ||
          palm.trackedHands !== 1 ||
          canvasNavTrackerRef.current?.reserving === true ||
          objectInteractionRef.current !== null ||
          cameraGrabActiveRef.current ||
          cameraPlacementActiveRef.current ||
          pointerErasingRef.current ||
          sceneMoveRef.current?.pointerId === HAND_SCENE_POINTER_ID,
      });
    },
    [processPalmVoiceGestureFrame, voiceRouter],
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
        diagramVisible: diagramVisibleRef.current,
        processPipeline: ({ hands, timestampMs, mapping }) =>
          pipelineRef.current.process({
            hands: [...hands],
            timestampMs,
            config: gestureConfig,
            frictionConfig,
            frictionPreset,
            markerInputMode,
            mapping,
          }),
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

          // A grab or carry in progress keeps the stream: a loosened fist
          // holds for about a second, and with a second hand in frame the
          // hand nearest the grab keeps it.
          const holding =
            cameraGrabActiveRef.current || cameraPlacementActiveRef.current;
          const rawSignal = selectLandmarkManipulationSignal(
            hands,
            pipelineResult?.hand,
            mapping,
            { holding, anchor: handSignalAnchorRef.current },
          );
          const signal = looseGrabHoldRef.current.apply(rawSignal, {
            holding,
            timestampMs: frame.timestampMs,
          });
          handSignalAnchorRef.current = signal?.point ?? handSignalAnchorRef.current;
          return {
            signal,
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
              // Two-hand pan/zoom never starts during a one-hand grab or
              // carry, and a second hand entering the frame can't cancel it.
              const holding =
                cameraGrabActiveRef.current || cameraPlacementActiveRef.current;
              const navUpdate = navTracker.update({
                hands: navigationHands,
                timestampMs,
                blocked: holding,
              });
              const reserving = shouldReserveLandmarkNavigation(
                hands.length,
                navTracker.reserving,
                holding && !navTracker.engaged,
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
                return false;
              }
              if (navTracker.engaged) {
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
            },
          },
        }),
        applyFrame: ({
          disposition,
          owner,
          pipelineResult,
          manipulationResult,
        }) => {
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
      closeVoiceGate,
      confidenceThreshold,
      currentViewportLimits,
      frictionConfig,
      frictionPreset,
      gestureConfig,
      handleGesture,
      markerInputMode,
      reportGestureStage,
      reportGestureTrace,
      updatePalmVoiceGesture,
      updateSnapGesture,
    ],
  );
  rawLandmarkFrameProcessorRef.current = processRawLandmarkFrame;

  /**
   * Hold-to-edit and gate housekeeping. Grabbing an element (hand or pointer)
   * and holding it still scopes the mic to that element; the scoped gate then
   * survives release for a grace window so "grab, let go, speak" works.
   * Closed gates expire here once their grace lapses.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (voiceRouter.expire()) {
        syncVoiceGateUi();
      }

      const interaction = objectInteractionRef.current;
      const snapshot = voiceRouter.snapshot;
      // The scoped gate's `strokeId` is a board target id: a legacy stroke id
      // or, for a v2 element the hand is holding, the scene element id.
      const handSceneMove =
        sceneMoveRef.current?.pointerId === HAND_SCENE_POINTER_ID ? sceneMoveRef.current : null;
      const movingStrokeId =
        interaction?.mode === "moving"
          ? interaction.strokeId
          : handSceneMove?.elementId ?? handSceneMoveResumeRef.current;
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
    openVoiceGate,
    reportGestureStage,
    syncVoiceGateUi,
    voiceRouter,
  ]);

  useEffect(() => {
    // Only run the detection loop while the camera is actually active. Previously
    // the loop rescheduled every frame regardless of camera state, waking the main
    // thread continuously (and draining battery) while the camera is off.
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
          recoverCameraRef.current?.("tracker_error");
          return;
        }
        const inferenceMs = performance.now() - inferenceStartedAt;
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
        });
      }

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    cameraStatus,
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

      if (shortcutsActiveRef.current && event.code === "Space") {
        event.preventDefault();
        panActiveRef.current = true;
        setTemporaryHandActive(true);
        return;
      }

      if (!event.shiftKey && (event.key === "Delete" || event.key === "Backspace")) {
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
        endActivePointerInteraction();
        handPanRef.current = null;
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
        cancelObjectInteraction();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "v" && scopedKeyActiveRef.current) {
        scopedKeyActiveRef.current = false;
        closeVoiceGate("scoped");
      }

      if (event.code === "Space") {
        panActiveRef.current = false;
        setTemporaryHandActive(false);
      }
    };

    const handleBlur = () => {
      handPanRef.current = null;
      panActiveRef.current = false;
      setTemporaryHandActive(false);
      endActivePointerInteraction();
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
      deleteSceneElement,
      duplicateSceneElement,
    endActivePointerInteraction,
    openVoiceGate,
    prepareIntentCommand,
    redoLastSceneAction,
    render,
    selectSceneElements,
    selectedAnnotationIds,
    setDiagramVisibility,
    undoLastAction,
  ]);

  useEffect(() => {
    cameraMountedRef.current = true;
    return () => {
      // Signal any in-flight startCamera to release what it acquires after its await.
      cameraMountedRef.current = false;
      const activeSpeechSession = speechSessionRef.current;
      speechSessionRef.current = null;
      activeSpeechSession?.abort();
      trackerRef.current?.close();
      // Element refs are already cleared here, so each stream is stopped
      // through its own ref; leaving a board must turn the camera off.
      stopMediaStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      screenUnderlayStartInProgressRef.current = false;
      stopMediaStream(screenUnderlayStreamRef.current);
      screenUnderlayStreamRef.current = null;
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.currentTarget.focus();
      shortcutsActiveRef.current = true;

      event.preventDefault();
      const screenPoint = getCanvasPoint(event);
      const point = toBoardPoint(screenPoint);
      const inputSource = strokeInputSourceForPointer(event.pointerType);
      if (activeCreationToolRef.current === "hand" || panActiveRef.current) {
        activePointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        handPanRef.current = {
          pointerId: event.pointerId,
          start: screenPoint,
          viewport: { ...boardViewportRef.current },
        };
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
        setGhostAnnotation(null);
        setGhostAnnotations([]);
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
    },
    [
      beginObjectInteraction,
      beginSceneDrawing,
      beginSceneMove,
      createSceneElementAtPoint,
      eraseAt,
      eraseSceneDrawingsAt,
      insertLinkAtPoint,
      makePoint,
      moveCursorPoint,
      requestMediaAtPoint,
      selectAnnotationObject,
      selectSceneElements,
      toBoardPoint,
      toggleAnnotationObject,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }

      const screenPoint = getCanvasPoint(event);
      const canvasPoint = toBoardPoint(screenPoint);
      const inputSource = strokeInputSourceForPointer(event.pointerType);
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
    },
    [
      appendSceneDrawingPoint,
      applyViewport,
      currentViewportLimits,
      eraseSceneDrawingsAt,
      makePoint,
      moveCursorPoint,
      moveObjectInteraction,
      previewSceneMove,
      toBoardPoint,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      event.preventDefault();
      if (handPanRef.current?.pointerId === event.pointerId) {
        handPanRef.current = null;
        activePointerIdRef.current = null;
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
      activePointerIdRef.current = null;
    },
    [
      commitSceneDrawing,
      commitSceneMove,
      endObjectInteraction,
      patchSceneElements,
      toBoardPoint,
    ],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
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
    [selectSceneElements, toBoardPoint],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
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
    },
    [applyViewport, currentViewportLimits],
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
    [cancelObjectInteraction, toBoardPoint, updatePlacementGhost],
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

  // Catalog drag-and-drop: dropping a creation-toolbar item places it at the
  // drop point, or arms it there when it needs a click to place.
  const handleCatalogDrop = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>) => {
      const creationTool = event.dataTransfer.getData(CREATION_DRAG_MIME) as CreationToolId;
      if (!creationTool) {
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
    },
    [
      activateCreationTool,
      createSceneElementAtPoint,
      insertLinkAtPoint,
      requestMediaAtPoint,
      toBoardPoint,
    ],
  );

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
  const editingSceneElement = editingElementId ? boardRef.current.elements[editingElementId] : undefined;
  const inlineTextTarget = editingSceneElement?.status === "active" &&
    (editingSceneElement.kind === "section" || isInlineTextEditable(editingSceneElement))
    ? editingSceneElement
    : null;
  const inlineTextBounds = inlineTextTarget
    ? sceneTextEditorBounds(inlineTextTarget, boardViewportRef.current, canvasRef.current)
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
    // Nothing more to save: the board is about to be deleted for good. If the
    // delete fails the unsaved edits are put back, to save with the next change.
    const unsaved = pendingPersistenceRef.current;
    pendingPersistenceRef.current = null;
    setDeleteStatus("deleting");
    setDeleteError(null);
    try {
      await onDeleteBoard();
    } catch (caught) {
      pendingPersistenceRef.current ??= unsaved;
      setDeleteStatus("error");
      setDeleteError(
        caught instanceof Error ? caught.message : "Could not delete this canvas.",
      );
    }
  }, [deleteStatus, onDeleteBoard]);

  return (
    <main className={`airboard-shell${diagramVisible ? "" : " diagram-hidden"}`}>
      {deleteDialogOpen ? (
        <DeleteBoardDialog
          deleteDialogRef={deleteDialogRef}
          boardTitle={boardTitle}
          deleteError={deleteError}
          deleteStatus={deleteStatus}
          setDeleteDialogOpen={setDeleteDialogOpen}
          setDeleteStatus={setDeleteStatus}
          setDeleteError={setDeleteError}
          confirmDeleteBoard={confirmDeleteBoard}
        />
      ) : null}
      {shareOpen ? (
        <ShareDialog
          boardTitle={boardTitle}
          liveLink={
            activeBoardSessionId && activeJoinToken
              ? liveBoardLink(window.location.origin, activeBoardSessionId, activeJoinToken)
              : null
          }
          liveUnavailable={
            !activeBoardSessionId && boardSyncStatus === "offline" ? liveStartProblem ?? "offline" : null
          }
          {...(liveLinkControls ? { liveControls: liveLinkControls } : {})}
          {...(shareAccess ? { access: shareAccess } : {})}
          onDownloadPng={exportPng}
          onCopyImage={copyBoardImage}
          onClose={closeShareDialog}
        />
      ) : null}
      <BoardTopBar
        liveGuest={liveGuest}
        titleEditing={titleEditing}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        titleCancelPendingRef={titleCancelPendingRef}
        commitTitleEdit={commitTitleEdit}
        restoreTitleFocusRef={restoreTitleFocusRef}
        cancelTitleEdit={cancelTitleEdit}
        titleButtonRef={titleButtonRef}
        boardTitle={boardTitle}
        onRenameBoard={onRenameBoard}
        beginTitleEdit={beginTitleEdit}
        boardSyncStatus={boardSyncStatus}
        titleStatus={titleStatus}
        persistentSaveStatus={persistentSaveStatus}
        titleError={titleError}
        activeBoardSessionId={activeBoardSessionId}
        shareButtonRef={shareButtonRef}
        shareMenuOpen={shareMenuOpen}
        setShareMenuOpen={setShareMenuOpen}
        setMoreMenuOpen={setMoreMenuOpen}
        shareMenuRef={shareMenuRef}
        setSettingsOpen={setSettingsOpen}
        setShareOpen={setShareOpen}
        exportPdf={exportPdf}
        exportPng={exportPng}
        copyBoardImage={copyBoardImage}
        moreMenuOpen={moreMenuOpen}
        settingsOpen={settingsOpen}
        moreMenuRef={moreMenuRef}
        screenUnderlayStatus={screenUnderlayStatus}
        recordingState={recordingState}
        stopScreenUnderlay={stopScreenUnderlay}
        startScreenUnderlay={startScreenUnderlay}
        onDeleteBoard={onDeleteBoard}
        setDeleteStatus={setDeleteStatus}
        setDeleteError={setDeleteError}
        setDeleteDialogOpen={setDeleteDialogOpen}
      />

      <div
        className={`content canvas-workspace${settingsOpen ? " settings-open" : ""}${
          copilotOpen ? " copilot-open" : ""
        }`}
      >
        <section
          className={`board-area${boardTheme === "lightboard" ? " lightboard" : ""}`}
          aria-label="Airboard canvas"
        >
          <AiroPanel
            copilotOpen={copilotOpen}
            speechArmed={speechArmed}
            cameraStatus={cameraStatus}
            voiceDropped={voiceDropped}
            airoBlockedByBrowser={airoBlockedByBrowser}
            airoNotAllowed={airoNotAllowed}
            setCopilotVisibility={setCopilotVisibility}
            speechHeardText={speechHeardText}
            voiceOffReason={voiceOffReason}
            speechRecognitionStatus={speechRecognitionStatus}
            copilotActivity={copilotActivity}
            commandFeedback={commandFeedback}
            runIntentCommand={runIntentCommand}
            intentCommandText={intentCommandText}
            intentCommandInputRef={intentCommandInputRef}
            semanticIntentRequestIdRef={semanticIntentRequestIdRef}
            setSpeechRecognitionStatus={setSpeechRecognitionStatus}
            speechSessionRef={speechSessionRef}
            setIntentCommandText={setIntentCommandText}
          />
          {boardTheme === "lightboard" && cameraUnderlayEnabled ? (
            <video
              ref={cameraUnderlayVideoRef}
              className="lightboard-underlay"
              data-testid="lightboard-underlay"
              aria-hidden="true"
              muted
              playsInline
            />
          ) : null}
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
          {boardTheme === "lightboard" ? (
            <div
              className="lightboard-scrim"
              data-testid="lightboard-scrim"
              style={{ opacity: scrimOpacity }}
              aria-hidden="true"
            />
          ) : null}
          {recordingState === "recording" ? (
            <div className="recording-badge" data-testid="recording-badge" role="status">
              <span className="recording-dot" aria-hidden="true" />
              REC {formatRecordingClock(recordingSeconds)}
            </div>
          ) : null}
          <SceneContextToolbar
            selected={selectedSceneElement}
            anchor={selectionAnchor}
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
          {/* Undo, redo and hide sit at the bottom left, level with the
             element catalog, so they're one click away without a menu. */}
          <CanvasHistoryControls
            undoLastAction={undoLastAction}
            redoLastSceneAction={redoLastSceneAction}
            diagramVisible={diagramVisible}
            setDiagramVisibility={setDiagramVisibility}
            diagramVisibleRef={diagramVisibleRef}
          />
          <>
            <CreationToolbar
              dockRef={dockRef}
              trailing={
                <div className="creation-toolbar-group canvas-dock-zoom" role="group" aria-label="Canvas zoom controls">
                  <button
                    type="button"
                    data-toolbar-button="true"
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
                    data-toolbar-button="true"
                    className="canvas-zoom-value"
                    aria-label={`${Math.round(viewportScale * 100)}%, reset canvas zoom`}
                    onClick={() => applyViewport({ ...IDENTITY_VIEWPORT })}
                  >
                    {Math.round(viewportScale * 100)}%
                  </button>
                  <button
                    type="button"
                    data-toolbar-button="true"
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
              }
              activeTool={temporaryHandActive ? "hand" : activeCreationTool}
              openPanel={openCatalogId}
              gestureHover={dockGestureHover}
              onOpenPanelChange={(panel) => {
                // Opened or closed with the mouse or keyboard: the hand leaves it alone.
                catalogOpenedByHandRef.current = false;
                cancelCatalogClose();
                setOpenCatalogId(panel);
              }}
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
          <BoardNotices
            airoNotice={airoNotice}
            undoToast={undoToast}
            undoLastAction={undoLastAction}
            voiceGate={voiceGate}
            speechArmed={speechArmed}
            cameraStatus={cameraStatus}
            objectGestureState={objectGestureState}
            handCue={handCue}
            onboardingVisible={onboardingVisible}
            finishOnboarding={finishOnboarding}
          />
          <canvas
            ref={canvasRef}
            role="application"
            aria-label="Airboard diagram canvas. Press Tab or Shift+Tab to cycle through objects and Enter or F2 to edit the selected object's label. Type commands such as add, move, or delete in the Type a board command field to create and change objects."
            aria-describedby="board-canvas-text"
            className={`board-canvas gesture-mode ${
              activeCreationTool === "hand" || temporaryHandActive ? "hand-mode" : ""
            }`}
            tabIndex={0}
            onContextMenu={(event) => event.preventDefault()}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(CREATION_DRAG_MIME)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={handleCatalogDrop}
            onFocus={() => {
              shortcutsActiveRef.current = true;
            }}
            onBlur={() => {
              shortcutsActiveRef.current = false;
            }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleCanvasDoubleClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          />
          <p className="sr-only" role="status">{selectionAnnouncement}</p>
          <section id="board-canvas-text" className="sr-only">
            <h2>Text on this board</h2>
            {boardTextForScreenReaders.length ? (
              <ul>{boardTextForScreenReaders.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
            ) : (
              <p>The board has no text yet.</p>
            )}
          </section>
          <div className="scene-playback-layer">
            <ScenePlaybackOverlay
              selected={selectedSceneElement}
              {...(effectiveAccessToken ? { accessToken: effectiveAccessToken } : {})}
              viewport={playbackViewport}
            />
          </div>
          {/* The element stays mounted (opacity 0) because the tracker reads its frames. */}
          {cameraStatus !== "idle" &&
          !(
            boardTheme === "lightboard" &&
            (cameraUnderlayEnabled || screenUnderlayStatus === "active")
          ) ? (
            <video ref={videoRef} className="camera-preview" muted playsInline />
          ) : (
            <video ref={videoRef} className="camera-preview hidden" muted playsInline />
          )}
          {inlineTextTarget && inlineTextBounds ? (
            <SceneTextEditor
              key={inlineTextTarget.id}
              initialText={richTextPlainValue(
                inlineTextTarget.kind === "section" ? inlineTextTarget.title : inlineTextTarget.content,
              )}
              label={`Edit ${sceneElementKindLabel(inlineTextTarget.kind).toLowerCase()} text`}
              bounds={inlineTextBounds}
              align={inlineTextTarget.kind === "text" || inlineTextTarget.kind === "section" ? "left" : "center"}
              onCommit={(text) => commitSceneText(inlineTextTarget.id, text)}
              onClose={() => setEditingElementId((current) => (current === inlineTextTarget.id ? null : current))}
            />
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

        {settingsOpen ? (
        <BoardSettingsDrawer
          setSettingsOpen={setSettingsOpen}
          microphonePermission={microphonePermission}
          cameraPermission={cameraPermission}
          cameraPromptWaiting={cameraPromptWaiting}
          boardTheme={boardTheme}
          cameraCanvasLocked={cameraCanvasLocked}
          screenUnderlayStatus={screenUnderlayStatus}
          stopScreenUnderlay={stopScreenUnderlay}
          setBoardTheme={setBoardTheme}
          airoSounds={airoSounds}
          setAiroSounds={setAiroSounds}
          cameraUnderlayEnabled={cameraUnderlayEnabled}
          cameraStatus={cameraStatus}
          setCameraUnderlayEnabled={setCameraUnderlayEnabled}
          localContrastPlatesEnabled={localContrastPlatesEnabled}
          setLocalContrastPlatesEnabled={setLocalContrastPlatesEnabled}
          scrimOpacity={scrimOpacity}
          scrimOpacityRef={scrimOpacityRef}
          setScrimOpacity={setScrimOpacity}
          screenUnderlayNotice={screenUnderlayNotice}
          recordingState={recordingState}
          stopStudioRecording={stopStudioRecording}
          startStudioRecording={startStudioRecording}
          recordingSeconds={recordingSeconds}
          recordingNotice={recordingNotice}
          confidenceThreshold={confidenceThreshold}
          setConfidenceThreshold={setConfidenceThreshold}
          pendingCameraConfidenceRestartRef={pendingCameraConfidenceRestartRef}
          stopCamera={stopCamera}
          autoSnapConnectors={autoSnapConnectors}
          setAutoSnapConnectors={setAutoSnapConnectors}
        />
        ) : null}
      </div>
    </main>
  );
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

/** The hidden scene copy the reducer keeps of a legacy (Airo-drawn) stroke. */
function isLegacyStrokeSceneCopy(state: BoardState, id: string): boolean {
  return Boolean(state.elements[id]?.legacyStrokeId);
}

/**
 * Legacy strokes the voice reference points at, for the planner: the scene
 * rules can't edit those, so the planner gets them as what "this" means.
 */
function pointedLegacyStrokeIds(
  state: BoardState,
  reference: VoiceReference | null,
): string[] {
  if (!reference) return [];
  const ids = [reference.startTargetId, ...reference.pointedIds].filter(
    (id): id is string => Boolean(id) && state.strokes[id!]?.status === "committed",
  );
  return [...new Set(ids)];
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
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
