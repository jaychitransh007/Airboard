import assert from "node:assert/strict";
import test from "node:test";
import { createInitialBoardState, richTextToPlainText } from "@airboard/core";
import { createSceneElementForTool } from "../src/features/board/sceneCreation.ts";
import {
  buildSceneMovePreview,
  rebindSceneConnector,
} from "../src/features/board/scene/sceneGeometry.ts";
import {
  buildUniformSceneMoveChanges,
  sceneElementRenamePatches,
} from "../src/features/board/scene/sceneIntentPatches.ts";
import {
  normalizeSceneReference,
  resolveSceneIntentTargetIds,
} from "../src/features/board/scene/sceneTargets.ts";

/**
 * Characterisation tests for the pure scene helpers moved out of the board
 * component (board split, phase 1): target resolution, connector rebind and
 * move changes, and rename patches.
 */

function shape(id, tool, label, point, updatedAt = "2026-11-12T10:00:00.000Z") {
  const element = createSceneElementForTool(tool, { boardId: "board", point, label });
  assert.ok(element);
  return { ...element, id, updatedAt, createdAt: updatedAt };
}

function connector(id, fromId, toId, state) {
  const from = state.elements[fromId];
  const to = state.elements[toId];
  const element = createSceneElementForTool("connector:straight", {
    boardId: "board",
    point: { x: 0, y: 0 },
    connector: {
      start: { point: { x: from.transform.x + from.transform.width, y: from.transform.y }, binding: { elementId: fromId, anchor: "auto" }, decoration: "none" },
      end: { point: { x: to.transform.x, y: to.transform.y }, binding: { elementId: toId, anchor: "auto" }, decoration: "solid_arrow" },
    },
  });
  assert.ok(element);
  return { ...element, id };
}

function board() {
  const state = createInitialBoardState("board");
  state.elements.api = shape("api", "shape:basic-square", "API", { x: 100, y: 100 }, "2026-11-12T10:00:01.000Z");
  state.elements.db = shape("db", "shape:basic-square", "Database", { x: 500, y: 100 }, "2026-11-12T10:00:02.000Z");
  state.elements.db2 = shape("db2", "shape:basic-square", "Database 2", { x: 500, y: 400 }, "2026-11-12T10:00:03.000Z");
  state.elements.link = connector("link", "api", "db", state);
  return state;
}

test("normalizeSceneReference drops articles, punctuation and case", () => {
  assert.equal(normalizeSceneReference("The  API!"), "api");
  assert.equal(normalizeSceneReference("another Dataset"), "data");
});

test("a named target resolves to the shape whose own label matches", () => {
  const state = board();
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "label", label: "database" }, []), ["db"]);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "label", label: "the API" }, []), ["api"]);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "label", label: "nothing here" }, []), []);
});

test("a hidden or deleted shape is never a named target", () => {
  const state = board();
  state.elements.api = { ...state.elements.api, visible: false };
  state.elements.db = { ...state.elements.db, status: "deleted" };
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "label", label: "api" }, []), []);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "label", label: "database" }, []), []);
});

test("the selection target keeps only active selected elements", () => {
  const state = board();
  state.elements.db2 = { ...state.elements.db2, status: "deleted" };
  assert.deepEqual(
    resolveSceneIntentTargetIds(state, { kind: "selection" }, ["api", "db2", "missing"]),
    ["api"],
  );
});

test("pronouns prefer pointing, then the selection, then the newest shape", () => {
  const state = board();
  const pointing = { point: null, startTargetId: "api", pointedIds: ["api", "db"] };
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "contextual", pronoun: "it" }, [], pointing), ["api"]);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "contextual", pronoun: "that" }, [], pointing), ["db"]);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "contextual", pronoun: "them" }, [], pointing), ["api", "db"]);
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "contextual", pronoun: "this" }, ["api", "db"]), ["db"]);
  // Nothing pointed at or selected: the most recently changed shape, never a connector.
  assert.deepEqual(resolveSceneIntentTargetIds(state, { kind: "contextual", pronoun: "it" }, []), ["db2"]);
});

test("rebinding a connector follows its bound shapes and refits its bounds", () => {
  const state = board();
  const moved = { ...state.elements, db: { ...state.elements.db, transform: { ...state.elements.db.transform, y: 500 } } };
  const rebound = rebindSceneConnector(state.elements.link, moved);
  const db = moved.db.transform;
  // The end meets the moved shape's outline (auto anchor), not its old spot.
  assert.ok(rebound.end.point.y >= db.y && rebound.end.point.y <= db.y + db.height);
  assert.ok(rebound.end.point.x >= db.x && rebound.end.point.x <= db.x + db.width);
  assert.equal(rebound.transform.rotation, 0);
  assert.ok(rebound.transform.height >= Math.abs(rebound.end.point.y - rebound.start.point.y) - 1);
  // The source is not mutated.
  assert.notDeepEqual(rebound.end.point, state.elements.link.end.point);
});

test("a move preview translates the shape and rebinds its connectors", () => {
  const state = board();
  const preview = buildSceneMovePreview(
    {
      pointerId: 1,
      inputSource: "mouse",
      elementId: "api",
      start: { x: 0, y: 0 },
      element: state.elements.api,
      relatedElements: [],
      boundConnectors: [state.elements.link],
    },
    40,
    -20,
    state.elements,
  );
  assert.equal(preview.api.transform.x, state.elements.api.transform.x + 40);
  assert.equal(preview.api.transform.y, state.elements.api.transform.y - 20);
  assert.deepEqual(preview.db, state.elements.db);
  assert.notDeepEqual(preview.link.start.point, state.elements.link.start.point);
});

test("uniform move changes move the shape and refit each bound connector", () => {
  const state = board();
  const changes = buildUniformSceneMoveChanges(state, [state.elements.api], 30, 10);
  const byId = new Map(changes.map(({ elementId, patches }) => [elementId, patches]));
  assert.deepEqual([...byId.keys()].sort(), ["api", "link"]);
  assert.deepEqual(byId.get("api").slice(0, 2), [
    { op: "field.set", path: ["transform", "x"], value: state.elements.api.transform.x + 30 },
    { op: "field.set", path: ["transform", "y"], value: state.elements.api.transform.y + 10 },
  ]);
  assert.deepEqual(
    byId.get("link").map(({ path }) => path.join(".")),
    ["transform", "start.point", "end.point", "controlPoints"],
  );
});

test("moving a shape into a section adds it to the section's members", () => {
  const state = board();
  const section = createSceneElementForTool("section", { boardId: "board", point: { x: 1200, y: 1200 } });
  state.elements.box = { ...section, id: "box", transform: { x: 1000, y: 1000, width: 800, height: 800, rotation: 0 } };
  const { x, y } = state.elements.db2.transform;
  const changes = buildUniformSceneMoveChanges(state, [state.elements.db2], 1100 - x, 1100 - y);
  const membership = changes.find(({ elementId }) => elementId === "db2").patches.at(-1);
  assert.deepEqual(membership, { op: "field.set", path: ["sectionId"], value: "box" });
  assert.deepEqual(changes.find(({ elementId }) => elementId === "box").patches, [
    { op: "field.set", path: ["memberIds"], value: [...state.elements.box.memberIds, "db2"] },
  ]);
});

test("rename patches write the field each element kind shows", () => {
  const state = board();
  const [content] = sceneElementRenamePatches(state.elements.api, "Gateway");
  assert.deepEqual(content.path, ["content"]);
  assert.equal(richTextToPlainText(content.value), "Gateway");
  const [label] = sceneElementRenamePatches(state.elements.link, "reads");
  assert.deepEqual(label.path, ["label"]);
  assert.equal(richTextToPlainText(label.value), "reads");
  const stamp = createSceneElementForTool("stamp", { boardId: "board", point: { x: 0, y: 0 } });
  assert.deepEqual(sceneElementRenamePatches(stamp, "Nice"), [{ op: "field.set", path: ["label"], value: "Nice" }]);
  const table = createSceneElementForTool("table", { boardId: "board", point: { x: 0, y: 0 } });
  const [cell] = sceneElementRenamePatches(table, "Header");
  assert.equal(cell.op, "table.cell.patched");
  assert.equal(cell.cellId, Object.values(table.cells)[0].id);
});
