import type { Metadata } from "next";
import localFont from "next/font/local";
import { Manrope } from "next/font/google";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Manrope 800 powers the FieldSlate wordmark inside FieldSlateLockup. Loaded
// via next/font so it self-hosts at build time (no CLS, no Google fetch at
// runtime). The component references var(--font-manrope) with a system-font
// fallback chain.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FieldSlate — Sports Season Scheduling",
  description: "Manage your sports season schedules, teams, venues, and results all in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
