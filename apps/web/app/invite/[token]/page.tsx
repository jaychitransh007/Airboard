import type { Metadata } from "next";
import { InvitePage } from "../../../src/features/product/InvitePage";

export const metadata: Metadata = { title: "Join a workspace" };

export default async function InvitationRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
