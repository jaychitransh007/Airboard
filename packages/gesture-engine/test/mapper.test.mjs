import assert from "node:assert/strict";
import test from "node:test";

import {
  fitSourceToCanvas,
  mapLandmarkToCanvas,
  mapLandmarkToFittedCanvas,
} from "../src/mapper.ts";

test("cover fit exposes the same crop geometry as object-fit cover", () => {
  assert.deepEqual(fitSourceToCanvas(1920, 1080, 800, 800, "cover"), {
    x: -311.1111111111111,
    y: 0,
    width: 1422.2222222222222,
    height: 800,
  });
  assert.deepEqual(fitSourceToCanvas(640, 480, 1280, 720, "cover"), {
    x: 0,
    y: -120,
    width: 1280,
    height: 960,
  });
});

test("landmarks map through the cover crop before selfie mirroring", () => {
  const mapping = {
    canvasWidth: 800,
    canvasHeight: 800,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fitMode: "cover",
    mirrorInput: true,
    sensitivity: 1,
  };
  const center = mapLandmarkToCanvas({ x: 0.5, y: 0.5 }, mapping, 12);
  assert.deepEqual(center, { x: 400, y: 400, t: 12 });

  // Source x=.25 appears at 44.44px before mirroring, hence 755.56px in the
  // selfie view—not the old crop-blind 600px result.
  const quarter = mapLandmarkToCanvas({ x: 0.25, y: 0.5 }, mapping, 13);
  assert.ok(Math.abs(quarter.x - 755.5555555555555) < 1e-9);
});

test("fitted coordinates support crop-aware normalized controller input", () => {
  const point = mapLandmarkToFittedCanvas(
    { x: 0.25, y: 0.5 },
    {
      canvasWidth: 800,
      canvasHeight: 800,
      sourceWidth: 1920,
      sourceHeight: 1080,
      fitMode: "cover",
      mirrorInput: false,
      sensitivity: 1,
    },
  );
  assert.ok(Math.abs(point.x - 44.44444444444446) < 1e-9);
  assert.equal(point.y, 400);
});

test("legacy mappings without source dimensions remain stretch-compatible", () => {
  assert.deepEqual(
    mapLandmarkToCanvas(
      { x: 0.2, y: 0.75 },
      { canvasWidth: 1000, canvasHeight: 500, mirrorInput: false, sensitivity: 1 },
      9,
    ),
    { x: 200, y: 375, t: 9 },
  );
});
