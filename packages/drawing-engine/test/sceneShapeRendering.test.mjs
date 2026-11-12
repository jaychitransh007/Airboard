import assert from "node:assert/strict";
import test from "node:test";

import { findSceneElementAtPoint } from "../src/hitTest.ts";
import {
  drawStroke,
  drawShapeElement,
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
});

test("ellipse and diamond shapes are not hittable in their empty bounding-box corners", () => {
  const ellipse = shapeElement("ellipse", "ellipse", 1, { x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  const diamond = shapeElement("diamond", "diamond", 2, { x: 200, y: 0, width: 100, height: 100, rotation: 0 });
  const state = boardState({ ellipse, diamond });

  assert.equal(findSceneElementAtPoint(state, { x: 50, y: 50 }).id, "ellipse");
  assert.equal(findSceneElementAtPoint(state, { x: 2, y: 2 }), null);
  assert.equal(findSceneElementAtPoint(state, { x: 250, y: 50 }).id, "diamond");
  assert.equal(findSceneElementAtPoint(state, { x: 203, y: 3 }), null);
});

test("a freehand preview stroke paints as a smoothed polyline", () => {
  const context = recordingContext();
  drawStroke(context, {
    id: "preview",
    boardId: "board",
    userId: "user",
    tool: "pen",
    color: "#111",
    thickness: 2,
    points: [{ x: 0, y: 0, t: 0 }, { x: 10, y: 10, t: 1 }, { x: 20, y: 0, t: 2 }],
    createdAt: now,
    updatedAt: now,
    status: "active",
  });
  assert.deepEqual(
    context.calls.filter(([method]) => ["moveTo", "quadraticCurveTo", "lineTo", "stroke"].includes(method)).map(([method]) => method),
    ["moveTo", "quadraticCurveTo", "lineTo", "stroke"],
  );

  const empty = recordingContext();
  drawStroke(empty, { id: "empty", boardId: "board", userId: "user", tool: "pen", color: "#111", thickness: 2, points: [], createdAt: now, updatedAt: now, status: "active" });
  assert.deepEqual(empty.calls, []);
});

test("shape renderer paints rich text on rotated shapes", () => {
  const second = shapeElement("second", "database", -2, { x: 0, y: 0, width: 100, height: 100, rotation: 15 });

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

function boardState(elements) {
  return {
    boardId: "board",
    sceneVersion: 3,
    elements,
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
