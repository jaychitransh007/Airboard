import { expect, test } from "@playwright/test";

/**
 * E2E path: the Meet media bridge. The harness emulates the bridge extension
 * (the real one is a meet.google.com content script, which Playwright cannot
 * host), Chromium supplies a fake camera, and the full pipeline runs: probe →
 * entry points appear → explicit start → frames stream over postMessage →
 * canvas capture stream → hand tracker active.
 */

test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

test("the bridge restores embedded gesture on the Meet main stage", async ({ page }) => {
  await page.goto("/meet/test-harness?bridge=emulate");

  // The probe detects the (emulated) extension: gesture onboarding and the
  // camera entry point appear; voice stays off this surface; no companion
  // link is needed.
  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible({ timeout: 10_000 });
  await onboarding.click();

  const enableHands = page.getByRole("button", { name: /Enable hand tracking/ });
  await expect(enableHands).toBeVisible();
  await expect(page.getByRole("button", { name: /Airo listening/ })).toHaveCount(0);
  await expect(page.getByTestId("companion-media-link")).toHaveCount(0);

  // Explicit start: bridge frames feed the tracker until the camera is On.
  await enableHands.click();
  await expect(page.locator(".status-grid").getByText("On", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Frames are really flowing into the preview element via the canvas stream.
  await expect
    .poll(
      () =>
        page
          .locator("video.camera-preview")
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  // Explicit stop tears the session down.
  await page.getByRole("button", { name: /Turn off the camera/ }).click();
  await expect(page.locator(".status-grid").getByText("Off", { exact: true })).toBeVisible();
});

test("the side panel explains the bridge instead of the companion window", async ({ page }) => {
  await page.goto("/meet/test-harness?surface=side-panel&bridge=emulate");

  await expect(page.getByText("Gesture is on the shared board")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("companion-media-link")).toHaveCount(0);
});
