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
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(() => new URL(page.url()).searchParams.has("boardSessionId"), { timeout: 30_000 })
    .toBe(true);
}

async function emitHybridGesture(
  page: Page,
  input: {
    x: number;
    y: number;
    pinchState: "open" | "closing" | "closed" | "opening";
    timestampMs: number;
  },
) {
  await page.evaluate((frame) => {
    const hooks = (
      window as unknown as {
        __airboardTestHooks: {
          emitHybridGestureOutput(output: unknown): void;
        };
      }
    ).__airboardTestHooks;
    hooks.emitHybridGestureOutput({
      timestampMs: frame.timestampMs,
      state:
        frame.pinchState === "closed"
          ? "pinched"
          : frame.pinchState === "closing"
            ? "pinch_arming"
            : frame.pinchState === "opening"
              ? "pinch_releasing"
            : "pointing",
      trackingState: "tracked",
      pinchState: frame.pinchState,
      cursor: { x: frame.x, y: frame.y },
      coarseCursor: { x: frame.x, y: frame.y },
      focusedTargetId: null,
      grabbedTargetId: null,
      areaCursorRadiusPx: 28,
      requiresPinchRelease: false,
      action: null,
    });
  }, input);
}

async function catalogGestureState(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __airboardTestHooks: {
            getCatalogGestureState(): {
              openCatalogId: string | null;
              activeTool: string;
              interactionMode: string | null;
              carriedTool: string | null;
              enteredCanvas: boolean;
              placementActive: boolean;
              ghostCenter: { x: number; y: number } | null;
            };
          };
        }
      ).__airboardTestHooks.getCatalogGestureState(),
  );
}

async function boardObjectCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __airboardTestHooks: {
            getBoardSummary(): { objectCount: number };
          };
        }
      ).__airboardTestHooks.getBoardSummary().objectCount,
  );
}

async function boardObjectPositions(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __airboardTestHooks: {
            getBoardSummary(): {
              positions: ({ x: number; y: number } | null)[];
            };
          };
        }
      ).__airboardTestHooks.getBoardSummary().positions,
  );
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
    expect(box!.width).toBeGreaterThanOrEqual(56);
    expect(box!.height).toBeGreaterThanOrEqual(56);
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
    expect(itemBox!.width).toBeGreaterThanOrEqual(68);
    expect(itemBox!.height).toBeGreaterThanOrEqual(68);
  }
});

test("air hover opens a category and one close-drag-release carries a shape", async ({
  page,
}) => {
  await openStableStandalone(page);

  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = await canvas.boundingBox();
  const flowTrigger = page.getByRole("button", { name: "Flow", exact: true });
  const flowBox = await flowTrigger.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(flowBox).not.toBeNull();
  const initialCount = await boardObjectCount(page);
  const localCenter = (box: NonNullable<typeof flowBox>) => ({
    x: box.x + box.width / 2 - canvasBox!.x,
    y: box.y + box.height / 2 - canvasBox!.y,
  });

  const flowPoint = localCenter(flowBox!);
  await emitHybridGesture(page, {
    ...flowPoint,
    pinchState: "open",
    timestampMs: 1_000,
  });
  const flowMenu = page.getByRole("menu", { name: "Flow shapes" });
  await expect(flowMenu).toBeVisible();
  expect(await catalogGestureState(page)).toMatchObject({
    openCatalogId: "flow",
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });
  expect(await boardObjectCount(page)).toBe(initialCount);

  const processTile = flowMenu.getByRole("menuitem", { name: "Process" });
  const processBox = await processTile.boundingBox();
  expect(processBox).not.toBeNull();
  const processPoint = localCenter(processBox!);
  for (const [index, progress] of [0.25, 0.5, 0.75].entries()) {
    await emitHybridGesture(page, {
      x: flowPoint.x + (processPoint.x - flowPoint.x) * progress,
      y: flowPoint.y + (processPoint.y - flowPoint.y) * progress,
      pinchState: "open",
      timestampMs: 1_010 + index * 10,
    });
    await expect(flowMenu).toBeVisible();
  }

  // Closing on the category is not a pickup, and keeping that same close while
  // crossing onto a tile still cannot silently select it.
  await emitHybridGesture(page, {
    ...flowPoint,
    pinchState: "closing",
    timestampMs: 1_080,
  });
  await emitHybridGesture(page, {
    ...flowPoint,
    pinchState: "closed",
    timestampMs: 1_100,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "closed",
    timestampMs: 1_200,
  });
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });

  // A partial release that falls closed again is not a new grab cycle.
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "opening",
    timestampMs: 1_240,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "closed",
    timestampMs: 1_270,
  });
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });

  // A neutral/open frame re-arms the confirmed close edge over the shape.
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "open",
    timestampMs: 1_300,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "closing",
    timestampMs: 1_350,
  });
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "closed",
    timestampMs: 1_400,
  });
  await expect(flowMenu).toBeHidden();
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "flow",
    interactionMode: "catalog_carrying",
    carriedTool: "flow",
    enteredCanvas: false,
    placementActive: true,
  });
  await expect
    .poll(async () => {
      const center = (await catalogGestureState(page)).ghostCenter;
      return center
        ? Math.hypot(center.x - processPoint.x, center.y - processPoint.y)
        : Infinity;
    })
    .toBeLessThan(3);

  const dropPoint = {
    x: canvasBox!.width * 0.7,
    y: canvasBox!.height * 0.34,
  };
  // Moving out and then returning over the catalog before release is a
  // cancellation, never a hidden placement beneath the toolbar.
  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "closed",
    timestampMs: 1_450,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "closed",
    timestampMs: 1_500,
  });
  await emitHybridGesture(page, {
    ...processPoint,
    pinchState: "open",
    timestampMs: 1_550,
  });
  expect(await boardObjectCount(page)).toBe(initialCount);
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });

  await emitHybridGesture(page, {
    ...flowPoint,
    pinchState: "open",
    timestampMs: 1_600,
  });
  await expect(flowMenu).toBeVisible();
  const reopenedProcessBox = await flowMenu
    .getByRole("menuitem", { name: "Process" })
    .boundingBox();
  expect(reopenedProcessBox).not.toBeNull();
  const reopenedProcessPoint = localCenter(reopenedProcessBox!);
  await emitHybridGesture(page, {
    ...reopenedProcessPoint,
    pinchState: "closing",
    timestampMs: 1_650,
  });
  expect(await catalogGestureState(page)).toMatchObject({
    interactionMode: null,
    placementActive: false,
  });
  await emitHybridGesture(page, {
    ...reopenedProcessPoint,
    pinchState: "closed",
    timestampMs: 1_700,
  });
  expect(await catalogGestureState(page)).toMatchObject({
    interactionMode: "catalog_carrying",
    carriedTool: "flow",
    placementActive: true,
  });

  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "closed",
    timestampMs: 1_800,
  });
  await expect
    .poll(async () => {
      const center = (await catalogGestureState(page)).ghostCenter;
      return center ? Math.hypot(center.x - dropPoint.x, center.y - dropPoint.y) : Infinity;
    })
    .toBeLessThan(3);
  const carrying = await catalogGestureState(page);
  expect(carrying.enteredCanvas).toBe(true);
  expect(Math.abs((carrying.ghostCenter?.x ?? Infinity) - dropPoint.x)).toBeLessThan(3);
  expect(Math.abs((carrying.ghostCenter?.y ?? Infinity) - dropPoint.y)).toBeLessThan(3);
  expect(await boardObjectCount(page)).toBe(initialCount);

  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "open",
    timestampMs: 1_900,
  });
  expect(await boardObjectCount(page)).toBe(initialCount + 1);
  const positions = await boardObjectPositions(page);
  const placed = positions.at(-1);
  expect(placed).not.toBeNull();
  expect(Math.abs((placed?.x ?? Infinity) - dropPoint.x)).toBeLessThan(16);
  expect(Math.abs((placed?.y ?? Infinity) - dropPoint.y)).toBeLessThan(16);
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });

  await emitHybridGesture(page, {
    ...flowPoint,
    pinchState: "open",
    timestampMs: 2_000,
  });
  await expect(flowMenu).toBeVisible();
  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "open",
    timestampMs: 2_010,
  });
  await expect(flowMenu).toBeHidden();
});
