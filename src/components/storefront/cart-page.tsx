"use client";

import { useCart } from "./cart-store";
import { CartExtras, CartFooter, CartLines, CartNote, EmptyCart, type CartConfig } from "./cart-contents";

/** Page panier (réglage « panier : page »). */
export function CartPage({ cfg, showNote }: { cfg: CartConfig; showNote: boolean }) {
  const cart = useCart(cfg.slug);
  if (!cart.hydrated) return <div className="h-64 animate-pulse-soft rounded-[var(--store-card-radius)] bg-surface ring-1 ring-line" aria-busy="true" aria-label="Chargement du panier" />;
  if (cart.lines.length === 0) return <EmptyCart href={`/s/${cfg.slug}`} />;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12">
      <div className="min-w-0 space-y-6">
        <div className="rounded-[var(--store-card-radius)] bg-surface px-5 ring-1 ring-line sm:px-6">
          <CartLines cfg={cfg} />
        </div>
        <CartExtras cfg={cfg} />
      </div>
      <aside className="space-y-5 rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6 lg:sticky lg:top-24" aria-label="Récapitulatif">
        {showNote && <CartNote slug={cfg.slug} />}
        <CartFooter cfg={cfg} />
      </aside>
    </div>
  );
}
