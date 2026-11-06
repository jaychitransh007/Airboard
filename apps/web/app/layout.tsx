import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Airboard — let ideas flow into view", template: "%s · Airboard" },
  description: "Turn voice, gestures, and sketches into live diagrams on a limitless canvas, over your screen, or directly in your meeting video.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The CSP allows inline scripts only with the nonce middleware.ts makes for
  // each request, so a page prerendered at build time could not hydrate.
  await connection();
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
