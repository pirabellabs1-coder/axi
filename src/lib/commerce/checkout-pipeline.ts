import { allocateProRata } from "./allocation";
import { computeDeliveryFee, validateCoupon, type CouponInput, type DeliveryInput, type PricedLine } from "./pricing";
import { evaluateCartTier, evaluateLineDiscounts, isLineDiscount, progressMessages, type EvalDiscount, type EvalLine, type PipelineMessage } from "@/lib/discounts/evaluate";
import { readDiscountConfig, type DiscountKind } from "@/lib/discounts/schema";
import { computeTaxes, type TaxLine, type TaxSettingsInput } from "@/lib/tax/compute";

/**
 * Pipeline de prix unique (spécification lot 1, §0.1 à §0.3) : SEULE source de vérité des montants pour
 * `previewTotals`, `createOrder`, la caisse (lot 3), le MCP et les retours. Fonction pure et déterministe :
 * aucune lecture de base, aucun accès à l'horloge hors `input.now`. Testée (tests/checkout-pipeline.test.ts).
 *
 * Ordre normatif (§0.2) :
 *  1. prix unitaire (fourni par l'appelant : variante, sinon promo datée, sinon prix, plus les suppléments) ;
 *  2. remises automatiques de ligne (une seule par unité) ;
 *  3. remise automatique de panier (la meilleure, sur le net après 2, hors cartes cadeaux) ;
 *  4. code promo (`minSubtotal` sur le net après 2-3, assiette `appliesTo`) ; non-cumul : meilleur scénario ;
 *  5. fidélité (paliers entiers, plafond `maxRedeemPercent` du net marchandise après 4) ;
 *  6. livraison (`freeAbove` comparé au net des seules lignes EXPÉDIÉES — hors cartes cadeaux, produits
 *     numériques et services (vague 2) —, après remises automatiques et coupon, AVANT fidélité ;
 *     coupon ou palier « livraison offerte » ; frais nuls si AUCUNE ligne n'est expédiée) ;
 *  7. taxes (lot 2, `computeTaxes` de src/lib/tax/compute.ts) : sur le net de chaque ligne APRÈS toutes les remises
 *     allouées (fidélité comprise), arrondi par ligne ; livraison taxée si le taux standard `appliesToShipping` ;
 *     cartes cadeaux toujours exonérées ; TTC : « dont TVA », HT : ajoutées au total ;
 *  8. total = net marchandise + livraison (+ taxes si prix HT), jamais négatif ;
 *  9. tenders (cartes cadeaux puis avoir) : ne modifient ni le total ni les remises ; assiette hors lignes carte cadeau.
 * Arrondis (§0.3) : entiers, pourcentages `Math.round`, remises de niveau commande réparties au plus fort reste.
 */

/* ───────────────────────────── Contrat (figé) ───────────────────────────── */

export type PipelineLine = PricedLine & {
  /** Collections (manuelles et automatiques) du produit : ciblage des remises et de `appliesTo`. */
  collectionIds: string[];
  /** Ligne carte cadeau : jamais remisée, jamais payée par carte ou avoir. */
  isGiftCard: boolean;
  /**
   * Vague 2 : nature de la ligne (`PHYSICAL` par défaut, donc comportement historique inchangé).
   * Seules les lignes `PHYSICAL` sont expédiées : une ligne numérique, de service ou de carte cadeau
   * n'entre pas dans l'assiette de la livraison offerte et, si aucune ligne n'est physique, les frais sont nuls.
   */
  kind?: "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD";
  /** Prix unitaire issu d'une promo datée (`effectivePrice().isPromo`, sans prix de variante). */
  onSale: boolean;
  /** Lot 2 : produit soumis aux taxes (défaut true). Une carte cadeau est toujours exonérée. */
  taxable?: boolean;
  /** Lot 2 : catégorie fiscale `standard` | `reduced` | `exempt` (défaut `standard`). */
  taxCategory?: string;
};

export type CouponAppliesTo = { productIds?: string[]; collectionIds?: string[] };

export type PipelineCoupon = CouponInput & {
  id?: string | null;
  /** Défaut true. */
  combinesWithAutomatic?: boolean;
  /** null = tout le panier (hors cartes cadeaux). */
  appliesTo?: CouponAppliesTo | null;
};

/** Remise automatique active, DÉJÀ filtrée par boutique et par date (configuration brute, relue ici). */
export type PipelineAutomaticDiscount = {
  id: string;
  title: string;
  kind: DiscountKind;
  config: unknown;
  priority?: number;
  combinesWithCoupons?: boolean;
  combinesWithOtherAutomatic?: boolean;
  maxUses?: number | null;
  usesCount?: number;
};

/** Fidélité demandée (acheteur connecté uniquement, §1). */
export type PipelineLoyalty = {
  /** Points que l'acheteur souhaite utiliser. */
  points: number;
  /** Solde de points du client. */
  balance: number;
  rewardPoints: number;
  rewardValue: number;
  /** Plafond en % du net marchandise après l'étape 4 (défaut 50). */
  maxRedeemPercent?: number;
};

/** Carte cadeau dont le solde a été lu (verrouillé dans `createOrder`). */
export type PipelineGiftCard = { id: string; last4?: string; balance: number; expiresAt?: Date | null };

export type PipelineInput = {
  lines: PipelineLine[];
  delivery: DeliveryInput;
  coupon?: PipelineCoupon | null;
  automaticDiscounts?: PipelineAutomaticDiscount[];
  loyalty?: PipelineLoyalty | null;
  giftCards?: PipelineGiftCard[];
  /** Avoir disponible (acheteur vérifié qui a choisi de l'utiliser) ; 0 ou absent = non utilisé. */
  storeCredit?: number;
  now?: Date;
  currency: string;
  /** Lot 2 : réglages de taxes (taux ACTIFS du pays de taxation, déjà filtrés) ; absent = aucune taxe. */
  tax?: TaxSettingsInput | null;
};

export type DiscountAllocation = { lineIndex: number; amount: number };

export type PricedDiscount = {
  source: "automatic" | "coupon" | "loyalty";
  /** AutomaticDiscount.id, Coupon.id (si fourni) ; null pour la fidélité. */
  id: string | null;
  kind?: DiscountKind | CouponInput["type"];
  label: string;
  amount: number;
  allocations: DiscountAllocation[];
  /** Livraison offerte (coupon FREE_DELIVERY ou palier) : `amount` vaut 0, la valeur est dans `deliveryFee`. */
  freeDelivery?: boolean;
  applications?: number;
};

export type PricedCartLine = PipelineLine & {
  lineTotal: number;
  /** Part des remises (ligne et commande) allouée à la ligne. */
  discountAllocated: number;
  /** lineTotal − discountAllocated. */
  netTotal: number;
  /** Lot 2 : taxe de la ligne (contenue si TTC, ajoutée si HT) et son taux ; null = non taxée. */
  taxAmount: number;
  taxRateBps: number | null;
};

export type Tender = { kind: "gift_card" | "store_credit"; id: string; amount: number; last4?: string; remainingAfter?: number };

export type PricedCart = {
  lines: PricedCartLine[];
  discounts: PricedDiscount[];
  subtotal: number;
  /** Σ des remises (automatiques + coupon + fidélité). */
  discount: number;
  automaticDiscount: number;
  couponDiscount: number;
  loyaltyDiscount: number;
  loyaltyPointsRedeemed: number;
  deliveryFee: number;
  freeDelivery: boolean;
  /** Σ taxes (lignes + livraison). En TTC elles sont CONTENUES dans le total (« dont TVA »). */
  taxTotal: number;
  /** Regroupement par taux { name, rateBps, base HT, amount } (Order.taxLines). */
  taxLines: TaxLine[];
  /** Prix TTC (true) ou HT (false) ; true quand les taxes sont désactivées. */
  taxesIncluded: boolean;
  shippingTax: number;
  shippingTaxRateBps: number | null;
  total: number;
  tenders: Tender[];
  giftCardAmount: number;
  storeCreditAmount: number;
  amountDue: number;
  messages: PipelineMessage[];
  couponApplied: boolean;
  couponError?: string;
  /** Code valide mais écarté au profit d'offres automatiques plus favorables (non cumulable). */
  couponSuperseded: boolean;
  /** Remises automatiques effectivement appliquées (ids), pour l'incrément conditionnel de `usesCount`. */
  appliedAutomaticIds: string[];
};

export type { PipelineMessage } from "@/lib/discounts/evaluate";

export const NOT_COMBINABLE_MESSAGE = "Ce code n'est pas cumulable avec les offres en cours : la meilleure offre a été appliquée.";
export const MAX_GIFT_CARDS = 3;
export const DEFAULT_MAX_REDEEM_PERCENT = 50;

/* ───────────────────────────── Implémentation ───────────────────────────── */

type Scenario = {
  autos: EvalDiscount[];
  lineNets: number[];
  discounts: PricedDiscount[];
  appliedAutoIds: string[];
  freeDelivery: boolean;
  couponApplied: boolean;
  couponError?: string;
  /** net marchandise (toutes lignes) + livraison, avant fidélité : critère « le plus favorable ». */
  score: number;
};

const toAllocations = (perLine: readonly number[]): DiscountAllocation[] => perLine.flatMap((amount, lineIndex) => (amount > 0 ? [{ lineIndex, amount }] : []));

function couponEligible(appliesTo: CouponAppliesTo | null | undefined, line: PipelineLine): boolean {
  if (line.isGiftCard) return false;
  if (!appliesTo) return true;
  const p = appliesTo.productIds ?? [];
  const c = appliesTo.collectionIds ?? [];
  if (p.length === 0 && c.length === 0) return true;
  return p.includes(line.productId) || c.some((id) => line.collectionIds.includes(id));
}

function readAutos(input: PipelineInput): EvalDiscount[] {
  const out: EvalDiscount[] = [];
  for (const a of input.automaticDiscounts ?? []) {
    if (a.maxUses != null && (a.usesCount ?? 0) >= a.maxUses) continue; // épuisée
    const parsed = readDiscountConfig(a.kind, a.config);
    if (!parsed) continue; // configuration invalide : ignorée, jamais d'erreur au checkout
    out.push({
      id: a.id,
      title: a.title,
      kind: a.kind,
      priority: a.priority ?? 0,
      combinesWithCoupons: a.combinesWithCoupons ?? true,
      combinesWithOtherAutomatic: a.combinesWithOtherAutomatic ?? true,
      parsed,
    });
  }
  return out;
}

function runScenario(input: PipelineInput, evalLines: EvalLine[], gross: number[], autos: EvalDiscount[], coupon: PipelineCoupon | null, now: Date): Scenario {
  const lines = input.lines;
  const nets = [...gross];
  const discounts: PricedDiscount[] = [];
  const appliedAutoIds: string[] = [];
  let freeDelivery = false;

  // 2. Remises automatiques de ligne.
  for (const a of evaluateLineDiscounts(evalLines, autos)) {
    a.perLine.forEach((x, i) => (nets[i] -= x));
    discounts.push({ source: "automatic", id: a.discount.id, kind: a.discount.kind, label: a.discount.title, amount: a.amount, allocations: toAllocations(a.perLine), applications: a.applications });
    appliedAutoIds.push(a.discount.id);
  }

  // 3. Remise automatique de panier (une seule).
  const merchNet = () => nets.reduce((s, x) => s + x, 0);
  const tier = evaluateCartTier(evalLines, nets, autos, deliveryFeeFor(input, lines, nets));
  if (tier && (tier.amount > 0 || (tier.freeDelivery && input.delivery.type === "DELIVERY"))) {
    tier.perLine.forEach((x, i) => (nets[i] -= x));
    freeDelivery ||= tier.freeDelivery;
    discounts.push({ source: "automatic", id: tier.discount.id, kind: "CART_TIER", label: tier.discount.title, amount: tier.amount, allocations: toAllocations(tier.perLine), ...(tier.freeDelivery ? { freeDelivery: true } : {}) });
    appliedAutoIds.push(tier.discount.id);
  }

  // 4. Code promo.
  let couponApplied = false;
  let couponError: string | undefined;
  if (coupon) {
    const weights = lines.map((l, i) => (couponEligible(coupon.appliesTo, l) ? Math.max(0, nets[i]) : 0));
    const nonGiftNet = lines.reduce((s, l, i) => s + (l.isGiftCard ? 0 : Math.max(0, nets[i])), 0);
    const v = validateCoupon(coupon, nonGiftNet, now);
    if (!v.ok) couponError = v.reason;
    else if (!lines.some((l) => couponEligible(coupon.appliesTo, l))) couponError = "Ce code ne s'applique à aucun article de votre panier.";
    else {
      couponApplied = true;
      const base = weights.reduce((s, x) => s + x, 0);
      let amount = 0;
      if (coupon.type === "PERCENT") amount = Math.min(base, Math.round((base * Math.min(100, Math.max(0, coupon.value))) / 100));
      else if (coupon.type === "FIXED") amount = Math.min(base, Math.max(0, coupon.value));
      else freeDelivery = true;
      const perLine = allocateProRata(amount, weights);
      perLine.forEach((x, i) => (nets[i] -= x));
      discounts.push({ source: "coupon", id: coupon.id ?? null, kind: coupon.type, label: `Code ${coupon.code}`, amount, allocations: toAllocations(perLine), ...(coupon.type === "FREE_DELIVERY" ? { freeDelivery: true } : {}) });
    }
  }

  const net = merchNet();
  const fee = freeDelivery ? 0 : deliveryFeeFor(input, lines, nets);
  return { autos, lineNets: nets, discounts, appliedAutoIds, freeDelivery, couponApplied, couponError, score: Math.max(0, net + fee) };
}

/**
 * Une ligne part-elle physiquement ? `kind` absent = `PHYSICAL` (compatibilité), sauf carte cadeau.
 * Vague 2 : le numérique et les services ne s'expédient pas.
 */
function shippable(l: PipelineLine): boolean {
  if (l.isGiftCard) return false;
  return (l.kind ?? "PHYSICAL") === "PHYSICAL";
}

/** Au moins une ligne à expédier : sinon aucun frais de livraison, quel que soit le mode demandé. */
function anyShippable(lines: readonly PipelineLine[]): boolean {
  return lines.some(shippable);
}

/**
 * Base de `freeAbove` : net marchandise des seules lignes EXPÉDIÉES (une carte cadeau, un fichier ou un
 * service n'ouvre pas la livraison offerte).
 */
function deliveryBase(lines: readonly PipelineLine[], nets: readonly number[]): number {
  return lines.reduce((s, l, i) => s + (shippable(l) ? Math.max(0, nets[i]) : 0), 0);
}

/** Frais de livraison effectifs : 0 si rien n'est expédié. */
function deliveryFeeFor(input: PipelineInput, lines: readonly PipelineLine[], nets: readonly number[]): number {
  if (!anyShippable(lines)) return 0;
  return computeDeliveryFee(input.delivery, deliveryBase(lines, nets));
}

export const MIN_WITH_OFFERS_MESSAGE = "Minimum de commande non atteint avec les offres en cours.";

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Taxes d'un panier (étape 7) : délègue au calcul pur de l'équipe T (`computeTaxes`). Cartes cadeaux exonérées
 * (§2 : catégorie `exempt` imposée). Sans réglages : aucune taxe, prix réputés TTC.
 * Réutilisé tel quel pour les montants convertis (§1.2, étape 5 : « même méthode »).
 */
export function taxesFor(lines: readonly Pick<PipelineLine, "isGiftCard" | "taxable" | "taxCategory">[], nets: readonly number[], deliveryFee: number, tax: TaxSettingsInput | null | undefined) {
  const settings: TaxSettingsInput = tax ?? { enabled: false, pricesIncludeTax: true, rates: [] };
  return computeTaxes({
    lines: lines.map((l, i) => ({ net: Math.max(0, nets[i]), taxable: !l.isGiftCard && l.taxable !== false, taxCategory: l.isGiftCard ? "exempt" : (l.taxCategory ?? "standard") })),
    delivery: { amount: Math.max(0, deliveryFee) },
    settings,
  });
}

/** Pipeline de prix (voir l'en-tête). */
export function priceCart(input: PipelineInput): PricedCart {
  const now = input.now ?? new Date();
  const lines = input.lines;
  const gross = lines.map((l) => Math.max(0, l.unitPrice) * Math.max(0, l.quantity));
  const subtotal = gross.reduce((s, x) => s + x, 0);
  const evalLines: EvalLine[] = lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? null, unitPrice: Math.max(0, l.unitPrice), quantity: l.quantity, collectionIds: l.collectionIds, isGiftCard: l.isGiftCard, onSale: l.onSale }));
  const autos = readAutos(input);
  const coupon = input.coupon ?? null;
  const messages: PipelineMessage[] = [];

  // Ensembles de remises automatiques compatibles entre elles : toutes les « combinables », puis chaque
  // remise non combinable (`combinesWithOtherAutomatic = false`) seule. Le plus favorable est retenu.
  const combinable = autos.filter((a) => a.combinesWithOtherAutomatic);
  const autoSets: EvalDiscount[][] = [combinable, ...autos.filter((a) => !a.combinesWithOtherAutomatic).map((a) => [a])];
  const pick = (xs: Scenario[]) => xs.reduce((best, s) => (s.score < best.score ? s : best));

  const autoScenarios = autoSets.map((set) => runScenario(input, evalLines, gross, set, null, now));
  const bestAuto = pick(autoScenarios);
  let chosen = bestAuto;
  let couponSuperseded = false;

  const couponCombines = coupon?.combinesWithAutomatic ?? true;
  // Conflit de drapeaux : le coupon n'est pas cumulable, ou une remise RETENUE n'accepte pas les coupons.
  const appliedAutos = bestAuto.autos.filter((a) => bestAuto.appliedAutoIds.includes(a.id));
  const flagConflict = !!coupon && (!couponCombines || appliedAutos.some((a) => !a.combinesWithCoupons));

  if (coupon && !flagConflict) {
    // Cumulable : le coupon s'ajoute aux offres retenues ; jamais d'arbitrage ni de message « non cumulable ».
    const withCoupon = runScenario(input, evalLines, gross, bestAuto.autos, coupon, now);
    if (withCoupon.couponApplied) chosen = withCoupon;
    else {
      const belowMin = withCoupon.couponError?.startsWith("Minimum") && bestAuto.appliedAutoIds.length > 0;
      chosen = { ...bestAuto, couponError: belowMin ? MIN_WITH_OFFERS_MESSAGE : (withCoupon.couponError ?? "Code promo invalide.") };
    }
  } else if (coupon) {
    const seen = new Set<string>();
    const couponSets: EvalDiscount[][] = [];
    for (const set of autoSets) {
      const filtered = couponCombines ? set.filter((a) => a.combinesWithCoupons) : [];
      const key = filtered.map((a) => a.id).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      couponSets.push(filtered);
    }
    const couponScenarios = couponSets.map((set) => runScenario(input, evalLines, gross, set, coupon, now));
    const valid = couponScenarios.filter((s) => s.couponApplied);
    if (valid.length === 0) {
      chosen = { ...bestAuto, couponError: couponScenarios[0]?.couponError ?? "Code promo invalide." };
    } else {
      const bestCoupon = pick(valid);
      const conflict = !sameIds(bestCoupon.appliedAutoIds, bestAuto.appliedAutoIds);
      if (!conflict) chosen = bestCoupon;
      else {
        messages.push({ code: "coupon_not_combinable", text: NOT_COMBINABLE_MESSAGE });
        if (bestCoupon.score < bestAuto.score) chosen = bestCoupon;
        else {
          chosen = bestAuto;
          couponSuperseded = true;
        }
      }
    }
  }

  const nets = [...chosen.lineNets];
  // Net marchandise après remises automatiques et coupon, AVANT fidélité : base de freeAbove (décision du 11/10/2026,
  // utiliser ses points ne fait jamais perdre la livraison offerte).
  const netBeforeLoyalty = deliveryBase(lines, nets);
  const discounts = [...chosen.discounts];
  let freeDelivery = chosen.freeDelivery;

  // 5. Fidélité : paliers entiers, plafonnés à maxRedeemPercent du net marchandise (hors cartes cadeaux).
  let loyaltyDiscount = 0;
  let loyaltyPointsRedeemed = 0;
  const loyalty = input.loyalty;
  if (loyalty && loyalty.points > 0 && loyalty.rewardPoints > 0 && loyalty.rewardValue > 0) {
    const weights = lines.map((l, i) => (l.isGiftCard ? 0 : Math.max(0, nets[i])));
    const base = weights.reduce((s, x) => s + x, 0);
    const pct = Math.min(100, Math.max(0, loyalty.maxRedeemPercent ?? DEFAULT_MAX_REDEEM_PERCENT));
    const cap = Math.floor((base * pct) / 100);
    const wanted = Math.floor(Math.min(loyalty.points, Math.max(0, loyalty.balance)) / loyalty.rewardPoints);
    const allowed = Math.floor(cap / loyalty.rewardValue);
    const tiers = Math.max(0, Math.min(wanted, allowed));
    if (wanted > allowed) messages.push({ code: "loyalty_capped", text: `Les points couvrent au plus ${pct} % de la commande : ${tiers * loyalty.rewardPoints} points utilisés.` });
    if (tiers > 0) {
      loyaltyDiscount = tiers * loyalty.rewardValue;
      loyaltyPointsRedeemed = tiers * loyalty.rewardPoints;
      const perLine = allocateProRata(loyaltyDiscount, weights);
      perLine.forEach((x, i) => (nets[i] -= x));
      discounts.push({ source: "loyalty", id: null, label: `Points de fidélité (${loyaltyPointsRedeemed} points)`, amount: loyaltyDiscount, allocations: toAllocations(perLine) });
    }
  }

  // 6. Livraison (freeAbove sur le net avant fidélité).
  const merchNet = nets.reduce((s, x) => s + x, 0);
  freeDelivery = freeDelivery && input.delivery.type === "DELIVERY";
  const deliveryFee = freeDelivery || !anyShippable(lines) ? 0 : computeDeliveryFee(input.delivery, netBeforeLoyalty);
  // 7. Taxes sur les nets alloués (arrondi par ligne), livraison comprise si le taux standard s'y applique.
  const taxes = taxesFor(lines, nets, deliveryFee, input.tax);
  // 8. Total : en TTC les taxes sont déjà dans les prix ; en HT elles s'ajoutent.
  const total = Math.max(0, merchNet + deliveryFee + taxes.addToTotal);

  // 9. Tenders : cartes cadeaux (expiration la plus proche, puis plus petit solde ; 3 max), puis avoir.
  const giftLines = lines.reduce((s, l, i) => s + (l.isGiftCard ? Math.max(0, nets[i]) : 0), 0);
  let payable = Math.max(0, total - giftLines);
  const tenders: Tender[] = [];
  const cards = [...(input.giftCards ?? [])]
    .filter((c) => c.balance > 0)
    .sort((a, b) => {
      const ea = a.expiresAt ? a.expiresAt.getTime() : Infinity;
      const eb = b.expiresAt ? b.expiresAt.getTime() : Infinity;
      return ea - eb || a.balance - b.balance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .slice(0, MAX_GIFT_CARDS);
  let giftCardAmount = 0;
  for (const c of cards) {
    const amount = Math.min(c.balance, payable);
    if (amount <= 0) continue;
    payable -= amount;
    giftCardAmount += amount;
    tenders.push({ kind: "gift_card", id: c.id, amount, ...(c.last4 ? { last4: c.last4 } : {}), remainingAfter: c.balance - amount });
  }
  const storeCreditAmount = Math.min(Math.max(0, Math.floor(input.storeCredit ?? 0)), payable);
  if (storeCreditAmount > 0) tenders.push({ kind: "store_credit", id: "store_credit", amount: storeCreditAmount });
  const amountDue = total - giftCardAmount - storeCreditAmount;

  // Lignes et agrégats.
  const allocated = lines.map(() => 0);
  for (const d of discounts) for (const a of d.allocations) allocated[a.lineIndex] += a.amount;
  const pricedLines: PricedCartLine[] = lines.map((l, i) => ({ ...l, lineTotal: gross[i], discountAllocated: allocated[i], netTotal: gross[i] - allocated[i], taxAmount: taxes.perLine[i].taxAmount, taxRateBps: taxes.perLine[i].taxRateBps }));
  const automaticDiscount = discounts.filter((d) => d.source === "automatic").reduce((s, d) => s + d.amount, 0);
  const couponDiscount = discounts.filter((d) => d.source === "coupon").reduce((s, d) => s + d.amount, 0);
  const discount = automaticDiscount + couponDiscount + loyaltyDiscount;

  // Progression (sur le net après les remises de ligne du scénario retenu).
  const afterLine = [...gross];
  for (const d of chosen.discounts) if (d.source === "automatic" && d.kind !== "CART_TIER") for (const a of d.allocations) afterLine[a.lineIndex] -= a.amount;
  const appliedLine = new Set(chosen.discounts.filter((d) => d.source === "automatic" && d.kind && isLineDiscount({ kind: d.kind as DiscountKind })).map((d) => d.id as string));
  const tierApplied = chosen.discounts.find((d) => d.kind === "CART_TIER");
  const tierInfo = tierApplied ? evaluateCartTier(evalLines, afterLine, chosen.autos.filter((a) => a.id === tierApplied.id), deliveryFeeFor(input, lines, afterLine)) : null;
  messages.unshift(...progressMessages(evalLines, afterLine, chosen.autos, { lineIds: appliedLine, tier: tierInfo }, input.currency));

  return {
    lines: pricedLines,
    discounts,
    subtotal,
    discount,
    automaticDiscount,
    couponDiscount,
    loyaltyDiscount,
    loyaltyPointsRedeemed,
    deliveryFee,
    freeDelivery,
    taxTotal: taxes.taxTotal,
    taxLines: taxes.taxLines,
    taxesIncluded: taxes.taxesIncluded,
    shippingTax: taxes.shippingTax,
    shippingTaxRateBps: taxes.shippingTaxRateBps,
    total,
    tenders,
    giftCardAmount,
    storeCreditAmount,
    amountDue,
    messages,
    couponApplied: chosen.couponApplied,
    ...(chosen.couponError ? { couponError: chosen.couponError } : {}),
    couponSuperseded,
    appliedAutomaticIds: chosen.appliedAutoIds,
  };
}
