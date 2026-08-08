import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFiles = [
  "apps/web/src/features/board/AirboardPrototype.tsx",
  "apps/web/src/features/board/lightboardRecorder.ts",
  "apps/web/src/features/product/SettingsPage.tsx",
  "apps/web/app/globals.css",
];
const forbidden = [
  "person-occlusion",
  "personOcclusion",
  "PersonSegmenter",
  "selfie_segmenter",
  "foregroundCanvas",
];

for (const relativePath of runtimeFiles) {
  const source = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(
        `Camera layer contract violated: ${relativePath} contains forbidden marker ${marker}.`,
      );
    }
  }
}

const removedModel = resolve(
  repositoryRoot,
  "apps/web/public/vendor/mediapipe/models/selfie_segmenter_landscape.tflite",
);
if (existsSync(removedModel)) {
  throw new Error("Camera layer contract violated: the foreground segmentation model exists.");
}

const styles = readFileSync(resolve(repositoryRoot, "apps/web/app/globals.css"), "utf8");
const requiredLayers = [
  [".lightboard-underlay", 0],
  [".lightboard-scrim", 2],
  [".board-area.lightboard .board-canvas", 3],
];
for (const [selector, zIndex] of requiredLayers) {
  const escaped = String(selector).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*${zIndex}\\s*;`, "s");
  if (!rule.test(styles)) {
    throw new Error(
      `Camera layer contract violated: ${selector} must have z-index ${zIndex}.`,
    );
  }
}

const boardSource = readFileSync(
  resolve(repositoryRoot, "apps/web/src/features/board/AirboardPrototype.tsx"),
  "utf8",
);
for (const required of [
  "cameraCanvasScrim",
  "MIN_CAMERA_PRESENTATION_SCRIM",
  "airboard.scrim.camera.v1",
]) {
  if (!boardSource.includes(required)) {
    throw new Error(`Camera layer contract violated: missing ${required}.`);
  }
}

console.log("Camera layer contract verified: video -> dark scrim -> diagram.");
