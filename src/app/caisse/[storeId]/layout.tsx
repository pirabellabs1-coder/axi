import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Caisse",
  manifest: "/caisse/manifest.webmanifest",
  robots: { index: false, follow: false },
};

/**
 * Mise en page plein écran de la caisse (lot 3 §2) : hors de la coque de l'espace marchand (pas de
 * barre latérale), installable (manifeste PWA de portée `/caisse/`).
 */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-surface">{children}</div>;
}
