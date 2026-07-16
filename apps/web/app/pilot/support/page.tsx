import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotSupportPage() {
  const subject = encodeURIComponent("Airboard Pilot support request");

  return (
    <PilotInfoPage
      title="Pilot support"
      summary="How designated testers can report installation, Meet activity, board, or access problems."
    >
      <section>
        <h2>Request support</h2>
        <p>
          Email <a href={`mailto:${PILOT_CONTACT}?subject=${subject}`}>{PILOT_CONTACT}</a> with the
          approximate time of the issue, browser and operating system, whether you were organizer or
          participant, and the visible error message.
        </p>
        <p>
          Do not send passwords, authorization codes, meeting recordings, private board content,
          access tokens, API keys, or confidential customer data.
        </p>
      </section>

      <section>
        <h2>Current pilot constraints</h2>
        <ul>
          <li>Only approved Marketplace draft testers can install this build.</li>
          <li>Typed commands and pointer input are the baseline test path.</li>
          <li>
            Airboard does not request separate camera or microphone access inside Meet; role,
            reconnect, and multi-participant behavior are still being validated.
          </li>
          <li>Board state is disposable and can be lost when the pilot service restarts.</li>
        </ul>
      </section>

      <section>
        <h2>Before reporting an installation issue</h2>
        <ol>
          <li>Confirm Meet and Marketplace use the email address approved as a draft tester.</li>
          <li>Refresh Meet after installation.</li>
          <li>Open Meeting tools, select Add-ons, and look for Airboard Pilot.</li>
        </ol>
      </section>
    </PilotInfoPage>
  );
}
