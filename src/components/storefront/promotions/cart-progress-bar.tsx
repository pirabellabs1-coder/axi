"use client";

import type { CartTier } from "@/lib/storefront/render-types";
import { TierProgress, useMerchSubtotal } from "./tier-progress";

/** Îlot client de la section « Barre d'offres » : peut se masquer tant que le panier est vide. */
export function CartProgressBar({ slug, tiers, currency, view, emptyText, hideWhenEmpty }: { slug: string; tiers: CartTier[]; currency: string; view?: import("@/lib/storefront/currency-view").CurrencyView | null; emptyText?: string; hideWhenEmpty?: boolean }) {
  const { hydrated, count } = useMerchSubtotal(slug);
  if (hideWhenEmpty && (!hydrated || count === 0)) return null;
  return <TierProgress slug={slug} tiers={tiers} currency={currency} view={view} emptyText={emptyText} className="bg-surface ring-1 ring-line" />;
}
