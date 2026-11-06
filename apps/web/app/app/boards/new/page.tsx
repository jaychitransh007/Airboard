import type { Metadata } from "next";
import { AuthenticatedAirboard } from "../../../../src/features/product/AuthenticatedAirboard";

export const metadata: Metadata = { title: "New board" };
export default function NewBoard() { return <div className="canvas-route"><AuthenticatedAirboard /></div>; }
