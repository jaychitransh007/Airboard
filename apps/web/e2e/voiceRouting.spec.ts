import { expect, test } from "@playwright/test";
import { waitForTestHooks, type AirboardTestWindow } from "./support/testHooks";

/**
 * E2E path (b): finalized-transcript routing through the VoiceCommandRouter —
 * the exact code path a realtime speech session drives — without a
 * microphone. Covers wake-word routing, push-to-talk gating, meeting-talk
 * safety, and the single-execution invariant, all against the live app.
 */

async function hooks(page: import("@playwright/test").Page) {
  await waitForTestHooks(page);
  await expect
    .poll(async () => (await summary(page)).syncStatus, { timeout: 20_000 })
    .toBe("connected");
}

function emit(page: import("@playwright/test").Page, transcript: string) {
  return page.evaluate(
    (t) =>
      (window as unknown as AirboardTestWindow).__airboardTestHooks.emitFinalTranscript(
        t,
      ),
    transcript,
  );
}

function summary(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window as unknown as AirboardTestWindow).__airboardTestHooks.getBoardSummary(),
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

  // Room talk isn't shown on the (presented) panel.
  await expect(page.getByTestId("copilot-transcript")).not.toContainText("payment API");

  // A wake-word command executes instantly — including disfluencies. The
  // panel shows the command; the typing box stays empty.
  await emit(page, "Hey, Airo. Uh, add a circle.");
  await expect(page.getByTestId("copilot-transcript")).toContainText("Uh, add a circle.");
  await expect(page.getByTestId("intent-command-input")).toHaveValue("");
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
    (window as unknown as AirboardTestWindow).__airboardTestHooks.openPttGate(),
  );
  await emit(page, "add a database, uh, layer that is connected to service.");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(3);
  await expect(page.getByTestId("copilot-activity")).toContainText("Board updated");

  await page.getByRole("button", { name: "Hide Airo panel" }).click();
  await expect(copilot).toHaveCount(0);
  const reopen = page.getByTestId("canvas-copilot-toggle");
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByTestId("canvas-copilot")).toBeVisible();
  await expect(page.getByTestId("intent-command-input")).toBeVisible();
});

test("open-palm swipe motion is inert and voice undo restores the board", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, add a user here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(1);

  const movingPalm = (x: number, timestampMs: number) =>
    page.evaluate(
      ({ x, timestampMs }) =>
        (window as unknown as AirboardTestWindow)
          .__airboardTestHooks.emitPalmVoiceGestureFrame({
            score: 0.92,
            point: { x, y: 0.45 },
            timestampMs,
            suppressed: false,
          }),
      { x, timestampMs },
    );
  expect(await movingPalm(0.2, 0)).toBeNull();
  expect(await movingPalm(0.3, 80)).toBeNull();
  expect(await movingPalm(0.43, 190)).toBeNull();
  await expect.poll(async () => (await summary(page)).objectCount).toBe(1);
  await expect(page.getByTestId("copilot-activity")).not.toContainText(
    "Undo gesture applied",
  );

  await emit(page, "Airo, undo");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(0);
});

test("an open palm must hold for 400 ms, activates voice once, and releases cleanly", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  const palm = (
    timestampMs: number,
    score = 0.94,
    point: { x: number; y: number } | null = { x: 0.48, y: 0.42 },
  ) =>
    page.evaluate(
      ({ timestampMs, score, point }) =>
        (window as unknown as AirboardTestWindow)
          .__airboardTestHooks.emitPalmVoiceGestureFrame({
            score,
            point,
            timestampMs,
            suppressed: false,
          }),
      { timestampMs, score, point },
    );

  expect(await palm(0)).toBeNull();
  expect(await palm(200)).toBeNull();
  expect(await palm(233, 0, null)).toBeNull();
  expect(await palm(266)).toBeNull();
  expect(await palm(399)).toBeNull();
  await expect(page.getByTestId("voice-gate-pill")).toHaveCount(0);

  expect(await palm(400)).toBe("activate");
  await expect(page.getByTestId("voice-gate-pill")).toContainText("Open palm detected");
  expect(await palm(700)).toBeNull();

  expect(await palm(800, 0, null)).toBeNull();
  expect(await palm(1_020, 0, null)).toBeNull();
  expect(await palm(1_040, 0, null)).toBe("release");
  await expect(page.getByTestId("voice-gate-pill")).toHaveCount(0);
});

test("push-to-talk gate routes wake-word-free commands exactly once", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await page.evaluate(() =>
    (window as unknown as AirboardTestWindow).__airboardTestHooks.openPttGate(),
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

test("provider-final Data/Dataset wording updates an existing board and repeat finals are mutation-free", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, add a database named Golden Dataset here");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(1);
  await emit(page, "Airo, add a database named Historical Dataset right of selected");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(2);
  await emit(page, "Airo, add a process named Planner below selected");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(3);

  const providerFinal = {
    type: "transcription.final" as const,
    transcript:
      "Planner receives the additional context from the historical data and golden dataset.",
    provider: "deepgram",
    model: "flux-general-en",
    confidence: 0.7715,
    turnIndex: 21,
  };
  await page.evaluate(() =>
    (window as unknown as AirboardTestWindow)
      .__airboardTestHooks.openPttGate(),
  );
  const routed = await page.evaluate(
    (event) =>
      (window as unknown as AirboardTestWindow)
        .__airboardTestHooks.emitTranscriptionProviderEvent(event),
    providerFinal,
  );
  expect(routed.routed).toBe(true);
  await expect.poll(async () => (await summary(page)).objectCount).toBe(5);

  const beforeRepeat = await page.evaluate(() => {
    const testHooks = (window as unknown as AirboardTestWindow)
      .__airboardTestHooks;
    return {
      eventCount: testHooks.getBoardEventLog().length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  await page.evaluate(
    (event) =>
      (window as unknown as AirboardTestWindow)
        .__airboardTestHooks.emitTranscriptionProviderEvent(event),
    providerFinal,
  );
  await expect(page.locator(".intent-feedback")).toContainText(
    "already present",
  );
  await page.waitForTimeout(250);
  expect((await summary(page)).objectCount).toBe(5);
  const afterRepeat = await page.evaluate(() => {
    const testHooks = (window as unknown as AirboardTestWindow)
      .__airboardTestHooks;
    return {
      eventCount: testHooks.getBoardEventLog().length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  expect(afterRepeat).toEqual(beforeRepeat);
});

test("voice hides and restores the diagram while hidden edits stay suspended", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, hide diagram");
  await expect(page.locator("main.airboard-shell")).toHaveClass(/diagram-hidden/);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as AirboardTestWindow)
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
