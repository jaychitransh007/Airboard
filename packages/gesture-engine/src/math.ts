import type { HandLandmark } from "./types.ts";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: HandLandmark, b: HandLandmark): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

export function midpoint(a: HandLandmark, b: HandLandmark): HandLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

export function average(points: readonly HandLandmark[]): HandLandmark {
  const sum = points.reduce<{ x: number; y: number; z: number }>(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
      z: acc.z + (point.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
    z: sum.z / points.length,
  };
}
