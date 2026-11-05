import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the board keeps out of the way. The top bar is Share plus one
 * menu, the selected element's toolbar is compact and floats beside it, Airo
 * shrinks to a strip while it listens, and zoom lives in the tool dock.
 */

// A fake camera and microphone, so Airo stays on instead of failing to start.
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["camera", "microphone"],
});

async function openBoard(page: Page) {
  await page.goto("/?testStandalone=1");
  const onboarding = page.getByRole("button", { name: "Start building" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __airboardTestHooks: { getBoardSummary(): { boardSessionId: string | null } };
              }
            ).__airboardTestHooks.getBoardSummary().boardSessionId !== null,
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
  const target = { x: canvasBox.width * 0.4, y: canvasBox.height * 0.55 };
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

test("Airo shrinks to a strip while it listens and expands on request", async ({ page }) => {
  await openBoard(page);
  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot.getByTestId("copilot-activity")).toBeVisible();

  await copilot.getByRole("button", { name: "Enable Airo voice and hand tracking" }).click();
  await expect(copilot).toHaveClass(/canvas-copilot-slim/, { timeout: 30_000 });
  await expect(copilot.getByTestId("copilot-activity")).toHaveCount(0);
  // Typing still works from the strip.
  await expect(page.getByTestId("intent-command-input")).toBeVisible();
  const slimBox = (await copilot.boundingBox())!;
  expect(slimBox.height).toBeLessThan(260);

  await copilot.getByRole("button", { name: "Expand Airo panel" }).click();
  await expect(copilot.getByTestId("copilot-activity")).toBeVisible();
  await copilot.getByRole("button", { name: "Shrink Airo panel" }).click();
  await expect(copilot.getByTestId("copilot-activity")).toHaveCount(0);

  const turnOff = copilot.getByRole("button", { name: "Turn off Airo voice and hand tracking" });
  await expect(turnOff).toBeEnabled({ timeout: 30_000 });
  await turnOff.click();
  await expect(copilot).not.toHaveClass(/canvas-copilot-slim/);
  await expect(copilot.getByTestId("copilot-activity")).toBeVisible();
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
