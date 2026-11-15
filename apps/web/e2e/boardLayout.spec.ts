import { expect, test, type Page } from "@playwright/test";
import { waitForTestHooks, type AirboardTestWindow } from "./support/testHooks";
import { launchOptionsWith } from "./support/launchOptions";

/**
 * E2E path: the board keeps out of the way. The top bar is Share plus one
 * menu, the selected element's toolbar is compact and floats beside it, Airo
 * shrinks to a strip while it listens, and zoom lives in the tool dock.
 */

// A fake camera and microphone, so Airo stays on instead of failing to start.
test.use({
  launchOptions: launchOptionsWith(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]),
  permissions: ["camera", "microphone"],
});

async function openBoard(page: Page) {
  await page.goto("/?testStandalone=1");
  const onboarding = page.getByRole("button", { name: "Got it" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  await waitForTestHooks(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as AirboardTestWindow).__airboardTestHooks.getBoardSummary()
              .boardSessionId !== null,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("a selected shape gets a compact toolbar beside it, with every field behind More", async ({ page }) => {
  await openBoard(page);
  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = (await canvas.boundingBox())!;
  const dock = page.getByRole("toolbar", { name: "Board creation tools" });
  await dock.getByRole("button", { name: "Shape", exact: true }).click();
  // Clear of the open shape menu above the dock.
  const target = { x: canvasBox.width * 0.4, y: canvasBox.height * 0.4 };
  await page
    .getByRole("menu", { name: "Recent shapes and connectors" })
    .getByRole("menuitem", { name: "Square", exact: true })
    .dragTo(canvas, { targetPosition: target });

  const toolbar = page.getByRole("complementary", { name: "Shape properties" });
  await expect(toolbar).toBeVisible();
  // Compact: colours as swatches, order, duplicate, delete and More.
  await expect(toolbar.getByLabel("Fill color")).toBeVisible();
  await expect(toolbar.getByLabel("Stroke color")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Bring forward" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Delete element" })).toBeVisible();
  await expect(toolbar.getByLabel("Element width")).toHaveCount(0);
  await expect(toolbar.getByLabel("Rotation in degrees")).toHaveCount(0);

  // It floats beside the shape, not across the top of the board.
  const box = (await toolbar.boundingBox())!;
  expect(box.width).toBeLessThan(420);
  expect(Math.abs(box.x + box.width / 2 - (canvasBox.x + target.x))).toBeLessThan(40);
  expect(box.y + box.height).toBeLessThan(canvasBox.y + target.y);

  // More shows every field; Less goes back.
  await toolbar.getByRole("button", { name: "More shape options" }).click();
  await expect(toolbar.getByLabel("Element width")).toBeVisible();
  await expect(toolbar.getByLabel("Shape outline", { exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "Fewer shape options" }).click();
  await expect(toolbar.getByLabel("Element width")).toHaveCount(0);
});

test("Airo starts hidden on the right and is shown or hidden, never shrunk", async ({ page }) => {
  // A first visit: no saved choice (the suite otherwise opens the panel).
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("first-visit-done")) return;
    window.sessionStorage.setItem("first-visit-done", "1");
    window.localStorage.removeItem("airboard.copilot.v2");
  });
  await openBoard(page);
  const show = page.getByTestId("canvas-copilot-toggle");
  await expect(show).toBeVisible();
  await expect(page.getByTestId("canvas-copilot")).toHaveCount(0);
  // The toggle sits at the right edge of the board.
  const board = (await page.locator("canvas.board-canvas").boundingBox())!;
  const toggleBox = (await show.boundingBox())!;
  expect(toggleBox.x + toggleBox.width).toBeGreaterThan(board.x + board.width - 80);

  await show.click();
  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot.getByTestId("copilot-activity")).toBeVisible();
  await expect(copilot.getByRole("button", { name: /Expand|Shrink/ })).toHaveCount(0);
  await expect(page.getByTestId("intent-command-input")).toBeVisible();

  await copilot.getByRole("button", { name: "Hide Airo panel" }).click();
  await expect(page.getByTestId("canvas-copilot")).toHaveCount(0);
  // The choice is kept for the next board.
  await show.click();
  await page.reload();
  await expect(page.getByTestId("canvas-copilot")).toBeVisible();
});

test("zoom lives at the end of the tool dock", async ({ page }) => {
  await openBoard(page);
  const zoom = page
    .getByRole("toolbar", { name: "Board creation tools" })
    .getByRole("group", { name: "Canvas zoom controls" });
  await expect(zoom.getByRole("button", { name: "Reset canvas zoom" })).toHaveText("100%");
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom.getByRole("button", { name: "Reset canvas zoom" })).toHaveText("125%");
  await zoom.getByRole("button", { name: "Reset canvas zoom" }).click();
  await expect(zoom.getByRole("button", { name: "Reset canvas zoom" })).toHaveText("100%");
});

test("on a phone the element toolbar is one full-width bar under the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await openBoard(page);
  // On a phone the Airo panel covers the canvas; close it to reach the dock.
  const hideAiro = page.getByRole("button", { name: "Hide Airo panel" });
  if (await hideAiro.isVisible()) await hideAiro.click();
  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = (await canvas.boundingBox())!;
  await page.getByRole("toolbar", { name: "Board creation tools" }).getByRole("button", { name: /^Section/ }).click();
  await canvas.click({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.5 } });

  const toolbar = page.getByRole("complementary", { name: "Section properties" });
  await expect(toolbar).toBeVisible();
  const box = (await toolbar.boundingBox())!;
  expect(Math.round(box.x)).toBe(8);
  expect(Math.round(box.width)).toBe(375 - 16);
  expect(Math.round(box.y)).toBe(64);
});
