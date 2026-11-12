// Runtime invariants that used to be build-time text checks
// (verify-automated-command-contract and verify-camera-layer-contract).
// They read whole source trees and every stylesheet, not one file, so moving
// code between board files or stylesheets does not break them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  cameraCanvasScrim,
  MAX_CAMERA_PRESENTATION_SCRIM,
  MIN_CAMERA_PRESENTATION_SCRIM,
} from "../src/features/board/lightboardComposition.ts";

const repositoryRoot = new URL("../../../", import.meta.url);
const HAND_MODEL_SHA256 =
  "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const RUNTIME_SOURCE_ROOTS = [
  "apps/web/app/",
  "apps/web/src/",
  "apps/api/src/",
  "packages/core/src/",
  "packages/drawing-engine/src/",
  "packages/gesture-engine/src/",
  "packages/realtime-client/src/",
];

/** Every site that starts or runs camera inference, counted across sources. */
function cameraInferenceSites(sources) {
  const corpus = sources.join("\n");
  return {
    trackerCreate: count(corpus, /MediaPipeHandTracker\.create\(/gu),
    landmarkerCreate: count(corpus, /HandLandmarker\.createFromOptions\(/gu),
    // detectForVideo, recognizeForVideo, segmentForVideo: any MediaPipe
    // per-frame inference call is a camera stream.
    videoInference: count(corpus, /\.\w+ForVideo\(/gu),
  };
}

/** The last z-index each selector gets across the given stylesheets. */
function zIndexBySelector(stylesheets, selectors) {
  const found = new Map();
  for (const css of stylesheets) {
    const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
    for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const ruleSelectors = rule[1].split(",").map((part) => part.trim().replaceAll(/\s+/gu, " "));
      const zIndex = /(?:^|;)\s*z-index\s*:\s*(-?\d+)\s*(?:!important\s*)?(?:;|$)/u.exec(rule[2]);
      if (!zIndex) continue;
      for (const selector of selectors) {
        if (ruleSelectors.includes(selector)) found.set(selector, Number(zIndex[1]));
      }
    }
  }
  return found;
}

/** Camera layers, bottom to top: video, then the dark scrim, then the diagram. */
const CAMERA_LAYERS = [
  ".lightboard-underlay",
  ".lightboard-screen-underlay",
  ".lightboard-scrim",
  ".board-area.lightboard .board-canvas",
];

function cameraLayerProblems(stylesheets) {
  const zIndex = zIndexBySelector(stylesheets, CAMERA_LAYERS);
  const problems = CAMERA_LAYERS.filter((selector) => !zIndex.has(selector)).map(
    (selector) => `${selector} has no z-index`,
  );
  if (problems.length > 0) return problems;
  const video = Math.max(zIndex.get(CAMERA_LAYERS[0]), zIndex.get(CAMERA_LAYERS[1]));
  const scrim = zIndex.get(".lightboard-scrim");
  const diagram = zIndex.get(".board-area.lightboard .board-canvas");
  if (!(video < scrim)) problems.push("the scrim must sit above the camera and screen video");
  if (!(scrim < diagram)) problems.push("the diagram must sit above the scrim");
  return problems;
}

test("the vendored MediaPipe hand model is the verified file", async () => {
  const model = await readFile(
    new URL("apps/web/public/vendor/mediapipe/models/hand_landmarker.task", repositoryRoot),
  );
  assert.equal(createHash("sha256").update(model).digest("hex"), HAND_MODEL_SHA256);
});

test("runtime sources open exactly one camera inference stream", async () => {
  const sources = (
    await Promise.all(RUNTIME_SOURCE_ROOTS.map((path) => readSourceTree(new URL(path, repositoryRoot))))
  ).flat();
  assert.ok(sources.length > 50, "the runtime source trees were read");
  assert.deepEqual(cameraInferenceSites(sources), {
    trackerCreate: 1,
    landmarkerCreate: 1,
    videoInference: 1,
  });
});

test("inference-site counting catches a second stream (negative control)", () => {
  const one = [
    "const t = await MediaPipeHandTracker.create({});",
    "const h = await HandLandmarker.createFromOptions(v, {}); h.detectForVideo(video, 1);",
  ];
  assert.deepEqual(cameraInferenceSites(one), {
    trackerCreate: 1,
    landmarkerCreate: 1,
    videoInference: 1,
  });
  const two = [
    ...one,
    "const g = await HandLandmarker.createFromOptions(v, {}); g.recognizeForVideo(video, 1);",
  ];
  assert.deepEqual(cameraInferenceSites(two), {
    trackerCreate: 1,
    landmarkerCreate: 2,
    videoInference: 2,
  });
});

test("every stylesheet under app/ keeps video below the scrim below the diagram", async () => {
  const stylesheets = await readStylesheets(new URL("apps/web/app/", repositoryRoot));
  assert.ok(stylesheets.length > 0, "the stylesheets were read");
  assert.deepEqual(cameraLayerProblems(stylesheets), []);
});

test("camera layer order check fails on a wrong z-index (negative control)", () => {
  const good = `
    .lightboard-underlay { position: absolute; z-index: 0; }
    .lightboard-screen-underlay { z-index: 1; }
    /* comment { z-index: 9; } */
    @media (min-width: 1px) { .lightboard-scrim { z-index: 2; } }
    .board-area.lightboard .board-canvas { z-index: 3; }`;
  assert.deepEqual(cameraLayerProblems([good]), []);
  assert.deepEqual(cameraLayerProblems([good, ".lightboard-scrim { z-index: 5; }"]), [
    "the diagram must sit above the scrim",
  ]);
  assert.deepEqual(cameraLayerProblems([good, ".lightboard-screen-underlay { z-index: 4; }"]), [
    "the scrim must sit above the camera and screen video",
  ]);
  assert.deepEqual(cameraLayerProblems([".lightboard-underlay { z-index: 0; }"]).length, 3);
});

test("camera mode never shows the video without the dark scrim", () => {
  for (const requested of [Number.NaN, -1, 0, 0.25, 0.54, 0.55, 0.6, 0.75, 0.85, 1, 5]) {
    const scrim = cameraCanvasScrim(requested);
    assert.ok(scrim >= MIN_CAMERA_PRESENTATION_SCRIM, `${requested} -> ${scrim}`);
    assert.ok(scrim <= MAX_CAMERA_PRESENTATION_SCRIM, `${requested} -> ${scrim}`);
  }
});

function count(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) return readSourceTree(new URL(`${entry.name}/`, directory));
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
      return [await readFile(new URL(entry.name, directory), "utf8")];
    }),
  );
  return files.flat();
}

async function readStylesheets(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
      .map((entry) => readFile(`${entry.parentPath ?? entry.path}/${entry.name}`, "utf8")),
  );
}
