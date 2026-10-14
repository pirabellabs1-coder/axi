import type { ThemeDocument, TemplateId } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import { themeCssVars } from "@/lib/storefront/theme-doc";
import { headerOverlaysHero } from "@/lib/theme-engine/header-overlay";
import { effectiveMotion, motionRootAttrs, type MotionEnv } from "@/lib/theme-engine/motion";
import { StoreHeader } from "./store-header";
import { StoreFooter } from "./store-footer";
import { CartSheet } from "./cart-sheet";
import { WhatsappFab } from "./whatsapp-fab";
import { StoreAnalytics } from "./store-analytics";
import { CartRestore } from "./cart-restore";
import { cartConfig } from "./sections/main-cart";
import { MotionObserver } from "./motion-observer";
import { LocaleBar } from "./locale-bar";

/**
 * Cadre de la boutique : variables du thème, bandeaux d'état, en-tête, contenu, pied de page, panier.
 * Composant pur : rendu côté serveur, ou côté client par l'aperçu en direct de l'éditeur.
 * `minimal` : en-tête et pied de page réduits (commande, confirmation).
 * `motionEnv` (lot 4 §2) : Save-Data, mode économie, aperçu « Réduire les animations » ; tout coupé si l'un est actif.
 */
export function StoreFrame({ doc, data, children, preview = false, minimal = false, motionEnv, currency, template }: { doc: ThemeDocument; data: RenderData; children: React.ReactNode; preview?: boolean; minimal?: boolean; motionEnv?: MotionEnv; currency?: React.ComponentProps<typeof StoreHeader>["currency"]; /** Modèle rendu : sert à décider l'en-tête transparent sur la 1re bannière. */ template?: TemplateId }) {
  const s = doc.settings;
  const motion = effectiveMotion(s.motion, motionEnv);
  const store = data.store;
  // En-tête transparent sur la bannière : hors en-tête réduit, quand la 1re section du corps est une bannière éligible.
  // L'en-tête collant chevauche la bannière (marge négative) ; les bandeaux (annonce, langue, état) restent au-dessus.
  const overlayHero = !minimal && !!template && headerOverlaysHero(s, doc.templates[template]);
  const vars = themeCssVars(s) as React.CSSProperties;
  const ctx = { doc, settings: s, data, template: "home" as const, base: `/s/${store.slug}${store.localePrefix ?? ""}`, preview, first: false };
  return (
    <div
      data-store={store.slug}
      data-theme="light"
      data-sector={store.sector}
      data-btn-style={s.buttons.style}
      data-upper-buttons={s.typography.uppercaseButtons || undefined}
      data-preview={preview || undefined}
      {...motionRootAttrs(motion)}
      style={vars}
      className="flex min-h-dvh flex-col antialiased"
    >
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-[var(--shadow-md)]">
        Aller au contenu
      </a>
      {preview && (
        <div role="status" className="sticky top-0 z-[45] bg-[#2459d6] px-4 py-2 text-center text-[13px] font-medium text-white">
          Aperçu {store.unpublished ? "· boutique non publiée" : "du thème brouillon"} : visible par l&apos;équipe de la boutique uniquement.
        </div>
      )}
      {!preview && store.unpublished && (
        <div role="status" className="bg-ink px-4 py-2.5 text-center text-sm font-medium text-canvas">
          Aperçu : boutique non publiée. Seuls les membres de la boutique la voient.
        </div>
      )}
      {store.closed && (
        <div role="status" className="bg-warning-soft px-4 py-2.5 text-center text-sm font-medium text-warning">
          Boutique temporairement fermée : vous pouvez consulter le catalogue, les commandes reprendront bientôt.
        </div>
      )}
      {!preview && data.locale && data.locale.options.length > 1 && <LocaleBar view={data.locale} />}
      <StoreHeader settings={s} data={data} minimal={minimal} currency={preview ? null : currency} overlay={overlayHero} />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <StoreFooter settings={s} data={data} minimal={minimal} />
      {!minimal && s.cart.type === "drawer" && <CartSheet cfg={cartConfig(ctx)} />}
      {!minimal && store.whatsappOrdering && store.whatsappNumber && <WhatsappFab number={store.whatsappNumber} storeName={store.name} />}
      {!preview && <StoreAnalytics slug={store.slug} storeName={store.name} metaPixelId={store.metaPixelId} gaMeasurementId={store.gaMeasurementId} />}
      {motion.enabled && motion.reveal && !minimal && <MotionObserver />}
      {data.restoredCart && <CartRestore slug={store.slug} restored={data.restoredCart} drawer={s.cart.type === "drawer"} />}
    </div>
  );
}
