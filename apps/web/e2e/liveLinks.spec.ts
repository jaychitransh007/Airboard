import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { AirboardTestWindow } from "./support/testHooks";
import { signIn } from "./support/signedInApi";

const checkoutFlow = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8")) as {
  title: string;
  state: unknown;
};

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3100" });
});

function liveSessionId(page: Page) {
  return page.evaluate(() =>
    (window as unknown as Partial<AirboardTestWindow>).__airboardTestHooks?.getBoardSummary().boardSessionId ?? null,
  );
}

async function copyLiveLink(page: Page) {
  const dialog = page.getByRole("dialog", { name: `Share “${checkoutFlow.title}”` });
  await dialog.getByRole("button", { name: "Copy live link" }).click();
  await expect(dialog.getByRole("button", { name: "Link copied" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test("guests watch until the owner lets them edit, and New link stops the old link", async ({ page, browser }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto(`/app/boards/${api.boardId(checkoutFlow.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  // The live link is never in the owner's address bar.
  await expect.poll(() => page.url()).not.toContain("joinToken");

  await page.getByTestId("share-board").click();
  await page.getByTestId("share-board-people").click();
  const dialog = page.getByRole("dialog", { name: `Share “${checkoutFlow.title}”` });
  const access = dialog.getByRole("radiogroup", { name: "What people with the live link can do" });
  await expect(access.getByRole("radio", { name: /Can view/ })).toBeChecked({ timeout: 30_000 });
  const firstLink = await copyLiveLink(page);
  expect(firstLink).toMatch(/\/live\/[^/?]+\?joinToken=/);

  // A guest who opens it watches the board, with no tools.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(firstLink);
  await expect(guest.getByRole("heading", { level: 1, name: "Live board" })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText("View only", { exact: true })).toBeVisible();
  await expect(guest.getByTestId("intent-command-input")).toHaveCount(0);

  // The owner lets people edit; the guest gets the full board without reloading.
  await access.getByRole("radio", { name: /Can edit/ }).check();
  await expect(guest.getByTestId("intent-command-input")).toBeVisible({ timeout: 30_000 });

  // And back to watching.
  await access.getByRole("radio", { name: /Can view/ }).check();
  await expect(guest.getByText("View only", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId("intent-command-input")).toHaveCount(0);

  // A new link stops the old one letting anyone else in. Links are dated to the
  // second, so wait for the next one.
  await page.waitForTimeout(1_100);
  await dialog.getByRole("button", { name: "New link" }).click();
  await expect(dialog.getByText("New link ready to copy. The old link no longer lets anyone in")).toBeVisible();
  const secondLink = await copyLiveLink(page);
  expect(secondLink).not.toBe(firstLink);

  const late = await guestContext.newPage();
  await late.goto(firstLink);
  await expect(late.getByText("This live link was replaced")).toBeVisible({ timeout: 30_000 });
  await late.goto(secondLink);
  await expect(late.getByText("View only", { exact: true })).toBeVisible({ timeout: 30_000 });
  // The guest already in stays.
  await expect(guest.getByText("View only", { exact: true })).toBeVisible();
  await guestContext.close();
});

test("after a reload the owner is back in their own session, with the same link", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: checkoutFlow.title, state: checkoutFlow.state }] });
  await page.goto(`/app/boards/${api.boardId(checkoutFlow.title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("share-board").click();
  await page.getByTestId("share-board-people").click();
  const before = await copyLiveLink(page);
  const session = await liveSessionId(page);
  expect(session).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => liveSessionId(page), { timeout: 30_000 }).toBe(session);
  await page.getByTestId("share-board").click();
  await page.getByTestId("share-board-people").click();
  // Owner controls are back, so this is the owner's place, not a guest's.
  await expect(page.getByRole("radiogroup", { name: "What people with the live link can do" })).toBeVisible({ timeout: 30_000 });
  expect(await copyLiveLink(page)).toBe(before);
});
