import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [board, styles, router, undoTracker, victoryTracker, mediaPipeTracker] = await Promise.all([
  readFile(new URL("apps/web/src/features/board/AirboardPrototype.tsx", root), "utf8"),
  readFile(new URL("apps/web/app/globals.css", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/voiceCommandRouter.ts", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/undoGestureTracker.ts", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/victoryVoiceGestureTracker.ts", root), "utf8"),
  readFile(new URL("packages/gesture-engine/src/mediapipe.ts", root), "utf8"),
]);
const gestureModel = await readFile(
  new URL("apps/web/public/vendor/mediapipe/models/gesture_recognizer.task", root),
);

const required = [
  [board, 'className="canvas-copilot"', "right-side copilot"],
  [board, 'data-testid="copilot-transcript"', "live transcript surface"],
  [board, "voiceRouter.noteSpeechActivity()", "interim speech gate claim"],
  [board, "processUndoGestureFrame", "undo gesture integration"],
  [board, 'selectSingleCannedGesture(hands, "Open_Palm")', "Open_Palm undo routing"],
  [board, 'selectSingleCannedGesture(hands, "Victory")', "Victory voice routing"],
  [router, "noteSpeechActivity(): void", "voice router speech claim"],
  [router, "utteranceGate", "late final-transcript ownership"],
  [undoTracker, 'return "undo"', "undo gesture recognizer"],
  [victoryTracker, 'return "activate"', "Victory hold recognizer"],
  [mediaPipeTracker, "GestureRecognizer.createFromOptions", "MediaPipe canned classifier"],
  [mediaPipeTracker, 'categoryAllowlist: ["Victory", "Open_Palm"]', "narrow gesture allowlist"],
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
if (board.includes("PalmGateTracker")) {
  throw new Error("The deprecated open-palm voice gate was reintroduced.");
}
const gestureModelSha256 = createHash("sha256").update(gestureModel).digest("hex");
if (gestureModelSha256 !== "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482") {
  throw new Error("The vendored MediaPipe Gesture Recognizer model is missing or unverified.");
}

console.log(
  "Automated command contract verified: Victory hold -> voice, Open_Palm swipe -> undo, with distinct MediaPipe labels.",
);
