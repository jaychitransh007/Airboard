import type { Metadata } from "next";
import { ContactSalesPage } from "../../src/features/product/ContactSalesPage";

export const metadata: Metadata = { title: "Contact sales" };
export default function ContactSales() { return <ContactSalesPage />; }
