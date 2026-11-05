"use client";

import dynamic from "next/dynamic";

// The home page is the marketing landing page for nearly every visit. The board
// only appears there for the desktop overlay and the end-to-end test harness,
// so its code loads when one of those renders instead of with the landing page.
const AirboardPrototype = dynamic(() =>
  import("../board/AirboardPrototype").then((module) => module.AirboardPrototype),
);
const TestAirboardHarness = dynamic(() =>
  import("../board/TestAirboardHarness").then((module) => module.TestAirboardHarness),
);

export function HomeBoardSurface({ mode }: { mode: "desktop-overlay" | "test-harness" }) {
  return mode === "test-harness" ? (
    <TestAirboardHarness surface="standalone" />
  ) : (
    <AirboardPrototype surface="standalone" desktopOverlay />
  );
}
