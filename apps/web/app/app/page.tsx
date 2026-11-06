import type { Metadata } from "next";
import { Dashboard } from "../../src/features/product/Dashboard";

export const metadata: Metadata = { title: "Overview" };
export default function AppHome() { return <Dashboard />; }
