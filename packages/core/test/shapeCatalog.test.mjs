import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCED_SHAPE_CATALOG,
  AIRBOARD_SHAPE_CATALOG,
  BASIC_SHAPE_CATALOG,
  BOARD_SHAPE_CATALOG,
  FIGJAM_SHAPE_CATALOG,
  FLOWCHART_SHAPE_CATALOG,
  canonicalShapeKind,
  defaultCommandShapeLabel,
  shapeCatalogEntry,
} from "../src/shapeCatalog.ts";

test("command-created shapes get readable default names", () => {
  assert.equal(defaultCommandShapeLabel("api", "api"), "API");
  assert.equal(defaultCommandShapeLabel("user", "person"), "Person");
  assert.equal(defaultCommandShapeLabel("queue", "event bus"), "Event Bus");
  assert.equal(defaultCommandShapeLabel("database", "db"), "Database");
  assert.equal(defaultCommandShapeLabel("terminator", "end"), "End");
  assert.equal(defaultCommandShapeLabel("terminator", "start"), "Start");
  assert.equal(defaultCommandShapeLabel("diamond", "decision"), "Decision");
  assert.equal(defaultCommandShapeLabel("diamond", "diamond"), null);
  assert.equal(defaultCommandShapeLabel("ellipse", "circle"), null);
  assert.equal(defaultCommandShapeLabel("cylinder", "cylinder"), null);
});

test("catalog preserves the documented 14/16/26 FigJam grouping and Airboard extras", () => {
  assert.equal(BASIC_SHAPE_CATALOG.length, 14);
  assert.equal(FLOWCHART_SHAPE_CATALOG.length, 16);
  assert.equal(ADVANCED_SHAPE_CATALOG.length, 26);
  assert.equal(FIGJAM_SHAPE_CATALOG.length, 56);
  assert.equal(AIRBOARD_SHAPE_CATALOG.length, 4);
  assert.equal(BOARD_SHAPE_CATALOG.length, 60);

  const files = FIGJAM_SHAPE_CATALOG.filter(({ kind }) => kind === "file");
  assert.deepEqual(files.map(({ category }) => category), ["flowchart", "advanced"]);
  assert.equal(files[0].id, "flowchart-file");
  assert.equal(files[1].id, "file");
});

test("legacy and spoken aliases resolve to canonical shape kinds", () => {
  assert.equal(canonicalShapeKind("Box"), "square");
  assert.equal(canonicalShapeKind("circle"), "ellipse");
  assert.equal(canonicalShapeKind("decision"), "diamond");
  assert.equal(canonicalShapeKind("input/output"), "right-parallelogram");
  assert.equal(canonicalShapeKind("start-end"), "terminator");
  assert.equal(canonicalShapeKind("message_queue"), "queue");
  assert.equal(canonicalShapeKind("not a shape"), null);
});

test("preferred category disambiguates shared catalog kinds", () => {
  assert.equal(shapeCatalogEntry("file", "flowchart").id, "flowchart-file");
  assert.equal(shapeCatalogEntry("file", "advanced").id, "file");
});
