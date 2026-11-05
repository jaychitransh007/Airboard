import type {
  BoardElementPatchOperation,
  BoardJsonValue,
  BoardSceneElement,
  RichTextDocument,
  ShapeKind,
  TableCell,
} from "./types.ts";

export const BOARD_ELEMENT_KINDS = [
  "drawing",
  "sticky",
  "shape",
  "connector",
  "text",
  "section",
  "table",
  "stamp",
  "media",
  "link_preview",
  "code_block",
  "mind_map_node",
] as const;

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "square",
  "ellipse",
  "diamond",
  "triangle",
  "downward-triangle",
  "rounded-rectangle",
  "pentagon",
  "octagon",
  "plus",
  "left-arrow",
  "right-arrow",
  "chevron",
  "star",
  "speech-bubble",
  "right-parallelogram",
  "left-parallelogram",
  "cylinder",
  "horizontal-cylinder",
  "file",
  "folder",
  "document",
  "multiple-documents",
  "predefined-process",
  "shield",
  "trapezoid",
  "manual-input",
  "hexagon",
  "internal-storage",
  "or",
  "summing-junction",
  "activity",
  "archive",
  "authentication",
  "chat",
  "cloud",
  "computer",
  "database",
  "desktop",
  "email",
  "frontend",
  "instant",
  "location",
  "mobile",
  "package",
  "payment",
  "security",
  "send",
  "server",
  "service",
  "settings",
  "storage",
  "terminal",
  "user",
  "wallet",
  "web",
  "process",
  "terminator",
  "api",
  "queue",
];

const ELEMENT_KIND_SET = new Set<string>(BOARD_ELEMENT_KINDS);
const SHAPE_KIND_SET = new Set<string>(SHAPE_KINDS);
const UNSAFE_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

export function isBoardSceneElement(value: unknown): value is BoardSceneElement {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.boardId) ||
    typeof value.kind !== "string" ||
    !ELEMENT_KIND_SET.has(value.kind) ||
    (value.status !== "active" && value.status !== "deleted") ||
    !isTransform(value.transform) ||
    !Number.isFinite(value.zIndex) ||
    typeof value.locked !== "boolean" ||
    typeof value.visible !== "boolean" ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  ) {
    return false;
  }

  switch (value.kind) {
    case "drawing":
      return (
        ["marker", "highlighter", "washi"].includes(String(value.drawingKind)) &&
        Array.isArray(value.points) &&
        value.points.every(isStrokePoint) &&
        isRecord(value.style)
      );
    case "sticky":
      return (
        isRichTextDocument(value.content) &&
        (value.layout === "square" || value.layout === "rectangle") &&
        typeof value.color === "string" &&
        typeof value.authorVisible === "boolean"
      );
    case "shape":
      return (
        typeof value.shapeKind === "string" &&
        SHAPE_KIND_SET.has(value.shapeKind) &&
        isRichTextDocument(value.content) &&
        isRecord(value.style)
      );
    case "connector":
      return (
        ["straight", "bent", "curved"].includes(String(value.pathKind)) &&
        isConnectorEndpoint(value.start) &&
        isConnectorEndpoint(value.end) &&
        Array.isArray(value.controlPoints) &&
        value.controlPoints.every(isPoint) &&
        isRichTextDocument(value.label) &&
        Number.isFinite(value.labelPosition) &&
        isRecord(value.style)
      );
    case "text":
      return (
        isRichTextDocument(value.content) &&
        (value.mode === "point" || value.mode === "area") &&
        isRecord(value.style)
      );
    case "section":
      return (
        isRichTextDocument(value.title) &&
        typeof value.titleVisible === "boolean" &&
        typeof value.collapsed === "boolean" &&
        ["none", "background", "all"].includes(String(value.lockMode)) &&
        isStringArray(value.memberIds) &&
        isRecord(value.style)
      );
    case "table":
      return isTableElementPayload(value);
    case "stamp":
      return typeof value.emoji === "string";
    case "media":
      return (
        ["image", "gif", "video"].includes(String(value.mediaKind)) &&
        isAsset(value.asset) &&
        typeof value.altText === "string" &&
        isCrop(value.crop) &&
        typeof value.playing === "boolean"
      );
    case "link_preview":
      return (
        typeof value.url === "string" &&
        ["card", "embed", "url"].includes(String(value.display)) &&
        ["horizontal", "vertical"].includes(String(value.layout))
      );
    case "code_block":
      return (
        typeof value.code === "string" &&
        typeof value.language === "string" &&
        (value.theme === "light" || value.theme === "dark")
      );
    case "mind_map_node":
      return (
        isRichTextDocument(value.content) &&
        isMindMapRelation(value.relation) &&
        isRecord(value.style)
      );
    default:
      return false;
  }
}

export function isBoardElementPatchOperation(
  value: unknown,
): value is BoardElementPatchOperation {
  if (!isRecord(value) || typeof value.op !== "string") return false;
  switch (value.op) {
    case "field.set":
      return isPatchPath(value.path) && isBoardJsonValue(value.value);
    case "field.unset":
      return isPatchPath(value.path);
    case "table.cell.patched":
      return isNonEmptyString(value.cellId) && isRecord(value.patch);
    case "table.row.inserted":
      return (
        isNonNegativeInteger(value.index) &&
        isTableRow(value.row) &&
        (value.cells === undefined ||
          (Array.isArray(value.cells) && value.cells.every(isTableCell)))
      );
    case "table.row.deleted":
      return isNonEmptyString(value.rowId);
    case "table.row.moved":
      return isNonEmptyString(value.rowId) && isNonNegativeInteger(value.index);
    case "table.column.inserted":
      return (
        isNonNegativeInteger(value.index) &&
        isTableColumn(value.column) &&
        (value.cells === undefined ||
          (Array.isArray(value.cells) && value.cells.every(isTableCell)))
      );
    case "table.column.deleted":
      return isNonEmptyString(value.columnId);
    case "table.column.moved":
      return isNonEmptyString(value.columnId) && isNonNegativeInteger(value.index);
    case "table.cells.merged":
      return isTableMerge(value.merge);
    case "table.cells.unmerged":
      return isNonEmptyString(value.mergeId);
    case "attachment.changed":
      return value.attachment === null || isAttachment(value.attachment);
    case "mind_map.relation.changed":
      return isMindMapRelation(value.relation);
    default:
      return false;
  }
}

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.blocks)) return false;
  return value.blocks.every((block) => {
    if (
      !isRecord(block) ||
      (block.id !== undefined && !isNonEmptyString(block.id)) ||
      !Array.isArray(block.runs)
    ) {
      return false;
    }
    if (
      ![
        "paragraph",
        "heading",
        "unordered_list_item",
        "ordered_list_item",
        "blockquote",
        "code",
      ].includes(String(block.type))
    ) {
      return false;
    }
    return block.runs.every(
      (run) => isRecord(run) && typeof run.text === "string" && run.text.length <= 100_000,
    );
  });
}

export function isBoardJsonValue(value: unknown, depth = 0): value is BoardJsonValue {
  if (depth > 50) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isBoardJsonValue(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) => !UNSAFE_PATH_PARTS.has(key) && isBoardJsonValue(item, depth + 1),
  );
}

function isTableElementPayload(value: Record<string, unknown>): boolean {
  if (
    !Array.isArray(value.rows) ||
    !value.rows.every(isTableRow) ||
    !Array.isArray(value.columns) ||
    !value.columns.every(isTableColumn) ||
    !isRecord(value.cells) ||
    !Object.values(value.cells).every(isTableCell) ||
    !Array.isArray(value.merges) ||
    !value.merges.every(isTableMerge)
  ) {
    return false;
  }
  return value.rows.length * value.columns.length <= 500;
}

function isTableRow(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonNegativeFinite(value.height);
}

function isTableColumn(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonNegativeFinite(value.width);
}

function isTableCell(value: unknown): value is TableCell {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.rowId) &&
    isNonEmptyString(value.columnId) &&
    isRichTextDocument(value.content) &&
    isRecord(value.style)
  );
}

function isTableMerge(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isStringArray(value.cellIds) &&
    value.cellIds.length > 1 &&
    isNonEmptyString(value.anchorCellId) &&
    value.cellIds.includes(value.anchorCellId)
  );
}

function isAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "element") return isNonEmptyString(value.elementId);
  return (
    value.kind === "table_cell" &&
    isNonEmptyString(value.tableId) &&
    isNonEmptyString(value.cellId)
  );
}

function isMindMapRelation(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.parentId === undefined || isNonEmptyString(value.parentId)) &&
    isStringArray(value.childIds) &&
    ["left", "right", "up", "down"].includes(String(value.direction)) &&
    isStringArray(value.connectorIds)
  );
}

function isConnectorEndpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPoint(value.point) &&
    ["none", "solid_arrow", "line_arrow", "triangle", "diamond"].includes(
      String(value.decoration),
    ) &&
    (value.binding === undefined ||
      (isRecord(value.binding) && isNonEmptyString(value.binding.elementId)))
  );
}

function isAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.boardId) &&
    typeof value.url === "string" &&
    isNonEmptyString(value.mimeType) &&
    isNonNegativeFinite(value.sizeBytes)
  );
}

function isCrop(value: unknown): boolean {
  return (
    isRecord(value) &&
    [value.x, value.y, value.width, value.height, value.zoom].every(Number.isFinite)
  );
}

function isTransform(value: unknown): boolean {
  return (
    isRecord(value) &&
    [value.x, value.y, value.width, value.height, value.rotation].every(Number.isFinite) &&
    Number(value.width) >= 0 &&
    Number(value.height) >= 0
  );
}

function isStrokePoint(value: unknown): boolean {
  return (
    isPoint(value) &&
    isRecord(value) &&
    Number.isFinite(value.t)
  );
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isPatchPath(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (part) =>
        (typeof part === "string" && part.length > 0 && !UNSAFE_PATH_PARTS.has(part)) ||
        (typeof part === "number" && Number.isSafeInteger(part) && part >= 0),
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonNegativeFinite(value: unknown): boolean {
  return Number.isFinite(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
