import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotSetupPage() {
  return (
    <PilotInfoPage
      title="Install the Airboard Meet overlay"
      summary="The controlled Chrome-extension path puts Airboard on your camera without opening a dedicated Meet canvas."
    >
      <section>
        <h2>Install and connect</h2>
        <ol>
          <li>Install the approved private-preview build in the Chrome profile you use for Meet.</li>
          <li>Open the Airboard toolbar popup and choose Connect Airboard.</li>
          <li>Sign in, connect the detected installation, and return to the popup.</li>
          <li>Review and accept the one-time live-media disclosure.</li>
        </ol>
      </section>
      <section>
        <h2>Use in Meet</h2>
        <ol>
          <li>Open or refresh a Google Meet meeting-code URL.</li>
          <li>Turn on your ordinary Meet camera. Do not launch an Airboard activity.</li>
          <li>Open the extension popup and confirm all six readiness checks pass.</li>
          <li>Ask a second participant to confirm the decoded neon composite.</li>
        </ol>
      </section>
      <section>
        <h2>What the audience sees</h2>
        <p>Only your normal Meet camera tile with the Airboard diagram composite. Account settings, controls, logs, selection feedback, and the private renderer never enter the audience output.</p>
        <p><a href="/help/integrations/google-meet">Open the complete Google Meet guide →</a></p>
      </section>
    </PilotInfoPage>
  );
}
