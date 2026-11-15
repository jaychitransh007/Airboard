import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync,
} from "node:fs";
import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { AirboardTestWindow } from "./support/testHooks";
import {
  createGestureBrowserEvidence,
  evaluateGestureBrowserEvidence,
  writeGestureBrowserEvidence,
} from "../../../scripts/lib/gesture-browser-evidence.mjs";
import { launchOptionsWith } from "./support/launchOptions";

type BrowserReplayAsset = {
  id: string;
  artifactType: "video";
  contentType: "video/x-y4m";
  storageKey: string;
  datasetSplit: string;
  hash: { algorithm: "sha256"; value: string };
  annotations: {
    evaluationOwner: "browser_video_replay";
    browserReplay: {
      runDurationMs: number;
      setup?: {
        deterministicWakeTranscripts?: string[];
        viewport?: {
          x: number;
          y: number;
          scale: number;
        };
        diagramVisible?: boolean;
      };
      minimumPerceptionFrames?: number;
      requiredStages?: string[];
      requiredOwners?: string[];
      requiredTargetedGestures?: {
        gesture: string;
        count: number;
      }[];
      forbiddenGestureActions?: string[];
      expectedAppliedActions: {
        gesture: string;
        count: number;
      }[];
      minimumBoardEventCount?: number;
      maximumBoardEventCount?: number;
      minimumCommittedObjects?: number;
      maximumCommittedObjects?: number;
      minimumMovedObjectCount?: number;
      maximumMovedObjectCount?: number;
      minimumCreatedObjectCount?: number;
      maximumCreatedObjectCount?: number;
      minimumDeletedObjectCount?: number;
      maximumDeletedObjectCount?: number;
      minimumViewportPanDistance?: number;
      minimumViewportScaleDelta?: number;
      expectedDiagramVisible?: boolean;
      minimumSelectionCount?: number;
      maximumSelectionCount?: number;
      minimumUndoDepth?: number;
      maximumFrameProcessingP95Ms?: number;
      expectedInitialBoardHash?: string;
      expectedFinalBoardHash?: string;
      requireUndoRoundTrip?: boolean;
    };
  };
};

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const manifestBytes = readFileSync(
  resolve(repositoryRoot, "evals/gesture/corpus.v1.json"),
);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  corpusVersion: string;
  assets?: unknown[];
};
const manifestHash = `sha256:${createHash("sha256")
  .update(manifestBytes)
  .digest("hex")}`;
const requestedSplit =
  process.env.AIRBOARD_EVAL_DATASET_SPLIT ?? "regression";
const runId = process.env.AIRBOARD_EVAL_RUN_ID ?? null;
const evidenceDirectory =
  process.env.AIRBOARD_GESTURE_BROWSER_EVIDENCE_DIR ??
  (process.env.AIRBOARD_EVAL_OUTPUT_DIR && runId
    ? resolve(
        process.env.AIRBOARD_EVAL_OUTPUT_DIR,
        "gesture",
        "browser-evidence",
        runId,
      )
    : null);
const mediaRoot = process.env.AIRBOARD_EVAL_MEDIA_ROOT
  ? realpathSync(process.env.AIRBOARD_EVAL_MEDIA_ROOT)
  : null;
const assets = (manifest.assets ?? []).filter(
  (asset): asset is BrowserReplayAsset =>
    isRecord(asset) &&
    asset.assetClass === "restricted_raw_media" &&
    asset.artifactType === "video" &&
    asset.contentType === "video/x-y4m" &&
    asset.datasetSplit === requestedSplit &&
    isRecord(asset.annotations) &&
    asset.annotations.evaluationOwner === "browser_video_replay" &&
    isRecord(asset.annotations.browserReplay) &&
    typeof asset.storageKey === "string",
);

if (assets.length === 0) {
  test("recorded-video gesture replay has no fixture for this dataset split", async () => {
    test.skip(
      true,
      `No ${requestedSplit} browser-video asset is declared; release dataset validation fails closed separately.`,
    );
  });
}

for (const asset of assets) {
  test.describe(`recorded gesture provider replay: ${asset.id}`, () => {
    const videoPath = restrictedVideoPath(asset);
    test.use({
      launchOptions: launchOptionsWith([
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${videoPath}`,
      ]),
    });

    test(`runs ${asset.id} through video, HandLandmarker, arbitration, and board effects`, async ({
      page,
    }) => {
      test.setTimeout(
        Math.max(60_000, asset.annotations.browserReplay.runDurationMs + 45_000),
      );
      const content = readFileSync(videoPath);
      expect(
        createHash("sha256").update(content).digest("hex"),
        "mounted recorded-video hash",
      ).toBe(asset.hash.value);

      // The camera starts on its own as the board opens; hold it until the setup
      // and baseline are done, so the replay starts from a known board.
      await page.addInitScript(() => {
        const media = navigator.mediaDevices;
        const original = media.getUserMedia.bind(media);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        (window as unknown as { __releaseReplayCamera: () => void }).__releaseReplayCamera = release;
        media.getUserMedia = async (constraints) => {
          await gate;
          return original(constraints);
        };
      });
      await page.goto("/?testStandalone=1");
      const onboarding = page.getByRole("button", {
        name: "Got it",
      });
      if (await onboarding.isVisible()) await onboarding.click();
      const setup = asset.annotations.browserReplay.setup;
      for (const transcript of setup?.deterministicWakeTranscripts ?? []) {
        await page.evaluate(async (input) => {
          const hooks = (window as unknown as AirboardTestWindow).__airboardTestHooks;
          await hooks.emitFinalTranscript(input);
        }, transcript);
      }
      if (setup?.viewport) {
        await page.evaluate((viewport) => {
          (window as unknown as AirboardTestWindow).__airboardTestHooks.setViewport(viewport);
        }, setup.viewport);
      }
      if (setup?.diagramVisible !== undefined) {
        await page.evaluate((visible) => {
          (window as unknown as AirboardTestWindow).__airboardTestHooks.setDiagramVisible(visible);
        }, setup.diagramVisible);
      }
      await page.evaluate(() => {
        (window as unknown as AirboardTestWindow).__airboardTestHooks.clearEvalJournals();
      });
      const baseline = await readOutcomeSnapshot(page);
      await page.evaluate(() =>
        (window as unknown as { __releaseReplayCamera: () => void }).__releaseReplayCamera(),
      );
      await expect(
        page.locator(".status-grid").getByText("On", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      await page.waitForTimeout(
        asset.annotations.browserReplay.runDurationMs,
      );
      const observation = await page.evaluate(() => {
        const hooks = (window as unknown as AirboardTestWindow).__airboardTestHooks;
        const board = hooks.getCanonicalBoardState();
        return {
          events: hooks.getBoardEventLog().length,
          committedObjects: Object.values(board.elements).filter(
            (element) => element.status === "active" && element.kind !== "drawing",
          ).length,
          diagnostics: hooks.getInteractionDiagnostics(),
          canonicalBoard: board,
          diagramVisible: hooks.getDiagramVisible(),
          objects: Object.fromEntries(
            Object.entries(board.elements)
              .filter(
                ([, element]) =>
                  element.status === "active" && element.kind !== "drawing",
              )
              .map(([id, element]) => [
                id,
                element.kind === "connector"
                  ? null
                  : {
                      x: element.transform.x,
                      y: element.transform.y,
                      width: element.transform.width,
                      height: element.transform.height,
                    },
              ]),
          ),
        };
      });
      const objectOutcome = compareObjectSnapshots(
        baseline.objects,
        observation.objects,
      );
      const viewportPanDistance = Math.hypot(
        observation.diagnostics.viewport.x - baseline.viewport.x,
        observation.diagnostics.viewport.y - baseline.viewport.y,
      );
      const viewportScaleDelta = Math.abs(
        observation.diagnostics.viewport.scale - baseline.viewport.scale,
      );
      const oracle = asset.annotations.browserReplay;
      const gestureSummary = observation.diagnostics.gestureSummary;
      if (!gestureSummary) {
        throw new Error("The replay recorded no gesture trace summary.");
      }
      const stageCounts: Record<string, number | undefined> = gestureSummary.stageCounts;
      const perceptionFrames =
        gestureSummary.stageCounts.perception_health ?? 0;
      expect(perceptionFrames).toBeGreaterThanOrEqual(
        oracle.minimumPerceptionFrames ?? 1,
      );
      for (const stage of oracle.requiredStages ?? []) {
        expect(
          (stageCounts[stage] ?? 0) > 0,
          `required gesture stage ${stage}`,
        ).toBe(true);
      }
      for (const owner of oracle.requiredOwners ?? []) {
        expect(
          gestureSummary.observedOwners.includes(owner),
          `required arbitration owner ${owner}`,
        ).toBe(true);
      }
      for (const target of oracle.requiredTargetedGestures ?? []) {
        expect(
          gestureSummary.targetedGestureCounts[target.gesture] ?? 0,
          `target observations for ${target.gesture}`,
        ).toBeGreaterThanOrEqual(target.count);
      }
      for (const gesture of oracle.forbiddenGestureActions ?? []) {
        expect(
          gestureSummary.appliedActionCounts[gesture] ?? 0,
          `forbidden applied gesture ${gesture}`,
        ).toBe(0);
      }
      boundedExpectation(
        observation.events,
        oracle.minimumBoardEventCount,
        oracle.maximumBoardEventCount,
        "board event count",
      );
      boundedExpectation(
        observation.committedObjects,
        oracle.minimumCommittedObjects,
        oracle.maximumCommittedObjects,
        "committed object count",
      );
      boundedExpectation(
        objectOutcome.moved,
        oracle.minimumMovedObjectCount,
        oracle.maximumMovedObjectCount,
        "moved object count",
      );
      boundedExpectation(
        objectOutcome.created,
        oracle.minimumCreatedObjectCount,
        oracle.maximumCreatedObjectCount,
        "created object count",
      );
      boundedExpectation(
        objectOutcome.deleted,
        oracle.minimumDeletedObjectCount,
        oracle.maximumDeletedObjectCount,
        "deleted object count",
      );
      if (Number.isFinite(oracle.minimumViewportPanDistance)) {
        expect(viewportPanDistance).toBeGreaterThanOrEqual(
          oracle.minimumViewportPanDistance as number,
        );
      }
      if (Number.isFinite(oracle.minimumViewportScaleDelta)) {
        expect(viewportScaleDelta).toBeGreaterThanOrEqual(
          oracle.minimumViewportScaleDelta as number,
        );
      }
      if (oracle.expectedDiagramVisible !== undefined) {
        expect(observation.diagramVisible).toBe(
          oracle.expectedDiagramVisible,
        );
      }
      boundedExpectation(
        observation.diagnostics.selectionIds.length,
        oracle.minimumSelectionCount,
        oracle.maximumSelectionCount,
        "selection count",
      );
      expect(observation.diagnostics.undoDepth).toBeGreaterThanOrEqual(
        oracle.minimumUndoDepth ?? 0,
      );
      const frameProcessingP95Ms = gestureSummary.inferenceP95Ms;
      expect(
        frameProcessingP95Ms,
        "recorded replay must observe HandLandmarker inference timing",
      ).not.toBeNull();
      if (Number.isFinite(oracle.maximumFrameProcessingP95Ms)) {
        expect(frameProcessingP95Ms as number).toBeLessThanOrEqual(
          oracle.maximumFrameProcessingP95Ms as number,
        );
      }

      const initialBoardHash = canonicalBoardHash(baseline.board);
      const finalBoardHash = canonicalBoardHash(
        observation.canonicalBoard,
      );
      if (oracle.expectedInitialBoardHash) {
        expect(initialBoardHash).toBe(oracle.expectedInitialBoardHash);
      }
      if (oracle.expectedFinalBoardHash) {
        expect(finalBoardHash).toBe(oracle.expectedFinalBoardHash);
      }
      let undoRoundTrip: boolean | null = null;
      let postUndoBoardHash: string | null = null;
      if (oracle.requireUndoRoundTrip === true) {
        const undoResult = await page.evaluate(() => {
          const hooks = (window as unknown as AirboardTestWindow).__airboardTestHooks;
          return hooks.undoLastActionForEval();
        });
        expect(undoResult.applied, "gesture result must be one-step undoable").toBe(
          true,
        );
        await page.waitForTimeout(50);
        const postUndo = await readOutcomeSnapshot(page);
        postUndoBoardHash = canonicalBoardHash(postUndo.board);
        undoRoundTrip = postUndoBoardHash === initialBoardHash;
        expect(undoRoundTrip, "Undo must restore the canonical initial board").toBe(
          true,
        );
      }

      await page
        .getByRole("button", { name: /Turn off the camera/ })
        .click();

      expect(
        runId,
        "AIRBOARD_EVAL_RUN_ID is required to bind browser replay evidence to one run",
      ).not.toBeNull();
      expect(
        evidenceDirectory,
        "AIRBOARD_GESTURE_BROWSER_EVIDENCE_DIR is required for recorded-video evidence",
      ).not.toBeNull();
      const evidence = createGestureBrowserEvidence({
        runId,
        corpusVersion: manifest.corpusVersion,
        manifestHash,
        datasetSplit: requestedSplit,
        assetId: asset.id,
        assetHash: asset.hash.value,
        observation: {
          durationMs: asset.annotations.browserReplay.runDurationMs,
          perceptionFrameCount: perceptionFrames,
          traceEventCount: gestureSummary.totalEvents,
          observedStages: Object.keys(gestureSummary.stageCounts),
          observedOwners: gestureSummary.observedOwners,
          appliedActions: Object.entries(
            gestureSummary.appliedActionCounts,
          ).map(([gesture, count]) => ({ gesture, count })),
          targetedGestures: Object.entries(
            gestureSummary.targetedGestureCounts,
          ).map(([gesture, count]) => ({ gesture, count })),
          frameProcessingP95Ms,
          boardEventCount: observation.events,
          committedObjectCount: observation.committedObjects,
          movedObjectCount: objectOutcome.moved,
          createdObjectCount: objectOutcome.created,
          deletedObjectCount: objectOutcome.deleted,
          viewportPanDistance,
          viewportScaleDelta,
          finalDiagramVisible: observation.diagramVisible,
          finalSelectionCount:
            observation.diagnostics.selectionIds.length,
          undoDepth: observation.diagnostics.undoDepth,
          initialBoardHash,
          finalBoardHash,
          undoRoundTrip,
          postUndoBoardHash,
        },
      });
      const aggregateCheck = evaluateGestureBrowserEvidence({
        asset,
        evidence,
        runId,
        corpusVersion: manifest.corpusVersion,
        manifestHash,
        datasetSplit: requestedSplit,
      });
      expect(
        aggregateCheck.problems,
        "release aggregator must independently accept the browser measurements",
      ).toEqual([]);
      await writeGestureBrowserEvidence(
        evidenceDirectory as string,
        evidence,
      );
    });
  });
}

async function readOutcomeSnapshot(page: Page) {
  return page.evaluate(() => {
    const hooks = (window as unknown as AirboardTestWindow).__airboardTestHooks;
    const board = hooks.getCanonicalBoardState();
    return {
      board,
      objects: Object.fromEntries(
        Object.entries(board.elements)
          .filter(
            ([, element]) =>
              element.status === "active" && element.kind !== "drawing",
          )
          .map(([id, element]) => [
            id,
            element.kind === "connector"
              ? null
              : {
                  x: element.transform.x,
                  y: element.transform.y,
                  width: element.transform.width,
                  height: element.transform.height,
                },
          ]),
      ),
      viewport: hooks.getInteractionDiagnostics().viewport,
      diagramVisible: hooks.getDiagramVisible(),
    };
  });
}

/** A hash of the diagram on the board: v2 objects, with ids and revisions left out. */
function canonicalBoardHash(board: { elements: Record<string, unknown> }): string {
  const active = Object.entries(board.elements).flatMap(([id, element]) =>
    isRecord(element) && element.status === "active" && element.kind !== "drawing"
      ? [[id, element] as const]
      : [],
  );
  const nodes = active
    .filter(([, element]) => element.kind !== "connector")
    .map(([id, element]) => ({
      id,
      value: {
        kind: safeString(element.kind),
        shapeKind: safeString(element.shapeKind),
        label: plainText(element.content ?? element.title),
        bounds: canonicalBounds(element.transform),
        groupMemberCount: Array.isArray(element.memberIds)
          ? element.memberIds.length
          : 0,
      },
    }))
    .sort(
      (left, right) =>
        stableJson(left.value).localeCompare(stableJson(right.value)) ||
        left.id.localeCompare(right.id),
    );
  const handles = new Map(
    nodes.map(({ id }, index) => [id, `node-${index + 1}`]),
  );
  const edges = active
    .filter(([, element]) => element.kind === "connector")
    .map(([, element]) => ({
      label: plainText(element.label),
      from:
        handles.get(safeString(element.start?.binding?.elementId) ?? "") ??
        null,
      to:
        handles.get(safeString(element.end?.binding?.elementId) ?? "") ??
        null,
      start: canonicalPoint(element.start?.point),
      end: canonicalPoint(element.end?.point),
    }))
    .sort((left, right) =>
      stableJson(left).localeCompare(stableJson(right)),
    );
  return `sha256:${createHash("sha256")
    .update(
      stableJson({
        nodes: nodes.map(({ value }) => value),
        edges,
      }),
    )
    .digest("hex")}`;
}

function plainText(document: unknown): string | null {
  if (!isRecord(document) || !Array.isArray(document.blocks)) return null;
  return document.blocks
    .map((block: unknown) =>
      isRecord(block) && Array.isArray(block.runs)
        ? block.runs.map((run: unknown) => (isRecord(run) ? String(run.text ?? "") : "")).join("")
        : "",
    )
    .join("\n");
}

function canonicalBounds(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    x: roundedNumber(value.x),
    y: roundedNumber(value.y),
    width: roundedNumber(value.width),
    height: roundedNumber(value.height),
  };
}

function canonicalPoint(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    x: roundedNumber(value.x),
    y: roundedNumber(value.y),
  };
}

function roundedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1_000) / 1_000
    : null;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(",")}}`;
}

function compareObjectSnapshots(
  before: Record<
    string,
    { x: number; y: number; width: number; height: number } | null
  >,
  after: Record<
    string,
    { x: number; y: number; width: number; height: number } | null
  >,
) {
  const beforeIds = new Set(Object.keys(before));
  const afterIds = new Set(Object.keys(after));
  let moved = 0;
  for (const id of beforeIds) {
    const left = before[id];
    const right = after[id];
    if (
      left &&
      right &&
      ["x", "y", "width", "height"].some(
        (field) =>
          Math.abs(
            left[field as keyof typeof left] -
              right[field as keyof typeof right],
          ) > 0.5,
      )
    ) {
      moved += 1;
    }
  }
  return {
    moved,
    created: [...afterIds].filter((id) => !beforeIds.has(id)).length,
    deleted: [...beforeIds].filter((id) => !afterIds.has(id)).length,
  };
}

function restrictedVideoPath(asset: BrowserReplayAsset): string {
  if (!mediaRoot) {
    throw new Error(
      `AIRBOARD_EVAL_MEDIA_ROOT is required for browser-video asset ${asset.id}`,
    );
  }
  if (isAbsolute(asset.storageKey)) {
    throw new Error(`Gesture video ${asset.id} storageKey must be relative`);
  }
  if (!asset.storageKey.toLowerCase().endsWith(".y4m")) {
    throw new Error(
      `Gesture video ${asset.id} must be a Chromium-compatible Y4M fixture`,
    );
  }
  const candidate = realpathSync(resolve(mediaRoot, asset.storageKey));
  const child = relative(mediaRoot, candidate);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error(`Gesture video ${asset.id} escapes the restricted media root`);
  }
  return candidate;
}

function boundedExpectation(
  actual: number,
  minimum: number | undefined,
  maximum: number | undefined,
  label: string,
) {
  if (Number.isFinite(minimum)) {
    expect(actual, `${label} minimum`).toBeGreaterThanOrEqual(
      minimum as number,
    );
  }
  if (Number.isFinite(maximum)) {
    expect(actual, `${label} maximum`).toBeLessThanOrEqual(
      maximum as number,
    );
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
