import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotPrivacyPage() {
  return (
    <PilotInfoPage
      title="Pilot privacy notice"
      summary="What the Airboard Google Meet pilot processes, why it is processed, and the limits of this evaluation environment."
    >
      <section>
        <h2>Information processed</h2>
        <ul>
          <li>
            Basic Google account profile and email information supplied through the Marketplace
            installation scopes, used to identify the tester and installation.
          </li>
          <li>
            Google Meet activity context needed to open the side panel and main stage and associate
            the activity with an Airboard session.
          </li>
          <li>
            Board content and actions created by testers, including typed commands, gesture- and
            voice-derived edits, objects, connectors, pointer actions, and session events.
          </li>
          <li>
            Operational metadata such as timestamps, route and status information, correlation
            identifiers, and client or service errors used to diagnose the pilot.
          </li>
        </ul>
      </section>

      <section>
        <h2>Pilot limits</h2>
        <p>
          The current pilot uses disposable in-memory session state and has no production customer
          database. Do not enter confidential, regulated, customer, or production information.
        </p>
        <p>
          Airboard never captures camera or microphone in the background and cannot read Google
          Meet&apos;s own media streams. Gesture (camera) and voice (microphone) input start only from
          an explicit tester action with a visible on-screen indicator: inside Meet when the Meet
          client delegates browser media permission to the add-on, through the optional Airboard
          Meet Media Bridge browser extension (which captures on the meeting page — using the
          permission already granted to Meet — only after an explicit start in Airboard, and
          streams frames solely to the Airboard add-on), or otherwise in a separate companion
          browser window connected to the same board. Camera frames are processed in
          the browser for hand tracking and are not uploaded or stored by Airboard. When a
          transcription provider is configured for the pilot, voice audio is streamed to that
          provider to produce a transcript and is not stored by Airboard; the currently deployed
          pilot has no transcription or semantic-AI provider credentials configured. Google
          Meet&apos;s own meeting media controls are never affected.
        </p>
      </section>

      <section>
        <h2>Use, sharing, and retention</h2>
        <p>
          Information is used only to operate, secure, test, and troubleshoot the Airboard Pilot. It
          is not sold. The pilot is hosted on Google Cloud; Google processes hosting and operational
          data under the project&apos;s cloud configuration.
        </p>
        <p>
          In-memory board state is temporary and can disappear when a service instance restarts.
          Cloud service logs can persist according to the pilot project&apos;s logging configuration.
          Production retention, deletion, export, and audit controls must be approved separately
          before customer beta use.
        </p>
      </section>

      <section>
        <h2>Choices and contact</h2>
        <p>
          Testers can stop using the pilot, uninstall the add-on, or use the draft-tester opt-out
          page. Contact the pilot owner to request removal of test access or associated pilot data.
        </p>
        <p>
          <a href="/pilot/draft-opt-out">Open the draft-tester opt-out page</a>
        </p>
      </section>
    </PilotInfoPage>
  );
}
