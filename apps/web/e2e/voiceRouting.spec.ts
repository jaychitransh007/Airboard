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
  resetVoiceRouting(): void;
  getBoardSummary(): { objectCount: number; labels: string[]; selectedCount: number };
};

async function hooks(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
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
  await page.goto("/");
  await hooks(page);

  // Meeting talk with no wake word and no gate: inert.
  const ambient = await emit(page, "so the user hits the payment API which writes to the ledger");
  expect(ambient.routed).toBe(false);
  expect((await summary(page)).objectCount).toBe(0);

  // A wake-word command executes instantly — including disfluencies.
  await emit(page, "Hey, Airo. Uh, add a circle.");
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  expect((await summary(page)).objectCount).toBe(1);

  // Voice edit of the (auto-selected) object.
  await emit(page, "Airo, rename selected to Ledger");
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");
  expect((await summary(page)).labels).toEqual(["Ledger"]);
});

test("push-to-talk gate routes wake-word-free commands exactly once", async ({ page }) => {
  await page.goto("/");
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
