import { promises as fs } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the lightboard (neon-on-dark) theme on the standalone surface —
 * step 1 of Docs/"Lightboard Mode Feasibility and Design Directions.md".
 * Asserts real pixels, not just classes: classic paints an opaque white
 * board; lightboard leaves the canvas transparent over the DOM stage and
 * renders content as bright neon; camera and selected-screen underlays sit
 * behind the board with correct mirroring/fit; preferences persist.
 */

test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

async function openStandalone(page: Page) {
  // The public root is now the acquisition site. This guarded mount is
  // compiled only when the Playwright server enables test hooks.
  await page.goto("/?testStandalone=1");
  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  const cookieChoice = page.getByRole("button", { name: "Necessary only" });
  if (await cookieChoice.isVisible()) await cookieChoice.click();
  // Advanced appearance and studio controls intentionally live in the
  // closed-by-default board settings drawer.
  await page.getByRole("button", { name: "Open board settings" }).click();
}

async function installFakeScreenCapture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 540;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#f8fafc";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#2563eb";
        context.fillRect(70, 70, 360, 220);
        context.fillStyle = "#111827";
        context.font = "48px sans-serif";
        context.fillText("Shared screen", 500, 180);
        const stream = canvas.captureStream(30);
        (window as unknown as { __airboardFakeDisplayStream?: MediaStream }).__airboardFakeDisplayStream =
          stream;
        return stream;
      },
    });
  });
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
  // Neon is the product default; this assertion deliberately exercises the
  // user-selectable classic rendering branch.
  await page.getByLabel("Lightboard (neon) theme").uncheck();
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

test("the board-dimming slider drives the scrim, defaulting to a real dim", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  // Camera mode uses a bounded dark-glass canvas that keeps both the
  // presenter and the diagram legible.
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.6");
  await expect(page.getByTestId("scrim-value")).toHaveText("60%");
  await page.getByLabel("Dark overlay").fill("0.55");
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.55");
  await expect(page.getByTestId("scrim-value")).toHaveText("55%");
});

test("a selected screen becomes the unmirrored underlay and survives presentation mode", async ({
  page,
}) => {
  await installFakeScreenCapture(page);
  await openStandalone(page);

  await page.getByTestId("screen-underlay-toggle").click();
  await expect(page.getByLabel("Lightboard (neon) theme")).toBeChecked();
  await expect(page.getByTestId("screen-underlay-status")).toContainText("live");
  await expect(page.getByTestId("screen-underlay")).toHaveClass(/active/);
  await expect(page.getByTestId("screen-underlay")).toHaveCSS("object-fit", "contain");
  await expect(page.getByTestId("screen-underlay")).toHaveCSS("transform", "none");
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.25");
  await expect(page.getByTestId("local-contrast-plates")).toBeChecked();
  await expect
    .poll(
      () =>
        page
          .getByTestId("screen-underlay")
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 10_000 },
    )
    .toBe(960);

  await expect(page.getByTestId("screen-underlay")).toHaveClass(/active/);

  // Browser or OS-level "Stop sharing" must release capture and leave the
  // ordinary canvas visible so the presenter sees recovery.
  await page.evaluate(() => {
    const track = (window as unknown as { __airboardFakeDisplayStream?: MediaStream })
      .__airboardFakeDisplayStream?.getVideoTracks()[0];
    track?.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator("header.topbar")).toBeVisible();
  await expect(page.getByTestId("screen-underlay-status")).toContainText("not selected");
  await expect(page.getByTestId("screen-underlay-notice")).toContainText("Screen sharing ended");
  const readyState = await page.evaluate(
    () =>
      (window as unknown as { __airboardFakeDisplayStream?: MediaStream })
        .__airboardFakeDisplayStream?.getVideoTracks()[0]?.readyState,
  );
  expect(readyState).toBe("ended");
});

test("camera, dark scrim, and diagrams keep their strict layer order", async ({ page }) => {
  await page.addInitScript(() => {
    // Regression: the old shared key was lowered by Use screen and then leaked
    // into camera mode, producing an almost-undimmed camera.
    localStorage.setItem("airboard.scrim.v1", "0.25");
    localStorage.setItem("airboard.underlay.v1", "off");
  });
  await openStandalone(page);

  await page.getByRole("button", { name: "Enable Airo voice and hand tracking" }).click();
  await expect(page.getByLabel("Lightboard (neon) theme")).toBeChecked();
  await expect(page.getByLabel("Camera behind the dark canvas")).toBeChecked();
  await expect(page.getByTestId("scrim-value")).toHaveText("60%");
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.6");
  await expect
    .poll(
      () =>
        page
          .getByTestId("lightboard-underlay")
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("lightboard-underlay")).toHaveCSS("object-fit", "cover");
  await expect(page.getByTestId("lightboard-underlay")).toHaveCSS(
    "transform",
    "matrix(-1, 0, 0, 1, 0, 0)",
  );

  // The visible camera, scrim, and gesture plane use one fitted rectangle. A
  // former 10px mismatch made edge gestures drift.
  const fittedLayers = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      board: rect("canvas.board-canvas"),
      camera: rect('[data-testid="lightboard-underlay"]'),
      scrim: rect('[data-testid="lightboard-scrim"]'),
    };
  });
  expect(fittedLayers.camera).toEqual(fittedLayers.board);
  expect(fittedLayers.scrim).toEqual(fittedLayers.board);
  await expect(page.getByTestId("person-occlusion-layer")).toHaveCount(0);
  await expect(page.getByTestId("person-occlusion-toggle")).toHaveCount(0);
  const layerOrder = await page.evaluate(() => ({
    camera: Number(getComputedStyle(document.querySelector('[data-testid="lightboard-underlay"]')!).zIndex),
    scrim: Number(getComputedStyle(document.querySelector('[data-testid="lightboard-scrim"]')!).zIndex),
    board: Number(getComputedStyle(document.querySelector("canvas.board-canvas")!).zIndex),
  }));
  expect(layerOrder).toEqual({ camera: 0, scrim: 2, board: 3 });
  // The corner self-preview is redundant while the underlay is on.
  await expect(page.locator("video.camera-preview")).toHaveClass(/hidden/);
});

test("studio records the composite to a local webm download", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  await page.getByRole("button", { name: "Enable Airo voice and hand tracking" }).click();

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  await page.getByTestId("studio-record").click();
  await expect(page.getByTestId("recording-badge")).toBeVisible();
  // Capture a couple of seconds of composite frames + fake microphone.
  await page.waitForTimeout(2500);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("studio-record").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^airboard-lightboard-\d{8}-\d{6}\.webm$/);
  const filePath = await download.path();
  const stats = await fs.stat(filePath!);
  expect(stats.size).toBeGreaterThan(5_000);
  await expect(page.getByTestId("recording-badge")).toHaveCount(0);
});

test("standalone canvas has no presentation workflow", async ({ page }) => {
  await openStandalone(page);
  await expect(page.getByTestId("present-toggle")).toHaveCount(0);
  await expect(page.getByTestId("presentation-setup")).toHaveCount(0);
  await expect(page.locator("header.topbar")).toBeVisible();
});

test("local contrast plates darken only diagram clusters over a shared screen", async ({
  page,
}) => {
  await installFakeScreenCapture(page);
  await openStandalone(page);
  await page.getByTestId("screen-underlay-toggle").click();

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.board-canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const corner = [...context.getImageData(2, 2, 1, 1).data];
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPlatePixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        data[index + 3]! > 100 &&
        Math.max(data[index]!, data[index + 1]!, data[index + 2]!) < 45
      ) {
        darkPlatePixels += 1;
      }
    }
    return { corner, darkPlatePixels };
  });
  expect(pixels.corner[3]).toBe(0);
  expect(pixels.darkPlatePixels).toBeGreaterThan(500);
});

test("desktop mode is a full-display transparent canvas with explicit click-through controls", async ({
  page,
}) => {
  // Exercise the general <=900px responsive breakpoint as well as desktop
  // mode; the native layer must never inherit the ordinary mobile canvas cap.
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/?desktopOverlay=1");

  const shell = page.locator("main.airboard-shell.desktop-overlay");
  await expect(shell).toBeVisible();
  await expect(page.locator("header.topbar")).not.toBeVisible();
  await expect(page.locator("aside.sidebar")).not.toBeVisible();
  await expect(page.locator(".catalog-dock")).not.toBeVisible();
  await expect(page.getByTestId("screen-underlay")).toHaveCount(0);
  await expect(page.getByTestId("lightboard-underlay")).toHaveCount(0);
  await expect(page.getByTestId("desktop-overlay-controls")).toBeVisible();
  await expect(page.getByTestId("lightboard-scrim")).toHaveCSS("opacity", "0.6");

  const layout = await page.evaluate(() => {
    const selectors = [
      ".airboard-shell",
      ".content",
      ".board-area",
      ".board-canvas",
      ".lightboard-scrim",
    ];
    return {
      viewportHeight: window.innerHeight,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      layers: selectors.map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, top: rect.top, bottom: rect.bottom, height: rect.height };
      }),
    };
  });
  expect(layout.bodyBackground).toBe("rgba(0, 0, 0, 0)");
  for (const layer of layout.layers) {
    expect(layer.top, layer.selector).toBe(0);
    expect(layer.bottom, layer.selector).toBe(layout.viewportHeight);
    expect(layer.height, layer.selector).toBe(layout.viewportHeight);
  }

  const [, , , alpha] = await cornerPixel(page);
  expect(alpha).toBe(0);

  // In a browser preview there is no native bridge, but this exercises the
  // same renderer transition the Electron shortcut invokes.
  await page.getByRole("button", { name: "Return to click-through" }).click();
  await expect(page.getByTestId("desktop-overlay-controls")).toHaveCount(0);
  await expect(page.getByTestId("desktop-overlay-badge")).toHaveCount(0);
  await expect(shell).toHaveClass(/broadcast-safe/);
});

test("theme choice survives a reload", async ({ page }) => {
  await openStandalone(page);
  await page.getByLabel("Lightboard (neon) theme").check();
  await page.reload();
  await page.getByRole("button", { name: "Open board settings" }).click();
  await expect(page.getByLabel("Lightboard (neon) theme")).toBeChecked();
  await expect(page.locator("section.board-area.lightboard")).toBeVisible();
});
