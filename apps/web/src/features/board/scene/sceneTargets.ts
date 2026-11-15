/**
 * How a typed or spoken scene command finds its targets: by name, by
 * selection, by pronoun and pointing. Moved verbatim out of
 * AirboardPrototype.tsx (board split, phase 1).
 */
import {
  richTextToPlainText,
  shapeCatalogEntry,
  type BoardSceneElement,
  type BoardState,
  type SceneIntentPronoun,
  type SceneIntentTarget,
} from "@airboard/core";
import type { VoiceReference } from "../engine/boardTypes.ts";
import { sceneElementKindLabel } from "../ui/boardLabels.ts";

export function resolveSceneIntentTargetIds(
  state: BoardState,
  target: SceneIntentTarget,
  selectionIds: readonly string[],
  reference: VoiceReference | null = null,
): string[] {
  if (target.kind === "selection") {
    return selectionIds.filter((id) => state.elements[id]?.status === "active");
  }
  if (target.kind === "contextual") {
    return resolveContextualSceneTarget(state, target.pronoun, selectionIds, reference);
  }
  const requested = normalizeSceneReference(target.label);
  const matches = Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      sceneElementVisibleForIntent(state, element) &&
      sceneElementReferenceLabels(element).some(
        (label) => normalizeSceneReference(label) === requested,
      ),
    )
    .sort((a, b) => b.zIndex - a.zIndex);
  // Shape-type names match every shape of that type; a shape whose own label
  // is the requested name ("User" beside "User 2") is the one meant.
  const labelled = matches.length > 1
    ? matches.filter((element) => normalizeSceneReference(sceneElementPlainLabel(element)) === requested)
    : [];
  return (labelled.length > 0 ? labelled : matches).map(({ id }) => id);
}

/**
 * "it", "this", "that", "them": what the hand pointed at while speaking, else
 * the selection, else the shape made or changed most recently. Best guess,
 * never a question; undo is the safety net.
 */
export function resolveContextualSceneTarget(
  state: BoardState,
  pronoun: SceneIntentPronoun,
  selectionIds: readonly string[],
  reference: VoiceReference | null,
): string[] {
  const active = (id: string) => state.elements[id]?.status === "active";
  const pointed = (reference?.pointedIds ?? []).filter(active);
  const selected = selectionIds.filter(active);
  const plural = pronoun === "them" || pronoun === "these" || pronoun === "those";
  if (plural) {
    if (pointed.length > 1) return pointed;
    return selected;
  }
  if (pointed.length > 0) {
    // "that" is the latest thing pointed at; "this" and "it" what was under
    // the hand as speech began, else the latest.
    const start = reference?.startTargetId && active(reference.startTargetId) ? reference.startTargetId : null;
    return [pronoun === "that" ? pointed[pointed.length - 1]! : start ?? pointed[pointed.length - 1]!];
  }
  if (selected.length > 0) return [selected[selected.length - 1]!];
  const recent = Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      element.visible &&
      element.kind !== "connector" &&
      element.kind !== "section",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return recent ? [recent.id] : [];
}

export function sceneElementVisibleForIntent(
  state: BoardState,
  element: BoardSceneElement,
): boolean {
  if (!element.visible) return false;
  const parent = element.sectionId ? state.elements[element.sectionId] : null;
  return !(
    parent?.kind === "section" &&
    parent.status === "active" &&
    (!parent.visible || parent.collapsed)
  );
}

export function sceneElementReferenceLabels(element: BoardSceneElement): string[] {
  const plain = sceneElementPlainLabel(element).trim();
  if (element.kind === "shape") {
    const catalog = shapeCatalogEntry(element.shapeKind);
    return [plain, catalog.name, catalog.kind, ...catalog.aliases].filter(Boolean);
  }
  return [plain || sceneElementKindLabel(element.kind)];
}

export function sceneElementLockedForMutation(
  state: BoardState,
  element: BoardSceneElement,
): boolean {
  if (element.locked) return true;
  if (element.kind === "section" && element.lockMode !== "none") return true;
  const parent = element.sectionId ? state.elements[element.sectionId] : null;
  return Boolean(
    parent?.kind === "section" &&
    parent.status === "active" &&
    parent.lockMode === "all",
  );
}

export function sceneElementReferenceLabel(element: BoardSceneElement): string {
  return sceneElementReferenceLabels(element)[0] || sceneElementKindLabel(element.kind);
}

export function normalizeSceneReference(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(?:(?:the|a|an|another)\s+)+/, "")
    .replace(/\b(?:dataset|datasets)\b/g, "data")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSceneFanInContext(state: BoardState, selectionIds: readonly string[]) {
  const selectedSet = new Set(selectionIds);
  const elements = Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      sceneElementVisibleForIntent(state, element) &&
      element.kind !== "connector" &&
      element.kind !== "drawing",
    )
    .sort((left, right) => left.zIndex - right.zIndex);
  const ordinals = new Map<string, number>();
  const objects = elements.map((element) => {
    const nodeType = element.kind === "shape" ? element.shapeKind : element.kind;
    const ordinal = (ordinals.get(nodeType) ?? 0) + 1;
    ordinals.set(nodeType, ordinal);
    return {
      label: sceneElementReferenceLabel(element),
      nodeType,
      ordinal,
    };
  });
  const labelsById = new Map(elements.map((element) => [element.id, sceneElementReferenceLabel(element)]));
  const edges = Object.values(state.elements).flatMap((element) => {
    if (
      element.kind !== "connector" ||
      element.status !== "active" ||
      !sceneElementVisibleForIntent(state, element) ||
      !element.start.binding ||
      !element.end.binding
    ) return [];
    const from = labelsById.get(element.start.binding.elementId);
    const to = labelsById.get(element.end.binding.elementId);
    if (!from || !to) return [];
    const label = richTextToPlainText(element.label).trim();
    return [{ from: { label: from }, to: { label: to }, ...(label ? { label } : {}) }];
  });
  const selected = elements
    .filter((element) => selectedSet.has(element.id))
    .map((element) => {
      const object = objects[elements.indexOf(element)];
      return object!;
    });
  return {
    selectionCount: selected.length,
    selected,
    objects,
    edges,
  };
}

/** Numbers a generated name ("User 2") already on the board so each element stays addressable by name. */
export function uniqueGeneratedSceneLabel(state: BoardState, label: string): string {
  const taken = new Set(
    Object.values(state.elements)
      .filter((element) => element.status === "active")
      .map((element) => normalizeSceneReference(sceneElementPlainLabel(element))),
  );
  if (!taken.has(normalizeSceneReference(label))) return label;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${label} ${suffix}`;
    if (!taken.has(normalizeSceneReference(candidate))) return candidate;
  }
}

export function sceneElementPlainLabel(element: BoardSceneElement): string {
  switch (element.kind) {
    case "sticky":
    case "shape":
    case "text":
    case "mind_map_node":
      return richTextToPlainText(element.content);
    case "connector":
      return richTextToPlainText(element.label);
    case "section":
      return richTextToPlainText(element.title);
    case "table":
      return Object.values(element.cells).map((cell) => richTextToPlainText(cell.content)).find(Boolean) ?? "Table";
    case "stamp":
      return element.label ?? element.emoji;
    case "media":
      return element.altText || element.asset.fileName || "Media";
    case "link_preview":
      return element.title ?? element.url;
    case "code_block":
      return element.code.split("\n", 1)[0] ?? "Code block";
    case "drawing":
      return element.drawingKind;
  }
}
