import { expect, test } from "@playwright/test";

/**
 * E2E path (b): finalized-transcript routing through the VoiceCommandRouter —
 * the exact code path a realtime speech session drives — without a
 * microphone. Covers wake-word routing, push-to-talk gating, meeting-talk
 * safety, and the single-execution invariant, all against the live app.
 */

type Hooks = {
  emitFinalTranscript(transcript: string): { routed: boolean; wakeDetected: boolean };
  openPttGate(): void;
  emitUndoGestureFrame(frame: {
    score: number;
    point: { x: number; y: number } | null;
    timestampMs: number;
    suppressed: boolean;
  }): boolean;
  resetVoiceRouting(): void;
  getDiagramVisible(): boolean;
  getBoardSummary(): {
    objectCount: number;
    labels: string[];
    selectedCount: number;
    syncStatus: string;
  };
};

async function hooks(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(async () => (await summary(page)).syncStatus, { timeout: 20_000 })
    .toBe("connected");
}

function emit(page: import("@playwright/test").Page, transcript: string) {
  return page.evaluate(
    (t) =>
      (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.emitFinalTranscript(
        t,
      ),
    transcript,
  );
}

function summary(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.getBoardSummary(),
  );
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("wake-word transcripts execute; meeting talk never does", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  // Meeting talk with no wake word and no gate: inert.
  const ambient = await emit(page, "so the user hits the payment API which writes to the ledger");
  expect(ambient.routed).toBe(false);
  expect((await summary(page)).objectCount).toBe(0);

  // A wake-word command executes instantly — including disfluencies.
  await emit(page, "Hey, Airo. Uh, add a circle.");
  await expect(page.getByTestId("copilot-transcript")).toContainText(
    "Hey, Airo. Uh, add a circle.",
  );
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  expect((await summary(page)).objectCount).toBe(1);

  // Voice edit of the (auto-selected) object.
  await emit(page, "Airo, rename selected to Ledger");
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");
  expect((await summary(page)).labels).toEqual(["Ledger"]);
});

test("right-side copilot is collapsible and voice applies without its Send button", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot).toBeVisible();
  await expect(page.locator(".canvas-command-bar")).toHaveCount(0);

  await emit(page, "Airo, add a service here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(1);
  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.openPttGate(),
  );
  await emit(page, "add a database, uh, layer that is connected to service.");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(3);
  await expect(page.getByTestId("copilot-activity")).toContainText("Board updated");

  await page.getByRole("button", { name: "Hide Airo copilot" }).click();
  await expect(copilot).toHaveCount(0);
  const reopen = page.getByTestId("canvas-copilot-toggle");
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByTestId("canvas-copilot")).toBeVisible();
  await expect(page.getByTestId("intent-command-input")).toBeVisible();
});

test("one open-palm swipe left undoes exactly one automatic voice action", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, add a user here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(1);

  const swipe = (x: number, timestampMs: number) =>
    page.evaluate(
      ({ x, timestampMs }) =>
        (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.emitUndoGestureFrame({
          score: 0.92,
          point: { x, y: 0.45 },
          timestampMs,
          suppressed: false,
        }),
      { x, timestampMs },
    );
  expect(await swipe(0.2, 0)).toBe(false);
  expect(await swipe(0.3, 80)).toBe(false);
  expect(await swipe(0.43, 190)).toBe(true);
  await expect.poll(async () => (await summary(page)).objectCount).toBe(0);
  await expect(page.getByTestId("copilot-activity")).toContainText("Undo gesture applied");

  expect(await swipe(0.7, 300)).toBe(false);
  await expect.poll(async () => (await summary(page)).objectCount).toBe(0);
});

test("push-to-talk gate routes wake-word-free commands exactly once", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.openPttGate(),
  );
  await expect(page.getByTestId("voice-gate-pill")).toBeVisible();

  // No wake word needed while the gate is open.
  const gated = await emit(page, "add a user here");
  expect(gated.routed).toBe(true);
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  expect((await summary(page)).objectCount).toBe(1);

  // The single-execution invariant, live: a gated transcript that ALSO
  // carries a wake word still routes exactly one command.
  await emit(page, "Airo, add a database here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(2);
  // Give any (buggy) duplicate route a chance to land before asserting.
  await page.waitForTimeout(400);
  expect((await summary(page)).objectCount).toBe(2);
});

test("voice hides and restores the diagram while hidden edits stay suspended", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, hide diagram");
  await expect(page.locator("main.airboard-shell")).toHaveClass(/diagram-hidden/);
  expect(
    await page.evaluate(
      () =>
        (window as never as { __airboardTestHooks: Hooks })
          .__airboardTestHooks.getDiagramVisible(),
    ),
  ).toBe(false);

  await emit(page, "Airo, add a database named Hidden");
  await page.waitForTimeout(250);
  expect((await summary(page)).objectCount).toBe(0);
  await expect(page.locator(".intent-feedback")).toContainText("editing commands are suspended");

  await emit(page, "Airo, bring the diagram back");
  await expect(page.locator("main.airboard-shell")).not.toHaveClass(/diagram-hidden/);
});
