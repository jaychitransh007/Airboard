import {
  isSceneNodeElement,
  richTextToPlainText,
  sceneElementNodeType,
  shapeCatalogEntry,
  type AnnotationBounds,
  type BoardSceneElement,
  type BoardState,
} from "@airboard/core";

/**
 * Every object Airo can name on a board, whoever made it (Airo, typed
 * commands, the toolbar, the hand). Airo has to see them all, or it draws a
 * second "API" beside the one already there (RGB-039).
 */
export type SemanticBoardNode = {
  id: string;
  label: string;
  nodeType: string;
  bounds: AnnotationBounds;
};

/** The name a person would use: its text, or for a blank shape its type. */
export function sceneNodeLabel(element: BoardSceneElement): string {
  const text = "content" in element ? richTextToPlainText(element.content).trim() : "";
  if (text) return text.replace(/\s+/g, " ");
  if (element.kind === "shape") return shapeCatalogEntry(element.shapeKind).name;
  return KIND_LABELS[element.kind] ?? element.kind;
}

const KIND_LABELS: Partial<Record<BoardSceneElement["kind"], string>> = {
  sticky: "Sticky note",
  text: "Text",
  mind_map_node: "Mind map",
};

/** Its diagram type: a decision Airo drew is a "decision", a toolbar diamond a "diamond". */
export function sceneNodeType(element: BoardSceneElement): string {
  return sceneElementNodeType(element);
}

/** Hidden elements, and those inside a hidden or collapsed section, aren't on view. */
function sceneElementOnView(state: BoardState, element: BoardSceneElement): boolean {
  if (!element.visible) return false;
  const section = element.sectionId ? state.elements[element.sectionId] : undefined;
  return !(section?.kind === "section" && section.status === "active" && (!section.visible || section.collapsed));
}

/** Nameable elements on view (active nodes, not hidden or in a collapsed section). */
export function nameableNodesOnView(state: BoardState): BoardSceneElement[] {
  return Object.values(state.elements).filter((element) =>
    isSceneNodeElement(element) && sceneElementOnView(state, element));
}

/** Every nameable node, in reading order (top to bottom, then left to right). */
export function semanticBoardNodes(state: BoardState): SemanticBoardNode[] {
  return nameableNodesOnView(state).map((element): SemanticBoardNode => ({
    id: element.id,
    label: sceneNodeLabel(element),
    nodeType: sceneNodeType(element),
    bounds: { x: element.transform.x, y: element.transform.y, width: element.transform.width, height: element.transform.height },
  })).sort((left, right) => {
    const leftY = left.bounds.y + left.bounds.height / 2;
    const rightY = right.bounds.y + right.bounds.height / 2;
    const leftX = left.bounds.x + left.bounds.width / 2;
    const rightX = right.bounds.x + right.bounds.width / 2;
    return leftY - rightY || leftX - rightX || left.id.localeCompare(right.id);
  });
}

/** An object's box. */
export function semanticObjectBounds(state: BoardState, id: string): AnnotationBounds | null {
  const element = state.elements[id];
  if (!element || element.status !== "active") return null;
  return { x: element.transform.x, y: element.transform.y, width: element.transform.width, height: element.transform.height };
}

/** The topmost node under a point, for "the one I'm pointing at". */
export function sceneNodeAtPoint(state: BoardState, point: { x: number; y: number }): BoardSceneElement | null {
  return nameableNodesOnView(state)
    .filter(({ transform }) =>
      point.x >= transform.x && point.x <= transform.x + transform.width &&
      point.y >= transform.y && point.y <= transform.y + transform.height)
    .sort((left, right) => right.zIndex - left.zIndex)[0] ?? null;
}
