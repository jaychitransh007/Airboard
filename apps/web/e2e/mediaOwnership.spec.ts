import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the Meet media-ownership invariant. Embedded Meet surfaces must
 * never start Airboard camera or microphone capture — Google Meet owns media
 * there — while the standalone surface keeps its media entry points. The
 * gating lives in AirboardPrototype; this is the regression guard that keeps
 * a refactor from silently dropping it.
 */

declare global {
  interface Window {
    __gumCalls: number;
  }
}

// Installed before any app code runs: every getUserMedia call is counted.
async function spyOnGetUserMedia(page: Page) {
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia) {
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = (constraints) => {
        window.__gumCalls += 1;
        return original(constraints);
      };
    }
  });
}

test("meet main stage offers no media entry points and never calls getUserMedia", async ({
  page,
}) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness");

  // Meet-embedded chrome, no gesture onboarding, no media buttons.
  await expect(page.locator("main.airboard-meet-embedded")).toBeVisible();
  await expect(page.locator(".onboarding-overlay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Airo listening/ })).toHaveCount(0);
  await expect(page.getByText(/Google Meet.s controls for camera and microphone/)).toBeVisible();

  // The typed fallback is a working input path, not a dead end.
  const input = page.getByTestId("intent-command-input");
  await expect(input).toBeVisible();
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  // The V push-to-talk shortcut is inert on Meet surfaces.
  await page.locator("body").press("v");

  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});

test("meet side panel is a compact launch view with no board canvas or media", async ({
  page,
}) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness?surface=side-panel");

  await expect(page.locator(".airboard-meet-panel")).toBeVisible();
  await expect(page.getByText("Meet controls camera and microphone")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toHaveCount(0);

  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});

test("standalone keeps its camera and voice entry points", async ({ page }) => {
  await spyOnGetUserMedia(page);
  await page.goto("/");

  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();

  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Airo listening/ })).toBeVisible();
  // Nothing auto-starts capture; media remains user-initiated on standalone.
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});
