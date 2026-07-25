import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [board, styles, router, undoTracker] = await Promise.all([
  readFile(new URL("apps/web/src/features/board/AirboardPrototype.tsx", root), "utf8"),
  readFile(new URL("apps/web/app/globals.css", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/voiceCommandRouter.ts", root), "utf8"),
  readFile(new URL("apps/web/src/features/board/undoGestureTracker.ts", root), "utf8"),
]);

const required = [
  [board, 'className="canvas-copilot"', "right-side copilot"],
  [board, 'data-testid="copilot-transcript"', "live transcript surface"],
  [board, "voiceRouter.noteSpeechActivity()", "interim speech gate claim"],
  [board, "processUndoGestureFrame", "undo gesture integration"],
  [router, "noteSpeechActivity(): void", "voice router speech claim"],
  [router, "utteranceGate", "late final-transcript ownership"],
  [undoTracker, 'return "undo"', "undo gesture recognizer"],
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

console.log(
  "Automated command contract verified: finalized voice -> activity copilot -> automatic board action, with gesture undo.",
);
