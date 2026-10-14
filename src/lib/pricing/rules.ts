/**
 * Règles pures du catalogue modifiable et des codes promo SaaS (testées dans tests/pricing-catalog.test.ts).
 * Les accès base de données vivent dans src/lib/pricing/catalog.ts et src/lib/pricing/coupons.ts.
 *
 * Montants en unités natives : EUR en centimes, XOF entier (src/lib/money.ts).
 */
import { ADD_ONS, PLANS, YEARLY_MONTHS_PAID, ZONE_CURRENCY, type Interval, type PlanId, type PricingZone } from "@/config/plans";

export type OverrideRow = { itemType: string; itemId: string; zone: string; amount: number; active: boolean; createdAt: Date };

/** Dernière surcharge ACTIVE pour un article et une zone, ou null (prix du catalogue statique). */
export function resolveOverride(rows: OverrideRow[], itemType: "plan" | "addon", itemId: string, zone: PricingZone): number | null {
  let best: OverrideRow | null = null;
  for (const r of rows) {
    if (!r.active || r.itemType !== itemType || r.itemId !== itemId || r.zone !== zone) continue;
    if (!best || r.createdAt.getTime() > best.createdAt.getTime()) best = r;
  }
  return best ? best.amount : null;
}

export function defaultPlanMonthly(planId: PlanId, zone: PricingZone): number | null {
  return PLANS[planId]?.price[zone] ?? null;
}

export function defaultAddOnPrice(addOnId: string, zone: PricingZone): number | null {
  return ADD_ONS.find((a) => a.id === addOnId)?.price[zone] ?? null;
}

/** Même règle que planPrice (src/config/plans.ts), appliquée à un prix mensuel quelconque. */
export function priceForInterval(monthly: number | null, zone: PricingZone, interval: Interval): { amount: number | null; currency: string; perMonth: number | null } {
  const currency = ZONE_CURRENCY[zone];
  if (monthly == null) return { amount: null, currency, perMonth: null };
  if (interval === "YEARLY") {
    const amount = monthly * YEARLY_MONTHS_PAID;
    return { amount, currency, perMonth: Math.round(amount / 12) };
  }
  return { amount: monthly, currency, perMonth: monthly };
}

/** Bornes raisonnables d'un prix saisi (protège d'une faute de frappe à 3 zéros près). */
export function validatePriceAmount(amount: number, zone: PricingZone): string | null {
  if (!Number.isInteger(amount) || amount < 0) return "Montant invalide.";
  const max = zone === "AFRICA" ? 10_000_000 : 10_000_000; // 10 M FCFA ou 100 000 €
  if (amount > max) return "Montant trop élevé.";
  return null;
}

/* ───────────────────────── Codes promo SaaS ───────────────────────── */

export type CouponLike = {
  id: string;
  code: string;
  percentOff: number | null;
  amountOff: number | null;
  zone: string | null;
  plans: string[];
  durationMonths: number;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  active: boolean;
};

export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeCouponCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
}

export type CouponCheck = { ok: true } | { ok: false; error: string };

/**
 * Le code est-il applicable à cette facture de plan ?
 * `alreadyRedeemed` : la boutique a déjà utilisé ce code (un code = une fois par boutique).
 */
export function couponEligibility(
  c: CouponLike,
  ctx: { zone: PricingZone; planId: PlanId; now?: Date; alreadyRedeemed?: boolean; countRedemption?: boolean },
): CouponCheck {
  const now = ctx.now ?? new Date();
  if (!c.active) return { ok: false, error: "Ce code promo n'est plus actif." };
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "Ce code promo a expiré." };
  if (ctx.countRedemption !== false && c.maxRedemptions != null && c.redemptions >= c.maxRedemptions) return { ok: false, error: "Ce code promo a atteint sa limite d'utilisation." };
  if (c.zone && c.zone !== ctx.zone) return { ok: false, error: "Ce code promo n'est pas valable dans votre zone tarifaire." };
  if (ctx.planId === "FREE") return { ok: false, error: "Un code promo s'applique à un plan payant." };
  if (c.plans.length > 0 && !c.plans.includes(ctx.planId)) return { ok: false, error: "Ce code promo n'est pas valable pour ce plan." };
  if (ctx.alreadyRedeemed) return { ok: false, error: "Vous avez déjà utilisé ce code promo." };
  if ((c.percentOff ?? 0) <= 0 && (c.amountOff ?? 0) <= 0) return { ok: false, error: "Ce code promo n'accorde aucune remise." };
  return { ok: true };
}

/**
 * Remise en unités natives sur un montant brut : pourcentage arrondi à l'unité inférieure
 * (jamais plus que le brut), ou montant fixe plafonné au brut. Le pourcentage prime s'il est défini.
 */
export function couponDiscount(c: Pick<CouponLike, "percentOff" | "amountOff">, gross: number): number {
  if (gross <= 0) return 0;
  if (c.percentOff != null && c.percentOff > 0) {
    const pct = Math.min(100, Math.max(0, Math.trunc(c.percentOff)));
    return Math.min(gross, Math.floor((gross * pct) / 100));
  }
  if (c.amountOff != null && c.amountOff > 0) return Math.min(gross, Math.trunc(c.amountOff));
  return 0;
}

/** La remise s'applique-t-elle encore (nombre de factures déjà remisées < durée) ? */
export function couponStillApplies(durationMonths: number, invoicesDiscounted: number): boolean {
  return invoicesDiscounted < Math.max(1, durationMonths);
}

/** Libellé court d'une remise (« -20 % pendant 3 mois », « -5,00 € »). */
export function couponLabel(c: Pick<CouponLike, "percentOff" | "amountOff" | "durationMonths" | "zone">, formatAmount: (amount: number, currency: string) => string): string {
  const value = c.percentOff ? `-${c.percentOff} %` : c.amountOff ? `-${formatAmount(c.amountOff, c.zone === "AFRICA" ? "XOF" : "EUR")}` : "aucune remise";
  return c.durationMonths > 1 ? `${value} sur ${c.durationMonths} factures` : `${value} sur 1 facture`;
}
