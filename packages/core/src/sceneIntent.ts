import { canonicalShapeKind, BOARD_SHAPE_CATALOG, defaultCommandShapeLabel } from "./shapeCatalog.ts";
import type {
  BoardElementKind,
  CodeLanguage,
  ConnectorPathKind,
  ShapeKind,
} from "./types.ts";

/**
 * Words that point at something without naming it. The UI resolves them:
 * first what the hand was pointing at when the speech started, then the
 * selection, then the element created or edited most recently. "this" and
 * "that" stay distinct so "connect this to that" can address two elements.
 */
export type SceneIntentPronoun = "it" | "this" | "that" | "them" | "these" | "those";

export type SceneIntentTarget =
  | { kind: "selection" }
  | { kind: "contextual"; pronoun: SceneIntentPronoun }
  | { kind: "visible_label"; label: string };

export type SceneIntentPlacementDirection = "left" | "right" | "up" | "down";

export type SceneIntentPlacement =
  | { direction: SceneIntentPlacementDirection; target: "selection" }
  | { direction: SceneIntentPlacementDirection; target: "contextual"; pronoun: SceneIntentPronoun }
  | { direction: SceneIntentPlacementDirection; target: "visible_label"; label: string }
  /** "here", "there", "over here": where the hand was pointing when the speech started. */
  | { target: "pointer" };

export type SceneIntentLayoutDirection =
  | "left_to_right"
  | "right_to_left"
  | "top_to_bottom"
  | "bottom_to_top"
  | "grid";

export type BoardSceneIntent =
  | {
      type: "create";
      kind: Exclude<BoardElementKind, "connector" | "drawing">;
      label?: string;
      /** The label is a catalog default, not a name the person gave. */
      generatedLabel?: true;
      shapeKind?: ShapeKind;
      table?: { rows: number; columns: number };
      language?: CodeLanguage;
      stampKind?: "emoji" | "face";
      placement?: SceneIntentPlacement;
    }
  | {
      type: "create_connected";
      shapeKind: ShapeKind;
      label?: string;
      generatedLabel?: true;
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
  /** Nudge by a distance in board units ("move it left", "move the API up 120"). */
  | { type: "move"; target: SceneIntentTarget; dx: number; dy: number }
  /** Move an existing element beside another one, or to where the hand points. */
  | { type: "move_to"; target: SceneIntentTarget; destination: SceneIntentPlacement }
  | { type: "resize"; target: SceneIntentTarget; scaleX: number; scaleY: number }
  | { type: "style"; target: SceneIntentTarget; color: string }
  /** Keep the element, its label and connections; swap its catalog shape. */
  | { type: "change_shape"; target: SceneIntentTarget; shapeKind: ShapeKind }
  | { type: "reorder"; target: SceneIntentTarget; position: "front" | "back" }
  | { type: "select_all" }
  | { type: "group"; target: SceneIntentTarget; label?: string }
  | { type: "layout"; target: SceneIntentTarget; direction: SceneIntentLayoutDirection }
  /**
   * Undo `count` board changes. Plain "undo", "undo that" and "go back" are
   * left to the web app's intent parser, which already executes them, so this
   * only carries the forms that parser does not know ("scratch that",
   * "undo twice", a leading "then …").
   */
  | { type: "undo"; count: number }
  | { type: "redo"; count: number }
  /**
   * "no, I meant a database": undo the last change, then apply the remainder.
   * `intent` is set when the remainder is a full command on its own; `shapeKind`
   * is set when it is only a shape ("a database"), so the UI can repeat the
   * undone command with that shape instead. Neither set: hand the remainder,
   * with the undone command, to the AI planner.
   */
  | {
      type: "correct";
      remainder: string;
      intent: Exclude<BoardSceneIntent, { type: "correct" }> | null;
      shapeKind?: ShapeKind;
    }
  | { type: "zoom_to_fit" }
  | { type: "focus"; target: SceneIntentTarget }
  | { type: "invalid"; reason: "TABLE_CELL_LIMIT_EXCEEDED" | "INVALID_TABLE_DIMENSIONS" };

const CREATE = "(?:add|create|insert|make|put|place|draw)";
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
const COLOR_PATTERN = "#[0-9a-f]{6}|black|gr[ae]y|red|orange|yellow|green|blue|purple|pink|white";

const SHAPE_TERMS = BOARD_SHAPE_CATALOG.flatMap((entry) =>
  [entry.name, entry.kind, ...entry.aliases].map((term) => ({
    term: normalize(term),
    kind: entry.kind as ShapeKind,
  })),
).sort((a, b) => b.term.length - a.term.length);

/**
 * A create may describe its shape in a few words ("a payment service", "the
 * orders queue"). A longer lead-in, or one with a conjunction, pronoun,
 * relation or second verb in it, is a sentence that merely ends in a shape
 * name, such as "put the user and the API side by side and group them as
 * front end". That is for Airo to plan, not a create (RGB-040).
 */
const MAX_SHAPE_DESCRIPTION_WORDS = 3;
const NOT_A_SHAPE_DESCRIPTION = new Set([
  "and", "or", "but", "then", "so", "them", "it", "its", "they", "their", "those", "these",
  "this", "that", "here", "there",
  "to", "with", "from", "into", "onto", "between", "by", "as", "along", "of", "for", "next", "side",
  "add", "put", "make", "create", "insert", "group", "line", "lined", "align", "connect", "connected",
  "move", "rename", "delete", "remove", "label", "call", "called", "named",
]);

/**
 * Describing words that say nothing about what the shape stands for. They are
 * dropped from the label, so "add a big red database" is labelled "Database"
 * while "add a payments service" is labelled "Payments Service".
 */
const NON_NAMING_MODIFIERS = new Set([
  "a", "an", "the", "one", "single", "new", "another", "more",
  "big", "bigger", "small", "smaller", "large", "little", "tiny", "huge", "wide", "tall",
  "empty", "blank", "simple", "basic", "plain", "regular", "normal", "generic",
  "black", "gray", "grey", "red", "orange", "yellow", "green", "blue", "purple", "pink", "white",
]);

function describesShape(words: string): boolean {
  const list = words.split(" ").filter(Boolean);
  return list.length <= MAX_SHAPE_DESCRIPTION_WORDS && !list.some((word) => NOT_A_SHAPE_DESCRIPTION.has(word));
}

/**
 * Deterministic Airo grammar for short, single-step board commands.
 *
 * It returns null for anything it cannot read cleanly — two actions, lists,
 * relative clauses, counts, or requests for a whole diagram — so the AI
 * planner gets those instead of a fast rule misapplying them on the shared
 * screen.
 */
export function parseBoardSceneIntent(rawInput: string): BoardSceneIntent | null {
  const spoken = stripDisfluencies(stripWakeWord(rawInput)).trim().replace(/[.!?]+$/, "").trim();
  // The web app's intent parser already runs plain "undo"/"go back" and
  // "cancel"/"never mind"; leave exactly what it understands to it.
  if (handledByIntentCanvasParser(spoken)) return null;

  const sentence = stripFillers(spoken);
  if (!sentence) return null;

  const correction = parseCorrection(sentence);
  if (correction !== undefined) return correction;

  return parseCommand(sentence);
}

/**
 * True when a sentence is too compound for any fixed phrase rule (two
 * actions, a list, a clause, a count, a whole diagram). Callers send these
 * straight to the AI planner; the older phrase grammar would otherwise read
 * "add a database and a cache" as one database labelled "and a cache".
 */
export function isCompoundBoardCommand(rawInput: string): boolean {
  const sentence = stripFillers(stripDisfluencies(stripWakeWord(rawInput)).trim().replace(/[.!?]+$/, "").trim());
  return Boolean(sentence) && isCompoundOrOpenEnded(sentence);
}

function parseCommand(sentence: string): Exclude<BoardSceneIntent, { type: "correct" }> | null {
  const meta = parseMetaCommand(normalize(sentence));
  if (meta) return meta;

  if (isCompoundOrOpenEnded(sentence)) return null;

  const pointerMatch = /\s+(?:(?:over|right|just|in|out)\s+)?(?:here|there)$/i.exec(sentence);
  const sourceWithPlacement = pointerMatch ? sentence.slice(0, pointerMatch.index).trim() : sentence;
  const input = normalize(sourceWithPlacement);
  if (!input) return null;

  // A disconnected-line instruction is a repair of an existing legacy
  // connector, not a request to create a new v2 connector between labels.
  // Leave it to the established graph-repair grammar, which can inspect the
  // connector's bindings and fail closed when the candidate is ambiguous.
  if (/^connect (?:the )?existing disconnected line\b/.test(input)) return null;

  const edit = parseElementEdit(input, sourceWithPlacement, Boolean(pointerMatch));
  if (edit !== undefined) return edit;

  return parseCreate(sourceWithPlacement, Boolean(pointerMatch)) ?? parseOtherCommand(input, sourceWithPlacement, Boolean(pointerMatch));
}

// ---------------------------------------------------------------------------
// Commands about the board itself: undo, redo, view.

const COUNT_WORDS: Readonly<Record<string, number>> = {
  once: 1, twice: 2, thrice: 3,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const MAX_HISTORY_STEPS = 20;

function parseCount(value: string | undefined): number {
  if (!value) return 1;
  const parsed = /^\d+$/.test(value) ? Number(value) : COUNT_WORDS[value] ?? 1;
  return Math.min(MAX_HISTORY_STEPS, Math.max(1, parsed));
}

const COUNT_TERM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
const REPEAT_SUFFIX = `(?: (?:(once|twice|thrice)|${COUNT_TERM} times|${COUNT_TERM} steps?|${COUNT_TERM} changes?))?`;

function parseMetaCommand(input: string): Exclude<BoardSceneIntent, { type: "correct" }> | null {
  const undo = new RegExp(
    `^(?:undo(?: (?:that|it|this|(?:the )?last (?:action|change|step|thing)))?|go back|scratch (?:that|it|this)|take (?:that|it) back|revert (?:that|it))${REPEAT_SUFFIX}$`,
  ).exec(input);
  if (undo) return { type: "undo", count: parseCount(undo[1] ?? undo[2] ?? undo[3] ?? undo[4]) };
  const undoLast = new RegExp(`^undo the last ${COUNT_TERM} (?:actions|changes|steps|things)$`).exec(input);
  if (undoLast) return { type: "undo", count: parseCount(undoLast[1]) };

  const redo = new RegExp(`^(?:redo(?: (?:that|it|this|(?:the )?last (?:action|change|step|thing)))?|bring (?:it|that) back)${REPEAT_SUFFIX}$`).exec(input);
  if (redo) return { type: "redo", count: parseCount(redo[1] ?? redo[2] ?? redo[3] ?? redo[4]) };

  if (/^(?:zoom (?:out )?to fit(?: (?:everything|all|the board))?|zoom out to (?:show|see) (?:everything|it all|the whole board)|fit (?:the |everything |it all |all )?(?:board|diagram|everything|view|screen|all)?(?: (?:to|on|in|into) (?:the )?(?:screen|view|window))?|fit to (?:the )?(?:screen|view|window)|show (?:me )?(?:everything|it all|the (?:whole|entire|full) (?:board|diagram))|(?:let me |let's )?see everything)$/.test(input)
    && input !== "fit") {
    return { type: "zoom_to_fit" };
  }
  return null;
}

// The web app's parser (intentCanvasParser.ts) peels only these courtesy
// words before its own undo/cancel grammar, so a sentence it handles is one
// that matches after exactly this stripping.
const INTENT_CANVAS_COURTESY =
  /^(?:(?:uh|um|erm|ah|hmm|well|yeah|yep|so|like|now|okay|ok|alright|right)(?:[,.;:\s]+|$)|please(?:[,.;:\s]+|$)|(?:can|could|would)\s+you(?:[,.;:\s]+|$))/i;

function handledByIntentCanvasParser(value: string): boolean {
  let text = value.trim();
  for (let pass = 0; pass < 8; pass += 1) {
    const next = text.replace(INTENT_CANVAS_COURTESY, "").trim();
    if (next === text) break;
    text = next;
  }
  const normalized = text.replace(/(?:\s+|,\s*)please$/i, "").trim().toLowerCase().replace(/\s+/g, " ");
  return /^(?:undo|undo\s+(?:that|it|(?:the\s+)?last\s+(?:action|change))|go\s+back)$/.test(normalized) ||
    /^(?:cancel|cancel\s+(?:that|it|the\s+command)|never\s*mind|stop\s+(?:that|the\s+command))$/.test(normalized);
}

/** "no, I meant a database", "sorry, I meant make it blue". */
function parseCorrection(sentence: string): BoardSceneIntent | null | undefined {
  const match = /^(?:(?:no|nope|sorry|oops|actually|wait|oh)[,.;:!\s]+)*i meant(?: to)?[,:\s]+(.+)$/i.exec(sentence);
  if (!match) return undefined;
  const remainder = stripFillers(match[1]!.trim());
  if (!remainder || isCompoundOrOpenEnded(remainder)) return null;
  const intent = parseCommand(remainder);
  if (intent && intent.type !== "invalid") return { type: "correct", remainder, intent };
  const shapePhrase = normalize(remainder).replace(/^(?:a|an|the)\s+/, "");
  const shapeKind = canonicalShapeKind(shapePhrase);
  if (shapeKind) return { type: "correct", remainder, intent: null, shapeKind: shapeKind as ShapeKind };
  // "I meant …" followed by something that is not a command or a shape is
  // more likely an aside ("I meant the old API is slow") than a correction.
  return null;
}

// ---------------------------------------------------------------------------
// Edits to an existing element: change shape, resize, move, reorder, focus.

const MOVE_VERB = "(?:move|put|place|drag|shift|slide)";
const AMOUNT = "(?:(?:just )?(?:a (?:bit|little)(?: bit)?|slightly|a touch)|(?:a lot|way|far|much))";

function parseElementEdit(
  input: string,
  source: string,
  pointer: boolean,
): Exclude<BoardSceneIntent, { type: "correct" }> | null | undefined {
  // "make it a queue", "change the API to a queue", "turn it into a decision".
  const changeShape = /^(?:make|turn|change|convert|switch) (.+?) (?:into |in to |to )?(?:an? )(.+)$/.exec(input) ??
    /^(?:turn|change|convert|switch) (.+?) (?:into|in to|to) (.+)$/.exec(input);
  if (changeShape && !pointer) {
    const shapeKind = canonicalShapeKind(changeShape[2]!);
    const target = parseShortTarget(changeShape[1]!);
    if (shapeKind && target) return { type: "change_shape", target, shapeKind: shapeKind as ShapeKind };
  }

  // "make it bigger", "make the API a bit wider", "enlarge it".
  const resize = new RegExp(`^make (.+?) (?:(${AMOUNT}) )?(bigger|larger|smaller|wider|narrower|taller|shorter)$`).exec(input);
  if (resize && !pointer) {
    const target = parseShortTarget(resize[1]!);
    if (target) return resizeIntent(target, resize[3]!, resize[2]);
  }
  const resizeVerb = /^(enlarge|grow|shrink) (.+?)(?: (a (?:bit|little)(?: bit)?|slightly|a lot))?$/.exec(input);
  if (resizeVerb && !pointer) {
    const target = parseShortTarget(resizeVerb[2]!);
    if (target) return resizeIntent(target, resizeVerb[1] === "shrink" ? "smaller" : "bigger", resizeVerb[3]);
  }

  // "bring it to the front", "send the API to the back", "move it to the front".
  // "forward"/"backward" (one layer) and "move it to the top" (a place on
  // the board, or the top layer?) are not read here.
  const reorder = /^(bring|send|move|put) (.+?) to (?:the )?(front|back|top|bottom)$/.exec(input);
  const reorderVerbFits = reorder && (/^(?:bring|send)$/.test(reorder[1]!) || /^(?:front|back)$/.test(reorder[3]!));
  if (reorder && reorderVerbFits && !pointer) {
    const target = parseShortTarget(reorder[2]!);
    if (target) return { type: "reorder", target, position: /^(?:front|top)$/.test(reorder[3]!) ? "front" : "back" };
  }

  // "focus on payments", "zoom in on the API".
  const focus = /^(?:focus on|zoom (?:in )?(?:on|to|into)|center on|centre on|jump to) (.+)$/.exec(input);
  if (focus && !pointer) {
    const target = parseShortTarget(focus[1]!);
    return target ? { type: "focus", target } : null;
  }

  // Moves of an existing element. "move"/"drag" always mean an existing one;
  // "put"/"place" do only with "the", a pointing word or "selected" — "put a
  // database below the API" is a create.
  const moveMatch = new RegExp(`^${MOVE_VERB} (.+)$`).exec(input);
  if (!moveMatch) return undefined;
  const isPutVerb = /^(?:put|place) /.test(input);
  if (isPutVerb && !/^(?:put|place) (?:the|it|this|that|them|these|those|selected|selection)\b/.test(input)) {
    return undefined;
  }
  const sourceRest = new RegExp(`^${MOVE_VERB} (.+)$`, "i").exec(normalizeKeepCase(source))?.[1] ?? moveMatch[1]!;

  if (pointer) {
    const target = parseShortTarget(sourceRest, { keepCase: true });
    return target ? { type: "move_to", target, destination: { target: "pointer" } } : null;
  }

  const nudge = new RegExp(
    `^(.+?) (?:over )?(?:(${AMOUNT}) )?(?:to the |towards the |toward the )?(left|right|up|down|above|below|higher|lower)(?: (?:by )?(\\d+)(?: ?(?:px|pixels|units))?| (${AMOUNT}))?$`,
  ).exec(moveMatch[1]!);
  if (nudge) {
    const target = parseShortTarget(nudge[1]!);
    if (!target) return null;
    const amount = nudge[2] ?? nudge[5];
    const distance = nudge[4]
      ? Math.min(2_000, Math.max(1, Number(nudge[4])))
      : amount
        ? /lot|way|far|much/.test(amount) ? 240 : 40
        : 80;
    const direction = nudge[3]!;
    return {
      type: "move",
      target,
      dx: direction === "left" ? -distance : direction === "right" ? distance : 0,
      dy: /^(?:up|above|higher)$/.test(direction) ? -distance : /^(?:down|below|lower)$/.test(direction) ? distance : 0,
    };
  }

  // Anything else after "move" is not something these rules can place.
  return parseRelativeMove(sourceRest);
}

function resizeIntent(
  target: SceneIntentTarget,
  direction: string,
  amount: string | undefined,
): Extract<BoardSceneIntent, { type: "resize" }> {
  const grow = amount ? (/lot|way|far|much/.test(amount) ? 1.5 : 1.1) : 1.25;
  const shrink = amount ? (/lot|way|far|much/.test(amount) ? 0.67 : 0.9) : 0.8;
  switch (direction) {
    case "bigger":
    case "larger": return { type: "resize", target, scaleX: grow, scaleY: grow };
    case "smaller": return { type: "resize", target, scaleX: shrink, scaleY: shrink };
    case "wider": return { type: "resize", target, scaleX: grow, scaleY: 1 };
    case "narrower": return { type: "resize", target, scaleX: shrink, scaleY: 1 };
    case "taller": return { type: "resize", target, scaleX: 1, scaleY: grow };
    default: return { type: "resize", target, scaleX: 1, scaleY: shrink };
  }
}

/** "the database below the API", "it to the right of Orders", "that next to this". */
function parseRelativeMove(rest: string): Extract<BoardSceneIntent, { type: "move_to" }> | null {
  for (const { pattern, direction } of RELATIVE_PATTERNS) {
    const match = pattern.exec(rest);
    if (!match) continue;
    const target = parseShortTarget(match[1]!.replace(/\s+(?:to|on)\s+the$/i, ""), { keepCase: true });
    const anchor = parsePlacementAnchor(match[3]!, direction(match[2]!));
    if (!target || !anchor) return null;
    return { type: "move_to", target, destination: anchor };
  }
  return null;
}

const RELATIVE_PATTERNS: readonly {
  pattern: RegExp;
  direction: (term: string) => SceneIntentPlacementDirection;
}[] = [
  {
    pattern: /^(.+?)\s+(left|right)(?:\s+side)?\s+of\s+(.+)$/i,
    direction: (term) => (term.toLowerCase() === "left" ? "left" : "right"),
  },
  {
    pattern: /^(.+?)\s+(above|below|under|underneath|beneath|on\s+top\s+of)\s+(.+)$/i,
    direction: (term) => (/^(?:above|on\s+top\s+of)$/i.test(term) ? "up" : "down"),
  },
  {
    pattern: /^(.+?)\s+(next\s+to|beside|alongside|by)\s+(.+)$/i,
    direction: () => "right",
  },
];

function parsePlacementAnchor(
  value: string,
  direction: SceneIntentPlacementDirection,
): Exclude<SceneIntentPlacement, { target: "pointer" }> | null {
  const target = parseShortTarget(value, { keepCase: true });
  if (!target) return null;
  if (target.kind === "selection") return { direction, target: "selection" };
  if (target.kind === "contextual") return { direction, target: "contextual", pronoun: target.pronoun };
  return { direction, target: "visible_label", label: target.label };
}

// ---------------------------------------------------------------------------
// Creation.

function parseCreate(
  sourceWithPlacement: string,
  pointer: boolean,
): Exclude<BoardSceneIntent, { type: "correct" }> | null {
  if (!new RegExp(`^${CREATE}\\b`, "i").test(sourceWithPlacement)) return null;
  const placementMatch = /\s+(left|right|above|below|up|down)\s+(?:of\s+)?(?:the\s+)?(selected|selection)$/i.exec(sourceWithPlacement);
  const namedPlacement = placementMatch ? null : parseNamedPlacement(sourceWithPlacement);
  if (pointer && (placementMatch || namedPlacement)) return null;
  const placement: SceneIntentPlacement | undefined = pointer
    ? { target: "pointer" }
    : placementMatch
      ? { direction: normalizePlacementDirection(placementMatch[1]!), target: "selection" }
      : namedPlacement?.placement;
  const source = (
    placementMatch
      ? sourceWithPlacement.slice(0, placementMatch.index)
      : namedPlacement
        ? sourceWithPlacement.slice(0, namedPlacement.index)
        : sourceWithPlacement
  ).trim();
  const input = normalize(source);
  const namedLabel = extractNamedLabel(source);
  if (!input) return null;
  // "named Auth, Billing" is a list of names, not one.
  if (namedLabel && /[,;]/.test(namedLabel)) return null;
  const withPlacement = placement ? { placement } : {};

  const connectedSource = source.replace(/[,;:]+/g, " ").replace(/\s+/g, " ");
  const connectedCreate = new RegExp(
    `^${CREATE}(?: a| an)? (.+?)(?: (?:named|called) (.+?))?(?: layer)? that is connected to (.+)$`,
    "i",
  ).exec(connectedSource);
  if (connectedCreate) {
    const shapeKind = canonicalShapeKind(connectedCreate[1] ?? "");
    const to = parseShortTarget(connectedCreate[3] ?? "", { keepCase: true });
    if (shapeKind && to && !placement) {
      return {
        type: "create_connected",
        shapeKind: shapeKind as ShapeKind,
        to,
        pathKind: "bent",
        ...shapeLabelFields(
          cleanLabel(connectedCreate[2]),
          defaultCommandShapeLabel(shapeKind, connectedCreate[1]),
        ),
      };
    }
    return null;
  }

  const table = new RegExp(`^${CREATE}(?: a| an)?(?: (\\d+)\\s*(?:by|x|×)\\s*(\\d+))? table(?: (?:named|called) .+)?$`).exec(input);
  if (table) {
    const rows = Number(table[1] ?? 3);
    const columns = Number(table[2] ?? 3);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) {
      return { type: "invalid", reason: "INVALID_TABLE_DIMENSIONS" };
    }
    if (rows * columns > 500) return { type: "invalid", reason: "TABLE_CELL_LIMIT_EXCEEDED" };
    return { type: "create", kind: "table", table: { rows, columns }, ...withPlacement };
  }

  const code = new RegExp(`^${CREATE}(?: a| an)? code block(?: in ([a-z+]+))?$`).exec(input);
  if (code) {
    const language = LANGUAGE_ALIASES[code[1] ?? "typescript"];
    if (!language) return null;
    return { type: "create", kind: "code_block", language, ...withPlacement };
  }

  const mindMap = new RegExp(`^${CREATE}(?: a| an)? mind[ -]?map(?: (?:named|called) (.+))?$`).exec(input);
  if (mindMap) {
    return { type: "create", kind: "mind_map_node", label: namedLabel ?? "Central idea", ...withPlacement };
  }

  const section = new RegExp(`^${CREATE}(?: a| an)? section(?: around (?:these|those|selected|selection|them))?(?: (?:named|called) (.+))?$`).exec(input);
  if (section) {
    return { type: "create", kind: "section", ...(namedLabel ? { label: namedLabel } : {}), ...withPlacement };
  }

  const directKind = new RegExp(`^${CREATE}(?: a| an)? (sticky(?: note)?|text(?: box)?|stamp|face stamp|media|image|gif|video|link(?: preview)?)(?: (?:named|called|saying|that says) (.+))?$`).exec(input);
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
    const said = /\b(?:named|called|saying|that says)\s+(.+)$/i.exec(source)?.[1];
    const label = cleanLabel(said);
    return {
      type: "create",
      kind: kind as Exclude<BoardElementKind, "connector" | "drawing">,
      ...(term === "face stamp" ? { stampKind: "face" as const } : {}),
      ...(label ? { label } : {}),
      ...withPlacement,
    };
  }

  const shapeCreate = new RegExp(`^${CREATE}(?: a| an)? (.+?)(?: (?:named|called) (.+))?$`).exec(input);
  if (!shapeCreate) return null;
  const phrase = shapeCreate[1] ?? "";
  const exact = canonicalShapeKind(phrase);
  const contained = exact ? null : SHAPE_TERMS.find(({ term }) =>
    phrase.endsWith(` ${term}`) && describesShape(phrase.slice(0, -term.length - 1)));
  const shapeKind = (exact ?? contained?.kind) as ShapeKind | null;
  if (!shapeKind) return null;
  const spokenTerm = exact ? phrase : contained!.term;
  const generated = defaultCommandShapeLabel(shapeKind, spokenTerm);
  const descriptive = contained ? descriptiveLabel(source, phrase, contained.term, generated) : null;
  return {
    type: "create",
    kind: "shape",
    shapeKind,
    ...shapeLabelFields(namedLabel ?? descriptive, generated),
    ...withPlacement,
  };
}

/**
 * "add a payments service" is labelled "Payments Service": the person's own
 * words name the shape (in their casing, so "API gateway" stays "API Gateway"),
 * followed by the catalog name for the noun. Describing words that do not
 * name anything ("a big red database") are dropped.
 */
function descriptiveLabel(
  source: string,
  phrase: string,
  term: string,
  generated: string | null,
): string | null {
  const phraseWords = phrase.split(" ");
  const modifierCount = phraseWords.length - term.split(" ").length;
  const sourceWords = normalizeKeepCase(source).split(" ");
  const namedIndex = sourceWords.findIndex((word, index) => index > 0 && /^(?:named|called)$/i.test(word));
  const phraseEnd = namedIndex >= 0 ? namedIndex : sourceWords.length;
  const phraseSourceWords = sourceWords.slice(phraseEnd - phraseWords.length, phraseEnd);
  const modifiers = phraseSourceWords
    .slice(0, modifierCount)
    .filter((word) => !NON_NAMING_MODIFIERS.has(word.toLowerCase()));
  if (modifiers.length === 0) return null;
  const noun = generated ?? phraseSourceWords.slice(modifierCount).join(" ");
  return [...modifiers, noun].map(capitalize).join(" ").slice(0, 240);
}

// ---------------------------------------------------------------------------
// Everything else: rename, connect, delete, style, select, group, layout.

function parseOtherCommand(
  input: string,
  source: string,
  pointer: boolean,
): Exclude<BoardSceneIntent, { type: "correct" }> | null {
  if (pointer) return null;

  const rename = /^(?:rename|relabel) (.+?) (?:to|as) (.+)$/.exec(input);
  if (rename) {
    const sourceRename = /^(?:rename|relabel) (.+?) (?:to|as) (.+)$/i.exec(normalizeKeepCase(source));
    const target = parseShortTarget(rename[1]!);
    const label = cleanLabel(sourceRename?.[2]);
    return target && label ? { type: "rename", target, label } : null;
  }
  // "call it Orders", "name that Billing": only with a pointing word, so
  // "call the API team" is never a rename.
  const callIt = /^(?:call|name|label|title) (it|this|that|this one|that one|selected|the selection) (.+)$/i.exec(normalizeKeepCase(source));
  if (callIt) {
    const target = parseShortTarget(callIt[1]!);
    const label = cleanLabel(callIt[2]?.replace(/^(?:as|to)\s+/i, ""));
    return target && label ? { type: "rename", target, label } : null;
  }

  const connect = /^(?:connect|link|join) (.+?) (?:to|with|and) (.+?)(?: (?:as|label(?:ed)?|labelled|with (?:the |a )?label) (.+?))?(?: with an? (straight|bent|curved) (?:connector|line|arrow))?$/.exec(input);
  if (connect) {
    const sourceConnect = /^(?:connect|link|join) (.+?) (?:to|with|and) (.+?)(?: (?:as|label(?:ed)?|labelled|with (?:the |a )?label) (.+?))?(?: with an? (straight|bent|curved) (?:connector|line|arrow))?$/i.exec(normalizeKeepCase(source));
    const from = parseShortTarget(connect[1]!);
    const to = parseShortTarget(connect[2]!);
    if (!from || !to) return null;
    return {
      type: "connect",
      from,
      to,
      pathKind: (connect[4] as ConnectorPathKind | undefined) ?? "bent",
      ...(connect[3] ? { label: cleanLabel(sourceConnect?.[3]) ?? connect[3] } : {}),
    };
  }

  const remove = /^(?:delete|remove|erase|get rid of) (.+)$/.exec(input);
  if (remove) {
    const target = parseShortTarget(remove[1]!);
    return target ? { type: "delete", target } : null;
  }

  if (/^select (?:everything|all|all objects|all elements)$/.test(input)) {
    return { type: "select_all" };
  }

  const style = new RegExp(`^(?:make|style|color|colour|paint|turn|change) (.+?) (?:to |into )?(?:fill )?(${COLOR_PATTERN})$`).exec(input);
  if (style) {
    const target = parseShortTarget(style[1]!);
    const colorTerm = style[2] ?? "black";
    return target ? { type: "style", target, color: COLOR_ALIASES[colorTerm] ?? colorTerm } : null;
  }

  const group = /^(?:group|create a section around) (selected|selection|these|those|them|it all|everything selected)(?: (?:named|called|as) (.+))?$/.exec(input);
  if (group) {
    const label = cleanLabel(/\b(?:named|called|as)\s+(.+)$/i.exec(source)?.[1]);
    return {
      type: "group",
      target: parseShortTarget(group[1]!) ?? { kind: "selection" },
      ...(label ? { label } : {}),
    };
  }

  const layout = /^(?:layout|lay out|arrange) (selected|selection|these|those|them) (?:from )?(left to right|right to left|top to bottom|bottom to top|grid|in a grid|as a grid|horizontally|vertically)$/.exec(input);
  if (layout) {
    const term = layout[2]!.replace(/^(?:in|as) a /, "");
    const direction: SceneIntentLayoutDirection = term === "horizontally"
      ? "left_to_right"
      : term === "vertically"
        ? "top_to_bottom"
        : term.replaceAll(" ", "_") as SceneIntentLayoutDirection;
    return { type: "layout", target: parseShortTarget(layout[1]!) ?? { kind: "selection" }, direction };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Guards and helpers.

/** Words that, before "that", make it a pointing word rather than a clause. */
const POINTING_THAT_HOSTS = new Set([
  "add", "connect", "link", "join", "delete", "remove", "erase", "rename", "relabel", "move", "put", "place",
  "drag", "shift", "slide", "make", "turn", "change", "convert", "switch", "undo", "redo", "scratch", "revert",
  "take", "bring", "send", "focus", "select", "color", "colour", "style", "paint", "group", "enlarge", "shrink",
  "grow", "call", "name", "label", "title", "of", "to", "into", "onto", "on", "from", "with", "at", "above",
  "below", "under", "underneath", "beneath", "beside", "alongside", "near", "by", "around", "behind", "over",
  "and", "rid",
]);

const CLAUSE_WORDS = /\b(?:and|then|which|who|whom|whose|where|when|while|also|plus|but|between|because|after|before|so that|as well|both|each|every|all of)\b/;
const COUNT_AFTER_VERB = new RegExp(
  `^${CREATE} (?:two|three|four|five|six|seven|eight|nine|ten|a dozen|\\d+(?! ?(?:by|x|×) ?\\d)|some|several|multiple|many|a few|a couple|a pair|a bunch|a set|a series|a row|a column|a list) `,
);
const WHOLE_DIAGRAM =
  /\b(?:flow ?charts?(?! file)|diagrams?|charts?|architecture|sequence|timeline|workflows?|flows?|org ?charts?|mind ?maps? (?:for|of|about|on|with|showing|covering)|map (?:of|for) |pipeline|process (?:for|of) |hierarchy|tree|matrix|swim ?lanes?|journey)\b/;

/**
 * True for sentences the fast rules must not apply: two actions, lists,
 * relative clauses, counts, or a request for a whole diagram. These go to
 * the AI planner, which can plan several steps at once.
 */
function isCompoundOrOpenEnded(sentence: string): boolean {
  const input = normalize(sentence);
  // The legacy "… that is connected to Y" create keeps its own grammar.
  const withoutLegacyClause = input.replace(/ (?:layer )?that is connected to /, " connected-to ");
  if (CLAUSE_WORDS.test(withoutLegacyClause)) return true;
  // Two or more commas in one command is a list ("Auth, Billing, Search").
  if ((sentence.match(/,/g) ?? []).length >= 2) return true;
  const words = withoutLegacyClause.split(" ");
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "that") continue;
    if (index === 0) continue;
    if (!POINTING_THAT_HOSTS.has(words[index - 1]!)) return true;
  }
  if (COUNT_AFTER_VERB.test(input)) return true;
  if (WHOLE_DIAGRAM.test(input)) return true;
  // A second command verb after the first one ("add a database connect it").
  // A label may contain any word, so only the words before it count.
  const beforeLabel = input.split(/ (?:named|called|saying|that says|labell?ed|as) /)[0]!;
  if (/^\S+ .*\b(?:add|create|insert|connect|delete|remove|rename|group|duplicate|copy)\b/.test(beforeLabel)) {
    return true;
  }
  return false;
}

const PRONOUNS: Readonly<Record<string, SceneIntentPronoun>> = {
  it: "it",
  this: "this",
  that: "that",
  them: "them",
  these: "these",
  those: "those",
  "this one": "this",
  "that one": "that",
  "these ones": "these",
  "those ones": "those",
  "this shape": "this",
  "that shape": "that",
  "it all": "them",
};
const SELECTION_PHRASE =
  /^(?:(?:the )?selection|(?:the )?selected(?: (?:one|ones|object|objects|item|items|element|elements|shape|shapes|node|nodes))?|everything selected|what(?:'s| is) selected)$/;
const MAX_TARGET_WORDS = 4;
const NOT_A_TARGET = new Set([
  "a", "an", "and", "or", "but", "then", "to", "with", "from", "into", "onto", "for", "as", "of", "by",
  "here", "there", "we", "you", "i", "us", "our", "my", "your", "is", "are", "was", "be", "been",
  "add", "create", "connect", "delete", "remove", "rename", "move", "make", "put", "turn", "change",
  "side", "bit", "little", "left", "right", "up", "down", "above", "below", "front", "back", "next",
  "everything", "all", "something", "anything", "one", "some", "other", "another",
]);

/**
 * A short reference to one element: a pointing word, "selected", or a name of
 * at most four words. Anything longer, or with a function word in it, is not
 * something a name lookup can match, so the command is handed off.
 */
function parseShortTarget(value: string, options: { keepCase?: boolean } = {}): SceneIntentTarget | null {
  const normalized = normalize(value);
  if (SELECTION_PHRASE.test(normalized)) return { kind: "selection" };
  const pronoun = PRONOUNS[normalized];
  if (pronoun) return { kind: "contextual", pronoun };
  const label = (options.keepCase ? normalizeKeepCase(value) : normalized)
    .replace(/^(?:(?:the|a|an)\s+)+/i, "")
    .replace(/\s+(?:one|shape|box|element|node)$/i, (suffix) =>
      // "the payments one" means Payments; "the API box" keeps "box" out.
      suffix.trim().toLowerCase() === "one" || suffix.trim().toLowerCase() === "element" || suffix.trim().toLowerCase() === "node" ? "" : suffix)
    .trim();
  if (!label) return null;
  const words = label.toLowerCase().split(" ");
  if (words.length > MAX_TARGET_WORDS || words.some((word) => NOT_A_TARGET.has(word) || PRONOUNS[word])) return null;
  return { kind: "visible_label", label: cleanLabel(label) ?? label };
}

function stripWakeWord(value: string): string {
  return value.trim().replace(/^(?:(?:hey|ok|okay)\s+)?(?:airo|airboard)\b[,:.!]?\s*/i, "");
}

// Leading words that do not change what the command asks for. Peeled
// repeatedly so "okay so can you please add a database" reads as "add a database".
const LEADING_FILLER = new RegExp(
  "^(?:" + [
    "(?:uh+|um+|erm|ah|hmm|well|yeah|yep|yes|so|now|then|next|okay|ok|alright|all right|right|and|also|plus|please|just|first|finally|lastly|great|cool|good|nice|perfect|thanks|thank you)\\b[,.;:!]?",
    "(?:can|could|would|will) you(?: please)?\\b[,.;:]?",
    "let'?s\\b",
    "let us\\b",
    "go ahead and\\b",
    "(?:i(?:'d| would)|we(?:'d| would)) like (?:you )?to\\b",
    "(?:i|we) want (?:you )?to\\b",
    "(?:i|we) wanna\\b",
    "(?:i|we) need (?:you )?to\\b",
    "try to\\b",
  ].join("|") + ")\\s*",
  "i",
);
const TRAILING_FILLER = /(?:[,\s]+(?:please|thanks|thank you|thx|cheers|for me|now|airo|airboard))+$/i;

function stripFillers(value: string): string {
  let text = value.trim();
  for (let pass = 0; pass < 10; pass += 1) {
    const next = stripWakeWord(text.replace(LEADING_FILLER, "").trim()).trim();
    if (next === text) break;
    text = next;
  }
  return text.replace(TRAILING_FILLER, "").replace(/[,;:\s]+$/, "").replace(/[.!?]+$/, "").trim();
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

/** `normalize` without lowercasing, so labels keep the speaker's casing. */
function normalizeKeepCase(value: string): string {
  return value
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/[,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

function capitalize(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

function cleanLabel(value: string | undefined): string | null {
  const label = value?.trim().replace(/^['"]|['"]$/g, "").trim();
  return label ? label.slice(0, 240) : null;
}

function extractNamedLabel(value: string): string | null {
  return cleanLabel(/\b(?:named|called)\s+(.+)$/i.exec(value)?.[1]);
}

function stripDisfluencies(value: string): string {
  return value
    .replace(/\b(?:uh+|um+|erm)\b\s*,?/gi, " ")
    .replace(/\s+/g, " ");
}

// Each pattern's greedy prefix makes it match the last placement phrase, so a
// label such as "Look below the fold" survives "… next to API".
const NAMED_PLACEMENT_PATTERNS: readonly {
  pattern: RegExp;
  direction: (term: string) => SceneIntentPlacementDirection;
}[] = [
  {
    pattern: /^(.*)\s+(left|right)(?:\s+side)?\s+of\s+(.+)$/i,
    direction: (term) => (term.toLowerCase() === "left" ? "left" : "right"),
  },
  {
    pattern: /^(.*)\s+(above|below|under|underneath|beneath)\s+(.+)$/i,
    direction: (term) => (term.toLowerCase() === "above" ? "up" : "down"),
  },
  {
    pattern: /^(.*)\s+(next\s+to|beside|alongside)\s+(.+)$/i,
    direction: () => "right",
  },
];

/**
 * Reads "add X to the right of Y", "… below Y" and "… next to Y" so a new
 * element lands beside an existing one instead of on top of whatever sits at
 * the centre of the view. Only creation commands take a placement phrase.
 */
function parseNamedPlacement(
  source: string,
): { placement: SceneIntentPlacement; index: number } | null {
  if (!new RegExp(`^${CREATE}\\b`, "i").test(source)) return null;
  let best: { placement: SceneIntentPlacement; index: number } | null = null;
  for (const { pattern, direction } of NAMED_PLACEMENT_PATTERNS) {
    const match = pattern.exec(source);
    if (!match) continue;
    // "to the right of" and "on the left of": the greedy prefix keeps "to the".
    const index = match[1]!.replace(/\s+(?:to|on)\s+the$/i, "").length;
    const targetText = match[3]?.replace(/^(?:(?:the|a|an)\s+)+/i, "");
    const target = cleanLabel(targetText);
    // A long tail is more likely part of a label than a reference to one element.
    if (!target || target.length > 60 || target.split(/\s+/).length > 6) continue;
    if (best && best.index >= index) continue;
    const anchor = parseShortTarget(target, { keepCase: true });
    best = {
      index,
      placement: anchor?.kind === "selection"
        ? { direction: direction(match[2]!), target: "selection" }
        : anchor?.kind === "contextual"
          ? { direction: direction(match[2]!), target: "contextual", pronoun: anchor.pronoun }
          : { direction: direction(match[2]!), target: "visible_label", label: target },
    };
  }
  return best;
}

function shapeLabelFields(
  named: string | null,
  fallback: string | null,
): { label?: string; generatedLabel?: true } {
  if (named) return { label: named };
  return fallback ? { label: fallback, generatedLabel: true } : {};
}

function normalizePlacementDirection(value: string): SceneIntentPlacementDirection {
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
