import type { Metadata } from "next";
import { Geist_Mono, Inter, Red_Hat_Display } from "next/font/google";
import "./globals.css";

// Inter for text and a heavy Red Hat Display for headings.
const geistSans = Inter({ variable: "--font-geist-sans", subsets: ["latin"] });
const display = Red_Hat_Display({ variable: "--font-display", subsets: ["latin"], weight: ["700", "800", "900"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Poscere — virtual patient telehealth simulation",
  description: "Telehealth simulations with virtual patients.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
