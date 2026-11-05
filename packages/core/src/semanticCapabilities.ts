import type { AnnotationNodeType, BoardElementKind, ShapeKind } from "./types.ts";
import { BOARD_SHAPE_CATALOG } from "./shapeCatalog.ts";

export const AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION = "2.0" as const;

export type AirboardNodeVisualKind =
  | "process"
  | "service"
  | "database"
  | "queue"
  | "actor"
  | "api"
  | "decision"
  | "note"
  | "terminator"
  | "io"
  | "document"
  | "ellipse"
  | "box";

export type AirboardSemanticNodeCapability = {
  nodeType: AnnotationNodeType;
  title: string;
  defaultLabel: string;
  palette: {
    title: string;
    order: number;
  };
  visual: {
    kind: AirboardNodeVisualKind;
    defaultSize: { width: number; height: number };
  };
  terms: readonly string[];
};

/**
 * Stable Airboard node nomenclature. This is intentionally richer than a list
 * of prompt aliases: the same entries can drive the palette, default labels,
 * deterministic parsing, speech adaptation, and the semantic planning tool.
 */
export const AIRBOARD_SEMANTIC_NODE_CAPABILITIES = [
  {
    nodeType: "process",
    title: "Process",
    defaultLabel: "Process",
    palette: { title: "Flow", order: 0 },
    visual: { kind: "process", defaultSize: { width: 144, height: 72 } },
    terms: ["process", "process node", "step", "task", "flow", "flow block"],
  },
  {
    nodeType: "service",
    title: "Service",
    defaultLabel: "Service",
    palette: { title: "Service", order: 1 },
    visual: { kind: "service", defaultSize: { width: 152, height: 80 } },
    terms: ["service", "services", "microservice", "microservices", "server", "servers"],
  },
  {
    nodeType: "database",
    title: "Database",
    defaultLabel: "Database",
    palette: { title: "Database", order: 2 },
    visual: { kind: "database", defaultSize: { width: 144, height: 96 } },
    terms: [
      "database",
      "databases",
      "data store",
      "data stores",
      "datastore",
      "datastores",
      "db",
    ],
  },
  {
    nodeType: "queue",
    title: "Queue",
    defaultLabel: "Queue",
    palette: { title: "Queue", order: 3 },
    visual: { kind: "queue", defaultSize: { width: 152, height: 82 } },
    terms: [
      "queue",
      "queues",
      "message queue",
      "message queues",
      "topic",
      "topics",
      "event bus",
    ],
  },
  {
    nodeType: "user",
    title: "User",
    defaultLabel: "User",
    palette: { title: "User", order: 4 },
    visual: { kind: "actor", defaultSize: { width: 128, height: 104 } },
    terms: ["user", "users", "person", "people", "actor", "actors", "client", "clients"],
  },
  {
    nodeType: "api",
    title: "API",
    defaultLabel: "API",
    palette: { title: "API", order: 5 },
    visual: { kind: "api", defaultSize: { width: 152, height: 80 } },
    terms: ["api", "apis", "a p i", "endpoint", "endpoints", "gateway", "api gateway"],
  },
  {
    nodeType: "decision",
    title: "Decision",
    defaultLabel: "Decision",
    palette: { title: "Decision", order: 6 },
    visual: { kind: "decision", defaultSize: { width: 120, height: 88 } },
    terms: [
      "decision",
      "decisions",
      "decision block",
      "decision node",
      "condition",
      "conditions",
      "condition block",
      "conditional block",
      "conditional",
      "diamond",
    ],
  },
  {
    nodeType: "note",
    title: "Note",
    defaultLabel: "Note",
    palette: { title: "Note", order: 7 },
    visual: { kind: "note", defaultSize: { width: 176, height: 108 } },
    terms: ["note", "notes", "sticky", "sticky note", "sticky notes"],
  },
  {
    nodeType: "terminator",
    title: "Start / End",
    defaultLabel: "Start",
    palette: { title: "Start / End", order: 7.1 },
    visual: { kind: "terminator", defaultSize: { width: 150, height: 58 } },
    terms: [
      "terminator",
      "start",
      "start node",
      "end",
      "end node",
      "begin",
      "finish",
      "start end",
    ],
  },
  {
    nodeType: "io",
    title: "Input / Output",
    defaultLabel: "Input",
    palette: { title: "Input / Output", order: 7.2 },
    visual: { kind: "io", defaultSize: { width: 152, height: 72 } },
    terms: ["input", "output", "input output", "io", "i o", "data input", "data output"],
  },
  {
    nodeType: "document",
    title: "Document",
    defaultLabel: "Document",
    palette: { title: "Document", order: 7.3 },
    visual: { kind: "document", defaultSize: { width: 144, height: 86 } },
    terms: ["document", "documents"],
  },
  {
    nodeType: "circle",
    title: "Circle",
    defaultLabel: "Circle",
    palette: { title: "Circle", order: 8 },
    visual: { kind: "ellipse", defaultSize: { width: 120, height: 120 } },
    terms: ["circle", "circles", "ellipse", "ellipses", "oval", "ovals"],
  },
  {
    nodeType: "custom",
    title: "Box",
    defaultLabel: "Box",
    palette: { title: "Box", order: 9 },
    visual: { kind: "box", defaultSize: { width: 144, height: 72 } },
    terms: ["component", "components", "custom node", "node", "nodes", "box", "boxes"],
  },
] as const satisfies readonly AirboardSemanticNodeCapability[];

export type AirboardSemanticActionCapability = {
  actionType:
    | "create"
    | "connect"
    | "reverse_connection"
    | "delete_connection"
    | "branch"
    | "rename"
    | "delete"
    | "duplicate"
    | "move"
    | "align"
    | "distribute"
    | "layout"
    | "group"
    | "select"
    | "undo"
    | "cancel";
  title: string;
  terms: readonly string[];
};

export const AIRBOARD_SEMANTIC_ACTION_CAPABILITIES = [
  { actionType: "create", title: "Create", terms: ["add", "create", "insert", "make", "put"] },
  { actionType: "connect", title: "Connect", terms: ["connect", "link", "arrow", "route"] },
  {
    actionType: "reverse_connection",
    title: "Reverse connector",
    terms: ["reverse connector", "reverse connection", "opposite direction", "should call instead"],
  },
  {
    actionType: "delete_connection",
    title: "Delete connector",
    terms: ["delete connector", "remove connection", "disconnect"],
  },
  { actionType: "branch", title: "Branch", terms: ["branch", "branches", "yes", "no", "otherwise"] },
  { actionType: "rename", title: "Rename", terms: ["rename", "relabel", "change the name"] },
  { actionType: "delete", title: "Delete", terms: ["delete", "remove"] },
  { actionType: "duplicate", title: "Duplicate", terms: ["duplicate", "copy"] },
  { actionType: "move", title: "Move", terms: ["move", "shift", "place", "reposition"] },
  { actionType: "align", title: "Align", terms: ["align"] },
  { actionType: "distribute", title: "Distribute", terms: ["distribute", "space evenly"] },
  { actionType: "layout", title: "Layout", terms: ["layout", "arrange", "organize"] },
  { actionType: "group", title: "Group", terms: ["group", "container", "frame"] },
  { actionType: "select", title: "Select", terms: ["select", "choose"] },
  { actionType: "undo", title: "Undo", terms: ["undo", "go back"] },
  { actionType: "cancel", title: "Cancel", terms: ["cancel", "never mind", "nevermind"] },
] as const satisfies readonly AirboardSemanticActionCapability[];

export type AirboardSceneAction =
  | "create"
  | "rename"
  | "style"
  | "move"
  | "connect"
  | "group"
  | "delete"
  | "layout";

export type AirboardSceneElementCapability = {
  kind: BoardElementKind;
  title: string;
  terms: readonly string[];
  actions: readonly AirboardSceneAction[];
};

const ALL_SCENE_ACTIONS = [
  "create", "rename", "style", "move", "connect", "group", "delete", "layout",
] as const satisfies readonly AirboardSceneAction[];

/**
 * The v2 registry covers every committed scene discriminator. This sits beside
 * the legacy semantic-node registry so deployed voice commands remain stable
 * while Airo and the creation pane adopt the richer scene model.
 */
export const AIRBOARD_SCENE_ELEMENT_CAPABILITIES = [
  { kind: "drawing", title: "Drawing", terms: ["drawing", "marker", "highlighter", "washi tape"], actions: ALL_SCENE_ACTIONS },
  { kind: "sticky", title: "Sticky note", terms: ["sticky", "sticky note", "note"], actions: ALL_SCENE_ACTIONS },
  { kind: "shape", title: "Shape", terms: ["shape", "diagram shape"], actions: ALL_SCENE_ACTIONS },
  { kind: "connector", title: "Connector", terms: ["connector", "line", "arrow"], actions: ALL_SCENE_ACTIONS },
  { kind: "text", title: "Text", terms: ["text", "text box", "label"], actions: ALL_SCENE_ACTIONS },
  { kind: "section", title: "Section", terms: ["section", "frame", "container"], actions: ALL_SCENE_ACTIONS },
  { kind: "table", title: "Table", terms: ["table", "grid", "spreadsheet"], actions: ALL_SCENE_ACTIONS },
  { kind: "stamp", title: "Stamp", terms: ["stamp", "emoji", "face stamp"], actions: ALL_SCENE_ACTIONS },
  { kind: "media", title: "Media", terms: ["media", "image", "photo", "gif", "video"], actions: ALL_SCENE_ACTIONS },
  { kind: "link_preview", title: "Link preview", terms: ["link", "link preview", "embed"], actions: ALL_SCENE_ACTIONS },
  { kind: "code_block", title: "Code block", terms: ["code", "code block", "snippet"], actions: ALL_SCENE_ACTIONS },
  { kind: "mind_map_node", title: "Mind-map node", terms: ["mind map", "mind-map", "mind map node"], actions: ALL_SCENE_ACTIONS },
] as const satisfies readonly AirboardSceneElementCapability[];

export type AirboardSemanticShapeCapability = {
  shapeKind: ShapeKind;
  title: string;
  terms: readonly string[];
  category: "basic" | "flowchart" | "advanced" | "airboard";
};

/** All 56 FigJam catalog entries plus the four Airboard-only presets. */
export const AIRBOARD_SEMANTIC_SHAPE_CAPABILITIES = BOARD_SHAPE_CATALOG.map((entry) => ({
  shapeKind: entry.kind as ShapeKind,
  title: entry.name,
  terms: [entry.name, entry.kind, ...entry.aliases],
  category: entry.category,
})) satisfies readonly AirboardSemanticShapeCapability[];

/**
 * Versioned registry consumed across UI, speech, planning, and execution.
 * Project-specific labels remain board context rather than global aliases.
 */
export const AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY = {
  version: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION,
  nodes: AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  sceneElements: AIRBOARD_SCENE_ELEMENT_CAPABILITIES,
  shapes: AIRBOARD_SEMANTIC_SHAPE_CAPABILITIES,
  actions: AIRBOARD_SEMANTIC_ACTION_CAPABILITIES,
} as const;

function uniqueNormalizedTerms(terms: readonly string[]): readonly string[] {
  return [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Speech-provider adaptation vocabulary, derived from the same registry as the
 * planner rather than maintained as a divergent hard-coded keyword list.
 */
export const AIRBOARD_SEMANTIC_TRANSCRIPTION_KEYTERMS = uniqueNormalizedTerms([
  ...AIRBOARD_SEMANTIC_NODE_CAPABILITIES.flatMap(({ terms }) => terms),
  ...AIRBOARD_SCENE_ELEMENT_CAPABILITIES.flatMap(({ terms }) => terms),
  ...AIRBOARD_SEMANTIC_SHAPE_CAPABILITIES.flatMap(({ terms }) => terms),
  ...AIRBOARD_SEMANTIC_ACTION_CAPABILITIES.flatMap(({ terms }) => terms),
]);

/**
 * Backward-compatible human-readable operation catalog used by the existing
 * canonical-command planner.
 */
export const AIRBOARD_SEMANTIC_OPERATION_CAPABILITIES = [
  "create nodes",
  "connect named or pointed nodes with labelled arrows",
  "reverse a specific existing connector while preserving or changing its label",
  "delete a specific existing connector",
  "create labelled branches from a decision",
  "rename a named, pointed, or selected object",
  "delete or duplicate named, pointed, or selected objects",
  "move named, pointed, or selected objects",
  "align or distribute multiple objects",
  "lay out multiple objects as a flow or grid",
  "group objects",
  "create and edit shapes, stickies, text, sections, tables, stamps, media, links, code blocks, and mind maps",
  "style any scene element without replacing unrelated fields",
  "select objects",
  "undo",
  "cancel",
] as const;

/** Existing canonical string grammar retained for legacy clients. */
export const AIRBOARD_SEMANTIC_CANONICAL_FORMS = [
  "add/create [one to twenty] <node type> [named <label>] [placement]",
  "connect <visible label|this|that> to <visible label|this|that> [as <connector label>]",
  "reverse the connector from <source> to <target> [as <connector label>]",
  "delete the connector from <source> to <target>",
  "rename selected to <label>",
  "delete selected",
  "duplicate selected",
  "move selected <left|right|above|below>",
  "align selected <left|right|top|bottom|horizontally|vertically>",
  "distribute selected <horizontally|vertically>",
  "layout selected <left to right|right to left|top to bottom|bottom to top|grid>",
  "add a <rows> by <columns> table",
  "create a section around selected",
  "make a mind map [named <label>]",
  "add a code block [in <language>]",
  "add a <basic|flowchart|advanced|Airboard shape name>",
  "undo",
  "cancel",
] as const;
