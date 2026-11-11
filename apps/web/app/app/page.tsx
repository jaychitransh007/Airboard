import type { Metadata } from "next";
import { AirboardsHome } from "../../src/features/product/AirboardsHome";

export const metadata: Metadata = { title: "Airboards" };
export default function AppHome() { return <AirboardsHome />; }
