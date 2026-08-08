import { canonicalShapeKind, BOARD_SHAPE_CATALOG } from "./shapeCatalog.ts";
import type {
  BoardElementKind,
  CodeLanguage,
  ConnectorPathKind,
  ShapeKind,
} from "./types.ts";

export type SceneIntentTarget =
  | { kind: "selection" }
  | { kind: "visible_label"; label: string };

export type BoardSceneIntent =
  | {
      type: "create";
      kind: Exclude<BoardElementKind, "connector" | "drawing">;
      label?: string;
      shapeKind?: ShapeKind;
      table?: { rows: number; columns: number };
      language?: CodeLanguage;
      stampKind?: "emoji" | "face";
      placement?: { direction: "left" | "right" | "up" | "down"; target: "selection" };
    }
  | {
      type: "create_connected";
      shapeKind: ShapeKind;
      label?: string;
      to: SceneIntentTarget;
      pathKind: ConnectorPathKind;
    }
  | {
      type: "connect";
      from: SceneIntentTarget;
      to: SceneIntentTarget;
      pathKind: ConnectorPathKind;
      label?: string;
    }
  | { type: "rename"; target: SceneIntentTarget; label: string }
  | { type: "delete"; target: SceneIntentTarget }
  | { type: "move"; target: SceneIntentTarget; dx: number; dy: number }
  | { type: "resize"; target: SceneIntentTarget; scaleX: number; scaleY: number }
  | { type: "style"; target: SceneIntentTarget; color: string }
  | { type: "select_all" }
  | { type: "group"; target: SceneIntentTarget; label?: string }
  | {
      type: "layout";
      target: SceneIntentTarget;
      direction: "left_to_right" | "right_to_left" | "top_to_bottom" | "bottom_to_top" | "grid";
    }
  | { type: "invalid"; reason: "TABLE_CELL_LIMIT_EXCEEDED" | "INVALID_TABLE_DIMENSIONS" };

const CREATE = "(?:add|create|insert|make|put)";
const LANGUAGE_ALIASES: Readonly<Record<string, CodeLanguage>> = {
  "c++": "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  graphql: "graphql",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  kotlin: "kotlin",
  python: "python",
  py: "python",
  react: "react",
  ruby: "ruby",
  rust: "rust",
  sql: "sql",
  swift: "swift",
  typescript: "typescript",
  ts: "typescript",
};
const COLOR_ALIASES: Readonly<Record<string, string>> = {
  black: "#111827",
  gray: "#6b7280",
  grey: "#6b7280",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  white: "#ffffff",
};

const SHAPE_TERMS = BOARD_SHAPE_CATALOG.flatMap((entry) =>
  [entry.name, entry.kind, ...entry.aliases].map((term) => ({
    term: normalize(term),
    kind: entry.kind as ShapeKind,
  })),
).sort((a, b) => b.term.length - a.term.length);

/** Deterministic Airo grammar for v2 board elements and selected-object edits. */
export function parseBoardSceneIntent(rawInput: string): BoardSceneIntent | null {
  const sourceWithPlacement = stripDisfluencies(stripWakeWord(rawInput))
    .trim()
    .replace(/[.!?]+$/, "");
  const placementMatch = /\s+(left|right|above|below|up|down)\s+(?:of\s+)?selected$/i.exec(sourceWithPlacement);
  const placement = placementMatch
    ? {
        direction: normalizePlacementDirection(placementMatch[1]!),
        target: "selection" as const,
      }
    : undefined;
  const source = sourceWithPlacement
    .replace(/\s+here$/i, "")
    .replace(/\s+(?:left|right|above|below|up|down)\s+(?:of\s+)?selected$/i, "")
    .trim();
  const input = normalize(source);
  const namedLabel = extractNamedLabel(source);
  if (!input) return null;

  // A disconnected-line instruction is a repair of an existing legacy
  // connector, not a request to create a new v2 connector between labels.
  // Leave it to the established graph-repair grammar, which can inspect the
  // connector's bindings and fail closed when the candidate is ambiguous.
  if (/^connect (?:the )?existing disconnected line\b/.test(input)) return null;

  const connectedSource = source.replace(/[,;:]+/g, " ").replace(/\s+/g, " ");
  const connectedCreate = new RegExp(
    `^${CREATE}(?: a| an)? (.+?)(?: (?:named|called) (.+?))?(?: layer)? that is connected to (.+)$`,
    "i",
  ).exec(connectedSource);
  if (connectedCreate) {
    const shapeKind = canonicalShapeKind(connectedCreate[1] ?? "");
    if (shapeKind) {
      return {
        type: "create_connected",
        shapeKind: shapeKind as ShapeKind,
        to: parseTarget(connectedCreate[3] ?? "selected"),
        pathKind: "bent",
        ...(cleanLabel(connectedCreate[2]) ? { label: cleanLabel(connectedCreate[2])! } : {}),
      };
    }
  }

  const table = new RegExp(`^${CREATE}(?: a| an)?(?: (\\d+)\\s*(?:by|x|×)\\s*(\\d+))? table(?: .*)?$`).exec(input);
  if (table) {
    const rows = Number(table[1] ?? 3);
    const columns = Number(table[2] ?? 3);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) {
      return { type: "invalid", reason: "INVALID_TABLE_DIMENSIONS" };
    }
    if (rows * columns > 500) return { type: "invalid", reason: "TABLE_CELL_LIMIT_EXCEEDED" };
    return {
      type: "create",
      kind: "table",
      table: { rows, columns },
      ...(placement ? { placement } : {}),
    };
  }

  const code = new RegExp(`^${CREATE}(?: a| an)? code block(?: in ([a-z+]+))?(?: .*)?$`).exec(input);
  if (code) {
    const language = LANGUAGE_ALIASES[code[1] ?? "typescript"] ?? "typescript";
    return { type: "create", kind: "code_block", language, ...(placement ? { placement } : {}) };
  }

  const mindMap = new RegExp(`^${CREATE}(?: a| an)? mind[ -]?map(?: (?:named|called) (.+))?$`).exec(input);
  if (mindMap) {
    return {
      type: "create",
      kind: "mind_map_node",
      label: namedLabel ?? "Central idea",
      ...(placement ? { placement } : {}),
    };
  }

  const section = new RegExp(`^${CREATE}(?: a| an)? section(?: around (?:these|those|selected|selection))?(?: (?:named|called) (.+))?$`).exec(input);
  if (section) {
    return {
      type: "create",
      kind: "section",
      ...(namedLabel ? { label: namedLabel } : {}),
      ...(placement ? { placement } : {}),
    };
  }

  const directKind = new RegExp(`^${CREATE}(?: a| an)? (sticky(?: note)?|text(?: box)?|stamp|face stamp|media|image|gif|video|link(?: preview)?)(?: (?:named|called) (.+))?$`).exec(input);
  if (directKind) {
    const term = directKind[1] ?? "";
    const kind: BoardElementKind = term.startsWith("sticky")
      ? "sticky"
      : term.startsWith("text")
        ? "text"
        : term.includes("stamp")
          ? "stamp"
          : term.startsWith("link")
            ? "link_preview"
            : "media";
    return {
      type: "create",
      kind: kind as Exclude<BoardElementKind, "connector" | "drawing">,
      ...(term === "face stamp" ? { stampKind: "face" as const } : {}),
      ...(namedLabel ? { label: namedLabel } : {}),
      ...(placement ? { placement } : {}),
    };
  }

  const shapeCreate = new RegExp(`^${CREATE}(?: a| an)? (.+?)(?: (?:named|called) (.+))?$`).exec(input);
  if (shapeCreate) {
    const phrase = shapeCreate[1] ?? "";
    const exact = canonicalShapeKind(phrase);
    const contained = SHAPE_TERMS.find(({ term }) => phrase === term || phrase.endsWith(` ${term}`));
    const shapeKind = (exact ?? contained?.kind) as ShapeKind | null;
    if (shapeKind) {
      return {
        type: "create",
        kind: "shape",
        shapeKind,
        ...(namedLabel ? { label: namedLabel } : {}),
        ...(placement ? { placement } : {}),
      };
    }
  }

  const rename = /^rename (selected|selection|this|that|.+?) to (.+)$/.exec(input);
  if (rename) {
    const sourceRename = /^rename (selected|selection|this|that|.+?) to (.+)$/i.exec(source);
    return {
      type: "rename",
      target: parseTarget(rename[1] ?? "selected"),
      label: cleanLabel(sourceRename?.[2]) ?? "Untitled",
    };
  }

  const connect = /^connect (selected|selection|this|that|.+?) to (selected|selection|this|that|.+?)(?: (?:as|label(?:ed)?) (.+?))?(?: with a (straight|bent|curved) connector)?$/.exec(input);
  if (connect) {
    const sourceConnect = /^connect (selected|selection|this|that|.+?) to (selected|selection|this|that|.+?)(?: (?:as|label(?:ed)?) (.+?))?(?: with a (straight|bent|curved) connector)?$/i.exec(source);
    return {
      type: "connect",
      from: parseTarget(connect[1] ?? "selected"),
      to: parseTarget(connect[2] ?? "selected"),
      pathKind: (connect[4] as ConnectorPathKind | undefined) ?? "bent",
      ...(connect[3] ? { label: cleanLabel(sourceConnect?.[3]) ?? connect[3] } : {}),
    };
  }

  const remove = /^(?:delete|remove) (selected|selection|this|that|.+)$/.exec(input);
  if (remove) return { type: "delete", target: parseTarget(remove[1] ?? "selected") };

  if (/^select (?:everything|all|all objects)$/.test(input)) {
    return { type: "select_all" };
  }

  const move = /^move (selected|selection|this|that|.+?) (left|right|up|down|above|below)(?: (\d+))?$/.exec(input);
  if (move) {
    const distance = Math.min(2_000, Math.max(1, Number(move[3] ?? 80)));
    const direction = move[2];
    return {
      type: "move",
      target: parseTarget(move[1] ?? "selected"),
      dx: direction === "left" ? -distance : direction === "right" ? distance : 0,
      dy: direction === "up" || direction === "above" ? -distance : direction === "down" || direction === "below" ? distance : 0,
    };
  }

  const resize = /^make (selected|selection|this|that|.+?) (taller|shorter|wider|narrower)$/.exec(input);
  if (resize) {
    const direction = resize[2];
    return {
      type: "resize",
      target: parseTarget(resize[1] ?? "selected"),
      scaleX: direction === "wider" ? 1.25 : direction === "narrower" ? 0.8 : 1,
      scaleY: direction === "taller" ? 1.25 : direction === "shorter" ? 0.8 : 1,
    };
  }

  const style = /^(?:make|style|color) (selected|selection|this|that|.+?) (?:fill )?(#[0-9a-f]{6}|black|gr[ae]y|red|orange|yellow|green|blue|purple|pink|white)$/.exec(input);
  if (style) {
    const colorTerm = style[2] ?? "black";
    return {
      type: "style",
      target: parseTarget(style[1] ?? "selected"),
      color: COLOR_ALIASES[colorTerm] ?? colorTerm,
    };
  }

  const group = /^(?:group|create a section around) (selected|selection|these|those)(?: (?:named|called) (.+))?$/.exec(input);
  if (group) {
    return {
      type: "group",
      target: { kind: "selection" },
      ...(namedLabel ? { label: namedLabel } : {}),
    };
  }

  const layout = /^(?:layout|lay out|arrange) (selected|selection|these|those) (left to right|right to left|top to bottom|bottom to top|grid|horizontally|vertically)$/.exec(input);
  if (layout) {
    const direction: Extract<BoardSceneIntent, { type: "layout" }>["direction"] = layout[2] === "horizontally"
      ? "left_to_right"
      : layout[2] === "vertically"
        ? "top_to_bottom"
        : layout[2]!.replaceAll(" ", "_") as Extract<BoardSceneIntent, { type: "layout" }>["direction"];
    return {
      type: "layout",
      target: { kind: "selection" },
      direction,
    };
  }

  return null;
}

function parseTarget(value: string): SceneIntentTarget {
  const normalized = normalize(value);
  return ["selected", "selection", "this", "that", "these", "those"].includes(normalized)
    ? { kind: "selection" }
    : { kind: "visible_label", label: cleanLabel(value) ?? value.trim() };
}

function stripWakeWord(value: string): string {
  return value.trim().replace(/^(?:hey\s+)?(?:airo|airboard)[,:]?\s*/i, "");
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

function cleanLabel(value: string | undefined): string | null {
  const label = value?.trim().replace(/^['"]|['"]$/g, "");
  return label ? label.slice(0, 240) : null;
}

function extractNamedLabel(value: string): string | null {
  return cleanLabel(/\b(?:named|called)\s+(.+)$/i.exec(value)?.[1]);
}

function stripDisfluencies(value: string): string {
  return value
    .replace(/\b(?:uh+|um+)\b\s*,?/gi, " ")
    .replace(/\s+/g, " ");
}

function normalizePlacementDirection(
  value: string,
): "left" | "right" | "up" | "down" {
  switch (value.toLowerCase()) {
    case "above": return "up";
    case "below": return "down";
    case "left": return "left";
    case "right": return "right";
    case "up": return "up";
    case "down": return "down";
    default: return "right";
  }
}
