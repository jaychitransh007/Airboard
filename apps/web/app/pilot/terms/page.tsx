import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotTermsPage() {
  return (
    <PilotInfoPage title="Meet overlay preview terms" summary="Conditions for evaluating the pre-release Airboard Chrome extension.">
      <section><h2>Evaluation scope</h2><p>The private-preview build is provided to approved testers for technical and usability evaluation. Do not use confidential, regulated, customer, or business-critical meeting content until Airboard completes store review, legal approval, and the published release gates.</p></section>
      <section><h2>Tester responsibilities</h2><ul><li>Use only the approved Chrome profile and Airboard account.</li><li>Do not bypass browser, meeting, organization, entitlement, or consent controls.</li><li>Tell meeting participants when your outgoing camera includes an Airboard composite where law or policy requires it.</li><li>Report security, privacy, data-loss, or cross-account behavior promptly.</li></ul></section>
      <section><h2>Privacy and removal</h2><p>Use is subject to the <a href="/pilot/privacy">preview privacy notice</a>. You can disable or uninstall the extension and ask the Airboard owner to revoke the installation or remove preview access.</p></section>
    </PilotInfoPage>
  );
}
