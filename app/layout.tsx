import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Orbit Explorer — Live ISS Tracking",
  description:
    "Track the International Space Station in real time, propagated client-side with SGP4.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
