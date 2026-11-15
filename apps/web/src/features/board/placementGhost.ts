import type { AnnotationPoint, BoardSceneElement, BoardState } from "@airboard/core";
import type { CreationToolId } from "./creationToolCatalog.ts";
import { resolveHandConnectorEnds } from "./gestureObjectManipulation.ts";
import { createSceneElementForTool, type SceneCreationOptions } from "./sceneCreation.ts";

/**
 * The object dock's tool ids. The dock places v2 objects through the
 * toolbar's creation tools; these ids name what is armed and drive the
 * dock's glyphs and labels.
 */
export type ObjectDockTool =
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

export function isPlacementTool(tool: ObjectDockTool): boolean {
  return tool !== "select" && tool !== "eraser";
}

/**
 * The see-through preview of a placement in progress: the very element the
 * placement will commit, built by the same call (createSceneElementForTool at
 * the release point, and for a connector the same hand-resolved ends), so the
 * preview always shows the shape that lands. It is never added to the board.
 *
 * - `drag`: the hand or pointer pressed at `start` and is now at `end`.
 * - `drop`: an object carried from the dock, released at `end`.
 */
export function placementGhostElement(input: {
  tool: CreationToolId;
  start: AnnotationPoint;
  end?: AnnotationPoint;
  state: BoardState;
  boardId: string;
  mode: "drag" | "drop";
  /** Options the commit passes too (stamp emoji, table size, creator). */
  creation?: Omit<SceneCreationOptions, "boardId" | "point" | "connector">;
}): BoardSceneElement | null {
  const point = input.end ?? input.start;
  const connector = input.tool.startsWith("connector:")
    ? resolveHandConnectorEnds(input.state, {
        mode: input.mode,
        from: input.mode === "drag" ? input.start : point,
        to: point,
      })
    : undefined;
  return createSceneElementForTool(input.tool, {
    ...input.creation,
    boardId: input.boardId,
    point,
    ...(connector ? { connector } : {}),
  });
}
