import { formatMoney } from "@/lib/money";
import type { DiscountTarget, DiscountValue, ParsedDiscount } from "./schema";

/**
 * Résumé en phrase et statut calculé des remises automatiques (spécification lot 1 §2 « Parcours commerçant »).
 * Fonctions pures, partagées client / serveur (aperçu en direct dans le formulaire), testées.
 */

export type DiscountStatus = "active" | "scheduled" | "expired" | "exhausted" | "inactive";

export const STATUS_LABELS: Record<DiscountStatus, string> = {
  active: "Active",
  scheduled: "Programmée",
  expired: "Expirée",
  exhausted: "Épuisée",
  inactive: "Désactivée",
};

export function discountStatus(d: { active: boolean; startsAt?: Date | string | null; endsAt?: Date | string | null; maxUses?: number | null; usesCount?: number }, now = new Date()): DiscountStatus {
  const t = now.getTime();
  const at = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).getTime());
  if (!d.active) return "inactive";
  const end = at(d.endsAt);
  if (end != null && end < t) return "expired";
  if (d.maxUses != null && (d.usesCount ?? 0) >= d.maxUses) return "exhausted";
  const start = at(d.startsAt);
  if (start != null && start > t) return "scheduled";
  return "active";
}

export type NameLookup = { currency: string; productName?: (id: string) => string | undefined; collectionName?: (id: string) => string | undefined; timeZone?: string };

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.slice(0, 2).join(", ")} et ${names.length - 2} autres`;
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

function targetPhrase(t: DiscountTarget | undefined, n: NameLookup, plural = true): string {
  if (!t || "all" in t) return plural ? "articles" : "article";
  if ("productIds" in t) {
    const names = t.productIds.map((id) => n.productName?.(id) ?? "produit retiré");
    return t.productIds.length === 1 ? `« ${names[0]} »` : `produits ${list(names.map((x) => `« ${x} »`))}`;
  }
  const names = t.collectionIds.map((id) => n.collectionName?.(id) ?? "collection retirée");
  return `${plural ? "articles" : "article"} de ${t.collectionIds.length > 1 ? "les collections" : "la collection"} ${list(names)}`.replace("de les", "des");
}

function valuePhrase(v: DiscountValue, currency: string): string {
  return v.type === "PERCENT" ? `−${v.amount} %` : `−${formatMoney(v.amount, currency)}`;
}

function dayLabel(d: Date, tz: string | undefined, withYear: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), ...(tz ? { timeZone: tz } : {}) };
  let s: string;
  try {
    s = new Intl.DateTimeFormat("fr-FR", opts).format(d);
  } catch {
    s = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }).format(d);
  }
  return s.replace(/^1 /, "1er ");
}

/** « du 1er au 30 novembre », « à partir du 3 décembre », « jusqu'au 31 janvier », « » (sans dates). */
export function periodPhrase(startsAt: Date | string | null | undefined, endsAt: Date | string | null | undefined, tz?: string): string {
  const s = startsAt ? new Date(startsAt) : null;
  const e = endsAt ? new Date(endsAt) : null;
  if (s && e) {
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
    const sameMonth = sameYear && dayLabel(s, tz, false).split(" ").slice(1).join(" ") === dayLabel(e, tz, false).split(" ").slice(1).join(" ");
    const left = sameMonth ? dayLabel(s, tz, false).split(" ")[0] : dayLabel(s, tz, !sameYear);
    return `du ${left} au ${dayLabel(e, tz, !sameYear)}`;
  }
  if (s) return `à partir du ${dayLabel(s, tz, false)}`;
  if (e) return `jusqu'au ${dayLabel(e, tz, false)}`;
  return "";
}

/** Phrase lisible décrivant la remise (aperçu et liste). */
export function describeDiscount(d: ParsedDiscount, n: NameLookup, period?: { startsAt?: Date | string | null; endsAt?: Date | string | null }): string {
  const cur = n.currency;
  let s: string;
  switch (d.kind) {
    case "PRODUCT_AMOUNT": {
      const c = d.config;
      const v = c.value.type === "FIXED_AMOUNT" && c.perUnit ? `${valuePhrase(c.value, cur)} par article` : valuePhrase(c.value, cur);
      s = `${v} sur les ${targetPhrase(c.target, n)}`.replace("sur les « ", "sur « ");
      if (c.minQuantity && c.minQuantity > 1) s += ` dès ${c.minQuantity} articles`;
      if (c.requiresProductsInCart?.length) s += `, si ${list(c.requiresProductsInCart.map((id) => `« ${n.productName?.(id) ?? "produit retiré"} »`))} est au panier`;
      break;
    }
    case "BUY_X_GET_Y": {
      const c = d.config;
      const buy = "quantity" in c.buy ? `Pour ${c.buy.quantity} ${targetPhrase(c.buy.target, n, c.buy.quantity > 1)} achetés` : `Dès ${formatMoney(c.buy.minAmount, cur)} d'${targetPhrase(c.buy.target, n)} achetés`;
      const free = c.get.value.type === "PERCENT" && c.get.value.amount === 100;
      const getTarget = JSON.stringify(c.get.target) === JSON.stringify(c.buy.target) ? "" : ` parmi les ${targetPhrase(c.get.target, n)}`;
      const what = c.get.quantity === 1 ? `le moins cher${getTarget} est ${free ? "offert" : `à ${valuePhrase(c.get.value, cur)}`}` : `les ${c.get.quantity} moins chers${getTarget} sont ${free ? "offerts" : `à ${valuePhrase(c.get.value, cur)}`}`;
      s = `${buy}, ${what}`;
      if (c.maxApplicationsPerOrder > 1) s += ` (jusqu'à ${c.maxApplicationsPerOrder} fois par commande)`;
      break;
    }
    case "CART_TIER": {
      const c = d.config;
      const tiers = c.tiers.map((t) => `${t.value.type === "FREE_DELIVERY" ? "livraison offerte" : valuePhrase(t.value, cur)} dès ${formatMoney(t.minSubtotal, cur)}`);
      s = `${tiers.join(", ")}`;
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (c.target && !("all" in c.target)) s += ` d'${targetPhrase(c.target, n)}`;
      break;
    }
    case "BUNDLE": {
      const c = d.config;
      const items = c.items.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ""}« ${n.productName?.(i.productId) ?? "produit retiré"} »`);
      s = `Lot ${list(items)} ${c.price.type === "FIXED_PRICE" ? `à ${formatMoney(c.price.amount, cur)}` : `à −${c.price.amount} %`}`;
      if (c.maxSets > 1) s += ` (jusqu'à ${c.maxSets} lots par commande)`;
      break;
    }
  }
  const p = period ? periodPhrase(period.startsAt, period.endsAt, n.timeZone) : "";
  return p ? `${s}, ${p}.` : `${s}.`;
}
