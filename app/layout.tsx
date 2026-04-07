import type { Metadata, Viewport } from "next";
import "./globals.css";
import VersionCheck from "@/components/VersionCheck";

export const metadata: Metadata = {
  title: "Plaud Dashboard",
  description: "Weekly transcript dashboard for Plaud voice recorder",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Plaud",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <VersionCheck />
        {children}
      </body>
    </html>
  );
}
