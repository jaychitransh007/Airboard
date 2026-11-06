import type { Metadata } from "next";
import { StatusPage } from "../../src/features/product/StatusPage";

export const metadata: Metadata = { title: "Status" };
export default function Status() { return <StatusPage />; }
