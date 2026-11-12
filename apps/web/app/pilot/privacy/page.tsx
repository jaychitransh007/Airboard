import type { Metadata } from "next";
import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export const metadata: Metadata = { title: "Pilot privacy" };

export default function PilotPrivacyPage() {
  return (
    <PilotInfoPage title="Pilot privacy" summary="What Airboard processes during the pilot. The full notice is the Airboard privacy notice.">
      <section>
        <h2>Camera, microphone and voice</h2>
        <p>Camera frames are processed live in your browser to track your hands and to show you behind the board. Microphone audio is streamed through the Airboard API to Deepgram for transcription while Airo's voice is on, and only when your microphone picks up sound; silence is not sent. Your microphone can also pick up other people in the room or from your speakers. When Airboard's built-in rules can't finish a command meant for Airo, the command text and a summary of the board can be sent to OpenAI to interpret it. Airboard does not store raw camera frames or microphone audio.</p>
        <p>In Google Meet you present the Airboard tab yourself, so the audience sees exactly that tab. Airboard does not join, read or record the meeting.</p>
      </section>
      <section>
        <h2>Boards and account</h2>
        <p>Airboard stores your Google sign-in identity, workspace, settings and the boards you create, including images you add to them. Deleting a board erases it straight away.</p>
      </section>
      <section>
        <h2>Diagnostics and choices</h2>
        <p>Content-free voice diagnostics (stage, outcome and timing, no audio, transcripts or board labels) expire within 14 days. Content-free product analytics are kept for 90 days, and support diagnostics you create for seven days. You can turn the camera or microphone off in Settings → Preferences, block them in your browser, and in Settings → Privacy &amp; data request a data export or schedule account deletion (you can cancel for seven days).</p>
        <p>Read the full <a href="/privacy">Airboard privacy notice</a>.</p>
      </section>
    </PilotInfoPage>
  );
}
