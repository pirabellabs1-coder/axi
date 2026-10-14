"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, Loader2, Plus } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { storeCurrencyView, viewCompareAt, viewCurrency, viewPrice, type CurrencyView } from "@/lib/storefront/currency-view";
import { cn } from "@/lib/utils";
import { loadCartOffers, resolveOfferUpgrade } from "@/lib/storefront/offer-actions";
import type { OfferCard } from "@/lib/storefront/render-types";
import { cartActions, recordOfferAttribution, useCart } from "../cart-store";
import { ProductImage } from "../product-image";

/**
 * Produits proposés par les offres au panier (ventes croisées « add », montées en gamme « replace »).
 *  - vente croisée, produit simple : ajout en un clic (sans ouvrir le tiroir) ;
 *  - vente croisée, produit à variantes / options : ouverture de la fiche (l'acheteur choisit ses options) ;
 *  - montée en gamme : la ligne déclencheuse du panier est remplacée par le produit proposé, avec les mêmes valeurs
 *    d'options (par nom) quand elles existent (`resolveOfferUpgrade`) ; sinon, ou si aucun article du panier ne
 *    déclenche l'offre, la fiche du produit proposé s'ouvre.
 * Dans tous les cas, l'offre est mémorisée pour l'attribution de la commande (`recordOfferAttribution`).
 */
export function OfferList({ slug, currency, view, offers, heading, layout = "row", onNavigate }: { slug: string; currency: string; /** Devise d'affichage (lot 2) ; absente = devise boutique. */ view?: CurrencyView | null; offers: OfferCard[]; heading?: string; layout?: "row" | "grid"; onNavigate?: () => void }) {
  const shown = view ?? storeCurrencyView(currency);
  const router = useRouter();
  const cart = useCart(slug);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (speakTimer.current) clearTimeout(speakTimer.current);
    },
    [],
  );

  /** Annonce : la zone est vidée puis remplie, pour qu'un message identique soit relu. */
  const speak = (message: string) => {
    setAnnounce("");
    if (speakTimer.current) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => setAnnounce(message), 60);
  };

  // Zone d'annonce à position stable (toujours rendue, avant la liste) : le message reste lu même si la liste se
  // vide, par exemple quand l'offre disparaît après la montée en gamme.
  const status = (
    <p className="sr-only" role="status" aria-live="polite">
      {announce}
    </p>
  );
  if (offers.length === 0) return <>{status}</>;

  const flash = (productId: string) => {
    setAdded(productId);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(null), 1600);
  };

  const add = (o: OfferCard) => {
    cartActions(slug).add(
      { productId: o.product.id, variantId: null, optionIds: [], quantity: Math.max(1, o.product.minQty), snapshot: { name: o.product.name, variantName: null, unitPrice: o.product.price, image: o.product.image, productSlug: o.product.slug } },
      { open: false },
    );
    recordOfferAttribution(slug, o.offerId);
    flash(o.product.id);
    speak(`${o.product.name} ajouté au panier.`);
  };

  const openProduct = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  const upgrade = async (o: OfferCard, href: string) => {
    if (pending) return;
    recordOfferAttribution(slug, o.offerId);
    const lines = cart.lines.filter((l) => !l.giftCard && !l.snapshot.isGiftCard).map((l) => ({ key: l.key, productId: l.productId, variantId: l.variantId, optionIds: l.optionIds, quantity: l.quantity }));
    if (lines.length === 0) return openProduct(href);
    setPending(o.product.id);
    try {
      const r = await resolveOfferUpgrade({ storeSlug: slug, offerId: o.offerId, productId: o.product.id, lines: lines.slice(0, 50) });
      if (r.kind === "replaced" && cartActions(slug).replace(r.key, r.line)) {
        flash(o.product.id);
        speak(`${r.fromName} remplacé par ${r.line.snapshot.name}${r.line.snapshot.variantName ? ` (${r.line.snapshot.variantName})` : ""}, même quantité, dans le panier.`);
        return;
      }
      openProduct(r.kind === "choose" && r.href ? r.href : href);
    } catch {
      openProduct(href);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
    {status}
    <section aria-label={heading || "Suggestions"} className="min-w-0">
      {heading && <h2 className="mb-3 text-[15px] font-semibold text-ink">{heading}</h2>}
      <ul className={cn(layout === "grid" ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2" : "space-y-2.5")}>
        {offers.map((o) => {
          const href = `/s/${slug}/p/${o.product.slug}`;
          const direct = o.mode === "add" && o.product.simple;
          const ok = added === o.product.id;
          return (
            <li key={`${o.offerId}-${o.product.id}`} className="flex items-center gap-3 rounded-[16px] bg-surface p-2.5 ring-1 ring-line">
              <Link href={href} onClick={() => { recordOfferAttribution(slug, o.offerId); onNavigate?.(); }} tabIndex={-1} aria-hidden className="w-14 shrink-0">
                <ProductImage src={o.product.image} alt="" ratio="aspect-square" className="rounded-[12px]" sizes="56px" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={href} onClick={() => { recordOfferAttribution(slug, o.offerId); onNavigate?.(); }} className="line-clamp-2 text-sm font-medium leading-snug text-ink hover:underline">
                  {o.product.name}
                </Link>
<OfferPrice product={o.product} view={shown} />
                {o.mode === "replace" && <p className="text-xs text-ink-muted">Version supérieure, remplace l’article du panier</p>}
              </div>
              {o.mode === "replace" ? (
                <button
                  type="button"
                  onClick={() => void upgrade(o, href)}
                  aria-disabled={pending !== null}
                  aria-busy={pending === o.product.id}
                  aria-label={ok ? `Remplacé par ${o.product.name}` : `Remplacer l’article du panier par ${o.product.name}`}
                  className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200 active:scale-95 aria-disabled:opacity-60 motion-reduce:transition-none", ok ? "bg-[#0f6b3f] text-white" : "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]")}
                >
                  {pending === o.product.id ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : ok ? <Check key="ok" className="sf-pop size-5" aria-hidden /> : <ArrowUpRight key="up" className="sf-pop size-5" aria-hidden />}
                </button>
              ) : direct ? (
                <button
                  type="button"
                  onClick={() => add(o)}
                  aria-label={ok ? `${o.product.name} ajouté` : `Ajouter ${o.product.name} au panier`}
                  className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200 active:scale-95 motion-reduce:transition-none", ok ? "bg-[#0f6b3f] text-white" : "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]")}
                >
                  {ok ? <Check key="ok" className="sf-pop size-5" aria-hidden /> : <Plus key="add" className="sf-pop size-5" aria-hidden />}
                </button>
              ) : (
                <Link
                  href={href}
                  onClick={() => { recordOfferAttribution(slug, o.offerId); onNavigate?.(); }}
                  aria-label={`Choisir les options de ${o.product.name}`}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2"
                >
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}

/** Offres au panier chargées pour le contenu du panier local (anti-rebond, réponses obsolètes ignorées). */
export function CartOffers({ slug, currency, view, placement = "CART", heading = "Vous aimerez aussi", onNavigate, layout }: { slug: string; currency: string; view?: CurrencyView | null; placement?: "CART" | "CHECKOUT"; heading?: string; onNavigate?: () => void; layout?: "row" | "grid" }) {
  const cart = useCart(slug);
  const ids = [...new Set(cart.lines.map((l) => l.productId))].sort();
  const key = ids.join(",");
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!cart.hydrated || !key) return;
    const t = setTimeout(() => {
      const n = ++seq.current;
      loadCartOffers({ storeSlug: slug, placement, productIds: key.split(",") })
        .then((r) => n === seq.current && setOffers(r))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [key, cart.hydrated, slug, placement]);
  // Panier vide : aucune suggestion (pas de réinitialisation d'état dans l'effet).
  return <OfferList slug={slug} currency={currency} view={view} offers={key ? offers : []} heading={heading} onNavigate={onNavigate} layout={layout} />;
}

/** Prix d'un produit proposé, converti dans la devise d'affichage (le prix fixé de la devise s'applique s'il existe). */
function OfferPrice({ product, view }: { product: OfferCard["product"]; view?: CurrencyView | null }) {
  const price = viewPrice(view, product.price, product.simple ? product.id : null);
  const compareAt = viewCompareAt(view, product.compareAt, price, product.simple ? product.id : null);
  const cur = viewCurrency(view);
  return (
    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm tabular">
      <span className="font-semibold text-ink">
        {compareAt != null && <span className="sr-only">Prix réduit : </span>}
        {formatMoney(price, cur)}
      </span>
      {compareAt != null && (
        <s className="text-xs text-ink-muted">
          <span className="sr-only">au lieu de </span>
          {formatMoney(compareAt, cur)}
        </s>
      )}
    </p>
  );
}
