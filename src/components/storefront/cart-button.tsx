"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart-store";

/** Bouton panier : ouvre le tiroir (ou mène à la page panier). Le compteur « rebondit » à chaque ajout. */
export function CartButton({ slug, mode = "drawer" }: { slug: string; mode?: "drawer" | "page" }) {
  const cart = useCart(slug);
  const prev = useRef<number | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (!cart.hydrated) return;
    if (prev.current !== null && cart.count > prev.current) setBump((b) => b + 1);
    prev.current = cart.count;
  }, [cart.count, cart.hydrated]);

  const label = cart.count > 0 ? `Panier, ${cart.count} article${cart.count > 1 ? "s" : ""}` : "Panier vide";
  const cls = "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-[transform,background-color] duration-150 ease-out hover:bg-surface-2 active:scale-[0.94]";
  const inner = (
    <>
      <ShoppingBag className="size-[22px]" aria-hidden />
      {cart.count > 0 && (
        <span key={bump} aria-hidden className={`absolute right-0.5 top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--store-primary)] px-1 text-[11px] font-semibold tabular text-[var(--store-primary-contrast)] ring-2 ring-surface ${bump ? "sf-bump" : ""}`}>
          {cart.count > 99 ? "99+" : cart.count}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {bump ? label : ""}
      </span>
    </>
  );
  return mode === "page" ? (
    <Link href={`/s/${slug}/panier`} aria-label={label} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={cart.openSheet} aria-label={label} className={cls}>
      {inner}
    </button>
  );
}
