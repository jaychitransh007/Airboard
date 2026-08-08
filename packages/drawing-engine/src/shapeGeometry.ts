import {
  isCatalogShapeKind,
  type AnnotationBounds,
  type AnnotationPoint,
  type CatalogShapeKind,
} from "@airboard/core";

export type CatalogShapeTransform = AnnotationBounds & {
  /** Clockwise rotation in degrees around the bounds center. */
  rotation?: number;
};

export type CatalogShapePaint = {
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
};

export type CatalogShapeOutlineKind =
  | "rectangle"
  | "rounded-rectangle"
  | "ellipse"
  | "stadium"
  | "polygon"
  | "document"
  | "cylinder"
  | "horizontal-cylinder"
  | "folder"
  | "shield"
  | "speech-bubble"
  | "cloud"
  | "queue";

const POLYGON_KINDS = new Set<CatalogShapeKind>([
  "diamond",
  "triangle",
  "downward-triangle",
  "pentagon",
  "octagon",
  "plus",
  "left-arrow",
  "right-arrow",
  "chevron",
  "star",
  "right-parallelogram",
  "left-parallelogram",
  "trapezoid",
  "manual-input",
  "hexagon",
]);

const ADVANCED_ICON_KINDS = new Set<CatalogShapeKind>([
  "activity",
  "archive",
  "authentication",
  "chat",
  "computer",
  "desktop",
  "email",
  "frontend",
  "instant",
  "location",
  "mobile",
  "package",
  "payment",
  "security",
  "send",
  "server",
  "service",
  "settings",
  "storage",
  "terminal",
  "user",
  "wallet",
  "web",
]);

/** The outer silhouette used consistently by rendering, selection and hit testing. */
export function catalogShapeOutlineKind(kind: CatalogShapeKind): CatalogShapeOutlineKind {
  if (POLYGON_KINDS.has(kind)) return "polygon";
  switch (kind) {
    case "ellipse":
    case "or":
    case "summing-junction":
      return "ellipse";
    case "rounded-rectangle":
    case "predefined-process":
    case "internal-storage":
    case "api":
    case "process":
    case "file":
    case "multiple-documents":
      return kind === "rounded-rectangle" ? "rounded-rectangle" : "rectangle";
    case "terminator":
      return "stadium";
    case "document":
      return "document";
    case "cylinder":
    case "database":
      return "cylinder";
    case "horizontal-cylinder":
      return "horizontal-cylinder";
    case "folder":
      return "folder";
    case "shield":
      return "shield";
    case "speech-bubble":
      return "speech-bubble";
    case "cloud":
      return "cloud";
    case "queue":
      return "queue";
    default:
      return ADVANCED_ICON_KINDS.has(kind) ? "rounded-rectangle" : "rectangle";
  }
}

/**
 * Draws one catalog shape using original Airboard geometry. The caller owns
 * board transforms; this helper owns rotation and restores all canvas state.
 */
export function drawCatalogShape(
  context: CanvasRenderingContext2D,
  kind: CatalogShapeKind,
  transform: CatalogShapeTransform,
  paint: CatalogShapePaint = {},
): void {
  const bounds = normalizedBounds(transform);
  const center = boundsCenter(bounds);
  const rotation = degreesToRadians(transform.rotation ?? 0);
  const localBounds = rotation === 0
    ? bounds
    : { x: -bounds.width / 2, y: -bounds.height / 2, width: bounds.width, height: bounds.height };

  context.save();
  if (rotation !== 0) {
    context.translate(center.x, center.y);
    context.rotate(rotation);
  }
  context.lineJoin = "round";
  context.lineCap = "round";
  if (paint.fill !== undefined) context.fillStyle = paint.fill;
  if (paint.stroke !== undefined) context.strokeStyle = paint.stroke;
  context.lineWidth = Math.max(0.5, paint.strokeWidth ?? context.lineWidth);
  context.setLineDash(
    paint.strokeStyle === "dashed"
      ? [Math.max(5, context.lineWidth * 3), Math.max(4, context.lineWidth * 2)]
      : paint.strokeStyle === "dotted"
        ? [Math.max(1, context.lineWidth), Math.max(4, context.lineWidth * 2)]
        : [],
  );

  drawShapeBody(context, kind, localBounds, paint);
  drawShapeDetails(context, kind, localBounds, paint);
  context.restore();
}

/** Traces only the primary silhouette; useful for selection outlines. */
export function traceCatalogShapeOutline(
  context: CanvasRenderingContext2D,
  kind: CatalogShapeKind,
  bounds: AnnotationBounds,
): void {
  const normalized = normalizedBounds(bounds);
  switch (catalogShapeOutlineKind(kind)) {
    case "ellipse":
      traceEllipse(context, normalized);
      return;
    case "stadium":
      traceStadium(context, normalized);
      return;
    case "polygon":
      tracePolygon(context, catalogShapePolygon(kind, normalized));
      return;
    case "document":
      traceDocument(context, normalized);
      return;
    case "cylinder":
      traceCylinder(context, normalized);
      return;
    case "horizontal-cylinder":
      traceHorizontalCylinder(context, normalized);
      return;
    case "folder":
      tracePolygon(context, folderPolygon(normalized));
      return;
    case "shield":
      traceShield(context, normalized);
      return;
    case "speech-bubble":
      tracePolygon(context, speechBubblePolygon(normalized));
      return;
    case "cloud":
      traceCloud(context, normalized);
      return;
    case "queue":
      traceRoundedRect(context, normalized, Math.min(8, normalized.height * 0.1));
      return;
    case "rounded-rectangle":
      traceRoundedRect(context, normalized, Math.min(18, normalized.width * 0.14, normalized.height * 0.25));
      return;
    case "rectangle":
      if (kind === "file") {
        traceFile(context, normalized);
      } else if (ADVANCED_ICON_KINDS.has(kind)) {
        traceRoundedRect(context, normalized, Math.min(14, normalized.width * 0.1, normalized.height * 0.18));
      } else {
        traceRectangle(context, normalized);
      }
  }
}

export function catalogShapeContainsPoint(
  kind: CatalogShapeKind,
  transform: CatalogShapeTransform,
  point: AnnotationPoint,
  padding = 0,
): boolean {
  const bounds = normalizedBounds(transform);
  const localPoint = unrotatePoint(point, boundsCenter(bounds), transform.rotation ?? 0);
  const expanded = expandBounds(bounds, padding);

  switch (catalogShapeOutlineKind(kind)) {
    case "ellipse":
      return pointInEllipse(localPoint, expanded);
    case "stadium":
      return pointInStadium(localPoint, expanded);
    case "polygon":
      return pointInPolygon(localPoint, catalogShapePolygon(kind, expanded));
    case "document":
      return pointInPolygon(localPoint, documentHitPolygon(expanded));
    case "cylinder":
      return pointInCylinder(localPoint, expanded);
    case "horizontal-cylinder":
      return pointInHorizontalCylinder(localPoint, expanded);
    case "folder":
      return pointInPolygon(localPoint, folderPolygon(expanded));
    case "shield":
      return pointInPolygon(localPoint, shieldHitPolygon(expanded));
    case "speech-bubble":
      return pointInPolygon(localPoint, speechBubblePolygon(expanded));
    case "cloud":
      return pointInCloud(localPoint, expanded);
    case "queue":
      return pointInRoundedRect(localPoint, expanded, Math.min(8, expanded.height * 0.1));
    case "rounded-rectangle":
      return pointInRoundedRect(
        localPoint,
        expanded,
        Math.min(18, expanded.width * 0.14, expanded.height * 0.25),
      );
    case "rectangle":
      if (kind === "file") return pointInPolygon(localPoint, filePolygon(expanded));
      return pointInRoundedRect(
        localPoint,
        expanded,
        ADVANCED_ICON_KINDS.has(kind)
          ? Math.min(14, expanded.width * 0.1, expanded.height * 0.18)
          : 0,
      );
  }
}

export function catalogShapeIntersectsCircle(
  kind: CatalogShapeKind,
  transform: CatalogShapeTransform,
  center: AnnotationPoint,
  radius: number,
): boolean {
  const safeRadius = Math.max(0, radius);
  if (catalogShapeContainsPoint(kind, transform, center, 0)) return true;
  if (safeRadius === 0) return false;

  // Sampling the circumference handles concave shapes (star/plus/chevron)
  // and rotated shapes without maintaining a second set of edge equations.
  const sampleCount = 48;
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    if (
      catalogShapeContainsPoint(kind, transform, {
        x: center.x + Math.cos(angle) * safeRadius,
        y: center.y + Math.sin(angle) * safeRadius,
      })
    ) {
      return true;
    }
  }

  const shapeCenter = boundsCenter(normalizedBounds(transform));
  return Math.hypot(shapeCenter.x - center.x, shapeCenter.y - center.y) <= safeRadius;
}

/** Finds a connector anchor on the rotated shape silhouette. */
export function pointOnCatalogShapeBoundary(
  kind: CatalogShapeKind,
  transform: CatalogShapeTransform,
  toward: AnnotationPoint,
): AnnotationPoint {
  const bounds = normalizedBounds(transform);
  const center = boundsCenter(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return rotatePoint({ x: bounds.x + bounds.width, y: center.y }, center, transform.rotation ?? 0);

  // Binary search on a ray is robust across every catalog silhouette and
  // ensures connector anchoring uses exactly the same contains test as hits.
  const length = Math.hypot(dx, dy);
  const farScale = (Math.hypot(bounds.width, bounds.height) * 2 + length) / length;
  let inside = center;
  let outside = { x: center.x + dx * farScale, y: center.y + dy * farScale };
  for (let index = 0; index < 48; index += 1) {
    const midpoint = { x: (inside.x + outside.x) / 2, y: (inside.y + outside.y) / 2 };
    if (catalogShapeContainsPoint(kind, transform, midpoint)) inside = midpoint;
    else outside = midpoint;
  }
  return inside;
}

export function shapeKindFromUnknown(value: unknown): CatalogShapeKind | null {
  return isCatalogShapeKind(value) ? value : null;
}

function drawShapeBody(
  context: CanvasRenderingContext2D,
  kind: CatalogShapeKind,
  bounds: AnnotationBounds,
  paint: CatalogShapePaint,
): void {
  if (kind === "multiple-documents") {
    const offset = Math.min(10, bounds.width * 0.08, bounds.height * 0.1);
    for (let layer = 2; layer >= 1; layer -= 1) {
      traceDocument(context, {
        x: bounds.x + offset * layer,
        y: bounds.y,
        width: bounds.width - offset * layer,
        height: bounds.height - offset * layer,
      });
      paintPath(context, paint);
    }
    traceDocument(context, {
      x: bounds.x,
      y: bounds.y + offset * 2,
      width: bounds.width - offset * 2,
      height: bounds.height - offset * 2,
    });
    paintPath(context, paint);
    return;
  }

  if (kind === "queue") {
    const gap = Math.min(8, bounds.width * 0.06);
    const laneHeight = (bounds.height - gap) / 2;
    traceRoundedRect(context, { x: bounds.x, y: bounds.y, width: bounds.width - gap, height: laneHeight }, 5);
    paintPath(context, paint);
    traceRoundedRect(context, {
      x: bounds.x + gap,
      y: bounds.y + laneHeight + gap,
      width: bounds.width - gap,
      height: laneHeight,
    }, 5);
    paintPath(context, paint);
    return;
  }

  traceCatalogShapeOutline(context, kind, bounds);
  paintPath(context, paint);
}

function paintPath(context: CanvasRenderingContext2D, paint: CatalogShapePaint): void {
  const alpha = context.globalAlpha;
  if ((paint.fill ?? String(context.fillStyle)) !== "transparent" && (paint.fillOpacity ?? 1) > 0) {
    context.globalAlpha = alpha * clamp01(paint.fillOpacity ?? 1);
    context.fill();
  }
  if ((paint.strokeOpacity ?? 1) > 0 && (paint.strokeWidth ?? context.lineWidth) > 0) {
    context.globalAlpha = alpha * clamp01(paint.strokeOpacity ?? 1);
    context.stroke();
  }
  context.globalAlpha = alpha;
}

function drawShapeDetails(
  context: CanvasRenderingContext2D,
  kind: CatalogShapeKind,
  bounds: AnnotationBounds,
  paint: CatalogShapePaint,
): void {
  const alpha = context.globalAlpha;
  context.globalAlpha = alpha * clamp01(paint.strokeOpacity ?? 1);
  context.lineWidth = Math.max(1, (paint.strokeWidth ?? context.lineWidth) * 0.72);
  context.setLineDash([]);

  switch (kind) {
    case "cylinder":
    case "database":
      drawVerticalCylinderDetails(context, bounds);
      break;
    case "horizontal-cylinder":
      drawHorizontalCylinderDetails(context, bounds);
      break;
    case "file":
      drawFileFold(context, bounds);
      break;
    case "folder":
      drawFolderSeam(context, bounds);
      break;
    case "document":
      break;
    case "predefined-process":
      drawInsetRails(context, bounds, "vertical");
      break;
    case "internal-storage":
      drawInsetRails(context, bounds, "corner");
      break;
    case "or":
      drawJunctionMark(context, bounds, false);
      break;
    case "summing-junction":
      drawJunctionMark(context, bounds, true);
      break;
    case "queue":
      drawQueueArrow(context, bounds);
      break;
    case "api":
      drawApiGlyph(context, iconBox(bounds));
      break;
    case "activity":
    case "archive":
    case "authentication":
    case "chat":
    case "computer":
    case "desktop":
    case "email":
    case "frontend":
    case "instant":
    case "location":
    case "mobile":
    case "package":
    case "payment":
    case "security":
    case "send":
    case "server":
    case "service":
    case "settings":
    case "storage":
    case "terminal":
    case "user":
    case "wallet":
    case "web":
      drawAdvancedGlyph(context, kind, iconBox(bounds));
      break;
  }
  context.globalAlpha = alpha;
}

function catalogShapePolygon(kind: CatalogShapeKind, bounds: AnnotationBounds): AnnotationPoint[] {
  const { x, y, width: width, height: height } = bounds;
  const right = x + width;
  const bottom = y + height;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  switch (kind) {
    case "diamond":
      return [{ x: centerX, y }, { x: right, y: centerY }, { x: centerX, y: bottom }, { x, y: centerY }];
    case "triangle":
      return [{ x: centerX, y }, { x: right, y: bottom }, { x, y: bottom }];
    case "downward-triangle":
      return [{ x, y }, { x: right, y }, { x: centerX, y: bottom }];
    case "pentagon":
      return regularPolygon(bounds, 5, -Math.PI / 2);
    case "octagon":
      return regularPolygon(bounds, 8, Math.PI / 8);
    case "star":
      return starPolygon(bounds, 5);
    case "plus": {
      const armX = width * 0.31;
      const armY = height * 0.31;
      return [
        { x: x + armX, y }, { x: right - armX, y },
        { x: right - armX, y: y + armY }, { x: right, y: y + armY },
        { x: right, y: bottom - armY }, { x: right - armX, y: bottom - armY },
        { x: right - armX, y: bottom }, { x: x + armX, y: bottom },
        { x: x + armX, y: bottom - armY }, { x, y: bottom - armY },
        { x, y: y + armY }, { x: x + armX, y: y + armY },
      ];
    }
    case "left-arrow":
    case "right-arrow": {
      const reverse = kind === "left-arrow";
      const points = [
        { x, y: centerY },
        { x: x + width * 0.38, y },
        { x: x + width * 0.38, y: y + height * 0.28 },
        { x: right, y: y + height * 0.28 },
        { x: right, y: bottom - height * 0.28 },
        { x: x + width * 0.38, y: bottom - height * 0.28 },
        { x: x + width * 0.38, y: bottom },
      ];
      return reverse ? points : points.map((point) => ({ x: x + right - point.x, y: point.y })).reverse();
    }
    case "chevron": {
      const notch = width * 0.3;
      return [
        { x, y }, { x: right - notch, y }, { x: right, y: centerY },
        { x: right - notch, y: bottom }, { x, y: bottom }, { x: x + notch, y: centerY },
      ];
    }
    case "right-parallelogram":
    case "left-parallelogram": {
      const skew = Math.min(width * 0.18, 26);
      const rightLean = kind === "right-parallelogram";
      return rightLean
        ? [{ x: x + skew, y }, { x: right, y }, { x: right - skew, y: bottom }, { x, y: bottom }]
        : [{ x, y }, { x: right - skew, y }, { x: right, y: bottom }, { x: x + skew, y: bottom }];
    }
    case "trapezoid": {
      const inset = Math.min(width * 0.2, 28);
      return [{ x: x + inset, y }, { x: right - inset, y }, { x: right, y: bottom }, { x, y: bottom }];
    }
    case "manual-input": {
      const slope = Math.min(height * 0.24, 18);
      return [{ x, y: y + slope }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }];
    }
    case "hexagon": {
      const inset = Math.min(width * 0.2, 30);
      return [
        { x: x + inset, y }, { x: right - inset, y }, { x: right, y: centerY },
        { x: right - inset, y: bottom }, { x: x + inset, y: bottom }, { x, y: centerY },
      ];
    }
    default:
      return [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }];
  }
}

function drawAdvancedGlyph(
  context: CanvasRenderingContext2D,
  kind: CatalogShapeKind,
  box: AnnotationBounds,
): void {
  const { x, y, width: w, height: h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const right = x + w;
  const bottom = y + h;
  const line = (...coordinates: number[]): void => {
    const firstX = coordinates[0];
    const firstY = coordinates[1];
    if (firstX === undefined || firstY === undefined) return;
    context.beginPath();
    context.moveTo(firstX, firstY);
    for (let index = 2; index + 1 < coordinates.length; index += 2) {
      context.lineTo(coordinates[index]!, coordinates[index + 1]!);
    }
    context.stroke();
  };
  const rectangle = (rx: number, ry: number, rw: number, rh: number, radius = 0): void => {
    radius > 0
      ? traceRoundedRect(context, { x: rx, y: ry, width: rw, height: rh }, radius)
      : traceRectangle(context, { x: rx, y: ry, width: rw, height: rh });
    context.stroke();
  };
  const circle = (px: number, py: number, radius: number): void => {
    context.beginPath();
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.stroke();
  };

  switch (kind) {
    case "activity":
      line(x, cy, x + w * 0.2, cy, x + w * 0.34, y + h * 0.2, x + w * 0.52, bottom - h * 0.18, x + w * 0.67, cy, right, cy);
      break;
    case "archive":
      rectangle(x + w * 0.12, y + h * 0.28, w * 0.76, h * 0.58, 3);
      rectangle(x + w * 0.06, y + h * 0.12, w * 0.88, h * 0.2, 2);
      line(x + w * 0.4, y + h * 0.48, x + w * 0.6, y + h * 0.48);
      break;
    case "authentication":
      drawShieldGlyph(context, box);
      circle(cx, cy - h * 0.03, Math.min(w, h) * 0.09);
      line(cx, cy + h * 0.06, cx, cy + h * 0.24);
      break;
    case "chat":
      traceRoundedRect(context, { x: x + w * 0.08, y: y + h * 0.14, width: w * 0.84, height: h * 0.58 }, 6);
      context.stroke();
      line(x + w * 0.3, y + h * 0.72, x + w * 0.24, bottom - h * 0.08, x + w * 0.48, y + h * 0.72);
      line(x + w * 0.27, cy - 2, x + w * 0.73, cy - 2);
      break;
    case "cloud":
      traceCloud(context, { x: x + w * 0.03, y: y + h * 0.16, width: w * 0.94, height: h * 0.68 });
      context.stroke();
      break;
    case "computer":
      rectangle(x + w * 0.12, y + h * 0.12, w * 0.76, h * 0.58, 4);
      line(x + w * 0.04, bottom - h * 0.12, right - w * 0.04, bottom - h * 0.12, right - w * 0.15, y + h * 0.7, x + w * 0.15, y + h * 0.7, x + w * 0.04, bottom - h * 0.12);
      break;
    case "desktop":
      rectangle(x + w * 0.08, y + h * 0.08, w * 0.84, h * 0.62, 3);
      line(cx, y + h * 0.7, cx, bottom - h * 0.1);
      line(x + w * 0.28, bottom - h * 0.1, x + w * 0.72, bottom - h * 0.1);
      break;
    case "email":
      rectangle(x + w * 0.05, y + h * 0.16, w * 0.9, h * 0.68, 4);
      line(x + w * 0.07, y + h * 0.2, cx, cy + h * 0.08, right - w * 0.07, y + h * 0.2);
      break;
    case "file":
      traceFile(context, { x: x + w * 0.18, y: y + h * 0.04, width: w * 0.64, height: h * 0.92 });
      context.stroke();
      drawFileFold(context, { x: x + w * 0.18, y: y + h * 0.04, width: w * 0.64, height: h * 0.92 });
      break;
    case "frontend":
      rectangle(x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.84, 4);
      line(x + w * 0.04, y + h * 0.3, right - w * 0.04, y + h * 0.3);
      line(x + w * 0.25, y + h * 0.48, x + w * 0.14, y + h * 0.59, x + w * 0.25, y + h * 0.7);
      line(x + w * 0.75, y + h * 0.48, x + w * 0.86, y + h * 0.59, x + w * 0.75, y + h * 0.7);
      break;
    case "instant":
      tracePolygon(context, [
        { x: cx + w * 0.08, y }, { x: x + w * 0.22, y: cy + h * 0.04 },
        { x: cx - w * 0.03, y: cy + h * 0.04 }, { x: cx - w * 0.1, y: bottom },
        { x: right - w * 0.2, y: cy - h * 0.06 }, { x: cx + w * 0.04, y: cy - h * 0.06 },
      ]);
      context.stroke();
      break;
    case "location":
      context.beginPath();
      context.moveTo(cx, bottom - h * 0.03);
      context.bezierCurveTo(x + w * 0.08, cy, x + w * 0.2, y + h * 0.05, cx, y + h * 0.05);
      context.bezierCurveTo(right - w * 0.2, y + h * 0.05, right - w * 0.08, cy, cx, bottom - h * 0.03);
      context.stroke();
      circle(cx, y + h * 0.36, Math.min(w, h) * 0.11);
      break;
    case "mobile":
      rectangle(x + w * 0.25, y + h * 0.02, w * 0.5, h * 0.96, 7);
      line(x + w * 0.42, bottom - h * 0.11, x + w * 0.58, bottom - h * 0.11);
      break;
    case "package":
      line(cx, y, right - w * 0.08, y + h * 0.23, cx, y + h * 0.46, x + w * 0.08, y + h * 0.23, cx, y);
      line(x + w * 0.08, y + h * 0.23, x + w * 0.08, bottom - h * 0.18, cx, bottom, right - w * 0.08, bottom - h * 0.18, right - w * 0.08, y + h * 0.23);
      line(cx, y + h * 0.46, cx, bottom);
      break;
    case "payment":
      rectangle(x + w * 0.04, y + h * 0.12, w * 0.92, h * 0.76, 6);
      line(x + w * 0.04, y + h * 0.34, right - w * 0.04, y + h * 0.34);
      line(x + w * 0.17, bottom - h * 0.2, x + w * 0.43, bottom - h * 0.2);
      break;
    case "security":
      drawShieldGlyph(context, box);
      line(cx - w * 0.13, cy, cx - w * 0.02, cy + h * 0.11, cx + w * 0.2, cy - h * 0.16);
      break;
    case "send":
      tracePolygon(context, [
        { x, y: cy - h * 0.05 }, { x: right, y }, { x: cx + w * 0.13, y: bottom },
        { x: cx - w * 0.02, y: cy + h * 0.12 }, { x, y: cy - h * 0.05 },
      ]);
      context.stroke();
      line(cx - w * 0.02, cy + h * 0.12, right, y);
      break;
    case "server":
    case "storage":
      for (let row = 0; row < 3; row += 1) {
        const rowY = y + row * h * 0.34;
        rectangle(x + w * 0.05, rowY, w * 0.9, h * 0.25, 3);
        circle(right - w * 0.14, rowY + h * 0.125, Math.min(w, h) * 0.025);
      }
      if (kind === "storage") line(x + w * 0.22, y + h * 0.125, x + w * 0.62, y + h * 0.125);
      break;
    case "service":
      circle(cx, cy, Math.min(w, h) * 0.12);
      circle(x + w * 0.18, y + h * 0.22, Math.min(w, h) * 0.09);
      circle(right - w * 0.18, y + h * 0.22, Math.min(w, h) * 0.09);
      circle(cx, bottom - h * 0.15, Math.min(w, h) * 0.09);
      line(x + w * 0.24, y + h * 0.28, cx - w * 0.08, cy - h * 0.07);
      line(right - w * 0.24, y + h * 0.28, cx + w * 0.08, cy - h * 0.07);
      line(cx, cy + h * 0.12, cx, bottom - h * 0.24);
      break;
    case "settings":
      drawGear(context, box);
      break;
    case "terminal":
      rectangle(x + w * 0.03, y + h * 0.08, w * 0.94, h * 0.84, 4);
      line(x + w * 0.18, y + h * 0.35, x + w * 0.35, cy, x + w * 0.18, y + h * 0.65);
      line(x + w * 0.45, y + h * 0.67, x + w * 0.76, y + h * 0.67);
      break;
    case "user":
      circle(cx, y + h * 0.28, Math.min(w, h) * 0.16);
      context.beginPath();
      context.arc(cx, bottom + h * 0.08, Math.min(w, h) * 0.42, Math.PI * 1.12, Math.PI * 1.88);
      context.stroke();
      break;
    case "wallet":
      rectangle(x + w * 0.04, y + h * 0.17, w * 0.92, h * 0.7, 6);
      rectangle(right - w * 0.4, cy - h * 0.12, w * 0.42, h * 0.3, 4);
      circle(right - w * 0.13, cy + h * 0.03, Math.min(w, h) * 0.025);
      break;
    case "web":
      circle(cx, cy, Math.min(w, h) * 0.46);
      context.beginPath();
      context.ellipse(cx, cy, w * 0.22, h * 0.46, 0, 0, Math.PI * 2);
      context.stroke();
      line(x + w * 0.07, cy, right - w * 0.07, cy);
      line(x + w * 0.15, y + h * 0.28, right - w * 0.15, y + h * 0.28);
      line(x + w * 0.15, bottom - h * 0.28, right - w * 0.15, bottom - h * 0.28);
      break;
  }
}

function drawVerticalCylinderDetails(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const cap = Math.min(16, bounds.height * 0.2);
  context.beginPath();
  context.ellipse(bounds.x + bounds.width / 2, bounds.y + cap, bounds.width / 2, cap, 0, 0, Math.PI * 2);
  context.stroke();
}

function drawHorizontalCylinderDetails(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const cap = Math.min(16, bounds.width * 0.18);
  context.beginPath();
  context.ellipse(bounds.x + cap, bounds.y + bounds.height / 2, cap, bounds.height / 2, 0, 0, Math.PI * 2);
  context.stroke();
}

function drawFileFold(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const fold = Math.min(bounds.width, bounds.height) * 0.24;
  context.beginPath();
  context.moveTo(bounds.x + bounds.width - fold, bounds.y);
  context.lineTo(bounds.x + bounds.width - fold, bounds.y + fold);
  context.lineTo(bounds.x + bounds.width, bounds.y + fold);
  context.stroke();
}

function drawFolderSeam(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  context.beginPath();
  context.moveTo(bounds.x, bounds.y + bounds.height * 0.3);
  context.lineTo(bounds.x + bounds.width, bounds.y + bounds.height * 0.3);
  context.stroke();
}

function drawInsetRails(
  context: CanvasRenderingContext2D,
  bounds: AnnotationBounds,
  direction: "vertical" | "corner",
): void {
  const insetX = Math.min(15, bounds.width * 0.12);
  const insetY = Math.min(15, bounds.height * 0.18);
  context.beginPath();
  context.moveTo(bounds.x + insetX, bounds.y);
  context.lineTo(bounds.x + insetX, bounds.y + bounds.height);
  if (direction === "vertical") {
    context.moveTo(bounds.x + bounds.width - insetX, bounds.y);
    context.lineTo(bounds.x + bounds.width - insetX, bounds.y + bounds.height);
  } else {
    context.moveTo(bounds.x, bounds.y + insetY);
    context.lineTo(bounds.x + bounds.width, bounds.y + insetY);
  }
  context.stroke();
}

function drawJunctionMark(context: CanvasRenderingContext2D, bounds: AnnotationBounds, diagonal: boolean): void {
  const insetX = bounds.width * 0.22;
  const insetY = bounds.height * 0.22;
  context.beginPath();
  context.moveTo(bounds.x + insetX, bounds.y + bounds.height / 2);
  context.lineTo(bounds.x + bounds.width - insetX, bounds.y + bounds.height / 2);
  context.moveTo(bounds.x + bounds.width / 2, bounds.y + insetY);
  context.lineTo(bounds.x + bounds.width / 2, bounds.y + bounds.height - insetY);
  if (diagonal) {
    context.moveTo(bounds.x + insetX * 1.2, bounds.y + insetY * 1.2);
    context.lineTo(bounds.x + bounds.width - insetX * 1.2, bounds.y + bounds.height - insetY * 1.2);
    context.moveTo(bounds.x + bounds.width - insetX * 1.2, bounds.y + insetY * 1.2);
    context.lineTo(bounds.x + insetX * 1.2, bounds.y + bounds.height - insetY * 1.2);
  }
  context.stroke();
}

function drawQueueArrow(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const gap = Math.min(8, bounds.width * 0.06);
  const laneHeight = (bounds.height - gap) / 2;
  const y = bounds.y + laneHeight / 2;
  const right = bounds.x + bounds.width - gap;
  context.beginPath();
  context.moveTo(right - 24, y);
  context.lineTo(right - 8, y);
  context.lineTo(right - 14, y - 5);
  context.moveTo(right - 8, y);
  context.lineTo(right - 14, y + 5);
  context.stroke();
}

function drawApiGlyph(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const centerY = bounds.y + bounds.height / 2;
  context.beginPath();
  context.moveTo(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.28);
  context.lineTo(bounds.x + bounds.width * 0.12, centerY);
  context.lineTo(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.72);
  context.moveTo(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.28);
  context.lineTo(bounds.x + bounds.width * 0.88, centerY);
  context.lineTo(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.72);
  context.moveTo(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.18);
  context.lineTo(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.82);
  context.stroke();
}

function drawShieldGlyph(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  traceShield(context, {
    x: bounds.x + bounds.width * 0.12,
    y: bounds.y + bounds.height * 0.04,
    width: bounds.width * 0.76,
    height: bounds.height * 0.92,
  });
  context.stroke();
}

function drawGear(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const center = boundsCenter(bounds);
  const outer = Math.min(bounds.width, bounds.height) * 0.38;
  const inner = outer * 0.56;
  context.beginPath();
  for (let index = 0; index < 16; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 8;
    const point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.stroke();
  context.beginPath();
  context.arc(center.x, center.y, outer * 0.27, 0, Math.PI * 2);
  context.stroke();
}

function iconBox(bounds: AnnotationBounds): AnnotationBounds {
  const paddingX = Math.min(28, bounds.width * 0.2);
  const paddingY = Math.min(22, bounds.height * 0.2);
  return {
    x: bounds.x + paddingX,
    y: bounds.y + paddingY,
    width: Math.max(8, bounds.width - paddingX * 2),
    height: Math.max(8, bounds.height - paddingY * 2),
  };
}

function traceRectangle(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function traceRoundedRect(
  context: CanvasRenderingContext2D,
  bounds: AnnotationBounds,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, bounds.width / 2, bounds.height / 2));
  context.beginPath();
  context.moveTo(bounds.x + r, bounds.y);
  context.lineTo(bounds.x + bounds.width - r, bounds.y);
  context.quadraticCurveTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + r);
  context.lineTo(bounds.x + bounds.width, bounds.y + bounds.height - r);
  context.quadraticCurveTo(
    bounds.x + bounds.width,
    bounds.y + bounds.height,
    bounds.x + bounds.width - r,
    bounds.y + bounds.height,
  );
  context.lineTo(bounds.x + r, bounds.y + bounds.height);
  context.quadraticCurveTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height - r);
  context.lineTo(bounds.x, bounds.y + r);
  context.quadraticCurveTo(bounds.x, bounds.y, bounds.x + r, bounds.y);
  context.closePath();
}

function traceEllipse(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  context.beginPath();
  context.ellipse(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    bounds.width / 2,
    bounds.height / 2,
    0,
    0,
    Math.PI * 2,
  );
}

function traceStadium(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const radius = Math.min(bounds.height / 2, bounds.width / 2);
  context.beginPath();
  context.moveTo(bounds.x + radius, bounds.y);
  context.lineTo(bounds.x + bounds.width - radius, bounds.y);
  context.arc(bounds.x + bounds.width - radius, bounds.y + bounds.height / 2, radius, -Math.PI / 2, Math.PI / 2);
  context.lineTo(bounds.x + radius, bounds.y + bounds.height);
  context.arc(bounds.x + radius, bounds.y + bounds.height / 2, radius, Math.PI / 2, (3 * Math.PI) / 2);
  context.closePath();
}

function tracePolygon(context: CanvasRenderingContext2D, points: readonly AnnotationPoint[]): void {
  const first = points[0];
  context.beginPath();
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function traceDocument(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const wave = Math.min(14, bounds.height * 0.18);
  const bottom = bounds.y + bounds.height - wave;
  context.beginPath();
  context.moveTo(bounds.x, bounds.y);
  context.lineTo(bounds.x + bounds.width, bounds.y);
  context.lineTo(bounds.x + bounds.width, bottom);
  context.bezierCurveTo(
    bounds.x + bounds.width * 0.72,
    bottom + wave * 1.55,
    bounds.x + bounds.width * 0.28,
    bottom - wave * 1.15,
    bounds.x,
    bottom + wave * 0.58,
  );
  context.closePath();
}

function traceCylinder(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const cap = Math.min(16, bounds.height * 0.2);
  context.beginPath();
  context.ellipse(bounds.x + bounds.width / 2, bounds.y + cap, bounds.width / 2, cap, 0, Math.PI, 0);
  context.lineTo(bounds.x + bounds.width, bounds.y + bounds.height - cap);
  context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height - cap, bounds.width / 2, cap, 0, 0, Math.PI);
  context.closePath();
}

function traceHorizontalCylinder(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const cap = Math.min(16, bounds.width * 0.18);
  context.beginPath();
  context.ellipse(bounds.x + cap, bounds.y + bounds.height / 2, cap, bounds.height / 2, 0, Math.PI / 2, (3 * Math.PI) / 2);
  context.lineTo(bounds.x + bounds.width - cap, bounds.y);
  context.ellipse(bounds.x + bounds.width - cap, bounds.y + bounds.height / 2, cap, bounds.height / 2, 0, -Math.PI / 2, Math.PI / 2);
  context.closePath();
}

function traceShield(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  context.beginPath();
  context.moveTo(bounds.x + bounds.width / 2, bounds.y);
  context.bezierCurveTo(
    bounds.x + bounds.width * 0.72,
    bounds.y + bounds.height * 0.12,
    bounds.x + bounds.width * 0.88,
    bounds.y + bounds.height * 0.15,
    bounds.x + bounds.width,
    bounds.y + bounds.height * 0.17,
  );
  context.lineTo(bounds.x + bounds.width * 0.88, bounds.y + bounds.height * 0.7);
  context.bezierCurveTo(
    bounds.x + bounds.width * 0.72,
    bounds.y + bounds.height * 0.9,
    bounds.x + bounds.width * 0.58,
    bounds.y + bounds.height * 0.98,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height,
  );
  context.bezierCurveTo(
    bounds.x + bounds.width * 0.42,
    bounds.y + bounds.height * 0.98,
    bounds.x + bounds.width * 0.28,
    bounds.y + bounds.height * 0.9,
    bounds.x + bounds.width * 0.12,
    bounds.y + bounds.height * 0.7,
  );
  context.lineTo(bounds.x, bounds.y + bounds.height * 0.17);
  context.bezierCurveTo(
    bounds.x + bounds.width * 0.12,
    bounds.y + bounds.height * 0.15,
    bounds.x + bounds.width * 0.28,
    bounds.y + bounds.height * 0.12,
    bounds.x + bounds.width / 2,
    bounds.y,
  );
  context.closePath();
}

function traceFile(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  tracePolygon(context, filePolygon(bounds));
}

function traceCloud(context: CanvasRenderingContext2D, bounds: AnnotationBounds): void {
  const x = bounds.x;
  const y = bounds.y;
  const w = bounds.width;
  const h = bounds.height;
  context.beginPath();
  context.moveTo(x + w * 0.22, y + h * 0.82);
  context.bezierCurveTo(x - w * 0.02, y + h * 0.82, x - w * 0.02, y + h * 0.48, x + w * 0.2, y + h * 0.44);
  context.bezierCurveTo(x + w * 0.21, y + h * 0.2, x + w * 0.48, y + h * 0.07, x + w * 0.65, y + h * 0.25);
  context.bezierCurveTo(x + w * 0.85, y + h * 0.2, x + w, y + h * 0.36, x + w * 0.94, y + h * 0.55);
  context.bezierCurveTo(x + w * 1.08, y + h * 0.65, x + w * 0.96, y + h * 0.84, x + w * 0.78, y + h * 0.82);
  context.closePath();
}

function regularPolygon(bounds: AnnotationBounds, sides: number, startAngle: number): AnnotationPoint[] {
  const center = boundsCenter(bounds);
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  return Array.from({ length: sides }, (_, index) => {
    const angle = startAngle + (index * Math.PI * 2) / sides;
    return { x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry };
  });
}

function starPolygon(bounds: AnnotationBounds, points: number): AnnotationPoint[] {
  const center = boundsCenter(bounds);
  const outerX = bounds.width / 2;
  const outerY = bounds.height / 2;
  return Array.from({ length: points * 2 }, (_, index) => {
    const outer = index % 2 === 0;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    return {
      x: center.x + Math.cos(angle) * outerX * (outer ? 1 : 0.43),
      y: center.y + Math.sin(angle) * outerY * (outer ? 1 : 0.43),
    };
  });
}

function folderPolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  const tabWidth = bounds.width * 0.42;
  const tabHeight = bounds.height * 0.2;
  return [
    { x: bounds.x, y: bounds.y + tabHeight },
    { x: bounds.x + bounds.width * 0.08, y: bounds.y + tabHeight },
    { x: bounds.x + bounds.width * 0.16, y: bounds.y },
    { x: bounds.x + tabWidth, y: bounds.y },
    { x: bounds.x + tabWidth + bounds.width * 0.1, y: bounds.y + tabHeight },
    { x: bounds.x + bounds.width, y: bounds.y + tabHeight },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

function speechBubblePolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  const tail = Math.min(bounds.width * 0.2, bounds.height * 0.25);
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height - tail },
    { x: bounds.x + bounds.width * 0.42, y: bounds.y + bounds.height - tail },
    { x: bounds.x + bounds.width * 0.22, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width * 0.27, y: bounds.y + bounds.height - tail },
    { x: bounds.x, y: bounds.y + bounds.height - tail },
  ];
}

function filePolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  const fold = Math.min(bounds.width, bounds.height) * 0.24;
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width - fold, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + fold },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

function documentHitPolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  const wave = Math.min(14, bounds.height * 0.18);
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height - wave },
    { x: bounds.x + bounds.width * 0.72, y: bounds.y + bounds.height - wave * 0.1 },
    { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height - wave * 1.25 },
    { x: bounds.x, y: bounds.y + bounds.height - wave * 0.42 },
  ];
}

function shieldHitPolygon(bounds: AnnotationBounds): AnnotationPoint[] {
  return [
    { x: bounds.x + bounds.width / 2, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height * 0.17 },
    { x: bounds.x + bounds.width * 0.88, y: bounds.y + bounds.height * 0.7 },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width * 0.12, y: bounds.y + bounds.height * 0.7 },
    { x: bounds.x, y: bounds.y + bounds.height * 0.17 },
  ];
}

function pointInPolygon(point: AnnotationPoint, polygon: readonly AnnotationPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    if (
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInEllipse(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  const center = boundsCenter(bounds);
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  return ((point.x - center.x) ** 2) / (rx ** 2) + ((point.y - center.y) ** 2) / (ry ** 2) <= 1;
}

function pointInStadium(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  const radius = Math.min(bounds.height / 2, bounds.width / 2);
  const centerY = bounds.y + bounds.height / 2;
  const left = bounds.x + radius;
  const right = bounds.x + bounds.width - radius;
  return (
    (point.x >= left && point.x <= right && point.y >= bounds.y && point.y <= bounds.y + bounds.height) ||
    Math.hypot(point.x - left, point.y - centerY) <= radius ||
    Math.hypot(point.x - right, point.y - centerY) <= radius
  );
}

function pointInRoundedRect(point: AnnotationPoint, bounds: AnnotationBounds, radius: number): boolean {
  if (!pointInBounds(point, bounds)) return false;
  const r = Math.max(0, Math.min(radius, bounds.width / 2, bounds.height / 2));
  if (r === 0) return true;
  const innerX = clamp(point.x, bounds.x + r, bounds.x + bounds.width - r);
  const innerY = clamp(point.y, bounds.y + r, bounds.y + bounds.height - r);
  return Math.hypot(point.x - innerX, point.y - innerY) <= r;
}

function pointInCylinder(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  if (!pointInBounds(point, bounds)) return false;
  const cap = Math.min(16, bounds.height * 0.2);
  if (point.y >= bounds.y + cap && point.y <= bounds.y + bounds.height - cap) return true;
  const centerY = point.y < bounds.y + cap ? bounds.y + cap : bounds.y + bounds.height - cap;
  return pointInEllipse(point, {
    x: bounds.x,
    y: centerY - cap,
    width: bounds.width,
    height: cap * 2,
  });
}

function pointInHorizontalCylinder(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  if (!pointInBounds(point, bounds)) return false;
  const cap = Math.min(16, bounds.width * 0.18);
  if (point.x >= bounds.x + cap && point.x <= bounds.x + bounds.width - cap) return true;
  const centerX = point.x < bounds.x + cap ? bounds.x + cap : bounds.x + bounds.width - cap;
  return pointInEllipse(point, {
    x: centerX - cap,
    y: bounds.y,
    width: cap * 2,
    height: bounds.height,
  });
}

function pointInCloud(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  const lobes = [
    { x: bounds.x + bounds.width * 0.23, y: bounds.y + bounds.height * 0.6, rx: bounds.width * 0.24, ry: bounds.height * 0.27 },
    { x: bounds.x + bounds.width * 0.46, y: bounds.y + bounds.height * 0.42, rx: bounds.width * 0.28, ry: bounds.height * 0.36 },
    { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height * 0.5, rx: bounds.width * 0.25, ry: bounds.height * 0.31 },
    { x: bounds.x + bounds.width * 0.82, y: bounds.y + bounds.height * 0.68, rx: bounds.width * 0.19, ry: bounds.height * 0.2 },
  ];
  return lobes.some(({ x, y, rx, ry }) => ((point.x - x) ** 2) / (rx ** 2) + ((point.y - y) ** 2) / (ry ** 2) <= 1);
}

function normalizedBounds(bounds: AnnotationBounds): AnnotationBounds {
  return {
    x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
    y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

function expandBounds(bounds: AnnotationBounds, amount: number): AnnotationBounds {
  const safe = Math.max(0, amount);
  return {
    x: bounds.x - safe,
    y: bounds.y - safe,
    width: bounds.width + safe * 2,
    height: bounds.height + safe * 2,
  };
}

function boundsCenter(bounds: AnnotationBounds): AnnotationPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function pointInBounds(point: AnnotationPoint, bounds: AnnotationBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function unrotatePoint(point: AnnotationPoint, center: AnnotationPoint, rotation: number): AnnotationPoint {
  return rotatePoint(point, center, -rotation);
}

function rotatePoint(point: AnnotationPoint, center: AnnotationPoint, rotation: number): AnnotationPoint {
  if (rotation === 0) return point;
  const radians = degreesToRadians(rotation);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
