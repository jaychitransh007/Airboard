import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
    window.localStorage.setItem("airboard.cookie-choice.v1", "necessary");
    window.localStorage.setItem("airboard.copilot.v1", "closed");
  });
});

async function openStableStandalone(page: Page) {
  await page.goto("/?testStandalone=1");
  await expect(page.getByRole("toolbar", { name: "Shape catalog" })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("boardSessionId"), { timeout: 30_000 })
    .toBe(true);
}

test("the shape catalog is a bottom-centered icon dock with accessible controls", async ({
  page,
}) => {
  await openStableStandalone(page);

  const dock = page.getByRole("toolbar", { name: "Shape catalog" });
  await expect(dock).toBeVisible();

  const dockBox = await dock.boundingBox();
  const canvasBox = await page.locator("canvas.board-canvas").boundingBox();
  expect(dockBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(dockBox!.width).toBeGreaterThan(dockBox!.height * 3);
  expect(
    Math.abs(dockBox!.x + dockBox!.width / 2 - (canvasBox!.x + canvasBox!.width / 2)),
  ).toBeLessThan(2);
  expect(
    canvasBox!.y + canvasBox!.height - (dockBox!.y + dockBox!.height),
  ).toBeLessThan(32);

  expect(
    await dock.locator("[data-dock-id]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-dock-id")),
    ),
  ).toEqual(["select", "category:flow", "category:system", "category:annotate", "eraser"]);

  for (const name of ["Select", "Flow", "System", "Annotate", "Eraser"]) {
    const control = dock.getByRole("button", { name });
    await expect(control).toBeVisible();
    await expect(control.locator("svg.catalog-glyph")).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const flowTrigger = dock.getByRole("button", { name: "Flow", exact: true });
  await flowTrigger.click();
  await expect(flowTrigger).toHaveAttribute("aria-expanded", "true");
  const flowMenu = page.getByRole("menu", { name: "Flow shapes" });
  await expect(flowMenu).toBeVisible();
  for (const name of [
    "Process",
    "Decision",
    "Start / End",
    "Input / Output",
    "Document",
    "Arrow",
    "Connector",
  ]) {
    const tool = flowMenu.getByRole("menuitem", { name });
    await expect(tool.locator("svg.catalog-glyph")).toBeVisible();
  }
  await expect(flowMenu.locator(".catalog-tile-label")).toHaveCount(0);
});

test("the icon catalog stays usable beside Airo and inside a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await openStableStandalone(page);
  await page.getByRole("button", { name: "Open Airo copilot" }).click();

  const dock = page.getByRole("toolbar", { name: "Shape catalog" });
  await dock.getByRole("button", { name: "Flow", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Flow shapes" });
  const copilot = page.getByTestId("canvas-copilot");
  await expect(menu).toBeVisible();
  await expect(copilot).toBeVisible();

  const menuBox = await menu.boundingBox();
  const copilotBox = await copilot.boundingBox();
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(copilotBox!.x);
});

test("the Flow icon strip stays fully reachable on a narrow canvas", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await openStableStandalone(page);

  const dock = page.getByRole("toolbar", { name: "Shape catalog" });
  await dock.getByRole("button", { name: "Flow", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Flow shapes" });
  await expect(menu).toBeVisible();

  const narrowMenuBox = await menu.boundingBox();
  expect(narrowMenuBox!.x).toBeGreaterThanOrEqual(0);
  expect(narrowMenuBox!.x + narrowMenuBox!.width).toBeLessThanOrEqual(375);
  for (const item of await menu.getByRole("menuitem").all()) {
    const itemBox = await item.boundingBox();
    expect(itemBox!.width).toBeGreaterThanOrEqual(44);
    expect(itemBox!.height).toBeGreaterThanOrEqual(44);
  }
});
