import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotDraftOptOutPage() {
  const subject = encodeURIComponent("Remove my Airboard preview access");
  const body = encodeURIComponent("Please revoke my Airboard Chrome-extension preview installation and remove this account from preview access.");
  return (
    <PilotInfoPage title="Preview opt out" summary="Revoke the Meet overlay installation and remove your account from the controlled preview.">
      <section><h2>Request removal</h2><p>First uninstall Airboard from Chrome or revoke its Meet site access. Then send the request from your Airboard account email so the publisher can revoke the installation record and remove preview access.</p><p><a className="pilot-info-action" href={`mailto:${PILOT_CONTACT}?subject=${subject}&body=${body}`}>Email the opt-out request</a></p></section>
    </PilotInfoPage>
  );
}
