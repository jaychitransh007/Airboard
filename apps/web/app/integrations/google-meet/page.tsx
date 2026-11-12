import { redirect } from "next/navigation";

// The Google Meet guide is in the Help Center; this keeps old links to the former page working.
export default function GoogleMeetIntegration() { redirect("/help/integrations/google-meet"); }
