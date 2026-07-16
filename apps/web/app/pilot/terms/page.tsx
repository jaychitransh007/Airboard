import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotTermsPage() {
  return (
    <PilotInfoPage
      title="Pilot terms of use"
      summary="Conditions for evaluating the pre-release Airboard Pilot through Google Meet."
    >
      <section>
        <h2>Evaluation scope</h2>
        <p>
          Airboard Pilot is pre-release software provided to designated testers for technical and
          usability evaluation. It is not approved for production meetings, customer records,
          confidential information, regulated data, or business-critical workflows.
        </p>
      </section>

      <section>
        <h2>Tester responsibilities</h2>
        <ul>
          <li>Use only an account authorized as a Marketplace draft tester.</li>
          <li>Do not attempt to bypass meeting, installation, role, or access restrictions.</li>
          <li>Do not upload harmful material or use the pilot to violate another person&apos;s rights.</li>
          <li>Report security, privacy, data-loss, or cross-session behavior promptly.</li>
        </ul>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          The pilot can change, reset, become unavailable, or be withdrawn without notice. Board
          state is disposable and may be lost. No uptime, support-response, compatibility, or data
          durability commitment applies to this evaluation.
        </p>
      </section>

      <section>
        <h2>Privacy and termination</h2>
        <p>
          Use of the pilot is also subject to the <a href="/pilot/privacy">pilot privacy notice</a>.
          A tester may stop at any time and request removal from the draft tester list. Access can be
          removed when necessary to protect the pilot, other testers, or the project.
        </p>
      </section>
    </PilotInfoPage>
  );
}

