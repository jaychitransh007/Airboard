import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findAnnotationObjectAtPoint,
  strokeIntersectsCircle,
} from "../dist/drawing-engine/src/hitTest.js";

const rectangleStroke = {
  id: "rect-1",
  boardId: "board-1",
  userId: "user-1",
  tool: "marker",
  color: "#111827",
  thickness: 3,
  points: [{ x: 20, y: 20, t: 1 }],
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  status: "committed",
  annotation: {
    type: "rectangle",
    source: "gesture",
    bounds: { x: 20, y: 20, width: 120, height: 80 },
  },
};

const connectorStroke = {
  id: "connector-1",
  boardId: "board-1",
  userId: "user-1",
  tool: "marker",
  color: "#111827",
  thickness: 3,
  points: [
    { x: 200, y: 60, t: 1 },
    { x: 340, y: 60, t: 2 },
  ],
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  status: "committed",
  annotation: {
    type: "connector",
    source: "gesture",
    start: { x: 200, y: 60 },
    end: { x: 340, y: 60 },
  },
};

test("findAnnotationObjectAtPoint returns topmost object by bounds or connector segment", () => {
  const state = {
    boardId: "board-1",
    strokes: {
      [rectangleStroke.id]: rectangleStroke,
      [connectorStroke.id]: connectorStroke,
    },
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  };

  assert.equal(findAnnotationObjectAtPoint(state, { x: 50, y: 50 }).id, "rect-1");
  assert.equal(findAnnotationObjectAtPoint(state, { x: 260, y: 65 }).id, "connector-1");
  assert.equal(findAnnotationObjectAtPoint(state, { x: 500, y: 500 }), null);
});

test("ellipse and decision nodes are not hittable in their empty bounding-box corners", () => {
  const ellipseStroke = {
    ...rectangleStroke,
    id: "ellipse-1",
    annotation: {
      type: "ellipse",
      source: "gesture",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    },
  };
  const diamondStroke = {
    ...rectangleStroke,
    id: "diamond-1",
    annotation: {
      type: "flow_node",
      nodeType: "decision",
      source: "gesture",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    },
  };

  const makeState = (stroke) => ({
    boardId: "board-1",
    strokes: { [stroke.id]: stroke },
    activeStrokes: {},
    eraseActions: {},
    participants: {},
    cursors: {},
    lastSequence: 0,
  });

  // Center is inside both shapes.
  assert.equal(findAnnotationObjectAtPoint(makeState(ellipseStroke), { x: 50, y: 50 }).id, "ellipse-1");
  assert.equal(findAnnotationObjectAtPoint(makeState(diamondStroke), { x: 50, y: 50 }).id, "diamond-1");

  // The top-left corner (5,5) is inside the bbox but outside both real shapes.
  assert.equal(findAnnotationObjectAtPoint(makeState(ellipseStroke), { x: 5, y: 5 }), null);
  assert.equal(findAnnotationObjectAtPoint(makeState(diamondStroke), { x: 5, y: 5 }), null);
});

test("strokeIntersectsCircle includes annotation bounds", () => {
  assert.equal(strokeIntersectsCircle(rectangleStroke, { x: 18, y: 18 }, 6), true);
  assert.equal(strokeIntersectsCircle(rectangleStroke, { x: 200, y: 200 }, 6), false);
});

test("connector hit testing follows the orthogonal rendered route", () => {
  const routedConnector = {
    ...connectorStroke,
    points: [
      { x: 200, y: 60, t: 1 },
      { x: 340, y: 180, t: 2 },
    ],
    annotation: {
      ...connectorStroke.annotation,
      start: { x: 200, y: 60 },
      end: { x: 340, y: 180 },
    },
  };

  assert.equal(strokeIntersectsCircle(routedConnector, { x: 270, y: 120 }, 4), true);
  assert.equal(strokeIntersectsCircle(routedConnector, { x: 235, y: 120 }, 4), false);
});
