import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/signedInApi";

/**
 * Renders saved board states to PNGs, for reviewing a data migration by eye
 * (shape-merge phase 2: the before/after JSON that
 * scripts/convert-legacy-boards.mjs --dry-run writes per board). Opt-in: it
 * runs only when AIRBOARD_RENDER_STATES names a folder of *.json files, each
 * a board's latest_state (or a backup row with a latest_state field). Each
 * file opens as a saved board in the signed-in app, zooms to fit, hides the
 * Airo panel and saves the board canvas as <name>.png in AIRBOARD_RENDER_OUT
 * (default: <folder>/png).
 *
 *   AIRBOARD_RENDER_STATES=/path/to/json AIRBOARD_RENDER_OUT=/path/to/png \
 *     pnpm --filter @airboard/web e2e renderBoardStates --workers=1
 *
 * Nothing is compared or saved back; the pictures are for a person to look at.
 *
 * Since shape-merge phase 3 the app has no legacy model: a before-state that
 * still holds strokes renders through upgradeLegacyBoardState, the convert-
 * on-open step, so it shows the converted board, not the old drawing.
 */

const SOURCE = process.env.AIRBOARD_RENDER_STATES ? resolve(process.env.AIRBOARD_RENDER_STATES) : null;
const OUT = SOURCE ? resolve(process.env.AIRBOARD_RENDER_OUT ?? join(SOURCE, "png")) : null;
const FILES = SOURCE
  ? readdirSync(SOURCE).filter((name) => name.endsWith(".json")).sort()
  : [];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

if (!SOURCE) {
  test("render board states (set AIRBOARD_RENDER_STATES to run)", () => {
    test.skip(true, "AIRBOARD_RENDER_STATES is not set");
  });
}

for (const file of FILES) {
  test(`render ${file}`, async ({ page }) => {
    const raw = JSON.parse(readFileSync(join(SOURCE!, file), "utf8")) as Record<string, unknown>;
    const state = raw && typeof raw === "object" && "latest_state" in raw ? raw.latest_state : raw;
    const title = basename(file, ".json").slice(0, 200) || "Board";
    const api = await signIn(page, { boards: [{ title, state }] });
    await page.goto(`/app/boards/${api.boardId(title)}`);
    await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
    await run(page, "zoom to fit");
    await page.getByRole("button", { name: "Hide Airo panel" }).click();
    const board = page.locator(".board-canvas");
    await waitForStableBox(board);
    // Let the last frame paint after the zoom settles.
    await page.waitForTimeout(500);
    mkdirSync(OUT!, { recursive: true });
    await board.screenshot({
      path: join(OUT!, `${basename(file, ".json")}.png`),
      animations: "disabled",
      caret: "hide",
      mask: [page.locator(".undo-toast"), page.locator("nextjs-portal")],
    });
  });
}

async function run(page: Page, command: string) {
  // The command box can take the text before the page is ready to act on
  // it; try again until the command is applied.
  await expect(async () => {
    await page.getByTestId("intent-command-input").fill(command);
    await page.getByTestId("intent-primary-action").click();
    await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
}

/** Waits until the element has kept the same box across two checks. */
async function waitForStableBox(locator: ReturnType<Page["locator"]>) {
  let last = "";
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await locator.boundingBox());
        const stable = box !== "null" && box === last;
        last = box;
        return stable;
      },
      { intervals: [250], timeout: 10_000 },
    )
    .toBe(true);
}
