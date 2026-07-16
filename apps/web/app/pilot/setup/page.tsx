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
          Typed commands, pointer, keyboard, and direct canvas controls work in every Meet
          surface. Gesture and voice input start only when you enable them: on the shared board
          when your Meet client delegates camera and microphone permission to the add-on, or
          through the companion window link in the Airboard side panel otherwise. Google
          Meet&apos;s own meeting media controls are never affected. Do not use confidential or
          production meeting content.
        </p>
      </section>
    </PilotInfoPage>
  );
}
