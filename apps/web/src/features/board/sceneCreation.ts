import {
  createBoardSceneElement,
  createDefaultTableData,
  createRichTextDocument,
  shapeCatalogEntry,
  type BoardSceneElement,
  type CodeLanguage,
  type ConnectorPathKind,
} from "@airboard/core";
import {
  shapeForTool,
  type CreationToolId,
} from "./creationToolCatalog.ts";

export type SceneCreationOptions = {
  boardId: string;
  creatorId?: string;
  point: { x: number; y: number };
  stampEmoji?: string;
  table?: { rows: number; columns: number };
  label?: string;
  language?: CodeLanguage;
};

/** Create every synchronous v2 toolbar object at a board-space point. */
export function createSceneElementForTool(
  tool: CreationToolId,
  options: SceneCreationOptions,
): BoardSceneElement | null {
  const id = crypto.randomUUID();
  const base = {
    id,
    boardId: options.boardId,
    zIndex: 1,
    ...(options.creatorId ? { creatorId: options.creatorId } : {}),
  };
  const shape = shapeForTool(tool);
  if (shape) {
    const size = shapeCatalogEntry(shape.kind, shape.category).defaultSize;
    return createBoardSceneElement({
      ...base,
      kind: "shape",
      shapeKind: shape.kind,
      transform: centeredTransform(options.point, size),
      content: createRichTextDocument(options.label ?? "", `${id}:content`),
    });
  }

  switch (tool) {
    case "sticky":
      return createBoardSceneElement({
        ...base,
        kind: "sticky",
        transform: centeredTransform(options.point, { width: 160, height: 160 }),
        content: createRichTextDocument(options.label ?? "", `${id}:content`),
      });
    case "text":
      return createBoardSceneElement({
        ...base,
        kind: "text",
        transform: centeredTransform(options.point, { width: 240, height: 48 }),
        content: createRichTextDocument(options.label ?? "", `${id}:content`),
      });
    case "section":
      return createBoardSceneElement({
        ...base,
        kind: "section",
        transform: centeredTransform(options.point, { width: 600, height: 400 }),
        title: createRichTextDocument(options.label ?? "Section", `${id}:title`),
      });
    case "table": {
      const rows = options.table?.rows ?? 3;
      const columns = options.table?.columns ?? 3;
      const data = createDefaultTableData(id, rows, columns);
      const width = Math.min(1_200, Math.max(240, columns * 120));
      const height = Math.min(1_000, Math.max(88, rows * 44));
      return createBoardSceneElement({
        ...base,
        kind: "table",
        transform: centeredTransform(options.point, { width, height }),
        ...data,
      });
    }
    case "stamp":
    case "insert:face-stamp":
      return createBoardSceneElement({
        ...base,
        kind: "stamp",
        transform: centeredTransform(options.point, { width: 56, height: 56 }),
        emoji: options.stampEmoji ?? (tool === "insert:face-stamp" ? "🙂" : "👍"),
        ...(options.creatorId ? { authorId: options.creatorId } : {}),
      });
    case "insert:code-block":
      return createBoardSceneElement({
        ...base,
        kind: "code_block",
        transform: centeredTransform(options.point, { width: 420, height: 180 }),
        language: options.language ?? "typescript",
      });
    case "insert:mind-map":
      return createBoardSceneElement({
        ...base,
        kind: "mind_map_node",
        transform: centeredTransform(options.point, { width: 180, height: 64 }),
        content: createRichTextDocument(options.label ?? "Central idea", `${id}:content`),
      });
    case "connector:bent":
    case "connector:curved":
    case "connector:straight": {
      const pathKind = tool.slice("connector:".length) as ConnectorPathKind;
      const transform = centeredTransform(options.point, { width: 180, height: 80 });
      return createBoardSceneElement({ ...base, kind: "connector", transform, pathKind });
    }
    default:
      return null;
  }
}

export function centeredTransform(
  point: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number; width: number; height: number; rotation: number } {
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
  };
}
