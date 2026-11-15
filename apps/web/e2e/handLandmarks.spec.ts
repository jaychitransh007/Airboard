import { expect, test, type Page } from "@playwright/test";
import {
  boardToCanvas,
  canvasSize,
  closedFistLandmarks,
  emitHands,
  grabAndMove,
  openHandLandmarks,
  pageNow,
  poseAtCursor,
  rightHand,
  type CanvasSize,
} from "./support/handLandmarks";
import { waitForTestHooks, withHooks } from "./support/testHooks";

/**
 * The camera-and-hands path without a camera: synthetic HandLandmarker frames
 * through `emitRawLandmarkFrame`, which enters below MediaPipe and above every
 * production estimator, tracker, arbitration rule and board action. This is
 * the behavioural cover for the hand code the board-file split moves; a real
 * camera is still checked by hand before deploying that phase.
 */

const FRAME_MS = 33;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("airboard.onboarding.v1", "done"));
});

async function openBoardWithShape(page: Page) {
  await page.goto("/?testStandalone=1");
  await waitForTestHooks(page);
  await page.getByTestId("intent-command-input").fill("add a service named Mover here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:");
  return canvasSize(page);
}

async function moverCentre(page: Page) {
  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  expect(summary.labels).toEqual(["Mover"]);
  return summary.positions[0]!;
}

/** Holds one hand still at `at` for `count` frames; returns the next timestamp. */
async function hold(
  page: Page,
  canvas: CanvasSize,
  landmarks: () => ReturnType<typeof openHandLandmarks>,
  at: { x: number; y: number },
  count: number,
  startMs: number,
) {
  let t = startMs;
  for (let index = 0; index < count; index += 1) {
    await emitHands(page, [rightHand(poseAtCursor(landmarks(), at, canvas))], t, canvas);
    t += FRAME_MS;
  }
  return t;
}

async function handAway(page: Page, canvas: CanvasSize, count: number, startMs: number) {
  let t = startMs;
  for (let index = 0; index < count; index += 1) {
    await emitHands(page, [], t, canvas);
    t += FRAME_MS;
  }
  return t;
}

test("an open palm held still opens the voice gate; a brief one does not; lowering it closes the gate", async ({
  page,
}) => {
  const canvas = await openBoardWithShape(page);
  const gate = page.getByTestId("voice-gate-pill");
  const spot = { x: canvas.width * 0.25, y: canvas.height * 0.3 };
  let t = await pageNow(page);

  // About a quarter of a second: a wave, not a request to talk.
  t = await hold(page, canvas, openHandLandmarks, spot, 8, t);
  await page.waitForTimeout(250);
  await expect(gate).toHaveCount(0);
  t = await handAway(page, canvas, 20, t);

  // Held past 400 ms, still: the gate opens, once.
  t = await hold(page, canvas, openHandLandmarks, spot, 16, t);
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Open palm detected");

  // The hand leaves the camera: the gate closes again.
  await handAway(page, canvas, 20, t);
  await expect(gate).toHaveCount(0);

  // Hovering is not editing: the shape did not move and nothing was added.
  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  expect(summary.objectCount).toBe(1);
});

test("a closed hand over a shape grabs it, carries it with the hand, and one undo puts it back", async ({ page }) => {
  const canvas = await openBoardWithShape(page);
  const before = await moverCentre(page);
  const depthBefore = (await withHooks(page, (hooks) => hooks.getInteractionDiagnostics())).undoDepth;
  const from = await boardToCanvas(page, before);
  const travel = { x: -240, y: 120 };

  const t = await grabAndMove(page, canvas, from, { x: from.x + travel.x, y: from.y + travel.y }, await pageNow(page));
  await handAway(page, canvas, 3, t);

  const after = await moverCentre(page);
  const scale = (await withHooks(page, (hooks) => hooks.getViewport())).scale;
  const moved = { x: (after.x - before.x) * scale, y: (after.y - before.y) * scale };
  // The grab follows the hand at a reduced gain (steadier than the hand):
  // the same direction, at least half the distance, never further.
  expect(moved.x).toBeLessThan(travel.x * 0.5);
  expect(moved.x).toBeGreaterThanOrEqual(travel.x - 1);
  expect(moved.y).toBeGreaterThan(travel.y * 0.5);
  expect(moved.y).toBeLessThanOrEqual(travel.y + 1);
  expect((await withHooks(page, (hooks) => hooks.getBoardSummary())).objectCount).toBe(1);

  // The whole carry is one undo step.
  const diagnostics = await withHooks(page, (hooks) => hooks.getInteractionDiagnostics());
  expect(diagnostics.undoDepth).toBe(depthBefore + 1);
  const undo = await withHooks(page, (hooks) => hooks.undoLastActionForEval());
  expect(undo.applied).toBe(true);
  const restored = await moverCentre(page);
  expect(restored.x).toBeCloseTo(before.x, 3);
  expect(restored.y).toBeCloseTo(before.y, 3);
});

test("a closed hand over empty board grabs nothing", async ({ page }) => {
  const canvas = await openBoardWithShape(page);
  const before = await moverCentre(page);
  const shape = await boardToCanvas(page, before);
  // Well away from the shape, on the opposite side of the canvas.
  const empty = { x: shape.x < canvas.width / 2 ? canvas.width * 0.8 : canvas.width * 0.2, y: canvas.height * 0.3 };

  const t = await grabAndMove(page, canvas, empty, { x: empty.x, y: empty.y + 150 }, await pageNow(page));
  await handAway(page, canvas, 3, t);

  const summary = await withHooks(page, (hooks) => hooks.getBoardSummary());
  expect(summary.objectCount).toBe(1);
  expect(summary.positions[0]).toEqual(before);
});

test("two closed hands held, then spread apart, zoom the board in", async ({ page }) => {
  const canvas = await openBoardWithShape(page);
  const before = await withHooks(page, (hooks) => hooks.getViewport());
  const objectsBefore = await withHooks(page, (hooks) => hooks.getBoardSummary());
  const centre = { x: canvas.width / 2, y: canvas.height * 0.4 };
  let t = await pageNow(page);
  const bothHands = async (gap: number) => {
    const left = poseAtCursor(closedFistLandmarks(), { x: centre.x - gap, y: centre.y }, canvas);
    const right = poseAtCursor(closedFistLandmarks(), { x: centre.x + gap, y: centre.y }, canvas);
    await emitHands(page, [{ ...rightHand(left), handedness: "left" }, rightHand(right)], t, canvas);
    t += FRAME_MS;
  };
  // Hold the zoom pose past the half-second engage time, then spread.
  for (let index = 0; index < 20; index += 1) await bothHands(120);
  for (let index = 1; index <= 15; index += 1) await bothHands(120 + index * 12);
  await handAway(page, canvas, 10, t);

  const after = await withHooks(page, (hooks) => hooks.getViewport());
  expect(after.scale).toBeGreaterThan(before.scale * 1.1);
  // Navigation never edits: the shape is where it was, in board space.
  const objectsAfter = await withHooks(page, (hooks) => hooks.getBoardSummary());
  expect(objectsAfter.positions).toEqual(objectsBefore.positions);
});
