import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SITE } from "@/config/site";
import { MEDIA, unsplash } from "@/config/media";
import { Toaster } from "@/components/ui/toast";
import { ThemeScript } from "@/components/ui/theme-script";
import "./globals.css";

// Polices auto-hébergées (OFL) : aucun appel réseau au build ni chez le visiteur.
const geist = localFont({ src: "../fonts/geist-latin.woff2", weight: "100 900", variable: "--font-geist", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Arial"] });
const geistMono = localFont({ src: "../fonts/geist-mono-latin.woff2", weight: "100 900", variable: "--font-geist-mono", display: "swap", fallback: ["ui-monospace", "Menlo", "monospace"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} | ${SITE.tagline}`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "fr_FR",
    images: [{ url: unsplash(MEDIA.market.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.market.alt }],
  },
  twitter: { card: "summary_large_image", site: SITE.twitter, images: [unsplash(MEDIA.market.id, 1200, 630)] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f0c" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Thème et barre latérale mémorisés, appliqués avant le premier rendu (voir ThemeScript). */}
        <ThemeScript />
      </head>
      <body className="min-h-dvh" suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
