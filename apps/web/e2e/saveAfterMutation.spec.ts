import type { BoardState } from "@airboard/core";
import { expect, test, type Page } from "@playwright/test";
import { byLabel, standInForAiro } from "./support/airoStandIn";
import { boardToCanvas, canvasSize, grabAndMove, pageNow } from "./support/handLandmarks";
import { signIn, type StandInControlPlane } from "./support/signedInApi";
import { withHooks } from "./support/testHooks";

/**
 * Every way the board changes must reach the saved board. Each mutation path
 * applies its change in its own place (applyLocalEvent, the command-turn
 * commit, undo, redo, the hand's move commit, a peer's event), so each one
 * schedules the save itself; a refactor that moves one of them and drops the
 * call would leave the change only in the open tab. For every path this
 * checks that the stand-in API receives a new board save (PATCH
 * /boards/:id with the state) whose content is exactly the live board.
 */

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function run(page: Page, command: string) {
  await page.getByTestId("intent-command-input").fill(command);
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", { timeout: 15_000 });
}

/** The persisted part of a board: what a save must carry. */
function content(state: BoardState) {
  return { sceneVersion: state.sceneVersion, elements: state.elements, strokes: state.strokes };
}

async function liveContent(page: Page) {
  return content(await withHooks(page, (hooks) => hooks.getCanonicalBoardState()));
}

/**
 * Runs one mutation and waits for the save it schedules: a new save must
 * arrive, the board must have changed, and the newest save must hold exactly
 * the live board.
 */
async function expectSaved(page: Page, api: StandInControlPlane, path: string, mutate: () => Promise<unknown>) {
  await test.step(path, async () => {
    const savesBefore = api.saves.length;
    const contentBefore = await liveContent(page);
    await mutate();
    await expect
      .poll(async () => JSON.stringify(await liveContent(page)) !== JSON.stringify(contentBefore), {
        message: `${path} changed the board`,
        timeout: 15_000,
      })
      .toBe(true);
    await expect
      .poll(() => api.saves.length, { message: `${path} scheduled a save`, timeout: 10_000 })
      .toBeGreaterThan(savesBefore);
    await expect
      .poll(async () => {
        const live = await liveContent(page);
        const saved = api.saves.at(-1)!.state as BoardState;
        return JSON.stringify(content(saved)) === JSON.stringify(live);
      }, { message: `the save after ${path} holds the live board`, timeout: 10_000 })
      .toBe(true);
  });
}

test("every mutation path schedules a save of the live board", async ({ page }) => {
  const api = await signIn(page, { boards: [{ title: "Saves", state: { elements: {}, strokes: {} } }] });
  const airo = await standInForAiro(page);
  await page.goto(`/app/boards/${api.boardId("Saves")}`);
  await expect(page.getByTestId("share-board")).toBeVisible({ timeout: 30_000 });

  await expectSaved(page, api, "typed scene command", () => run(page, "add a service named API"));

  await expectSaved(page, api, "legacy annotation command", async () => {
    const result = await withHooks(page, (hooks) =>
      hooks.prepareLegacyIntentCommandForEval("add a database named Legacy store"),
    );
    expect(["previewed", "applied"]).toContain(result);
  });

  await expectSaved(page, api, "semantic plan", async () => {
    airo.nextPlan([
      { type: "create", nodeType: "queue", label: "Events", handle: "q_1", placement: { kind: "auto" } },
      { type: "connect", from: byLabel("API"), to: { kind: "plan_handle", handle: "q_1" }, label: "publishes" },
    ]);
    await run(page, "could you add an events queue the API publishes to");
  });

  await expectSaved(page, api, "undo", () => page.keyboard.press(UNDO));
  await expectSaved(page, api, "redo", () => page.keyboard.press(REDO));

  await expectSaved(page, api, "spoken command", async () => {
    const routed = await withHooks(page, (hooks) => hooks.emitFinalTranscript("Airo, rename API to Gateway"));
    expect(routed.routed).toBe(true);
  });

  await expectSaved(page, api, "hand move", async () => {
    const canvas = await canvasSize(page);
    const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
    const gateway = summary.positions[summary.labels.indexOf("Gateway")]!;
    const from = await boardToCanvas(page, gateway);
    await grabAndMove(page, canvas, from, { x: from.x, y: from.y + 160 }, await pageNow(page));
  });

  await expectSaved(page, api, "live-session peer event", () =>
    withHooks(page, (hooks) => {
      const state = hooks.getCanonicalBoardState();
      const shape = Object.values(state.elements).find(
        (element) => element.kind === "shape" && element.status === "active" && !element.legacyStrokeId,
      )!;
      hooks.emitRemoteBoardEvent({
        id: "event:saves-peer-recolour",
        boardSessionId: state.boardId,
        actorParticipantId: "participant:saves-peer",
        createdAt: "2026-11-12T09:00:00.000Z",
        type: "element.patched",
        elementId: shape.id,
        patches: [{ op: "field.set", path: ["style", "fill"], value: "#bbf7d0" }],
        baseRevision: shape.revision,
      });
    }),
  );

  await expectSaved(page, api, "delete", () => run(page, "delete Gateway"));

  // Selecting changes nothing that is saved, so it sends no save.
  const savesBefore = api.saves.length;
  await run(page, "select everything");
  await page.waitForTimeout(1_500);
  expect(api.saves.length).toBe(savesBefore);
  expect(airo.unplanned).toEqual([]);
});
