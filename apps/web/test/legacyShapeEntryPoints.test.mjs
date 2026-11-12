import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guards for shape-merge phases 0 and 1: nothing in the product may make a
 * new legacy annotation stroke. Old boards keep theirs (and stay editable),
 * but every new object is a v2 scene element.
 *
 * Phase 0 deleted three entry points that were dead in practice (no dock tile
 * carried a "tool:" id, so nothing reached them): placementToolFromDockTarget,
 * commitPlacementObject and createCommittedAnnotation. Phase 1 made the
 * diagram planner draw v2 shapes and connectors; the legacy node and
 * connector builders survive only as applyLegacyDiagramFixture, which tests
 * and evals use to build boards saved before then.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCE_DIRS = ["apps/web/src", "apps/api/src", "packages/core/src", "packages/drawing-engine/src", "packages/gesture-engine/src", "packages/realtime-client/src"];

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

test("the deleted legacy placement entry points stay deleted", () => {
  for (const name of ["placementToolFromDockTarget", "commitPlacementObject", "createCommittedAnnotation"]) {
    const users = files.filter((file) => new RegExp(`\\b${name}\\b`).test(file.text)).map((file) => file.path);
    assert.deepEqual(users, [], `${name} is back in ${users.join(", ")}`);
  }
});

test("no dock or toolbar target is a legacy \"tool:\" id", () => {
  // placementToolFromDockTarget read "tool:<placement tool>" dock ids; none exist.
  const users = files
    .filter((file) => /(?:targetId|id)\s*[:=]\s*[`"']tool:/.test(file.text))
    .map((file) => file.path);
  assert.deepEqual(users, []);
});

test("only tests and evals build legacy strokes: the product never calls applyLegacyDiagramFixture", () => {
  const users = files
    .filter((file) => /\bapplyLegacyDiagramFixture\b/.test(file.text))
    .map((file) => file.path)
    .filter((path) => path !== "packages/core/src/diagramCommands.ts");
  assert.deepEqual(users, []);
});

test("the board component starts no legacy stroke outside the local freehand preview", () => {
  // The only createStroke in the component is the in-flight preview of a v2
  // drawing (activeStrokes, never committed as a stroke).
  const component = files.find((file) => file.path.endsWith("features/board/AirboardPrototype.tsx"));
  assert.ok(component);
  assert.doesNotMatch(component.text, /type:\s*"stroke\.(started|committed)"/);
  const calls = component.text.match(/\bcreateStroke\(/g) ?? [];
  assert.equal(calls.length, 1, "one createStroke: the v2 drawing preview");
});
