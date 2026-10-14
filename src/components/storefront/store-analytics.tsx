"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { Cookie } from "lucide-react";

type Consent = "granted" | "denied" | null;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const key = (slug: string) => `axi:consent:${slug}`;
const RESET_EVENT = "axi:consent-reset";

/** Slug de boutique d'un chemin `/s/{slug}/…`, sinon null. */
export function storeSlugOfPath(pathname: string): string | null {
  const m = /^\/s\/([a-z0-9-]+)(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}

/** Lien « Gérer les cookies » (pied de page) : réinitialise le choix et ré-affiche le bandeau. */
export function ConsentSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(RESET_EVENT))}
      className={`inline-flex min-h-11 items-center rounded-full px-2 text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline ${className ?? ""}`}
    >
      Gérer les cookies
    </button>
  );
}

/**
 * Mesure d'audience du commerçant (Pixel Meta, Google Analytics 4) : AUCUN script tiers n'est chargé
 * avant le consentement explicite du visiteur. Refus par défaut, choix mémorisé sur l'appareil.
 */
export function StoreAnalytics({ slug, storeName, metaPixelId, gaMeasurementId }: { slug: string; storeName: string; metaPixelId: string | null; gaMeasurementId: string | null }) {
  const pixel = metaPixelId && /^\d{10,20}$/.test(metaPixelId) ? metaPixelId : null;
  const ga = gaMeasurementId && /^G-[A-Z0-9]{4,16}$/.test(gaMeasurementId) ? gaMeasurementId : null;
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(key(slug));
      setConsent(v === "granted" || v === "denied" ? v : null);
    } catch {
      setConsent(null);
    }
    setReady(true);
  }, [slug]);

  // « Gérer les cookies » : oublie le choix. Si les traceurs étaient chargés, rechargement complet pour les retirer.
  useEffect(() => {
    const onReset = () => {
      try {
        window.localStorage.removeItem(key(slug));
      } catch {
        /* stockage indisponible */
      }
      if (consent === "granted") window.location.reload();
      else setConsent(null);
    };
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, [slug, consent]);

  // Lien vers une AUTRE boutique (/s/autre) : rechargement complet, pour que les traceurs (et le consentement)
  // de cette boutique-ci ne suivent pas le visiteur dans la navigation client de l'autre boutique.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const target = storeSlugOfPath(url.pathname);
      if (!target || target === slug) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [slug]);

  // Pages vues lors des navigations client (la première est envoyée par l'initialisation).
  useEffect(() => {
    if (consent !== "granted") return;
    window.fbq?.("track", "PageView");
    if (ga) window.gtag?.("event", "page_view", { page_path: pathname });
  }, [pathname, consent, ga]);

  // Ajout au panier (événement émis par la fiche produit).
  useEffect(() => {
    if (consent !== "granted") return;
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; name: string; value: number; currency: string; quantity: number }>).detail;
      window.fbq?.("track", "AddToCart", { content_ids: [d.id], content_name: d.name, value: d.value, currency: d.currency, content_type: "product" });
      window.gtag?.("event", "add_to_cart", { currency: d.currency, value: d.value, items: [{ item_id: d.id, item_name: d.name, quantity: d.quantity }] });
    };
    window.addEventListener("axi:add-to-cart", onAdd);
    return () => window.removeEventListener("axi:add-to-cart", onAdd);
  }, [consent]);

  if (!pixel && !ga) return null;

  const choose = (v: Exclude<Consent, null>) => {
    try {
      window.localStorage.setItem(key(slug), v);
    } catch {
      /* stockage indisponible : choix valable pour cette visite */
    }
    setConsent(v);
  };

  return (
    <>
      {consent === "granted" && pixel && (
        <Script id="axi-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq.disablePushState=true;fbq('init','${pixel}');fbq('track','PageView');`}
        </Script>
      )}
      {consent === "granted" && ga && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="axi-ga" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga}',{anonymize_ip:true,send_page_view:false});gtag('event','page_view',{page_path:location.pathname});`}
          </Script>
        </>
      )}
      {ready && consent === null && (
        <div role="region" aria-label="Cookies de mesure" className="sf-rise fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-[18px] bg-surface p-4 shadow-[var(--shadow-lg)] ring-1 ring-line sm:bottom-5 sm:p-5">
          <div className="flex gap-3">
            <Cookie className="mt-0.5 size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
            <p className="text-sm leading-relaxed text-ink">
              {storeName} souhaite mesurer la fréquentation de sa boutique ({[pixel && "Meta", ga && "Google Analytics"].filter(Boolean).join(", ")}). Rien n&apos;est chargé sans votre accord.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => choose("denied")} className="sf-btn sf-btn-outline h-11 px-5 text-sm">
              Refuser
            </button>
            <button type="button" onClick={() => choose("granted")} className="sf-btn sf-btn-solid h-11 px-5 text-sm">
              Accepter
            </button>
          </div>
        </div>
      )}
    </>
  );
}
