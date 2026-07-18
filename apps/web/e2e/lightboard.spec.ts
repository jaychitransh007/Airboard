import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the lightboard (neon-on-dark) theme on the standalone surface —
 * step 1 of Docs/"Lightboard Mode Feasibility and Design Directions.md".
 * Asserts real pixels, not just classes: classic paints an opaque white
 * board; lightboard leaves the canvas transparent over the DOM stage and
 * renders content as bright neon; the camera underlay puts the presenter
 * behind the board; preferences persist.
 */

test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

async function openStandalone(page: Page) {
  await page.goto("/");
  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
}

function cornerPixel(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas.board-canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(2, 2, 1, 1);
    return [data[0], data[1], data[2], data[3]];
  });
}

test("classic theme paints an opaque white board", async ({ page }) => {
  await openStandalone(page);
  expect(await cornerPixel(page)).toEqual([255, 255, 255, 255]);
});

test("lightboard theme: transparent canvas over a dark stage with neon content", async ({
  page,
}) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();

  await expect(page.locator("section.board-area.lightboard")).toBeVisible();
  await expect(page.getByTestId("lightboard-scrim")).toBeVisible();

  // The canvas no longer paints its own background.
  const [, , , alpha] = await cornerPixel(page);
  expect(alpha).toBe(0);

  // Content renders bright (adapted ink + additive glow), never dark-on-dark.
  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  const brightest = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.board-canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! > 40) {
        max = Math.max(max, data[index]!, data[index + 1]!, data[index + 2]!);
      }
    }
    return max;
  });
  expect(brightest).toBeGreaterThan(180);
});

test("the board-dimming slider drives the scrim", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  await page.getByLabel("Board dimming").fill("0.3");
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.3");
});

test("camera underlay puts the presenter behind the board", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  await expect(page.getByLabel("Camera behind board")).toBeChecked();

  await page.getByRole("button", { name: /Enable hand tracking/ }).click();
  await expect
    .poll(
      () =>
        page
          .getByTestId("lightboard-underlay")
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  // The corner self-preview is redundant while the underlay is on.
  await expect(page.locator("video.camera-preview")).toHaveClass(/hidden/);
});

test("theme choice survives a reload", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  await page.reload();
  await expect(page.getByLabel("Lightboard (neon) theme")).toBeChecked();
  await expect(page.locator("section.board-area.lightboard")).toBeVisible();
});
