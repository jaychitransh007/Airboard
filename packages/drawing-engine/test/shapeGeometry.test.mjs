import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCED_SHAPE_CATALOG,
  BOARD_SHAPE_CATALOG,
} from "../../core/src/shapeCatalog.ts";
import {
  catalogShapeContainsPoint,
  catalogShapeIntersectsCircle,
  drawCatalogShape,
  pointOnCatalogShapeBoundary,
} from "../src/shapeGeometry.ts";

const bounds = { x: 10, y: 20, width: 140, height: 100 };

test("every catalog kind has renderable geometry containing its center", () => {
  const uniqueKinds = new Set(BOARD_SHAPE_CATALOG.map(({ kind }) => kind));
  for (const kind of uniqueKinds) {
    assert.equal(
      catalogShapeContainsPoint(kind, bounds, { x: 80, y: 70 }),
      true,
      `${kind} should contain its center`,
    );
    const context = recordingContext();
    assert.doesNotThrow(() => drawCatalogShape(context, kind, bounds));
    assert.ok(context.calls.some(([name]) => name === "beginPath"), `${kind} should trace a path`);
    assert.equal(
      context.calls.filter(([name]) => name === "save").length,
      context.calls.filter(([name]) => name === "restore").length,
      `${kind} should balance canvas state`,
    );
  }
});

test("concave and curved shapes do not expose transparent bounding-box corners", () => {
  for (const kind of ["ellipse", "triangle", "diamond", "star", "plus", "shield"]) {
    assert.equal(
      catalogShapeContainsPoint(kind, { x: 0, y: 0, width: 100, height: 100 }, { x: 2, y: 2 }),
      false,
      `${kind} corner should not be hittable`,
    );
  }
  assert.equal(
    catalogShapeIntersectsCircle("triangle", { x: 0, y: 0, width: 100, height: 100 }, { x: 2, y: 2 }, 1),
    false,
  );
  assert.equal(
    catalogShapeIntersectsCircle("triangle", { x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 2 }, 3),
    true,
  );
});

test("hit testing and connector anchors honor shape rotation", () => {
  const transform = { x: 0, y: 0, width: 100, height: 40, rotation: 90 };
  assert.equal(catalogShapeContainsPoint("square", transform, { x: 50, y: 50 }), true);
  assert.equal(catalogShapeContainsPoint("square", transform, { x: 20, y: 20 }), false);

  const anchor = pointOnCatalogShapeBoundary("square", transform, { x: 50, y: 200 });
  assert.ok(Math.abs(anchor.x - 50) < 0.001);
  assert.ok(Math.abs(anchor.y - 70) < 0.001);
});

test("advanced entries have distinct original glyph command streams", () => {
  const fingerprints = new Map();
  for (const { kind, name } of ADVANCED_SHAPE_CATALOG) {
    const context = recordingContext();
    drawCatalogShape(context, kind, bounds);
    const fingerprint = JSON.stringify(
      context.calls
        .filter(([method]) => !["save", "restore", "beginPath", "fill", "stroke", "setLineDash"].includes(method))
        .map(([method, ...args]) => [method, ...args.map((value) => typeof value === "number" ? Number(value.toFixed(3)) : value)]),
    );
    assert.equal(fingerprints.has(fingerprint), false, `${name} should not reuse another Advanced glyph`);
    fingerprints.set(fingerprint, kind);
  }
  assert.equal(fingerprints.size, 26);
});

function recordingContext() {
  const state = {
    calls: [],
    globalAlpha: 1,
    lineWidth: 2,
    fillStyle: "#fff",
    strokeStyle: "#111",
    lineJoin: "round",
    lineCap: "round",
  };
  const methods = new Set([
    "save", "restore", "translate", "rotate", "setLineDash", "beginPath", "moveTo", "lineTo",
    "quadraticCurveTo", "bezierCurveTo", "closePath", "rect", "ellipse", "arc", "fill", "stroke",
  ]);
  return new Proxy(state, {
    get(target, property) {
      if (methods.has(property)) {
        return (...args) => target.calls.push([property, ...args]);
      }
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}
