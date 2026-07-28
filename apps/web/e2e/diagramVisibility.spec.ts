import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  emitSnapGestureFrame(frame: {
    hands: Array<{
      handedness: string;
      confidence: number;
      landmarks: Array<{ x: number; y: number; z: number }>;
    }>;
    timestampMs: number;
    suppressed: boolean;
  }): boolean;
  openPttGate(): void;
  getDiagramVisible(): boolean;
  getBoardSummary(): { objectCount: number };
};

async function hooks(page: Page): Promise<void> {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
}

async function emitSnap(page: Page, startAt: number): Promise<void> {
  await page.evaluate((timestampMs) => {
    const api = (window as unknown as { __airboardTestHooks: Hooks }).__airboardTestHooks;
    const makeHand = (contact: boolean, middleX: number) => {
      const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
      points[0] = { x: 0.5, y: 0.82, z: 0 };
      points[4] = contact
        ? { x: middleX + 0.005, y: 0.365, z: 0 }
        : { x: 0.31, y: 0.47, z: 0 };
      points[5] = { x: 0.42, y: 0.64, z: 0 };
      points[6] = { x: 0.42, y: 0.5, z: 0 };
      points[8] = { x: 0.4, y: 0.3, z: 0 };
      points[9] = { x: 0.5, y: 0.62, z: 0 };
      points[10] = { x: 0.5, y: 0.49, z: 0 };
      points[12] = { x: middleX, y: 0.36, z: 0 };
      points[13] = { x: 0.56, y: 0.64, z: 0 };
      points[14] = { x: 0.57, y: 0.51, z: 0 };
      points[16] = { x: 0.58, y: 0.32, z: 0 };
      points[17] = { x: 0.63, y: 0.67, z: 0 };
      points[18] = { x: 0.65, y: 0.54, z: 0 };
      points[20] = { x: 0.67, y: 0.38, z: 0 };
      return { handedness: "Right", confidence: 0.98, landmarks: points };
    };
    api.emitSnapGestureFrame({
      hands: [makeHand(true, 0.5)],
      timestampMs,
      suppressed: false,
    });
    api.emitSnapGestureFrame({
      hands: [makeHand(true, 0.5)],
      timestampMs: timestampMs + 40,
      suppressed: false,
    });
    // Contact arms the gesture; a later visible gap plus fast middle-finger
    // travel completes it. Contact alone must never toggle visibility.
    api.emitSnapGestureFrame({
      hands: [makeHand(false, 0.57)],
      timestampMs: timestampMs + 110,
      suppressed: false,
    });
  }, startAt);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("snap, keyboard, menu, and voice share one local visibility action", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await page.evaluate(() => {
    const api = (window as unknown as { __airboardTestHooks: Hooks }).__airboardTestHooks;
    api.openPttGate();
  });
  await expect(page.getByTestId("voice-gate-pill")).toBeVisible();
  await emitSnap(page, 0);
  await expect(page.locator("main.airboard-shell")).toHaveClass(/diagram-hidden/);
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0");
  await expect(page.locator("canvas.board-canvas")).toHaveCSS("opacity", "0");

  await page.keyboard.press("Shift+H");
  await expect(page.locator("main.airboard-shell")).not.toHaveClass(/diagram-hidden/);

  await page.getByLabel("More board actions").click();
  await page.getByTestId("diagram-visibility-menu-action").click();
  await expect(page.getByTestId("diagram-visibility-status")).toBeVisible();
  await page.getByTestId("diagram-visibility-status").click();
  await expect(page.locator("main.airboard-shell")).not.toHaveClass(/diagram-hidden/);

  const command = page.getByTestId("intent-command-input");
  await command.fill("hide canvas");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator("main.airboard-shell")).toHaveClass(/diagram-hidden/);

  const before = await page.evaluate(
    () =>
      (window as unknown as { __airboardTestHooks: Hooks })
        .__airboardTestHooks.getBoardSummary().objectCount,
  );
  await command.fill("add a database named Invisible Edit");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("editing commands are suspended");
  const after = await page.evaluate(
    () =>
      (window as unknown as { __airboardTestHooks: Hooks })
        .__airboardTestHooks.getBoardSummary().objectCount,
  );
  expect(after).toBe(before);

  await command.fill("bring the diagram back");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator("main.airboard-shell")).not.toHaveClass(/diagram-hidden/);
});

test("gesture guide teaches the exact conflict-safe poses", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await page.getByRole("button", { name: "Open board settings" }).click();
  await page.getByText("Gesture guide", { exact: true }).click();

  await expect(
    page.getByText("Move one relaxed hand without holding a command pose."),
  ).toBeVisible();
  await expect(
    page.getByText(/Camera gestures select one object only and never draw a lasso/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Camera gestures do not resize objects or select an area/i),
  ).toBeVisible();
  await expect(page.locator(".gesture-guide dt", { hasText: "Resize" })).toHaveCount(0);
  await expect(
    page.getByText(/flick the middle finger away quickly—the touch alone does nothing/i),
  ).toBeVisible();
  await expect(
    page.getByText(/hold one open palm still/i),
  ).toBeVisible();
  await expect(
    page.getByText(/sweep it left in one clear horizontal motion/i),
  ).toBeVisible();
  await expect(page.getByText(/held palm is reserved for voice/i)).toHaveCount(0);
  await expect(
    page.getByText(/Hold two closed hands briefly/i),
  ).toBeVisible();
});
