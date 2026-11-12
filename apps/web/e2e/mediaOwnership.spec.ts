import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the standalone board's media policy. A standalone board starts
 * voice and hands as soon as it opens, asking the browser once for both;
 * there is no switch, and it never prompts for what the browser has blocked.
 */

declare global {
  interface Window {
    __gumCalls: number;
    __gumConstraints: MediaStreamConstraints[];
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

test("standalone keeps a quiet top bar and no Airo switch", async ({ page }) => {
  await spyOnGetUserMedia(page);
  await page.goto("/?testStandalone=1");

  const onboarding = page.getByRole("button", { name: "Got it" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();

  // The top bar holds only Share and one menu.
  const toolbar = page.locator(".canvas-toolbar");
  const controlOrder = await toolbar
    .locator(":scope > button, :scope > .canvas-more > button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim()),
    );
  expect(controlOrder).toEqual(["Share", "More board actions"]);

  // Voice and hands start on their own, so there is nothing to switch on.
  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot.getByRole("button", { name: /Airo voice and hand tracking/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Airo listening/ })).toHaveCount(0);

  // Undo, redo and hide are icons at the bottom left, level with the dock.
  const history = page.getByRole("toolbar", { name: "Undo, redo and hide" });
  for (const action of ["Undo", "Redo", "Hide diagram"]) {
    await expect(history.getByRole("button", { name: action, exact: true })).toBeVisible();
  }
  const historyBox = (await history.boundingBox())!;
  const dockBox = (await page.getByRole("toolbar", { name: "Board creation tools" }).boundingBox())!;
  expect(historyBox.x + historyBox.width).toBeLessThan(dockBox.x);
  expect(Math.abs(historyBox.y + historyBox.height - (dockBox.y + dockBox.height))).toBeLessThan(3);

  // Share is a menu: sharing with people and every export.
  await toolbar.getByRole("button", { name: "Share", exact: true }).click();
  for (const action of ["Share with people", "Export PDF", "Export PNG", "Copy image"]) {
    await expect(page.getByRole("menu", { name: "Share and export" }).getByRole("menuitem", { name: action })).toBeVisible();
  }

  // Everything else is one menu away.
  await toolbar.getByRole("button", { name: "More board actions" }).click();
  await expect(page.getByRole("menu", { name: "Share and export" })).toHaveCount(0);
  for (const action of [
    "Show a screen behind the board",
    "Board settings",
  ]) {
    await expect(page.getByRole("menuitem", { name: action })).toBeVisible();
  }
  for (const removedAction of [
    "Export PNG",
    "Export PDF",
    "Copy image",
    "Undo",
    "Redo",
    "Hide diagram",
    "Turn on Airo voice and hands",
    "Turn off Airo voice and hands",
    "Rename canvas",
    "Clear board",
    "Pause inputs",
    "Enable hands",
    "Start Airo listening",
  ]) {
    await expect(page.getByRole("menuitem", { name: removedAction })).toHaveCount(0);
  }
  await page.getByRole("menuitem", { name: "Board settings" }).click();
  await expect(page.locator("#canvas-settings")).toBeVisible();
  // Board settings report camera and microphone access, with nothing to press.
  const permissions = page.locator(".media-permission-section");
  await expect(permissions.locator(".media-permission-row")).toHaveCount(2);
  await expect(permissions.getByRole("button")).toHaveCount(0);

  // Phones keep the same two controls; they cannot share a screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(toolbar.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(history.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Export PNG" })).toBeVisible();
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "More board actions" }).click();
  await expect(page.getByTestId("screen-underlay-toggle")).toBeHidden();
});

test("a board asks for the camera as soon as it opens, without a click", async ({ page }) => {
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    window.__gumConstraints = [];
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async () => ({ state: "prompt" }),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        window.__gumCalls += 1;
        window.__gumConstraints.push(constraints);
        throw new DOMException("The person dismissed the prompt", "NotAllowedError");
      },
    });
  });

  await page.goto("/?testStandalone=1");
  await expect.poll(() => page.evaluate(() => window.__gumCalls)).toBe(1);
  // One prompt covers everything Airo can use here. (This test API has no
  // voice provider, so only the camera is asked for.)
  expect(await page.evaluate(() => window.__gumConstraints[0])).toMatchObject({ video: true });
  // A refusal isn't asked again on its own.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__gumCalls)).toBe(1);
});

test("a board never prompts for what the browser has blocked, and says so", async ({ page }) => {
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async () => ({ state: "denied" }),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        window.__gumCalls += 1;
        throw new Error("getUserMedia must not run while permission is denied");
      },
    });
  });

  await page.goto("/?testStandalone=1");
  await expect(page.getByTestId("canvas-copilot").getByText("Camera and microphone are blocked")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});
