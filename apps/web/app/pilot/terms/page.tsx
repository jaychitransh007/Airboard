import type { Metadata } from "next";
import { PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export const metadata: Metadata = { title: "Pilot terms" };

export default function PilotTermsPage() {
  return (
    <PilotInfoPage title="Pilot terms" summary="Conditions for taking part in the Airboard controlled pilot.">
      <section><h2>Evaluation scope</h2><p>The pilot gives early access to Airboard for evaluation. Airboard is pre-release: features can change and the service can be interrupted. Do not use confidential, regulated or business-critical content until Airboard reaches general availability.</p></section>
      <section><h2>Your responsibilities</h2><ul><li>Sign in only with your own Google account.</li><li>Do not bypass browser, meeting, workspace, allowance or consent controls.</li><li>Where law or policy requires it, tell meeting participants that you are presenting an Airboard tab with your camera behind the board and that Airboard transcribes your microphone.</li><li>Report security, privacy, data-loss or cross-account problems promptly.</li></ul></section>
      <section><h2>Privacy and leaving</h2><p>Use is subject to the <a href="/pilot/privacy">pilot privacy summary</a> and the <a href="/privacy">Airboard privacy notice</a>; the full draft terms are the <a href="/terms">Airboard terms</a>. You can <a href="/pilot/draft-opt-out">leave the pilot</a> at any time.</p></section>
    </PilotInfoPage>
  );
}
