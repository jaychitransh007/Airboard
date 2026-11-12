import type { Metadata } from "next";
import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export const metadata: Metadata = { title: "Pilot support" };

export default function PilotSupportPage() {
  const subject = encodeURIComponent("Airboard pilot support request");
  return (
    <PilotInfoPage title="Pilot support" summary="Tell us what went wrong on the board, not what was said in the meeting.">
      <section>
        <h2>Before reporting</h2>
        <ol>
          <li>Check the <a href="/help">Help Center</a>, especially Troubleshooting and Error codes.</li>
          <li>If Airo isn't hearing or seeing you, check that the browser allows the camera and microphone for Airboard, then reload the board.</li>
          <li>Note the time, what you did, and any message or error code Airboard showed on the board or in the Airo panel.</li>
        </ol>
      </section>
      <section>
        <h2>Request support</h2>
        <p>Signed in, use the <a href="/support">support form</a> (Help Center → Contact support), or email <a href={`mailto:${PILOT_CONTACT}?subject=${subject}`}>{PILOT_CONTACT}</a> with your browser and operating system, the approximate time, what happened and any error code. Create a support diagnostic in Settings → Privacy &amp; data and include its ID.</p>
        <p>Do not send passwords, authorization codes, meeting links, recordings, private board content, access tokens, API keys or confidential customer data.</p>
      </section>
    </PilotInfoPage>
  );
}
