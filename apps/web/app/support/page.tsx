import type { Metadata } from "next";
import { SupportPage } from "../../src/features/product/SupportPage";

export const metadata: Metadata = { title: "Support" };
export default function Support() { return <SupportPage />; }
