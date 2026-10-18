import type { Metadata } from "next";
import { preconnect } from "react-dom";
import { notFound } from "next/navigation";
import { getPausedStorefront, getStorefront } from "@/lib/storefront/data";
import { PausedStorefront } from "@/components/storefront/paused-storefront";
import { getThemeDocument } from "@/lib/theme-engine/resolve";
import { storeFontClassName } from "@/lib/theme-engine/fonts";
import { themeCssVars } from "@/lib/storefront/theme-doc";
import { StoreStyles } from "@/components/storefront/store-styles";
import { PwaHead } from "@/components/storefront/pwa/pwa-head"; // Lot 4D (CAN) : manifeste, service worker, mode économie
import { shareableImageUrl } from "@/lib/storage/public-url";
import { localeAlternates, localizedStore, requestLocale } from "@/lib/i18n/resolve";

export const dynamic = "force-dynamic";

/**
 * Origines des images de la vitrine, préconnectées dès le premier octet (DNS + TLS en parallèle du HTML) : le CDN
 * Unsplash (loader next/image direct, src/lib/image-loader.ts) et l'origine du stockage public si elle est distincte.
 * Mesure lot 1 : l'image du LCP partait d'un domaine tiers sans connexion préparée.
 */
function imageOrigins(): string[] {
  const out = ["https://images.unsplash.com"];
  try {
    const raw = process.env.STORAGE_PUBLIC_URL?.trim();
    const origin = raw ? new URL(raw).origin : null;
    if (origin && /^https:/.test(origin) && !out.includes(origin)) out.push(origin);
  } catch {
    /* STORAGE_PUBLIC_URL invalide : ignorée */
  }
  return out;
}

type Props = { children: React.ReactNode; params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  const store = sf?.store;
  if (!store) {
    const paused = await getPausedStorefront(slug);
    if (paused) return { title: `${paused.name} : boutique momentanément fermée`, robots: { index: false, follow: false } };
    return { title: "Boutique introuvable" };
  }
  const doc = getThemeDocument(store);
  const share = doc.settings.social.shareImage?.url ?? store.bannerUrl ?? store.logoUrl ?? undefined;
  const image = shareableImageUrl(share);
  const favicon = doc.settings.social.favicon?.url;
  // Lot 2 §1.1 : nom et accroche dans la langue de l'URL, hreflang de toutes les langues servies + x-default.
  const i18n = await localizedStore(store);
  const name = i18n.name;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: i18n.tagline ?? i18n.description?.slice(0, 160) ?? undefined,
    alternates: i18n.ctx.served.length > 1 ? { languages: localeAlternates(i18n.ctx).languages } : undefined,
    openGraph: { title: name, description: i18n.tagline ?? undefined, type: "website", siteName: name, locale: i18n.ctx.locale, images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary" },
    icons: shareableImageUrl(favicon) ? { icon: shareableImageUrl(favicon)! } : undefined,
    robots: store.status === "PUBLISHED" && !sf.preview ? undefined : { index: false, follow: false },
  };
}

/**
 * Racine de la boutique : styles, polices et variables du thème publié (pour les états chargement / erreur / introuvable).
 * L'en-tête, le pied de page et les sections sont rendus par chaque page (StorefrontView), ce qui permet
 * l'aperçu en direct du brouillon par l'éditeur.
 */
export default async function StoreLayout({ children, params }: Props) {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) {
    // Boutique en pause (abonnement) : page de fermeture à la place de TOUTES les pages (catalogue, produit, panier,
    // commande…), qui ne sont jamais rendues. Les membres gardent l'aperçu (getStorefront, statut non public).
    const paused = await getPausedStorefront(slug);
    if (paused) return <PausedStorefront name={paused.name} logoUrl={paused.logoUrl} />;
    notFound();
  }
  const doc = getThemeDocument(sf.store, { preview: !!sf.preview?.draft });
  // React place ces <link rel="preconnect"> dans le <head> (images : requêtes sans CORS, pas de crossOrigin).
  for (const origin of imageOrigins()) preconnect(origin);
  // Lot 2 §1.1 : langue et direction d'écriture de la racine de la boutique (arabe en `rtl`). L'attribut `lang`
  // du document reste celui de l'application : il est surchargé ici pour tout le sous-arbre de la vitrine.
  const locale = await requestLocale(sf.store);
  return (
    <div lang={locale.locale} dir={locale.dir} data-locale={locale.locale} data-store-root={sf.store.slug} data-theme="light" className={storeFontClassName} style={{ ...themeCssVars(doc.settings), colorScheme: "light" } as React.CSSProperties}>
      <StoreStyles />
      <PwaHead slug={sf.store.slug} />
      <div className="min-h-dvh bg-canvas text-ink" style={{ fontFamily: "var(--store-font)" }}>
        {children}
      </div>
    </div>
  );
}
