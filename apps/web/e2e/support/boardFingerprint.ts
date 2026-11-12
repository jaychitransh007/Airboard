import type { BoardSceneElement, BoardState, RichTextDocument, Stroke } from "@airboard/core";

/**
 * A model-independent picture of a diagram: what a person sees, not how it is
 * stored. Legacy annotation strokes and v2 scene elements that look the same
 * give the same fingerprint, and ids, revisions, timestamps and exact
 * coordinates are left out. The board-file split and the shape-model merge
 * must keep a journey's fingerprint identical.
 */
export type BoardFingerprint = {
  /** Shapes, stickies and text, sorted by label then kind. */
  nodes: Array<{ label: string; kind: string; fill: string | null; group: string | null }>;
  /** Attached connectors, by endpoint label, sorted. */
  edges: Array<{ from: string; to: string; label: string }>;
  /** Connectors with a loose end (not attached to two shapes). */
  looseConnectors: number;
  /** Groups and sections with their members' labels. */
  groups: Array<{ label: string; members: string[] }>;
  /** Node labels left to right, then top to bottom, by centre in 40-unit bands. */
  layout: { leftToRight: string[]; topToBottom: string[] };
};

type Box = { x: number; y: number; width: number; height: number };
type NodeRecord = {
  id: string;
  label: string;
  kind: string;
  fill: string | null;
  box: Box | null;
  group: string | null;
};

const LAYOUT_BAND = 40;

/** Plain text of a rich-text document (blocks joined by newlines). */
export function plainText(document: RichTextDocument | undefined | null): string {
  return (
    document?.blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n").trim() ?? ""
  );
}

function colour(value: unknown): string | null {
  return typeof value === "string" && value ? value.toLowerCase() : null;
}

function isLegacyConnector(stroke: Stroke): boolean {
  return stroke.annotation?.type === "connector" || stroke.annotation?.type === "arrow";
}

/** True for a legacy rectangle that only frames a group. */
function isLegacyGroupFrame(stroke: Stroke): boolean {
  return Boolean(stroke.annotation?.groupMemberStrokeIds?.length);
}

function sceneNodeText(element: BoardSceneElement): string | null {
  switch (element.kind) {
    case "shape":
    case "sticky":
    case "text":
    case "mind_map_node":
    case "code_block":
      return plainText((element as { content?: RichTextDocument }).content);
    default:
      return null;
  }
}

function sceneNodeKind(element: BoardSceneElement): string {
  return element.kind === "shape" ? element.shapeKind : element.kind === "text" ? "text" : element.kind;
}

function sceneNodeFill(element: BoardSceneElement): string | null {
  if (element.kind === "shape") return colour(element.style.fill);
  if (element.kind === "sticky") return colour(element.color);
  return null;
}

function legacyNodeKind(stroke: Stroke): string {
  const annotation = stroke.annotation!;
  if (annotation.type === "sticky_note") return "sticky";
  if (annotation.type === "text_label") return "text";
  return annotation.shapeKind ?? annotation.nodeType ?? annotation.type;
}

export function boardFingerprint(state: BoardState): BoardFingerprint {
  const nodes: NodeRecord[] = [];
  const edges: BoardFingerprint["edges"] = [];
  const groups: Array<{ label: string; memberIds: string[] }> = [];
  let looseConnectors = 0;

  const strokes = Object.values(state.strokes).filter(
    (stroke) => stroke.status === "committed" && stroke.annotation,
  );
  const legacyConnectors: Stroke[] = [];
  for (const stroke of strokes) {
    const annotation = stroke.annotation!;
    if (isLegacyConnector(stroke)) {
      legacyConnectors.push(stroke);
    } else if (isLegacyGroupFrame(stroke)) {
      groups.push({ label: annotation.label ?? "", memberIds: [...annotation.groupMemberStrokeIds!] });
    } else if (annotation.type !== "freehand" && annotation.type !== "pointer" && annotation.type !== "highlight") {
      nodes.push({
        id: stroke.id,
        label: annotation.label ?? "",
        kind: legacyNodeKind(stroke),
        fill: colour(annotation.fillColor),
        box: annotation.bounds ?? null,
        group: null,
      });
    }
  }

  // Legacy strokes have a mirror element (legacyStrokeId); only the stroke counts.
  const elements = Object.values(state.elements).filter(
    (element) => element.status === "active" && !element.legacyStrokeId,
  );
  const sceneConnectors: Extract<BoardSceneElement, { kind: "connector" }>[] = [];
  for (const element of elements) {
    if (element.kind === "connector") {
      sceneConnectors.push(element);
    } else if (element.kind === "section") {
      groups.push({ label: plainText(element.title), memberIds: [...element.memberIds] });
    } else {
      const text = sceneNodeText(element);
      if (text === null) continue;
      const { x, y, width, height } = element.transform;
      nodes.push({
        id: element.id,
        label: text,
        kind: sceneNodeKind(element),
        fill: sceneNodeFill(element),
        box: { x, y, width, height },
        group: null,
      });
    }
  }

  const labelOf = new Map(nodes.map((node) => [node.id, node.label]));
  for (const stroke of legacyConnectors) {
    const from = labelOf.get(stroke.annotation?.snappedStartStrokeId ?? "");
    const to = labelOf.get(stroke.annotation?.snappedEndStrokeId ?? "");
    if (from === undefined || to === undefined) looseConnectors += 1;
    else edges.push({ from, to, label: stroke.annotation?.label ?? "" });
  }
  for (const connector of sceneConnectors) {
    const from = labelOf.get(connector.start.binding?.elementId ?? "");
    const to = labelOf.get(connector.end.binding?.elementId ?? "");
    if (from === undefined || to === undefined) looseConnectors += 1;
    else edges.push({ from, to, label: plainText(connector.label) });
  }

  const groupRecords = groups.map((group) => {
    const members = group.memberIds
      .map((id) => labelOf.get(id))
      .filter((label): label is string => label !== undefined)
      .sort();
    for (const id of group.memberIds) {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) node.group = group.label;
    }
    return { label: group.label, members };
  });

  const placed = nodes.filter((node) => node.box);
  const centre = (node: NodeRecord, axis: "x" | "y") =>
    Math.round(
      (axis === "x" ? node.box!.x + node.box!.width / 2 : node.box!.y + node.box!.height / 2) / LAYOUT_BAND,
    );
  const order = (axis: "x" | "y") =>
    [...placed]
      .sort((left, right) => centre(left, axis) - centre(right, axis) || left.label.localeCompare(right.label))
      .map((node) => node.label);

  return {
    nodes: nodes
      .map(({ label, kind, fill, group }) => ({ label, kind, fill, group }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind)),
    edges: edges.sort(
      (left, right) =>
        left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.label.localeCompare(right.label),
    ),
    looseConnectors,
    groups: groupRecords.sort((left, right) => left.label.localeCompare(right.label)),
    layout: { leftToRight: order("x"), topToBottom: order("y") },
  };
}
