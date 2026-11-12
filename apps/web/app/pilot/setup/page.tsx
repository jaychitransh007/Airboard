import type { Metadata } from "next";
import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export const metadata: Metadata = { title: "Pilot setup" };

export default function PilotSetupPage() {
  return (
    <PilotInfoPage
      title="Set up Airboard for the pilot"
      summary="Airboard runs in your browser, and you bring it into Google Meet by presenting its tab. There is nothing to install."
    >
      <section>
        <h2>Get started</h2>
        <ol>
          <li>Use Google Chrome on Windows or macOS, or Microsoft Edge on Windows.</li>
          <li>Sign in to Airboard with your Google account.</li>
          <li>On the Airboards page, choose Create Airboard, or open a board you already have.</li>
          <li>When the browser asks, allow the camera and microphone. Airo then starts listening for voice and watching for your hands on every board.</li>
        </ol>
      </section>
      <section>
        <h2>Use it in Google Meet</h2>
        <ol>
          <li>Join the call in the same browser, and keep your board open in its own tab.</li>
          <li>In Meet, choose Present now (or Share screen), then A tab, and pick your Airboard tab.</li>
          <li>Go back to the Airboard tab and draw by voice, hands, keyboard or mouse. Everyone in the call sees the board.</li>
          <li>If your camera shows behind the board, turn off your Meet camera while you present, so the audience doesn't see you twice.</li>
        </ol>
      </section>
      <section>
        <h2>What the audience sees</h2>
        <p>The presented Airboard tab: your diagram, with your camera (or a screen you chose) behind it. The Airo panel is hidden until you show it (it then stays open next time), and it lists only what you say to Airo, never the rest of the conversation.</p>
        <p><a href="/help/integrations/google-meet">Open the complete Google Meet guide →</a></p>
      </section>
    </PilotInfoPage>
  );
}
