import { richTextToPlainText } from "./sceneElements.ts";
import type { BoardElementKind, RichTextDocument } from "./types.ts";

export type BoardPreviewShape = {
  kind: BoardElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Drawn as an ellipse rather than a box. */
  round?: true;
};

export type BoardPreviewLine = { x1: number; y1: number; x2: number; y2: number };

/**
 * A small outline of a saved board for the library: where its shapes and
 * connectors sit, and the words on it for search. Never the full content.
 */
export type BoardPreview = {
  bounds: { x: number; y: number; width: number; height: number } | null;
  shapes: BoardPreviewShape[];
  lines: BoardPreviewLine[];
  text: string[];
};

const MAX_SHAPES = 60;
const MAX_LINES = 60;
const MAX_TEXT = 40;
const MAX_TEXT_LENGTH = 120;

type Loose = Record<string, unknown>;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;

function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  const document = record(value);
  if (!document) return "";
  try {
    return richTextToPlainText(document as unknown as RichTextDocument);
  } catch {
    return "";
  }
}

/**
 * Builds the preview from a stored board state. The state comes from the
 * database as plain JSON, so every field is checked rather than trusted.
 */
export function boardPreview(state: unknown): BoardPreview {
  const elements = Object.values(record(record(state)?.elements) ?? {})
    .map(record)
    .filter((element): element is Loose =>
      Boolean(element) && element?.status !== "deleted" && element?.visible !== false,
    )
    .sort((left, right) => (finite(left.zIndex) ? left.zIndex : 0) - (finite(right.zIndex) ? right.zIndex : 0));

  const shapes: BoardPreviewShape[] = [];
  const lines: BoardPreviewLine[] = [];
  const text: string[] = [];
  for (const element of elements) {
    const kind = element.kind as BoardElementKind;
    if (kind === "connector") {
      const start = record(record(element.start)?.point);
      const end = record(record(element.end)?.point);
      if (lines.length < MAX_LINES && start && end && finite(start.x) && finite(start.y) && finite(end.x) && finite(end.y)) {
        lines.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      }
    } else if (kind !== "drawing") {
      const transform = record(element.transform);
      if (
        shapes.length < MAX_SHAPES &&
        transform &&
        finite(transform.x) &&
        finite(transform.y) &&
        finite(transform.width) &&
        finite(transform.height) &&
        transform.width > 0 &&
        transform.height > 0
      ) {
        const round = kind === "shape" && /ellipse|circle|oval/i.test(String(element.shapeKind ?? ""));
        shapes.push({
          kind,
          x: transform.x,
          y: transform.y,
          width: transform.width,
          height: transform.height,
          ...(round ? { round: true as const } : {}),
        });
      }
    }
    for (const field of ["content", "label", "title", "text"]) {
      if (text.length >= MAX_TEXT) break;
      const words = plainText(element[field]).replace(/\s+/g, " ").trim();
      if (words) text.push(words.slice(0, MAX_TEXT_LENGTH));
    }
  }

  const xs = [...shapes.flatMap((shape) => [shape.x, shape.x + shape.width]), ...lines.flatMap((line) => [line.x1, line.x2])];
  const ys = [...shapes.flatMap((shape) => [shape.y, shape.y + shape.height]), ...lines.flatMap((line) => [line.y1, line.y2])];
  const bounds = xs.length
    ? { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    : null;
  return { bounds, shapes, lines, text: [...new Set(text)] };
}
