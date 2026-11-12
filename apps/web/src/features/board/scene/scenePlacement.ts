/**
 * Which creation tools place a v2 scene element, and the legacy preview each
 * shows while placing. Moved verbatim out of AirboardPrototype.tsx (board
 * split, phase 1).
 */
import { legacyToolForCreationTool, type CreationToolId } from "../creationToolCatalog.ts";
import { isPlacementTool, type ObjectDockTool } from "../gestureAnnotationMode.ts";

export function isScenePlacementTool(tool: CreationToolId): boolean {
  return (
    tool === "sticky" ||
    tool.startsWith("shape:") ||
    tool.startsWith("connector:") ||
    tool === "text" ||
    tool === "section" ||
    tool === "table" ||
    tool === "stamp" ||
    tool === "insert:face-stamp" ||
    tool === "insert:code-block" ||
    tool === "insert:mind-map"
  );
}

export function scenePlacementPreviewTool(tool: CreationToolId): ObjectDockTool {
  const legacyTool = legacyToolForCreationTool(tool) as ObjectDockTool | null;
  if (legacyTool && isPlacementTool(legacyTool)) return legacyTool;
  if (tool === "connector:straight") return "arrow";
  if (tool.startsWith("connector:")) return "connector";
  if (tool === "stamp" || tool === "insert:face-stamp") return "circle";
  return "box";
}
