import { isCompoundBoardCommand, parseBoardSceneIntent, type BoardState } from "@airboard/core";
import { parseDesiredGraphCorrection } from "./desiredGraphCorrection";
import { resolveExistingBoardFanIn } from "./existingBoardFanIn";
import { parseIntentCanvasCommand, type IntentCanvasParseResult } from "./intentCanvasParser";
import { buildSemanticIntentContext } from "./intentPipeline";
import { buildSceneFanInContext } from "./scene/sceneTargets";
import { shouldUseSemanticIntentFallback, type SemanticIntentParserIssue } from "./semanticIntent";

/** "hide the canvas" / "show the diagram": the board's visibility switch. */
export function parseDiagramVisibilityIntent(text: string): "hide" | "show" | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:please )?hide (?:the )?(?:canvas|diagram)$/.test(normalized) ||
    /^(?:please )?turn (?:the )?(?:canvas|diagram) off$/.test(normalized)
  ) {
    return "hide";
  }
  if (
    /^(?:please )?(?:show|restore) (?:the )?(?:canvas|diagram)$/.test(normalized) ||
    /^(?:please )?bring (?:the )?(?:canvas|diagram) back$/.test(normalized) ||
    /^(?:please )?turn (?:the )?(?:canvas|diagram) on$/.test(normalized)
  ) {
    return "show";
  }
  return null;
}

/**
 * Speech recognizers commonly render “add a database, uh, later that is
 * connected to service” as one sentence. Convert that safe, explicit pattern
 * into the same atomic create+connect plan the semantic planner would produce,
 * so it never falls back to a manual Send click when the semantic provider is
 * unavailable.
 */
export function expandSpokenCreateAndConnect(text: string): [string, string] | null {
  const match =
    /^(?:add|create|insert|place|make)\s+(?:(?:a|an|the)\s+)?(process|service|database|queue|user|api|decision|note|component|circle|rectangle|document)\b[\s,]*(?:(?:uh|um|er|erm|like|then|later|layer)[\s,]*)*(?:that\s+)?(?:is\s+)?connected\s+to\s+(?:the\s+)?(.+?)\s*[.!?]?$/i.exec(
      text.trim(),
    );
  const nodeType = match?.[1]?.trim();
  const target = match?.[2]?.trim().replace(/[.!?]+$/, "");
  if (!nodeType || !target) {
    return null;
  }
  return [`add a ${nodeType} here`, `connect this to ${target}`];
}

/**
 * The parser issue a command goes to the AI planner with, once every fast
 * rule has passed on it: a compound sentence, a parsed command the board
 * could not ground, or the older grammar's own issue. Null when the older
 * grammar's issue is not one the planner takes. The preparer and the
 * speculation predictor both derive the issue here.
 */
export function semanticParserIssue(
  compound: boolean,
  deterministic: IntentCanvasParseResult,
): SemanticIntentParserIssue | null {
  if (compound) return "compound_command";
  if (deterministic.status === "parsed") return "grounding_failed";
  if (!shouldUseSemanticIntentFallback(deterministic)) return null;
  return deterministic.issue.code as SemanticIntentParserIssue;
}

/**
 * The parser issue prepareIntentCommandWithSemantic would send for this
 * command, or null when a fast rule would (or might) handle it. Pure: it
 * mirrors the preparer's stages without running any of them, so a held voice
 * command can be planned speculatively while it waits for a continuation.
 */
export function predictSemanticPlannerIssue(
  instruction: string,
  board: BoardState,
  selectionIds: readonly string[],
): SemanticIntentParserIssue | null {
  if (parseDiagramVisibilityIntent(instruction)) return null;
  if (
    resolveExistingBoardFanIn(instruction, buildSceneFanInContext(board, selectionIds)).status !==
    "unrecognized"
  ) {
    return null;
  }
  // A scene intent's outcome depends on the board; leave it to the run.
  if (parseBoardSceneIntent(instruction) !== null) return null;
  if (parseDesiredGraphCorrection(instruction)) return null;
  const fanIn = resolveExistingBoardFanIn(
    instruction,
    buildSemanticIntentContext(board, [], false),
  ).status;
  if (fanIn === "already_satisfied" || fanIn === "resolved") return null;
  const olderParse = parseIntentCanvasCommand(instruction, {
    activationPolicy: "externally_activated",
  });
  if (
    isCompoundBoardCommand(instruction) &&
    olderParse.status === "parsed" &&
    olderParse.command.kind === "create_node"
  ) {
    return semanticParserIssue(true, olderParse);
  }
  // A parsed command applies locally, or fails grounding on the board as
  // it will be then: not predictable here.
  if (olderParse.status === "parsed") return null;
  const linkedCreate = expandSpokenCreateAndConnect(instruction);
  if (
    linkedCreate &&
    linkedCreate.every(
      (step) =>
        parseIntentCanvasCommand(step, { activationPolicy: "externally_activated" }).status ===
        "parsed",
    )
  ) {
    return null;
  }
  return semanticParserIssue(false, olderParse);
}
