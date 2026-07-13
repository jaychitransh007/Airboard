import type { AnnotationNodeType } from "./types.ts";

export const AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION = "1.0" as const;

export type AirboardSemanticNodeCapability = {
  nodeType: AnnotationNodeType;
  title: string;
  defaultLabel: string;
  palette: {
    title: string;
    order: number;
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
    terms: ["process", "process node", "step", "task", "flow", "flow block"],
  },
  {
    nodeType: "service",
    title: "Service",
    defaultLabel: "Service",
    palette: { title: "Service", order: 1 },
    terms: ["service", "services", "microservice", "microservices", "server", "servers"],
  },
  {
    nodeType: "database",
    title: "Database",
    defaultLabel: "Database",
    palette: { title: "Database", order: 2 },
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
    terms: ["user", "users", "person", "people", "actor", "actors", "client", "clients"],
  },
  {
    nodeType: "api",
    title: "API",
    defaultLabel: "API",
    palette: { title: "API", order: 5 },
    terms: ["api", "apis", "a p i", "endpoint", "endpoints", "gateway", "api gateway"],
  },
  {
    nodeType: "decision",
    title: "Decision",
    defaultLabel: "Decision",
    palette: { title: "Decision", order: 6 },
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
    terms: ["note", "notes", "sticky", "sticky note", "sticky notes"],
  },
  {
    nodeType: "circle",
    title: "Circle",
    defaultLabel: "Circle",
    palette: { title: "Circle", order: 8 },
    terms: ["circle", "circles", "ellipse", "ellipses", "oval", "ovals"],
  },
  {
    nodeType: "custom",
    title: "Box",
    defaultLabel: "Box",
    palette: { title: "Box", order: 9 },
    terms: ["component", "components", "custom node", "node", "nodes", "box", "boxes"],
  },
] as const satisfies readonly AirboardSemanticNodeCapability[];

export type AirboardSemanticActionCapability = {
  actionType:
    | "create"
    | "connect"
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

/**
 * Versioned registry consumed across UI, speech, planning, and execution.
 * Project-specific labels remain board context rather than global aliases.
 */
export const AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY = {
  version: AIRBOARD_SEMANTIC_CAPABILITY_REGISTRY_VERSION,
  nodes: AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
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
  ...AIRBOARD_SEMANTIC_ACTION_CAPABILITIES.flatMap(({ terms }) => terms),
]);

/**
 * Backward-compatible human-readable operation catalog used by the existing
 * canonical-command planner.
 */
export const AIRBOARD_SEMANTIC_OPERATION_CAPABILITIES = [
  "create nodes",
  "connect named or pointed nodes with labelled arrows",
  "create labelled branches from a decision",
  "rename a named, pointed, or selected object",
  "delete or duplicate named, pointed, or selected objects",
  "move named, pointed, or selected objects",
  "align or distribute multiple objects",
  "lay out multiple objects as a flow or grid",
  "group objects",
  "select objects",
  "undo",
  "cancel",
] as const;

/** Existing canonical string grammar retained for legacy clients. */
export const AIRBOARD_SEMANTIC_CANONICAL_FORMS = [
  "add/create [one to twenty] <node type> [named <label>] [placement]",
  "connect <visible label|this|that> to <visible label|this|that> [as <connector label>]",
  "rename selected to <label>",
  "delete selected",
  "duplicate selected",
  "move selected <left|right|above|below>",
  "align selected <left|right|top|bottom|horizontally|vertically>",
  "distribute selected <horizontally|vertically>",
  "layout selected <left to right|right to left|top to bottom|bottom to top|grid>",
  "undo",
  "cancel",
] as const;
