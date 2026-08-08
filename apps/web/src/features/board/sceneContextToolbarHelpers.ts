import type { RichTextDocument, RichTextMark } from "@airboard/core";

export type ToggleableRichTextMark =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode";

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
