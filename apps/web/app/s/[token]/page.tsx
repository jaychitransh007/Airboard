import type { Metadata } from "next";
import { SharedBoardView } from "../../../src/features/share/SharedBoardView";

export const metadata: Metadata = {
  title: "Shared board",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedBoardView token={token} />;
}
