import type { Metadata } from "next";
import { BillingPage } from "../../../src/features/product/BillingPage";

export const metadata: Metadata = { title: "Plan & billing" };
export default function Billing() { return <BillingPage />; }
