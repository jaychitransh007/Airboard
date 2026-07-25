import { expect, test, type Page } from "@playwright/test";

/**
 * Canvas navigation acceptance: the viewport pans/zooms, and every input path
 * still lands in correct BOARD coordinates — a command issued while zoomed and
 * panned must create its object where the user is looking, not at the origin.
 */

type Hooks = {
  getViewport(): { x: number; y: number; scale: number };
  setViewport(viewport: { x: number; y: number; scale: number }): void;
  getBoardSummary(): {
    objectCount: number;
    labels: string[];
    positions: ({ x: number; y: number } | null)[];
  };
};

function hooks(page: Page) {
  return page.waitForFunction(() => "__airboardTestHooks" in window);
}

function evalHooks<T>(page: Page, script: (hooks: Hooks) => T): Promise<T> {
  return page.evaluate(
    (body) =>
      // eslint-disable-next-line no-new-func
      new Function(
        "hooks",
        `return (${body})(hooks);`,
      )((window as never as { __airboardTestHooks: unknown }).__airboardTestHooks) as never,
    script.toString(),
  );
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("typed commands land where the user is looking under pan+zoom", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  // Pan far to the right of the origin and zoom in.
  await evalHooks(page, (h) => h.setViewport({ x: -1_500, y: -600, scale: 1.5 }));
  const viewport = await evalHooks(page, (h) => h.getViewport());
  expect(viewport.scale).toBeCloseTo(1.5, 5);

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });

  const summary = await evalHooks(page, (h) => h.getBoardSummary());
  expect(summary.objectCount).toBe(1);
  const position = summary.positions[0];
  expect(position).not.toBeNull();

  // Expected: the visible window's center, in board coordinates.
  const canvas = page.locator("canvas.board-canvas");
  const box = await canvas.boundingBox();
  const expected = {
    x: (box!.width / 2 - viewport.x) / viewport.scale,
    y: (box!.height / 2 - viewport.y) / viewport.scale,
  };
  expect(Math.abs(position!.x - expected.x)).toBeLessThan(60);
  expect(Math.abs(position!.y - expected.y)).toBeLessThan(60);
});

test("ctrl+wheel zooms; plain wheel pans; limits hold", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  const canvas = page.locator("canvas.board-canvas");
  await canvas.hover();

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240); // pinch out → zoom in
  await page.keyboard.up("Control");
  // Wheel dispatch is asynchronous — poll until the handler has applied it.
  await expect
    .poll(async () => (await evalHooks(page, (h) => h.getViewport())).scale, { timeout: 5_000 })
    .toBeGreaterThan(1);

  const before = await evalHooks(page, (h) => h.getViewport());
  await page.mouse.wheel(120, 80); // two-finger scroll → pan
  await expect
    .poll(
      async () => Math.abs((await evalHooks(page, (h) => h.getViewport())).x - before.x),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(1);

  // Limits: an absurd zoom request clamps to maxScale.
  await evalHooks(page, (h) => h.setViewport({ x: 0, y: 0, scale: 999 }));
  const clamped = await evalHooks(page, (h) => h.getViewport());
  expect(clamped.scale).toBeLessThanOrEqual(3);
});
