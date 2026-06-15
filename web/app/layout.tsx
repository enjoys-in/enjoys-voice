import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const repoUrl = "https://github.com/enjoys-in/enjoys-voice";
const authorUrl = "https://github.com/enjoys-in";

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
  authors: [{ name: "Enjoys", url: authorUrl }],
  creator: "Enjoys",
  publisher: "Enjoys",
  category: "communication",
  alternates: { canonical: "/" },
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
    creator: "@enjoys_in",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

// schema.org structured data ("graph") so search engines and link unfurlers
// understand the app, its author and its source repository.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#app`,
      name: "Enjoys Voice",
      url: siteUrl,
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Any (web browser)",
      browserRequirements: "Requires JavaScript and WebRTC",
      description:
        "Make and receive crystal-clear VoIP calls right from your browser. Dialer, call history, contacts, voicemail and IVR — no desktop app required.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: { "@id": `${siteUrl}/#author` },
      sameAs: [repoUrl],
    },
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#author`,
      name: "Enjoys",
      url: authorUrl,
      sameAs: [authorUrl, repoUrl],
    },
  ],
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
        {/* schema.org structured-data graph (author + source repo). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${inter.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
