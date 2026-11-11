import { expect, test } from "@playwright/test";

test("public Help Center searches and opens a generated article", async ({ page }) => {
  await page.goto("/help");

  await expect(page.getByRole("heading", { name: "Find the answer before the meeting starts." })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search Airboard help" });
  await search.fill("Meet present tab");

  const result = page.getByRole("link", { name: /Google Meet/ }).first();
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(/\/help\/integrations\/google-meet$/);
  await expect(page.getByRole("heading", { name: "Use Airboard in Google Meet", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Present your board" })).toHaveAttribute("href", "#present-your-board");
});

test("legacy docs URL redirects to the Help Center", async ({ page }) => {
  await page.goto("/docs");
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Find the answer before the meeting starts." })).toBeVisible();
});
