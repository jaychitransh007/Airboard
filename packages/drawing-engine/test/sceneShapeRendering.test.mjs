import assert from "node:assert/strict";
import test from "node:test";

import {
  findAnnotationObjectAtPoint,
  findBoardObjectAtPoint,
  findSceneElementAtPoint,
  strokeIntersectsCircle,
} from "../src/hitTest.ts";
import {
  drawStroke,
  drawShapeElement,
  orderSceneShapesForRender,
  richTextPlainText,
} from "../src/renderer.ts";

const now = "2026-08-07T00:00:00.000Z";

test("scene shape hit testing follows geometry, rotation, visibility, and z-order", () => {
  const lower = shapeElement("lower", "square", 1, { x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  const upper = shapeElement("upper", "triangle", 2, { x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  const rotated = shapeElement("rotated", "square", 3, { x: 120, y: 0, width: 100, height: 40, rotation: 90 });
  const hidden = { ...shapeElement("hidden", "square", 99, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }), visible: false };
  const state = boardState({ lower, upper, rotated, hidden });

  assert.equal(findSceneElementAtPoint(state, { x: 50, y: 60 }).id, "upper");
  assert.equal(findSceneElementAtPoint(state, { x: 4, y: 4 }).id, "lower");
  assert.equal(findSceneElementAtPoint(state, { x: 170, y: 60 }).id, "rotated");
  assert.equal(findSceneElementAtPoint(state, { x: 125, y: 5 }), null);
  assert.deepEqual(findBoardObjectAtPoint(state, { x: 50, y: 60 }), {
    source: "element",
    element: upper,
  });
});

test("legacy annotations carrying shapeKind use catalog render geometry for hits", () => {
  const stroke = {
    id: "legacy-triangle",
    boardId: "board",
    userId: "user",
    tool: "marker",
    color: "#111",
    thickness: 2,
    points: [{ x: 50, y: 50, t: 0 }],
    createdAt: now,
    updatedAt: now,
    status: "committed",
    annotation: {
      type: "flow_node",
      source: "keyboard",
      shapeKind: "triangle",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    },
  };
  const state = boardState({}, { [stroke.id]: stroke });

  assert.equal(findAnnotationObjectAtPoint(state, { x: 50, y: 50 }).id, stroke.id);
  assert.equal(findAnnotationObjectAtPoint(state, { x: 2, y: 2 }), null);
  assert.equal(strokeIntersectsCircle(stroke, { x: 2, y: 2 }, 1), false);

  const context = recordingContext();
  drawStroke(context, {
    ...stroke,
    points: [],
    annotation: { ...stroke.annotation, type: "ellipse", shapeKind: "star" },
  });
  assert.equal(context.calls.some(([method]) => method === "ellipse"), false);
  assert.ok(context.calls.filter(([method]) => method === "lineTo").length >= 9);
});

test("shape renderer respects z-index and paints rich text on rotated shapes", () => {
  const first = shapeElement("first", "star", 10, { x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  const second = shapeElement("second", "database", -2, { x: 0, y: 0, width: 100, height: 100, rotation: 15 });
  assert.deepEqual(orderSceneShapesForRender([first, second]).map(({ id }) => id), ["second", "first"]);

  const context = recordingContext();
  drawShapeElement(context, second);
  assert.ok(context.calls.some(([method, angle]) => method === "rotate" && Math.abs(angle - Math.PI / 12) < 1e-9));
  assert.ok(context.calls.some(([method, text]) => method === "fillText" && text === "Database"));
  assert.equal(richTextPlainText(second.content), "Database");
});

function shapeElement(id, shapeKind, zIndex, transform) {
  return {
    id,
    boardId: "board",
    kind: "shape",
    status: "active",
    transform,
    zIndex,
    locked: false,
    visible: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    shapeKind,
    content: {
      type: "doc",
      blocks: [{ id: `${id}-block`, type: "paragraph", runs: [{ text: shapeKind === "database" ? "Database" : "" }] }],
    },
    style: {
      fill: "#f8fafc",
      fillOpacity: 1,
      stroke: "#111827",
      strokeOpacity: 1,
      strokeWidth: 2,
      strokeStyle: "solid",
      textColor: "#111827",
      fontSize: 13,
      textAlign: "center",
    },
  };
}

function boardState(elements, strokes = {}) {
  return {
    boardId: "board",
    sceneVersion: 2,
    elements,
    strokes,
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };
}

function recordingContext() {
  const state = {
    calls: [],
    globalAlpha: 1,
    lineWidth: 2,
    fillStyle: "#fff",
    strokeStyle: "#111",
    font: "13px sans-serif",
    textAlign: "center",
    textBaseline: "middle",
    lineJoin: "round",
    lineCap: "round",
  };
  const methods = new Set([
    "save", "restore", "translate", "rotate", "setLineDash", "beginPath", "moveTo", "lineTo",
    "quadraticCurveTo", "bezierCurveTo", "closePath", "rect", "ellipse", "arc", "fill", "stroke",
    "fillText",
  ]);
  return new Proxy(state, {
    get(target, property) {
      if (property === "measureText") return (text) => ({ width: String(text).length * 7 });
      if (methods.has(property)) return (...args) => target.calls.push([property, ...args]);
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}
