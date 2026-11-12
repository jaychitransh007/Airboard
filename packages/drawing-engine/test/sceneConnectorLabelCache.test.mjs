import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { createBoardSceneElement, createRichTextDocument } from "@airboard/core";
import { findSceneElementAtPoint } from "../src/hitTest.ts";
import { drawSceneElement } from "../src/renderer.ts";
import {
  computeSceneConnectorLabelLayout,
  layoutSceneConnectorLabel,
  measureSceneConnectorLabelLine,
  sampleSceneConnector,
  sceneConnectorLabelLayoutComputations,
  sceneConnectorLabelLayoutOnBoard,
  sceneConnectorLabelObstacles,
} from "../src/sceneConnectorGeometry.ts";

function shape(id, x, y, width = 100, height = 80) {
  return createBoardSceneElement({
    id,
    boardId: "board",
    kind: "shape",
    shapeKind: "service",
    transform: { x, y, width, height, rotation: 0 },
    content: createRichTextDocument(id, `${id}:content`),
  });
}

function connector(id, start, end, label = id, pathKind = "straight") {
  return createBoardSceneElement({
    id,
    boardId: "board",
    kind: "connector",
    pathKind,
    start: { point: start, decoration: "none" },
    end: { point: end, decoration: "solid_arrow" },
    label: createRichTextDocument(label, `${id}:label`),
  });
}

function section(id, x, y, width, height) {
  return createBoardSceneElement({
    id,
    boardId: "board",
    kind: "section",
    title: id,
    transform: { x, y, width, height, rotation: 0 },
  });
}

function record(...elements) {
  return Object.fromEntries(elements.map((element) => [element.id, element]));
}

/** A canvas context that records nothing and measures 7 units a character. */
function silentContext() {
  const state = {
    globalAlpha: 1, lineWidth: 1, fillStyle: "#000", strokeStyle: "#000", font: "13px sans-serif",
    textAlign: "left", textBaseline: "alphabetic", lineJoin: "miter", lineCap: "butt",
  };
  return new Proxy(state, {
    get(target, property) {
      if (property === "measureText") return (text) => ({ width: String(text).length * 7 });
      if (property in target) return target[property];
      return () => null;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("a label is laid out once per elements record, then shared by drawing, hit testing and the scorer", () => {
  const elements = record(shape("a", 0, 0), shape("b", 300, 0), connector("ab", { x: 100, y: 40 }, { x: 300, y: 40 }, "calls"));
  const context = silentContext();
  const before = sceneConnectorLabelLayoutComputations();

  for (let frame = 0; frame < 5; frame += 1) drawSceneElement(context, elements.ab, 1, { elements });
  const layout = sceneConnectorLabelLayoutOnBoard(elements.ab, elements);
  const center = { x: layout.bounds.x + layout.bounds.width / 2, y: layout.bounds.y + layout.bounds.height / 2 };
  for (let move = 0; move < 5; move += 1) {
    assert.equal(findSceneElementAtPoint({ elements }, center)?.id, "ab");
  }
  assert.equal(sceneConnectorLabelLayoutComputations() - before, 1, "computed once for five frames and five pointer moves");
  assert.equal(sceneConnectorLabelLayoutOnBoard(elements.ab, elements), layout, "the same layout object");

  // Any change to the board gives a new elements record: the layout is computed again.
  const moved = { ...elements, b: shape("b", 260, 0) };
  drawSceneElement(context, moved.ab, 1, { elements: moved });
  assert.equal(sceneConnectorLabelLayoutComputations() - before, 2);
  drawSceneElement(context, moved.ab, 1, { elements: moved });
  assert.equal(sceneConnectorLabelLayoutComputations() - before, 2);

  // A changed connector in a record the cache already saw is not served stale.
  const relabelled = connector("ab", { x: 100, y: 40 }, { x: 300, y: 40 }, "reads from");
  const next = sceneConnectorLabelLayoutOnBoard(relabelled, moved);
  assert.deepEqual(next.lines, ["reads from"]);
  assert.equal(sceneConnectorLabelLayoutComputations() - before, 3);
});

test("the cached layout uses the label font's measured widths, the same ones everywhere", () => {
  const elements = record(connector("ab", { x: 0, y: 0 }, { x: 400, y: 0 }, "places order"));
  const layout = sceneConnectorLabelLayoutOnBoard(elements.ab, elements);
  const direct = layoutSceneConnectorLabel(elements.ab, "places order", measureSceneConnectorLabelLine);
  assert.deepEqual(layout, direct);
  assert.equal(layout.bounds.width, measureSceneConnectorLabelLine("places order") + 16);
});

test("a connector passing through the search area counts, even with no sample point in it", () => {
  // A long straight line whose two samples are both far outside the area
  // around the short connector, but which runs right across it.
  const elements = record(
    connector("short", { x: 0, y: 0 }, { x: 160, y: 0 }, "calls"),
    connector("long", { x: 80, y: -2000 }, { x: 80, y: 2000 }, "crosses"),
  );
  const obstacles = sceneConnectorLabelObstacles(elements.short, elements);
  assert.equal(obstacles.lines.length, 1);
  assert.deepEqual(obstacles.lines[0], sampleSceneConnector(elements.long));
});

test("a group frame's border is an obstacle; its inside is not", () => {
  // Web app -> API, with API inside a group whose left border runs across the gap.
  const web = shape("web", 142, 264, 144, 72);
  const api = shape("api", 374, 260, 152, 80);
  const calls = connector("calls", { x: 286, y: 300 }, { x: 374, y: 300 }, "calls", "bent");
  const frame = section("backend", 326, 204, 480, 192);
  const elements = record(web, api, calls, frame);

  const obstacles = sceneConnectorLabelObstacles(calls, elements);
  assert.equal(obstacles.shapes.some((box) => box.width === 480), false, "the frame's inside is free room");
  assert.equal(obstacles.lines.length, 0);
  assert.equal(obstacles.borders.length, 1, "the frame's border is a line to keep off");

  const layout = sceneConnectorLabelLayoutOnBoard(calls, elements);
  const borderX = 326;
  assert.ok(
    layout.bounds.x >= borderX || layout.bounds.x + layout.bounds.width <= borderX,
    `the label stays off the border: ${JSON.stringify(layout.bounds)}`,
  );
  assert.equal(overlaps(layout.bounds, { x: 142, y: 264, width: 144, height: 72 }), false, "off Web app");
  assert.equal(overlaps(layout.bounds, { x: 374, y: 260, width: 152, height: 80 }), false, "off API");
});

test("a mostly vertical bent route enters its target through the top edge", () => {
  // Paid? -> Ship Order below and to the left: the end sits on Ship Order's top edge.
  const yes = connector("yes", { x: 552.9, y: 331.5 }, { x: 489.6, y: 448 }, "yes", "bent");
  const route = sampleSceneConnector(yes);
  const last = route.at(-1);
  const beforeLast = route.at(-2);
  assert.equal(beforeLast.x, last.x, "the last segment is vertical");
  assert.ok(beforeLast.y < last.y, "and runs down into the shape");
  // A mostly horizontal one still enters through the side.
  const side = sampleSceneConnector(connector("side", { x: 100, y: 40 }, { x: 300, y: 90 }, "x", "bent"));
  assert.equal(side.at(-2).y, side.at(-1).y);
});

test("drawing 100 shapes and 100 labelled connectors: cached frames are much cheaper", (t) => {
  const elements = {};
  for (let index = 0; index < 100; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const x = column * 260;
    const y = row * 200;
    elements[`s${index}`] = shape(`s${index}`, x, y);
    const nextColumn = column === 9 ? 0 : column + 1;
    const nextRow = column === 9 ? row + 1 : row;
    if (index < 99) {
      elements[`c${index}`] = connector(
        `c${index}`,
        { x: x + 100, y: y + 40 },
        { x: nextColumn * 260, y: nextRow * 200 + 40 },
        `step ${index}`,
        "bent",
      );
    }
  }
  elements.c99 = connector("c99", { x: 50, y: 80 }, { x: 50 + 9 * 260, y: 9 * 200 }, "loops back", "bent");
  const list = Object.values(elements);
  const context = silentContext();
  const frame = (board) => {
    for (const element of list) drawSceneElement(context, element, 1, { elements: board });
  };
  const time = (run, frames) => {
    run();
    const start = performance.now();
    for (let index = 0; index < frames; index += 1) run();
    return (performance.now() - start) / frames;
  };
  // Uncached: every frame sees a new record of new objects, so nothing carries over.
  const records = Array.from({ length: 11 }, () =>
    Object.fromEntries(Object.entries(elements).map(([id, element]) => [id, structuredClone(element)])));
  let next = 0;
  const uncached = time(() => {
    const board = records[next++];
    for (const element of Object.values(board)) drawSceneElement(context, element, 1, { elements: board });
  }, 10);
  const cached = time(() => frame(elements), 10);
  t.diagnostic(`per frame: uncached ${uncached.toFixed(2)} ms, cached ${cached.toFixed(2)} ms (${(uncached / cached).toFixed(1)}x)`);
  assert.ok(cached * 2 < uncached, `cached ${cached} ms should be well under uncached ${uncached} ms`);
});

test("dragging a shape far from a connector reuses the connector's label layout", () => {
  const start = record(shape("a", 0, 0), shape("b", 300, 0), connector("ab", { x: 100, y: 40 }, { x: 300, y: 40 }, "calls"), shape("far", 2000, 0));
  const layout = sceneConnectorLabelLayoutOnBoard(start.ab, start);
  const before = sceneConnectorLabelLayoutComputations();
  let board = start;
  for (let frame = 1; frame <= 10; frame += 1) {
    board = { ...board, far: shape("far", 2000 + frame * 10, frame * 5) };
    assert.equal(sceneConnectorLabelLayoutOnBoard(board.ab, board), layout, `frame ${frame}: the same layout`);
  }
  assert.equal(sceneConnectorLabelLayoutComputations(), before, "nothing laid out again");
});

test("dragging a shape into a connector's label area lays the label out again, clear of it", () => {
  const start = record(shape("a", 0, 0), shape("b", 400, 0), connector("ab", { x: 100, y: 40 }, { x: 400, y: 40 }, "calls"), shape("box", 1500, 600, 60, 40));
  const first = sceneConnectorLabelLayoutOnBoard(start.ab, start);
  const before = sceneConnectorLabelLayoutComputations();
  // Drop the box right where the label sits.
  const center = { x: first.bounds.x + first.bounds.width / 2, y: first.bounds.y + first.bounds.height / 2 };
  const box = { x: center.x - 30, y: center.y - 20, width: 60, height: 40 };
  const moved = { ...start, box: shape("box", box.x, box.y, box.width, box.height) };
  const next = sceneConnectorLabelLayoutOnBoard(moved.ab, moved);
  assert.equal(sceneConnectorLabelLayoutComputations() - before, 1, "laid out again");
  assert.notDeepEqual(next.bounds, first.bounds, "the label moved");
  assert.equal(overlaps(next.bounds, box), false, `clear of the box: ${JSON.stringify(next.bounds)}`);
  assert.deepEqual(next, computeSceneConnectorLabelLayout(moved.ab, moved));
});

test("over a drag, every reused label layout equals a fresh one", () => {
  const elements = {};
  for (let index = 0; index < 36; index += 1) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    elements[`s${index}`] = shape(`s${index}`, column * 260, row * 200);
    if (column < 5) {
      elements[`c${index}`] = connector(`c${index}`, { x: column * 260 + 100, y: row * 200 + 40 }, { x: (column + 1) * 260, y: row * 200 + 40 }, `step ${index}`, index % 2 ? "bent" : "straight");
    }
  }
  elements.frame = section("frame", 500, 180, 600, 260);
  const connectors = Object.values(elements).filter((element) => element.kind === "connector");
  let board = elements;
  for (const element of connectors) sceneConnectorLabelLayoutOnBoard(element, board);
  const before = sceneConnectorLabelLayoutComputations();
  let fresh = 0;
  // Drag s14 diagonally across the grid, then a frame where an element is removed and one added.
  for (let frame = 1; frame <= 40; frame += 1) {
    const origin = elements.s14.transform;
    board = { ...board, s14: shape("s14", origin.x + frame * 17, origin.y + frame * 11) };
    if (frame === 20) {
      const { s30, ...rest } = board;
      board = { ...rest, extra: shape("extra", 900, 520, 120, 60) };
    }
    for (const element of connectors) {
      const cached = sceneConnectorLabelLayoutOnBoard(element, board);
      const computations = sceneConnectorLabelLayoutComputations();
      assert.deepEqual(cached, computeSceneConnectorLabelLayout(element, board), `frame ${frame}, ${element.id}`);
      fresh += sceneConnectorLabelLayoutComputations() - computations;
    }
  }
  const recomputed = sceneConnectorLabelLayoutComputations() - before - fresh;
  assert.ok(recomputed > 0, "the dragged shape's neighbours were laid out again");
  assert.ok(recomputed < connectors.length * 40 / 2, `most layouts carried over: ${recomputed} of ${connectors.length * 40} laid out again`);
});

test("dragging one shape among 100 shapes and 100 labelled connectors lays out only the labels near it", (t) => {
  const elements = {};
  for (let index = 0; index < 100; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    elements[`s${index}`] = shape(`s${index}`, column * 260, row * 200);
    const nextColumn = column === 9 ? 0 : column + 1;
    const nextRow = column === 9 ? row + 1 : row;
    if (index < 99) {
      elements[`c${index}`] = connector(`c${index}`, { x: column * 260 + 100, y: row * 200 + 40 }, { x: nextColumn * 260, y: nextRow * 200 + 40 }, `step ${index}`, "bent");
    }
  }
  elements.c99 = connector("c99", { x: 50, y: 80 }, { x: 50 + 9 * 260, y: 9 * 200 }, "loops back", "bent");
  const context = silentContext();
  let board = elements;
  const draw = () => {
    for (const element of Object.values(board)) drawSceneElement(context, element, 1, { elements: board });
  };
  draw();
  const before = sceneConnectorLabelLayoutComputations();
  const origin = elements.s55.transform;
  const start = performance.now();
  for (let frame = 1; frame <= 60; frame += 1) {
    const x = origin.x + frame * 2;
    const y = origin.y + frame;
    board = {
      ...board,
      s55: shape("s55", x, y),
      // The connectors bound to it follow it, as a drag preview rebinds them.
      c54: connector("c54", elements.c54.start.point, { x, y: y + 40 }, "step 54", "bent"),
      c55: connector("c55", { x: x + 100, y: y + 40 }, elements.c55.end.point, "step 55", "bent"),
    };
    draw();
  }
  const perFrame = (performance.now() - start) / 60;
  const laidOut = (sceneConnectorLabelLayoutComputations() - before) / 60;
  t.diagnostic(`drag: ${perFrame.toFixed(2)} ms per frame, ${laidOut.toFixed(1)} of 100 labels laid out per frame`);
  assert.ok(laidOut < 25, `only labels near the dragged shape are laid out again (${laidOut} per frame)`);
});
