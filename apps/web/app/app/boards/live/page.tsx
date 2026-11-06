import type { Metadata } from "next";
import { AuthenticatedAirboard } from "../../../../src/features/product/AuthenticatedAirboard";

export const metadata: Metadata = { title: "Live board" };
export default function LiveBoard() { return <div className="canvas-route"><AuthenticatedAirboard /></div>; }
