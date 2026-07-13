import { expect, test } from "@playwright/test";

/**
 * E2E path (a): the typed command flow, end to end through parse → ground →
 * commit → render state. This is the integration test that would have caught
 * every orchestration regression of the last weeks.
 */

test("typing a command creates and edits objects instantly", async ({ page }) => {
  await page.goto("/");

  const input = page.getByTestId("intent-command-input");
  await expect(input).toBeVisible();

  // Create.
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  await expect(page.locator(".intent-confidence")).toContainText("1 selected");
  // Instant-commit feedback layer: the undo toast appears.
  await expect(page.getByTestId("action-toast")).toBeVisible();

  // Edit the selected object by typed command (no confirmation anywhere).
  await input.fill("rename selected to Payments");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");

  const summary = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): unknown } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(summary).toMatchObject({ objectCount: 1, labels: ["Payments"] });

  // Undo from the toast reverts the rename.
  await input.fill("delete selected");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Delete");
  await page.getByTestId("action-toast").getByRole("button", { name: "Undo" }).click();
  const restored = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): { objectCount: number } } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(restored.objectCount).toBe(1);
});
