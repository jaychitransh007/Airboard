import { expect, test } from "@playwright/test";

/**
 * E2E path (a): the typed command flow, end to end through parse → ground →
 * commit → render state. This is the integration test that would have caught
 * every orchestration regression of the last weeks.
 */

test("typing a command creates and edits objects instantly", async ({ page }) => {
  await page.goto("/?testStandalone=1");

  // First run shows the onboarding overlay; dismissing it is part of the flow.
  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();

  const input = page.getByTestId("intent-command-input");
  await expect(input).toBeVisible();

  // Create.
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  // Instant-commit feedback remains in the command panel without an
  // obstructive floating action toast.
  await expect(page.getByTestId("action-toast")).toHaveCount(0);

  // Edit the selected object by typed command (no confirmation anywhere).
  await input.fill("rename selected to Payments");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");

  const summary = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): unknown } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(summary).toMatchObject({ objectCount: 1, labels: ["Payments"] });

  // Voice-parity commands through the same pipeline: recolor, resize, select.
  await input.fill("make selected red");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Color");

  await input.fill("make selected taller");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Resize");

  await input.fill("select everything");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Select every object");

  // Undo remains available from the persistent canvas toolbar.
  await input.fill("delete selected");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Delete");
  await page.locator(".canvas-toolbar").getByRole("button", { name: "Undo" }).click();
  const restored = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): { objectCount: number } } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(restored.objectCount).toBe(1);
});
