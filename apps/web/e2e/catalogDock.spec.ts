import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
    window.localStorage.setItem("airboard.cookie-choice.v1", "necessary");
    window.localStorage.setItem("airboard.copilot.v1", "closed");
    window.localStorage.removeItem("airboard.creation.recent-shapes.v1");
  });
});

async function openStableStandalone(page: Page) {
  await page.goto("/?testStandalone=1");
  const toolbar = page.getByRole("toolbar", { name: "Board creation tools" });
  await expect(toolbar).toBeVisible();
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Boolean(
              (
                window as unknown as {
                  __airboardTestHooks: {
                    getBoardSummary(): { boardSessionId: string | null };
                  };
                }
              ).__airboardTestHooks.getBoardSummary().boardSessionId,
            ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  return toolbar;
}

function shapeSection(sidebar: Locator, name: string) {
  return sidebar
    .locator(".creation-shape-section")
    .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
}

async function expectInsideViewport(locator: Locator, width: number, height: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
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

async function boardObjectSummary(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __airboardTestHooks: {
            getBoardSummary(): {
              objectCount: number;
              positions: ({ x: number; y: number } | null)[];
            };
          };
        }
      ).__airboardTestHooks.getBoardSummary(),
  );
}

test("the creation toolbar exposes FigJam's four groups in the expected order", async ({
  page,
}) => {
  const toolbar = await openStableStandalone(page);
  const canvas = page.locator("canvas.board-canvas");

  expect(
    await toolbar.locator(":scope > [role=group]").evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("aria-label")),
    ),
  ).toEqual(["Navigation", "Objects", "Tools", "Insert"]);

  const expectedButtons: Record<string, string[]> = {
    Navigation: ["Move, shortcut V", "Hand, shortcut H"],
    Objects: ["Draw", "Sticky note, shortcut S", "Shape", "Connector"],
    Tools: ["Text, shortcut T", "Section, shortcut ⇧S", "Table, shortcut ⇧T", "Stamp"],
    Insert: ["Insert"],
  };
  for (const [groupName, labels] of Object.entries(expectedButtons)) {
    const group = toolbar.getByRole("group", { name: groupName });
    expect(
      await group.getByRole("button").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
    ).toEqual(labels);
  }

  const toolbarBox = await toolbar.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(
    Math.abs(
      toolbarBox!.x + toolbarBox!.width / 2 -
        (canvasBox!.x + canvasBox!.width / 2),
    ),
  ).toBeLessThan(2);
  expect(canvasBox!.y + canvasBox!.height - (toolbarBox!.y + toolbarBox!.height)).toBeLessThan(32);
  await expect(toolbar.getByRole("button", { name: /^Move,/ })).toHaveAttribute("aria-pressed", "true");
});

test("the shape popover and persistent library expose the complete catalog", async ({ page }) => {
  const toolbar = await openStableStandalone(page);
  const shapeTrigger = toolbar.getByRole("button", { name: "Shape", exact: true });

  await shapeTrigger.click();
  await expect(shapeTrigger).toHaveAttribute("aria-expanded", "true");
  const popover = page.getByRole("menu", { name: "Recent shapes and connectors" });
  await expect(popover).toBeVisible();
  await expect(popover.locator(".creation-quick-grid").first().getByRole("menuitem")).toHaveCount(6);
  await expect(popover.locator(".creation-lines-grid").getByRole("menuitem")).toHaveCount(3);
  expect(
    await popover.locator(".creation-lines-grid").getByRole("menuitem").evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual(["Bent connector", "Curved connector", "Straight connector"]);

  await popover.getByRole("menuitem", { name: "More shapes" }).click();
  await expect(popover).toBeHidden();

  const sidebar = page.locator("aside.creation-shape-sidebar[aria-label='More shapes']");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("searchbox", { name: "Search shapes" })).toBeFocused();

  const sections = sidebar.locator(".creation-shape-section");
  await expect(sections).toHaveCount(6);
  expect(await sections.getByRole("heading").allTextContents()).toEqual([
    "Recent",
    "Lines",
    "Basic",
    "Flowchart",
    "Advanced",
    "Airboard",
  ]);

  const expectedCounts: Record<string, number> = {
    Recent: 6,
    Lines: 3,
    Basic: 14,
    Flowchart: 16,
    Advanced: 26,
    Airboard: 4,
  };
  for (const [name, count] of Object.entries(expectedCounts)) {
    await expect(shapeSection(sidebar, name).getByRole("menuitem")).toHaveCount(count);
  }

  const search = sidebar.getByRole("searchbox", { name: "Search shapes" });
  await search.fill("wallet");
  await expect(sections).toHaveCount(1);
  await expect(shapeSection(sidebar, "Advanced").getByRole("menuitem", { name: "Wallet" })).toBeVisible();

  await search.fill("");
  await shapeSection(sidebar, "Basic").getByRole("menuitem", { name: "Star" }).click();
  await expect(shapeSection(sidebar, "Recent").getByRole("menuitem").first()).toHaveAttribute(
    "aria-label",
    "Star",
  );
  await expect(shapeTrigger).toHaveClass(/selected/);

  await sidebar.getByRole("button", { name: "Close shapes" }).click();
  await expect(sidebar).toBeHidden();
});

test("draw, connector, stamp, and insert popovers retain their FigJam ordering", async ({
  page,
}) => {
  const toolbar = await openStableStandalone(page);

  await toolbar.getByRole("button", { name: "Draw", exact: true }).click();
  const drawing = page.getByRole("menu", { name: "Drawing tools" });
  expect(
    await drawing.getByRole("menuitem").evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual([
    "Marker, shortcut M",
    "Highlighter, shortcut Shift M",
    "Washi tape, shortcut W",
    "Eraser, shortcut Shift Delete",
  ]);

  await toolbar.getByRole("button", { name: "Connector", exact: true }).click();
  const connectors = page.getByRole("menu", { name: "Connector types" });
  expect(
    await connectors.getByRole("menuitem").evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual([
    "Bent connector, shortcut X",
    "Curved connector",
    "Straight connector, shortcut L",
  ]);

  await toolbar.getByRole("button", { name: /^Table,/ }).click();
  const tableSize = page.getByRole("menu", { name: "Choose table size" });
  await expect(tableSize.getByRole("menuitem")).toHaveCount(100);
  await tableSize.getByRole("menuitem", { name: "4 by 5 table" }).click();
  await expect(tableSize).toBeHidden();
  await expect(toolbar.getByRole("button", { name: /^Table,/ })).toHaveClass(/selected/);

  await toolbar.getByRole("button", { name: "Stamp", exact: true }).click();
  const stamps = page.getByRole("menu", { name: "Stamps" });
  await expect(stamps.getByRole("group", { name: "Permanent stamp choices" }).getByRole("menuitem")).toHaveCount(12);

  await toolbar.getByRole("button", { name: "Insert", exact: true }).click();
  const insert = page.getByRole("menu", { name: "Insert on board" });
  await expect(insert).toBeVisible();
  expect(await insert.locator(".creation-insert-list strong").allTextContents()).toEqual([
    "Mind map",
    "Face stamp",
    "Code block",
    "Media",
    "Link",
  ]);
  expect(await insert.locator(".creation-insert-list small").allTextContents()).toEqual([
    "Build a connected hierarchy",
    "Stamp a workspace member",
    "Add syntax-highlighted code",
    "Image, GIF, or video",
    "Paste a link preview",
  ]);
  expect(await insert.locator(".creation-insert-list kbd").allTextContents()).toEqual([
    "",
    "",
    "`",
    "⇧⌘K",
    "",
  ]);

  await insert.getByRole("menuitem").filter({ hasText: "Code block" }).click();
  await expect(insert).toBeHidden();
  await expect(toolbar.getByRole("button", { name: "Insert", exact: true })).toHaveClass(/selected/);
});

test("FigJam creation shortcuts arm the corresponding tools and ignore editable fields", async ({
  page,
}) => {
  const toolbar = await openStableStandalone(page);
  const canvas = page.locator("canvas.board-canvas");

  const directShortcuts = [
    ["v", /^Move,/],
    ["h", /^Hand,/],
    ["s", /^Sticky note,/],
    ["t", /^Text,/],
    ["Shift+s", /^Section,/],
    ["Shift+t", /^Table,/],
  ] as const;
  for (const [shortcut, name] of directShortcuts) {
    await canvas.focus();
    await page.keyboard.press(shortcut);
    await expect(toolbar.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  }

  const popoverShortcuts = [
    ["m", "Draw", "Drawing tools", /^Marker,/],
    ["Shift+m", "Draw", "Drawing tools", /^Highlighter,/],
    ["w", "Draw", "Drawing tools", /^Washi tape,/],
    ["Shift+Delete", "Draw", "Drawing tools", /^Eraser,/],
    ["r", "Shape", "Recent shapes and connectors", /^Square$/],
    ["o", "Shape", "Recent shapes and connectors", /^Ellipse$/],
    ["x", "Connector", "Connector types", /^Bent connector,/],
    ["l", "Connector", "Connector types", /^Straight connector,/],
    ["`", "Insert", "Insert on board", /^Code block/],
    ["Control+Shift+k", "Insert", "Insert on board", /^Media/],
  ] as const;
  for (const [shortcut, triggerName, menuName, itemName] of popoverShortcuts) {
    await canvas.focus();
    await page.keyboard.press(shortcut);
    const trigger = toolbar.getByRole("button", { name: triggerName, exact: true });
    await expect(trigger).toHaveClass(/selected/);
    await trigger.click();
    const menu = page.getByRole("menu", { name: menuName });
    await expect(menu.getByRole("menuitem", { name: itemName })).toHaveClass(/selected/);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }

  await canvas.focus();
  await page.keyboard.press("e");
  await expect(toolbar.getByRole("button", { name: "Stamp", exact: true })).toHaveClass(/selected/);

  await canvas.focus();
  await page.keyboard.press("v");
  await toolbar.getByRole("button", { name: "Shape", exact: true }).click();
  await page
    .getByRole("menu", { name: "Recent shapes and connectors" })
    .getByRole("menuitem", { name: "More shapes" })
    .click();
  const search = page.getByRole("searchbox", { name: "Search shapes" });
  await expect(search).toBeFocused();
  await page.keyboard.press("r");
  await expect(search).toHaveValue("r");
  await expect(toolbar.getByRole("button", { name: /^Move,/ })).toHaveAttribute("aria-pressed", "true");
});

test("creation popovers and the shape library become reachable drawers on narrow screens", async ({
  page,
}) => {
  const viewport = { width: 375, height: 760 };
  await page.setViewportSize(viewport);
  const toolbar = await openStableStandalone(page);
  await expectInsideViewport(toolbar, viewport.width, viewport.height);

  for (const button of await toolbar.getByRole("button").all()) {
    await expect(button).toBeVisible();
    await expectInsideViewport(button, viewport.width, viewport.height);
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(30);
    expect(box!.height).toBeGreaterThanOrEqual(34);
  }

  await toolbar.getByRole("button", { name: "Insert", exact: true }).click();
  const insert = page.getByRole("menu", { name: "Insert on board" });
  await expect(insert).toBeVisible();
  await expectInsideViewport(insert, viewport.width, viewport.height);

  await toolbar.getByRole("button", { name: "Shape", exact: true }).click();
  const shapePopover = page.getByRole("menu", { name: "Recent shapes and connectors" });
  await expectInsideViewport(shapePopover, viewport.width, viewport.height);
  await shapePopover.getByRole("menuitem", { name: "More shapes" }).click();

  const sidebar = page.locator("aside.creation-shape-sidebar[aria-label='More shapes']");
  await expect(sidebar).toBeVisible();
  await expectInsideViewport(sidebar, viewport.width, viewport.height);
  await shapeSection(sidebar, "Airboard").scrollIntoViewIfNeeded();
  await expect(shapeSection(sidebar, "Airboard")).toBeVisible();
  await expect(shapeSection(sidebar, "Airboard").getByRole("menuitem")).toHaveCount(4);
});

test("the responsive shape drawer remains beside Airo", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  const toolbar = await openStableStandalone(page);
  await page.getByRole("button", { name: "Open Airo copilot" }).click();
  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot).toBeVisible();

  await toolbar.getByRole("button", { name: "Shape", exact: true }).click();
  await page
    .getByRole("menu", { name: "Recent shapes and connectors" })
    .getByRole("menuitem", { name: "More shapes" })
    .click();
  const sidebar = page.locator("aside.creation-shape-sidebar[aria-label='More shapes']");
  await expect(sidebar).toBeVisible();

  const sidebarBox = await sidebar.boundingBox();
  const copilotBox = await copilot.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(copilotBox).not.toBeNull();
  expect(sidebarBox!.x + sidebarBox!.width).toBeLessThanOrEqual(copilotBox!.x);
});

test("air hover and one close-drag-release pinch carry a recent shape onto the board", async ({
  page,
}) => {
  const toolbar = await openStableStandalone(page);
  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = await canvas.boundingBox();
  const shapeTrigger = toolbar.getByRole("button", { name: "Shape", exact: true });
  const shapeBox = await shapeTrigger.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(shapeBox).not.toBeNull();

  const initialCount = (await boardObjectSummary(page)).objectCount;
  const localCenter = (box: NonNullable<typeof shapeBox>) => ({
    x: box.x + box.width / 2 - canvasBox!.x,
    y: box.y + box.height / 2 - canvasBox!.y,
  });
  const shapePoint = localCenter(shapeBox!);

  await emitHybridGesture(page, {
    ...shapePoint,
    pinchState: "open",
    timestampMs: 1_000,
  });
  const shapeMenu = page.getByRole("menu", { name: "Recent shapes and connectors" });
  await expect(shapeMenu).toBeVisible();
  expect(await catalogGestureState(page)).toMatchObject({
    openCatalogId: "shape",
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });

  const square = shapeMenu.getByRole("menuitem", { name: "Square", exact: true });
  const squareBox = await square.boundingBox();
  expect(squareBox).not.toBeNull();
  const squarePoint = localCenter(squareBox!);
  await emitHybridGesture(page, {
    ...squarePoint,
    pinchState: "open",
    timestampMs: 1_100,
  });
  await emitHybridGesture(page, {
    ...squarePoint,
    pinchState: "closing",
    timestampMs: 1_150,
  });
  await emitHybridGesture(page, {
    ...squarePoint,
    pinchState: "closed",
    timestampMs: 1_200,
  });

  await expect(shapeMenu).toBeHidden();
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "box",
    interactionMode: "catalog_carrying",
    carriedTool: "shape:basic-square",
    enteredCanvas: false,
    placementActive: true,
  });
  expect((await boardObjectSummary(page)).objectCount).toBe(initialCount);

  const dropPoint = {
    x: canvasBox!.width * 0.72,
    y: canvasBox!.height * 0.3,
  };
  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "closed",
    timestampMs: 1_300,
  });
  await expect
    .poll(async () => {
      const center = (await catalogGestureState(page)).ghostCenter;
      return center ? Math.hypot(center.x - dropPoint.x, center.y - dropPoint.y) : Infinity;
    })
    .toBeLessThan(3);
  expect(await catalogGestureState(page)).toMatchObject({ enteredCanvas: true });

  await emitHybridGesture(page, {
    ...dropPoint,
    pinchState: "open",
    timestampMs: 1_400,
  });
  await expect.poll(async () => (await boardObjectSummary(page)).objectCount).toBe(initialCount + 1);
  const placed = (await boardObjectSummary(page)).positions.at(-1);
  expect(placed).not.toBeNull();
  expect(Math.abs((placed?.x ?? Infinity) - dropPoint.x)).toBeLessThan(16);
  expect(Math.abs((placed?.y ?? Infinity) - dropPoint.y)).toBeLessThan(16);
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "select",
    interactionMode: null,
    placementActive: false,
  });
  const canonical = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __airboardTestHooks: {
          getCanonicalBoardState(): {
            elements: Record<string, { kind: string; status: string; legacyStrokeId?: string; shapeKind?: string }>;
            strokes: Record<string, { status: string }>;
          };
        };
      }
    ).__airboardTestHooks.getCanonicalBoardState();
    return {
      shapes: Object.values(state.elements)
        .filter((element) => element.status === "active" && !element.legacyStrokeId && element.kind === "shape")
        .map((element) => element.shapeKind),
      legacyStrokeCount: Object.values(state.strokes)
        .filter((stroke) => stroke.status === "committed").length,
    };
  });
  expect(canonical).toEqual({ shapes: ["square"], legacyStrokeCount: 0 });
});

test("air pinch carry places a v2-only curved connector canonically", async ({ page }) => {
  const toolbar = await openStableStandalone(page);
  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = await canvas.boundingBox();
  const trigger = toolbar.getByRole("button", { name: "Connector", exact: true });
  const triggerBox = await trigger.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  const localCenter = (box: NonNullable<typeof triggerBox>) => ({
    x: box.x + box.width / 2 - canvasBox!.x,
    y: box.y + box.height / 2 - canvasBox!.y,
  });

  await emitHybridGesture(page, {
    ...localCenter(triggerBox!),
    pinchState: "open",
    timestampMs: 2_000,
  });
  const menu = page.getByRole("menu", { name: "Connector types" });
  await expect(menu).toBeVisible();
  const curved = menu.getByRole("menuitem", { name: "Curved connector", exact: true });
  const curvedBox = await curved.boundingBox();
  expect(curvedBox).not.toBeNull();
  const curvedPoint = localCenter(curvedBox!);
  await emitHybridGesture(page, { ...curvedPoint, pinchState: "open", timestampMs: 2_100 });
  await emitHybridGesture(page, { ...curvedPoint, pinchState: "closing", timestampMs: 2_150 });
  await emitHybridGesture(page, { ...curvedPoint, pinchState: "closed", timestampMs: 2_200 });
  expect(await catalogGestureState(page)).toMatchObject({
    activeTool: "connector",
    interactionMode: "catalog_carrying",
    carriedTool: "connector:curved",
    placementActive: true,
  });

  const dropPoint = { x: canvasBox!.width * 0.68, y: canvasBox!.height * 0.26 };
  await emitHybridGesture(page, { ...dropPoint, pinchState: "closed", timestampMs: 2_300 });
  await emitHybridGesture(page, { ...dropPoint, pinchState: "open", timestampMs: 2_400 });
  await expect.poll(async () => (await boardObjectSummary(page)).objectCount).toBe(1);
  const canonical = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __airboardTestHooks: {
          getCanonicalBoardState(): {
            elements: Record<string, { kind: string; status: string; legacyStrokeId?: string; pathKind?: string }>;
            strokes: Record<string, { status: string }>;
          };
        };
      }
    ).__airboardTestHooks.getCanonicalBoardState();
    return {
      connectors: Object.values(state.elements)
        .filter((element) => element.status === "active" && !element.legacyStrokeId && element.kind === "connector")
        .map((element) => element.pathKind),
      legacyStrokeCount: Object.values(state.strokes)
        .filter((stroke) => stroke.status === "committed").length,
    };
  });
  expect(canonical).toEqual({ connectors: ["curved"], legacyStrokeCount: 0 });
});

test("pointer drag-and-drop places a shape from the new Shape popover", async ({ page }) => {
  const toolbar = await openStableStandalone(page);
  const canvas = page.locator("canvas.board-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const initialCount = (await boardObjectSummary(page)).objectCount;

  await toolbar.getByRole("button", { name: "Shape", exact: true }).click();
  const square = page
    .getByRole("menu", { name: "Recent shapes and connectors" })
    .getByRole("menuitem", { name: "Square", exact: true });
  await expect(square).toHaveAttribute("draggable", "true");

  const targetPosition = {
    x: canvasBox!.width * 0.66,
    y: canvasBox!.height * 0.34,
  };
  await square.dragTo(canvas, { targetPosition });

  await expect.poll(async () => (await boardObjectSummary(page)).objectCount).toBe(initialCount + 1);
  const placed = (await boardObjectSummary(page)).positions.at(-1);
  expect(placed).not.toBeNull();
  expect(Math.abs((placed?.x ?? Infinity) - targetPosition.x)).toBeLessThan(16);
  expect(Math.abs((placed?.y ?? Infinity) - targetPosition.y)).toBeLessThan(16);
  const canonical = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __airboardTestHooks: {
          getCanonicalBoardState(): {
            elements: Record<string, { kind: string; status: string; legacyStrokeId?: string; shapeKind?: string }>;
            strokes: Record<string, { status: string }>;
          };
        };
      }
    ).__airboardTestHooks.getCanonicalBoardState();
    return {
      shapes: Object.values(state.elements)
        .filter((element) => element.status === "active" && !element.legacyStrokeId && element.kind === "shape")
        .map((element) => element.shapeKind),
      legacyStrokeCount: Object.values(state.strokes)
        .filter((stroke) => stroke.status === "committed").length,
    };
  });
  expect(canonical).toEqual({ shapes: ["square"], legacyStrokeCount: 0 });
});
