import type { Metadata } from "next";
import { LiveBoardJoin } from "../../../src/features/product/LiveBoardJoin";

export const metadata: Metadata = { title: "Live board", robots: { index: false, follow: false } };

export default async function LiveBoardPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ joinToken?: string | string[] }> }) {
  const [{ sessionId }, { joinToken }] = await Promise.all([params, searchParams]);
  return <LiveBoardJoin sessionId={sessionId} joinToken={typeof joinToken === "string" && joinToken ? joinToken : null} />;
}
