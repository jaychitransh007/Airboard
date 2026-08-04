import { expect, test } from "@playwright/test";

/**
 * E2E path (b): finalized-transcript routing through the VoiceCommandRouter —
 * the exact code path a realtime speech session drives — without a
 * microphone. Covers wake-word routing, push-to-talk gating, meeting-talk
 * safety, and the single-execution invariant, all against the live app.
 */

type Hooks = {
  emitFinalTranscript(transcript: string): { routed: boolean; wakeDetected: boolean };
  emitTranscriptionProviderEvent(event: {
    type: "transcription.final";
    transcript: string;
    provider: string;
    model: string;
    confidence: number;
    turnIndex: number;
  }): { routed: boolean; wakeDetected: boolean };
  openPttGate(): void;
  emitPalmVoiceGestureFrame(frame: {
    score: number;
    point: { x: number; y: number } | null;
    timestampMs: number;
    suppressed: boolean;
  }): "activate" | "release" | null;
  resetVoiceRouting(): void;
  emitRemoteBoardEvent(event: Record<string, unknown>): void;
  getCanonicalBoardState(): {
    boardId: string;
    strokes: Record<string, {
      id: string;
      status: string;
      points: Array<Record<string, unknown>>;
      annotation?: {
        type: string;
        label?: string;
        bounds?: { x: number; y: number; width: number; height: number };
        start?: { x: number; y: number };
        end?: { x: number; y: number };
        snappedStartStrokeId?: string;
        snappedEndStrokeId?: string;
      };
    }>;
  };
  clearEvalJournals(): void;
  undoLastActionForEval(): { applied: boolean; depthBefore: number; depthAfter: number };
  getDiagramVisible(): boolean;
  getBoardSummary(): {
    objectCount: number;
    labels: string[];
    selectedCount: number;
    syncStatus: string;
  };
  getBoardEventLog(): unknown[];
  getInteractionDiagnostics(): { undoDepth: number };
};

async function hooks(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
  await expect
    .poll(async () => (await summary(page)).syncStatus, { timeout: 20_000 })
    .toBe("connected");
}

function emit(page: import("@playwright/test").Page, transcript: string) {
  return page.evaluate(
    (t) =>
      (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.emitFinalTranscript(
        t,
      ),
    transcript,
  );
}

function summary(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.getBoardSummary(),
  );
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("airboard.onboarding.v1", "done");
  });
});

test("wake-word transcripts execute; meeting talk never does", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  // Meeting talk with no wake word and no gate: inert.
  const ambient = await emit(page, "so the user hits the payment API which writes to the ledger");
  expect(ambient.routed).toBe(false);
  expect((await summary(page)).objectCount).toBe(0);

  // A wake-word command executes instantly — including disfluencies.
  await emit(page, "Hey, Airo. Uh, add a circle.");
  await expect(page.getByTestId("copilot-transcript")).toContainText(
    "Hey, Airo. Uh, add a circle.",
  );
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  expect((await summary(page)).objectCount).toBe(1);

  // Voice edit of the (auto-selected) object.
  await emit(page, "Airo, rename selected to Ledger");
  await expect(page.locator(".intent-feedback")).toContainText("Applied: Rename");
  expect((await summary(page)).labels).toEqual(["Ledger"]);
});

test("right-side copilot is collapsible and voice applies without its Send button", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  const copilot = page.getByTestId("canvas-copilot");
  await expect(copilot).toBeVisible();
  await expect(page.locator(".canvas-command-bar")).toHaveCount(0);

  await emit(page, "Airo, add a service here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(1);
  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.openPttGate(),
  );
  await emit(page, "add a database, uh, layer that is connected to service.");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(3);
  await expect(page.getByTestId("copilot-activity")).toContainText("Board updated");

  await page.getByRole("button", { name: "Hide Airo copilot" }).click();
  await expect(copilot).toHaveCount(0);
  const reopen = page.getByTestId("canvas-copilot-toggle");
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByTestId("canvas-copilot")).toBeVisible();
  await expect(page.getByTestId("intent-command-input")).toBeVisible();
});

test("open-palm swipe motion is inert and voice undo restores the board", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, add a user here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(1);

  const movingPalm = (x: number, timestampMs: number) =>
    page.evaluate(
      ({ x, timestampMs }) =>
        (window as never as { __airboardTestHooks: Hooks })
          .__airboardTestHooks.emitPalmVoiceGestureFrame({
            score: 0.92,
            point: { x, y: 0.45 },
            timestampMs,
            suppressed: false,
          }),
      { x, timestampMs },
    );
  expect(await movingPalm(0.2, 0)).toBeNull();
  expect(await movingPalm(0.3, 80)).toBeNull();
  expect(await movingPalm(0.43, 190)).toBeNull();
  await expect.poll(async () => (await summary(page)).objectCount).toBe(1);
  await expect(page.getByTestId("copilot-activity")).not.toContainText(
    "Undo gesture applied",
  );

  await emit(page, "Airo, undo");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(0);
});

test("an open palm must hold for 400 ms, activates voice once, and releases cleanly", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  const palm = (
    timestampMs: number,
    score = 0.94,
    point: { x: number; y: number } | null = { x: 0.48, y: 0.42 },
  ) =>
    page.evaluate(
      ({ timestampMs, score, point }) =>
        (window as never as { __airboardTestHooks: Hooks })
          .__airboardTestHooks.emitPalmVoiceGestureFrame({
            score,
            point,
            timestampMs,
            suppressed: false,
          }),
      { timestampMs, score, point },
    );

  expect(await palm(0)).toBeNull();
  expect(await palm(200)).toBeNull();
  expect(await palm(233, 0, null)).toBeNull();
  expect(await palm(266)).toBeNull();
  expect(await palm(399)).toBeNull();
  await expect(page.getByTestId("voice-gate-pill")).toHaveCount(0);

  expect(await palm(400)).toBe("activate");
  await expect(page.getByTestId("voice-gate-pill")).toContainText("Open palm detected");
  expect(await palm(700)).toBeNull();

  expect(await palm(800, 0, null)).toBeNull();
  expect(await palm(1_020, 0, null)).toBeNull();
  expect(await palm(1_040, 0, null)).toBe("release");
  await expect(page.getByTestId("voice-gate-pill")).toHaveCount(0);
});

test("push-to-talk gate routes wake-word-free commands exactly once", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks }).__airboardTestHooks.openPttGate(),
  );
  await expect(page.getByTestId("voice-gate-pill")).toBeVisible();

  // No wake word needed while the gate is open.
  const gated = await emit(page, "add a user here");
  expect(gated.routed).toBe(true);
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });
  expect((await summary(page)).objectCount).toBe(1);

  // The single-execution invariant, live: a gated transcript that ALSO
  // carries a wake word still routes exactly one command.
  await emit(page, "Airo, add a database here");
  await expect
    .poll(async () => (await summary(page)).objectCount, { timeout: 15_000 })
    .toBe(2);
  // Give any (buggy) duplicate route a chance to land before asserting.
  await page.waitForTimeout(400);
  expect((await summary(page)).objectCount).toBe(2);
});

test("PTT repairs the production stale connector in place, undoes exactly, and repeats as a no-op", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  for (const command of [
    "Airo, add a service named User here",
    "Airo, add a service named Client right of selected",
    "Airo, add a service named Planner right of selected",
    "Airo, connect User to Client as makes a request",
    "Airo, connect User to Planner as request goes to",
  ]) {
    await emit(page, command);
    await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
      timeout: 15_000,
    });
  }
  await expect.poll(async () => (await summary(page)).objectCount).toBe(5);

  const corrupted = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    const state = testHooks.getCanonicalBoardState();
    const labels = Object.fromEntries(
      Object.entries(state.strokes)
        .filter(([, stroke]) => stroke.annotation?.bounds)
        .map(([id, stroke]) => [stroke.annotation?.label, id]),
    );
    const edge = Object.values(state.strokes).find(
      (stroke) => stroke.annotation?.label === "request goes to",
    );
    if (!edge?.annotation || !labels.User || !labels.Client || !labels.Planner) {
      throw new Error("Unable to seed the connector regression board.");
    }
    const before = {
      annotation: {
        ...edge.annotation,
        start: { x: 520, y: 520 },
        // Preserve the healthy Planner side while making the source side stale.
        end: { ...edge.annotation.end! },
        snappedStartStrokeId: labels.User,
        snappedEndStrokeId: labels.Planner,
      },
      points: [
        { x: 520, y: 520, t: 1, inputSource: "pointer" },
        { ...edge.annotation.end!, t: 2, inputSource: "pointer" },
      ],
    };
    testHooks.emitRemoteBoardEvent({
      id: "event:e2e-stale-connector",
      boardSessionId: state.boardId,
      actorParticipantId: "participant:remote",
      createdAt: "2026-08-01T07:50:00.000Z",
      type: "stroke.annotation_updated",
      strokeId: edge.id,
      ...before,
    });
    testHooks.clearEvalJournals();
    return {
      edgeId: edge.id,
      userId: labels.User,
      clientId: labels.Client,
      plannerId: labels.Planner,
      before,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });

  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.openPttGate(),
  );
  const routed = await emit(
    page,
    "Connect existing disconnected line to Client and Planner.",
  );
  expect(routed.routed).toBe(true);
  await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
    timeout: 15_000,
  });

  const repaired = await page.evaluate(({ edgeId }) => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    const state = testHooks.getCanonicalBoardState();
    const connector = state.strokes[edgeId]!;
    return {
      connector,
      connectorCount: Object.values(state.strokes).filter(
        (stroke) =>
          stroke.status === "committed" &&
          (stroke.annotation?.type === "connector" ||
            stroke.annotation?.type === "arrow"),
      ).length,
      updateCount: testHooks.getBoardEventLog().filter(
        (event) =>
          (event as { type?: string; strokeId?: string }).type ===
            "stroke.annotation_updated" &&
          (event as { strokeId?: string }).strokeId === edgeId,
      ).length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  }, { edgeId: corrupted.edgeId });
  expect(repaired.connectorCount).toBe(2);
  expect(repaired.updateCount).toBe(1);
  expect(repaired.undoDepth).toBe(corrupted.undoDepth + 1);
  expect(repaired.connector.annotation).toMatchObject({
    label: "request goes to",
    snappedStartStrokeId: corrupted.clientId,
    snappedEndStrokeId: corrupted.plannerId,
  });

  const undo = await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.undoLastActionForEval(),
  );
  expect(undo.applied).toBe(true);
  const afterUndo = await page.evaluate(({ edgeId }) => {
    const edge = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.getCanonicalBoardState().strokes[edgeId]!;
    return { annotation: edge.annotation, points: edge.points };
  }, { edgeId: corrupted.edgeId });
  expect(afterUndo).toEqual(corrupted.before);

  // Repair again, then repeat the same complete request. The healthy repeat
  // must add neither an event nor an Undo entry and must not say "applied".
  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.openPttGate(),
  );
  await emit(page, "Connect existing disconnected line to Client and Planner.");
  await expect(page.locator(".intent-feedback")).toContainText("Applied:");
  const beforeRepeat = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    testHooks.clearEvalJournals();
    return testHooks.getInteractionDiagnostics().undoDepth;
  });
  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.openPttGate(),
  );
  await emit(page, "Connect existing disconnected line to Client and Planner.");
  await expect(page.locator(".intent-feedback")).toContainText("already attached");
  const repeated = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    return {
      events: testHooks.getBoardEventLog().length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  expect(repeated).toEqual({ events: 0, undoDepth: beforeRepeat });
});

test("ambiguous disconnected lines clarify without semantic fallback or mutation", async ({
  page,
}) => {
  let semanticRequestCount = 0;
  await page.route("**/intent/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        available: true,
        provider: "test-provider",
        defaultModel: "test-semantic-model",
        allowedModels: ["test-semantic-model"],
      }),
    });
  });
  await page.route("**/intent/resolve", async (route) => {
    semanticRequestCount += 1;
    await route.abort("failed");
  });
  await page.goto("/?testStandalone=1");
  await hooks(page);

  for (const command of [
    "Airo, add a service named Client here",
    "Airo, add a service named Planner right of selected",
    "Airo, connect Client to Planner as primary",
    "Airo, connect Client to Planner as secondary",
  ]) {
    await emit(page, command);
    await expect(page.locator(".intent-feedback")).toContainText("Applied:", {
      timeout: 15_000,
    });
  }

  const before = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    const state = testHooks.getCanonicalBoardState();
    const connectors = Object.values(state.strokes).filter(
      (stroke) =>
        stroke.status === "committed" &&
        (stroke.annotation?.type === "connector" ||
          stroke.annotation?.type === "arrow"),
    );
    connectors.forEach((connector, index) => {
      if (!connector.annotation?.end) {
        throw new Error("Unable to seed ambiguous disconnected lines.");
      }
      const annotation = {
        ...connector.annotation,
        start: { x: 360, y: 420 + index * 40 },
      };
      testHooks.emitRemoteBoardEvent({
        id: `event:e2e-ambiguous-line-${index}`,
        boardSessionId: state.boardId,
        actorParticipantId: "participant:remote",
        createdAt: `2026-08-01T08:00:0${index}.000Z`,
        type: "stroke.annotation_updated",
        strokeId: connector.id,
        annotation,
        points: [
          { ...annotation.start, t: 1, inputSource: "pointer" },
          { ...annotation.end, t: 2, inputSource: "pointer" },
        ],
      });
    });
    testHooks.clearEvalJournals();
    const seeded = testHooks.getCanonicalBoardState();
    return {
      connectors: Object.fromEntries(
        Object.values(seeded.strokes)
          .filter(
            (stroke) =>
              stroke.annotation?.type === "connector" ||
              stroke.annotation?.type === "arrow",
          )
          .map((stroke) => [stroke.id, {
            annotation: stroke.annotation,
            points: stroke.points,
          }]),
      ),
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });

  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.openPttGate(),
  );
  const routed = await emit(
    page,
    "Connect the existing disconnected line with Client and Planner.",
  );
  expect(routed.routed).toBe(true);
  await expect(page.locator(".intent-feedback")).toContainText(
    "More than one disconnected line",
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    const state = testHooks.getCanonicalBoardState();
    return {
      connectors: Object.fromEntries(
        Object.values(state.strokes)
          .filter(
            (stroke) =>
              stroke.annotation?.type === "connector" ||
              stroke.annotation?.type === "arrow",
          )
          .map((stroke) => [stroke.id, {
            annotation: stroke.annotation,
            points: stroke.points,
          }]),
      ),
      events: testHooks.getBoardEventLog(),
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  expect(semanticRequestCount).toBe(0);
  expect(after.events).toEqual([]);
  expect(after.undoDepth).toBe(before.undoDepth);
  expect(after.connectors).toEqual(before.connectors);
});

test("provider-final Data/Dataset wording updates an existing board and repeat finals are mutation-free", async ({
  page,
}) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, add a database named Golden Dataset here");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(1);
  await emit(page, "Airo, add a database named Historical Dataset right of selected");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(2);
  await emit(page, "Airo, add a process named Planner below selected");
  await expect.poll(async () => (await summary(page)).objectCount).toBe(3);

  const providerFinal = {
    type: "transcription.final" as const,
    transcript:
      "Planner receives the additional context from the historical data and golden dataset.",
    provider: "deepgram",
    model: "flux-general-en",
    confidence: 0.7715,
    turnIndex: 21,
  };
  await page.evaluate(() =>
    (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks.openPttGate(),
  );
  const routed = await page.evaluate(
    (event) =>
      (window as never as { __airboardTestHooks: Hooks })
        .__airboardTestHooks.emitTranscriptionProviderEvent(event),
    providerFinal,
  );
  expect(routed.routed).toBe(true);
  await expect.poll(async () => (await summary(page)).objectCount).toBe(5);

  const beforeRepeat = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    return {
      eventCount: testHooks.getBoardEventLog().length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  await page.evaluate(
    (event) =>
      (window as never as { __airboardTestHooks: Hooks })
        .__airboardTestHooks.emitTranscriptionProviderEvent(event),
    providerFinal,
  );
  await expect(page.locator(".intent-feedback")).toContainText(
    "already present",
  );
  await page.waitForTimeout(250);
  expect((await summary(page)).objectCount).toBe(5);
  const afterRepeat = await page.evaluate(() => {
    const testHooks = (window as never as { __airboardTestHooks: Hooks })
      .__airboardTestHooks;
    return {
      eventCount: testHooks.getBoardEventLog().length,
      undoDepth: testHooks.getInteractionDiagnostics().undoDepth,
    };
  });
  expect(afterRepeat).toEqual(beforeRepeat);
});

test("voice hides and restores the diagram while hidden edits stay suspended", async ({ page }) => {
  await page.goto("/?testStandalone=1");
  await hooks(page);

  await emit(page, "Airo, hide diagram");
  await expect(page.locator("main.airboard-shell")).toHaveClass(/diagram-hidden/);
  expect(
    await page.evaluate(
      () =>
        (window as never as { __airboardTestHooks: Hooks })
          .__airboardTestHooks.getDiagramVisible(),
    ),
  ).toBe(false);

  await emit(page, "Airo, add a database named Hidden");
  await page.waitForTimeout(250);
  expect((await summary(page)).objectCount).toBe(0);
  await expect(page.locator(".intent-feedback")).toContainText("editing commands are suspended");

  await emit(page, "Airo, bring the diagram back");
  await expect(page.locator("main.airboard-shell")).not.toHaveClass(/diagram-hidden/);
});
