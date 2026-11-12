import type {
  AnnotationBounds,
  AnnotationPoint,
  BoardSceneElement,
  ConnectorElement,
  RichTextDocument,
} from "@airboard/core";

/**
 * Deterministic board-space samples for a scene connector. Rendering, labels,
 * hit testing, and selection all consume the same route so curved and bent
 * connectors never disagree about where the object is.
 */
export function sampleSceneConnector(
  element: ConnectorElement,
  curvedSegments = 28,
): AnnotationPoint[] {
  const start = element.start.point;
  const end = element.end.point;

  const lane = laneRoute(element);
  if (lane) return lane;

  if (element.pathKind === "straight") {
    return [start, end];
  }

  if (element.pathKind === "bent") {
    if (element.controlPoints.length > 0) {
      return [start, ...element.controlPoints, end];
    }
    // Mostly vertical: run down (or up) first, so the last segment enters
    // the target through its top or bottom edge and the arrowhead points
    // into the shape rather than along its edge.
    if (Math.abs(end.y - start.y) > Math.abs(end.x - start.x)) {
      const middleY = start.y + (end.y - start.y) / 2;
      return [
        start,
        { x: start.x, y: middleY },
        { x: end.x, y: middleY },
        end,
      ];
    }
    const middleX = start.x + (end.x - start.x) / 2;
    return [
      start,
      { x: middleX, y: start.y },
      { x: middleX, y: end.y },
      end,
    ];
  }

  const controls = sceneConnectorCurveControls(element);
  const segmentCount = Math.max(4, Math.floor(curvedSegments));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const t = index / segmentCount;
    return cubicPoint(start, controls[0], controls[1], end, t);
  });
}

/**
 * A parallel or two-way arrow between the same two objects runs in its own
 * lane, shifted sideways by its routeOffset, as legacy connectors always did.
 * Hand-placed bends (control points) and curves keep their own route.
 */
function laneRoute(element: ConnectorElement): AnnotationPoint[] | null {
  const offset = element.routeOffset;
  if (
    typeof offset !== "number" ||
    !Number.isFinite(offset) ||
    offset === 0 ||
    element.pathKind === "curved" ||
    element.controlPoints.length > 0
  ) {
    return null;
  }
  const start = element.start.point;
  const end = element.end.point;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return null;
  const normalX = -(end.y - start.y) / length;
  const normalY = (end.x - start.x) / length;
  return [
    start,
    { x: start.x + normalX * offset, y: start.y + normalY * offset },
    { x: end.x + normalX * offset, y: end.y + normalY * offset },
    end,
  ];
}

/** Cubic control points, deriving a stable horizontal S-curve when omitted. */
export function sceneConnectorCurveControls(
  element: ConnectorElement,
): readonly [AnnotationPoint, AnnotationPoint] {
  const start = element.start.point;
  const end = element.end.point;
  const first = element.controlPoints[0];
  const second = element.controlPoints[1];
  if (first && second) return [first, second];
  if (first) return [first, first];

  const dx = end.x - start.x;
  return [
    { x: start.x + dx / 2, y: start.y },
    { x: end.x - dx / 2, y: end.y },
  ];
}

export function sceneConnectorPointAt(
  element: ConnectorElement,
  rawPosition: number,
): AnnotationPoint {
  const points = sampleSceneConnector(element);
  if (points.length === 0) return element.start.point;
  if (points.length === 1) return points[0]!;

  const position = Math.min(1, Math.max(0, rawPosition));
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return points[0]!;

  const target = total * position;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (traversed + length >= target) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const local = length === 0 ? 0 : (target - traversed) / length;
      return {
        x: start.x + (end.x - start.x) * local,
        y: start.y + (end.y - start.y) * local,
      };
    }
    traversed += length;
  }
  return points[points.length - 1]!;
}

function cubicPoint(
  start: AnnotationPoint,
  controlA: AnnotationPoint,
  controlB: AnnotationPoint,
  end: AnnotationPoint,
  t: number,
): AnnotationPoint {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * controlA.x + c * controlB.x + d * end.x,
    y: a * start.y + b * controlA.y + c * controlB.y + d * end.y,
  };
}

/** The font connector labels are drawn in: the legacy connectors' 13px semibold. */
export const SCENE_CONNECTOR_LABEL_FONT_SIZE = 13;
export const SCENE_CONNECTOR_LABEL_FONT_WEIGHT = 600;
/** One wrapped label line, as the renderer's rich-text layout spaces it. */
export const SCENE_CONNECTOR_LABEL_LINE_HEIGHT = SCENE_CONNECTOR_LABEL_FONT_SIZE * 1.32;
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 3;
const LABEL_MAX_TEXT_WIDTH = 200;
/** Clear space kept between a label box and a shape outline. */
const LABEL_SHAPE_CLEARANCE = 6;
/** Space kept between a label box and another connector's line. */
const LABEL_LINE_CLEARANCE = 3;
/** Space kept between a label box and a group frame's border: it may sit just inside. */
const LABEL_BORDER_CLEARANCE = 1;
/** How much crossing another line counts against a place, in square units of shape covered. */
const LINE_CROSSING_COST = 400;
/** Space between the line and a label placed beside it. */
const LABEL_LINE_GAP = 4;
/**
 * Line left showing on each side of a label on the line: room for an
 * arrowhead and a visible run of line, so the arrow doesn't read as stubs.
 */
const LABEL_LINE_STUB = 22;
/** How far apart, along the line, the places a crowded label slides to are. */
const LABEL_SLIDE_STEP = 1;

/** What a connector's label keeps clear of. */
export type SceneConnectorLabelObstacles = {
  /** Objects' bounds: the shapes the connector joins and others nearby. */
  shapes: readonly AnnotationBounds[];
  /** Other connectors' routes nearby. */
  lines: readonly (readonly AnnotationPoint[])[];
  /** Group frames' borders nearby, as closed outlines: a label stays off them, not out of the frame. */
  borders?: readonly (readonly AnnotationPoint[])[];
};

export type SceneConnectorLabelLayout = {
  /** The label box, padding included, in board space. */
  bounds: AnnotationBounds;
  /** The label's lines after wrapping. */
  lines: string[];
  /** On the line (the line breaks around the box) or just beside it. */
  placement: "on_line" | "beside_line";
};

/**
 * Where a connector's label box goes. On a horizontal line it sits on the
 * line, centred between the two outlines the connector joins, when it fits
 * there with a run of line and the arrowhead still showing on each side;
 * otherwise it moves just above the line, wrapped to the gap between the
 * shapes (below, if above would touch a shape). Beside a vertical line it
 * goes to the right (or left). The renderer, hit testing and the layout
 * scorer all read it.
 *
 * `measure` gives a line's width in the label font; `obstacles` are the
 * shapes it joins and other objects nearby, and the routes of other
 * connectors nearby, when the caller knows them (sceneConnectorLabelObstacles).
 */
export function layoutSceneConnectorLabel(
  element: Pick<ConnectorElement, "pathKind" | "start" | "end" | "controlPoints" | "routeOffset" | "labelPosition">,
  text: string,
  measure: (line: string) => number,
  obstacles: SceneConnectorLabelObstacles = { shapes: [], lines: [] },
): SceneConnectorLabelLayout | null {
  const paragraphs = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  const connector = element as ConnectorElement;
  const position = Math.min(1, Math.max(0, Number.isFinite(element.labelPosition) ? element.labelPosition : 0.5));
  const anchor = sceneConnectorPointAt(connector, position);
  const before = sceneConnectorPointAt(connector, Math.max(0, position - 0.01));
  const after = sceneConnectorPointAt(connector, Math.min(1, position + 0.01));
  const tangentLength = Math.hypot(after.x - before.x, after.y - before.y);
  const tangent = tangentLength > 0
    ? { x: (after.x - before.x) / tangentLength, y: (after.y - before.y) / tangentLength }
    : { x: 1, y: 0 };
  const pathLength = polylineLength(sampleSceneConnector(connector));
  const halfLength = Math.min(position, 1 - position) * pathLength;
  const halfRoom = halfLength - LABEL_SHAPE_CLEARANCE;

  const boxFor = (lines: string[], center: AnnotationPoint): AnnotationBounds => {
    const width = Math.max(...lines.map((line) => measure(line))) + LABEL_PADDING_X * 2;
    const height = lines.length * SCENE_CONNECTOR_LABEL_LINE_HEIGHT + LABEL_PADDING_Y * 2;
    return { x: center.x - width / 2, y: center.y - height / 2, width, height };
  };
  const crossed = (box: AnnotationBounds) =>
    obstacles.lines.filter((route) => routeCrossesBox(route, box, LABEL_LINE_CLEARANCE)).length +
    (obstacles.borders ?? []).filter((border) => routeCrossesBox(border, box, LABEL_BORDER_CLEARANCE)).length;
  const clear = (box: AnnotationBounds) =>
    obstacles.shapes.every((shape) => !boundsOverlap(box, shape, LABEL_SHAPE_CLEARANCE)) && crossed(box) === 0;

  const horizontal = Math.abs(tangent.x) >= Math.abs(tangent.y);
  const singleLines = paragraphs.flatMap((paragraph) => wrapLabel(paragraph, LABEL_MAX_TEXT_WIDTH, measure));
  const onLine: SceneConnectorLabelLayout = {
    bounds: boxFor(singleLines, anchor),
    lines: singleLines,
    placement: "on_line",
  };
  const alongExtent =
    Math.abs(tangent.x) * onLine.bounds.width / 2 + Math.abs(tangent.y) * onLine.bounds.height / 2;
  // A label box across a vertical line would reach sideways into a parallel
  // lane (a two-way pair runs 72 apart), so labels go beside vertical lines.
  const onLineRoom = horizontal ? halfLength - LABEL_LINE_STUB - alongExtent : -1;
  if (onLineRoom >= 0 && clear(onLine.bounds)) return onLine;

  // Beside a horizontal line, wrap to the room between the two shapes.
  const wrapWidth = horizontal
    ? Math.min(LABEL_MAX_TEXT_WIDTH, Math.max(1, halfRoom * 2 - LABEL_PADDING_X * 2))
    : LABEL_MAX_TEXT_WIDTH;
  const lines = paragraphs.flatMap((paragraph) => wrapLabel(paragraph, wrapWidth, measure));
  const sized = boxFor(lines, anchor);
  const offset = LABEL_LINE_GAP + (horizontal ? sized.height / 2 : sized.width / 2);
  const sides = horizontal
    ? [{ x: anchor.x, y: anchor.y - offset }, { x: anchor.x, y: anchor.y + offset }]
    : [{ x: anchor.x + offset, y: anchor.y }, { x: anchor.x - offset, y: anchor.y }];
  const beside = sides.map((center): SceneConnectorLabelLayout => ({
    bounds: boxFor(lines, center),
    lines,
    placement: "beside_line",
  }));
  const clearBeside = beside.find((candidate) => clear(candidate.bounds));
  if (clearBeside) return clearBeside;

  // Something is in the way where the label would centre (often a group
  // frame's border across the gap): slide it along the line, nearest first.
  const shifted = (candidate: SceneConnectorLabelLayout, distance: number): SceneConnectorLabelLayout => ({
    ...candidate,
    bounds: {
      ...candidate.bounds,
      x: candidate.bounds.x + tangent.x * distance,
      y: candidate.bounds.y + tangent.y * distance,
    },
  });
  // It slides only as far as the straight run of line it is on, so it stays
  // beside the part of the line it names.
  const route = sampleSceneConnector(connector);
  const onRoute = (distance: number) =>
    distanceToRoute({ x: anchor.x + tangent.x * distance, y: anchor.y + tangent.y * distance }, route) <= 1;
  // Each place is checked as it is made: the nearest clear one wins.
  const slides: SceneConnectorLabelLayout[] = [];
  const maxSlide = Math.max(0, halfRoom);
  for (let step = LABEL_SLIDE_STEP; step <= maxSlide; step += LABEL_SLIDE_STEP) {
    for (const distance of [-step, step]) {
      if (!onRoute(distance)) continue;
      const candidates = step <= onLineRoom ? [onLine, ...beside] : beside;
      for (const candidate of candidates) {
        const slide = shifted(candidate, distance);
        if (clear(slide.bounds)) return slide;
        slides.push(slide);
      }
    }
  }
  // Nowhere is clear (a short jog between close shapes, or a two-way pair's
  // lanes): take the place that covers the least, the line itself included.
  const covered = (box: AnnotationBounds) =>
    obstacles.shapes.reduce((total, shape) => total + overlapArea(box, shape), 0) +
    crossed(box) * LINE_CROSSING_COST;
  const ranked = [...beside, onLine, ...slides].map((candidate) => ({ candidate, cost: covered(candidate.bounds) }));
  return ranked.reduce((best, entry) => (entry.cost < best.cost ? entry : best)).candidate;
}

function wrapLabel(paragraph: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function distanceToRoute(point: AnnotationPoint, route: readonly AnnotationPoint[]): number {
  let nearest = Infinity;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]!;
    const b = route[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
  }
  return nearest;
}

function polylineLength(points: readonly AnnotationPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return total;
}

/** True when any segment of the route passes through the box grown by the margin. */
function routeCrossesBox(route: readonly AnnotationPoint[], box: AnnotationBounds, margin: number): boolean {
  const grown = { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 };
  for (let index = 1; index < route.length; index += 1) {
    if (segmentCrossesBox(route[index - 1]!, route[index]!, grown)) return true;
  }
  return false;
}

/** Liang-Barsky clip: does the segment from a to b enter the box? */
function segmentCrossesBox(a: AnnotationPoint, b: AnnotationPoint, box: AnnotationBounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let low = 0;
  let high = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

function overlapArea(a: AnnotationBounds, b: AnnotationBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function boundsOverlap(a: AnnotationBounds, b: AnnotationBounds, margin: number): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin &&
    a.y + a.height > b.y - margin
  );
}

/** Kinds a label may cover: freehand ink, and group frames' interiors. */
const LABEL_IGNORES = new Set<BoardSceneElement["kind"]>(["section", "drawing"]);
const LABEL_SEARCH_MARGIN = 240;

type SceneElements = Readonly<Record<string, BoardSceneElement>>;

/**
 * What a connector's label keeps clear of: the shapes it joins, any other
 * object near it (not ink), the other connectors near it, and the borders
 * of group frames near it (a label may sit inside a frame, not across its
 * edge).
 */
export function sceneConnectorLabelObstacles(
  element: Pick<ConnectorElement, "id" | "start" | "end">,
  elements: SceneElements | undefined,
): SceneConnectorLabelObstacles {
  const shapes: AnnotationBounds[] = [];
  const lines: AnnotationPoint[][] = [];
  const borders: AnnotationPoint[][] = [];
  if (!elements) return { shapes, lines, borders };
  const xs = [element.start.point.x, element.end.point.x];
  const ys = [element.start.point.y, element.end.point.y];
  const near = {
    x: Math.min(...xs) - LABEL_SEARCH_MARGIN,
    y: Math.min(...ys) - LABEL_SEARCH_MARGIN,
    width: Math.abs(xs[1]! - xs[0]!) + LABEL_SEARCH_MARGIN * 2,
    height: Math.abs(ys[1]! - ys[0]!) + LABEL_SEARCH_MARGIN * 2,
  };
  for (const other of Object.values(elements)) {
    if (other.id === element.id || other.status !== "active" || !other.visible) continue;
    if (other.kind === "section") {
      // The frame's border is drawn; the inside is free room.
      const { x, y, width, height } = other.transform;
      const border = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
        { x, y },
      ];
      if (routeCrossesBox(border, near, 0)) borders.push(border);
      continue;
    }
    if (LABEL_IGNORES.has(other.kind)) continue;
    if (other.kind === "connector") {
      // Legacy mirrors are drawn as strokes; their routes are elsewhere.
      if (other.legacyStrokeId) continue;
      const route = sampleSceneConnector(other);
      if (routeCrossesBox(route, near, 0)) lines.push(route);
      continue;
    }
    const { x, y, width, height } = other.transform;
    const bounds = { x, y, width, height };
    if (boundsOverlap(bounds, near, 0)) shapes.push(bounds);
  }
  return { shapes, lines, borders };
}

/** The connector label font, as the renderer draws and measures it. */
export const SCENE_CONNECTOR_LABEL_FONT =
  `${SCENE_CONNECTOR_LABEL_FONT_WEIGHT} ${SCENE_CONNECTOR_LABEL_FONT_SIZE}px Inter, ui-sans-serif, system-ui, sans-serif`;

type TextMeasurer = { font: string; measureText(text: string): { width: number } };
let labelMeasurer: TextMeasurer | null | undefined;
const labelLineWidths = new Map<string, number>();
const LABEL_WIDTH_MEMO_LIMIT = 4000;

function sceneConnectorLabelMeasurer(): TextMeasurer | null {
  if (labelMeasurer !== undefined) return labelMeasurer;
  labelMeasurer = null;
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : typeof document !== "undefined"
          ? document.createElement("canvas")
          : null;
    const context = (canvas?.getContext("2d") ?? null) as TextMeasurer | null;
    if (context && typeof context.measureText === "function") {
      context.font = SCENE_CONNECTOR_LABEL_FONT;
      labelMeasurer = context;
    }
  } catch {
    labelMeasurer = null;
  }
  return labelMeasurer;
}

/**
 * A line's width in the connector label font: measured on a canvas where
 * there is one (the browser), estimated where there isn't (Node evals).
 * Each line is measured once.
 */
export function measureSceneConnectorLabelLine(line: string): number {
  const known = labelLineWidths.get(line);
  if (known !== undefined) return known;
  const measurer = sceneConnectorLabelMeasurer();
  const width = measurer ? measurer.measureText(line).width : estimateSceneConnectorLabelWidth(line);
  if (labelLineWidths.size >= LABEL_WIDTH_MEMO_LIMIT) labelLineWidths.clear();
  labelLineWidths.set(line, width);
  return width;
}

type CachedLabelLayout = { element: ConnectorElement; layout: SceneConnectorLabelLayout | null };
/** One elements record's layouts, and what changed from the record before it. */
type RecordLayouts = {
  entries: Map<string, CachedLabelLayout>;
  /** The record before this one, whose layouts may carry over. */
  previous: RecordLayouts | null;
  /**
   * Old and new bounds of the elements whose objects changed from `previous`;
   * null when too much changed to be worth checking (nothing carries over).
   */
  changed: AnnotationBounds[] | null;
};
/**
 * Label layouts by board: a board's elements record is replaced whenever any
 * element changes, so one record's layouts stay right for as long as it lives.
 */
let labelLayouts = new WeakMap<SceneElements, RecordLayouts>();
/**
 * The last record a layout was asked for. A new record (a drag's next frame)
 * reuses its layouts where nothing that changed is near the connector; only
 * the one record before is kept, so this never grows.
 */
let lastRecord: { elements: SceneElements; layouts: RecordLayouts } | null = null;
let labelLayoutComputations = 0;
/** More changed elements than this between two records: lay every label out again. */
const CARRY_OVER_CHANGE_LIMIT = 64;

/** Where an element can stand in another connector's obstacles; null for what labels ignore. */
function labelObstacleExtent(element: BoardSceneElement): AnnotationBounds | null {
  if (element.kind === "drawing") return null;
  if (element.kind === "connector") {
    const route = sampleSceneConnector(element);
    const xs = route.map((point) => point.x);
    const ys = route.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  const { x, y, width, height } = element.transform;
  return { x, y, width, height };
}

function changedExtents(before: SceneElements, after: SceneElements): AnnotationBounds[] | null {
  const changed: AnnotationBounds[] = [];
  const add = (element: BoardSceneElement | undefined) => {
    const extent = element ? labelObstacleExtent(element) : null;
    if (extent) changed.push(extent);
  };
  let count = 0;
  for (const id in after) {
    if (before[id] === after[id]) continue;
    if ((count += 1) > CARRY_OVER_CHANGE_LIMIT) return null;
    add(before[id]);
    add(after[id]);
  }
  for (const id in before) {
    if (id in after) continue;
    if ((count += 1) > CARRY_OVER_CHANGE_LIMIT) return null;
    add(before[id]);
  }
  return changed;
}

function recordLayouts(elements: SceneElements): RecordLayouts {
  const known = labelLayouts.get(elements);
  if (known) {
    lastRecord = { elements, layouts: known };
    return known;
  }
  const previous = lastRecord?.layouts ?? null;
  const layouts: RecordLayouts = {
    entries: new Map(),
    previous,
    changed: lastRecord ? changedExtents(lastRecord.elements, elements) : null,
  };
  // Only one record back is ever read: drop the chain beyond it.
  if (previous) previous.previous = null;
  labelLayouts.set(elements, layouts);
  lastRecord = { elements, layouts };
  return layouts;
}

/** The layout from the record before, if nothing that changed is near this connector's label. */
function carriedLayout(element: ConnectorElement, layouts: RecordLayouts): CachedLabelLayout | null {
  const earlier = layouts.previous?.entries.get(element.id);
  if (!earlier || earlier.element !== element || !layouts.changed) return null;
  const xs = [element.start.point.x, element.end.point.x];
  const ys = [element.start.point.y, element.end.point.y];
  const near = {
    x: Math.min(...xs) - LABEL_SEARCH_MARGIN,
    y: Math.min(...ys) - LABEL_SEARCH_MARGIN,
    width: Math.abs(xs[1]! - xs[0]!) + LABEL_SEARCH_MARGIN * 2,
    height: Math.abs(ys[1]! - ys[0]!) + LABEL_SEARCH_MARGIN * 2,
  };
  // A margin of 1: touching the search area's edge still counts there.
  return layouts.changed.some((extent) => boundsOverlap(extent, near, 1)) ? null : earlier;
}

/** How many label layouts have been computed (not served from the cache). For tests. */
export function sceneConnectorLabelLayoutComputations(): number {
  return labelLayoutComputations;
}

/** Forgets measured widths and layouts, e.g. once the label font has loaded. */
export function resetSceneConnectorLabelLayouts(): void {
  labelLineWidths.clear();
  labelLayouts = new WeakMap();
  lastRecord = null;
  if (labelMeasurer) labelMeasurer.font = SCENE_CONNECTOR_LABEL_FONT;
}

if (typeof document !== "undefined" && document.fonts && typeof document.fonts.addEventListener === "function") {
  document.fonts.addEventListener("loadingdone", resetSceneConnectorLabelLayouts);
}

/** A connector label's plain text, one line per paragraph. */
export function sceneConnectorLabelText(label: RichTextDocument): string {
  return label.blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n").trim();
}

/**
 * Where a scene connector's label is, as the renderer draws it, hit testing
 * finds it and the layout scorer reads it. Computed once per connector per
 * elements record and shared by all three.
 */
export function sceneConnectorLabelLayoutOnBoard(
  element: ConnectorElement,
  elements: SceneElements | undefined,
): SceneConnectorLabelLayout | null {
  const layouts = elements ? recordLayouts(elements) : null;
  const cached = layouts?.entries.get(element.id);
  if (cached && cached.element === element) return cached.layout;
  const carried = layouts ? carriedLayout(element, layouts) : null;
  if (carried) {
    layouts!.entries.set(element.id, carried);
    return carried.layout;
  }
  const layout = computeSceneConnectorLabelLayout(element, elements);
  layouts?.entries.set(element.id, { element, layout });
  return layout;
}

/** A connector's label layout computed afresh, with no cache. */
export function computeSceneConnectorLabelLayout(
  element: ConnectorElement,
  elements: SceneElements | undefined,
): SceneConnectorLabelLayout | null {
  labelLayoutComputations += 1;
  const text = sceneConnectorLabelText(element.label);
  return text
    ? layoutSceneConnectorLabel(element, text, measureSceneConnectorLabelLine, sceneConnectorLabelObstacles(element, elements))
    : null;
}

/**
 * A conservative estimate of a line's width in the 13px semibold label font,
 * for callers without a canvas (hit testing, the layout scorer).
 */
export function estimateSceneConnectorLabelWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (character === " ") width += 3.5;
    else if (/[ilI1.,'|]/u.test(character)) width += 3.7;
    else if (/[MW@#%]/u.test(character)) width += 9.4;
    else if (/[A-Z0-9]/u.test(character)) width += 7.8;
    else width += 7;
  }
  return Math.max(width, 1);
}
