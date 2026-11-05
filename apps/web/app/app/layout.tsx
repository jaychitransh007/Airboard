import { AuthGate } from "../../src/platform/auth";
import { AppShell } from "../../src/features/product/AppShell";
export default function ProductLayout({ children }: { children: React.ReactNode }) { return <AuthGate><AppShell>{children}</AppShell></AuthGate>; }
