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
            Board content and actions created by testers, including typed commands, objects,
            connectors, pointer actions, and session events.
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
          The deployed pilot does not have transcription or semantic-AI provider credentials
          configured. Inside Google Meet, Airboard does not request separate camera or microphone
          access, does not capture Meet&apos;s media streams, and does not show its own video preview.
          Google Meet remains responsible for meeting camera and microphone controls. Airboard&apos;s
          Meet experience uses typed, pointer, keyboard, and direct canvas input.
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
