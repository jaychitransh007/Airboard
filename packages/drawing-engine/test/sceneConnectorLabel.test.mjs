import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateSceneConnectorLabelWidth,
  layoutSceneConnectorLabel,
} from "../src/sceneConnectorGeometry.ts";

// Two 100x80 shapes side by side, the arrow running between their outlines.
function between(gap) {
  const left = { x: 0, y: 0, width: 100, height: 80 };
  const right = { x: 100 + gap, y: 0, width: 100, height: 80 };
  const connector = {
    pathKind: "bent",
    start: { point: { x: 100, y: 40 }, decoration: "none" },
    end: { point: { x: 100 + gap, y: 40 }, decoration: "solid_arrow" },
    controlPoints: [],
    labelPosition: 0.5,
  };
  return { left, right, connector };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("a label that fits sits on the line, centred between the two outlines", () => {
  const { left, right, connector } = between(160);
  const layout = layoutSceneConnectorLabel(connector, "places order", estimateSceneConnectorLabelWidth, { shapes: [left, right], lines: [] });
  assert.equal(layout.placement, "on_line");
  assert.deepEqual(layout.lines, ["places order"]);
  assert.equal(layout.bounds.x + layout.bounds.width / 2, 180, "centred between the outlines, not the centres");
  assert.equal(layout.bounds.y + layout.bounds.height / 2, 40);
  assert.ok(layout.bounds.x >= 100 + 6 && layout.bounds.x + layout.bounds.width <= 260 - 6, "clear of both shapes");
});

test("a label too wide for the gap moves just above the line, wrapped to the gap", () => {
  const { left, right, connector } = between(88);
  const layout = layoutSceneConnectorLabel(connector, "places order", estimateSceneConnectorLabelWidth, { shapes: [left, right], lines: [] });
  assert.equal(layout.placement, "beside_line");
  assert.deepEqual(layout.lines, ["places", "order"]);
  assert.ok(layout.bounds.y + layout.bounds.height <= 40 - 4, "above the line");
  assert.ok(!overlaps(layout.bounds, left) && !overlaps(layout.bounds, right), "touches neither shape");
});

test("a label on the line leaves the arrowhead and a run of line showing on each side", () => {
  // 88 is Airo's gap between auto-placed shapes: even a short label goes above.
  assert.equal(layoutSceneConnectorLabel(between(88).connector, "calls", estimateSceneConnectorLabelWidth).placement, "beside_line");
  const { connector } = between(120);
  const layout = layoutSceneConnectorLabel(connector, "calls", estimateSceneConnectorLabelWidth);
  assert.equal(layout.placement, "on_line");
  assert.ok(layout.bounds.x - 100 >= 22 && 220 - (layout.bounds.x + layout.bounds.width) >= 22);
});

test("a label keeps off a neighbouring lane's line", () => {
  // A vertical arrow with a second lane 40 to its right: the label goes left.
  const connector = {
    pathKind: "straight",
    start: { point: { x: 100, y: 0 }, decoration: "none" },
    end: { point: { x: 100, y: 200 }, decoration: "solid_arrow" },
    controlPoints: [],
    labelPosition: 0.5,
  };
  const lane = [{ x: 140, y: 0 }, { x: 140, y: 200 }];
  const layout = layoutSceneConnectorLabel(connector, "request", estimateSceneConnectorLabelWidth, { shapes: [], lines: [lane] });
  assert.equal(layout.placement, "beside_line");
  assert.ok(layout.bounds.x + layout.bounds.width <= 100, "to the left of its own line");
});

test("an empty label has no box", () => {
  const { connector } = between(88);
  assert.equal(layoutSceneConnectorLabel(connector, "  ", estimateSceneConnectorLabelWidth), null);
});
