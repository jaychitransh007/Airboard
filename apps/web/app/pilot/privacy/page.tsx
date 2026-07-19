import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotPrivacyPage() {
  return (
    <PilotInfoPage title="Meet overlay preview privacy" summary="What the Airboard Chrome extension processes while it places diagrams on your outgoing Meet camera.">
      <section>
        <h2>Account and installation</h2>
        <p>Airboard processes your account identity, organization, installation version, settings, affirmative consent record, entitlement, and content-free readiness counters to connect and operate the extension. The extension receives a revocable installation credential—not your password or identity-provider access token.</p>
      </section>
      <section>
        <h2>Camera, microphone, and board content</h2>
        <p>After confirmation, camera frames are processed live for the camera composite, gesture alignment, and on-device person segmentation. Microphone audio is processed only while Airo is enabled and can be streamed through the Airboard API to the configured transcription provider. The extension does not store raw camera frames or microphone audio.</p>
        <p>Diagram state is rendered in a private Airboard frame and transferred as image frames to the Meet compositor. Account controls, logs, meeting URLs, and browser history are not added to the outgoing video.</p>
      </section>
      <section>
        <h2>Diagnostics and choices</h2>
        <p>Readiness diagnostics contain capability state, extension version, error codes, timestamps, and WebRTC counters such as encoded frames and outbound bytes. They exclude raw media, meeting URLs, transcripts, and board labels.</p>
        <p>You can disable overlay, camera, or Airo from the popup; revoke the installation from Airboard; remove Meet site access in Chrome; or uninstall the extension.</p>
      </section>
    </PilotInfoPage>
  );
}
