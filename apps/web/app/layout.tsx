import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Airboard — let ideas flow into view", template: "%s · Airboard" },
  description: "Turn voice, gestures, and sketches into live diagrams on a limitless canvas, over your screen, or directly in your meeting video.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
