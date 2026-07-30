import type { Metadata } from "next";
import { HelpCenterPage } from "../../src/features/help/HelpCenterPage";

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "Set up Airboard, learn commands and input methods, troubleshoot errors, and verify preview integrations.",
};

export default function HelpHomePage() {
  return <HelpCenterPage />;
}
