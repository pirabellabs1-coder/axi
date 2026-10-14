"use client";

import { BadgePercent, Check } from "lucide-react";
import { storeCurrencyView, viewPlainMoney, type CurrencyView } from "@/lib/storefront/currency-view";
import { cn } from "@/lib/utils";
import type { CartTier } from "@/lib/storefront/render-types";
import { useCart } from "../cart-store";

/** Sous-total indicatif hors cartes cadeaux (jamais éligibles aux remises). */
export function useMerchSubtotal(slug: string) {
  const cart = useCart(slug);
  return { hydrated: cart.hydrated, count: cart.count, subtotal: cart.lines.reduce((s, l) => (l.snapshot.isGiftCard ? s : s + l.snapshot.unitPrice * l.quantity), 0) };
}

/** Palier suivant et palier atteint pour un sous-total (fonction pure, testée). */
export function tierState(tiers: readonly CartTier[], subtotal: number): { reached: CartTier | null; next: CartTier | null; pct: number } {
  const sorted = [...tiers].sort((a, b) => a.minSubtotal - b.minSubtotal);
  let reached: CartTier | null = null;
  for (const t of sorted) if (subtotal >= t.minSubtotal) reached = t;
  const next = sorted.find((t) => subtotal < t.minSubtotal) ?? null;
  const floor = reached?.minSubtotal ?? 0;
  const pct = next ? Math.max(0, Math.min(100, Math.round(((subtotal - floor) / Math.max(1, next.minSubtotal - floor)) * 100))) : 100;
  return { reached, next, pct };
}

/**
 * Progression vers les paliers de remise (CART_TIER). Indicatif : le meilleur palier atteint est appliqué
 * par le serveur au checkout (sous-total net après remises de ligne). Barre animée en `transform` uniquement.
 */
export function TierProgress({ slug, tiers, currency, view, className, emptyText, tone = "default" }: { slug: string; tiers: CartTier[]; currency: string; /** Devise d'affichage (lot 2) ; absente = devise boutique. */ view?: CurrencyView | null; className?: string; emptyText?: string; tone?: "default" | "plain" }) {
  const { hydrated, subtotal, count } = useMerchSubtotal(slug);
  const shown = view ?? storeCurrencyView(currency);
  // Les seuils et les remises en montant sont évalués en devise boutique, puis convertis pour l'affichage.
  const money = (amount: number) => viewPlainMoney(shown, amount);
  const label = (t: CartTier) => (t.amountOff != null ? `−${money(t.amountOff)}` : t.label);
  if (tiers.length === 0) return null;
  const { reached, next, pct } = tierState(tiers, subtotal);
  const empty = !hydrated || count === 0;
  const message = empty ? (
    <span>{emptyText || `Dès ${money(tiers[0].minSubtotal)} d'achat : ${label(tiers[0])}.`}</span>
  ) : next ? (
    <span>
      Plus que <strong className="tabular">{money(next.minSubtotal - subtotal)}</strong> pour {label(next)}
      {reached ? <span className="text-ink-muted"> (déjà {label(reached)})</span> : null}
    </span>
  ) : (
    <span className="font-medium">Bravo, {reached ? label(reached) : null} sur votre panier.</span>
  );
  return (
    <div className={cn(tone === "default" && "rounded-[14px] bg-surface-2 px-4 py-3", className)}>
      <p className="flex items-start gap-2 text-sm text-ink" aria-live="polite">
        {!next && !empty ? <Check className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden /> : <BadgePercent className="mt-0.5 size-4 shrink-0 text-[var(--store-primary)]" aria-hidden />}
        {message}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Progression vers la prochaine remise" aria-valuemin={0} aria-valuemax={100} aria-valuenow={empty ? 0 : pct}>
        <div className="h-full w-full origin-left rounded-full bg-[var(--store-primary)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none" style={{ transform: `scaleX(${(empty ? 0 : pct) / 100})` }} />
      </div>
      {tiers.length > 1 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Paliers">
          {tiers.map((t) => {
            const ok = !empty && subtotal >= t.minSubtotal;
            return (
              <li key={`${t.minSubtotal}-${t.label}`} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs tabular ring-1 ring-inset", ok ? "bg-[var(--store-primary-soft)] text-ink ring-[var(--store-primary)]" : "text-ink-muted ring-line")}>
                {ok && <Check className="size-3" aria-hidden />}
                {label(t)} dès {money(t.minSubtotal)}
                {ok && <span className="sr-only"> (atteint)</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
