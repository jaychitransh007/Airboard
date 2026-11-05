import type {
  AnnotationBounds,
  AnnotationNodeType,
  AnnotationPoint,
  BoardElementBase,
  BoardElementKind,
  BoardElementPatchOperation,
  BoardElementTransform,
  BoardJsonValue,
  BoardSceneElement,
  ConnectorElement,
  DrawingElement,
  MindMapNodeElement,
  RichTextDocument,
  ShapeElement,
  ShapeKind,
  ShapeStyle,
  Stroke,
  TableCell,
  TableCellStyle,
  TableColumn,
  TableElement,
  TableRow,
} from "./types.ts";
import { isBoardSceneElement } from "./sceneValidation.ts";

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: "#ffffff",
  fillOpacity: 1,
  stroke: "#111827",
  strokeOpacity: 1,
  strokeWidth: 2,
  strokeStyle: "solid",
  textColor: "#111827",
  textAlign: "center",
};

export const DEFAULT_TABLE_CELL_STYLE: TableCellStyle = {
  fill: "#ffffff",
  textColor: "#111827",
  horizontalAlign: "left",
  verticalAlign: "middle",
};

const DEFAULT_ELEMENT_SIZES: Readonly<Record<BoardElementKind, { width: number; height: number }>> = {
  drawing: { width: 1, height: 1 },
  sticky: { width: 160, height: 160 },
  shape: { width: 180, height: 100 },
  connector: { width: 160, height: 1 },
  text: { width: 240, height: 40 },
  section: { width: 600, height: 400 },
  table: { width: 360, height: 180 },
  stamp: { width: 48, height: 48 },
  media: { width: 320, height: 240 },
  link_preview: { width: 320, height: 160 },
  code_block: { width: 420, height: 180 },
  mind_map_node: { width: 180, height: 64 },
};

export function createRichTextDocument(
  text = "",
  blockId = "block-0",
): RichTextDocument {
  return {
    type: "doc",
    blocks: [
      {
        id: blockId,
        type: "paragraph",
        runs: [{ text }],
      },
    ],
  };
}

export function richTextToPlainText(document: RichTextDocument): string {
  return document.blocks
    .map((block) => block.runs.map((run) => run.text).join(""))
    .join("\n");
}

export function createElementTransform(
  kind: BoardElementKind,
  input: Partial<BoardElementTransform> = {},
): BoardElementTransform {
  const size = DEFAULT_ELEMENT_SIZES[kind];
  return {
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? size.width,
    height: input.height ?? size.height,
    rotation: input.rotation ?? 0,
  };
}

type ElementDraft<TElement extends BoardSceneElement> = Pick<
  TElement,
  "id" | "boardId" | "kind"
> &
  Partial<Omit<TElement, "id" | "boardId" | "kind">>;

export type BoardSceneElementDraft = BoardSceneElement extends infer TElement
  ? TElement extends BoardSceneElement
    ? ElementDraft<TElement>
    : never
  : never;

/**
 * Creates a complete scene element from the small payload needed by creation
 * tools. Kind-specific defaults make this suitable for toolbar placement while
 * callers can still override every serializable field.
 */
export function createBoardSceneElement<TKind extends BoardElementKind>(
  input: Extract<BoardSceneElementDraft, { kind: TKind }>,
): Extract<BoardSceneElement, { kind: TKind }>;
export function createBoardSceneElement(input: BoardSceneElementDraft): BoardSceneElement {
  const now = input.createdAt ?? new Date().toISOString();
  const transform = input.transform ?? createElementTransform(input.kind);
  const base = {
    id: input.id,
    boardId: input.boardId,
    kind: input.kind,
    status: input.status ?? "active",
    transform,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    visible: input.visible ?? true,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    revision: input.revision ?? 1,
    ...(input.creatorId ? { creatorId: input.creatorId } : {}),
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
    ...(input.attachment ? { attachment: input.attachment } : {}),
    ...(input.legacyStrokeId ? { legacyStrokeId: input.legacyStrokeId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } satisfies BoardElementBase<BoardElementKind>;

  let element: BoardSceneElement;
  switch (input.kind) {
    case "drawing":
      element = {
        ...base,
        kind: "drawing",
        drawingKind: input.drawingKind ?? "marker",
        points: input.points ?? [],
        style: input.style ?? {
          color: "#111827",
          thickness: 4,
          opacity: 1,
          straight: false,
        },
      };
      break;
    case "sticky":
      element = {
        ...base,
        kind: "sticky",
        content: input.content ?? createRichTextDocument("", `${input.id}:content`),
        layout: input.layout ?? "square",
        color: input.color ?? "#fde68a",
        authorVisible: input.authorVisible ?? true,
      };
      break;
    case "shape":
      element = {
        ...base,
        kind: "shape",
        shapeKind: input.shapeKind ?? "square",
        content: input.content ?? createRichTextDocument("", `${input.id}:content`),
        style: input.style ?? { ...DEFAULT_SHAPE_STYLE },
      };
      break;
    case "connector": {
      const startPoint = { x: transform.x, y: transform.y + transform.height / 2 };
      const endPoint = {
        x: transform.x + transform.width,
        y: transform.y + transform.height / 2,
      };
      element = {
        ...base,
        kind: "connector",
        pathKind: input.pathKind ?? "straight",
        start: input.start ?? { point: startPoint, decoration: "none" },
        end: input.end ?? { point: endPoint, decoration: "solid_arrow" },
        controlPoints: input.controlPoints ?? [],
        label: input.label ?? createRichTextDocument("", `${input.id}:label`),
        labelPosition: input.labelPosition ?? 0.5,
        style: input.style ?? {
          color: "#111827",
          opacity: 1,
          thickness: "thin",
          strokeStyle: "solid",
          labelBackground: "none",
        },
      };
      break;
    }
    case "text":
      element = {
        ...base,
        kind: "text",
        content: input.content ?? createRichTextDocument("", `${input.id}:content`),
        mode: input.mode ?? "point",
        style: input.style ?? {
          preset: "simple",
          color: "#111827",
          fontSize: 18,
          align: "left",
          verticalAlign: "top",
        },
      };
      break;
    case "section":
      element = {
        ...base,
        kind: "section",
        title: input.title ?? createRichTextDocument("Section", `${input.id}:title`),
        titleVisible: input.titleVisible ?? true,
        collapsed: input.collapsed ?? false,
        lockMode: input.lockMode ?? "none",
        memberIds: input.memberIds ?? [],
        style: input.style ?? {
          fill: "#dbeafe",
          fillOpacity: 0.12,
          stroke: "#60a5fa",
        },
      };
      break;
    case "table": {
      const defaults = createDefaultTableData(input.id, 3, 3);
      element = {
        ...base,
        kind: "table",
        rows: input.rows ?? defaults.rows,
        columns: input.columns ?? defaults.columns,
        cells: input.cells ?? defaults.cells,
        merges: input.merges ?? [],
      };
      break;
    }
    case "stamp":
      element = {
        ...base,
        kind: "stamp",
        emoji: input.emoji ?? "👍",
        ...(input.label ? { label: input.label } : {}),
        ...(input.faceAsset ? { faceAsset: input.faceAsset } : {}),
        ...(input.authorId ? { authorId: input.authorId } : {}),
      };
      break;
    case "media":
      element = {
        ...base,
        kind: "media",
        mediaKind: input.mediaKind ?? "image",
        asset: input.asset ?? {
          id: `${input.id}:asset`,
          boardId: input.boardId,
          url: "",
          mimeType: "application/octet-stream",
          sizeBytes: 0,
        },
        altText: input.altText ?? "",
        crop: input.crop ?? { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
        playing: input.playing ?? false,
      };
      break;
    case "link_preview":
      element = {
        ...base,
        kind: "link_preview",
        url: input.url ?? "",
        display: input.display ?? "card",
        layout: input.layout ?? "horizontal",
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.siteName ? { siteName: input.siteName } : {}),
        ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
        ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
        ...(input.embedUrl ? { embedUrl: input.embedUrl } : {}),
      };
      break;
    case "code_block":
      element = {
        ...base,
        kind: "code_block",
        code: input.code ?? "const value = {\n  hello: \"world\",\n};\n",
        language: input.language ?? "typescript",
        theme: input.theme ?? "dark",
      };
      break;
    case "mind_map_node":
      element = {
        ...base,
        kind: "mind_map_node",
        content: input.content ?? createRichTextDocument("Idea", `${input.id}:content`),
        relation: input.relation ?? {
          childIds: [],
          direction: "right",
          connectorIds: [],
        },
        style: input.style ?? {
          fill: "#ffffff",
          textColor: "#111827",
          lineColor: "#6366f1",
        },
      };
      break;
  }

  return element;
}

export function createDefaultTableData(
  tableId: string,
  requestedRows: number,
  requestedColumns: number,
): Pick<TableElement, "rows" | "columns" | "cells"> {
  const rowCount = Math.max(1, Math.floor(requestedRows));
  const columnCount = Math.max(1, Math.floor(requestedColumns));
  if (rowCount * columnCount > 500) {
    throw new RangeError("TABLE_CELL_LIMIT_EXCEEDED");
  }

  const rows: TableRow[] = Array.from({ length: rowCount }, (_, index) => ({
    id: `${tableId}:row:${index}`,
    height: 44,
  }));
  const columns: TableColumn[] = Array.from({ length: columnCount }, (_, index) => ({
    id: `${tableId}:column:${index}`,
    width: 120,
  }));
  const cells: Record<string, TableCell> = {};
  for (const row of rows) {
    for (const column of columns) {
      const id = `${row.id}:${column.id}`;
      cells[id] = {
        id,
        rowId: row.id,
        columnId: column.id,
        content: createRichTextDocument("", `${id}:content`),
        style: { ...DEFAULT_TABLE_CELL_STYLE },
      };
    }
  }
  return { rows, columns, cells };
}

/** Converts a committed v1 stroke/annotation into its v2 scene equivalent. */
export function boardSceneElementFromLegacyStroke(
  stroke: Stroke,
  options: { zIndex?: number; revision?: number } = {},
): BoardSceneElement {
  const annotation = stroke.annotation;
  const transform = transformFromLegacyStroke(stroke);
  const shared = {
    id: stroke.id,
    boardId: stroke.boardId,
    transform,
    status: stroke.status === "deleted" ? "deleted" : "active",
    zIndex: options.zIndex ?? 0,
    locked: false,
    visible: true,
    creatorId: stroke.userId,
    createdAt: stroke.createdAt,
    updatedAt: stroke.updatedAt,
    revision: options.revision ?? 1,
    legacyStrokeId: stroke.id,
  } as const;
  const label = annotation?.label ?? "";

  if (annotation?.type === "sticky_note") {
    return {
      ...shared,
      kind: "sticky",
      content: createRichTextDocument(label, `${stroke.id}:content`),
      layout: transform.width === transform.height ? "square" : "rectangle",
      color: annotation.fillColor ?? "#fde68a",
      authorVisible: true,
    };
  }

  if (
    annotation?.type === "flow_node" ||
    annotation?.type === "rectangle" ||
    annotation?.type === "ellipse"
  ) {
    const shapeKind =
      annotation.shapeKind ?? legacyShapeKind(annotation.type, annotation.nodeType);
    return {
      ...shared,
      kind: "shape",
      shapeKind,
      content: createRichTextDocument(label, `${stroke.id}:content`),
      style: {
        ...DEFAULT_SHAPE_STYLE,
        fill: annotation.fillColor ?? DEFAULT_SHAPE_STYLE.fill,
        fillOpacity: annotation.opacity ?? DEFAULT_SHAPE_STYLE.fillOpacity,
        stroke: annotation.strokeColor ?? stroke.color,
        strokeWidth: stroke.thickness,
      },
    };
  }

  if (annotation?.type === "connector" || annotation?.type === "arrow") {
    const start = annotation.start ?? firstPoint(stroke) ?? { x: transform.x, y: transform.y };
    const end = annotation.end ?? lastPoint(stroke) ?? {
      x: transform.x + transform.width,
      y: transform.y + transform.height,
    };
    const connector: ConnectorElement = {
      ...shared,
      kind: "connector",
      pathKind: annotation.type === "connector" ? "bent" : "straight",
      start: {
        point: start,
        decoration: "none",
        ...(annotation.snappedStartStrokeId
          ? { binding: { elementId: annotation.snappedStartStrokeId, anchor: "auto" } }
          : {}),
      },
      end: {
        point: end,
        decoration: "solid_arrow",
        ...(annotation.snappedEndStrokeId
          ? { binding: { elementId: annotation.snappedEndStrokeId, anchor: "auto" } }
          : {}),
      },
      controlPoints: [],
      label: createRichTextDocument(label, `${stroke.id}:label`),
      labelPosition: 0.5,
      style: {
        color: annotation.strokeColor ?? stroke.color,
        opacity: annotation.opacity ?? 1,
        thickness: stroke.thickness > 4 ? "thick" : "thin",
        strokeStyle: "solid",
        labelBackground: "none",
      },
    };
    return connector;
  }

  if (annotation?.type === "text_label") {
    return {
      ...shared,
      kind: "text",
      content: createRichTextDocument(label, `${stroke.id}:content`),
      mode: "area",
      style: {
        preset: "simple",
        color: annotation.strokeColor ?? stroke.color,
        fontSize: 18,
        align: "left",
        verticalAlign: "top",
      },
    };
  }

  const drawing: DrawingElement = {
    ...shared,
    kind: "drawing",
    drawingKind: annotation?.type === "highlight" ? "highlighter" : "marker",
    points: stroke.points,
    style: {
      color: annotation?.strokeColor ?? stroke.color,
      thickness: stroke.thickness,
      opacity: annotation?.opacity ?? (annotation?.type === "highlight" ? 0.35 : 1),
      straight: Boolean(stroke.lineSnapApplied),
    },
  };
  return drawing;
}

export function applyBoardElementPatches(
  element: BoardSceneElement,
  patches: readonly BoardElementPatchOperation[],
  updatedAt: string,
): BoardSceneElement {
  let current = element;
  for (const patch of patches) {
    current = applyOnePatch(current, patch);
  }
  if (current === element || !isBoardSceneElement(current)) {
    return element;
  }
  return {
    ...current,
    updatedAt,
    revision: Math.max(0, element.revision) + 1,
  } as BoardSceneElement;
}

/** Build path/structure-specific inverse operations for local undo. */
export function invertBoardElementPatches(
  element: BoardSceneElement,
  patches: readonly BoardElementPatchOperation[],
): BoardElementPatchOperation[] {
  let current = element;
  const inverseGroups: BoardElementPatchOperation[][] = [];
  for (const patch of patches) {
    inverseGroups.unshift(inversePatch(current, patch));
    current = applyOnePatch(current, patch);
  }
  return inverseGroups.flat();
}

function inversePatch(
  element: BoardSceneElement,
  patch: BoardElementPatchOperation,
): BoardElementPatchOperation[] {
  switch (patch.op) {
    case "field.set": {
      const previous = valueAtPath(element, patch.path);
      return previous === undefined
        ? [{ op: "field.unset", path: firstMissingPath(element, patch.path) }]
        : [{ op: "field.set", path: patch.path, value: previous as BoardJsonValue }];
    }
    case "field.unset": {
      const previous = valueAtPath(element, patch.path);
      return previous === undefined
        ? []
        : [{ op: "field.set", path: patch.path, value: previous as BoardJsonValue }];
    }
    case "attachment.changed":
      return [{ op: "attachment.changed", attachment: element.attachment ?? null }];
    case "mind_map.relation.changed":
      return element.kind === "mind_map_node"
        ? [{ op: "mind_map.relation.changed", relation: element.relation }]
        : [];
    case "table.cell.patched": {
      if (element.kind !== "table") return [];
      const cell = element.cells[patch.cellId];
      if (!cell) return [];
      const restored: Partial<TableCell> = {};
      for (const key of Object.keys(patch.patch) as Array<keyof TableCell>) {
        Object.assign(restored, { [key]: structuredClone(cell[key]) });
      }
      return [{ op: "table.cell.patched", cellId: cell.id, patch: restored }];
    }
    case "table.row.inserted":
      return [{ op: "table.row.deleted", rowId: patch.row.id }];
    case "table.row.deleted": {
      if (element.kind !== "table") return [];
      const index = element.rows.findIndex(({ id }) => id === patch.rowId);
      if (index < 0) return [];
      const row = element.rows[index]!;
      const cells = Object.values(element.cells).filter(({ rowId }) => rowId === row.id);
      return [{ op: "table.row.inserted", index, row, cells }];
    }
    case "table.row.moved": {
      if (element.kind !== "table") return [];
      const index = element.rows.findIndex(({ id }) => id === patch.rowId);
      return index < 0 ? [] : [{ op: "table.row.moved", rowId: patch.rowId, index }];
    }
    case "table.column.inserted":
      return [{ op: "table.column.deleted", columnId: patch.column.id }];
    case "table.column.deleted": {
      if (element.kind !== "table") return [];
      const index = element.columns.findIndex(({ id }) => id === patch.columnId);
      if (index < 0) return [];
      const column = element.columns[index]!;
      const cells = Object.values(element.cells).filter(({ columnId }) => columnId === column.id);
      return [{ op: "table.column.inserted", index, column, cells }];
    }
    case "table.column.moved": {
      if (element.kind !== "table") return [];
      const index = element.columns.findIndex(({ id }) => id === patch.columnId);
      return index < 0 ? [] : [{ op: "table.column.moved", columnId: patch.columnId, index }];
    }
    case "table.cells.merged": {
      if (element.kind !== "table") return [];
      const replaced = element.merges.filter((merge) =>
        merge.cellIds.some((cellId) => patch.merge.cellIds.includes(cellId)),
      );
      return [
        { op: "table.cells.unmerged", mergeId: patch.merge.id },
        ...replaced.map((merge): BoardElementPatchOperation => ({ op: "table.cells.merged", merge })),
      ];
    }
    case "table.cells.unmerged": {
      if (element.kind !== "table") return [];
      const merge = element.merges.find(({ id }) => id === patch.mergeId);
      return merge ? [{ op: "table.cells.merged", merge }] : [];
    }
  }
}

function valueAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let value = root;
  for (const part of path) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

function firstMissingPath(
  root: unknown,
  path: readonly (string | number)[],
): [string, ...(string | number)[]] {
  let value = root;
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index]!;
    if (!value || typeof value !== "object" || !(part in value)) {
      return path.slice(0, index + 1) as [string, ...(string | number)[]];
    }
    value = (value as Record<string | number, unknown>)[part];
  }
  return [...path] as [string, ...(string | number)[]];
}

function applyOnePatch(
  element: BoardSceneElement,
  patch: BoardElementPatchOperation,
): BoardSceneElement {
  switch (patch.op) {
    case "field.set":
      return setElementPath(element, patch.path, patch.value);
    case "field.unset":
      return unsetElementPath(element, patch.path);
    case "attachment.changed": {
      if (patch.attachment) {
        return { ...element, attachment: patch.attachment } as BoardSceneElement;
      }
      const { attachment: _removed, ...rest } = element;
      return rest as BoardSceneElement;
    }
    case "mind_map.relation.changed":
      return element.kind === "mind_map_node"
        ? ({ ...element, relation: patch.relation } satisfies MindMapNodeElement)
        : element;
    case "table.cell.patched": {
      if (element.kind !== "table") return element;
      const cell = element.cells[patch.cellId];
      if (!cell) return element;
      return {
        ...element,
        cells: {
          ...element.cells,
          [patch.cellId]: { ...cell, ...patch.patch, id: cell.id },
        },
      };
    }
    case "table.row.inserted": {
      if (element.kind !== "table" || element.rows.some((row) => row.id === patch.row.id)) {
        return element;
      }
      if ((element.rows.length + 1) * element.columns.length > 500) return element;
      const rows = insertAt(element.rows, patch.index, patch.row);
      const cells = { ...element.cells };
      for (const cell of patch.cells ?? []) {
        if (cell.rowId === patch.row.id && element.columns.some((column) => column.id === cell.columnId)) {
          cells[cell.id] = cell;
        }
      }
      return { ...element, rows, cells };
    }
    case "table.row.deleted": {
      if (element.kind !== "table" || element.rows.length <= 1) return element;
      const deletedCellIds = new Set(
        Object.values(element.cells)
          .filter((cell) => cell.rowId === patch.rowId)
          .map((cell) => cell.id),
      );
      if (deletedCellIds.size === 0 && !element.rows.some((row) => row.id === patch.rowId)) {
        return element;
      }
      return {
        ...element,
        rows: element.rows.filter((row) => row.id !== patch.rowId),
        cells: Object.fromEntries(
          Object.entries(element.cells).filter(([, cell]) => cell.rowId !== patch.rowId),
        ),
        merges: element.merges.filter(
          (merge) => !merge.cellIds.some((cellId) => deletedCellIds.has(cellId)),
        ),
      };
    }
    case "table.row.moved":
      return element.kind === "table"
        ? { ...element, rows: moveById(element.rows, patch.rowId, patch.index) }
        : element;
    case "table.column.inserted": {
      if (
        element.kind !== "table" ||
        element.columns.some((column) => column.id === patch.column.id)
      ) {
        return element;
      }
      if (element.rows.length * (element.columns.length + 1) > 500) return element;
      const columns = insertAt(element.columns, patch.index, patch.column);
      const cells = { ...element.cells };
      for (const cell of patch.cells ?? []) {
        if (cell.columnId === patch.column.id && element.rows.some((row) => row.id === cell.rowId)) {
          cells[cell.id] = cell;
        }
      }
      return { ...element, columns, cells };
    }
    case "table.column.deleted": {
      if (element.kind !== "table" || element.columns.length <= 1) return element;
      const deletedCellIds = new Set(
        Object.values(element.cells)
          .filter((cell) => cell.columnId === patch.columnId)
          .map((cell) => cell.id),
      );
      if (
        deletedCellIds.size === 0 &&
        !element.columns.some((column) => column.id === patch.columnId)
      ) {
        return element;
      }
      return {
        ...element,
        columns: element.columns.filter((column) => column.id !== patch.columnId),
        cells: Object.fromEntries(
          Object.entries(element.cells).filter(([, cell]) => cell.columnId !== patch.columnId),
        ),
        merges: element.merges.filter(
          (merge) => !merge.cellIds.some((cellId) => deletedCellIds.has(cellId)),
        ),
      };
    }
    case "table.column.moved":
      return element.kind === "table"
        ? { ...element, columns: moveById(element.columns, patch.columnId, patch.index) }
        : element;
    case "table.cells.merged": {
      if (element.kind !== "table") return element;
      const cellIds = new Set(patch.merge.cellIds);
      if (
        !cellIds.has(patch.merge.anchorCellId) ||
        [...cellIds].some((cellId) => !element.cells[cellId])
      ) {
        return element;
      }
      return {
        ...element,
        merges: [
          ...element.merges.filter(
            (merge) =>
              merge.id !== patch.merge.id &&
              !merge.cellIds.some((cellId) => cellIds.has(cellId)),
          ),
          patch.merge,
        ],
      };
    }
    case "table.cells.unmerged":
      return element.kind === "table"
        ? { ...element, merges: element.merges.filter((merge) => merge.id !== patch.mergeId) }
        : element;
  }
}

const PROTECTED_PATCH_ROOTS = new Set([
  "id",
  "boardId",
  "kind",
  "status",
  "createdAt",
  "updatedAt",
  "revision",
]);
const UNSAFE_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

function setElementPath(
  element: BoardSceneElement,
  path: readonly (string | number)[],
  value: unknown,
): BoardSceneElement {
  if (!isSafeMutablePath(path)) return element;
  return updatePath(element, path, () => value) as BoardSceneElement;
}

function unsetElementPath(
  element: BoardSceneElement,
  path: readonly (string | number)[],
): BoardSceneElement {
  if (!isSafeMutablePath(path)) return element;
  return updatePath(element, path, () => undefined, true) as BoardSceneElement;
}

function isSafeMutablePath(path: readonly (string | number)[]): boolean {
  if (path.length === 0 || typeof path[0] !== "string" || PROTECTED_PATCH_ROOTS.has(path[0])) {
    return false;
  }
  return path.every(
    (part) =>
      (typeof part === "string" && !UNSAFE_PATH_PARTS.has(part)) ||
      (typeof part === "number" && Number.isSafeInteger(part) && part >= 0),
  );
}

function updatePath(
  root: unknown,
  path: readonly (string | number)[],
  update: (value: unknown) => unknown,
  remove = false,
): unknown {
  const [head, ...tail] = path;
  if (head === undefined) return root;
  const container = Array.isArray(root)
    ? [...root]
    : root && typeof root === "object"
      ? { ...(root as Record<string, unknown>) }
      : typeof head === "number"
        ? []
        : {};

  if (tail.length === 0) {
    if (remove) {
      if (Array.isArray(container) && typeof head === "number") {
        container.splice(head, 1);
      } else {
        delete (container as Record<string | number, unknown>)[head];
      }
    } else {
      (container as Record<string | number, unknown>)[head] = update(
        (container as Record<string | number, unknown>)[head],
      );
    }
    return container;
  }

  const record = container as Record<string | number, unknown>;
  record[head] = updatePath(record[head], tail, update, remove);
  return container;
}

function insertAt<T>(items: readonly T[], requestedIndex: number, item: T): T[] {
  const index = Math.min(items.length, Math.max(0, Math.floor(requestedIndex)));
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function moveById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  requestedIndex: number,
): T[] {
  const currentIndex = items.findIndex((item) => item.id === id);
  if (currentIndex < 0) return [...items];
  const remaining = [...items.slice(0, currentIndex), ...items.slice(currentIndex + 1)];
  return insertAt(remaining, requestedIndex, items[currentIndex]!);
}

function transformFromLegacyStroke(stroke: Stroke): BoardElementTransform {
  const bounds = stroke.annotation?.bounds;
  if (bounds) return transformFromBounds(bounds);

  const annotationPoints = [stroke.annotation?.start, stroke.annotation?.end].filter(
    (point): point is AnnotationPoint => Boolean(point),
  );
  const points = annotationPoints.length > 0 ? annotationPoints : stroke.points;
  if (points.length === 0) return createElementTransform("drawing");
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
    rotation: 0,
  };
}

function transformFromBounds(bounds: AnnotationBounds): BoardElementTransform {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    rotation: 0,
  };
}

function legacyShapeKind(
  annotationType: "flow_node" | "rectangle" | "ellipse",
  nodeType?: AnnotationNodeType,
): ShapeKind {
  if (annotationType === "ellipse") return "ellipse";
  if (annotationType === "rectangle") return "square";
  switch (nodeType) {
    case "process":
      return "process";
    case "service":
      return "service";
    case "database":
      return "database";
    case "queue":
      return "queue";
    case "user":
      return "user";
    case "api":
      return "api";
    case "decision":
      return "diamond";
    case "terminator":
      return "terminator";
    case "io":
      return "right-parallelogram";
    case "document":
      return "document";
    case "circle":
      return "ellipse";
    case "note":
    case "custom":
    default:
      return "rounded-rectangle";
  }
}

function firstPoint(stroke: Stroke): AnnotationPoint | undefined {
  const point = stroke.points[0];
  return point ? { x: point.x, y: point.y } : undefined;
}

function lastPoint(stroke: Stroke): AnnotationPoint | undefined {
  const point = stroke.points.at(-1);
  return point ? { x: point.x, y: point.y } : undefined;
}
