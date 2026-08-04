import { expect, test } from "@playwright/test";

/**
 * E2E path (a): the typed command flow, end to end through parse → ground →
 * commit → render state. This is the integration test that would have caught
 * every orchestration regression of the last weeks.
 */

test("typing a command creates and edits objects instantly", async ({ page }) => {
  await page.goto("/?testStandalone=1");

  // First run shows the onboarding overlay; dismissing it is part of the flow.
  const onboarding = page.getByRole("button", { name: "Got it — let me try" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();

  const input = page.getByTestId("intent-command-input");
  await expect(input).toBeVisible();

  // Create.
  await input.fill("add a circle here");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  // Instant-commit feedback remains in the command panel without an
  // obstructive floating action toast.
  await expect(page.getByTestId("action-toast")).toHaveCount(0);

  // Edit the selected object by typed command (no confirmation anywhere).
  await input.fill("rename selected to Payments");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");

  const summary = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): unknown } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(summary).toMatchObject({ objectCount: 1, labels: ["Payments"] });

  // Voice-parity commands through the same pipeline: recolor, resize, select.
  await input.fill("make selected red");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Color");

  await input.fill("make selected taller");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Resize");

  await input.fill("select everything");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Select every object");

  // Keyboard Undo remains available without a camera gesture.
  await input.fill("delete selected");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Delete");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect
    .poll(async () => {
      const state = await page.evaluate(() =>
        (window as never as {
          __airboardTestHooks: {
            getBoardSummary(): { objectCount: number };
          };
        }).__airboardTestHooks.getBoardSummary(),
      );
      return state.objectCount;
    })
    .toBe(1);

  // The menu remains an explicit pointer-accessible Undo path too.
  await input.fill("delete selected");
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Delete");
  await page.getByRole("button", { name: "More board actions" }).click();
  await page.getByRole("menuitem", { name: "Undo" }).click();
  const restored = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: { getBoardSummary(): { objectCount: number } } })
      .__airboardTestHooks.getBoardSummary(),
  );
  expect(restored.objectCount).toBe(1);
});

test("recipient narrative adds both dataset inputs atomically and repairs the observed STT final", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await page.getByRole("button", { name: "Got it — let me try" }).click();
  const input = page.getByTestId("intent-command-input");
  const apply = async (command: string) => {
    await input.fill(command);
    await page.getByTestId("intent-primary-action").click();
    await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
      timeout: 15_000,
    });
  };

  await apply("add a database named Golden Dataset here");
  await apply("add a database named Historical Dataset right of selected");
  await apply("add a process named Planner below selected");

  const readEdges = () =>
    page.evaluate(() => {
      const state = (
        window as never as {
          __airboardTestHooks: {
            getCanonicalBoardState(): {
              strokes: Record<
                string,
                {
                  status: string;
                  annotation?: {
                    type: string;
                    label?: string;
                    snappedStartStrokeId?: string;
                    snappedEndStrokeId?: string;
                  };
                }
              >;
            };
          };
        }
      ).__airboardTestHooks.getCanonicalBoardState();
      const labels = Object.fromEntries(
        Object.entries(state.strokes)
          .filter(
            ([, stroke]) =>
              stroke.status === "committed" &&
              stroke.annotation &&
              stroke.annotation.type !== "connector" &&
              stroke.annotation.type !== "arrow",
          )
          .map(([id, stroke]) => [id, stroke.annotation?.label ?? ""]),
      );
      return Object.values(state.strokes)
        .filter(
          (stroke) =>
            stroke.status === "committed" &&
            (stroke.annotation?.type === "connector" ||
              stroke.annotation?.type === "arrow"),
        )
        .map((stroke) => ({
          from: labels[stroke.annotation?.snappedStartStrokeId ?? ""],
          to: labels[stroke.annotation?.snappedEndStrokeId ?? ""],
          label: stroke.annotation?.label,
        }))
        .sort((left, right) => String(left.from).localeCompare(String(right.from)));
    });

  const expectedEdges = [
    {
      from: "Golden Dataset",
      to: "Planner",
      label: "additional context",
    },
    {
      from: "Historical Dataset",
      to: "Planner",
      label: "additional context",
    },
  ];

  await apply(
    "The planner gets the additional context from the golden dataset and historical dataset.",
  );
  await expect.poll(readEdges).toEqual(expectedEdges);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(readEdges).toEqual([]);

  await apply(
    "Planner receives the additional context from the historical data and golden dataset.",
  );
  await expect.poll(readEdges).toEqual(expectedEdges);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(readEdges).toEqual([]);

  await apply(
    "So this will accept the additional content from the schema data and another additional context from the historical dataset.",
  );
  await expect.poll(readEdges).toEqual(expectedEdges);

  const beforeRepeat = await page.evaluate(() => {
    const hooks = (
      window as never as {
        __airboardTestHooks: {
          getBoardEventLog(): unknown[];
          getInteractionDiagnostics(): { undoDepth: number };
        };
      }
    ).__airboardTestHooks;
    return {
      eventCount: hooks.getBoardEventLog().length,
      undoDepth: hooks.getInteractionDiagnostics().undoDepth,
    };
  });
  await input.fill(
    "Planner receives the additional context from the historical data and golden dataset.",
  );
  await page.getByTestId("intent-primary-action").click();
  await expect(page.locator(".intent-feedback")).toContainText(
    "already present",
  );
  await expect.poll(readEdges).toEqual(expectedEdges);
  const afterRepeat = await page.evaluate(() => {
    const hooks = (
      window as never as {
        __airboardTestHooks: {
          getBoardEventLog(): unknown[];
          getInteractionDiagnostics(): { undoDepth: number };
        };
      }
    ).__airboardTestHooks;
    return {
      eventCount: hooks.getBoardEventLog().length,
      undoDepth: hooks.getInteractionDiagnostics().undoDepth,
    };
  });
  expect(afterRepeat).toEqual(beforeRepeat);

  const finalState = await page.evaluate(() =>
    (
      window as never as {
        __airboardTestHooks: {
          getCanonicalBoardState(): {
            strokes: Record<string, { status: string; annotation?: { label?: string } }>;
          };
        };
      }
    ).__airboardTestHooks.getCanonicalBoardState(),
  );
  expect(
    Object.values(finalState.strokes).some(
      (stroke) =>
        stroke.status === "committed" &&
        stroke.annotation?.label === "Schema Data",
    ),
  ).toBe(false);
});
