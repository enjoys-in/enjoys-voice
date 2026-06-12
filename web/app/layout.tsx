import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Enjoys Voice — Browser VoIP Calling",
    template: "%s · Enjoys Voice",
  },
  description:
    "Make and receive crystal-clear VoIP calls right from your browser. Dialer, call history, contacts, voicemail and IVR — no desktop app required.",
  applicationName: "Enjoys Voice",
  keywords: [
    "VoIP",
    "browser calling",
    "SIP",
    "WebRTC",
    "softphone",
    "voicemail",
    "IVR",
    "Enjoys Voice",
  ],
  authors: [{ name: "Enjoys" }],
  creator: "Enjoys",
  publisher: "Enjoys",
  manifest: "/manifest.json",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Enjoys Voice",
  },
  openGraph: {
    type: "website",
    siteName: "Enjoys Voice",
    title: "Enjoys Voice — Browser VoIP Calling",
    description:
      "Make and receive crystal-clear VoIP calls right from your browser. Dialer, call history, contacts, voicemail and IVR.",
    url: siteUrl,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Enjoys Voice — Browser VoIP Calling",
    description:
      "Make and receive crystal-clear VoIP calls right from your browser.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Runtime config injected at container start (see prod/web-entrypoint.sh). */}
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
      </head>
      <body className={`${inter.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
