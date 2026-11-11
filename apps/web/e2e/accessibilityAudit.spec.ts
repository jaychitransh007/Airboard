import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./support/signedInApi";

// The release accessibility audit (Docs/Accessibility Audit.md), kept as
// tests: WCAG 2.2 AA rules on every non-media page at desktop and phone
// widths, one h1 and one main landmark, a page title of its own, reflow at
// 320 CSS px, visible keyboard focus, focus that comes back after menus and
// dialogs close, and reduced motion.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SITE_TITLE = "Airboard — let ideas flow into view";
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8")) as {
  title: string;
  state: unknown;
};
const sharedBoardBody = readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8");

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function axeViolations(page: Page, include?: string) {
  // Let entrance animations (a menu scaling in, say) settle, so sizes and colours are final.
  await page
    .waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5_000 })
    .catch(() => undefined);
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  return violations.map(
    (violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}

/** Content wider than the viewport, outside the containers that scroll on purpose (tables, tab rows). */
function overflowingContent(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return [];
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || getComputedStyle(element).visibility === "hidden") return false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth + 1) return false;
        }
        return box.right > width + 1;
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
  });
}

/** WCAG checks for a page that has finished loading. */
async function auditPage(page: Page, where: string, options: { siteTitle?: boolean } = {}) {
  await expect(page.getByRole("main"), `${where} has one main landmark`).toHaveCount(1);
  await expect(page.locator("h1"), `${where} has one h1`).toHaveCount(1);
  if (!options.siteTitle) expect(await page.title(), `${where} names itself in the title`).not.toBe(SITE_TITLE);
  expect(await axeViolations(page), `WCAG violations on ${where} at 1280px`).toEqual([]);

  // 320 CSS px is a 1280px window at 400% zoom; 640 is 200%.
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect.poll(() => overflowingContent(page), { message: `${where} reflows at ${width}px` }).toEqual([]);
  }
  expect(await axeViolations(page), `WCAG violations on ${where} at 320px`).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
}

const PUBLIC_PAGES: Array<{ path: string; siteTitle?: boolean }> = [
  { path: "/", siteTitle: true },
  { path: "/product" },
  { path: "/pricing" },
  { path: "/security" },
  { path: "/accessibility" },
  { path: "/privacy" },
  { path: "/integrations" },
  { path: "/integrations/google-meet" },
  { path: "/use-cases/product-teams" },
  { path: "/status" },
  { path: "/support" },
  { path: "/contact-sales" },
  { path: "/help" },
  { path: "/help/using-the-board/keyboard-pointer-and-touchpad" },
  { path: "/help/reference/error-codes" },
  { path: "/pilot/setup" },
  { path: "/pilot/support" },
  { path: "/pilot/privacy" },
  { path: "/pilot/terms" },
  { path: "/pilot/draft-opt-out" },
  { path: "/this-page-does-not-exist" },
  { path: "/help/no-such-article" },
  { path: "/invite/not-a-real-invitation" },
];

for (const { path, siteTitle } of PUBLIC_PAGES) {
  test(`public page ${path} passes the audit`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await auditPage(page, path, { siteTitle: Boolean(siteTitle) });
  });
}

test("sign-in and signup pages pass the audit for someone signed out", async ({ page }) => {
  // The E2E API signs every visitor in with its development identity; refuse it.
  await page.route("**/auth/development", (route) => route.fulfill({ status: 404, json: { error: "NOT_FOUND" } }));
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    // The browser tests run without a sign-in service, so the page settles on
    // its no-provider state; wait for that rather than the brief default.
    await expect(page.getByText("Continue with your Google account.")).toBeVisible();
    await auditPage(page, path);
  }
});

test("a shared board and an expired shared link pass the audit", async ({ page }) => {
  await page.route("**/shared-boards/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: sharedBoardBody }));
  await page.goto(`/s/${"A".repeat(43)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout flow" })).toBeVisible();
  // The canvas has a text alternative: its name, and the board's text as a list.
  await expect(page.getByRole("img", { name: /Board “Checkout flow”/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Text on this board" })).toBeAttached();
  await auditPage(page, "a shared board");

  await page.unroute("**/shared-boards/**");
  await page.route("**/shared-boards/**", (route) => route.fulfill({ status: 404, json: { error: "SHARE_LINK_UNAVAILABLE" } }));
  await page.goto(`/s/${"B".repeat(43)}`);
  await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
  await auditPage(page, "an expired shared link");
});

test("an expired live link meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/live/expired-session");
  await expect(page.getByText("This live link has expired")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("an expired live link has a main landmark and an h1", async ({ page }) => {
  await page.goto("/live/expired-session");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "This live link has expired" })).toBeVisible();
});

const SIGNED_IN_PAGES = [
  "/app",
  "/app/billing",
  "/app/settings/profile",
  "/app/settings/preferences",
  "/app/settings/connected-accounts",
  "/app/settings/notifications",
  "/app/settings/privacy-data",
  "/app/settings/sessions",
  "/app/settings/workspace",
  "/app/settings/members",
  "/app/settings/policies",
  "/app/settings/audit-logs",
  "/app/settings/identity-directory",
];

for (const path of SIGNED_IN_PAGES) {
  test(`signed-in page ${path} passes the audit`, async ({ page }) => {
    await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
    await page.goto(path);
    await expect(page.getByRole("button", { name: /^Account menu for / })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await auditPage(page, path);
  });
}

test("a first visit offers Create Airboard in the middle of an otherwise empty home page", async ({ page }) => {
  await signIn(page, { workspace: "personal" });
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Create your first Airboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Create Airboard" })).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await auditPage(page, "first-run home");
});

test("an unknown signed-in address says the page was not found", async ({ page }) => {
  await signIn(page, { workspace: "team" });
  await page.goto("/app/nothing-here");
  await expect(page.getByRole("heading", { level: 1, name: "That page has moved or does not exist." })).toBeVisible({ timeout: 30_000 });
  await auditPage(page, "/app/nothing-here");
});

test("a personal workspace's admin page explains itself with an h1", async ({ page }) => {
  await signIn(page, { workspace: "personal" });
  await page.goto("/app/admin/members");
  await expect(page).toHaveURL(/\/app\/settings\/members$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Members" })).toHaveCount(0);
  await auditPage(page, "personal admin");
});

test("the Viewer's view-only board has one main landmark, an h1 and the board as text", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", role: "viewer", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect.poll(() => page.title()).toBe(`${fixture.title} · Airboard`);
  const text = page.getByRole("list").filter({ hasText: "Checkout API" });
  expect(await text.ariaSnapshot()).toContain("listitem: Shopper");
  expect(await axeViolations(page)).toEqual([]);
});

test("the board editor's chrome: one main landmark, a named tab and named controls", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect.poll(() => page.title()).toBe(`${fixture.title} · Airboard`);
  expect(await axeViolations(page)).toEqual([]);

  // What a screen reader is told about the top bar and the tools.
  const chrome = await page.getByRole("main").ariaSnapshot();
  for (const control of [
    'link "Back to boards"',
    `button "Rename canvas ${fixture.title}"`,
    'button "Share"',
    'button "More board actions"',
    'textbox "Type a board command"',
    'toolbar "Board creation tools"',
    'button "Zoom in"',
    "application \"Airboard diagram canvas.",
  ]) {
    expect(chrome, `the editor exposes ${control}`).toContain(control);
  }
});

test("the board editor has an h1 naming the board", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible({ timeout: 30_000 });
});

test("renaming the board hands focus back to its title", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  const title = page.getByRole("button", { name: `Rename canvas ${fixture.title}` });
  await title.click({ timeout: 30_000 });
  await page.getByLabel("Canvas name").press("Escape");
  await expect(title).toBeFocused();
  await title.press("Enter");
  await page.getByLabel("Canvas name").fill("Checkout flow v2");
  await page.getByLabel("Canvas name").press("Enter");
  await expect(page.getByRole("button", { name: "Rename canvas Checkout flow v2" })).toBeFocused();
});

test("a screen reader hears the selected object and can read the board's words", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  const words = page.locator("#board-canvas-text");
  await expect(words.getByRole("listitem").filter({ hasText: "Checkout API" })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("canvas.board-canvas")).toHaveAttribute("aria-describedby", "board-canvas-text");

  await page.locator("canvas.board-canvas").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("p.sr-only[role=status]").filter({ hasText: /^Selected “.+”\.$/ })).toHaveCount(1);
});

test("Tab on the canvas steps through objects and then leaves it", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  const canvas = page.locator("canvas.board-canvas");
  await canvas.focus();
  let left = false;
  for (let press = 0; press < 20 && !left; press += 1) {
    await page.keyboard.press("Tab");
    left = !(await canvas.evaluate((element) => element === document.activeElement));
  }
  expect(left, "Tab leaves the canvas after its last object").toBe(true);
});

test("navigating between pages changes the title, which Next.js announces", async ({ page }) => {
  await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Airboards" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle("Airboards · Airboard");
  const announcement = () =>
    page.evaluate(() => document.querySelector("next-route-announcer")?.shadowRoot?.querySelector("[aria-live]")?.textContent ?? "");

  await page.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveTitle("Profile · Settings · Airboard");
  await expect.poll(announcement).toBe("Profile · Settings · Airboard");
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Sessions" }).click();
  await expect(page).toHaveTitle("Sessions · Settings · Airboard");
  // Between two settings sections the title can still be settling when Next.js
  // looks, and it then announces the page's h1 instead; either names the page.
  await expect.poll(announcement).toMatch(/^Sessions( · Settings · Airboard)?$/);
});

test("at 320px the profile menu reaches every page, and Settings every section", async ({ page }) => {
  await signIn(page, { workspace: "team" });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/app");
  const profile = page.getByRole("button", { name: /^Account menu for / });
  await expect(profile).toBeVisible({ timeout: 30_000 });
  // The header is the only navigation: no sidebar, no bottom bar.
  await expect(page.getByRole("navigation")).toHaveCount(0);

  await profile.focus();
  await page.keyboard.press("Enter");
  await expect(profile).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByRole("menuitem", { name: "Profile" })).toBeFocused();
  for (const name of ["Profile", "Help Center", "Plan & Billing", "Settings", "Sign out"]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  const panel = await page.locator(".profile-menu-panel").boundingBox();
  expect(panel && panel.x >= 0 && panel.x + panel.width <= 320, "the menu stays on screen").toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(profile).toBeFocused();

  await profile.click();
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveTitle("Preferences · Settings · Airboard");
  await expect(menu).toBeHidden();
  const settings = page.getByRole("navigation", { name: "Settings" });
  for (const name of ["Profile", "Sessions", "Workspace", "Members", "Policies", "SSO & SCIM", "Audit log"]) {
    await expect(settings.getByRole("link", { name, exact: true })).toBeAttached();
  }
  await settings.getByRole("link", { name: "Members", exact: true }).click();
  await expect(page).toHaveTitle("Members · Settings · Airboard");
});

test("old addresses land on the home page, the Help Center or Settings", async ({ page }) => {
  await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  for (const path of ["/app/boards", "/app/shared", "/app/activity", "/app/trash"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/app$/, { timeout: 30_000 });
  }
  await page.goto("/app/integrations");
  await expect(page).toHaveURL(/\/help\/integrations\/google-meet$/, { timeout: 30_000 });
  await page.goto("/app/admin/overview");
  await expect(page).toHaveURL(/\/app\/settings\/workspace$/, { timeout: 30_000 });
});

test("at 320px the public pages keep their main navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/product");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const name of ["Product", "Integrations", "Pricing", "Enterprise"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
});

test("the first Tab on a signed-in page offers the skip link, and it moves to the content", async ({ page }) => {
  await signIn(page, { workspace: "team" });
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Tab");
  // The development server's own overlay button can come first; production has none.
  if (await page.evaluate(() => document.activeElement?.tagName === "NEXTJS-PORTAL")) await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

/** Each Tab stop shows a ring: an outline of its own or on the field that wraps it. */
async function tabStopsWithoutRing(page: Page, stops: number) {
  const missing: string[] = [];
  for (let press = 0; press < stops; press += 1) {
    await page.keyboard.press("Tab");
    const problem = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body || element.tagName === "NEXTJS-PORTAL") return null;
      if (element.tagName === "CANVAS") return null;
      const ringed = (candidate: Element | null) => {
        if (!candidate) return false;
        const style = getComputedStyle(candidate);
        if (style.outlineStyle === "auto") return true;
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 && !/rgba\([^)]*, 0(\.\d+)?\)$/.test(style.outlineColor);
      };
      if (ringed(element) || ringed(element.closest(".help-search-field, .canvas-copilot-composer"))) return null;
      return `${element.tagName.toLowerCase()} “${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}”`;
    });
    if (problem) missing.push(problem);
  }
  return missing;
}

test("keyboard focus is always visible", async ({ page }) => {
  for (const path of ["/", "/help", "/contact-sales"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await tabStopsWithoutRing(page, 25), `focus rings on ${path}`).toEqual([]);
  }
  await signIn(page, { workspace: "team", boards: [{ title: fixture.title, state: fixture.state }] });
  for (const path of ["/app", "/app/settings/profile", "/app/settings/members"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    expect(await tabStopsWithoutRing(page, 30), `focus rings on ${path}`).toEqual([]);
  }
  await page.goto("/?testStandalone=1");
  await expect(page.getByRole("toolbar", { name: "Board creation tools" })).toBeVisible();
  expect(await tabStopsWithoutRing(page, 22), "focus rings on the board").toEqual([]);
});

test("focus rings are solid", async ({ page }) => {
  await signIn(page, { workspace: "team" });
  await page.goto("/app/settings/profile");
  const save = page.getByRole("button", { name: "Save profile" });
  await expect(save).toBeVisible({ timeout: 30_000 });
  await save.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  expect(await save.evaluate((element) => getComputedStyle(element).outlineColor)).toBe("rgb(105, 72, 220)");
  const profile = page.getByRole("button", { name: /^Account menu for / });
  await profile.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(profile).toBeFocused();
  expect(await profile.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
});

async function expectFocusReturns(page: Page, trigger: Locator, open: () => Promise<void>) {
  await open();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
}

test("library: a menu item's dialog hands focus back to the menu button", async ({ page }) => {
  await signIn(page, { boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto("/app");
  const actions = page.getByRole("button", { name: `Actions for ${fixture.title}` });
  await expect(actions).toBeVisible({ timeout: 30_000 });
  await actions.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: `Actions for ${fixture.title}` });
  await expect(menu.getByRole("menuitem", { name: "Rename canvas" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename canvas" });
  await expect(dialog.getByLabel("Canvas name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(actions).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete canvas" })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: `Delete “${fixture.title}”?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(actions).toBeFocused();
});

test("board: menus and dialogs hand focus back to the button that opened them", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: fixture.title, state: fixture.state }] });
  await page.goto(`/app/boards/${api.boardId(fixture.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });

  // A ••• item that just acts (Copy image) closes the menu and returns focus.
  const more = page.getByRole("button", { name: "More board actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Board actions" });
  await menu.getByRole("menuitem", { name: "Copy image" }).focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // Delete canvas opens a dialog; cancelling it returns to •••.
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Delete canvas" }).focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: `Delete “${fixture.title}”?` });
  await expect(confirm).toBeVisible();
  expect(await axeViolations(page, ".board-lifecycle-dialog")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(more).toBeFocused();
});

test("creation menus and the shape library close on Escape and return focus", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  const toolbar = page.getByRole("toolbar", { name: "Board creation tools" });
  await expect(toolbar).toBeVisible();

  const shape = toolbar.getByRole("button", { name: "Shape", exact: true });
  await expectFocusReturns(page, shape, async () => {
    await shape.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("menu", { name: "Recent shapes and connectors" }).getByRole("menuitem").first()).toBeFocused();
  });
  await expect(page.getByRole("menu", { name: "Recent shapes and connectors" })).toBeHidden();

  // Choosing an item from the keyboard also returns focus to the menu's button.
  const draw = toolbar.getByRole("button", { name: "Draw", exact: true });
  await draw.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Drawing tools" })).toBeHidden();
  await expect(draw).toBeFocused();

  // The shape library: Escape closes it and focus goes back to Shape.
  await shape.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menu", { name: "Recent shapes and connectors" }).getByRole("menuitem", { name: "More shapes" }).focus();
  await page.keyboard.press("Enter");
  const library = page.getByRole("complementary", { name: "More shapes" });
  await expect(library.getByRole("searchbox", { name: "Search shapes" })).toBeFocused();
  expect(await axeViolations(page, ".creation-shape-sidebar")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(library).toBeHidden();
  await expect(shape).toBeFocused();
});

test("every creation menu meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  const toolbar = page.getByRole("toolbar", { name: "Board creation tools" });
  await expect(toolbar).toBeVisible();
  for (const [button, menu] of [
    ["Draw", "Drawing tools"],
    ["Connector", "Connector types"],
    [/^Table,/, "Choose table size"],
    ["Stamp", "Stamps"],
    ["Insert", "Insert on board"],
  ] as const) {
    await toolbar.getByRole("button", typeof button === "string" ? { name: button, exact: true } : { name: button }).click();
    await expect(page.getByRole("menu", { name: menu })).toBeVisible();
    expect(await axeViolations(page, ".creation-popover"), `WCAG violations in ${menu}`).toEqual([]);
    await page.keyboard.press("Escape");
  }
});

test("at 200% zoom (640px) the board keeps its zoom controls on screen", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("/?testStandalone=1");
  const zoom = page.getByRole("toolbar", { name: "Board creation tools" }).getByRole("group", { name: "Canvas zoom controls" });
  for (const name of ["Zoom out", "Reset canvas zoom", "Zoom in"]) {
    await expect(zoom.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
});

test("help search announces its results through a live region that is already there", async ({ page }) => {
  await page.goto("/help");
  const status = page.locator(".help-search").getByRole("status");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("");
  await page.getByLabel("Search Airboard help").fill("undo");
  await expect(status).toHaveText(/^\d+ helpful articles?$/);
  await page.getByLabel("Search Airboard help").fill("zzzzqqq");
  await expect(status).toHaveText("No matching article");
});

test.describe("a first visit", () => {
  // No stored cookie choice, so the banner shows.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the cookie banner passes the audit and hands focus to the page once answered", async ({ page }) => {
    await page.goto("/pricing");
    const banner = page.getByRole("complementary", { name: "Cookie choices" });
    await expect(banner).toBeVisible();
    expect(await axeViolations(page, ".cookie-banner")).toEqual([]);
    await page.setViewportSize({ width: 320, height: 640 });
    await expect.poll(() => overflowingContent(page)).toEqual([]);
    await banner.getByRole("button", { name: "Necessary only" }).focus();
    await page.keyboard.press("Enter");
    await expect(banner).toBeHidden();
    await expect(page.locator("#main-content")).toBeFocused();
  });
});

test("with reduced motion, nothing on the page animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const moving = () =>
    page.evaluate(() =>
      document.getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => ({ animation, timing: animation.effect?.getComputedTiming() }))
        .filter(({ timing }) => Number(timing?.duration ?? 0) > 1 || timing?.iterations === Infinity)
        .map(({ animation }) => {
          const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
          return `${(animation as CSSAnimation).animationName ?? "transition"} on ${target?.tagName.toLowerCase()}.${target?.className}`;
        }),
    );
  for (const path of ["/", "/demo", "/help", "/?testStandalone=1"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await moving(), `animations on ${path}`).toEqual([]);
  }
});

test("cards stay inside a 320px screen even when fonts run wide", async ({ page }) => {
  // Linux CI fonts are wider than macOS's; widened letters stand in for them,
  // so long words such as an email address can't push a card off-screen.
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ["/accessibility", "/security", "/pricing", "/product"]) {
    await page.goto(path);
    await page.addStyleTag({ content: "* { letter-spacing: 0.6px !important; }" });
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll("article, .feature-card, .pricing-card")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .map((element) => element.className));
    expect(overflowing, path).toEqual([]);
  }
});
