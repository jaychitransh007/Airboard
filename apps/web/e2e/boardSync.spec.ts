import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2 acceptance: two browsers, one board — live sync both ways, and the
 * board survives a reload (hydration from the server session).
 */

type Summary = {
  objectCount: number;
  labels: string[];
  boardSessionId: string;
  syncStatus: string;
};

function summary(page: Page): Promise<Summary> {
  return page.evaluate(() =>
    (
      window as never as {
        __airboardTestHooks: { getBoardSummary(): Summary };
      }
    ).__airboardTestHooks.getBoardSummary(),
  );
}

async function runCommand(page: Page, command: string) {
  await page.getByTestId("intent-command-input").fill(command);
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
}

async function waitForLiveSession(page: Page) {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(async () => (await summary(page)).syncStatus, { timeout: 20_000 })
    .toBe("connected");
  await expect
    .poll(async () => page.url(), { timeout: 20_000 })
    .toContain("boardSessionId=");
}

test("two browsers share one live board; reload rehydrates it", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/");
  await waitForLiveSession(owner);
  const shareUrl = owner.url();

  // Owner draws; guest joins via the shared URL and sees it.
  await runCommand(owner, "add a circle here");
  const guest = await guestContext.newPage();
  await guest.goto(shareUrl);
  await waitForLiveSession(guest);
  await expect
    .poll(async () => (await summary(guest)).objectCount, { timeout: 20_000 })
    .toBe(1);

  // Guest edits; owner sees the rename arrive live.
  await runCommand(guest, "rename the circle to Payments");
  await expect
    .poll(async () => (await summary(owner)).labels, { timeout: 20_000 })
    .toEqual(["Payments"]);

  // Guest adds; owner sees it.
  await runCommand(guest, "add a database named Ledger here");
  await expect
    .poll(async () => (await summary(owner)).objectCount, { timeout: 20_000 })
    .toBe(2);

  // Refresh safety: the owner reloads and the board comes back from the
  // server session, not from local memory.
  await owner.reload();
  await waitForLiveSession(owner);
  await expect
    .poll(async () => (await summary(owner)).objectCount, { timeout: 20_000 })
    .toBe(2);
  expect((await summary(owner)).labels.sort()).toEqual(["Ledger", "Payments"]);

  await ownerContext.close();
  await guestContext.close();
});
