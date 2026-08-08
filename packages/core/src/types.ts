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
  /** Catalog-backed shape identity; older clients continue to use nodeType. */
  shapeKind?: ShapeKind;
  snappedStartStrokeId?: string;
  snappedEndStrokeId?: string;
  /**
   * Signed board-space lane displacement for parallel or reciprocal
   * connectors. The renderer keeps the endpoints attached to their nodes and
   * offsets the route body so sibling edges and their labels do not collapse
   * onto one another.
   */
  routeOffset?: number;
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

/** The current serialized scene format. Legacy stroke events remain readable. */
export const BOARD_SCENE_VERSION = 2 as const;

export type BoardSceneVersion = typeof BOARD_SCENE_VERSION;

export type BoardElementKind =
  | "drawing"
  | "sticky"
  | "shape"
  | "connector"
  | "text"
  | "section"
  | "table"
  | "stamp"
  | "media"
  | "link_preview"
  | "code_block"
  | "mind_map_node";

export type BoardElementStatus = "active" | "deleted";

export type BoardJsonValue =
  | null
  | boolean
  | number
  | string
  | BoardJsonValue[]
  | { [key: string]: BoardJsonValue };

export type BoardElementTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise board-space rotation in degrees. */
  rotation: number;
};

export type BoardAttachment =
  | {
      kind: "element";
      elementId: string;
      anchor?: "top" | "right" | "bottom" | "left" | "center" | "auto";
    }
  | {
      kind: "table_cell";
      tableId: string;
      cellId: string;
    };

export type RichTextMention = {
  displayName: string;
  participantId?: string;
  userId?: string;
};

export type RichTextMark = {
  bold?: true;
  italic?: true;
  strikethrough?: true;
  inlineCode?: true;
  color?: string;
  link?: string;
  mention?: RichTextMention;
};

export type RichTextRun = {
  text: string;
  marks?: RichTextMark;
  /** Compatibility shorthand for editors that keep mentions beside marks. */
  mention?: RichTextMention;
};

export type RichTextBlock = {
  id?: string;
  type:
    | "paragraph"
    | "heading"
    | "unordered_list_item"
    | "ordered_list_item"
    | "blockquote"
    | "code";
  runs: RichTextRun[];
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  indent?: number;
  align?: "left" | "center" | "right";
};

/** Serializable rich text shared by text-bearing scene elements. */
export type RichTextDocument = {
  type: "doc";
  blocks: RichTextBlock[];
};

export type ShapeKind =
  // Basic
  | "square"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "downward-triangle"
  | "rounded-rectangle"
  | "pentagon"
  | "octagon"
  | "plus"
  | "left-arrow"
  | "right-arrow"
  | "chevron"
  | "star"
  | "speech-bubble"
  // Flowchart
  | "right-parallelogram"
  | "left-parallelogram"
  | "cylinder"
  | "horizontal-cylinder"
  | "file"
  | "folder"
  | "document"
  | "multiple-documents"
  | "predefined-process"
  | "shield"
  | "trapezoid"
  | "manual-input"
  | "hexagon"
  | "internal-storage"
  | "or"
  | "summing-junction"
  // Advanced
  | "activity"
  | "archive"
  | "authentication"
  | "chat"
  | "cloud"
  | "computer"
  | "database"
  | "desktop"
  | "email"
  | "frontend"
  | "instant"
  | "location"
  | "mobile"
  | "package"
  | "payment"
  | "security"
  | "send"
  | "server"
  | "service"
  | "settings"
  | "storage"
  | "terminal"
  | "user"
  | "wallet"
  | "web"
  // Airboard
  | "process"
  | "terminator"
  | "api"
  | "queue";

export type ConnectorPathKind = "straight" | "bent" | "curved";
export type ConnectorEndpointKind =
  | "none"
  | "solid_arrow"
  | "line_arrow"
  | "triangle"
  | "diamond";

export type ConnectorBinding = {
  elementId: string;
  anchor?: "top" | "right" | "bottom" | "left" | "center" | "auto";
};

export type ConnectorEndpoint = {
  point: AnnotationPoint;
  binding?: ConnectorBinding;
  decoration: ConnectorEndpointKind;
};

export type AssetReference = {
  id: string;
  boardId: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  posterUrl?: string;
  createdAt?: string;
};

export type BoardElementBase<TKind extends BoardElementKind> = {
  id: string;
  boardId: string;
  kind: TKind;
  status: BoardElementStatus;
  transform: BoardElementTransform;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  creatorId?: string;
  sectionId?: string;
  attachment?: BoardAttachment;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Set only when this element was adapted from the v1 stroke model. */
  legacyStrokeId?: string;
  metadata?: Record<string, BoardJsonValue>;
};

export type DrawingElement = BoardElementBase<"drawing"> & {
  drawingKind: "marker" | "highlighter" | "washi";
  points: StrokePoint[];
  style: {
    color: string;
    thickness: number;
    opacity: number;
    straight: boolean;
    patternAsset?: AssetReference;
  };
};

export type StickyElement = BoardElementBase<"sticky"> & {
  content: RichTextDocument;
  layout: "square" | "rectangle";
  color: string;
  authorVisible: boolean;
};

export type ShapeStyle = {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  textColor: string;
  fontFamily?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
};

export type ShapeElement = BoardElementBase<"shape"> & {
  shapeKind: ShapeKind;
  content: RichTextDocument;
  style: ShapeStyle;
};

export type ConnectorElement = BoardElementBase<"connector"> & {
  pathKind: ConnectorPathKind;
  start: ConnectorEndpoint;
  end: ConnectorEndpoint;
  controlPoints: AnnotationPoint[];
  label: RichTextDocument;
  labelPosition: number;
  style: {
    color: string;
    opacity: number;
    thickness: "thin" | "thick";
    strokeStyle: "solid" | "dashed" | "dotted";
    labelBackground: "none" | "matching";
  };
};

export type TextElement = BoardElementBase<"text"> & {
  content: RichTextDocument;
  mode: "point" | "area";
  style: {
    preset: "simple" | "bookish" | "technical" | "scribbled";
    color: string;
    fontFamily?: string;
    fontSize: number;
    align: "left" | "center" | "right";
    verticalAlign: "top" | "middle" | "bottom";
  };
};

export type SectionElement = BoardElementBase<"section"> & {
  title: RichTextDocument;
  titleVisible: boolean;
  collapsed: boolean;
  lockMode: "none" | "background" | "all";
  memberIds: string[];
  style: {
    fill: string;
    fillOpacity: number;
    stroke: string;
  };
};

export type TableCellStyle = {
  fill: string;
  textColor: string;
  horizontalAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

export type TableCell = {
  id: string;
  rowId: string;
  columnId: string;
  content: RichTextDocument;
  style: TableCellStyle;
  stampIds?: string[];
};

export type TableRow = {
  id: string;
  height: number;
};

export type TableColumn = {
  id: string;
  width: number;
};

export type TableMerge = {
  id: string;
  cellIds: string[];
  anchorCellId: string;
};

export type TableElement = BoardElementBase<"table"> & {
  rows: TableRow[];
  columns: TableColumn[];
  cells: Record<string, TableCell>;
  merges: TableMerge[];
};

export type StampElement = BoardElementBase<"stamp"> & {
  emoji: string;
  label?: string;
  faceAsset?: AssetReference;
  authorId?: string;
};

export type MediaElement = BoardElementBase<"media"> & {
  mediaKind: "image" | "gif" | "video";
  asset: AssetReference;
  altText: string;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
  };
  playing: boolean;
};

export type LinkPreviewElement = BoardElementBase<"link_preview"> & {
  url: string;
  display: "card" | "embed" | "url";
  layout: "horizontal" | "vertical";
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  iconUrl?: string;
  embedUrl?: string;
};

export type CodeLanguage =
  | "cpp"
  | "css"
  | "go"
  | "graphql"
  | "html"
  | "javascript"
  | "json"
  | "kotlin"
  | "python"
  | "react"
  | "ruby"
  | "rust"
  | "sql"
  | "swift"
  | "typescript";

export type CodeBlockElement = BoardElementBase<"code_block"> & {
  code: string;
  language: CodeLanguage;
  theme: "light" | "dark";
};

export type MindMapDirection = "left" | "right" | "up" | "down";

export type MindMapRelation = {
  parentId?: string;
  childIds: string[];
  direction: MindMapDirection;
  connectorIds: string[];
};

export type MindMapNodeElement = BoardElementBase<"mind_map_node"> & {
  content: RichTextDocument;
  relation: MindMapRelation;
  style: {
    fill: string;
    textColor: string;
    lineColor: string;
  };
};

export type BoardSceneElement =
  | DrawingElement
  | StickyElement
  | ShapeElement
  | ConnectorElement
  | TextElement
  | SectionElement
  | TableElement
  | StampElement
  | MediaElement
  | LinkPreviewElement
  | CodeBlockElement
  | MindMapNodeElement;

export type BoardElementPatchPath = [string, ...(string | number)[]];

/**
 * Path and structure-specific operations prevent one editor from replacing a
 * whole element when they only changed a style field, table cell, attachment,
 * or mind-map relation.
 */
export type BoardElementPatchOperation =
  | { op: "field.set"; path: BoardElementPatchPath; value: BoardJsonValue }
  | { op: "field.unset"; path: BoardElementPatchPath }
  | { op: "table.cell.patched"; cellId: string; patch: Partial<TableCell> }
  | { op: "table.row.inserted"; index: number; row: TableRow; cells?: TableCell[] }
  | { op: "table.row.deleted"; rowId: string }
  | { op: "table.row.moved"; rowId: string; index: number }
  | { op: "table.column.inserted"; index: number; column: TableColumn; cells?: TableCell[] }
  | { op: "table.column.deleted"; columnId: string }
  | { op: "table.column.moved"; columnId: string; index: number }
  | { op: "table.cells.merged"; merge: TableMerge }
  | { op: "table.cells.unmerged"; mergeId: string }
  | { op: "attachment.changed"; attachment: BoardAttachment | null }
  | { op: "mind_map.relation.changed"; relation: MindMapRelation };

export type BoardState = {
  boardId: string;
  sceneVersion: BoardSceneVersion;
  elements: Record<string, BoardSceneElement>;
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

export type ElementCreatedEvent = EventEnvelope & {
  type: "element.created";
  element: BoardSceneElement;
};

export type ElementPatchedEvent = EventEnvelope & {
  type: "element.patched";
  elementId: string;
  patches: BoardElementPatchOperation[];
  /** Informational revision observed by the author; path patches still merge. */
  baseRevision?: number;
};

export type ElementDeletedEvent = EventEnvelope & {
  type: "element.deleted";
  elementId: string;
};

export type ElementRestoredEvent = EventEnvelope & {
  type: "element.restored";
  elementId: string;
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
  | PermissionChangedEvent
  | ElementCreatedEvent
  | ElementPatchedEvent
  | ElementDeletedEvent
  | ElementRestoredEvent;

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
