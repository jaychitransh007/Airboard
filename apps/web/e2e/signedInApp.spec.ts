import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AirboardTestWindow } from "./support/testHooks";
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
    (window as unknown as Partial<AirboardTestWindow>).__airboardTestHooks?.getBoardSummary().labels ?? [],
  );
}

async function openSavedBoard(page: Page, boardId: string) {
  await page.goto(`/app/boards/${boardId}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => boardLabels(page)).toEqual(expect.arrayContaining(["Shopper", "Checkout API", "Orders DB"]));
}

async function openShare(page: Page) {
  await page.getByTestId("share-board").click();
  await page.getByTestId("share-board-people").click();
  const dialog = page.getByRole("dialog", { name: `Share “${checkoutFlow.title}”` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the home page lists saved boards and opens one with its content", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto("/app");
  const card = page.getByRole("link", { name: new RegExp(checkoutFlow.title) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  // With boards saved, Create Airboard sits beside the title.
  await expect(page.getByRole("heading", { level: 1, name: "Airboards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Airboard" })).toBeVisible();
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

test("a command that changes the diagram in one batch, and its undo, are saved", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await openSavedBoard(page, api.boardId(checkoutFlow.title));
  // The saved status of the node the command adds (null until a save has it).
  const savedLedger = () => {
    const state = api.saves.at(-1)?.state as {
      elements?: Record<string, { status: string }>;
    } | undefined;
    const items = Object.values(state?.elements ?? {});
    const ledger = items.filter((item) => JSON.stringify(item).includes('"Ledger"'));
    if (!ledger.length) return null;
    return ledger.some((item) => item.status === "active") ? "on the board" : "removed";
  };

  // Stand in for the Airo model, so the command takes the same path a real
  // Airo plan takes: one batch, applied outside the single-edit path.
  await page.route("**/intent/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ available: true, provider: "test-provider", defaultModel: "test-model", allowedModels: ["test-model"] }),
  }));
  await page.route("**/intent/resolve", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({
      plan: {
        version: "1.1",
        status: "resolved",
        issueCode: "none",
        clarificationQuestion: null,
        missingSlots: [],
        actions: [{ type: "create", nodeType: "database", label: "Ledger", handle: "ledger_1", placement: { kind: "auto" } }],
      },
      provider: "test-provider",
      model: "test-model",
      metadata: {
        responseId: "resp_e2e",
        responseModel: "test-model",
        providerRequestId: "req_e2e",
        clientRequestId: "airboard:e2e:client",
        providerProcessingMs: 5,
        totalLatencyMs: 10,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    }),
  }));
  await page.reload();
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("intent-command-input").fill("could you sketch a ledger store for me");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });
  // Saved without any further edit: nothing else would trigger the save.
  await expect.poll(savedLedger, { timeout: 10_000 }).toBe("on the board");

  await page.locator("canvas.board-canvas").focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(savedLedger, { timeout: 10_000 }).toBe("removed");
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
  await page.goto("/app/settings/members");
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

test("a Viewer opens boards view-only and can't create, change or share them", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", role: "viewer", boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto("/app");
  const card = page.getByRole("link", { name: new RegExp(checkoutFlow.title) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Create Airboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Actions for ${checkoutFlow.title}` })).toHaveCount(0);

  await card.click();
  await expect(page.getByRole("heading", { level: 1, name: checkoutFlow.title })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("lets you view boards, not change them");
  await expect(page.getByRole("img", { name: new RegExp(`Board “${checkoutFlow.title}”`) })).toBeVisible();
  await expect(page.getByTestId("share-board")).toHaveCount(0);
  await expect(page.getByTestId("intent-command-input")).toHaveCount(0);
  expect(api.saves).toEqual([]);

  await page.goto("/app/boards/new");
  await expect(page.getByText("Your role can't create boards.")).toBeVisible({ timeout: 30_000 });
});

test("an admin sees every view-only link in the workspace and turns one off", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const boardId = api.boardId(checkoutFlow.title);
  api.addLinks(boardId, 1);
  await page.goto("/app/settings/policies");
  await expect(page.getByRole("heading", { level: 2, name: "View-only links" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Downloading or copying boards as PNG or PDF.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: `Turn off view-only link to ${checkoutFlow.title}` }).click();
  await expect(page.getByText(`Turned off a view-only link to “${checkoutFlow.title}”.`, { exact: false })).toBeVisible();
  await expect(page.getByText("No working view-only links.")).toBeVisible();
  expect(api.activeLinks(boardId)).toEqual([]);
});

test("the home page, the Share dialog and Settings members meet WCAG 2.2 AA", async ({ page }) => {
  const api = await signIn(page, { workspace: "team", boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  const audit = async (scope?: string) => {
    const builder = new AxeBuilder({ page }).withTags(WCAG);
    const { violations } = await (scope ? builder.include(scope) : builder).analyze();
    return violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  };

  await page.goto("/app");
  await expect(page.getByRole("link", { name: new RegExp(checkoutFlow.title) })).toBeVisible({ timeout: 30_000 });
  expect(await audit()).toEqual([]);

  await openSavedBoard(page, api.boardId(checkoutFlow.title));
  await openShare(page);
  expect(await audit(".share-dialog")).toEqual([]);

  await page.goto("/app/settings/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible({ timeout: 30_000 });
  expect(await audit()).toEqual([]);

  api.addLinks(api.boardId(checkoutFlow.title), 1);
  await page.goto("/app/settings/policies");
  await expect(page.getByRole("button", { name: `Turn off view-only link to ${checkoutFlow.title}` })).toBeVisible({ timeout: 30_000 });
  expect(await audit()).toEqual([]);
});
