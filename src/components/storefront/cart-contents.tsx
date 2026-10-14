"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift, Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { chargeNotice, storeCurrencyView, viewCurrency, viewPlain, viewPlainMoney, viewPrice, type CurrencyView } from "@/lib/storefront/currency-view";
import { cn } from "@/lib/utils";
import { readCartNote, useCart, writeCartNote } from "./cart-store";
import { ProductImage } from "./product-image";
import type { CartTier } from "@/lib/storefront/render-types";
import { TierProgress } from "./promotions/tier-progress";
import { CartOffers } from "./promotions/offer-list";
import { CartGiftCardField } from "./promotions/cart-gift-card-field";

export type CartConfig = {
  slug: string;
  /** Devise de calcul et d'encaissement (jamais convertie). */
  currency: string;
  /** Lot 2 (devises) : devise d'affichage de l'acheteur ; absente = devise boutique. */
  view?: CurrencyView | null;
  closed: boolean;
  ctaLabel: string;
  freeShippingFrom: number | null;
  showFreeShipping: boolean;
  showNote: boolean;
  loyaltyPer1000: number | null;
  /** Lot 1 : réglages de la section « Panier » (appliqués aussi au tiroir) et données de promotions. */
  showOffers?: boolean;
  showTierProgress?: boolean;
  showGiftCardField?: boolean;
  tiers?: CartTier[];
  giftCardsEnabled?: boolean;
  cartOffersEnabled?: boolean;
};

export function FreeShippingBar({ total, from, currency, view }: { total: number; from: number; currency: string; view?: CurrencyView | null }) {
  const pct = Math.min(100, Math.round((total / from) * 100));
  const left = from - total;
  // Seuil évalué en devise boutique (règle commerciale), affiché dans la devise choisie.
  const shown = view ?? storeCurrencyView(currency);
  return (
    <div className="rounded-[14px] bg-surface-2 px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-ink">
        <Truck className="size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />
        {left > 0 ? (
          <span>
            Plus que <strong className="tabular">{viewPlainMoney(shown, left)}</strong> pour la livraison offerte
          </span>
        ) : (
          <span className="font-medium">Livraison offerte débloquée (selon la zone)</span>
        )}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Progression vers la livraison offerte" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-[var(--store-primary)] transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Lignes du panier (tiroir et page panier). Montants indicatifs : le serveur recalcule à la commande. */
export function CartLines({ cfg, onNavigate }: { cfg: CartConfig; onNavigate?: () => void }) {
  const cart = useCart(cfg.slug);
  const view = cfg.view ?? storeCurrencyView(cfg.currency);
  // Prix unitaire converti (prix fixé de la devise pour l'article s'il existe), puis multiplié par la quantité.
  const unit = (l: { productId: string; variantId: string | null; snapshot: { unitPrice: number } }) => viewPrice(view, l.snapshot.unitPrice, l.variantId ?? l.productId);
  return (
    <ul className="divide-y divide-line">
      {cart.lines.map((l) => (
        <li key={l.key} className="flex gap-3.5 py-4">
          <Link href={`/s/${cfg.slug}/p/${l.snapshot.productSlug}`} onClick={onNavigate} className="w-[76px] shrink-0" tabIndex={-1} aria-hidden>
            <ProductImage src={l.snapshot.image} alt="" ratio="aspect-[4/5]" className="rounded-[12px]" sizes="76px" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/s/${cfg.slug}/p/${l.snapshot.productSlug}`} onClick={onNavigate} className="line-clamp-2 text-[15px] font-medium leading-snug text-ink hover:underline">
                {l.snapshot.name}
              </Link>
              <span className="shrink-0 text-[15px] font-semibold tabular text-ink">{formatMoney(unit(l) * l.quantity, viewCurrency(view))}</span>
            </div>
            {(!!l.snapshot.variantName || (l.snapshot.optionNames?.length ?? 0) > 0) && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{[l.snapshot.variantName, ...(l.snapshot.optionNames ?? [])].filter(Boolean).join(", ")}</p>}
            {l.giftCard && (l.giftCard.recipientName || l.giftCard.recipientPhone || l.giftCard.recipientEmail) && (
              <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">Pour {l.giftCard.recipientName || l.giftCard.recipientEmail || l.giftCard.recipientPhone}</p>
            )}
            {l.quantity > 1 && <p className="text-xs tabular text-ink-muted">{formatMoney(unit(l), viewCurrency(view))} l&apos;unité</p>}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <div className="inline-flex items-center rounded-full bg-surface-2 ring-1 ring-inset ring-line" role="group" aria-label={`Quantité de ${l.snapshot.name}`}>
                <button type="button" aria-label="Diminuer la quantité" onClick={() => cart.setQuantity(l.key, l.quantity - 1)} className="inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-line/60 active:scale-95">
                  <Minus className="size-4" aria-hidden />
                </button>
                <span className="min-w-7 text-center text-sm font-semibold tabular" aria-live="polite">
                  {l.quantity}
                </span>
                <button type="button" aria-label="Augmenter la quantité" onClick={() => cart.setQuantity(l.key, l.quantity + 1)} className="inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-line/60 active:scale-95">
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
              <button type="button" aria-label={`Retirer ${l.snapshot.name}`} onClick={() => cart.remove(l.key)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CartNote({ slug }: { slug: string }) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(readCartNote(slug)), [slug]);
  return (
    <div>
      <label htmlFor="cart-note" className="mb-1.5 block text-sm font-medium text-ink">
        Note pour la boutique (facultatif)
      </label>
      <textarea
        id="cart-note"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          writeCartNote(slug, e.target.value);
        }}
        placeholder="Précision, allergie, message…"
        className="sf-input h-auto min-h-20 py-3"
      />
    </div>
  );
}

/** Pied du panier : sous-total, livraison offerte, fidélité, bouton de commande. */
export function CartFooter({ cfg, onNavigate }: { cfg: CartConfig; onNavigate?: () => void }) {
  const cart = useCart(cfg.slug);
  const points = cfg.loyaltyPer1000 ? Math.floor(cart.total / 1000) * cfg.loyaltyPer1000 : 0;
  const view = cfg.view ?? storeCurrencyView(cfg.currency);
  // Sous-total indicatif : total du panier local (devise boutique) converti pour l'affichage.
  const total = formatMoney(viewPlain(view, cart.total), viewCurrency(view));
  const notice = chargeNotice(view);
  return (
    <div className="space-y-3">
      {cfg.showTierProgress !== false && cfg.tiers && cfg.tiers.length > 0 && <TierProgress slug={cfg.slug} tiers={cfg.tiers} currency={cfg.currency} view={view} />}
      {cfg.showFreeShipping && cfg.freeShippingFrom ? <FreeShippingBar total={cart.total} from={cfg.freeShippingFrom} currency={cfg.currency} view={view} /> : null}
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-muted">Sous-total</span>
        <span className="text-lg font-semibold tabular text-ink">{total}</span>
      </div>
      <p className="-mt-2 text-xs text-ink-muted">Livraison et remises calculées à l&apos;étape suivante.</p>
      {notice && <p className="-mt-1 text-xs text-ink-muted">{notice}</p>}
      {points > 0 && (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <Gift className="size-4 text-[var(--store-primary)]" aria-hidden /> {points} point{points > 1 ? "s" : ""} de fidélité avec cette commande
        </p>
      )}
      {cfg.closed ? (
        <p className="rounded-[12px] bg-warning-soft px-3 py-2.5 text-sm text-warning">La boutique est temporairement fermée : les commandes sont suspendues.</p>
      ) : (
        <Link href={`/s/${cfg.slug}/commander`} onClick={onNavigate} className="sf-btn sf-btn-solid h-14 w-full text-base">
          {cfg.ctaLabel} · {total}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export function EmptyCart({ onContinue, href }: { onContinue?: () => void; href?: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-[var(--store-primary)]">
        <ShoppingBag className="size-6" aria-hidden />
      </span>
      <p className="text-base font-semibold text-ink">Votre panier est vide</p>
      <p className="mt-1 max-w-[30ch] text-sm text-ink-muted">Parcourez la boutique et ajoutez vos articles préférés.</p>
      {href ? (
        <Link href={href} className={cn("sf-btn sf-btn-solid mt-6 h-12 px-6 text-sm")}>
          Continuer mes achats
        </Link>
      ) : (
        <button type="button" onClick={onContinue} className="sf-btn sf-btn-solid mt-6 h-12 px-6 text-sm">
          Continuer mes achats
        </button>
      )}
    </div>
  );
}

/** Lot 1 : offres au panier et champ carte cadeau (page panier et tiroir), selon les réglages de la section « Panier ». */
export function CartExtras({ cfg, onNavigate }: { cfg: CartConfig; onNavigate?: () => void }) {
  const offers = cfg.showOffers !== false && cfg.cartOffersEnabled;
  const gift = cfg.showGiftCardField === true && cfg.giftCardsEnabled;
  if (!offers && !gift) return null;
  return (
    <div className="space-y-4">
      {gift && <CartGiftCardField slug={cfg.slug} currency={cfg.currency} />}
      {offers && <CartOffers slug={cfg.slug} currency={cfg.currency} view={cfg.view} onNavigate={onNavigate} />}
    </div>
  );
}
