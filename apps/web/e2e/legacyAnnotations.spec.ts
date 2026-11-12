import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BoardState } from "@airboard/core";
import { expect, test, type Page } from "@playwright/test";
import { boardToCanvas, canvasSize, grabAndMove, pageNow } from "./support/handLandmarks";
import { signIn } from "./support/signedInApi";
import { withHooks } from "./support/testHooks";

/**
 * Boards saved before shape-merge phase 1 hold Airo's diagrams as legacy
 * annotation strokes, and phase 1 does not convert them. This board holds
 * every legacy annotation type (the 13 diagram node types, a connector, two
 * reciprocal connectors in their own lanes, a group, a hand-drawn arrow, a
 * sticky note, a text label and a highlight), generated once from the legacy
 * fixture builder in @airboard/core (applyLegacyDiagramFixture) and the
 * legacy stroke events.
 *
 * Such a board must keep rendering exactly as before (the screenshot, whose
 * baseline was recorded on the code before phase 1) and stay editable by
 * name, by hand and with undo, all still as legacy strokes.
 *
 * The screenshot is of the board canvas only (the toolbars over it
 * included); its baseline is the canvas cut from the original full-page one.
 * Update it only for a deliberate change to how legacy strokes are drawn, and
 * review it:
 *
 *   pnpm --filter @airboard/web e2e legacyAnnotations --update-snapshots
 */

const BOARD: BoardState = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures", "legacy-annotations.board.json"), "utf8"),
);
const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const baselines = resolve(import.meta.dirname, "__screenshots__", process.platform, "legacyAnnotations.spec.ts");

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function openLegacyBoard(page: Page) {
  const api = await signIn(page, { boards: [{ title: "Legacy annotations", state: BOARD }] });
  await page.goto(`/app/boards/${api.boardId("Legacy annotations")}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  return api;
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

const liveState = (page: Page) => withHooks(page, (hooks) => hooks.getCanonicalBoardState());

/** Legacy strokes on the board, by label, and how many v2 objects there are of their own. */
async function legacyView(page: Page) {
  const state = await liveState(page);
  const strokes = Object.values(state.strokes).filter((stroke) => stroke.status === "committed" && stroke.annotation);
  return {
    strokeCount: strokes.length,
    labels: Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke.annotation?.label ?? null])),
    bounds: Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke.annotation?.bounds ?? null])),
    ownV2Objects: Object.values(state.elements).filter(
      (element) => element.status === "active" && !element.legacyStrokeId && !state.strokes[element.id],
    ).length,
  };
}

test("a legacy board stays legacy and editable by name, by hand and with undo", async ({ page }) => {
  const api = await openLegacyBoard(page);
  const start = await legacyView(page);
  expect(start.strokeCount).toBe(21);
  expect(start.ownV2Objects).toBe(0);

  // By name, through the typed grammar: the stroke's own label changes.
  await run(page, "rename Service to Orders Service");
  await expect.poll(async () => (await legacyView(page)).labels["node:service"]).toBe("Orders Service");

  // By hand: grab the terminator and move it; it stays a stroke.
  const canvas = await canvasSize(page);
  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  const terminator = summary.positions[summary.labels.indexOf("Terminator")]!;
  const from = await boardToCanvas(page, terminator);
  await grabAndMove(page, canvas, from, { x: from.x, y: from.y + 120 }, await pageNow(page));
  await expect
    .poll(async () => (await legacyView(page)).bounds["node:terminator"]?.y)
    .toBeGreaterThan(start.bounds["node:terminator"]!.y + 40);

  const edited = await legacyView(page);
  expect(edited.strokeCount).toBe(21);
  expect(edited.ownV2Objects).toBe(0);
  // Both edits were saved, still as legacy strokes.
  await expect
    .poll(() => {
      const saved = api.saves.at(-1)?.state as BoardState | undefined;
      return saved ? [saved.strokes["node:service"]?.annotation?.label, Object.keys(saved.strokes).length] : null;
    })
    .toEqual(["Orders Service", 21]);

  // Undo takes back the move, then the rename.
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await legacyView(page)).bounds["node:terminator"]).toEqual(start.bounds["node:terminator"]);
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await legacyView(page)).labels["node:service"]).toBe("Service");
  expect(await legacyView(page)).toEqual(start);
});

test("screenshot: a legacy board renders as it did before shape-merge phase 1", async ({ page }, testInfo) => {
  const updating = testInfo.config.updateSnapshots === "all" || testInfo.config.updateSnapshots === "changed";
  test.skip(!updating && !existsSync(baselines), `No ${process.platform} screenshot baseline is committed`);
  await openLegacyBoard(page);
  await run(page, "zoom to fit");
  await page.getByRole("button", { name: "Hide Airo panel" }).click();
  // The picture is of the board itself, not the page: the board's workspace
  // can sit a few pixels higher or lower depending on when the panel closes
  // (its screen-reader text overflows it by 7px, and hiding the panel may
  // scroll it), which under a busy parallel run moved the whole board.
  const board = page.locator(".board-canvas");
  await waitForStableBox(board);
  await expect(board).toHaveScreenshot("legacy-annotations.png", {
    // The undo notice and the dev badge are not part of the board.
    mask: [page.locator(".undo-toast"), page.locator("nextjs-portal")],
  });
});

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
