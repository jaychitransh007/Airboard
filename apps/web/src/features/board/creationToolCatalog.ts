import {
  ADVANCED_SHAPE_CATALOG,
  AIRBOARD_SHAPE_CATALOG,
  BASIC_SHAPE_CATALOG,
  BOARD_SHAPE_CATALOG,
  FIGJAM_SHAPE_CATALOG,
  FLOWCHART_SHAPE_CATALOG,
  type CatalogShapeKind,
  type ShapeCatalogCategory,
  type ShapeCatalogEntry,
} from "@airboard/core";

export const CREATION_DRAG_MIME = "application/x-airboard-creation-tool";

export type ShapeCategoryId = ShapeCatalogCategory;

export type LegacyPlacementTool =
  | "select"
  | "flow"
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
  | "box"
  | "arrow"
  | "highlight"
  | "connector"
  | "eraser";

export type ShapeDefinition = {
  /** Palette identity. Category prefix keeps the two File entries distinct. */
  id: string;
  kind: CatalogShapeKind;
  label: string;
  category: ShapeCategoryId;
  keywords: readonly string[];
  legacyTool?: LegacyPlacementTool;
};

const LEGACY_SHAPE_TOOLS: Partial<Record<`${ShapeCategoryId}:${CatalogShapeKind}`, LegacyPlacementTool>> = {
  "basic:square": "box",
  "basic:ellipse": "circle",
  "basic:diamond": "decision",
  "basic:rounded-rectangle": "flow",
  "flowchart:right-parallelogram": "io",
  "flowchart:cylinder": "database",
  "flowchart:document": "document",
  "advanced:database": "database",
  "advanced:service": "service",
  "advanced:user": "user",
  "airboard:process": "flow",
  "airboard:terminator": "terminator",
  "airboard:api": "api",
  "airboard:queue": "queue",
};

function fromCore(entry: ShapeCatalogEntry): ShapeDefinition {
  const legacyTool = LEGACY_SHAPE_TOOLS[`${entry.category}:${entry.kind}`];
  return {
    id: `${entry.category}-${entry.kind}`,
    kind: entry.kind,
    label: entry.name,
    category: entry.category,
    keywords: entry.aliases,
    ...(legacyTool ? { legacyTool } : {}),
  };
}

export const BASIC_SHAPES = BASIC_SHAPE_CATALOG.map(fromCore);
export const FLOWCHART_SHAPES = FLOWCHART_SHAPE_CATALOG.map(fromCore);
export const ADVANCED_SHAPES = ADVANCED_SHAPE_CATALOG.map(fromCore);
export const AIRBOARD_SHAPES = AIRBOARD_SHAPE_CATALOG.map(fromCore);
export const FIGJAM_SHAPES = FIGJAM_SHAPE_CATALOG.map(fromCore);
export const ALL_SHAPES = BOARD_SHAPE_CATALOG.map(fromCore);

export const SHAPE_CATEGORIES = [
  { id: "basic", label: "Basic", shapes: BASIC_SHAPES },
  { id: "flowchart", label: "Flowchart", shapes: FLOWCHART_SHAPES },
  { id: "advanced", label: "Advanced", shapes: ADVANCED_SHAPES },
  { id: "airboard", label: "Airboard", shapes: AIRBOARD_SHAPES },
] as const;

export const CONNECTOR_TOOLS = [
  { id: "connector:bent", label: "Bent connector", legacyTool: "connector" },
  { id: "connector:curved", label: "Curved connector" },
  { id: "connector:straight", label: "Straight connector", legacyTool: "arrow" },
] as const;

export const DRAW_TOOLS = [
  { id: "draw:marker", label: "Marker", shortcut: "M" },
  { id: "draw:highlighter", label: "Highlighter", shortcut: "Shift M", legacyTool: "highlight" },
  { id: "draw:washi", label: "Washi tape", shortcut: "W" },
  { id: "draw:eraser", label: "Eraser", shortcut: "Shift Delete", legacyTool: "eraser" },
] as const;

export const INSERT_TOOLS = [
  { id: "insert:mind-map", label: "Mind map", description: "Build a connected hierarchy" },
  { id: "insert:face-stamp", label: "Face stamp", description: "Stamp a workspace member" },
  { id: "insert:code-block", label: "Code block", description: "Add syntax-highlighted code" },
  { id: "insert:media", label: "Media", description: "Image, GIF, or video" },
  { id: "insert:link", label: "Link", description: "Paste a link preview" },
] as const;

export type ShapeToolId = `shape:${string}`;
export type CreationToolId =
  | "move"
  | "hand"
  | (typeof DRAW_TOOLS)[number]["id"]
  | "sticky"
  | ShapeToolId
  | (typeof CONNECTOR_TOOLS)[number]["id"]
  | "text"
  | "section"
  | "table"
  | "stamp"
  | (typeof INSERT_TOOLS)[number]["id"];

export type CreationShortcutInput = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

const SHAPES_BY_ID = new Map<string, ShapeDefinition>(
  ALL_SHAPES.map((definition) => [definition.id, definition]),
);

export function shapeToolId(shapeId: string): ShapeToolId {
  return `shape:${shapeId}`;
}

export function shapeForTool(tool: CreationToolId | string): ShapeDefinition | null {
  if (!tool.startsWith("shape:")) return null;
  return SHAPES_BY_ID.get(tool.slice("shape:".length)) ?? null;
}

export function legacyToolForCreationTool(tool: CreationToolId): LegacyPlacementTool | null {
  if (tool === "move") return "select";
  if (tool === "sticky") return "note";
  if (tool === "draw:highlighter") return "highlight";
  if (tool === "draw:eraser") return "eraser";
  const shapeDefinition = shapeForTool(tool);
  if (shapeDefinition?.legacyTool) return shapeDefinition.legacyTool;
  const connector = CONNECTOR_TOOLS.find((entry) => entry.id === tool);
  return connector && "legacyTool" in connector ? connector.legacyTool : null;
}

export function creationToolLabel(tool: CreationToolId): string {
  const shapeDefinition = shapeForTool(tool);
  if (shapeDefinition) return shapeDefinition.label;
  const known = [...DRAW_TOOLS, ...CONNECTOR_TOOLS, ...INSERT_TOOLS].find(
    (entry) => entry.id === tool,
  );
  if (known) return known.label;
  switch (tool) {
    case "move": return "Move";
    case "hand": return "Hand";
    case "sticky": return "Sticky note";
    case "text": return "Text";
    case "section": return "Section";
    case "table": return "Table";
    case "stamp": return "Stamp";
    default: return "Board tool";
  }
}

/** FigJam-compatible creation shortcuts. Editable targets are filtered by the caller. */
export function resolveCreationShortcut(input: CreationShortcutInput): CreationToolId | null {
  const key = input.key.toLowerCase();
  const command = Boolean(input.metaKey || input.ctrlKey);
  if (command) return input.shiftKey && key === "k" ? "insert:media" : null;
  if (input.altKey) return null;
  if (input.shiftKey) {
    if (key === "m") return "draw:highlighter";
    if (key === "s") return "section";
    if (key === "t") return "table";
    if (input.key === "Delete" || input.key === "Backspace") return "draw:eraser";
    return null;
  }
  switch (key) {
    case "v": return "move";
    case "h": return "hand";
    case "m": return "draw:marker";
    case "w": return "draw:washi";
    case "s": return "sticky";
    case "r": return "shape:basic-square";
    case "o": return "shape:basic-ellipse";
    case "x": return "connector:bent";
    case "l": return "connector:straight";
    case "t": return "text";
    case "e": return "stamp";
    case "`": return "insert:code-block";
    default: return null;
  }
}
