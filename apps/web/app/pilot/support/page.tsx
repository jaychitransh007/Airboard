import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotSupportPage() {
  const subject = encodeURIComponent("Airboard Meet overlay support request");
  return (
    <PilotInfoPage title="Meet overlay support" summary="Report the failed readiness check—not the meeting conversation.">
      <section>
        <h2>Before reporting</h2>
        <ol>
          <li>Confirm the extension popup reports version 0.8.0.</li>
          <li>Confirm Account connected and Media confirmed are complete.</li>
          <li>Open or refresh a meeting-code URL and turn the Meet camera on.</li>
          <li>Use Refresh status and note the first incomplete readiness check and visible error code.</li>
        </ol>
      </section>
      <section>
        <h2>Request support</h2>
        <p>Email <a href={`mailto:${PILOT_CONTACT}?subject=${subject}`}>{PILOT_CONTACT}</a> with the extension version, Chrome and OS versions, approximate time, first failed check, and error code.</p>
        <p>Do not send passwords, authorization codes, meeting links, recordings, private board content, access tokens, API keys, or confidential customer data.</p>
      </section>
    </PilotInfoPage>
  );
}
