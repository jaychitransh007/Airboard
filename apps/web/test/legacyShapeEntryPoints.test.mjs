import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guards for the shape merge. Phases 0 and 1 stopped the product making new
 * legacy annotation strokes; phase 2 converted every saved board; phase 3
 * deleted the legacy path. Only two modules may still know the legacy model:
 * the conversion (packages/core/src/legacyStrokeMigration.ts, which also
 * replays stored legacy events and converts old boards on open) and the API
 * validator that refuses new legacy events (apps/api/src/boardEventValidation.ts).
 *
 * Phase 0 deleted three entry points that were dead in practice (no dock tile
 * carried a "tool:" id, so nothing reached them): placementToolFromDockTarget,
 * commitPlacementObject and createCommittedAnnotation.
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

const MIGRATION = "packages/core/src/legacyStrokeMigration.ts";
const VALIDATOR = "apps/api/src/boardEventValidation.ts";

test("only the conversion and the API validator name the retired legacy events", () => {
  const retired = /\bstroke\.(?:started|point_added|committed|label_updated|annotation_updated|deleted|restored)\b|\berase\.committed\b/;
  const users = files
    .filter((file) => retired.test(file.text))
    .map((file) => file.path)
    .filter((path) => path !== MIGRATION && path !== VALIDATOR);
  assert.deepEqual(users, []);
});

test("no product source outside the conversion knows a scene element's legacy stroke", () => {
  const users = files
    .filter((file) => /\blegacyStrokeId\b/.test(file.text))
    .map((file) => file.path)
    .filter((path) => path !== MIGRATION);
  assert.deepEqual(users, []);
});

test("the deleted legacy bridges stay deleted", () => {
  for (const name of [
    "applyLegacyDiagramFixture",
    "isSceneOnlyElement",
    "gestureTargetWorld",
    "splitByWorld",
    "sceneOnlyNodes",
    "pointedLegacyStrokeIds",
    "MIXED_GROUP_MESSAGE",
    "upgradeBoardStateToSceneVersion",
    "findAnnotationObjectAtPoint",
    "drawAnnotationStroke",
    "createObjectFromPlacement",
  ]) {
    const users = files.filter((file) => new RegExp(`\\b${name}\\b`).test(file.text)).map((file) => file.path);
    assert.deepEqual(users, [], `${name} is back in ${users.join(", ")}`);
  }
});

test("the board component starts no stroke outside the local freehand preview", () => {
  // The only createStroke in the component is the in-flight preview of a v2
  // drawing (activeStrokes, never committed as a stroke).
  const component = files.find((file) => file.path.endsWith("features/board/AirboardPrototype.tsx"));
  assert.ok(component);
  const calls = component.text.match(/\bcreateStroke\(/g) ?? [];
  assert.equal(calls.length, 1, "one createStroke: the v2 drawing preview");
});
