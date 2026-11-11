"use client";

import dynamic from "next/dynamic";

// The home page is the marketing landing page for nearly every visit. The board
// only appears there for the end-to-end test harness, so its code loads when
// that renders instead of with the landing page.
const TestAirboardHarness = dynamic(() =>
  import("../board/TestAirboardHarness").then((module) => module.TestAirboardHarness),
);

export function HomeBoardSurface() {
  return <TestAirboardHarness />;
}
