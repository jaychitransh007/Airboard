import type { BoardEvent, BoardState } from "@airboard/core";
import type {
  DetectedHand,
  GestureResult,
  HybridGestureControllerOutput,
  HybridGestureControllerState,
} from "@airboard/gesture-engine";
import type { Page } from "@playwright/test";
import type { BoardViewport } from "../../src/features/board/boardViewport";
import type { GestureFrameOwner } from "../../src/features/board/gestureFrameArbitration";
import type {
  GestureTraceEvent,
  GestureTraceSummary,
} from "../../src/features/board/gestureFrameCoordinator";
import type { HandPointingSnapshot } from "../../src/features/board/handPointing";
import type {
  PalmVoiceGestureEvent,
  PalmVoiceGestureFrame,
} from "../../src/features/board/palmVoiceGestureTracker";
import type { SnapGestureFrame } from "../../src/features/board/snapGestureTracker";
import type { VoiceTraceEvent } from "../../src/features/board/voiceTrace";

/**
 * The browser-test seam the board exposes as `window.__airboardTestHooks`
 * when NEXT_PUBLIC_AIRBOARD_TEST_HOOKS=1 (see the test-hooks effect in
 * src/features/board/AirboardPrototype.tsx). Every e2e spec reads the hooks
 * through this one type, so renaming a hook or changing what it returns fails
 * typecheck instead of failing at runtime in the browser.
 *
 * Keep it in step with the effect: same 22 method names, same arguments, same
 * return shapes.
 */
export type AirboardTestHooks = {
  /** Routes a final transcript the way a realtime speech session does. */
  emitFinalTranscript(transcript: string): TranscriptRouting;
  /** A provider event; only non-empty `transcription.final` events route. */
  emitTranscriptionProviderEvent(event: {
    type: string;
    transcript?: string;
    provider?: string;
    model?: string;
    confidence?: number;
    turnIndex?: number;
  }): TranscriptRouting | { routed: false; wakeDetected: false };
  /**
   * One HandLandmarker frame, entering below MediaPipe and above every
   * production estimator, tracker, arbitration rule and board action.
   */
  emitRawLandmarkFrame(
    hands: readonly DetectedHand[],
    timestampMs?: number,
    metadata?: { inferenceMs?: number; sourceWidth?: number; sourceHeight?: number },
  ): RawLandmarkFrameOutcome;
  /** A live-session peer's event: applied and saved, never re-published. */
  emitRemoteBoardEvent(event: BoardEvent): void;
  /** The deterministic typed-command path, without Airo. */
  prepareLegacyIntentCommandForEval(instruction: string): "previewed" | "applied" | "no-op" | "rejected";
  openPttGate(): void;
  emitPalmVoiceGestureFrame(frame: PalmVoiceGestureFrame): PalmVoiceGestureEvent;
  /** True when the frame completes a snap. */
  emitSnapGestureFrame(frame: SnapGestureFrame): boolean;
  emitHybridGestureOutput(output: HybridGestureControllerOutput): void;
  setDiagramVisible(visible: boolean): void;
  getDiagramVisible(): boolean;
  resetVoiceRouting(): void;
  getViewport(): BoardViewport;
  getCanonicalBoardState(): BoardState;
  getBoardEventLog(): BoardEvent[];
  getInteractionDiagnostics(): InteractionDiagnostics;
  undoLastActionForEval(): { applied: boolean; depthBefore: number; depthAfter: number };
  clearEvalJournals(): void;
  getCatalogGestureState(): CatalogGestureState;
  getHandPointingSnapshot(): HandPointingSnapshot;
  setViewport(viewport: BoardViewport): void;
  getBoardSummary(): BoardSummary;
};

export type TranscriptRouting = { routed: boolean; wakeDetected: boolean; voiceTurnId: string };

export type RawLandmarkFrameOutcome = {
  owner: GestureFrameOwner | null;
  pipelineGesture: GestureResult["gesture"] | null;
  hybridState: HybridGestureControllerState | null;
};

export type InteractionDiagnostics = {
  selectionIds: string[];
  viewport: BoardViewport;
  gestureOwner: unknown;
  gestureTrace: GestureTraceEvent[];
  gestureSummary: GestureTraceSummary | null;
  voiceStages: VoiceTraceEvent[];
  undoDepth: number;
  pendingInteraction: { requestText: string; commandCount: number } | null;
};

export type CatalogGestureState = {
  openCatalogId: string | null;
  activeTool: string;
  interactionMode: string | null;
  carriedTool: string | null;
  enteredCanvas: boolean;
  placementActive: boolean;
  ghostCenter: { x: number; y: number } | null;
  activeCreationTool: string;
  selectedElementIds: string[];
};

export type BoardSummary = {
  /** Active scene elements. */
  objectCount: number;
  labels: string[];
  positions: Array<{ x: number; y: number } | null>;
  selectedCount: number;
  boardSessionId: string | null;
  syncStatus: string;
};

/**
 * `window` as the board's test build sees it. Inside `page.evaluate` (which
 * runs in the browser, so it can't call helpers from this file), read the
 * hooks with `(window as unknown as AirboardTestWindow).__airboardTestHooks`.
 */
export type AirboardTestWindow = Window & { __airboardTestHooks: AirboardTestHooks };

/** Waits until the board has installed its test hooks. */
export async function waitForTestHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => "__airboardTestHooks" in window);
}

/**
 * Runs `script` in the page with the typed hooks (and an optional
 * serializable `arg`). The script is sent as source text, so it must not
 * close over anything from the test file; pass what it needs as `arg`.
 */
export function withHooks<R, A = undefined>(
  page: Page,
  script: (hooks: AirboardTestHooks, arg: A) => R,
  arg?: A,
): Promise<Awaited<R>> {
  return page.evaluate(
    ({ body, input }) =>
      // eslint-disable-next-line no-new-func
      new Function("hooks", "arg", `return (${body})(hooks, arg);`)(
        (window as unknown as AirboardTestWindow).__airboardTestHooks,
        input,
      ) as never,
    { body: script.toString(), input: arg ?? null },
  ) as Promise<Awaited<R>>;
}
