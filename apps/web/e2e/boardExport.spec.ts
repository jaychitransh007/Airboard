import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("Copy image puts the board on the clipboard as a PNG", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await page.goto("/?testStandalone=1");
  await page.getByTestId("share-board").click();
  await page.getByRole("menuitem", { name: "Copy image" }).click();
  await expect(page.locator(".intent-feedback")).toContainText("Copied the board as an image");
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => [...item.types]));
  expect(types).toContain("image/png");
});

test("Export PDF downloads a one-page PDF of the board", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await page.getByTestId("share-board").click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^airboard-.*\.pdf$/);
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  expect(bytes.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
});
