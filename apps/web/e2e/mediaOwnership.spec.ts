import { expect, test, type Page } from "@playwright/test";

/**
 * E2E path: the embedded media-capture policy. Meeting surfaces offer
 * gesture/voice entry points only when the host client delegates
 * camera/microphone permission to the add-on frame ("embedded"); otherwise
 * the companion window — bound to the same board session — is the
 * gesture/voice surface. Meeting capture never auto-starts. Standalone
 * capture resumes only after the user enabled it and the browser reports an
 * existing persistent grant. The harness emulates both delegation outcomes
 * because the real Meet iframe cannot run in Playwright.
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
  await expect(companion).toHaveAttribute("href", /\/live\/[^/?]+\?joinToken=.+/);

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

test("standalone keeps a quiet top bar and one Airo entry point", async ({ page }) => {
  await spyOnGetUserMedia(page);
  await page.goto("/?testStandalone=1");

  const onboarding = page.getByRole("button", { name: "Start building" });
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

  // Airo's single switch lives on the Airo panel: camera and voice together.
  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot.getByRole("button", { name: "Enable Airo voice and hand tracking" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Enable hand tracking/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Airo listening/ })).toHaveCount(0);

  // Everything else is one menu away, and nothing captures until asked.
  await toolbar.getByRole("button", { name: "More board actions" }).click();
  for (const action of [
    "Turn on Airo voice and hands",
    "Show a screen behind the board",
    "Undo",
    "Redo",
    "Hide diagram",
    "Export PNG",
    "Board settings",
  ]) {
    await expect(page.getByRole("menuitem", { name: action })).toBeVisible();
  }
  for (const removedAction of [
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
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);

  // Phones keep the same two controls; they cannot share a screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(toolbar.getByRole("button", { name: "Share" })).toBeVisible();
  await toolbar.getByRole("button", { name: "More board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Undo" })).toBeVisible();
  await expect(page.getByTestId("screen-underlay-toggle")).toBeHidden();
});

test("standalone resumes a previously enabled camera when site permission is already granted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    window.localStorage.setItem("airboard.media-resume.v1.camera", "enabled");
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async ({ name }: PermissionDescriptor) => ({
        state: name === "camera" ? "granted" : "prompt",
      }),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        window.__gumCalls += 1;
        throw new DOMException("Synthetic device failure after acquisition attempt", "NotReadableError");
      },
    });
  });

  await page.goto("/?testStandalone=1");
  await expect.poll(() => page.evaluate(() => window.__gumCalls)).toBe(1);
});

test("standalone never opens a surprise prompt when remembered permission is not granted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__gumCalls = 0;
    window.localStorage.setItem("airboard.media-resume.v1.camera", "enabled");
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async () => ({ state: "prompt" }),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        window.__gumCalls += 1;
        throw new Error("getUserMedia must not run while permission is prompt");
      },
    });
  });

  await page.goto("/?testStandalone=1");
  await expect(
    page.getByRole("button", { name: "Enable Airo voice and hand tracking" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0);
});
