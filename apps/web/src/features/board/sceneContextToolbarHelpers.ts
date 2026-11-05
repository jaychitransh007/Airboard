import type { BoardSceneElement, RichTextDocument, RichTextMark } from "@airboard/core";

export type ToggleableRichTextMark =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode";

/** Grows a sticky note to fit its wrapped text, never below its square size. */
export function stickyHeightForText(
  sticky: { layout: "square" | "rectangle"; transform: { width: number } },
  value: string,
): number {
  const charactersPerLine = sticky.layout === "square" ? 18 : 30;
  const lineCount = value.split("\n").reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
  return Math.max(sticky.layout === "square" ? sticky.transform.width : 92, 54 + lineCount * 22);
}

export function richTextPlainValue(document: RichTextDocument): string {
  return document.blocks
    .map((block) => block.runs.map((run) => run.text).join(""))
    .join("\n");
}

/**
 * Replace the text an ordinary textarea exposes without discarding block
 * alignment, list/heading roles, or the active run's marks.
 */
export function replaceRichTextPlainValue(
  document: RichTextDocument,
  value: string,
): RichTextDocument {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  return {
    type: "doc",
    blocks: lines.map((line, index) => {
      const source = document.blocks[index] ?? document.blocks[document.blocks.length - 1];
      const firstRun = source?.runs[0];
      return {
        ...(source ?? { type: "paragraph" as const }),
        id: source?.id ?? `block-${index}`,
        runs: [
          {
            text: line,
            ...(firstRun?.marks ? { marks: { ...firstRun.marks } } : {}),
            ...(firstRun?.mention ? { mention: { ...firstRun.mention } } : {}),
          },
        ],
      };
    }),
  };
}

export function richTextMarkIsActive(
  document: RichTextDocument,
  mark: ToggleableRichTextMark,
): boolean {
  const runs = document.blocks.flatMap((block) => block.runs);
  return runs.length > 0 && runs.every((run) => run.marks?.[mark] === true);
}

export function toggleRichTextMark(
  document: RichTextDocument,
  mark: ToggleableRichTextMark,
): RichTextDocument {
  const active = richTextMarkIsActive(document, mark);
  return {
    type: "doc",
    blocks: document.blocks.map((block) => ({
      ...block,
      runs: block.runs.map((run) => {
        const marks: RichTextMark = { ...run.marks };
        if (active) delete marks[mark];
        else marks[mark] = true;
        if (Object.keys(marks).length > 0) return { ...run, marks };
        const { marks: _removedMarks, ...unmarkedRun } = run;
        return unmarkedRun;
      }),
    })),
  };
}

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function httpLinkHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A colour the compact element toolbar offers as a swatch. */
export type CompactColorField = {
  label: string;
  path: [string, ...string[]];
  value: string;
};

/**
 * The colours an element's compact toolbar shows; everything else waits
 * behind More. Kinds without a main colour (tables, media, links, code,
 * stamps) show none.
 */
export function compactColorFields(element: BoardSceneElement): CompactColorField[] {
  switch (element.kind) {
    case "drawing":
      return [{ label: "Color", path: ["style", "color"], value: element.style.color }];
    case "sticky":
      return [{ label: "Paper", path: ["color"], value: element.color }];
    case "shape":
      return [
        { label: "Fill", path: ["style", "fill"], value: element.style.fill },
        { label: "Stroke", path: ["style", "stroke"], value: element.style.stroke },
      ];
    case "connector":
      return [{ label: "Line", path: ["style", "color"], value: element.style.color }];
    case "text":
      return [{ label: "Color", path: ["style", "color"], value: element.style.color }];
    case "section":
      return [
        { label: "Fill", path: ["style", "fill"], value: element.style.fill },
        { label: "Border", path: ["style", "stroke"], value: element.style.stroke },
      ];
    case "mind_map_node":
      return [
        { label: "Fill", path: ["style", "fill"], value: element.style.fill },
        { label: "Line", path: ["style", "lineColor"], value: element.style.lineColor },
      ];
    default:
      return [];
  }
}

export type ScreenBounds = { left: number; top: number; right: number; bottom: number };

/**
 * Where the element toolbar floats: centred above the selection, or below it
 * when the top bar leaves no room, always inside the window and clear of the
 * top bar and the bottom dock.
 */
export function contextToolbarPosition(
  anchor: ScreenBounds,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { gap?: number; margin?: number; minTop?: number; bottomReserve?: number } = {},
): { left: number; top: number } {
  const gap = options.gap ?? 12;
  const margin = options.margin ?? 12;
  const minTop = options.minTop ?? 72;
  const maxTop = Math.max(minTop, viewport.height - (options.bottomReserve ?? 96) - size.height);
  const centred = (anchor.left + anchor.right) / 2 - size.width / 2;
  const left = Math.min(Math.max(margin, centred), Math.max(margin, viewport.width - margin - size.width));
  const above = anchor.top - gap - size.height;
  const top = above >= minTop ? above : Math.min(anchor.bottom + gap, maxTop);
  return { left: Math.round(left), top: Math.round(Math.max(minTop, top)) };
}

