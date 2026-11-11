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
  await page.getByRole("menuitem", { name: "Share with people" }).click();
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

test("the board menu opens from the keyboard, moves with arrows and closes on Escape", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  const more = page.getByRole("button", { name: "More board actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Board actions" });
  await expect(menu).toBeVisible();
  const items = menu.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});
