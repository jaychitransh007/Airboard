import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/signedInApi";

// A board built by the production diagram commands: Shopper → Checkout API → Orders DB.
const checkoutFlow = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8")) as {
  title: string;
  state: unknown;
};
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page, context }) => {
  // A returning person: the first-run tour is behind them.
  await page.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3100" });
});

function boardLabels(page: Page) {
  return page.evaluate(() =>
    (window as never as { __airboardTestHooks?: { getBoardSummary(): { labels: string[] } } })
      .__airboardTestHooks?.getBoardSummary().labels ?? [],
  );
}

async function openSavedBoard(page: Page, boardId: string) {
  await page.goto(`/app/boards/${boardId}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => boardLabels(page)).toEqual(expect.arrayContaining(["Shopper", "Checkout API", "Orders DB"]));
}

async function openShare(page: Page) {
  await page.getByTestId("share-board").click();
  const dialog = page.getByRole("dialog", { name: `Share “${checkoutFlow.title}”` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the library lists saved boards and opens one with its content", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto("/app/boards");
  const card = page.getByRole("link", { name: new RegExp(checkoutFlow.title) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/app/boards/${api.boardId(checkoutFlow.title)}`));
  await expect.poll(() => boardLabels(page), { timeout: 30_000 }).toEqual(
    expect.arrayContaining(["Shopper", "Checkout API", "Orders DB"]),
  );
});

test("edits to a saved board are saved as the next version", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await openSavedBoard(page, api.boardId(checkoutFlow.title));

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });

  await expect.poll(() => api.saves.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const latest = api.saves.at(-1);
  expect(latest?.version).toBe(api.boards.get(api.boardId(checkoutFlow.title))?.version);
  expect(latest?.version).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(latest?.state)).toContain("Checkout API");
});

test("a save that loses to another tab asks which version to keep", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const boardId = api.boardId(checkoutFlow.title);
  await openSavedBoard(page, boardId);
  api.saveElsewhere(boardId);

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();

  const warning = page.getByRole("alert").filter({ hasText: "changed in another tab or on another device" });
  await expect(warning).toBeVisible({ timeout: 20_000 });
  await warning.getByRole("button", { name: "Keep my version" }).click();
  await expect(warning).toHaveCount(0, { timeout: 15_000 });
  expect(api.saves.at(-1)?.version).toBe(3);
});

test("the owner creates, copies, opens and turns off a view-only link", async ({ page, context }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const boardId = api.boardId(checkoutFlow.title);
  await openSavedBoard(page, boardId);
  const dialog = await openShare(page);

  await dialog.getByLabel("Link lasts").selectOption({ label: "30 days" });
  await dialog.getByRole("button", { name: "Create view-only link" }).click();
  const link = dialog.getByLabel("View-only link", { exact: true });
  await expect(link).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const url = await link.inputValue();

  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("status")).toHaveText("View-only link copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  const active = dialog.getByRole("list", { name: "Active view-only links" });
  await expect(active.getByRole("listitem")).toHaveCount(1);
  const ends = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  await expect(active).toContainText(`ends ${ends}`);
  expect(api.activeLinks(boardId)[0]?.expiresAt).not.toBeNull();

  // Someone with the link sees the board without editing controls.
  const viewer = await context.newPage();
  await viewer.goto(url);
  await expect(viewer.getByRole("heading", { level: 1, name: checkoutFlow.title })).toBeVisible();
  await expect(viewer.getByText("View only", { exact: true })).toBeVisible();

  await active.getByRole("button", { name: "Turn off" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Link turned off. Anyone who opens it now sees that it no longer works.",
  );
  await expect(active).toHaveCount(0);
  await expect(link).toHaveCount(0);

  await viewer.reload();
  await expect(viewer.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
});

test("a board with 20 live links asks the owner to turn one off", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const boardId = api.boardId(checkoutFlow.title);
  api.addLinks(boardId, 20);
  await openSavedBoard(page, boardId);
  const dialog = await openShare(page);

  await expect(dialog.getByRole("list", { name: "Active view-only links" }).getByRole("listitem")).toHaveCount(20);
  await dialog.getByRole("button", { name: "Create view-only link" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This board already has 20 links. Turn one off to make another.");
  expect(api.activeLinks(boardId)).toHaveLength(20);
});

test("on a teammate's board only its creator can make view-only links", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state, owner: "teammate" }] });
  const boardId = api.boardId(checkoutFlow.title);
  api.boards.get(boardId)!.visibility = "organization";
  await openSavedBoard(page, boardId);
  const dialog = await openShare(page);

  await expect(dialog.getByText("Only the person who made this board can create view-only links.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create view-only link" })).toHaveCount(0);
});

test("an admin invites a teammate and copies the invite link", async ({ page }) => {
  const api = await signIn(page, { workspace: "team" });
  await page.goto("/app/admin/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Email to invite").fill("priya@acme.test");
  await page.getByLabel("Invite as").selectOption("member");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText("Invitation created. Send priya@acme.test this link; they join by signing in as priya@acme.test.")).toBeVisible();

  const invite = page.getByLabel("Invite link for priya@acme.test");
  await expect(invite).toHaveValue(/\/invite\/[A-Za-z0-9_-]+$/);
  await page.getByRole("button", { name: "Copy invite link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await invite.inputValue());

  await expect(page.getByRole("heading", { name: "Pending invitations" })).toBeVisible();
  await expect(page.getByText("priya@acme.test", { exact: true })).toBeVisible();
  expect(api.invitations.map((invitation) => invitation.email)).toEqual(["priya@acme.test"]);
});

test("the library, the Share dialog and Admin members meet WCAG 2.2 AA", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const audit = async (scope?: string) => {
    const builder = new AxeBuilder({ page }).withTags(WCAG);
    const { violations } = await (scope ? builder.include(scope) : builder).analyze();
    return violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  };

  await page.goto("/app/boards");
  await expect(page.getByRole("link", { name: new RegExp(checkoutFlow.title) })).toBeVisible({ timeout: 30_000 });
  expect(await audit()).toEqual([]);

  await openSavedBoard(page, api.boardId(checkoutFlow.title));
  await openShare(page);
  expect(await audit(".share-dialog")).toEqual([]);

  await page.goto("/app/admin/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible({ timeout: 30_000 });
  expect(await audit()).toEqual([]);
});
