import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the embedded media-capture policy. Meeting surfaces offer
 * gesture/voice entry points only when the host client delegates
 * camera/microphone permission to the add-on frame ("embedded"); otherwise
 * the companion window — bound to the same board session — is the
 * gesture/voice surface. Capture never auto-starts anywhere, and the
 * standalone surface keeps full media input. The harness emulates both
 * delegation outcomes because the real Meet iframe cannot run in Playwright.
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

test("undelegated main stage offers the companion window instead of media buttons", async ({
  page,
}) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness");

  await expect(page.locator("main.airboard-meet-embedded")).toBeVisible();
  await expect(page.locator(".onboarding-overlay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Airo listening/ })).toHaveCount(0);

  // The companion link binds to the live board session once sync connects.
  const companion = page.getByTestId("companion-media-link").first();
  await expect(companion).toBeVisible({ timeout: 15_000 });
  await expect(companion).toHaveAttribute("href", /\/\?boardSessionId=.+/);

  // The typed fallback is a working input path, not a dead end.
  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  // The V push-to-talk shortcut is inert without delegation.
  await page.locator("body").press("v");

  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});

test("delegated main stage restores gesture and voice entry points without auto-starting capture", async ({
  page,
}) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness?media=embedded");

  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Airo listening/ })).toBeVisible();
  await expect(page.getByTestId("companion-media-link")).toHaveCount(0);

  // Entry points exist, but nothing captures until the user acts.
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});

test("undelegated side panel stays compact and routes media to the companion window", async ({
  page,
}) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness?surface=side-panel");

  await expect(page.locator(".airboard-meet-panel")).toBeVisible();
  await expect(page.getByText("Gesture and voice run in a companion window")).toBeVisible();
  await expect(page.getByTestId("companion-media-link")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("canvas")).toHaveCount(0);

  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});

test("delegated side panel stays compact and points at the shared board", async ({ page }) => {
  await spyOnGetUserMedia(page);
  await page.goto("/meet/test-harness?surface=side-panel&media=embedded");

  await expect(page.locator(".airboard-meet-panel")).toBeVisible();
  await expect(page.getByText("Gesture and voice on the shared board")).toBeVisible();
  await expect(page.getByTestId("companion-media-link")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);

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
