import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotSetupPage() {
  return (
    <PilotInfoPage
      title="Install and open Airboard Pilot"
      summary="The customer-shaped installation path for approved Google Workspace Marketplace draft testers."
    >
      <section>
        <h2>Install</h2>
        <ol>
          <li>Sign in to Google Workspace Marketplace with the approved draft-tester account.</li>
          <li>Open the Airboard Pilot draft listing and select Install.</li>
          <li>Review the requested basic profile and email scopes and complete Google&apos;s consent flow.</li>
        </ol>
      </section>

      <section>
        <h2>Open in a meeting</h2>
        <ol>
          <li>Start or join an eligible Google Meet meeting.</li>
          <li>Open Meeting tools, choose Add-ons, then select Airboard Pilot.</li>
          <li>Use the side panel to start the activity; Airboard opens in Meet&apos;s main stage.</li>
        </ol>
      </section>

      <section>
        <h2>Safe pilot path</h2>
        <p>
          Use typed commands, pointer, keyboard, and direct canvas controls in Airboard. Google Meet
          owns the meeting camera and microphone controls; the Airboard add-on does not request a
          second media permission or show a separate video preview. Do not use confidential or
          production meeting content.
        </p>
      </section>
    </PilotInfoPage>
  );
}
