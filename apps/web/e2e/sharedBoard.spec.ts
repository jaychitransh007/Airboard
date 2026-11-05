import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// A board built by the production diagram commands: three shapes, two connectors.
const sharedBoard = readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8");
const TOKEN = "A".repeat(43);

async function serveSharedBoard(page: Page, status = 200) {
  await page.route("**/shared-boards/**", (route) =>
    route.fulfill(status === 200
      ? { status, contentType: "application/json", body: sharedBoard }
      : { status, json: { error: "SHARE_LINK_UNAVAILABLE" } }),
  );
}

/** Counts non-white pixels, so a blank canvas fails. */
function paintedPixels(page: Page) {
  return page.locator("canvas.shared-board-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let index = 0; index < data.length; index += 16) {
      const [red = 255, green = 255, blue = 255] = data.subarray(index, index + 3);
      if (red < 240 || green < 240 || blue < 240) painted += 1;
    }
    return painted;
  });
}

test("a view-only link shows the board to someone without an account", async ({ page }) => {
  await serveSharedBoard(page);
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout flow" })).toBeVisible();
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  const canvas = page.getByRole("img", { name: /Board “Checkout flow”/ });
  await expect(canvas).toBeVisible();
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(200);

  // Screen readers get the words on the board.
  const text = page.locator("#shared-board-text");
  for (const label of ["Shopper", "Checkout API", "Orders DB"]) {
    await expect(text).toContainText(label);
  }

  // Nothing on the page edits the board.
  await expect(page.getByRole("button", { name: /add|delete|draw|connect/i })).toHaveCount(0);

  // Zooming in and fitting again both redraw.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(200);
});

test("a link that was turned off or expired says so", async ({ page }) => {
  await serveSharedBoard(page, 404);
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the shared board page meets WCAG 2.2 AA", async ({ page }) => {
  await serveSharedBoard(page);
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout flow" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((violation) => `${violation.impact} ${violation.id}`)).toEqual([]);
});
