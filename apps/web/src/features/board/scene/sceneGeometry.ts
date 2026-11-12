/**
 * Pure scene geometry of the board component: bounds, hit tests, moving and
 * rebinding elements, open spots and layout. Moved verbatim out of
 * AirboardPrototype.tsx (board split, phase 1).
 */
import type {
  AnnotationPoint,
  BoardSceneElement,
  BoardSceneIntent,
  BoardState,
  SceneIntentPlacementDirection,
  StrokePoint,
} from "@airboard/core";
import { screenPointFromBoard, type BoardViewport } from "../boardViewport.ts";
import type { SceneMoveSnapshot } from "../engine/boardTypes.ts";
import { sceneElementVisibleForIntent } from "./sceneTargets.ts";

export function strokePointBounds(
  points: readonly Pick<StrokePoint, "x" | "y">[],
  padding = 0,
): { x: number; y: number; width: number; height: number } {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

export function drawingElementIntersectsCircle(
  element: Extract<BoardSceneElement, { kind: "drawing" }>,
  center: AnnotationPoint,
  radius: number,
): boolean {
  const hitRadius = radius + element.style.thickness / 2;
  if (element.points.length === 1) {
    const point = element.points[0]!;
    return Math.hypot(point.x - center.x, point.y - center.y) <= hitRadius;
  }
  for (let index = 1; index < element.points.length; index += 1) {
    const start = element.points[index - 1];
    const end = element.points[index];
    if (start && end && pointToSegmentDistance(center, start, end) <= hitRadius) return true;
  }
  return false;
}

export function pointToSegmentDistance(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
}

export function translateSceneElement(
  source: BoardSceneElement,
  dx: number,
  dy: number,
): BoardSceneElement {
  const element = structuredClone(source);
  element.transform.x += dx;
  element.transform.y += dy;
  if (element.kind === "connector") {
    element.start.point.x += dx;
    element.start.point.y += dy;
    element.end.point.x += dx;
    element.end.point.y += dy;
    element.controlPoints = element.controlPoints.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
  if (element.kind === "drawing") {
    element.points = element.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
  return element;
}

export function sceneSectionMembers(
  state: BoardState,
  section: Extract<BoardSceneElement, { kind: "section" }>,
): BoardSceneElement[] {
  const memberIds = new Set<string>();
  const pendingSections = [section.id];
  const visitedSections = new Set<string>();
  while (pendingSections.length > 0) {
    const sectionId = pendingSections.shift()!;
    if (visitedSections.has(sectionId)) continue;
    visitedSections.add(sectionId);
    const current = state.elements[sectionId];
    if (current?.kind === "section") {
      for (const memberId of current.memberIds) memberIds.add(memberId);
    }
    for (const element of Object.values(state.elements)) {
      if (element.sectionId === sectionId) memberIds.add(element.id);
    }
    for (const memberId of memberIds) {
      if (state.elements[memberId]?.kind === "section" && !visitedSections.has(memberId)) {
        pendingSections.push(memberId);
      }
    }
  }
  memberIds.delete(section.id);
  return [...memberIds].flatMap((id) => {
    const element = state.elements[id];
    return element?.status === "active" ? [element] : [];
  });
}

export function buildSceneMovePreview(
  movement: SceneMoveSnapshot,
  dx: number,
  dy: number,
  baseElements: Readonly<Record<string, BoardSceneElement>>,
): Record<string, BoardSceneElement> {
  const elements = { ...baseElements };
  for (const original of [movement.element, ...movement.relatedElements, ...movement.boundConnectors]) {
    elements[original.id] = structuredClone(original);
  }
  for (const original of [movement.element, ...movement.relatedElements]) {
    elements[original.id] = translateSceneElement(original, dx, dy);
  }
  for (const connector of movement.boundConnectors) {
    elements[connector.id] = rebindSceneConnector(connector, elements);
  }
  return elements;
}

export function rebindSceneConnector(
  source: Extract<BoardSceneElement, { kind: "connector" }>,
  elements: Readonly<Record<string, BoardSceneElement>>,
): Extract<BoardSceneElement, { kind: "connector" }> {
  const connector = structuredClone(source);
  if (connector.start.binding) {
    const target = elements[connector.start.binding.elementId];
    if (target?.status === "active") {
      const previous = connector.start.point;
      const next = connectorAnchorPoint(target, connector.start.binding.anchor, connector.end.point);
      connector.start.point = next;
      if (connector.controlPoints[0]) {
        connector.controlPoints[0] = {
          x: connector.controlPoints[0].x + next.x - previous.x,
          y: connector.controlPoints[0].y + next.y - previous.y,
        };
      }
    }
  }
  if (connector.end.binding) {
    const target = elements[connector.end.binding.elementId];
    if (target?.status === "active") {
      const previous = connector.end.point;
      const next = connectorAnchorPoint(target, connector.end.binding.anchor, connector.start.point);
      connector.end.point = next;
      const lastIndex = connector.controlPoints.length - 1;
      if (lastIndex >= 0 && connector.controlPoints[lastIndex]) {
        connector.controlPoints[lastIndex] = {
          x: connector.controlPoints[lastIndex]!.x + next.x - previous.x,
          y: connector.controlPoints[lastIndex]!.y + next.y - previous.y,
        };
      }
    }
  }
  const points = [connector.start.point, ...connector.controlPoints, connector.end.point];
  const bounds = strokePointBounds(points);
  connector.transform = { ...bounds, rotation: 0 };
  return connector;
}

export function connectorAnchorPoint(
  element: BoardSceneElement,
  anchor: "top" | "right" | "bottom" | "left" | "center" | "auto" | undefined,
  toward: AnnotationPoint,
): AnnotationPoint {
  const center = elementCenter(element);
  const { x, y, width, height } = element.transform;
  if (anchor === "top") return { x: center.x, y };
  if (anchor === "right") return { x: x + width, y: center.y };
  if (anchor === "bottom") return { x: center.x, y: y + height };
  if (anchor === "left") return { x, y: center.y };
  if (anchor === "center") return center;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
  const halfWidth = Math.max(0.5, width / 2);
  const halfHeight = Math.max(0.5, height / 2);
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function sceneElementFitsInside(
  element: BoardSceneElement,
  section: Extract<BoardSceneElement, { kind: "section" }>,
): boolean {
  const outer = section.transform;
  const inner = element.transform;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function tableCellIdAtPoint(
  table: Extract<BoardSceneElement, { kind: "table" }>,
  point: AnnotationPoint,
): string | null {
  const relativeX = (point.x - table.transform.x) / Math.max(1, table.transform.width);
  const relativeY = (point.y - table.transform.y) / Math.max(1, table.transform.height);
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return null;
  const totalWidth = table.columns.reduce((sum, column) => sum + Math.max(1, column.width), 0);
  const totalHeight = table.rows.reduce((sum, row) => sum + Math.max(1, row.height), 0);
  const targetX = relativeX * totalWidth;
  const targetY = relativeY * totalHeight;
  let width = 0;
  const column = table.columns.find((candidate) => {
    width += Math.max(1, candidate.width);
    return targetX <= width;
  });
  let height = 0;
  const row = table.rows.find((candidate) => {
    height += Math.max(1, candidate.height);
    return targetY <= height;
  });
  if (!row || !column) return null;
  return Object.values(table.cells).find(
    (cell) => cell.rowId === row.id && cell.columnId === column.id,
  )?.id ?? null;
}

export const OPEN_SPOT_KINDS: ReadonlySet<BoardSceneElement["kind"]> = new Set([
  "shape",
  "sticky",
  "text",
  "table",
  "code_block",
  "mind_map_node",
]);

export const OPEN_SPOT_DIRECTIONS: Readonly<Record<SceneIntentPlacementDirection, readonly [number, number]>> = {
  right: [1, 0],
  left: [-1, 0],
  down: [0, 1],
  up: [0, -1],
};

/**
 * Moves a command-created element to the nearest open spot so a run of typed
 * or spoken additions builds a readable diagram instead of a stack. Searches
 * rings of element-sized steps around the requested spot, preferring the
 * requested direction, then the axis-aligned neighbours.
 */
export function openSceneTransform(
  state: BoardState,
  transform: BoardSceneElement["transform"],
  prefer: SceneIntentPlacementDirection,
): BoardSceneElement["transform"] {
  const gapX = 48;
  const gapY = 40;
  const occupied = Object.values(state.elements)
    .filter((element) =>
      element.status === "active" &&
      element.kind !== "connector" &&
      element.kind !== "section" &&
      sceneElementVisibleForIntent(state, element),
    )
    .map(({ transform: bounds }) => bounds);
  const overlaps = (x: number, y: number) => occupied.some((bounds) =>
    x < bounds.x + bounds.width + gapX &&
    x + transform.width + gapX > bounds.x &&
    y < bounds.y + bounds.height + gapY &&
    y + transform.height + gapY > bounds.y,
  );
  if (!overlaps(transform.x, transform.y)) return transform;
  const [preferX, preferY] = OPEN_SPOT_DIRECTIONS[prefer];
  const stepX = transform.width + gapX;
  const stepY = transform.height + gapY;
  for (let ring = 1; ring <= 8; ring += 1) {
    const offsets: [number, number][] = [];
    for (let column = -ring; column <= ring; column += 1) {
      for (let row = -ring; row <= ring; row += 1) {
        if (Math.max(Math.abs(column), Math.abs(row)) === ring) offsets.push([column, row]);
      }
    }
    offsets.sort(([ax, ay], [bx, by]) =>
      (bx * preferX + by * preferY) - (ax * preferX + ay * preferY) ||
      (Math.abs(ax) + Math.abs(ay)) - (Math.abs(bx) + Math.abs(by)),
    );
    for (const [column, row] of offsets) {
      const x = transform.x + column * stepX;
      const y = transform.y + row * stepY;
      if (!overlaps(x, y)) return { ...transform, x, y };
    }
  }
  return transform;
}

export type InlineTextElement = Extract<BoardSceneElement, { kind: "sticky" | "shape" | "text" | "mind_map_node" }>;

export function isInlineTextEditable(element: BoardSceneElement): element is InlineTextElement {
  return (
    element.kind === "sticky" ||
    element.kind === "shape" ||
    element.kind === "text" ||
    element.kind === "mind_map_node"
  );
}

/**
 * Places the on-canvas text editor over its element in the board area's
 * coordinates. Sections edit their title in a strip along the top edge.
 */
export function sceneTextEditorBounds(
  element: InlineTextElement | Extract<BoardSceneElement, { kind: "section" }>,
  viewport: BoardViewport,
  canvas: HTMLCanvasElement | null,
): { left: number; top: number; width: number; height: number } | null {
  if (!canvas) return null;
  const area = canvas.closest(".board-area")?.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const offsetX = area ? canvasRect.left - area.left : 0;
  const offsetY = area ? canvasRect.top - area.top : 0;
  const { x, y, width, height } = element.transform;
  const topLeft = screenPointFromBoard(viewport, { x, y });
  const bottomRight = screenPointFromBoard(viewport, { x: x + width, y: y + height });
  const editorWidth = Math.max(160, bottomRight.x - topLeft.x);
  const editorHeight = element.kind === "section" ? 44 : Math.max(48, bottomRight.y - topLeft.y);
  const centerX = (topLeft.x + bottomRight.x) / 2;
  const top = element.kind === "section"
    ? topLeft.y
    : (topLeft.y + bottomRight.y) / 2 - editorHeight / 2;
  return {
    left: centerX - editorWidth / 2 + offsetX,
    top: top + offsetY,
    width: editorWidth,
    height: editorHeight,
  };
}

export function sceneIntentPlacementPoint(
  target: BoardSceneElement,
  direction: "left" | "right" | "up" | "down",
): AnnotationPoint {
  const center = elementCenter(target);
  const horizontal = target.transform.width / 2 + 180;
  const vertical = target.transform.height / 2 + 130;
  return {
    x: center.x + (direction === "left" ? -horizontal : direction === "right" ? horizontal : 0),
    y: center.y + (direction === "up" ? -vertical : direction === "down" ? vertical : 0),
  };
}

export function elementCenter(element: BoardSceneElement): AnnotationPoint {
  if (element.kind === "connector") {
    return {
      x: (element.start.point.x + element.end.point.x) / 2,
      y: (element.start.point.y + element.end.point.y) / 2,
    };
  }
  return {
    x: element.transform.x + element.transform.width / 2,
    y: element.transform.y + element.transform.height / 2,
  };
}

export function boundsBetween(
  start: AnnotationPoint,
  end: AnnotationPoint,
): BoardSceneElement["transform"] {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
    rotation: 0,
  };
}

export function sceneElementUnionBounds(
  elements: readonly BoardSceneElement[],
  padding = 0,
): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...elements.map((element) => element.transform.x));
  const top = Math.min(...elements.map((element) => element.transform.y));
  const right = Math.max(...elements.map((element) => element.transform.x + element.transform.width));
  const bottom = Math.max(...elements.map((element) => element.transform.y + element.transform.height));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

export function layoutSceneElements(
  elements: readonly BoardSceneElement[],
  direction: Extract<BoardSceneIntent, { type: "layout" }>["direction"],
): Map<string, AnnotationPoint> {
  const ordered = [...elements].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const originX = Math.min(...ordered.map((element) => element.transform.x));
  const originY = Math.min(...ordered.map((element) => element.transform.y));
  const gap = 48;
  const positions = new Map<string, AnnotationPoint>();
  const columns = direction === "grid" ? Math.max(1, Math.ceil(Math.sqrt(ordered.length))) : ordered.length;
  let horizontalCursor = originX;
  let verticalCursor = originY;
  ordered.forEach((element, index) => {
    if (direction === "grid") {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const maxWidth = Math.max(...ordered.map((candidate) => candidate.transform.width));
      const maxHeight = Math.max(...ordered.map((candidate) => candidate.transform.height));
      positions.set(element.id, { x: originX + column * (maxWidth + gap), y: originY + row * (maxHeight + gap) });
      return;
    }
    if (direction === "left_to_right" || direction === "right_to_left") {
      positions.set(element.id, { x: horizontalCursor, y: originY });
      horizontalCursor += element.transform.width + gap;
    } else {
      positions.set(element.id, { x: originX, y: verticalCursor });
      verticalCursor += element.transform.height + gap;
    }
  });
  if (direction === "right_to_left" || direction === "bottom_to_top") {
    const values = [...positions.values()].reverse();
    ordered.forEach((element, index) => positions.set(element.id, values[index]!));
  }
  return positions;
}

export function mindMapDirectionOffset(
  direction: Extract<BoardSceneElement, { kind: "mind_map_node" }>["relation"]["direction"],
  transform: BoardSceneElement["transform"],
): AnnotationPoint {
  const horizontal = transform.width + 120;
  const vertical = transform.height + 96;
  if (direction === "left") return { x: -horizontal, y: 0 };
  if (direction === "up") return { x: 0, y: -vertical };
  if (direction === "down") return { x: 0, y: vertical };
  return { x: horizontal, y: 0 };
}
