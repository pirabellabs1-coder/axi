import Link from "next/link";
import { cn } from "@/lib/utils";
import { saleBadgeLabel, type CardProduct } from "@/lib/storefront/render-types";
import type { RenderCtx } from "./render-context";
import { ProductImage } from "./product-image";
import { QuickAddButton } from "./quick-add-button";
import { FavoriteButton } from "./account/favorite-button";
import { PriceTag } from "./ui";
import { Stars } from "./stars";
import { BACKORDER_LABEL } from "@/lib/inventory/policy";

const RATIO: Record<string, string> = { square: "aspect-square", portrait: "aspect-[4/5]", landscape: "aspect-[4/3]", natural: "aspect-[4/5]" };

/**
 * Largeur réelle d'une vignette (gouttières et marges déduites, page plafonnée à 1280 px) : à 390 px et DPR 2, la
 * vignette fait ~170 px CSS, soit le palier 384w au lieu de 640w (mesure lot 1 : jusqu'à 141 Ko par vignette).
 */
const GRID_SIZES = "(max-width: 640px) calc(50vw - 22px), (max-width: 1024px) calc(33vw - 24px), 300px";

/** Carte produit pilotée par les réglages « cartes produit » du thème (format, marque, 2e image, ajout rapide, bordure). */
export function ProductCard({ product, ctx, priority, layout = "grid", sizes = GRID_SIZES }: { product: CardProduct; ctx: RenderCtx; priority?: boolean; layout?: "grid" | "list"; sizes?: string }) {
  const c = ctx.settings.cards;
  const store = ctx.data.store;
  const href = `${ctx.base}/p/${product.slug}`;
  const [img, second] = product.images;
  const swatches = product.options.find((o) => o.type === "color" && o.values.some((v) => v.swatch));
  const canQuickAdd = c.quickAdd && product.simple && !product.soldOut && !store.closed;
  // Lot 1 : cœur « favori » (réglage cards.showFavorite, comptes acheteurs activés).
  const shopper = ctx.data.shopper;
  const favorite =
    c.showFavorite && shopper?.accountsEnabled ? (
      <FavoriteButton slug={store.slug} productId={product.id} productName={product.name} initial={shopper.favoriteIds.includes(product.id)} loggedIn={shopper.loggedIn} size="sm" />
    ) : null;
  const line = { productId: product.id, variantId: null, optionIds: [], quantity: product.minQty, snapshot: { name: product.name, variantName: null, unitPrice: product.unitPrice, image: img?.url ?? null, productSlug: product.slug } };

  const overlay = c.style === "overlay";
  // Badges empilés dans le coin : statut (épuisé/précommande) prioritaire, puis « Nouveau » et promo (même style accent).
  const saleLabel = !product.soldOut ? saleBadgeLabel(c.saleBadge, product.discountPct) : null;
  const badges: { key: string; text: string; tone: "ink" | "accent"; tabular?: boolean }[] = [];
  if (product.soldOut) badges.push({ key: "status", text: "Épuisé", tone: "ink" });
  else if (product.preorder) badges.push({ key: "status", text: BACKORDER_LABEL, tone: "ink" });
  if (c.showNewBadge && product.isNew) badges.push({ key: "new", text: "Nouveau", tone: "accent" });
  if (saleLabel) badges.push({ key: "sale", text: saleLabel, tone: "accent", tabular: c.saleBadge === "percent" });
  const badgeStack = badges.length ? (
    <div className="pointer-events-none absolute left-2.5 top-2.5 z-[1] flex flex-col items-start gap-1">
      {badges.map((b) => (
        <span
          key={b.key}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            b.tabular && "tabular",
            b.tone === "ink" ? "bg-ink/85 text-canvas" : "bg-[var(--store-accent)] text-[var(--store-accent-contrast)]",
          )}
        >
          {b.text}
        </span>
      ))}
    </div>
  ) : null;

  if (layout === "list") {
    return (
      <article className="sf-card sf-card-frame group relative flex gap-4 bg-surface p-3 ring-1 ring-line transition-shadow duration-300 hover:shadow-[var(--shadow-card)] sm:p-4">
        <div className="flex min-w-0 flex-1 flex-col py-0.5">
          <h3 className="text-[15px] font-semibold leading-snug text-ink sm:text-base" style={{ fontFamily: "var(--store-font)", letterSpacing: "-0.01em" }}>
            <Link href={href} className="after:absolute after:inset-0 after:rounded-[var(--store-card-radius)] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--store-primary)]">
              {product.name}
            </Link>
          </h3>
          {product.description && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-muted">{product.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-2">
            <PriceTag price={product.price} compareAt={product.compareAt} range={product.range} view={ctx.data.currency} itemKey={product.simple ? product.id : null} soldOut={product.soldOut} />
            {product.rating && <Stars value={product.rating.average} size="sm" />}
          </div>
          {product.soldOut && <span className="mt-1 text-xs font-medium text-ink-muted">Épuisé pour le moment</span>}
          {!product.soldOut && !product.simple && <span className="mt-1 text-xs text-ink-muted">{product.variantCount > 0 ? `${product.variantCount} choix` : "Options au choix"}</span>}
        </div>
        <div className="relative w-28 shrink-0 sm:w-32">
          <ProductImage src={img?.url} alt="" ratio="aspect-square" className="sf-media" sizes="128px" priority={priority} />
          {badges.length > 0 && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
              {badges.map((b) => (
                <span key={b.key} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", b.tabular && "tabular", b.tone === "ink" ? "bg-ink/85 text-canvas" : "bg-[var(--store-accent)] text-[var(--store-accent-contrast)]")}>
                  {b.text}
                </span>
              ))}
            </div>
          )}
          {favorite && <div className="absolute -right-2 -top-2 z-10">{favorite}</div>}
          {canQuickAdd && (
            <div className="absolute -bottom-2 -right-2 z-10">
              <QuickAddButton slug={store.slug} line={line} label={store.copy.addLabel} variant="icon" />
            </div>
          )}
        </div>
      </article>
    );
  }

  const titleLink = (
    <Link href={href} className="after:absolute after:inset-0 after:rounded-[var(--store-card-radius)] focus-visible:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--store-primary)] focus-visible:after:ring-offset-4 focus-visible:after:ring-offset-[var(--c-canvas)]">
      {product.name}
    </Link>
  );

  // Style « Superposition » : titre et prix posés en bas de l'image sur un dégradé sombre (texte clair, lisibilité AA).
  if (overlay) {
    return (
      <article className="sf-card group relative flex flex-col">
        <div className="relative">
          <Link href={href} tabIndex={-1} aria-hidden className="sf-card-frame block overflow-hidden rounded-[var(--store-card-radius)]">
            <div className={cn("relative", product.soldOut && "opacity-75 grayscale-[30%]")}>
              <ProductImage src={img?.url} alt="" ratio={RATIO[c.imageRatio] ?? RATIO.portrait} className="sf-media rounded-[var(--store-card-radius)]" imgClassName="sf-img-main" sizes={sizes} priority={priority} />
              {c.showSecondImage && second && (
                <div className="pointer-events-none absolute inset-0 hidden sm:block">
                  <ProductImage src={second.url} alt="" ratio="h-full" className="sf-media rounded-[var(--store-card-radius)] !bg-transparent" imgClassName="sf-img-second" sizes={sizes} />
                </div>
              )}
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 rounded-b-[var(--store-card-radius)] bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
            </div>
          </Link>
          {badgeStack}
          {favorite && <div className="absolute right-2 top-2 z-10">{favorite}</div>}
          {canQuickAdd && (
            <div className="absolute bottom-2.5 right-2.5 z-10">
              <QuickAddButton slug={store.slug} line={line} label={store.copy.addLabel} variant="icon" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] p-3 pr-12 [text-shadow:0_1px_3px_rgb(0_0_0/0.5)]">
            {c.showVendor && product.vendor && <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/80">{product.vendor}</p>}
            <h3 className="pointer-events-auto line-clamp-2 text-sm font-semibold leading-snug text-white sm:text-[15px]" style={{ fontFamily: "var(--store-font)", letterSpacing: "-0.01em" }}>
              {titleLink}
            </h3>
            <div className="mt-1 text-white">
              <PriceTag price={product.price} compareAt={product.compareAt} range={product.range} view={ctx.data.currency} itemKey={product.simple ? product.id : null} soldOut={product.soldOut} />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="sf-card group relative flex flex-col">
      <div className="relative">
        <Link href={href} tabIndex={-1} aria-hidden className="sf-card-frame block overflow-hidden">
          <div className={cn("relative", product.soldOut && "opacity-75 grayscale-[30%]")}>
            <ProductImage src={img?.url} alt="" ratio={RATIO[c.imageRatio] ?? RATIO.portrait} className="sf-media rounded-[var(--store-card-radius)]" imgClassName="sf-img-main" sizes={sizes} priority={priority} />
            {c.showSecondImage && second && (
              <div className="pointer-events-none absolute inset-0 hidden sm:block">
                <ProductImage src={second.url} alt="" ratio="h-full" className="sf-media rounded-[var(--store-card-radius)] !bg-transparent" imgClassName="sf-img-second" sizes={sizes} />
              </div>
            )}
          </div>
        </Link>
        {badgeStack}
        {favorite && <div className="absolute right-2 top-2 z-10">{favorite}</div>}
        {canQuickAdd && (
          <div className="absolute bottom-2.5 right-2.5 z-10">
            <QuickAddButton slug={store.slug} line={line} label={store.copy.addLabel} variant="icon" />
          </div>
        )}
      </div>
      <div className="px-0.5 pt-3">
        {c.showVendor && product.vendor && <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">{product.vendor}</p>}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink sm:text-[15px]" style={{ fontFamily: "var(--store-font)", letterSpacing: "-0.01em", fontWeight: 500 }}>
          {titleLink}
        </h3>
        {product.rating && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
            <Stars value={product.rating.average} size="sm" />
            <span className="tabular" aria-hidden>
              ({product.rating.count})
            </span>
          </p>
        )}
        <PriceTag price={product.price} compareAt={product.compareAt} range={product.range} view={ctx.data.currency} itemKey={product.simple ? product.id : null} soldOut={product.soldOut} className="mt-1" />
        {swatches ? (
          <ul className="mt-2 flex items-center gap-1.5" aria-label={`${swatches.name} disponibles`}>
            {swatches.values.slice(0, 5).map((v) => (
              <li key={v.value} title={v.value} className="size-4 rounded-full ring-1 ring-inset ring-black/15" style={{ background: v.swatch ?? "var(--c-surface-2)" }}>
                <span className="sr-only">{v.value}</span>
              </li>
            ))}
            {swatches.values.length > 5 && <li className="text-xs text-ink-muted">+{swatches.values.length - 5}</li>}
          </ul>
        ) : (
          !product.soldOut && !product.simple && <p className="mt-0.5 text-xs text-ink-muted">{product.variantCount > 0 ? `${product.variantCount} choix disponibles` : "Options au choix"}</p>
        )}
      </div>
    </article>
  );
}

/** Grille de cartes selon le nombre de colonnes choisi (2 sur mobile, n sur ordinateur). */
export function gridClass(columns: string | number, layout: "grid" | "list" = "grid") {
  if (layout === "list") return "grid gap-3 md:grid-cols-2 md:gap-4";
  const n = Number(columns) || 4;
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[n] ?? "lg:grid-cols-4";
  return cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5", n >= 3 ? "sm:grid-cols-3" : "", lg);
}

export function gridSizes(columns: string | number) {
  const n = Number(columns) || 4;
  return `(max-width: 640px) calc(50vw - 22px), (max-width: 1024px) calc(${n >= 3 ? 33 : 50}vw - 24px), ${Math.round(1240 / n)}px`;
}
