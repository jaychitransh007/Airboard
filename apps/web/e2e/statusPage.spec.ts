import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const GITHUB_ISSUES = "https://api.github.com/repos/jaychitransh007/Airboard/issues?**";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function serveIncidents(page: Page) {
  await page.route(GITHUB_ISSUES, (route) =>
    route.fulfill({
      json: [
        {
          number: 41,
          title: "Saving boards is failing",
          body: "Boards can't be saved right now. Your changes stay in the open tab.",
          state: "open",
          html_url: "https://github.com/jaychitransh007/Airboard/issues/41",
          created_at: hoursAgo(1),
          closed_at: null,
          author_association: "OWNER",
          labels: [{ name: "incident" }],
          comments: 1,
          comments_url: "https://api.github.com/repos/jaychitransh007/Airboard/issues/41/comments",
        },
        {
          number: 12,
          title: "Airo voice was unavailable",
          body: "Voice commands didn't respond for 20 minutes. Typed commands kept working.",
          state: "closed",
          html_url: "https://github.com/jaychitransh007/Airboard/issues/12",
          created_at: hoursAgo(72),
          closed_at: hoursAgo(71),
          author_association: "OWNER",
          labels: [{ name: "incident" }],
          comments: 0,
          comments_url: "https://api.github.com/repos/jaychitransh007/Airboard/issues/12/comments",
        },
        {
          number: 13,
          title: "Not an incident from us",
          body: "",
          state: "open",
          html_url: "https://github.com/jaychitransh007/Airboard/issues/13",
          created_at: hoursAgo(2),
          closed_at: null,
          author_association: "NONE",
          labels: [{ name: "incident" }],
          comments: 0,
        },
      ],
    }),
  );
  await page.route("https://api.github.com/repos/jaychitransh007/Airboard/issues/41/comments**", (route) =>
    route.fulfill({
      json: [{ body: "We found the cause and are rolling back.", created_at: hoursAgo(0.5), author_association: "OWNER" }],
    }),
  );
}

test("the status page shows ongoing and resolved incidents from GitHub", async ({ page }) => {
  await serveIncidents(page);
  await page.goto("/status");
  await expect(page.getByRole("heading", { level: 1, name: "Is Airboard working right now?" })).toBeVisible();

  const ongoing = page.getByRole("article", { name: "Saving boards is failing" });
  await expect(ongoing).toContainText("Ongoing since");
  await expect(ongoing).toContainText("Your changes stay in the open tab.");
  await expect(ongoing).toContainText("We found the cause and are rolling back.");
  await expect(ongoing.getByRole("link", { name: "All updates for “Saving boards is failing”" })).toHaveAttribute(
    "href",
    "https://github.com/jaychitransh007/Airboard/issues/41",
  );

  const resolved = page.getByRole("article", { name: "Airo voice was unavailable" });
  await expect(resolved).toContainText("Resolved");
  await expect(page.getByText("Not an incident from us")).toHaveCount(0);

  // Ongoing incidents come first.
  const titles = await page.locator(".status-incident h3").allTextContents();
  expect(titles).toEqual(["Saving boards is failing", "Airo voice was unavailable"]);

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((violation) => `${violation.impact} ${violation.id}`)).toEqual([]);
});

test("a database outage reads as plain words, not a code", async ({ page }) => {
  await page.route(GITHUB_ISSUES, (route) => route.fulfill({ json: [] }));
  await page.route("http://127.0.0.1:4600/ready", (route) =>
    route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": "*" },
      json: { ready: false, dependencies: { database: "unavailable" } },
    }),
  );
  await page.goto("/status");
  const now = page.getByRole("region", { name: "Right now" });
  await expect(now).toContainText("Boards and AiroHaving problems");
  await expect(now).toContainText("Saved boardsNot responding");
  await expect(now).not.toContainText("unavailable");
});

test("when GitHub can't be reached the status page points there instead", async ({ page }) => {
  await page.route(GITHUB_ISSUES, (route) => route.fulfill({ status: 403, json: { message: "API rate limit exceeded" } }));
  await page.goto("/status");
  const incidents = page.getByRole("region", { name: "Incidents" });
  await expect(incidents).toContainText("Incident updates couldn't be loaded here.");
  await expect(incidents.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/jaychitransh007/Airboard/issues?q=label%3Aincident",
  );
});

test("with no incidents the status page says so", async ({ page }) => {
  await page.route(GITHUB_ISSUES, (route) => route.fulfill({ json: [] }));
  await page.goto("/status");
  await expect(page.getByRole("region", { name: "Incidents" })).toContainText("No incidents in the last 90 days.");
});
