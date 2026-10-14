import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { waLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import type { GlobalSettings } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import { schemeVars } from "@/lib/storefront/theme-doc";
import { CartButton } from "./cart-button";
import { AccountLink } from "./account/account-link";
import { HeaderSearch } from "./header-search";
import { CurrencyPicker } from "./currency-picker";
import { MobileMenu } from "./mobile-menu";
import { ProductImage } from "./product-image";
import { href as linkHref } from "./render-context";
import { HeaderOverlayBar } from "./header-overlay-bar";

/**
 * En-tête piloté par `settings.header` : annonce, logo (gauche, centré ou minimal), menu `StoreMenu`
 * (sous-menus au survol et au clavier), recherche, panier. Collant si demandé.
 */
export function StoreHeader({ settings, data, minimal = false, currency, overlay = false }: { settings: GlobalSettings; data: RenderData; minimal?: boolean; currency?: { current: string; options: { code: string; label: string }[] } | null; /** En-tête transparent superposé à la 1re bannière (décidé en amont par `headerOverlaysHero`). */ overlay?: boolean }) {
  const h = settings.header;
  const store = data.store;
  const base = `/s/${store.slug}${store.localePrefix ?? ""}`; // lot 2 : segment de langue des liens
  const links = data.menus[h.menu] ?? data.menus.main ?? [];
  const ann = h.announcement;
  const annVars = ann.enabled && ann.text.trim() ? schemeVars(settings, ann.scheme || "brand") ?? schemeVars(settings, "brand") : null;
  const annHref = linkHref({ base }, ann.link ?? null);
  const wa = store.whatsappNumber ? waLink(store.whatsappNumber, `Bonjour ${store.name}, j'ai une question.`) : null;
  const center = h.layout === "logo-center" && !minimal;
  const showNav = h.layout !== "minimal" && !minimal;
  // Sélecteur de devise : barre d'outils à partir de 640 px, menu mobile en dessous.
  const mobileCurrency = currency && h.showCurrencyPicker !== false && !minimal ? currency : null;

  const logo = (
    <Link href={base} className="flex min-w-0 items-center gap-2.5 rounded-[10px]" aria-label={`${store.name}, accueil`}>
      {h.logo ? (
        // Borne de la validation et de l'éditeur (300 px ; le sanitize peut borner plus bas) ; sur mobile, jamais plus de 45 % de la largeur (outils de l'en-tête visibles).
        <span className="relative block h-10 max-w-[45vw]" style={{ width: Math.min(h.logoWidth, 300) }}>
          <ProductImage src={h.logo.url} alt="" ratio="h-full" fit="contain" className="!bg-transparent" sizes={`(max-width: 640px) 45vw, ${Math.min(h.logoWidth, 300)}px`} priority fetchPriority="auto" />
        </span>
      ) : (
        <>
          {store.logoUrl && <ProductImage src={store.logoUrl} alt="" ratio="aspect-square" className="w-9 shrink-0 rounded-[10px] ring-1 ring-line" sizes="36px" priority fetchPriority="auto" />}
          <span className="truncate text-[17px] font-semibold tracking-[-0.02em] text-ink" style={{ fontFamily: "var(--store-font-heading)" }}>
            {store.name}
          </span>
        </>
      )}
    </Link>
  );

  const nav = showNav && links.length > 0 && (
    <nav aria-label="Navigation principale" className="hidden lg:block">
      <ul className={cn("flex items-center gap-1", center && "justify-center")}>
        {links.map((l, i) => (
          <li key={i} className="group relative">
            <Link href={l.href} className="inline-flex h-11 items-center gap-1 rounded-full px-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-surface-2">
              {l.label}
              {l.children.length > 0 && <ChevronDown className="size-3.5 opacity-60 transition-transform duration-200 group-focus-within:rotate-180 group-hover:rotate-180" aria-hidden />}
            </Link>
            {l.children.length > 0 && (
              <div className="invisible absolute left-0 top-full z-40 pt-2 opacity-0 transition-[opacity,visibility,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                <ul className={cn("min-w-56 rounded-[16px] bg-surface p-2 shadow-[var(--shadow-lg)] ring-1 ring-line", overlay && "sf-ink-reset")}>
                  {l.children.map((c, j) => (
                    <li key={j}>
                      <Link href={c.href} className="flex min-h-11 items-center rounded-[10px] px-3 text-[15px] text-ink hover:bg-surface-2">
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );

  const tools = (
    <div className="flex items-center justify-end gap-0.5">
      {/* Lot 2 (équipe C) : devise d'affichage, rendue seulement si la boutique en propose au moins deux et si le thème l'affiche. */}
      {/* Sous 640 px, l'en-tête n'a pas la place : le sélecteur est repris dans le menu mobile (aucun débordement). */}
      {currency && h.showCurrencyPicker !== false && !minimal && <CurrencyPicker {...currency} compact className="mr-0.5 hidden sm:inline-flex" />}
      {h.showSearch && !minimal && <HeaderSearch base={base} placeholder={store.copy.searchPlaceholder} compact={center} />}
      {h.showAccount !== false && !minimal && data.shopper?.accountsEnabled && <AccountLink slug={store.slug} loggedIn={data.shopper.loggedIn} className="text-ink" />}
      {!minimal && <CartButton slug={store.slug} mode={settings.cart.type} />}
    </div>
  );

  const annNode = annVars && (
    <div style={annVars as React.CSSProperties} className="relative z-40 px-4 py-2 text-center text-[13px] font-medium">
      {annHref ? (
        <Link href={annHref} className="underline-offset-4 hover:underline">
          {ann.text}
        </Link>
      ) : (
        ann.text
      )}
    </div>
  );

  // En-tête transparent sur la bannière : fond/bordure/ton pilotés par le CSS selon `data-overlay-state` (voir store-styles),
  // en-tête fixe géré par `HeaderOverlayBar`. Sinon, style opaque actuel, collant ou relatif selon le réglage.
  const headerEl = (
    <header
      data-section-group="header"
      className={cn(
        "z-30",
        overlay
          ? "sf-header-overlay"
          : cn("border-b border-line/70 bg-surface/90 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/80", h.sticky ? "sticky top-0" : "relative"),
      )}
    >
      <div className="sf-container relative flex h-16 items-center gap-2 lg:h-[72px]">
          {center ? (
            <>
              <div className="flex flex-1 items-center gap-1">
                {showNav && <MobileMenu links={links} storeName={store.name} whatsappHref={wa} currency={mobileCurrency} />}
                <div className="hidden lg:block">{nav}</div>
              </div>
              <div className="flex shrink-0 justify-center">{logo}</div>
              <div className="flex flex-1 justify-end">{tools}</div>
            </>
          ) : (
            <>
              {showNav && <MobileMenu links={links} storeName={store.name} whatsappHref={wa} currency={mobileCurrency} />}
              <div className="min-w-0 shrink">{logo}</div>
              <div className="ml-4 hidden min-w-0 flex-1 lg:block">{nav}</div>
              <div className="ml-auto">{tools}</div>
            </>
          )}
        </div>
      </header>
  );

  if (overlay) {
    return (
      <HeaderOverlayBar>
        {annNode}
        {headerEl}
      </HeaderOverlayBar>
    );
  }
  return (
    <>
      {annNode}
      {headerEl}
    </>
  );
}
