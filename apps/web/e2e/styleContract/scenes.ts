import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { launchOptionsWith } from "../support/launchOptions";
import { signIn } from "../support/signedInApi";

/**
 * The page states the style safety net looks at, shared by the computed-style
 * contract (styleContract.spec.ts) and the screenshots
 * (styleContract.screenshots.spec.ts). Each scene puts a page into one state
 * and names the elements whose look must not change while the stylesheet
 * layers are merged and the board file is split.
 *
 * Elements are found by role, label or test id where the markup offers one,
 * and by today's class names otherwise; a refactor that renames a class has to
 * update the scene, which is the point.
 */

// A board built by the production diagram commands: Shopper → Checkout API → Orders DB.
export const checkoutFlow = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/shared-board.json"), "utf8"),
) as { title: string; state: unknown };

export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 375, height: 760 };

/**
 * A still, plain grey camera picture (one Y4M frame), so the camera behind
 * the board looks the same in every run instead of Chrome's moving test
 * pattern. Written to the OS temp folder; nothing is committed.
 */
function stillCameraFile() {
  const width = 320;
  const height = 240;
  const directory = resolve(tmpdir(), "airboard-style-contract");
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "still-camera.y4m");
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F1:1 Ip A1:1 C420jpeg\nFRAME\n`, "ascii");
  const luma = Buffer.alloc(width * height, 96);
  const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
  writeFileSync(path, Buffer.concat([header, luma, chroma]));
  return path;
}

/** A fake camera (a still picture) and microphone, so Airo starts the same way on every run and on CI. */
export const mediaUse = {
  launchOptions: launchOptionsWith([
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${stillCameraFile()}`,
  ]),
  permissions: ["camera", "microphone"],
};

export type ContractElement = {
  name: string;
  locate: (page: Page) => Locator;
  /**
   * Geometry that CSS alone fixes (no text inside decides it), in CSS px from
   * the viewport edges. Only for elements anchored to an edge, such as the
   * bottom-left history controls.
   */
  box?: Array<"left" | "top" | "right" | "bottom" | "width" | "height" | "centerX">;
};

export type SceneContext = {
  page: Page;
  context: BrowserContext;
  /** A second browser context (a guest), closed when the test ends. */
  newContext: () => Promise<BrowserContext>;
};

export type Scene = {
  name: string;
  viewport: { width: number; height: number };
  /** Puts the page into the state; returns the page to look at (a guest's, for the live link). */
  open: (scene: SceneContext) => Promise<Page>;
  elements: ContractElement[];
  /**
   * Parts of the screenshot that change between runs for reasons other than
   * styling. Next's dev badge is always removed (settle) and the camera is a
   * still picture (mediaUse).
   */
  mask?: (page: Page) => Locator[];
};

const css = (selector: string) => (page: Page) => page.locator(selector).first();

function boardSummary(page: Page) {
  return page.evaluate(() => {
    const hooks = (window as never as {
      __airboardTestHooks?: { getBoardSummary(): { labels: string[]; boardSessionId: string | null } };
    }).__airboardTestHooks;
    return hooks ? hooks.getBoardSummary() : null;
  });
}

/** A returning person: no first-run tour on the board. */
async function returning(context: BrowserContext) {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
}

/**
 * Waits until Airo's voice has finished starting: the panel's status line is
 * past "Starting…" and has not changed for a second. Where it lands depends
 * on the machine (listening with a provider key, a fallback without one); the
 * scenes only need it to stop moving.
 */
async function voiceSettled(page: Page) {
  const status = page.locator(".canvas-copilot-current");
  let last = "";
  let stableSince = Date.now();
  await expect
    .poll(
      async () => {
        const text = (await status.textContent()) ?? "";
        if (text !== last) {
          last = text;
          stableSince = Date.now();
        }
        return !/Starting/i.test(text) && Date.now() - stableSince >= 1_000;
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
}

/**
 * The signed-in checkout-flow board, loaded, live and saved, with Airo's voice
 * started. The panel is shown first so the voice start can be watched, then
 * hidden with its own button when the scene wants it hidden.
 */
async function openSavedBoard(page: Page, context: BrowserContext, options: { airo: "shown" | "hidden" }) {
  await returning(context);
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto(`/app/boards/${api.boardId(checkoutFlow.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await boardSummary(page))?.labels ?? [], { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["Shopper", "Checkout API", "Orders DB"]));
  await expect.poll(async () => (await boardSummary(page))?.boardSessionId ?? null, { timeout: 30_000 }).not.toBeNull();
  await expect(page.locator(".canvas-save-state")).toHaveClass(/\bsaved\b/, { timeout: 30_000 });
  // A phone starts with the panel hidden whatever was saved.
  if (!(await page.getByTestId("canvas-copilot").isVisible())) await page.getByTestId("canvas-copilot-toggle").click();
  await expect(page.getByTestId("canvas-copilot")).toBeVisible();
  await voiceSettled(page);
  if (options.airo === "hidden") {
    await page.getByRole("button", { name: "Hide Airo panel" }).click();
    await expect(page.getByTestId("canvas-copilot-toggle")).toBeVisible();
  }
  return api;
}

/** Drops a square from the dock onto an empty part of the board; it is left selected. */
async function addSquare(page: Page) {
  const canvas = page.locator("canvas.board-canvas");
  const box = (await canvas.boundingBox())!;
  await page.getByRole("toolbar", { name: "Board creation tools" }).getByRole("button", { name: "Shape", exact: true }).click();
  await page
    .getByRole("menu", { name: "Recent shapes and connectors" })
    .getByRole("menuitem", { name: "Square", exact: true })
    .dragTo(canvas, { targetPosition: { x: box.width * 0.75, y: box.height * 0.55 } });
  await expect(page.getByRole("complementary", { name: "Shape properties" })).toBeVisible();
}

// Elements every board scene shares.
const boardChrome: ContractElement[] = [
  { name: "board shell", locate: css("main.airboard-shell") },
  { name: "top bar", locate: css("header.canvas-topbar") },
  { name: "back link", locate: (page) => page.getByRole("link", { name: "Back to boards" }) },
  { name: "brand orbit", locate: css(".canvas-brand-orbit") },
  { name: "title", locate: css(".canvas-title-heading") },
  { name: "save state", locate: css(".canvas-save-state") },
  { name: "share button", locate: (page) => page.getByTestId("share-board") },
  { name: "more button", locate: (page) => page.getByRole("button", { name: "More board actions" }) },
  { name: "workspace", locate: css(".canvas-workspace") },
  { name: "board area", locate: (page) => page.getByRole("region", { name: "Airboard canvas" }) },
  { name: "canvas", locate: css("canvas.board-canvas") },
  {
    name: "history controls",
    locate: (page) => page.getByRole("toolbar", { name: "Undo, redo and hide" }),
    box: ["left", "bottom", "width", "height"],
  },
  { name: "undo button", locate: (page) => page.getByRole("button", { name: "Undo", exact: true }), box: ["width", "height"] },
  { name: "redo button", locate: (page) => page.getByRole("button", { name: "Redo", exact: true }) },
  { name: "hide diagram button", locate: (page) => page.getByTestId("diagram-visibility-menu-action") },
  { name: "dock", locate: (page) => page.getByRole("toolbar", { name: "Board creation tools" }), box: ["bottom", "centerX"] },
  { name: "dock group", locate: css(".creation-toolbar-group") },
  { name: "dock divider", locate: css(".catalog-dock-divider") },
  { name: "dock selected tool", locate: (page) => page.getByRole("button", { name: "Move, shortcut V" }) },
  { name: "dock tool", locate: (page) => page.getByRole("button", { name: "Sticky note, shortcut S" }) },
  { name: "dock menu caret", locate: css(".creation-menu-caret") },
  { name: "dock zoom value", locate: css(".canvas-zoom-value") },
  { name: "dock zoom in", locate: (page) => page.getByRole("button", { name: "Zoom in" }) },
];

const airoPanel: ContractElement[] = [
  { name: "airo panel", locate: (page) => page.getByTestId("canvas-copilot"), box: ["right", "width"] },
  { name: "airo header", locate: css(".canvas-copilot-header") },
  { name: "airo orbit", locate: css(".canvas-copilot-orbit") },
  { name: "airo hide button", locate: (page) => page.getByRole("button", { name: "Hide Airo panel" }) },
  { name: "airo heard", locate: (page) => page.getByTestId("copilot-transcript") },
  { name: "airo progress", locate: css(".canvas-copilot-progress") },
  { name: "airo section title", locate: css(".canvas-copilot-section-title") },
  { name: "airo composer", locate: css(".canvas-copilot-composer") },
  { name: "airo command input", locate: (page) => page.getByTestId("intent-command-input") },
  { name: "airo send", locate: (page) => page.getByTestId("intent-primary-action") },
  { name: "airo hint", locate: css(".canvas-copilot-hint") },
];

const marketingChrome: ContractElement[] = [
  { name: "header", locate: css("header.marketing-header") },
  { name: "brand", locate: css(".marketing-brand") },
  { name: "brand orbit", locate: css(".marketing-brand .brand-orbit") },
  { name: "release stage", locate: css(".release-stage") },
  { name: "nav link", locate: (page) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("link").first() },
  { name: "quiet button", locate: css(".marketing-actions .button-quiet") },
  { name: "primary button", locate: css(".marketing-actions .button-primary") },
];

const appChrome: ContractElement[] = [
  { name: "app shell", locate: css("div.app-shell") },
  { name: "app header", locate: css("header.app-header") },
  { name: "app brand", locate: css(".app-brand") },
  { name: "app brand orbit", locate: css(".app-brand .brand-orbit") },
  { name: "profile button", locate: css(".profile-button") },
  { name: "app main", locate: css(".app-main") },
  { name: "app content", locate: css("main.app-content") },
];

export const scenes: Scene[] = [
  {
    name: "landing",
    viewport: DESKTOP,
    open: async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".landing-hero")).toBeVisible();
      return page;
    },
    elements: [
      { name: "body", locate: css("body") },
      { name: "shell", locate: css(".marketing-shell") },
      ...marketingChrome,
      { name: "hero", locate: css(".landing-hero") },
      { name: "hero art", locate: css(".landing-hero-art") },
      { name: "hero wash", locate: css(".landing-hero-wash") },
      { name: "eyebrow", locate: css(".landing-copy .eyebrow") },
      { name: "hero heading", locate: css(".landing-copy h1") },
      { name: "hero heading em", locate: css(".landing-copy h1 em") },
      { name: "hero primary", locate: css(".hero-actions .button-primary") },
      { name: "hero quiet", locate: css(".hero-actions .button-quiet") },
      { name: "demo board", locate: css(".idea-demo-board") },
      { name: "journey step marker", locate: css(".idea-step-marker") },
      { name: "surface card", locate: css(".surface-card") },
      { name: "surface tag", locate: css(".surface-tags span") },
      { name: "proof strip", locate: css(".proof-strip") },
      { name: "cta panel", locate: css(".landing-cta") },
      { name: "footer", locate: css(".marketing-footer") },
      { name: "footer link", locate: css(".footer-links a") },
    ],
    mask: (page) => [page.locator(".idea-demo")],
  },
  {
    name: "landing-phone",
    viewport: PHONE,
    open: async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".landing-hero")).toBeVisible();
      return page;
    },
    elements: [
      ...marketingChrome,
      { name: "hero", locate: css(".landing-hero") },
      { name: "hero heading", locate: css(".landing-copy h1") },
      { name: "hero primary", locate: css(".hero-actions .button-primary") },
      { name: "surface card", locate: css(".surface-card") },
      { name: "footer", locate: css(".marketing-footer") },
    ],
  },
  {
    name: "home-empty",
    viewport: DESKTOP,
    open: async ({ page }) => {
      await signIn(page);
      await page.goto("/app");
      await expect(page.locator(".airboards-first-run")).toBeVisible({ timeout: 30_000 });
      return page;
    },
    elements: [
      ...appChrome,
      { name: "first run", locate: css(".airboards-first-run") },
      { name: "first run heading", locate: css(".airboards-first-run h1") },
      { name: "first run text", locate: css(".airboards-first-run p") },
      { name: "create button", locate: (page) => page.getByRole("link", { name: "Create Airboard" }) },
    ],
  },
  {
    name: "home-boards",
    viewport: DESKTOP,
    open: async ({ page }) => {
      await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
      await page.goto("/app");
      await expect(page.locator(".library-board-card")).toBeVisible({ timeout: 30_000 });
      return page;
    },
    elements: [
      ...appChrome,
      { name: "page heading", locate: css(".app-page-heading") },
      { name: "page heading title", locate: css(".app-page-heading h1") },
      { name: "create button", locate: (page) => page.getByRole("link", { name: "Create Airboard" }) },
      { name: "library toolbar", locate: css(".library-toolbar") },
      { name: "search", locate: (page) => page.getByLabel("Search Airboards") },
      { name: "board grid", locate: css(".board-grid") },
      { name: "board card", locate: css(".library-board-card") },
      { name: "board card link", locate: css(".board-card-link") },
      { name: "board thumbnail", locate: css(".board-thumbnail") },
      { name: "board card title", locate: css(".board-card-link strong") },
      { name: "board card meta", locate: css(".board-card-link small") },
      { name: "board actions", locate: (page) => page.getByRole("button", { name: `Actions for ${checkoutFlow.title}` }) },
    ],
    mask: (page) => [page.locator(".board-card-link small")],
  },
  {
    name: "settings",
    viewport: DESKTOP,
    open: async ({ page }) => {
      await signIn(page);
      await page.goto("/app/settings/preferences");
      await expect(page.locator(".settings-panel")).toBeVisible({ timeout: 30_000 });
      return page;
    },
    elements: [
      ...appChrome,
      { name: "settings layout", locate: css(".settings-layout") },
      { name: "settings nav", locate: (page) => page.getByRole("navigation", { name: "Settings" }) },
      { name: "settings nav heading", locate: css(".settings-layout nav h3") },
      { name: "settings nav link", locate: css(".settings-layout nav a:not(.active)") },
      { name: "settings nav active", locate: css(".settings-layout nav a.active") },
      { name: "panel", locate: css(".settings-panel") },
      { name: "eyebrow", locate: css(".settings-panel .eyebrow") },
      { name: "panel heading", locate: css(".settings-panel h1") },
      { name: "toggle", locate: css(".setting-toggle") },
      { name: "toggle input", locate: css(".setting-toggle input") },
      { name: "save button", locate: css(".settings-panel .button-primary") },
    ],
  },
  {
    name: "help-article",
    viewport: DESKTOP,
    open: async ({ page }) => {
      await page.goto("/help/integrations/google-meet");
      await expect(page.getByRole("heading", { level: 1, name: "Use Airboard in Google Meet" })).toBeVisible();
      return page;
    },
    elements: [
      { name: "help shell", locate: css(".help-shell") },
      { name: "help header", locate: css(".help-header") },
      { name: "help brand", locate: css(".help-brand") },
      { name: "help header button", locate: css(".help-header > .button") },
      { name: "article shell", locate: css(".help-article-shell") },
      { name: "topic nav", locate: css(".help-article-nav") },
      { name: "topic nav home", locate: css(".help-nav-home") },
      { name: "topic nav heading", locate: css(".help-article-nav h2") },
      { name: "topic link", locate: css(".help-topic-links a:not(.active)") },
      { name: "topic link active", locate: css(".help-topic-links a.active") },
      { name: "article", locate: css(".help-article") },
      { name: "breadcrumbs", locate: css(".help-breadcrumbs") },
      { name: "status badge", locate: css(".help-status") },
      { name: "article heading", locate: css(".help-article h1") },
      { name: "markdown", locate: css(".help-markdown") },
      { name: "markdown h2", locate: css(".help-markdown h2") },
      { name: "markdown list", locate: css(".help-markdown ol") },
      { name: "markdown code", locate: css(".help-markdown code") },
      { name: "markdown link", locate: css(".help-markdown a") },
    ],
  },
  {
    name: "board-airo-shown",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "shown" });
      return page;
    },
    elements: [...boardChrome, ...airoPanel],
  },
  {
    name: "board-airo-hidden",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "hidden" });
      return page;
    },
    elements: [
      ...boardChrome,
      { name: "airo show toggle", locate: (page) => page.getByTestId("canvas-copilot-toggle"), box: ["right"] },
    ],
  },
  {
    name: "board-share-menu",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "shown" });
      await page.getByTestId("share-board").click();
      await expect(page.getByRole("menu", { name: "Share and export" })).toBeVisible();
      return page;
    },
    elements: [
      { name: "share button open", locate: (page) => page.getByTestId("share-board") },
      { name: "share menu", locate: (page) => page.getByRole("menu", { name: "Share and export" }) },
      { name: "share people item", locate: (page) => page.getByTestId("share-board-people") },
      { name: "share menu item", locate: (page) => page.getByRole("menu", { name: "Share and export" }).getByRole("menuitem").last() },
      { name: "share menu separator", locate: css(".canvas-more-menu .canvas-more-separator") },
    ],
  },
  {
    name: "board-shape-selected",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "hidden" });
      await addSquare(page);
      return page;
    },
    elements: [
      { name: "shape toolbar", locate: (page) => page.getByRole("complementary", { name: "Shape properties" }) },
      { name: "shape fill swatch", locate: (page) => page.getByLabel("Fill color") },
      { name: "shape colours group", locate: (page) => page.getByRole("group", { name: "Colours" }) },
      { name: "shape bring forward", locate: (page) => page.getByRole("button", { name: "Bring forward" }) },
      { name: "shape delete", locate: (page) => page.getByRole("button", { name: "Delete element" }) },
      { name: "shape more", locate: (page) => page.getByRole("button", { name: "More shape options" }) },
      { name: "undo button enabled", locate: (page) => page.getByRole("button", { name: "Undo", exact: true }) },
    ],
  },
  {
    name: "board-undo-toast",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "shown" });
      await page.getByTestId("intent-command-input").fill("add a circle here");
      await page.getByTestId("intent-primary-action").click();
      await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });
      await expect(page.getByTestId("undo-toast")).toBeVisible();
      return page;
    },
    elements: [
      { name: "undo toast", locate: (page) => page.getByTestId("undo-toast") },
      { name: "undo toast detail", locate: css(".undo-toast-detail") },
      { name: "undo toast action", locate: (page) => page.getByTestId("undo-toast").getByRole("button").first() },
      { name: "airo feedback", locate: css(".intent-feedback") },
      { name: "airo activity", locate: (page) => page.getByTestId("copilot-activity") },
      { name: "airo activity entry", locate: (page) => page.getByTestId("copilot-activity").locator("li").last() },
      { name: "airo activity source", locate: css(".copilot-activity-source") },
    ],
  },
  {
    name: "board-notice",
    viewport: DESKTOP,
    open: async ({ page, context }) => {
      const api = await openSavedBoard(page, context, { airo: "shown" });
      // Another tab saves first, so the next save stops and asks.
      api.saveElsewhere(api.boardId(checkoutFlow.title));
      await page.getByTestId("intent-command-input").fill("add a circle here");
      await page.getByTestId("intent-primary-action").click();
      await expect(page.getByRole("alert").filter({ hasText: "changed in another tab" })).toBeVisible({ timeout: 20_000 });
      return page;
    },
    elements: [
      { name: "conflict notice", locate: (page) => page.getByRole("alert").filter({ hasText: "changed in another tab" }) },
      {
        name: "conflict keep button",
        locate: (page) => page.getByRole("alert").filter({ hasText: "changed in another tab" }).getByRole("button", { name: "Keep my version" }),
      },
      { name: "save state conflict", locate: css(".canvas-save-state") },
      { name: "airo feedback", locate: css(".intent-feedback") },
    ],
  },
  {
    name: "live-guest",
    viewport: DESKTOP,
    open: async ({ page, context, newContext }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3100" });
      await openSavedBoard(page, context, { airo: "shown" });
      await page.getByTestId("share-board").click();
      await page.getByTestId("share-board-people").click();
      const dialog = page.getByRole("dialog", { name: `Share “${checkoutFlow.title}”` });
      await expect(
        dialog.getByRole("radiogroup", { name: "What people with the live link can do" }).getByRole("radio", { name: /Can view/ }),
      ).toBeChecked({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Copy live link" }).click();
      await expect(dialog.getByRole("button", { name: "Link copied" })).toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      const guestContext = await newContext();
      const guest = await guestContext.newPage();
      await guest.goto(link);
      await expect(guest.getByRole("heading", { level: 1, name: "Live board" })).toBeVisible({ timeout: 30_000 });
      await expect(guest.getByText("View only", { exact: true })).toBeVisible();
      return guest;
    },
    elements: [
      { name: "shared board", locate: css("main.shared-board") },
      { name: "bar", locate: css(".shared-board-bar") },
      { name: "brand", locate: css(".shared-board-bar .marketing-brand") },
      { name: "title", locate: css(".shared-board-title h1") },
      { name: "view only badge", locate: css(".shared-board-badge") },
      { name: "zoom group", locate: css(".shared-board-zoom") },
      { name: "zoom button", locate: css(".shared-board-zoom button") },
      { name: "leave button", locate: (page) => page.getByRole("link", { name: "Leave" }) },
      { name: "notice", locate: css(".shared-board-notice") },
      { name: "canvas", locate: css("canvas.shared-board-canvas") },
    ],
  },
  {
    name: "board-phone",
    viewport: PHONE,
    open: async ({ page, context }) => {
      await openSavedBoard(page, context, { airo: "hidden" });
      return page;
    },
    elements: [
      { name: "top bar", locate: css("header.canvas-topbar") },
      { name: "title", locate: css(".canvas-title-heading") },
      { name: "share button", locate: (page) => page.getByTestId("share-board") },
      { name: "board area", locate: (page) => page.getByRole("region", { name: "Airboard canvas" }) },
      { name: "history controls", locate: (page) => page.getByRole("toolbar", { name: "Undo, redo and hide" }), box: ["left", "bottom"] },
      { name: "dock", locate: (page) => page.getByRole("toolbar", { name: "Board creation tools" }), box: ["bottom"] },
      { name: "dock tool", locate: (page) => page.getByRole("button", { name: "Sticky note, shortcut S" }) },
      { name: "airo show toggle", locate: (page) => page.getByTestId("canvas-copilot-toggle"), box: ["right"] },
    ],
  },
];

/**
 * Opens a scene on the test's page. Guests' browser contexts (the live link)
 * are closed by the returned close().
 */
export async function openScene(scene: Scene, page: Page, context: BrowserContext, browser: Browser) {
  const guests: BrowserContext[] = [];
  await page.setViewportSize(scene.viewport);
  const target = await scene.open({
    page,
    context,
    newContext: async () => {
      const guest = await browser.newContext({
        viewport: scene.viewport,
        // A guest who already answered the cookie banner, as the suite's own pages have.
        storageState: {
          cookies: [],
          origins: [{ origin: "http://127.0.0.1:3100", localStorage: [{ name: "airboard.cookie-choice.v1", value: "necessary" }] }],
        },
      });
      guests.push(guest);
      return guest;
    },
  });
  return { target, close: () => Promise.all(guests.map((guest) => guest.close())) };
}

export function scene(name: string): Scene {
  const found = scenes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No style scene named ${name}`);
  return found;
}

/**
 * Settles the page: web fonts loaded, finite animations and transitions
 * jumped to their end, endless ones stopped (as Playwright does for
 * screenshots) and the pointer parked in a corner. Next's dev-mode badge (a
 * dev-server overlay, not the product) is removed; its own shadow styles
 * would beat any stylesheet that tried to hide it.
 */
export async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    document.querySelectorAll("nextjs-portal").forEach((overlay) => overlay.remove());
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming();
      if (timing && Number.isFinite(timing.endTime as number)) animation.finish();
      else animation.cancel();
    }
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
