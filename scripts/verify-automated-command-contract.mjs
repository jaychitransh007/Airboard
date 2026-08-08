import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [
  board,
  styles,
  router,
  palmVoiceTracker,
  mediaPipeTracker,
  palmPose,
  gestureFrameArbitration,
  gestureFrameCoordinator,
] = await Promise.all([
  readFile(new URL("apps/web/src/features/board/AirboardPrototype.tsx", root), "utf8"),
  readFile(new URL("apps/web/app/globals.css", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/voiceCommandRouter.ts", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/palmVoiceGestureTracker.ts", root), "utf8"),
  readFile(new URL("packages/gesture-engine/src/mediapipe.ts", root), "utf8"),
  readFile(new URL("packages/gesture-engine/src/palmPresentation.ts", root), "utf8"),
  readFile(
    new URL("apps/web/src/features/board/gestureFrameArbitration.ts", root),
    "utf8",
  ),
  readFile(
    new URL("apps/web/src/features/board/gestureFrameCoordinator.ts", root),
    "utf8",
  ),
]);
const handModel = await readFile(
  new URL("apps/web/public/vendor/mediapipe/models/hand_landmarker.task", root),
);
const runtimeSourceRoots = [
  "apps/web/app/",
  "apps/web/src/",
  "apps/api/src/",
  "apps/desktop/src/",
  "packages/core/src/",
  "packages/drawing-engine/src/",
  "packages/gesture-engine/src/",
  "packages/integrations/src/",
  "packages/realtime-client/src/",
  "extensions/chrome-meet-bridge/",
];
const runtimeSources = await Promise.all([
  ...runtimeSourceRoots.map((directory) =>
    readSourceTree(new URL(directory, root)),
  ),
]);
const runtimeSourceCorpus = runtimeSources.join("\n");

const required = [
  [board, 'className="canvas-copilot"', "right-side copilot"],
  [board, 'data-testid="copilot-transcript"', "live transcript surface"],
  [board, "voiceRouter.noteSpeechActivity()", "interim speech gate claim"],
  [
    board,
    "collectLandmarkNavigationHands(",
    "raw-landmark Pan/Zoom routing",
  ],
  [
    board,
    "shouldReserveLandmarkNavigation(",
    "mixed-pose two-hand stream reservation",
  ],
  [
    board,
    "selectLandmarkManipulationSignal(",
    "raw-landmark Move/Place/Erase routing",
  ],
  [board, "selectSingleLandmarkPose(", "canonical landmark pose selection"],
  [board, "estimatePalmPresentation", "landmark-defined Open Palm voice routing"],
  [
    board,
    "canvasNavTrackerRef.current?.reset();",
    "camera-stop navigation reset",
  ],
  [mediaPipeTracker, '"/vendor/mediapipe/models/hand_landmarker.task"', "hand model selection"],
  [router, "noteSpeechActivity(): void", "voice router speech claim"],
  [router, "utteranceGate", "late final-transcript ownership"],
  [palmVoiceTracker, 'return "activate"', "open-palm hold voice recognizer"],
  [mediaPipeTracker, "HandLandmarker.createFromOptions", "canonical HandLandmarker"],
  [mediaPipeTracker, "detectForVideo", "HandLandmarker video inference"],
  [palmPose, "estimatePalmPresentation", "Open Palm landmark definition"],
  [
    gestureFrameArbitration,
    "export function arbitrateGestureFrame",
    "behavioral gesture-frame arbitration",
  ],
  [
    gestureFrameArbitration,
    "onPreempted?.()",
    "lower-priority lifecycle cleanup",
  ],
  [
    board,
    "coordinateRawLandmarkFrame<",
    "production raw-landmark coordination",
  ],
  [
    gestureFrameCoordinator,
    "const { owner } = coordinateGestureFrame({",
    "raw-landmark to frame-coordinator routing",
  ],
  [
    gestureFrameCoordinator,
    "arbitrateGestureFrame(input.stages)",
    "production gesture-frame arbitration",
  ],
  [styles, ".canvas-copilot {", "copilot styling"],
];

const missing = required
  .filter(([source, marker]) => !source.includes(marker))
  .map(([, , label]) => label);
if (missing.length > 0) {
  throw new Error(`Automated command contract is incomplete: ${missing.join(", ")}.`);
}

if (board.includes('className="canvas-command-bar"')) {
  throw new Error("The deprecated bottom command bar was reintroduced.");
}
for (const [forbidden, label] of [
  ["GestureRecognizer", "GestureRecognizer runtime"],
  ["recognizeForVideo", "GestureRecognizer inference"],
  ["selectSingleCannedGesture", "canned gesture routing"],
  ["cannedGesture", "canned gesture data"],
  ["gesture_recognizer.task", "gesture-classifier model loading"],
  ["UndoGestureTracker", "retired Undo hand-gesture tracker"],
  ["processUndoGestureFrame", "retired Undo hand-gesture processing"],
  ["updateUndoGesture", "retired Undo hand-gesture routing"],
  ["emitUndoGestureFrame", "retired Undo hand-gesture test hook"],
]) {
  if (runtimeSourceCorpus.includes(forbidden)) {
    throw new Error(`The single-landmark-input contract was violated by ${label}.`);
  }
}
for (const [marker, expectedCount, label] of [
  ["MediaPipeHandTracker.create(", 1, "board-owned hand tracker creation"],
  ["HandLandmarker.createFromOptions", 1, "HandLandmarker creation"],
  [".detectForVideo(", 1, "HandLandmarker frame inference"],
]) {
  const actualCount = countOccurrences(runtimeSourceCorpus, marker);
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} ${label} site, found ${actualCount}.`,
    );
  }
}
const arbitrationCallStart = board.indexOf("coordinateRawLandmarkFrame<");
const arbitrationCallEnd = board.indexOf(
  "rawLandmarkFrameProcessorRef.current = processRawLandmarkFrame",
  arbitrationCallStart,
);
if (arbitrationCallStart === -1 || arbitrationCallEnd === -1) {
  throw new Error("The production raw-landmark coordinator is not connected.");
}
const productionArbitrationCall = board.slice(
  arbitrationCallStart,
  arbitrationCallEnd,
);
for (const marker of [
  "navigation: {",
  "shouldReserveLandmarkNavigation(",
  "snap: {",
  "snapGestureTrackerRef.current!.reset()",
  "voice: {",
  'closeVoiceGate("ptt")',
  "manipulation: {",
  "hybridGestureControllerRef.current!.reset({",
]) {
  if (!productionArbitrationCall.includes(marker)) {
    throw new Error(`The production gesture arbiter is missing ${marker}.`);
  }
}
if (board.includes("arbitrateGestureFrame(")) {
  throw new Error(
    "The board bypasses the production gesture-frame coordinator.",
  );
}
const priorityMarkers = [
  '"navigation"',
  '"snap"',
  '"voice"',
  '"manipulation"',
];
let previousArbitrationIndex = -1;
for (const marker of priorityMarkers) {
  const markerIndex = gestureFrameArbitration.indexOf(
    marker,
    previousArbitrationIndex + 1,
  );
  if (markerIndex <= previousArbitrationIndex) {
    throw new Error(
      "Gesture arbitration must remain Navigation -> Snap -> Voice -> Manipulation.",
    );
  }
  previousArbitrationIndex = markerIndex;
}
const handModelSha256 = createHash("sha256").update(handModel).digest("hex");
if (handModelSha256 !== "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1") {
  throw new Error("The vendored MediaPipe Hand Landmarker model is missing or unverified.");
}

console.log(
  "Automated command contract verified: one HandLandmarker stream with Navigation -> Snap -> Voice -> Manipulation arbitration; camera Undo is absent.",
);

async function readSourceTree(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directoryUrl);
      if (entry.isDirectory()) {
        return readSourceTree(entryUrl);
      }
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) {
        return "";
      }
      return readFile(entryUrl, "utf8");
    }),
  );
  return files.join("\n");
}

function countOccurrences(source, marker) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(marker, offset);
    if (index === -1) {
      return count;
    }
    count += 1;
    offset = index + marker.length;
  }
}
