import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { mediaUse, openScene, scene, settle } from "./styleContract/scenes";

/**
 * Style safety net, part 2: screenshots of the most visual states, for what
 * the computed-style contract (styleContract.spec.ts) cannot see, such as
 * layout, wrapping and stacking. Thresholds are tolerant (playwright.config.ts)
 * and live content is held still or masked: the fake camera shows a still
 * grey picture, the Next.js dev badge is removed, and the landing page's typing
 * demo and relative dates are masked.
 *
 * Baselines are per platform (e2e/__screenshots__/<platform>/), because text
 * renders differently on macOS and Linux. Today only macOS baselines are
 * committed, so the spec runs on a developer's Mac and is skipped on Linux CI;
 * the computed-style contract, which does not depend on fonts, runs
 * everywhere. To add Linux baselines later, generate them in the
 * mcr.microsoft.com/playwright image matching @playwright/test and commit the
 * linux folder; the spec then runs on CI as well.
 *
 * Update after a deliberate visual change, and review every image one by one:
 *
 *   pnpm --filter @airboard/web e2e styleContract.screenshots --update-snapshots
 */

const SHOTS = [
  "landing",
  "home-boards",
  "settings",
  "help-article",
  "board-airo-shown",
  "board-share-menu",
  "board-shape-selected",
  "live-guest",
  "board-phone",
] as const;

const baselines = resolve(import.meta.dirname, "__screenshots__", process.platform, "styleContract.screenshots.spec.ts");

test.use(mediaUse);

test.beforeEach(({}, testInfo) => {
  const updating = testInfo.config.updateSnapshots === "all" || testInfo.config.updateSnapshots === "changed";
  test.skip(!updating && !existsSync(baselines), `No ${process.platform} screenshot baselines are committed`);
});

for (const name of SHOTS) {
  test(`screenshot: ${name}`, async ({ page, context, browser }) => {
    const current = scene(name);
    const { target, close } = await openScene(current, page, context, browser);
    try {
      await settle(target);
      await expect(target).toHaveScreenshot(`${name}.png`, { mask: current.mask?.(target) ?? [] });
    } finally {
      await close();
    }
  });
}
