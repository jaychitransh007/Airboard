import { notFound } from "next/navigation";
import { AirboardPrototype } from "../../../src/features/board/AirboardPrototype";

/**
 * E2E-only mount of the Meet-surface board. The real Meet routes require the
 * official SDK inside a Meet-provided iframe, which Playwright cannot supply,
 * so the media-ownership invariant (Meet surfaces never start Airboard
 * camera/microphone capture) is exercised here instead. Hidden unless the
 * Playwright dev server sets NEXT_PUBLIC_AIRBOARD_TEST_HOOKS.
 */
export default async function MeetTestHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string; media?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS !== "1") {
    notFound();
  }
  // media=embedded emulates a host client that delegates camera/microphone
  // permission to the add-on frame; the default emulates no delegation.
  const { surface, media } = await searchParams;
  return (
    <AirboardPrototype
      surface={surface === "side-panel" ? "meet-side-panel" : "meet-main-stage"}
      meetingProvider="google_meet"
      providerMeetingId="test-harness-meeting"
      embeddedMediaCapture={media === "embedded"}
    />
  );
}
