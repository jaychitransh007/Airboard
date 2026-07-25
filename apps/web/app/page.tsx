import { AirboardPrototype } from "../src/features/board/AirboardPrototype";
import { TestAirboardHarness } from "../src/features/board/TestAirboardHarness";
import { LandingPage } from "../src/features/product/LandingPage";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const desktopOverlayValue = params.desktopOverlay;
  const desktopOverlay = Array.isArray(desktopOverlayValue)
    ? desktopOverlayValue.includes("1")
    : desktopOverlayValue === "1";
  const testStandaloneValue = params.testStandalone;
  const testStandalone =
    process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS === "1" &&
    (Array.isArray(testStandaloneValue)
      ? testStandaloneValue.includes("1")
      : testStandaloneValue === "1");
  return testStandalone ? (
    <TestAirboardHarness surface="standalone" />
  ) : desktopOverlay ? (
    <AirboardPrototype surface="standalone" {...(desktopOverlay ? { desktopOverlay: true } : {})} />
  ) : (
    <LandingPage />
  );
}
