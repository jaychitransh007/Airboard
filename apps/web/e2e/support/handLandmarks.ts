import type { DetectedHand, HandLandmark } from "@airboard/gesture-engine";
import type { Page } from "@playwright/test";
import type { RawLandmarkFrameOutcome } from "./testHooks";
import { withHooks } from "./testHooks";

/**
 * Synthetic HandLandmarker hands for driving the camera path through
 * `emitRawLandmarkFrame`: below MediaPipe, above every production estimator,
 * tracker, arbitration rule and board action. The poses match the ones the
 * landmark unit tests use (test/landmarkManipulationInput.test.mjs).
 */

const point = (x: number, y: number, z = 0): HandLandmark => ({ x, y, z });

/** A presented open palm, fingers up. */
export function openHandLandmarks(): HandLandmark[] {
  return [
    point(0.5, 0.9),
    point(0.43, 0.78),
    point(0.35, 0.68),
    point(0.28, 0.6),
    point(0.2, 0.55),
    point(0.42, 0.67),
    point(0.4, 0.48),
    point(0.39, 0.34),
    point(0.38, 0.2),
    point(0.5, 0.64),
    point(0.5, 0.42),
    point(0.5, 0.27),
    point(0.5, 0.12),
    point(0.58, 0.67),
    point(0.6, 0.49),
    point(0.61, 0.36),
    point(0.62, 0.23),
    point(0.66, 0.72),
    point(0.69, 0.57),
    point(0.71, 0.46),
    point(0.73, 0.35),
  ];
}

/** A closed fist: the grab pose. */
export function closedFistLandmarks(): HandLandmark[] {
  return [
    point(0.5, 0.9),
    point(0.43, 0.78),
    point(0.39, 0.7),
    point(0.47, 0.67),
    point(0.56, 0.69),
    point(0.42, 0.67),
    point(0.4, 0.54),
    point(0.43, 0.61),
    point(0.47, 0.68),
    point(0.5, 0.64),
    point(0.5, 0.5),
    point(0.52, 0.58),
    point(0.52, 0.68),
    point(0.58, 0.67),
    point(0.6, 0.54),
    point(0.58, 0.61),
    point(0.56, 0.69),
    point(0.66, 0.72),
    point(0.68, 0.6),
    point(0.64, 0.65),
    point(0.6, 0.72),
  ];
}

const PALM_KNUCKLES = [5, 9, 13, 17] as const;
/**
 * The HybridGestureController's default control zone (packages/gesture-engine
 * hybridGestureController.ts): a compact hand area mapped onto the whole
 * canvas, mirrored like a selfie view.
 */
const CONTROL_ZONE = { x: 0.22, y: 0.16, width: 0.56, height: 0.68 };

export type CanvasSize = { width: number; height: number };

/**
 * Moves a pose so its palm (the knuckle average the manipulation signal
 * follows) sits where the hover cursor lands on `cursor`, in canvas pixels.
 * Assumes the camera frame has the canvas's size, which `emitHand` passes.
 */
export function poseAtCursor(
  landmarks: HandLandmark[],
  cursor: { x: number; y: number },
  canvas: CanvasSize,
): HandLandmark[] {
  const palm = {
    x: PALM_KNUCKLES.reduce((sum, index) => sum + landmarks[index]!.x, 0) / PALM_KNUCKLES.length,
    y: PALM_KNUCKLES.reduce((sum, index) => sum + landmarks[index]!.y, 0) / PALM_KNUCKLES.length,
  };
  const target = {
    x: 1 - (CONTROL_ZONE.x + (CONTROL_ZONE.width * cursor.x) / canvas.width),
    y: CONTROL_ZONE.y + (CONTROL_ZONE.height * cursor.y) / canvas.height,
  };
  return landmarks.map((landmark) => ({
    ...landmark,
    x: landmark.x + target.x - palm.x,
    y: landmark.y + target.y - palm.y,
  }));
}

export function rightHand(landmarks: HandLandmark[]): DetectedHand {
  return { handedness: "right", handednessScore: 0.96, landmarks };
}

/** One camera frame with these hands (none means the hand left the frame). */
export function emitHands(
  page: Page,
  hands: DetectedHand[],
  timestampMs: number,
  canvas: CanvasSize,
): Promise<RawLandmarkFrameOutcome> {
  return withHooks(
    page,
    (hooks, frame) =>
      hooks.emitRawLandmarkFrame(frame.hands, frame.timestampMs, {
        sourceWidth: frame.canvas.width,
        sourceHeight: frame.canvas.height,
      }),
    { hands, timestampMs, canvas },
  );
}

/** The board canvas's size, the frame every hand cursor is measured in. */
export async function canvasSize(page: Page): Promise<CanvasSize> {
  return page.evaluate(() => {
    const rect = document.querySelector("canvas.board-canvas")!.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
}

/** Where a board point appears on the canvas, in canvas pixels. */
export async function boardToCanvas(page: Page, boardPoint: { x: number; y: number }) {
  const viewport = await withHooks(page, (hooks) => hooks.getViewport());
  return {
    x: boardPoint.x * viewport.scale + viewport.x,
    y: boardPoint.y * viewport.scale + viewport.y,
  };
}

/** The page's own clock, so synthetic frames line up with real timers. */
export function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/**
 * Carries `shape` out of the dock's Shape menu by hand: an open palm over the
 * Shape button opens the menu, a fist over the shape picks it up, and an open
 * hand over `drop` (canvas pixels) places it. Returns whether the hand cue
 * reported the shape placed.
 */
export async function carryFromDock(
  page: Page,
  canvas: CanvasSize,
  shape: string,
  drop: { x: number; y: number },
  startMs: number,
): Promise<boolean> {
  const frameMs = 33;
  let t = startMs;
  const canvasBox = (await page.locator("canvas.board-canvas").boundingBox())!;
  const centreOf = async (box: { x: number; y: number; width: number; height: number } | null) => ({
    x: box!.x + box!.width / 2 - canvasBox.x,
    y: box!.y + box!.height / 2 - canvasBox.y,
  });
  const frames = async (landmarks: () => HandLandmark[], at: { x: number; y: number }, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await emitHands(page, [rightHand(poseAtCursor(landmarks(), at, canvas))], t, canvas);
      t += frameMs;
    }
  };
  const toolbar = page.getByRole("toolbar", { name: "Board creation tools" });
  const trigger = await centreOf(await toolbar.getByRole("button", { name: "Shape", exact: true }).boundingBox());
  await frames(openHandLandmarks, trigger, 8);
  const menu = page.getByRole("menu", { name: "Recent shapes and connectors" });
  await menu.waitFor({ state: "visible" });
  const tile = await centreOf(await menu.getByRole("menuitem", { name: shape, exact: true }).boundingBox());
  await frames(openHandLandmarks, tile, 6);
  await frames(closedFistLandmarks, tile, 6);
  const steps = 12;
  for (let index = 1; index <= steps; index += 1) {
    await frames(closedFistLandmarks, {
      x: tile.x + ((drop.x - tile.x) * index) / steps,
      y: tile.y + ((drop.y - tile.y) * index) / steps,
    }, 1);
  }
  await frames(closedFistLandmarks, drop, 4);
  await frames(openHandLandmarks, drop, 6);
  for (let index = 0; index < 3; index += 1) {
    await emitHands(page, [], t, canvas);
    t += frameMs;
  }
  const cue = page.getByTestId("hand-cue");
  await cue.waitFor({ state: "visible" });
  return /placed/i.test((await cue.textContent()) ?? "");
}

/**
 * Closes the hand over `from`, carries it to `to` and opens it, at camera
 * frame rate. Returns the timestamp after the last frame.
 */
export async function grabAndMove(
  page: Page,
  canvas: CanvasSize,
  from: { x: number; y: number },
  to: { x: number; y: number },
  startMs: number,
): Promise<number> {
  const frameMs = 33;
  let t = startMs;
  const frame = async (landmarks: HandLandmark[], at: { x: number; y: number }) => {
    await emitHands(page, [rightHand(poseAtCursor(landmarks, at, canvas))], t, canvas);
    t += frameMs;
  };
  // Hover long enough for the smoothed cursor to settle on the shape, but
  // well under the 400 ms an open palm needs to open the voice gate.
  for (let index = 0; index < 6; index += 1) await frame(openHandLandmarks(), from);
  for (let index = 0; index < 6; index += 1) await frame(closedFistLandmarks(), from);
  const steps = 12;
  for (let index = 1; index <= steps; index += 1) {
    await frame(closedFistLandmarks(), {
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
    });
  }
  for (let index = 0; index < 4; index += 1) await frame(closedFistLandmarks(), to);
  for (let index = 0; index < 6; index += 1) await frame(openHandLandmarks(), to);
  // The hand leaves the camera.
  for (let index = 0; index < 3; index += 1) {
    await emitHands(page, [], t, canvas);
    t += frameMs;
  }
  return t;
}
