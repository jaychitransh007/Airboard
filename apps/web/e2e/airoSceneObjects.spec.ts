import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/signedInApi";

// RGB-039: in the live journey Airo drew a second "API" because the first one,
// made by a typed command, was invisible to it.

type SceneShape = { id: string; kind: string; status: string; shapeKind?: string; content?: { blocks: Array<{ runs: Array<{ text: string }> }> } };
type SceneConnector = { id: string; kind: "connector"; status: string; legacyStrokeId?: string; start: { binding?: { elementId: string } }; end: { binding?: { elementId: string } } };

function boardElements(page: Page) {
  return page.evaluate(() =>
    Object.values(
      (window as never as { __airboardTestHooks: { getCanonicalBoardState(): { elements: Record<string, unknown> } } })
        .__airboardTestHooks.getCanonicalBoardState().elements,
    ),
  ) as Promise<Array<SceneShape | SceneConnector>>;
}

const text = (element: SceneShape) => element.content?.blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n") ?? "";

async function runCommand(page: Page, command: string) {
  await page.getByTestId("intent-command-input").fill(command);
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });
}

type SentContext = { summary: { objects: Array<{ label: string }> } | null };

/** Stands in for the Airo model: every request gets this plan, and the board context it was sent is kept. */
async function standInForAiro(page: Page, actions: unknown[]): Promise<SentContext> {
  const sent: SentContext = { summary: null };
  await page.route("**/intent/config", (route) => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    json: { available: true, provider: "test-provider", defaultModel: "test-model", allowedModels: ["test-model"] },
  }));
  await page.route("**/intent/resolve", (route) => {
    sent.summary = (route.request().postDataJSON() as { context: typeof sent.summary }).context;
    return route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      json: {
        plan: {
          version: "1.1",
          status: "resolved",
          issueCode: "none",
          clarificationQuestion: null,
          missingSlots: [],
          actions,
        },
        provider: "test-provider",
        model: "test-model",
        metadata: {
          responseId: "resp_e2e", responseModel: "test-model", providerRequestId: "req_e2e", clientRequestId: "airboard:e2e:client",
          providerProcessingMs: 5, totalLatencyMs: 10, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      },
    });
  });
  return sent;
}

const byLabel = (label: string) => ({ kind: "visible_label", label, occurrence: null });

async function openMixedBoard(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
  const api = await signIn(page, { boards: [{ title: "Mixed board", state: { elements: {}, strokes: {} } }] });
  return api;
}

test("Airo connects to the API a typed command made instead of drawing a second one", async ({ page }) => {
  const api = await openMixedBoard(page);
  const sent = await standInForAiro(page, [
    { type: "create", nodeType: "database", label: "Database", handle: "db_1", placement: { kind: "auto" } },
    { type: "connect", from: byLabel("API"), to: { kind: "plan_handle", handle: "db_1" }, label: "talks to" },
  ]);
  await page.goto(`/app/boards/${api.boardId("Mixed board")}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });

  await runCommand(page, "add a user");
  await runCommand(page, "add an API next to the user");
  await runCommand(page, "could you sketch a little database that the API talks to");

  // Airo was told about the typed shapes...
  expect(sent.summary?.objects.map(({ label }) => label)).toEqual(expect.arrayContaining(["User", "API"]));
  // ...so there is still one API, and the new connector starts at it.
  const elements = await boardElements(page);
  const shapes = elements.filter((element): element is SceneShape => element.kind === "shape" && element.status === "active");
  const apis = shapes.filter((shape) => text(shape) === "API");
  expect(apis).toHaveLength(1);
  const connectors = elements.filter((element): element is SceneConnector =>
    element.kind === "connector" && element.status === "active" && !(element as SceneConnector).legacyStrokeId);
  expect(connectors.some((connector) => connector.start.binding?.elementId === apis[0]!.id)).toBe(true);
  // And it all reaches the saved board.
  await expect.poll(() => JSON.stringify(api.saves.at(-1)?.state ?? null), { timeout: 10_000 }).toContain("talks to");
});

test("Airo lines up and groups typed shapes, and leaves them selected", async ({ page }) => {
  const api = await openMixedBoard(page);
  await standInForAiro(page, [
    { type: "align", targets: [byLabel("API"), byLabel("User")], alignment: "top" },
    { type: "group", targets: [byLabel("API"), byLabel("User")], label: "Front end", handle: "g_1" },
  ]);
  await page.goto(`/app/boards/${api.boardId("Mixed board")}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });

  await runCommand(page, "add a user");
  await runCommand(page, "add an API below the user");
  await expect(page.locator("p.sr-only[role=status]")).toHaveText("Selected “API”.");
  await runCommand(page, "could you line those two up along the top and call them the front end");

  const elements = await boardElements(page);
  const shapes = elements.filter((element): element is SceneShape => element.kind === "shape" && element.status === "active");
  const [user, apiShape] = ["User", "API"].map((name) => shapes.find((shape) => text(shape) === name)!);
  expect((user as unknown as { transform: { y: number } }).transform.y)
    .toBe((apiShape as unknown as { transform: { y: number } }).transform.y);
  const section = elements.find((element) => element.kind === "section" && element.status === "active") as unknown as
    { memberIds: string[]; title: { blocks: Array<{ runs: Array<{ text: string }> }> } } | undefined;
  expect(section?.memberIds.sort()).toEqual([user!.id, apiShape!.id].sort());
  expect(section?.title.blocks[0]?.runs[0]?.text).toBe("Front end");
  // The last shape Airo touched is the one announced as selected.
  await expect(page.locator("p.sr-only[role=status]")).toHaveText("Selected “User”.");
  await expect.poll(() => JSON.stringify(api.saves.at(-1)?.state ?? null), { timeout: 10_000 }).toContain("Front end");
});
