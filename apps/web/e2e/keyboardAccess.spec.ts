import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("Share keeps keyboard focus inside, closes on Escape and hands focus back", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press(press % 3 === 2 ? "Shift+Tab" : "Tab");
    const inside = await dialog.evaluate((element) => element.contains(document.activeElement));
    expect(inside, `focus left the dialog after press ${press + 1}`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();
});

test("the first Tab on a page offers a skip link to the main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
