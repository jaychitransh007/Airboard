import { expect, test, type Page } from "@playwright/test";
import { waitForTestHooks, type AirboardTestWindow } from "./support/testHooks";

type CanonicalBoard = {
  elements: Record<
    string,
    {
      status: string;
      metadata?: { lastInputSource?: string };
      points?: Array<{ inputSource?: string }>;
    }
  >;
};

async function objectPositions(
  page: Page,
): Promise<Array<{ x: number; y: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as AirboardTestWindow).__airboardTestHooks
        .getBoardSummary()
        .positions.filter(
          (position): position is { x: number; y: number } =>
            position !== null,
        ),
  );
}

async function inputSources(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // A narrow view of the board: just the input-source fields read here.
    const board = (window as unknown as AirboardTestWindow).__airboardTestHooks
      .getCanonicalBoardState() as unknown as CanonicalBoard;
    return Object.values(board.elements)
      .filter(({ status }) => status === "active")
      .map(
        ({ metadata, points }) =>
          metadata?.lastInputSource ??
          points?.find(({ inputSource }) => inputSource)?.inputSource ??
          "",
      )
      .filter(Boolean)
      .sort();
  });
}

async function viewport(
  page: Page,
): Promise<{ x: number; y: number; scale: number }> {
  return page.evaluate(() =>
    (window as unknown as AirboardTestWindow).__airboardTestHooks.getViewport(),
  );
}

async function drawPenStroke(
  page: Page,
  points: Array<[number, number]>,
) {
  const cdp = await page.context().newCDPSession(page);
  const first = points[0];
  if (!first) {
    throw new Error("A pen stroke requires at least one point.");
  }
  const rest = points.slice(1);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: first[0],
    y: first[1],
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
  });
  for (const [x, y] of rest) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "left",
      buttons: 1,
      pointerType: "pen",
    });
  }
  const last = points.at(-1)!;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: last[0],
    y: last[1],
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
  });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("pointer, touchpad, and stylus streams ground to attributed final state", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await waitForTestHooks(page);

  const canvas = page.locator("canvas.board-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const input = page.getByTestId("intent-command-input");
  await input.fill("add a service named Pointer Target here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:");
  const initialPointerPositions = await objectPositions(page);
  expect(initialPointerPositions).toHaveLength(1);
  const initialPointerPosition = initialPointerPositions[0]!;
  await page.mouse.move(
    box!.x + initialPointerPosition.x,
    box!.y + initialPointerPosition.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    box!.x + initialPointerPosition.x + 90,
    box!.y + initialPointerPosition.y + 45,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await objectPositions(page))[0]!.x)
    .toBeGreaterThan(initialPointerPosition.x + 50);

  const movedPointerPosition = (await objectPositions(page))[0]!;
  await page.mouse.move(
    box!.x + movedPointerPosition.x,
    box!.y + movedPointerPosition.y,
  );
  await page.mouse.down({ button: "right" });
  await page.mouse.move(
    box!.x + movedPointerPosition.x + 100,
    box!.y + movedPointerPosition.y + 60,
    { steps: 3 },
  );
  await page.mouse.up({ button: "right" });
  expect((await objectPositions(page))[0]).toEqual(movedPointerPosition);
  await canvas.focus();
  await page.keyboard.press("q");
  expect((await objectPositions(page))[0]).toEqual(movedPointerPosition);

  // Touchpad: a pinch (ctrl + wheel) zooms around the cursor and a
  // two-finger scroll pans. Both move only the view, never the board.
  const anchor = { x: 240, y: 260 };
  const pinchBox = (await canvas.boundingBox())!;
  await page.mouse.move(pinchBox.x + anchor.x, pinchBox.y + anchor.y);
  const beforePinch = await viewport(page);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await viewport(page)).scale)
    .toBeGreaterThan(beforePinch.scale);
  const afterPinch = await viewport(page);
  const boardPointUnderCursor = (view: { x: number; y: number; scale: number }) => ({
    x: (anchor.x - view.x) / view.scale,
    y: (anchor.y - view.y) / view.scale,
  });
  expect(boardPointUnderCursor(afterPinch).x).toBeCloseTo(
    boardPointUnderCursor(beforePinch).x,
    0,
  );
  expect(boardPointUnderCursor(afterPinch).y).toBeCloseTo(
    boardPointUnderCursor(beforePinch).y,
    0,
  );
  await page.mouse.wheel(120, 80);
  await expect
    .poll(async () => Math.abs((await viewport(page)).x - afterPinch.x))
    .toBeGreaterThan(1);
  expect(await objectPositions(page)).toEqual([movedPointerPosition]);

  await canvas.focus();
  await page.keyboard.press("m");

  await drawPenStroke(
    page,
    ([
      [320, 140],
      [370, 170],
      [420, 200],
      [440, 210],
    ] satisfies Array<[number, number]>).map(
      ([x, y]): [number, number] => [pinchBox.x + x, pinchBox.y + y],
    ),
  );

  await expect.poll(() => inputSources(page)).toEqual(["pointer", "stylus"]);
});
