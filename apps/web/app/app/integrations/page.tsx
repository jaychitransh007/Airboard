import { redirect } from "next/navigation";

// Google Meet is explained in the Help Center; there is no integrations page.
export default function Integrations() { redirect("/help/integrations/google-meet"); }
