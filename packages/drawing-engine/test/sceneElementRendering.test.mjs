import assert from "node:assert/strict";
import test from "node:test";

import { createBoardSceneElement, createRichTextDocument } from "@airboard/core";
import { findSceneElementAtPoint } from "../src/hitTest.ts";
import {
  drawSceneElement,
  drawSceneElementOverlay,
  orderSceneElementsForRender,
  sceneElementsForRender,
} from "../src/renderer.ts";
import {
  sampleSceneConnector,
  sceneConnectorPointAt,
} from "../src/sceneConnectorGeometry.ts";

const now = "2026-08-07T00:00:00.000Z";

test("all non-shape scene kinds paint deterministically on the canvas", () => {
  const image = {};
  const elements = nonShapeElements();
  const first = recordingContext();
  const second = recordingContext();

  for (const element of elements) {
    drawSceneElement(first, element, 1, { resolvedImages: { asset: image, preview: image } });
    drawSceneElement(second, element, 1, { resolvedImages: { asset: image, preview: image } });
  }

  assert.deepEqual(first.calls, second.calls);
  assert.ok(first.calls.some(([method]) => method === "quadraticCurveTo"), "drawing is smoothed");
  assert.ok(first.calls.some(([method]) => method === "bezierCurveTo"), "curved connector is cubic");
  assert.ok(first.calls.some(([method]) => method === "drawImage"), "resolved media is painted");
  assert.ok(first.calls.some(([method, text]) => method === "fillText" && text === "👍"));
  assert.ok(first.calls.some(([method, text]) => method === "fillText" && text === "const"));
  assert.ok(first.calls.some(([method, text]) => method === "fillText" && text === "Mind"));
  assert.ok(first.calls.filter(([method]) => method === "rect").length >= 10, "table and code clip are canvas-native");
});

test("every scene kind has a generalized hover and selection overlay", () => {
  const elements = [
    ...nonShapeElements(),
    scene("shape", "shape", {
      shapeKind: "triangle",
      content: createRichTextDocument("Shape"),
    }),
  ];
  for (const mode of ["hover", "selected", "multi-selected"]) {
    for (const element of elements) {
      const context = recordingContext();
      drawSceneElementOverlay(context, element, mode);
      assert.ok(context.calls.some(([method]) => method === "stroke"), `${element.kind}/${mode}`);
      if (mode === "selected" && element.kind !== "drawing") {
        assert.ok(context.calls.some(([method]) => method === "rect"), `${element.kind} exposes handles`);
      }
    }
  }
});

test("scene ordering respects z-index, status, visibility, and legacy mirror suppression", () => {
  const sourceStroke = legacyStroke("legacy");
  const legacyMirror = scene("sticky", "legacy-mirror", {
    zIndex: -5,
    legacyStrokeId: sourceStroke.id,
  });
  const hydratedMirror = scene("text", "hydrated-mirror", {
    zIndex: 4,
    legacyStrokeId: "missing-stroke",
  });
  const visible = scene("stamp", "visible", { zIndex: 2 });
  const hidden = scene("code_block", "hidden", { zIndex: 1, visible: false });
  const deleted = scene("mind_map_node", "deleted", { zIndex: 3, status: "deleted" });
  const state = boardState(
    { [legacyMirror.id]: legacyMirror, [hydratedMirror.id]: hydratedMirror, [visible.id]: visible, [hidden.id]: hidden, [deleted.id]: deleted },
    { [sourceStroke.id]: sourceStroke },
  );

  assert.deepEqual(orderSceneElementsForRender([hydratedMirror, visible]).map(({ id }) => id), ["visible", "hydrated-mirror"]);
  assert.deepEqual(sceneElementsForRender(state).map(({ id }) => id), ["visible", "hydrated-mirror"]);
  assert.deepEqual(sceneElementsForRender(state, true).map(({ id }) => id), ["visible", "deleted", "hydrated-mirror"]);
  assert.equal(findSceneElementAtPoint(state, { x: 20, y: 20 })?.id, "hydrated-mirror");
});

test("collapsed and hidden sections suppress nested members in rendering and hit testing", () => {
  const outer = scene("section", "outer", {
    zIndex: 0,
    transform: { x: 0, y: 0, width: 400, height: 300, rotation: 0 },
    collapsed: true,
    memberIds: ["nested"],
  });
  const nested = scene("section", "nested", {
    zIndex: 1,
    sectionId: outer.id,
    transform: { x: 20, y: 20, width: 240, height: 180, rotation: 0 },
    memberIds: ["child"],
  });
  const child = scene("sticky", "child", {
    zIndex: 2,
    sectionId: nested.id,
    transform: { x: 50, y: 50, width: 100, height: 100, rotation: 0 },
  });
  const state = boardState({ outer, nested, child });

  assert.deepEqual(sceneElementsForRender(state).map(({ id }) => id), ["outer"]);
  assert.equal(findSceneElementAtPoint(state, { x: 75, y: 75 })?.id, outer.id);

  outer.visible = false;
  assert.deepEqual(sceneElementsForRender(state), []);
  assert.equal(findSceneElementAtPoint(state, { x: 75, y: 75 }), null);
});

test("straight, bent, and curved connectors share route samples, labels, and hit testing", () => {
  const straight = connector("straight", "straight", []);
  const bent = connector("bent", "bent", []);
  const curved = connector("curved", "curved", [{ x: 20, y: 80 }, { x: 80, y: 80 }]);

  assert.equal(sampleSceneConnector(straight).length, 2);
  assert.equal(sampleSceneConnector(bent).length, 4);
  assert.equal(sampleSceneConnector(curved).length, 29);
  assert.deepEqual(sceneConnectorPointAt(straight, 0.5), { x: 50, y: 0 });
  const curvedMiddle = sceneConnectorPointAt(curved, 0.5);
  assert.ok(Math.abs(curvedMiddle.x - 50) < 0.001);
  assert.ok(curvedMiddle.y > 50);

  const state = boardState({ curved });
  assert.equal(findSceneElementAtPoint(state, curvedMiddle)?.id, curved.id);
  assert.equal(findSceneElementAtPoint(state, { x: 50, y: -30 }), null);
});

test("all five connector endpoint decorations have deterministic canvas geometry", () => {
  const commandStreams = new Map();
  for (const decoration of ["none", "solid_arrow", "line_arrow", "triangle", "diamond"]) {
    const element = connector(`endpoint-${decoration}`, "straight", []);
    element.start.decoration = "none";
    element.end.decoration = decoration;
    element.label = createRichTextDocument("");
    const context = recordingContext();
    drawSceneElement(context, element);
    commandStreams.set(decoration, context.calls.map(([method]) => method).join(","));
  }

  assert.notEqual(commandStreams.get("none"), commandStreams.get("line_arrow"));
  assert.notEqual(commandStreams.get("line_arrow"), commandStreams.get("solid_arrow"));
  assert.notEqual(commandStreams.get("triangle"), commandStreams.get("diamond"));
  assert.ok(commandStreams.get("solid_arrow").includes("fill"));
  assert.ok(commandStreams.get("diamond").includes("fill"));
});

test("drawing and stamp hit testing follows painted paths instead of transparent bounds", () => {
  const drawing = scene("drawing", "drawing", {
    zIndex: 2,
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    points: [{ x: 0, y: 0, t: 0 }, { x: 100, y: 100, t: 1 }],
    style: { color: "#111827", thickness: 4, opacity: 1, straight: true },
  });
  const stamp = scene("stamp", "stamp", {
    zIndex: 1,
    transform: { x: 120, y: 0, width: 80, height: 80, rotation: 0 },
  });
  const state = boardState({ drawing, stamp });

  assert.equal(findSceneElementAtPoint(state, { x: 50, y: 50 })?.id, drawing.id);
  assert.equal(findSceneElementAtPoint(state, { x: 5, y: 90 }), null);
  assert.equal(findSceneElementAtPoint(state, { x: 160, y: 40 })?.id, stamp.id);
  assert.equal(findSceneElementAtPoint(state, { x: 122, y: 2 }), null);
});

function nonShapeElements() {
  const drawing = scene("drawing", "drawing", {
    points: [{ x: 10, y: 10, t: 0 }, { x: 30, y: 40, t: 1 }, { x: 70, y: 30, t: 2 }],
    style: { color: "#ef4444", thickness: 5, opacity: 0.8, straight: false },
  });
  const sticky = scene("sticky", "sticky", {
    content: rich("Sticky"),
    creatorId: "mj",
  });
  const connectorElement = connector("connector", "curved", [{ x: 30, y: 80 }, { x: 80, y: 80 }]);
  const text = scene("text", "text", { content: rich("Standalone text") });
  const section = scene("section", "section", { title: rich("Section") });
  const table = scene("table", "table", {});
  const stamp = scene("stamp", "stamp", { emoji: "👍" });
  const media = scene("media", "media", {
    asset: { id: "asset", boardId: "board", url: "/asset", mimeType: "image/png", sizeBytes: 10 },
    altText: "Diagram",
  });
  const link = scene("link_preview", "link", {
    url: "https://example.com",
    title: "Example",
    description: "A preview",
    imageUrl: "preview",
  });
  const code = scene("code_block", "code", { code: "const answer = 42;\nreturn answer;" });
  const mind = scene("mind_map_node", "mind", { content: rich("Mind map") });
  return [drawing, sticky, connectorElement, text, section, table, stamp, media, link, code, mind];
}

function connector(id, pathKind, controlPoints) {
  return scene("connector", id, {
    pathKind,
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0 },
    start: { point: { x: 0, y: 0 }, decoration: "diamond" },
    end: { point: { x: 100, y: 0 }, decoration: "triangle" },
    controlPoints,
    label: rich("Connector"),
    labelPosition: 0.5,
    style: { color: "#4f46e5", opacity: 1, thickness: "thick", strokeStyle: "dashed", labelBackground: "matching" },
  });
}

function scene(kind, id, overrides) {
  return createBoardSceneElement({
    id,
    boardId: "board",
    kind,
    createdAt: now,
    updatedAt: now,
    transform: { x: 10, y: 10, width: 180, height: 100, rotation: 0 },
    ...overrides,
  });
}

function rich(text) {
  return {
    type: "doc",
    blocks: [
      {
        type: "paragraph",
        runs: [
          { text: text.split(" ")[0] ?? "", marks: { bold: true } },
          { text: text.includes(" ") ? ` ${text.split(" ").slice(1).join(" ")}` : "" },
        ],
      },
    ],
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

function legacyStroke(id) {
  return {
    id,
    boardId: "board",
    userId: "user",
    tool: "marker",
    color: "#111827",
    thickness: 3,
    points: [{ x: 0, y: 0, t: 0 }, { x: 20, y: 20, t: 1 }],
    createdAt: now,
    updatedAt: now,
    status: "committed",
  };
}

function recordingContext() {
  const state = {
    calls: [],
    globalAlpha: 1,
    lineWidth: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    font: "13px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    lineCap: "butt",
  };
  const methods = new Set([
    "save", "restore", "translate", "rotate", "setLineDash", "beginPath", "moveTo", "lineTo",
    "quadraticCurveTo", "bezierCurveTo", "closePath", "rect", "ellipse", "arc", "fill", "stroke",
    "fillText", "fillRect", "clip", "drawImage",
  ]);
  return new Proxy(state, {
    get(target, property) {
      if (property === "measureText") return (text) => ({ width: String(text).length * 7 });
      if (property === "createPattern") return () => null;
      if (methods.has(property)) return (...args) => target.calls.push([property, ...args.map(normalizeCallArgument)]);
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function normalizeCallArgument(value) {
  return typeof value === "object" && value !== null ? "[object]" : value;
}
