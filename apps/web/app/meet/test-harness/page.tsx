import { notFound } from "next/navigation";
import { MeetBridgeEmulator } from "../../../src/features/meet/MeetBridgeEmulator";
import { TestAirboardHarness } from "../../../src/features/board/TestAirboardHarness";

/**
 * E2E-only mount of the headless Meet overlay engine. The Chrome extension
 * loads the real engine (/meet/overlay-engine) in a frame Playwright cannot
 * host, so the engine runs here instead, authenticated with a signed test
 * identity. Hidden unless the Playwright dev server sets
 * NEXT_PUBLIC_AIRBOARD_TEST_HOOKS.
 */
export default async function MeetTestHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ bridge?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS !== "1") {
    notFound();
  }
  // bridge=emulate answers the media-bridge protocol in-page, standing in for
  // the Meet Media Bridge extension.
  const { bridge } = await searchParams;
  return (
    <>
      {bridge === "emulate" ? <MeetBridgeEmulator /> : null}
      <TestAirboardHarness
        surface="meet-main-stage"
        meetingProvider="google_meet"
        providerMeetingId="test-harness-meeting"
        headlessMeetOverlay
      />
    </>
  );
}
