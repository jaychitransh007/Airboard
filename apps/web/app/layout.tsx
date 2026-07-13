import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Airboard",
  description: "Gesture-based virtual whiteboard for meetings",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
