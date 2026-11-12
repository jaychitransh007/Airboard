import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardDiagramGraph,
  convertLegacyBoardState,
  type BoardState,
  type LegacyBoardStateInput,
} from "@airboard/core";
import { expect, test, type Page } from "@playwright/test";
import { boardToCanvas, canvasSize, grabAndMove, pageNow } from "./support/handLandmarks";
import { signIn } from "./support/signedInApi";
import { withHooks } from "./support/testHooks";

/**
 * A saved board from before the shape merge converts on open.
 *
 * Boards saved before shape-merge phase 1 held Airo's diagrams as legacy
 * annotation strokes. Phase 2 converted every such production board; since
 * phase 3 the app has no legacy model at all, and a board that still holds
 * strokes (a restore from an older backup, say) is converted as it is read,
 * with the same conversion the one-off script used. This board holds every
 * legacy annotation type (the 13 diagram node types, a connector, two
 * reciprocal connectors, a group, a hand-drawn arrow, a sticky note, a text
 * label and a highlight); it is the frozen fixture the core conversion tests
 * use.
 *
 * Opening it must show exactly the converted board, save nothing until it is
 * edited, and then save it without strokes. It stays editable by name, by
 * hand and with undo, now as v2 objects.
 *
 * The screenshot is of the board canvas only (the toolbars over it
 * included). Its baseline is recorded after phase 3 and is for owner review;
 * update it only for a deliberate change to how these shapes are drawn:
 *
 *   pnpm --filter @airboard/web e2e legacyAnnotations --update-snapshots
 */

const BOARD = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "packages", "core", "test", "fixtures", "legacy-annotations.board.json"),
    "utf8",
  ),
) as LegacyBoardStateInput;
const CONVERTED = convertLegacyBoardState(BOARD).state;
const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const baselines = resolve(import.meta.dirname, "__screenshots__", process.platform, "legacyAnnotations.spec.ts");

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function openSavedLegacyBoard(page: Page) {
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

function plain(document: unknown): string {
  const blocks = (document as { blocks?: Array<{ runs: Array<{ text: string }> }> } | undefined)?.blocks ?? [];
  return blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n");
}

/** Active v2 objects on the board: their labels and boxes, by id. */
async function sceneView(page: Page) {
  const state = await liveState(page);
  const active = Object.values(state.elements).filter((element) => element.status === "active");
  return {
    count: active.length,
    labels: Object.fromEntries(
      active.map((element) => [element.id, plain((element as { content?: unknown }).content)]),
    ),
    boxes: Object.fromEntries(
      active.map((element) => {
        const { x, y, width, height } = element.transform;
        return [element.id, { x, y, width, height }];
      }),
    ),
  };
}

test("a saved legacy board converts on open, saves only after an edit, and stays editable", async ({ page }) => {
  const api = await openSavedLegacyBoard(page);

  // The board in the page is exactly the conversion: no strokes, no mirrors.
  const opened = await liveState(page);
  expect("strokes" in opened).toBe(false);
  expect(Object.keys(opened.elements).sort()).toEqual(Object.keys(CONVERTED.elements).sort());
  // The conversion is deterministic, so the elements are exactly the ones it makes.
  expect(opened.elements).toEqual(CONVERTED.elements);
  expect(boardDiagramGraph(opened as BoardState)).toEqual(boardDiagramGraph(CONVERTED));

  // Opening writes nothing: the converted board compares equal to what is stored.
  await page.waitForTimeout(2_000);
  expect(api.saves).toHaveLength(0);

  const start = await sceneView(page);
  expect(start.count).toBe(Object.values(CONVERTED.elements).filter((element) => element.status === "active").length);

  // By name, through the typed grammar.
  await run(page, "rename Service to Orders Service");
  await expect.poll(async () => (await sceneView(page)).labels["node:service"]).toBe("Orders Service");

  // By hand: grab the terminator and move it.
  const canvas = await canvasSize(page);
  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  const terminator = summary.positions[summary.labels.indexOf("Terminator")]!;
  const from = await boardToCanvas(page, terminator);
  await grabAndMove(page, canvas, from, { x: from.x, y: from.y + 120 }, await pageNow(page));
  await expect
    .poll(async () => (await sceneView(page)).boxes["node:terminator"]?.y)
    .toBeGreaterThan(start.boxes["node:terminator"]!.y + 40);
  expect((await sceneView(page)).count).toBe(start.count);

  // Both edits were saved, in the v2 model and without a strokes key.
  await expect
    .poll(() => {
      const saved = api.saves.at(-1)?.state as Record<string, unknown> | undefined;
      if (!saved) return null;
      const elements = saved.elements as BoardState["elements"];
      return ["strokes" in saved, plain((elements["node:service"] as { content?: unknown }).content)];
    })
    .toEqual([false, "Orders Service"]);

  // Undo takes back the move, then the rename.
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await sceneView(page)).boxes["node:terminator"]).toEqual(start.boxes["node:terminator"]);
  await page.keyboard.press(UNDO);
  await expect.poll(async () => (await sceneView(page)).labels["node:service"]).toBe("Service");
  expect(await sceneView(page)).toEqual(start);
});

test("screenshot: a saved legacy board, converted on open", async ({ page }, testInfo) => {
  const updating = testInfo.config.updateSnapshots === "all" || testInfo.config.updateSnapshots === "changed";
  test.skip(!updating && !existsSync(baselines), `No ${process.platform} screenshot baseline is committed`);
  await openSavedLegacyBoard(page);
  await run(page, "zoom to fit");
  await page.getByRole("button", { name: "Hide Airo panel" }).click();
  // The picture is of the board itself, not the page: the board's workspace
  // can sit a few pixels higher or lower depending on when the panel closes
  // (its screen-reader text overflows it by 7px, and hiding the panel may
  // scroll it), which under a busy parallel run moved the whole board.
  const board = page.locator(".board-canvas");
  await waitForStableBox(board);
  await expect(board).toHaveScreenshot("legacy-board-converted.png", {
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
