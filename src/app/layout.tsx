import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GMClean — Privacy-First Email Newsletter Manager",
  description: "Self-hosted tool that scans your inbox, classifies emails, and lets you mass-unsubscribe from newsletters — without ever sharing your data. The zero-knowledge alternative to Unroll.me.",
  keywords: ["email", "newsletter", "unsubscribe", "privacy", "self-hosted", "inbox", "cleanup", "IMAP"],
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "GMClean — Privacy-First Email Newsletter Manager",
    description: "Scan, classify, and mass-unsubscribe from newsletters. 100% local, zero-knowledge, self-hosted.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
