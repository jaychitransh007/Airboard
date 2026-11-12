import { expect, test } from "@playwright/test";
import { differences, readBaseline, readSceneStyles, UPDATE, writeBaseline } from "./styleContract/computedStyles";
import { mediaUse, openScene, scenes, settle } from "./styleContract/scenes";

/**
 * Style safety net, part 1: the computed-style contract.
 *
 * For each key page state (e2e/styleContract/scenes.ts) it reads the computed
 * colours, backgrounds, borders, radii, spacing, display, position, z-index
 * and visibility of a curated list of elements, and compares them with the
 * committed baseline in e2e/styleContract/computed/<scene>.json. It guards the
 * stylesheet-layer merge and the board-file split (Docs/Refactoring Plan.md):
 * either may move rules and markup, but nothing may render differently.
 *
 * The values do not depend on fonts or the operating system, so this runs
 * everywhere, CI included. To accept a deliberate styling change, rewrite the
 * baselines and review the JSON diff line by line:
 *
 *   AIRBOARD_STYLE_CONTRACT_UPDATE=1 pnpm --filter @airboard/web e2e styleContract.spec
 */

test.use(mediaUse);

for (const scene of scenes) {
  test(`computed styles: ${scene.name}`, async ({ page, context, browser }) => {
    const { target, close } = await openScene(scene, page, context, browser);
    try {
      await settle(target);
      const actual = await readSceneStyles(target, scene.elements);
      if (UPDATE) {
        writeBaseline(scene.name, actual);
        return;
      }
      const baseline = readBaseline(scene.name);
      expect(baseline, `No baseline for "${scene.name}": run with AIRBOARD_STYLE_CONTRACT_UPDATE=1 and commit it`).not.toBeNull();
      expect(differences(baseline!, actual), `Computed styles changed in "${scene.name}"`).toEqual([]);
    } finally {
      await close();
    }
  });
}
