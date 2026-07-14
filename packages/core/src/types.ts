export type MeetingProvider =
  | "standalone"
  | "google_meet"
  | "zoom"
  | "teams"
  | "chrome_overlay";

export type BoardSessionStatus =
  | "active"
  | "owner_disconnected"
  | "locked"
  | "ended";

export type ParticipantRole = "owner" | "editor" | "viewer";

export type ToolKind = "marker";

export type StrokeStatus = "active" | "committed" | "deleted";

export type EntitlementStatus = "active" | "trialing" | "expired" | "canceled";

export type StrokeInputSource =
  | "touchpad"
  | "mouse"
  | "stylus"
  | "air_gesture"
  | "physical_marker"
  | "hand_gesture"
  | "pointer";

export type StrokePointerType = "mouse" | "pen" | "touch";

export type StrokeTrackingSource =
  | "finger_heuristic"
  | "hand_heuristic"
  | "colored_tip"
  | "fiducial"
  | "manual"
  | "fused";

export type AnnotationObjectType =
  | "pointer"
  | "ellipse"
  | "arrow"
  | "highlight"
  | "rectangle"
  | "flow_node"
  | "connector"
  | "text_label"
  | "sticky_note"
  | "cross_mark"
  | "freehand";

export type AnnotationNodeType =
  | "process"
  | "service"
  | "database"
  | "queue"
  | "user"
  | "api"
  | "decision"
  | "terminator"
  | "io"
  | "document"
  | "note"
  | "circle"
  | "custom";

export type AnnotationSource = "gesture" | "touchpad" | "marker_prop" | "keyboard" | "voice" | "ai";

export type AnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnnotationPoint = {
  x: number;
  y: number;
};

export type StrokeAnnotation = {
  type: AnnotationObjectType;
  source: AnnotationSource;
  confidence?: number;
  bounds?: AnnotationBounds;
  start?: AnnotationPoint;
  end?: AnnotationPoint;
  label?: string;
  nodeType?: AnnotationNodeType;
  snappedStartStrokeId?: string;
  snappedEndStrokeId?: string;
  fillColor?: string;
  strokeColor?: string;
  opacity?: number;
  /**
   * Optional semantic grouping metadata. Group containers remain ordinary
   * rectangle annotations so older renderers can display them unchanged.
   */
  groupId?: string;
  groupMemberStrokeIds?: string[];
};

export type StrokePoint = {
  x: number;
  y: number;
  t: number;
  rawX?: number;
  rawY?: number;
  rawTipX?: number;
  rawTipY?: number;
  pressure?: number;
  pointerType?: StrokePointerType;
  confidence?: number;
  handSpeedPxPerSec?: number;
  gestureConfidence?: number;
  gripConfidence?: number;
  tipConfidence?: number;
  contactScore?: number;
  frictionGain?: number;
  inputSource?: StrokeInputSource;
  trackingSource?: StrokeTrackingSource;
};

export type Stroke = {
  id: string;
  boardId: string;
  userId: string;
  tool: ToolKind;
  color: string;
  thickness: number;
  points: StrokePoint[];
  createdAt: string;
  updatedAt: string;
  status: StrokeStatus;
  frictionProfile?: "stable" | "balanced" | "responsive" | "custom";
  inputSource?: StrokeInputSource;
  trackingSource?: StrokeTrackingSource;
  annotation?: StrokeAnnotation;
  cleanupApplied?: boolean;
  lineSnapApplied?: boolean;
  committedAt?: string;
};

export type EraseAction = {
  id: string;
  boardId: string;
  userId: string;
  inputSource?: StrokeInputSource;
  eraserPath: StrokePoint[];
  radius: number;
  affectedStrokeIds: string[];
  createdAt: string;
};

export type BoardSession = {
  id: string;
  ownerUserId: string;
  provider: MeetingProvider;
  providerMeetingId?: string;
  title?: string;
  status: BoardSessionStatus;
  allowParticipantDrawing: boolean;
  ownerLastSeenAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Participant = {
  id: string;
  boardSessionId: string;
  userId?: string;
  guestId?: string;
  displayName: string;
  role: ParticipantRole;
  inputEnabled: boolean;
  connectedAt: string;
  lastSeenAt: string;
};

export type Entitlement = {
  id: string;
  userId: string;
  plan: string;
  status: EntitlementStatus;
  source: "local_seed" | "stripe" | "manual";
  validUntil: string;
  createdAt: string;
};

export type CursorState = {
  participantId: string;
  x: number;
  y: number;
  mode:
    | "idle"
    | "hand_detected"
    | "marker_grip_detected"
    | "marker_ready"
    | "marker_hover"
    | "contact_ready"
    | "writing"
    | "repositioning"
    | "stroke_committed"
    | "paused"
    | "panning"
    | "low_confidence"
    | "marker_lost"
    | "duster_ready"
    | "erasing";
  inputSource?: StrokeInputSource;
  updatedAt: string;
};

export type BoardState = {
  boardId: string;
  strokes: Record<string, Stroke>;
  activeStrokes: Record<string, Stroke>;
  eraseActions: Record<string, EraseAction>;
  participants: Record<string, Participant>;
  cursors: Record<string, CursorState>;
  lastSequence: number;
  clearedAt?: string;
};

type EventEnvelope = {
  id: string;
  boardSessionId: string;
  actorParticipantId: string;
  sequence?: number;
  createdAt: string;
};

export type StrokeStartedEvent = EventEnvelope & {
  type: "stroke.started";
  stroke: Stroke;
};

export type StrokePointAddedEvent = EventEnvelope & {
  type: "stroke.point_added";
  strokeId: string;
  point: StrokePoint;
};

export type StrokeCommittedEvent = EventEnvelope & {
  type: "stroke.committed";
  strokeId: string;
  points?: StrokePoint[];
  discard?: boolean;
  cleanupApplied?: boolean;
  lineSnapApplied?: boolean;
  frictionProfile?: Stroke["frictionProfile"];
};

export type StrokeLabelUpdatedEvent = EventEnvelope & {
  type: "stroke.label_updated";
  strokeId: string;
  label: string;
};

export type StrokeAnnotationUpdatedEvent = EventEnvelope & {
  type: "stroke.annotation_updated";
  strokeId: string;
  annotation: StrokeAnnotation;
  points: StrokePoint[];
};

export type EraseCommittedEvent = EventEnvelope & {
  type: "erase.committed";
  eraseAction: EraseAction;
};

export type StrokeDeletedEvent = EventEnvelope & {
  type: "stroke.deleted";
  strokeIds: string[];
};

export type StrokeRestoredEvent = EventEnvelope & {
  type: "stroke.restored";
  strokeIds: string[];
};

export type UndoRequestedEvent = EventEnvelope & {
  type: "undo.requested";
};

export type RedoRequestedEvent = EventEnvelope & {
  type: "redo.requested";
};

export type BoardClearedEvent = EventEnvelope & {
  type: "board.cleared";
};

export type CursorMovedEvent = EventEnvelope & {
  type: "cursor.moved";
  cursor: CursorState;
};

export type ParticipantJoinedEvent = EventEnvelope & {
  type: "participant.joined";
  participant: Participant;
};

export type ParticipantLeftEvent = EventEnvelope & {
  type: "participant.left";
  participantId: string;
};

export type OwnerPresenceChangedEvent = EventEnvelope & {
  type: "owner.presence_changed";
  status: Extract<BoardSessionStatus, "active" | "owner_disconnected" | "locked">;
};

export type PermissionChangedEvent = EventEnvelope & {
  type: "permission.changed";
  allowParticipantDrawing: boolean;
};

export type BoardEvent =
  | StrokeStartedEvent
  | StrokePointAddedEvent
  | StrokeCommittedEvent
  | StrokeLabelUpdatedEvent
  | StrokeAnnotationUpdatedEvent
  | EraseCommittedEvent
  | StrokeDeletedEvent
  | StrokeRestoredEvent
  | UndoRequestedEvent
  | RedoRequestedEvent
  | BoardClearedEvent
  | CursorMovedEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | OwnerPresenceChangedEvent
  | PermissionChangedEvent;

export type AdapterCapabilities = {
  supportsMainStage: boolean;
  supportsSidePanel: boolean;
  supportsParticipantInvite: boolean;
  supportsSharedActivity: boolean;
  supportsScreenOverlay: boolean;
  supportsRawMediaAccess: boolean;
  supportsMeetingRecordingHooks: boolean;
  supportsParticipantIdentity: boolean;
};

export type MeetingContext = {
  provider: MeetingProvider;
  providerMeetingId?: string;
  providerSpaceId?: string;
  meetingUrl?: string;
  title?: string;
  startedAt?: string;
  hostUserId?: string;
  capabilities: AdapterCapabilities;
};
