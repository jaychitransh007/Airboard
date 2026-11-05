import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WCAG 2.2 AA rules, as axe-core checks them, on the public pages, the board
// and its dialogs and menus. Any violation fails, with the rule and elements.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map(
    (violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
  expect(summary, `WCAG violations on ${where}`).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

const PAGES = [
  "/",
  "/login",
  "/signup",
  "/pricing",
  "/use-cases",
  "/integrations",
  "/status",
  "/support",
  "/contact-sales",
  "/help",
  "/help/getting-started/first-board",
  "/help/integrations/google-meet",
];

for (const path of PAGES) {
  test(`${path} meets WCAG 2.2 AA`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoViolations(page, path);
  });
}

test("the board, its dialogs and its menus meet WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await page.waitForLoadState("networkidle");
  await expectNoViolations(page, "the board");

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "the Share dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "More board actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectNoViolations(page, "the board menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await expectNoViolations(page, "the shape popover");
});

test("the contact form announces its result through a live region that is already there", async ({ page }) => {
  await page.route("**/leads", (route) => route.fulfill({ status: 503, json: { error: "LEADS_UNAVAILABLE" } }));
  await page.goto("/contact-sales");
  // Present and empty before submitting, so screen readers announce the change.
  const status = page.getByRole("status");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("");

  await page.getByLabel("Name").fill("Test Person");
  await page.getByLabel("Work email").fill("person@example.com");
  await page.getByLabel("Company", { exact: true }).fill("Example");
  await page.getByLabel("Primary platform and outcome").fill("Google Meet with two presenters");
  await page.getByRole("button", { name: "Request evaluation" }).click();
  await expect(status).not.toHaveText("");
  await expect(status).toBeVisible();
});
