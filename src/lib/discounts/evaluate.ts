import { allocateProRata } from "@/lib/commerce/allocation";
import { formatMoney } from "@/lib/money";
import type { BundleConfig, BuyXGetYConfig, CartTierConfig, DiscountKind, DiscountTarget, DiscountValue, ParsedDiscount, ProductAmountConfig } from "./schema";

/**
 * Évaluation des remises automatiques (spécification lot 1, §0.2 étapes 2 et 3, §0.3, §2).
 * Fonctions pures et déterministes, testées (tests/discounts-evaluate.test.ts).
 *
 * Remises de ligne (PRODUCT_AMOUNT, BUY_X_GET_Y, BUNDLE) :
 *  - une unité reçoit au plus UNE remise automatique de ligne : chaque remise appliquée « consomme » les unités
 *    qu'elle utilise (achetées ou offertes) ;
 *  - ordre : `priority` décroissante, puis économie estimée décroissante (panier vierge), puis `id` ;
 *  - les lignes carte cadeau ne sont jamais éligibles ; `excludeOnSale` (défaut vrai) exclut les unités en promo datée ;
 *  - une référence disparue (produit, collection, variante) ne correspond simplement à aucune unité.
 * Remise de panier (CART_TIER) : une seule, la plus avantageuse atteinte, sur le net après les remises de ligne.
 */

export type EvalLine = {
  productId: string;
  variantId?: string | null;
  unitPrice: number;
  quantity: number;
  collectionIds: readonly string[];
  isGiftCard: boolean;
  /** Prix unitaire issu d'une promo datée (effectivePrice.isPromo). */
  onSale: boolean;
};

export type EvalDiscount = {
  id: string;
  title: string;
  kind: DiscountKind;
  priority: number;
  combinesWithCoupons: boolean;
  combinesWithOtherAutomatic: boolean;
  parsed: ParsedDiscount;
};

export type PipelineMessage = {
  code: "tier_progress" | "bxgy_progress" | "min_quantity_progress" | "coupon_not_combinable" | "loyalty_capped";
  text: string;
  discountId?: string;
  /** Montant ou nombre d'articles manquants (progression). */
  remaining?: number;
};

export type AppliedLineDiscount = {
  discount: EvalDiscount;
  amount: number;
  /** Montant par ligne (même longueur que `lines`). */
  perLine: number[];
  /** Nombre d'applications (X achetés = Y offerts, lots). */
  applications: number;
};

export type AppliedCartTier = {
  discount: EvalDiscount;
  amount: number;
  perLine: number[];
  freeDelivery: boolean;
  tierIndex: number;
};

type Unit = { idx: number; line: number; price: number };

/* ─────────────────────────── Utilitaires ─────────────────────────── */

export function matchesTarget(target: DiscountTarget | undefined, line: Pick<EvalLine, "productId" | "collectionIds">): boolean {
  if (!target) return true;
  if ("all" in target) return true;
  if ("productIds" in target) return target.productIds.includes(line.productId);
  return target.collectionIds.some((c) => line.collectionIds.includes(c));
}

function sameTarget(a: DiscountTarget, b: DiscountTarget): boolean {
  if ("all" in a || "all" in b) return "all" in a && "all" in b;
  const ka = "productIds" in a ? ["p", ...[...a.productIds].sort()] : ["c", ...[...a.collectionIds].sort()];
  const kb = "productIds" in b ? ["p", ...[...b.productIds].sort()] : ["c", ...[...b.collectionIds].sort()];
  return ka.join("|") === kb.join("|");
}

function expandUnits(lines: readonly EvalLine[]): Unit[] {
  const units: Unit[] = [];
  lines.forEach((l, line) => {
    const q = Math.max(0, Math.floor(l.quantity));
    for (let k = 0; k < q; k++) units.push({ idx: units.length, line, price: Math.max(0, l.unitPrice) });
  });
  return units;
}

const byPriceAsc = (a: Unit, b: Unit) => a.price - b.price || a.idx - b.idx;
const byPriceDesc = (a: Unit, b: Unit) => b.price - a.price || a.idx - b.idx;

function unitValue(value: DiscountValue, price: number): number {
  if (value.type === "PERCENT") return Math.min(price, Math.round((price * Math.min(100, Math.max(0, value.amount))) / 100));
  return Math.min(price, Math.max(0, value.amount));
}

function eligibleFor(line: EvalLine, excludeOnSale: boolean): boolean {
  return !line.isGiftCard && !(excludeOnSale && line.onSale);
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/* ─────────────────────── Remises de ligne (étape 2) ─────────────────────── */

type OneResult = { amount: number; perLine: number[]; used: number[]; applications: number };

function evalProductAmount(c: ProductAmountConfig, lines: readonly EvalLine[], units: Unit[], free: (u: Unit) => boolean): OneResult | null {
  if (c.requiresProductsInCart?.length && !lines.some((l) => !l.isGiftCard && c.requiresProductsInCart!.includes(l.productId))) return null;
  const eligible = units.filter((u) => free(u) && eligibleFor(lines[u.line], c.excludeOnSale) && matchesTarget(c.target, lines[u.line]));
  if (eligible.length === 0) return null;
  if (c.minQuantity && eligible.length < c.minQuantity) return null;
  const perLine = new Array<number>(lines.length).fill(0);
  const weights = new Array<number>(lines.length).fill(0);
  for (const u of eligible) weights[u.line] += u.price;
  const base = weights.reduce((s, x) => s + x, 0);
  if (c.value.type === "FIXED_AMOUNT" && c.perUnit) {
    for (const u of eligible) perLine[u.line] += unitValue(c.value, u.price);
  } else {
    const amount = c.value.type === "PERCENT" ? Math.min(base, Math.round((base * c.value.amount) / 100)) : Math.min(base, c.value.amount);
    allocateProRata(amount, weights).forEach((x, i) => (perLine[i] += x));
  }
  const amount = perLine.reduce((s, x) => s + x, 0);
  if (amount <= 0) return null;
  return { amount, perLine, used: eligible.map((u) => u.idx), applications: 1 };
}

function evalBuyXGetY(c: BuyXGetYConfig, lines: readonly EvalLine[], units: Unit[], free: (u: Unit) => boolean): OneResult | null {
  const perLine = new Array<number>(lines.length).fill(0);
  const taken = new Set<number>();
  const used: number[] = [];
  let applications = 0;
  const ok = (u: Unit) => free(u) && !taken.has(u.idx) && eligibleFor(lines[u.line], c.excludeOnSale);
  const getEligible = (u: Unit) => matchesTarget(c.get.target, lines[u.line]);

  while (applications < c.maxApplicationsPerOrder) {
    // Unités « achetées » : d'abord celles qui ne peuvent pas être offertes, puis les plus chères
    // (les moins chères restent disponibles pour être offertes).
    const buyPool = units
      .filter((u) => ok(u) && matchesTarget(c.buy.target, lines[u.line]))
      .sort((a, b) => Number(getEligible(a)) - Number(getEligible(b)) || byPriceDesc(a, b));
    const buy: Unit[] = [];
    if ("quantity" in c.buy) {
      if (buyPool.length < c.buy.quantity) break;
      buy.push(...buyPool.slice(0, c.buy.quantity));
    } else {
      let sum = 0;
      for (const u of buyPool) {
        if (sum >= c.buy.minAmount) break;
        buy.push(u);
        sum += u.price;
      }
      if (sum < c.buy.minAmount) break;
    }
    const buyIds = new Set(buy.map((u) => u.idx));
    // Unités offertes : les moins chères parmi les unités « get » éligibles restantes.
    const getPool = units.filter((u) => ok(u) && !buyIds.has(u.idx) && getEligible(u)).sort(byPriceAsc);
    if (getPool.length < c.get.quantity) break;
    const get = getPool.slice(0, c.get.quantity);
    let gained = 0;
    for (const u of get) {
      const v = unitValue(c.get.value, u.price);
      perLine[u.line] += v;
      gained += v;
    }
    if (gained <= 0) break;
    for (const u of [...buy, ...get]) {
      taken.add(u.idx);
      used.push(u.idx);
    }
    applications++;
  }
  const amount = perLine.reduce((s, x) => s + x, 0);
  if (applications === 0 || amount <= 0) return null;
  return { amount, perLine, used, applications };
}

function evalBundle(c: BundleConfig, lines: readonly EvalLine[], units: Unit[], free: (u: Unit) => boolean): OneResult | null {
  const perLine = new Array<number>(lines.length).fill(0);
  const taken = new Set<number>();
  const used: number[] = [];
  let applications = 0;
  while (applications < c.maxSets) {
    const set: Unit[] = [];
    let complete = true;
    // Articles à variante précise servis d'abord : un article générique (sans variante) ne « vole » jamais
    // l'unité d'une variante exigée par un autre article du lot.
    for (const item of [...c.items].sort((x, y) => Number(!x.variantId) - Number(!y.variantId))) {
      const pool = units
        .filter((u) => {
          const l = lines[u.line];
          return free(u) && !taken.has(u.idx) && !set.some((s) => s.idx === u.idx) && eligibleFor(l, c.excludeOnSale) && l.productId === item.productId && (!item.variantId || l.variantId === item.variantId);
        })
        .sort(byPriceDesc);
      if (pool.length < item.quantity) {
        complete = false;
        break;
      }
      set.push(...pool.slice(0, item.quantity));
    }
    if (!complete) break;
    const sum = set.reduce((s, u) => s + u.price, 0);
    const discount = c.price.type === "FIXED_PRICE" ? sum - c.price.amount : Math.min(sum, Math.round((sum * c.price.amount) / 100));
    if (discount <= 0) break;
    // Le prix du lot est réparti au plus fort reste sur ses unités (donc sur ses lignes).
    allocateProRata(discount, set.map((u) => u.price)).forEach((x, i) => (perLine[set[i].line] += x));
    for (const u of set) {
      taken.add(u.idx);
      used.push(u.idx);
    }
    applications++;
  }
  const amount = perLine.reduce((s, x) => s + x, 0);
  if (applications === 0 || amount <= 0) return null;
  return { amount, perLine, used, applications };
}

function evalOne(d: EvalDiscount, lines: readonly EvalLine[], units: Unit[], consumed: Uint8Array): OneResult | null {
  const free = (u: Unit) => consumed[u.idx] === 0;
  switch (d.parsed.kind) {
    case "PRODUCT_AMOUNT":
      return evalProductAmount(d.parsed.config, lines, units, free);
    case "BUY_X_GET_Y":
      return evalBuyXGetY(d.parsed.config, lines, units, free);
    case "BUNDLE":
      return evalBundle(d.parsed.config, lines, units, free);
    default:
      return null;
  }
}

export function isLineDiscount(d: Pick<EvalDiscount, "kind">): boolean {
  return d.kind === "PRODUCT_AMOUNT" || d.kind === "BUY_X_GET_Y" || d.kind === "BUNDLE";
}

/**
 * Étape 2 : remises automatiques de ligne. Renvoie les remises appliquées, dans l'ordre d'application.
 * Garanties : Σ perLine[i] ≤ prix brut de la ligne i ; une unité n'est utilisée que par une remise.
 */
export function evaluateLineDiscounts(lines: readonly EvalLine[], discounts: readonly EvalDiscount[]): AppliedLineDiscount[] {
  const candidates = discounts.filter((d) => isLineDiscount(d) && d.parsed.kind === d.kind);
  if (candidates.length === 0 || lines.length === 0) return [];
  const units = expandUnits(lines);
  const fresh = new Uint8Array(units.length);
  const estimate = new Map(candidates.map((d) => [d.id, evalOne(d, lines, units, fresh)?.amount ?? 0]));
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || (estimate.get(b.id) ?? 0) - (estimate.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const consumed = new Uint8Array(units.length);
  const applied: AppliedLineDiscount[] = [];
  for (const d of ordered) {
    const r = evalOne(d, lines, units, consumed);
    if (!r) continue;
    for (const i of r.used) consumed[i] = 1;
    applied.push({ discount: d, amount: r.amount, perLine: r.perLine, applications: r.applications });
  }
  return applied;
}

/* ─────────────────────── Remise de panier (étape 3) ─────────────────────── */

/**
 * Étape 3 : meilleur palier atteint parmi les remises CART_TIER, sur le net (après étape 2) des lignes
 * éligibles (hors cartes cadeaux, restreint à `target` si présent). `deliveryFee` sert à estimer la valeur
 * d'un palier « livraison offerte ». Une seule remise de panier est appliquée.
 */
export function evaluateCartTier(lines: readonly EvalLine[], lineNets: readonly number[], discounts: readonly EvalDiscount[], deliveryFee: number): AppliedCartTier | null {
  let best: AppliedCartTier | null = null;
  let bestSaving = -1;
  for (const d of discounts) {
    if (d.parsed.kind !== "CART_TIER") continue;
    const c: CartTierConfig = d.parsed.config;
    const weights = lines.map((l, i) => (!l.isGiftCard && matchesTarget(c.target, l) ? Math.max(0, lineNets[i]) : 0));
    const base = weights.reduce((s, x) => s + x, 0);
    if (base <= 0) continue;
    for (let tierIndex = 0; tierIndex < c.tiers.length; tierIndex++) {
      const tier = c.tiers[tierIndex];
      if (base < tier.minSubtotal) continue;
      let amount = 0;
      let freeDelivery = false;
      if (tier.value.type === "PERCENT") amount = Math.min(base, Math.round((base * tier.value.amount) / 100));
      else if (tier.value.type === "FIXED_AMOUNT") amount = Math.min(base, tier.value.amount);
      else freeDelivery = true;
      const saving = freeDelivery ? Math.max(0, deliveryFee) : amount;
      // Égalité : priorité la plus haute, puis palier le plus élevé de la même remise, sinon la première rencontrée.
      const better =
        !best ||
        saving > bestSaving ||
        (saving === bestSaving && (d.priority > best.discount.priority || (d.priority === best.discount.priority && d.id === best.discount.id && tierIndex > best.tierIndex)));
      if (better) {
        best = { discount: d, amount, perLine: allocateProRata(amount, weights), freeDelivery, tierIndex };
        bestSaving = saving;
      }
    }
  }
  return best;
}

/* ─────────────────────────── Progression ─────────────────────────── */

function tierLabel(v: CartTierConfig["tiers"][number]["value"], currency: string): string {
  if (v.type === "PERCENT") return `−${v.amount} %`;
  if (v.type === "FIXED_AMOUNT") return `−${formatMoney(v.amount, currency)}`;
  return "la livraison offerte";
}

/**
 * Messages de progression (« Plus que 3 000 FCFA pour −10 % », « Ajoutez 1 article… »), calculés sur le panier
 * brut pour les remises de ligne et sur le net après étape 2 pour les paliers. Uniquement si l'acheteur a
 * commencé à remplir les conditions (au moins une unité éligible) : jamais de bruit sur un panier sans rapport.
 */
export function progressMessages(lines: readonly EvalLine[], lineNets: readonly number[], discounts: readonly EvalDiscount[], applied: { lineIds: Set<string>; tier: AppliedCartTier | null }, currency: string): PipelineMessage[] {
  const out: PipelineMessage[] = [];
  const units = expandUnits(lines);
  for (const d of discounts) {
    const p = d.parsed;
    if (p.kind === "BUY_X_GET_Y" && !applied.lineIds.has(d.id) && "quantity" in p.config.buy) {
      const c = p.config;
      const buyQ = (c.buy as { quantity: number }).quantity;
      const ok = (u: Unit) => eligibleFor(lines[u.line], c.excludeOnSale);
      const nBuy = units.filter((u) => ok(u) && matchesTarget(c.buy.target, lines[u.line])).length;
      const nGet = units.filter((u) => ok(u) && matchesTarget(c.get.target, lines[u.line])).length;
      if (nBuy === 0) continue;
      const need = sameTarget(c.buy.target, c.get.target) ? buyQ + c.get.quantity - nBuy : Math.max(0, buyQ - nBuy) + Math.max(0, c.get.quantity - nGet);
      if (need <= 0) continue;
      const gift = c.get.value.type === "PERCENT" && c.get.value.amount === 100 ? plural(c.get.quantity, "offert") : `${plural(c.get.quantity, "article")} à prix réduit`;
      out.push({ code: "bxgy_progress", discountId: d.id, remaining: need, text: `« ${d.title} » : ajoutez ${plural(need, "article")} éligible${need > 1 ? "s" : ""} pour en recevoir ${gift}.` });
    }
    if (p.kind === "PRODUCT_AMOUNT" && !applied.lineIds.has(d.id) && p.config.minQuantity) {
      const c = p.config;
      const n = units.filter((u) => eligibleFor(lines[u.line], c.excludeOnSale) && matchesTarget(c.target, lines[u.line])).length;
      const need = c.minQuantity! - n;
      if (n > 0 && need > 0) out.push({ code: "min_quantity_progress", discountId: d.id, remaining: need, text: `« ${d.title} » : ajoutez ${plural(need, "article")} éligible${need > 1 ? "s" : ""} pour en profiter.` });
    }
  }
  // Paliers : prochain palier de la remise de panier la mieux placée (une seule ligne de message).
  let next: PipelineMessage | null = null;
  for (const d of discounts) {
    if (d.parsed.kind !== "CART_TIER") continue;
    const c = d.parsed.config;
    const base = lines.reduce((s, l, i) => s + (!l.isGiftCard && matchesTarget(c.target, l) ? Math.max(0, lineNets[i]) : 0), 0);
    if (base <= 0) continue;
    const upcoming = c.tiers.find((t) => t.minSubtotal > base);
    if (!upcoming) continue;
    const remaining = upcoming.minSubtotal - base;
    // Une autre remise de panier déjà appliquée fait mieux que ce prochain palier : pas de message trompeur.
    if (applied.tier && applied.tier.discount.id !== d.id && upcoming.value.type !== "FREE_DELIVERY" && applied.tier.amount >= (upcoming.value.type === "PERCENT" ? Math.round((upcoming.minSubtotal * upcoming.value.amount) / 100) : upcoming.value.amount)) continue;
    if (!next || remaining < (next.remaining ?? Infinity)) next = { code: "tier_progress", discountId: d.id, remaining, text: `Plus que ${formatMoney(remaining, currency)} pour ${tierLabel(upcoming.value, currency)}.` };
  }
  if (next) out.push(next);
  return out;
}
