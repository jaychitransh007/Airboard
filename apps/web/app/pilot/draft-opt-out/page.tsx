import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export default function PilotDraftOptOutPage() {
  const subject = encodeURIComponent("Remove me from Airboard Pilot draft testing");
  const body = encodeURIComponent(
    "Please remove this Google account from the Airboard Pilot Marketplace draft tester list.",
  );

  return (
    <PilotInfoPage
      title="Draft-tester opt out"
      summary="Notify the Airboard publisher that you no longer want access to the Marketplace draft."
    >
      <section>
        <h2>Request removal</h2>
        <p>
          Send an opt-out request from the Google account that is enrolled as a draft tester. The
          publisher will remove that address from the centrally managed tester list.
        </p>
        <p>
          <a className="pilot-info-action" href={`mailto:${PILOT_CONTACT}?subject=${subject}&body=${body}`}>
            Email the opt-out request
          </a>
        </p>
        <p>
          You can also uninstall Airboard Pilot from Google Workspace Marketplace. Removal from the
          draft tester list prevents continued access to the unpublished draft.
        </p>
      </section>
    </PilotInfoPage>
  );
}

