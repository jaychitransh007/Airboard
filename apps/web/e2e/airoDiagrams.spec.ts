import { expect, test, type Page } from "@playwright/test";
import type { SemanticPlanAction } from "@airboard/core";
import { byLabel, standInForAiro } from "./support/airoStandIn";
import { boardFingerprint, type BoardFingerprint } from "./support/boardFingerprint";
import { signIn } from "./support/signedInApi";
import { withHooks } from "./support/testHooks";

/**
 * Three diagrams Airo draws (a five-step flow with labelled arrows, a
 * decision with two outcomes, a group), each on its own saved board through
 * the real planner, executor and save path, with the Airo model stood in.
 *
 * The diagram each one gives is checked as a model-independent fingerprint.
 * With AIRBOARD_AIRO_SHOTS_DIR set, the canvas is also saved there as PNGs
 * (selected right after Airo draws, then with nothing selected), so the look
 * can be compared across a change to how Airo's shapes are stored.
 */

const SHOTS_DIR = process.env.AIRBOARD_AIRO_SHOTS_DIR;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function run(page: Page, command: string) {
  // The command box can take the text before the page is ready to act on
  // it; try again until the command is applied.
  await expect(async () => {
    await page.getByTestId("intent-command-input").fill(command);
    await page.getByTestId("intent-primary-action").click();
    await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
}

async function shoot(page: Page, name: string) {
  if (!SHOTS_DIR) return;
  // Let the selection and any toolbar settle before the picture.
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `${SHOTS_DIR}/${name}.png`,
    animations: "disabled",
    caret: "hide",
    // The undo notice would cover part of the diagram.
    style: ".undo-toast { visibility: hidden !important; }",
  });
}

async function drawWithAiro(page: Page, title: string, request: string, actions: SemanticPlanAction[]) {
  const api = await signIn(page, { boards: [{ title, state: { elements: {} } }] });
  const airo = await standInForAiro(page);
  await page.goto(`/app/boards/${api.boardId(title)}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });
  airo.nextPlan(actions);
  await run(page, request);
  expect(airo.unplanned).toEqual([]);
  // The panel covers the right of the board; the pictures show the board.
  if (SHOTS_DIR) await page.getByRole("button", { name: "Hide Airo panel" }).click();
  return Object.assign(api, { airo });
}

async function fingerprint(page: Page): Promise<BoardFingerprint> {
  return boardFingerprint(await withHooks(page, (hooks) => hooks.getCanonicalBoardState()));
}

async function clearSelection(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

const edge = (from: string, to: string, label = "") => ({ from, to, label });

test("Airo draws a five-step flow with labelled arrows", async ({ page }) => {
  const api = await drawWithAiro(page, "Flow", "could you sketch the checkout flow from the shopper to the ledger", [
    { type: "create", nodeType: "user", label: "Shopper", handle: "n1", placement: { kind: "auto" } },
    { type: "create", nodeType: "api", label: "Storefront API", handle: "n2", placement: { kind: "auto" } },
    { type: "create", nodeType: "service", label: "Checkout", handle: "n3", placement: { kind: "auto" } },
    { type: "create", nodeType: "queue", label: "Payments", handle: "n4", placement: { kind: "auto" } },
    { type: "create", nodeType: "database", label: "Ledger", handle: "n5", placement: { kind: "auto" } },
    { type: "connect", from: { kind: "plan_handle", handle: "n1" }, to: { kind: "plan_handle", handle: "n2" }, label: "browses" },
    { type: "connect", from: { kind: "plan_handle", handle: "n2" }, to: { kind: "plan_handle", handle: "n3" }, label: "places order" },
    { type: "connect", from: { kind: "plan_handle", handle: "n3" }, to: { kind: "plan_handle", handle: "n4" }, label: "charges" },
    { type: "connect", from: { kind: "plan_handle", handle: "n4" }, to: { kind: "plan_handle", handle: "n5" }, label: "records" },
  ]);
  const graph = await fingerprint(page);
  expect(graph.nodes.map((node) => `${node.label}:${node.kind}`)).toEqual([
    "Checkout:service",
    "Ledger:database",
    "Payments:queue",
    "Shopper:user",
    "Storefront API:api",
  ]);
  expect(graph.edges).toEqual([
    edge("Checkout", "Payments", "charges"),
    edge("Payments", "Ledger", "records"),
    edge("Shopper", "Storefront API", "browses"),
    edge("Storefront API", "Checkout", "places order"),
  ]);
  expect(graph.looseConnectors).toBe(0);
  await expect.poll(() => (api.saves.at(-1) ? boardFingerprint(api.saves.at(-1)!.state as never) : null)).toEqual(graph);
  await shoot(page, "flow-selected");
  await clearSelection(page);
  await shoot(page, "flow");

  // Airo's shapes are the board's own shapes now: selecting one by name
  // shows the shape toolbar, and "select everything" takes all of them.
  if (SHOTS_DIR) await page.getByRole("button", { name: "Show Airo panel" }).click();
  api.airo.nextPlan([{ type: "select", targets: [byLabel("Checkout")], mode: "replace" }]);
  await page.getByTestId("intent-command-input").fill("select the checkout");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.getByRole("complementary", { name: "Shape properties" })).toBeVisible();
  await page.getByTestId("intent-command-input").fill("select everything");
  await page.getByTestId("intent-primary-action").click();
  const drawn = await withHooks(page, (hooks) =>
    Object.values(hooks.getCanonicalBoardState().elements).filter((element) => element.status === "active").length,
  );
  expect(drawn).toBe(9);
  await expect
    .poll(async () => (await withHooks(page, (hooks) => hooks.getCatalogGestureState())).selectedElementIds.length)
    .toBe(drawn);
  expect(api.airo.unplanned).toEqual([]);
});

test("Airo draws a decision with two labelled outcomes", async ({ page }) => {
  const api = await drawWithAiro(page, "Decision", "add a payment check that ships when paid and retries when not", [
    { type: "create", nodeType: "service", label: "Checkout", handle: "c", placement: { kind: "auto" } },
    { type: "create", nodeType: "decision", label: "Paid?", handle: "d", placement: { kind: "auto" } },
    { type: "connect", from: { kind: "plan_handle", handle: "c" }, to: { kind: "plan_handle", handle: "d" }, label: null },
    {
      type: "branch",
      from: { kind: "plan_handle", handle: "d" },
      branches: [
        { to: byLabel("Ship order"), label: "yes" },
        { to: byLabel("Retry payment"), label: "no" },
      ],
    },
  ]);
  const graph = await fingerprint(page);
  expect(graph.nodes.map((node) => node.label)).toEqual(["Checkout", "Paid?", "Retry Payment", "Ship Order"]);
  expect(graph.edges).toEqual([
    edge("Checkout", "Paid?"),
    edge("Paid?", "Retry Payment", "no"),
    edge("Paid?", "Ship Order", "yes"),
  ]);
  await expect.poll(() => (api.saves.at(-1) ? boardFingerprint(api.saves.at(-1)!.state as never) : null)).toEqual(graph);
  await shoot(page, "decision-selected");
  await clearSelection(page);
  await shoot(page, "decision");
});

test("Airo draws a group around two of three shapes", async ({ page }) => {
  const api = await drawWithAiro(page, "Group", "add a web app, an API and a database and box the API and database as the backend", [
    { type: "create", nodeType: "process", label: "Web app", handle: "w", placement: { kind: "auto" } },
    { type: "create", nodeType: "api", label: "API", handle: "a", placement: { kind: "auto" } },
    { type: "create", nodeType: "database", label: "Orders", handle: "o", placement: { kind: "auto" } },
    { type: "connect", from: { kind: "plan_handle", handle: "w" }, to: { kind: "plan_handle", handle: "a" }, label: "calls" },
    { type: "connect", from: { kind: "plan_handle", handle: "a" }, to: { kind: "plan_handle", handle: "o" }, label: "reads" },
    {
      type: "group",
      targets: [{ kind: "plan_handle", handle: "a" }, { kind: "plan_handle", handle: "o" }],
      label: "Backend",
      handle: "g",
    },
  ]);
  const graph = await fingerprint(page);
  expect(graph.groups).toEqual([{ label: "Backend", members: ["API", "Orders"] }]);
  expect(graph.edges).toEqual([edge("API", "Orders", "reads"), edge("Web app", "API", "calls")]);
  await expect.poll(() => (api.saves.at(-1) ? boardFingerprint(api.saves.at(-1)!.state as never) : null)).toEqual(graph);
  await shoot(page, "group-selected");
  await clearSelection(page);
  await shoot(page, "group");
});
