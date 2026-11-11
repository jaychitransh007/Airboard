import { expect, test } from "@playwright/test";
import { launchOptionsWith } from "./support/launchOptions";

/**
 * E2E path: the Meet media bridge feeding the headless overlay engine. The
 * harness emulates the bridge extension (the real one is a meet.google.com
 * content script, which Playwright cannot host), Chromium supplies a fake
 * camera, and the full pipeline runs: probe → frames stream over postMessage
 * → canvas capture stream → hand tracker active → board frames pumped to the
 * camera compositor.
 */

test.use({
  launchOptions: launchOptionsWith(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]),
});

test("the extension engine is control-free and starts the camera overlay automatically", async ({
  page,
}) => {
  await page.goto("/meet/test-harness?bridge=emulate&headless=1");

  const engine = page.locator("main.airboard-shell.meet-overlay-engine");
  await expect(engine).toBeVisible({ timeout: 10_000 });
  await expect(engine.locator(".topbar")).toBeHidden();
  await expect(engine.locator(".sidebar")).toBeHidden();
  await expect(engine.locator(".catalog-dock")).toBeHidden();
  await expect(engine.getByRole("button")).toHaveCount(0);
  await expect(page.locator("section.board-area.lightboard")).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => (window as { __overlayArmed?: boolean }).__overlayArmed))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as { __overlayFrames?: number }).__overlayFrames ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(3);
  await expect
    .poll(
      () =>
        page
          .locator("video.camera-preview")
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
});

test("hidden diagram restores raw Meet camera and resumes the compositor without recapturing", async ({
  page,
}) => {
  await page.goto("/meet/test-harness?bridge=emulate&headless=1");
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(() => page.evaluate(() => (window as { __overlayFrames?: number }).__overlayFrames ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(3);

  await page.evaluate(() =>
    (
      window as unknown as {
        __airboardTestHooks: { setDiagramVisible(visible: boolean): void };
      }
    ).__airboardTestHooks.setDiagramVisible(false),
  );
  await expect
    .poll(() => page.evaluate(() => (window as { __overlayArmed?: boolean }).__overlayArmed))
    .toBe(false);
  const hiddenFrameCount = await page.evaluate(
    () => (window as { __overlayFrames?: number }).__overlayFrames ?? 0,
  );
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => (window as { __overlayFrames?: number }).__overlayFrames ?? 0),
  ).toBe(hiddenFrameCount);
  await expect
    .poll(() =>
      page
        .locator("video.camera-preview")
        .evaluate((element) =>
          ((element as HTMLVideoElement).srcObject as MediaStream | null)
            ?.getVideoTracks()[0]?.readyState,
        ),
    )
    .toBe("live");

  await page.evaluate(() =>
    (
      window as unknown as {
        __airboardTestHooks: { setDiagramVisible(visible: boolean): void };
      }
    ).__airboardTestHooks.setDiagramVisible(true),
  );
  await expect
    .poll(() => page.evaluate(() => (window as { __overlayArmed?: boolean }).__overlayArmed))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as { __overlayFrames?: number }).__overlayFrames ?? 0))
    .toBeGreaterThan(hiddenFrameCount);
});
