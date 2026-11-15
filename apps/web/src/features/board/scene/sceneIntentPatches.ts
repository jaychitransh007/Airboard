/**
 * Patch builders for scene edits: move (with bound connectors and section
 * membership), rename and colour. Moved verbatim out of AirboardPrototype.tsx
 * (board split, phase 1).
 */
import {
  createRichTextDocument,
  type BoardElementPatchOperation,
  type BoardSceneElement,
  type BoardState,
} from "@airboard/core";
import {
  rebindSceneConnector,
  sceneElementFitsInside,
  sceneSectionMembers,
  translateSceneElement,
} from "./sceneGeometry.ts";

export function buildUniformSceneMoveChanges(
  state: BoardState,
  roots: readonly BoardSceneElement[],
  dx: number,
  dy: number,
): { elementId: string; patches: BoardElementPatchOperation[] }[] {
  const moving = new Map<string, BoardSceneElement>();
  const enqueue = (element: BoardSceneElement) => {
    if (element.status === "active" && !moving.has(element.id)) moving.set(element.id, element);
  };
  roots.forEach(enqueue);
  for (const root of roots) {
    if (root.kind === "section") sceneSectionMembers(state, root).forEach(enqueue);
  }
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const candidate of Object.values(state.elements)) {
      if (candidate.status !== "active" || moving.has(candidate.id) || !candidate.attachment) continue;
      const follows = candidate.attachment.kind === "element"
        ? moving.has(candidate.attachment.elementId)
        : moving.has(candidate.attachment.tableId);
      if (follows) {
        enqueue(candidate);
        discovered = true;
      }
    }
  }
  const previewElements = { ...state.elements };
  for (const element of moving.values()) {
    previewElements[element.id] = translateSceneElement(element, dx, dy);
  }
  const boundConnectors = Object.values(state.elements).filter(
    (candidate): candidate is Extract<BoardSceneElement, { kind: "connector" }> =>
      candidate.kind === "connector" &&
      candidate.status === "active" &&
      !moving.has(candidate.id) &&
      Boolean(
        (candidate.start.binding && moving.has(candidate.start.binding.elementId)) ||
        (candidate.end.binding && moving.has(candidate.end.binding.elementId)),
      ),
  );
  for (const connector of boundConnectors) {
    previewElements[connector.id] = rebindSceneConnector(connector, previewElements);
  }
  const changes = [...moving.values()].map((element) => ({
    elementId: element.id,
    patches: sceneElementMovePatches(element, dx, dy),
  }));
  for (const connector of boundConnectors) {
    const rebound = previewElements[connector.id];
    if (rebound?.kind === "connector") {
      changes.push({ elementId: connector.id, patches: connectorGeometryPatches(rebound) });
    }
  }
  for (const root of roots) {
    if (root.kind === "section") continue;
    const moved = previewElements[root.id];
    if (moved) appendSectionContainmentChanges(state, root, moved, changes);
  }
  return changes;
}

export function connectorGeometryPatches(
  connector: Extract<BoardSceneElement, { kind: "connector" }>,
): BoardElementPatchOperation[] {
  return [
    { op: "field.set", path: ["transform"], value: connector.transform },
    { op: "field.set", path: ["start", "point"], value: connector.start.point },
    { op: "field.set", path: ["end", "point"], value: connector.end.point },
    { op: "field.set", path: ["controlPoints"], value: connector.controlPoints },
  ];
}

export function appendSectionContainmentChanges(
  state: BoardState,
  original: BoardSceneElement,
  moved: BoardSceneElement,
  changes: { elementId: string; patches: BoardElementPatchOperation[] }[],
): void {
  const nextSection = Object.values(state.elements)
    .filter(
      (candidate): candidate is Extract<BoardSceneElement, { kind: "section" }> =>
        candidate.kind === "section" &&
        candidate.status === "active" &&
        candidate.visible &&
        candidate.id !== moved.id &&
        sceneElementFitsInside(moved, candidate),
    )
    .sort((a, b) => b.zIndex - a.zIndex)[0];
  const previousSection = original.sectionId
    ? state.elements[original.sectionId]
    : null;
  const previousSectionId = previousSection?.kind === "section" ? previousSection.id : undefined;
  if (previousSectionId === nextSection?.id) return;

  const movedChange = changes.find(({ elementId }) => elementId === moved.id);
  const membershipPatch: BoardElementPatchOperation = nextSection
    ? { op: "field.set", path: ["sectionId"], value: nextSection.id }
    : { op: "field.unset", path: ["sectionId"] };
  if (movedChange) movedChange.patches.push(membershipPatch);
  else changes.push({ elementId: moved.id, patches: [membershipPatch] });

  if (previousSection?.kind === "section") {
    changes.push({
      elementId: previousSection.id,
      patches: [{
        op: "field.set",
        path: ["memberIds"],
        value: previousSection.memberIds.filter((id) => id !== moved.id),
      }],
    });
  }
  if (nextSection) {
    changes.push({
      elementId: nextSection.id,
      patches: [{
        op: "field.set",
        path: ["memberIds"],
        value: [...new Set([...nextSection.memberIds, moved.id])],
      }],
    });
  }
}

export function sceneElementRenamePatches(
  element: BoardSceneElement,
  label: string,
): BoardElementPatchOperation[] {
  switch (element.kind) {
    case "sticky":
    case "shape":
    case "text":
    case "mind_map_node":
      return [{ op: "field.set", path: ["content"], value: createRichTextDocument(label) }];
    case "connector":
      return [{ op: "field.set", path: ["label"], value: createRichTextDocument(label) }];
    case "section":
      return [{ op: "field.set", path: ["title"], value: createRichTextDocument(label) }];
    case "table": {
      const cell = Object.values(element.cells)[0];
      return cell
        ? [{ op: "table.cell.patched", cellId: cell.id, patch: { content: createRichTextDocument(label) } }]
        : [];
    }
    case "stamp":
      return [{ op: "field.set", path: ["label"], value: label }];
    case "media":
      return [{ op: "field.set", path: ["altText"], value: label }];
    case "link_preview":
      return [{ op: "field.set", path: ["title"], value: label }];
    case "code_block":
      return [{ op: "field.set", path: ["code"], value: label }];
    case "drawing":
      return [{ op: "field.set", path: ["metadata", "label"], value: label }];
  }
}

export function sceneElementMovePatches(
  element: BoardSceneElement,
  dx: number,
  dy: number,
): BoardElementPatchOperation[] {
  const moved = translateSceneElement(element, dx, dy);
  const patches: BoardElementPatchOperation[] = [
    { op: "field.set", path: ["transform", "x"], value: moved.transform.x },
    { op: "field.set", path: ["transform", "y"], value: moved.transform.y },
  ];
  if (moved.kind === "connector") {
    patches.push(
      { op: "field.set", path: ["start", "point"], value: moved.start.point },
      { op: "field.set", path: ["end", "point"], value: moved.end.point },
      { op: "field.set", path: ["controlPoints"], value: moved.controlPoints },
    );
  }
  if (moved.kind === "drawing") {
    patches.push({ op: "field.set", path: ["points"], value: moved.points });
  }
  return patches;
}

export function sceneElementColorPatches(
  element: BoardSceneElement,
  color: string,
): BoardElementPatchOperation[] {
  switch (element.kind) {
    case "drawing":
    case "connector":
      return [{ op: "field.set", path: ["style", "color"], value: color }];
    case "sticky":
      return [{ op: "field.set", path: ["color"], value: color }];
    case "shape":
    case "section":
      return [{ op: "field.set", path: ["style", "fill"], value: color }];
    case "text":
      return [{ op: "field.set", path: ["style", "color"], value: color }];
    case "mind_map_node":
      return [{ op: "field.set", path: ["style", "fill"], value: color }];
    case "table":
      return Object.values(element.cells).map((cell) => ({
        op: "table.cell.patched" as const,
        cellId: cell.id,
        patch: { style: { ...cell.style, fill: color } },
      }));
    default:
      return [{ op: "field.set", path: ["metadata", "accentColor"], value: color }];
  }
}
