import type { Metadata } from "next";
import { PILOT_CONTACT, PilotInfoPage } from "../../../src/features/pilot/PilotInfoPage";

export const metadata: Metadata = { title: "Leave the pilot" };

export default function PilotDraftOptOutPage() {
  const subject = encodeURIComponent("Remove me from the Airboard pilot");
  const body = encodeURIComponent("Please delete my Airboard account.");
  return (
    <PilotInfoPage title="Leave the pilot" summary="Stop using Airboard and, if you want, delete your account and boards.">
      <section>
        <h2>Delete your account</h2>
        <p>Signed in, open Settings from the profile menu, choose Privacy &amp; data, and schedule account deletion. You can cancel within seven days; after that your account and the boards in your personal workspace are deleted. Boards in a shared team workspace stay with that workspace. If you want to keep your boards, first request a data export in Privacy &amp; data (it includes your boards as JSON), or export each board as an image from Share → Export PNG.</p>
      </section>
      <section>
        <h2>Ask us instead</h2>
        <p>Send the request from your Airboard account email and we'll delete your account for you.</p>
        <p><a className="pilot-info-action" href={`mailto:${PILOT_CONTACT}?subject=${subject}&body=${body}`}>Email the request</a></p>
      </section>
    </PilotInfoPage>
  );
}
