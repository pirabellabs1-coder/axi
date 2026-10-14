"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createOrder } from "@/lib/commerce/orders";
import { checkQuantity, type DeliveryInput, type Totals } from "@/lib/commerce/pricing";
import { priceCart, type PipelineCoupon, type PipelineLine, type PipelineMessage, type PricedCart } from "@/lib/commerce/checkout-pipeline";
import { unitPricing } from "@/lib/commerce/checkout-lines";
import { initiateGatewayPayment } from "@/lib/payments/service";
import { CHANNEL_IDS } from "@/lib/payments/channels";
import { SITE } from "@/config/site";
import { PLANS } from "@/config/plans";
import { lineKey } from "@/components/storefront/format";
import { pickOrderVariant } from "@/lib/storefront/variants";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { isBackorder } from "@/lib/inventory/policy";
import { STOCK_VISIBILITY_SELECT, storeShowsStock } from "@/lib/storefront/stock-visibility";
import { effectivePlanId } from "@/lib/auth/permissions";
import { collectionIdsByProduct, loadActiveAutomaticDiscounts, needsCollections } from "@/lib/discounts/service";
import { parseLoyaltyConfig } from "@/lib/loyalty/config";
import { getBuyer } from "@/lib/buyer/session";
import { GiftCardError } from "@/lib/giftcards/errors";
import { GIFT_CARD_INVALID_MESSAGE } from "@/lib/giftcards/state";
import { isGiftCardCartBlocked, limitGiftCardCheck, recordGiftCardCartFailure } from "@/lib/giftcards/abuse";
import { getBuyerKillSwitch } from "@/lib/buyer/settings";
import { giftCardForeignMessage, loadTaxSettings, presentFor, resolveDisplayFx } from "@/lib/commerce/checkout-context";
import { getDisplayCurrency } from "@/lib/currency/display";
import { chooseZoneShipping } from "@/lib/shipping/zone-rate";
import { requestOrderLocale } from "@/lib/i18n/resolve";
import type { PresentedCart } from "@/lib/currency/present";
import type { TaxLine } from "@/lib/tax/compute";

/** Arrêt d'urgence des comptes acheteurs : avoir et points refusés (message de la plateforme ou message par défaut). */
const ACCOUNT_SUSPENDED = "L'utilisation de l'avoir et des points est momentanément suspendue. Réessayez plus tard.";

/**
 * Garde anti-abus des cartes cadeaux au checkout (§8) : panier bloqué après 5 échecs, puis une vérification comptée
 * par code AVANT toute recherche (10 / 15 min / IP). Renvoie un message d'erreur, ou null.
 */
async function giftCardGuard(storeId: string, ip: string, cartKey: string, codes: string[]): Promise<string | null> {
  if (codes.length === 0) return null;
  if (await isGiftCardCartBlocked(cartKey)) return "Trop d'essais de cartes cadeaux pour ce panier. Réessayez plus tard.";
  for (let i = 0; i < codes.length; i++) {
    const rl = await limitGiftCardCheck({ storeId, ip });
    if (!rl.ok) return rateLimitMessage(rl.retryAfter);
  }
  return null;
}

/** M5 : message unique quel que soit le motif (inexistant, expiré, épuisé…) — pas d'énumération des codes. */
const COUPON_INVALID = "Code promo invalide.";

/* ─────────────────────────── Schémas ─────────────────────────── */

const giftCardRecipientSchema = z.object({
  recipientName: z.string().trim().max(80).nullable().optional(),
  recipientPhone: z.string().trim().max(20).nullable().optional(),
  recipientEmail: z.string().trim().email().max(160).or(z.literal("")).nullable().optional(),
  message: z.string().trim().max(300).nullable().optional(),
  sendAt: z.string().trim().max(40).nullable().optional(),
});

const itemSchema = z.object({
  productId: z.string().min(8).max(64),
  variantId: z.string().min(8).max(64).nullable().optional(),
  optionIds: z.array(z.string().min(8).max(64)).max(30).default([]),
  quantity: z.number().int().min(1).max(999),
  /** Lot 1 : destinataire d'une carte cadeau (ignoré pour un produit ordinaire). */
  giftCard: giftCardRecipientSchema.nullable().optional(),
});

const previewSchema = z.object({
  storeSlug: z.string().min(3).max(48),
  items: z.array(itemSchema).max(50),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY", "WHATSAPP", "DIGITAL"]),
  deliveryZoneId: z.string().max(64).nullable().optional(),
  couponCode: z.string().trim().max(32).nullable().optional(),
  /** Lot 1 : cartes cadeaux (3 max), avoir et points (acheteur connecté par code uniquement). */
  giftCardCodes: z.array(z.string().trim().max(64)).max(3).optional(),
  useStoreCredit: z.boolean().optional(),
  loyaltyPoints: z.number().int().min(0).max(100_000_000).optional(),
  /** Panier serveur (limite d'essais de cartes cadeaux par panier). */
  cartToken: z.string().regex(/^[0-9a-f]{32}$/).nullable().optional(),
});

const placeSchema = previewSchema.extend({
  idempotencyKey: z.string().min(16).max(64),
  customer: z.object({
    name: z.string().trim().min(2, "Indiquez votre nom.").max(80),
    phone: z.string().trim().min(6, "Numéro de téléphone invalide.").max(20),
    email: z.string().trim().email("Adresse e-mail invalide.").max(120).or(z.literal("")).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  deliveryAddress: z.string().trim().max(300).optional(),
  pickupSlotId: z.string().max(64).nullable().optional(),
  paymentMethodId: z.string().max(64).nullable().optional(),
  paymentReference: z.string().trim().max(80).optional(),
  /** Lot 1 bis : portefeuille choisi et numéro à débiter (demande poussée), revalidés contre le moyen côté serveur. */
  paymentChannel: z.enum(CHANNEL_IDS).nullable().optional(),
  payerPhone: z.string().trim().max(20).optional(),
  marketingConsent: z.boolean().default(false),
  /** Brouillon de panier côté serveur (saveCheckoutDraft) : marqué converti à la création de la commande. */
  cartToken: z.string().regex(/^[0-9a-f]{32}$/).nullable().optional(),
  /** Lot 1 : offres au panier ajoutées (ids CartOffer), revalidées côté serveur. */
  attribution: z.object({ offers: z.array(z.string().min(8).max(64)).max(20).default([]) }).nullable().optional(),
  /** Lot 2 : facture au nom d'une entreprise (raison sociale, numéro fiscal). */
  buyerCompany: z.string().trim().max(120).optional(),
  buyerTaxId: z.string().trim().max(40).optional(),
});

export type PreviewInput = z.input<typeof previewSchema>;
export type PlaceOrderInput = z.input<typeof placeSchema>;

export type PreviewLine = {
  key: string;
  name: string;
  variantName: string | null;
  optionNames: string[];
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Lot 1 : part des remises allouée à la ligne, et net après remises. */
  discountAllocated: number;
  netTotal: number;
  isGiftCard?: boolean;
  /** Précommande : quantité au-delà du stock, vendue grâce à « continuer à vendre en cas de rupture ». */
  backorder?: boolean;
};

/** Totaux de l'aperçu : champs historiques (`Totals`) + détail du lot 1. */
export type PreviewTotals = Totals &
  Pick<PricedCart, "automaticDiscount" | "couponDiscount" | "loyaltyDiscount" | "loyaltyPointsRedeemed" | "giftCardAmount" | "storeCreditAmount" | "amountDue" | "freeDelivery" | "couponSuperseded" | "taxTotal" | "taxesIncluded"> & {
    /** Lot 2 : détail des taxes par taux (« dont TVA » en TTC, ligne « TVA » en HT). */
    taxLines: TaxLine[];
  };

export type PreviewDiscount = { source: "automatic" | "coupon" | "loyalty"; label: string; amount: number; freeDelivery?: boolean; /** Lot 2 : montant en devise d'affichage. */ presentedAmount?: number };

export type PreviewAccount = { loyaltyEnabled: boolean; loyaltyBalance: number; rewardPoints: number; rewardValue: number; storeCreditBalance: number };

export type PreviewResult =
  | {
      ok: true;
      lines: PreviewLine[];
      totals: PreviewTotals;
      /** Lot 1 : remises appliquées (libellés affichables) et messages (progression des paliers, non-cumul…). */
      discounts: PreviewDiscount[];
      messages: PipelineMessage[];
      /** Lot 1 : cartes cadeaux appliquées (le solde n'est visible que par qui connaît le code). */
      giftCards: { last4: string; applied: number; remainingAfter: number }[];
      /** Lot 1 : acheteur connecté par code (null en invité) : soldes utilisables au checkout. */
      account: PreviewAccount | null;
      warnings: string[];
      minOrderAmount: number;
      currency: string;
      /**
       * Lot 2 : montants dans la devise d'affichage (calculés APRÈS le pipeline, cotation verrouillée 15 min) ;
       * null = affichage en devise boutique. Les montants en devise boutique (`totals`) restent ceux encaissés.
       */
      presentment: PresentedCart | null;
      /** Lot 2 : régime « TVA non applicable » (mention configurable par le commerçant), sinon null. */
      taxMention: string | null;
    }
  | { ok: false; error: string; field?: string };

export type PlaceOrderResult = { ok: false; error: string; field?: string; trackingToken?: string };

/* ───────────────── Aperçu des totaux (recalcul serveur) ───────────────── */

const EMPTY_TOTALS: PreviewTotals = {
  subtotal: 0,
  discount: 0,
  deliveryFee: 0,
  total: 0,
  couponApplied: false,
  automaticDiscount: 0,
  couponDiscount: 0,
  loyaltyDiscount: 0,
  loyaltyPointsRedeemed: 0,
  giftCardAmount: 0,
  storeCreditAmount: 0,
  amountDue: 0,
  freeDelivery: false,
  couponSuperseded: false,
  taxTotal: 0,
  taxesIncluded: true,
  taxLines: [],
};

/** Mention d'exonération (régime TPS ou autre), lue de façon tolérante dans `Store.taxRegistration`. */
function exemptionMention(enabled: boolean | null | undefined, raw: unknown): string | null {
  if (!enabled || !raw || typeof raw !== "object") return null;
  const r = raw as { regime?: unknown; exemptionMention?: unknown };
  if (r.regime === "TVA") return null;
  const m = typeof r.exemptionMention === "string" ? r.exemptionMention.trim().slice(0, 200) : "";
  return m || (r.regime === "TPS" ? "TVA non applicable" : null);
}

function maxRedeemPercent(raw: unknown): number {
  const v = raw && typeof raw === "object" ? (raw as { maxRedeemPercent?: unknown }).maxRedeemPercent : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100 ? v : 50;
}

function couponAppliesTo(raw: unknown): PipelineCoupon["appliesTo"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { productIds?: unknown; collectionIds?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  const productIds = ids(r.productIds);
  const collectionIds = ids(r.collectionIds);
  return productIds.length || collectionIds.length ? { productIds, collectionIds } : null;
}

/**
 * Recalcule le panier à partir de la base (prix, options, zone, coupon, remises automatiques, cartes cadeaux,
 * avoir, points) via le pipeline unique `priceCart`. Aucun montant client n'est utilisé.
 * Ne réserve ni stock ni solde : c'est `createOrder` qui le fait atomiquement.
 */
export async function previewTotals(raw: PreviewInput): Promise<PreviewResult> {
  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Panier invalide." };
  const input = parsed.data;
  const ip = await clientIp();
  const rl = await rateLimit(`preview:ip:${ip}`, 60, 10 * 60);
  if (!rl.ok) return { ok: false, error: rateLimitMessage(rl.retryAfter) };

  const store = await db.store.findUnique({
    where: { slug: input.storeSlug },
    select: { id: true, slug: true, status: true, currency: true, minOrderAmount: true, loyaltyConfig: true, subscription: true, country: true, taxesEnabled: true, pricesIncludeTax: true, taxRegistration: true, ...STOCK_VISIBILITY_SELECT },
  });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return { ok: false, error: "Boutique indisponible." };

  const planId = effectivePlanId(store.subscription);
  const loyaltyCfg = parseLoyaltyConfig(store.loyaltyConfig);
  // Arrêt d'urgence acheteurs : avoir et points refusés.
  const kill = await getBuyerKillSwitch();
  if (kill.enabled && (input.useStoreCredit || (input.loyaltyPoints ?? 0) > 0)) return { ok: false, error: kill.message || ACCOUNT_SUSPENDED, field: input.useStoreCredit ? "storeCredit" : "loyaltyPoints" };
  const buyer = await getBuyer({ id: store.id, slug: store.slug }).catch(() => null);
  const account: PreviewAccount | null = buyer && !kill.enabled
    ? {
        loyaltyEnabled: loyaltyCfg.enabled && PLANS[planId].features.loyalty,
        loyaltyBalance: buyer.customer.loyaltyPoints,
        rewardPoints: loyaltyCfg.rewardPoints,
        rewardValue: loyaltyCfg.rewardValue,
        storeCreditBalance: buyer.customer.storeCreditBalance,
      }
    : null;
  const taxMention = exemptionMention(store.taxesEnabled, store.taxRegistration);
  const empty = { ok: true as const, lines: [], totals: EMPTY_TOTALS, discounts: [], messages: [], giftCards: [], account, warnings: [] as string[], minOrderAmount: store.minOrderAmount, currency: store.currency, presentment: null, taxMention };
  if (input.items.length === 0) return empty;

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId: store.id, status: "ACTIVE" },
    include: { variants: true, optionGroups: { include: { options: true } } },
  });

  const now = new Date();
  const automaticDiscounts = await loadActiveAutomaticDiscounts(store.id, planId, now);
  const collections = needsCollections(automaticDiscounts) || input.couponCode ? await collectionIdsByProduct(store.id, productIds) : new Map<string, string[]>();
  const revealStock = storeShowsStock(store);
  const warnings: string[] = [];
  const lines: PipelineLine[] = [];
  const meta: { key: string; optionNames: string[]; backorder: boolean }[] = [];

  for (const item of input.items) {
    const p = products.find((x) => x.id === item.productId);
    const key = lineKey(item.productId, item.variantId, item.optionIds);
    if (!p) {
      warnings.push("Un article n'est plus disponible et a été retiré.");
      continue;
    }
    const picked = pickOrderVariant(p, item.variantId);
    if (!picked.ok) {
      warnings.push(picked.error);
      continue;
    }
    const variant = picked.variant;
    const policy = variant ? variant.inventoryPolicy : p.inventoryPolicy;
    const available = variant ? variant.stock : p.stock;
    const trackStock = p.trackStock && !p.isGiftCard;
    const qtyErr = checkQuantity({ name: p.name, minQty: p.minQty, maxQty: p.maxQty, trackStock, stock: available, inventoryPolicy: policy }, item.quantity, { revealStock });
    if (qtyErr) warnings.push(qtyErr);
    // Précommande signalée seulement quand il n'y a plus de stock (sinon on révélerait que la quantité dépasse le stock).
    const backorder = isBackorder({ trackStock, stock: available, policy });

    const selected: { name: string; priceDelta: number }[] = [];
    for (const g of p.optionGroups) {
      const chosen = g.options.filter((o) => item.optionIds.includes(o.id));
      if (g.required && chosen.length < Math.max(1, g.minSelect)) warnings.push(`Choisissez « ${g.name} » pour ${p.name}.`);
      for (const o of chosen.slice(0, g.maxSelect)) selected.push({ name: o.name, priceDelta: o.priceDelta });
    }
    const { unitPrice, onSale } = unitPricing(p, variant, selected, now);
    lines.push({ productId: p.id, variantId: variant?.id ?? null, name: p.name, variantName: variant?.name ?? null, unitPrice, quantity: item.quantity, options: selected, collectionIds: collections.get(p.id) ?? [], isGiftCard: p.isGiftCard, onSale, taxable: p.taxable !== false, taxCategory: p.taxCategory ?? "standard" });
    meta.push({ key, optionNames: selected.map((o) => o.name), backorder });
  }
  if (lines.length === 0) return { ...empty, warnings };

  let delivery: DeliveryInput = { type: input.fulfillmentType === "DELIVERY" ? "DELIVERY" : input.fulfillmentType === "PICKUP" ? "PICKUP" : "WHATSAPP", fee: 0 } as DeliveryInput;
  let shippingZone: { id: string; fallback: { fee: number; freeAbove: number | null; etaLabel: string | null; name: string } } | null = null;
  if (input.fulfillmentType === "DELIVERY" && input.deliveryZoneId) {
    const zone = await db.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, storeId: store.id, active: true } });
    if (!zone) return { ok: false, error: "Zone de livraison invalide.", field: "deliveryZoneId" };
    delivery = { type: "DELIVERY", fee: zone.fee, freeAbove: zone.freeAbove };
    shippingZone = { id: zone.id, fallback: { fee: zone.fee, freeAbove: zone.freeAbove, etaLabel: zone.etaLabel, name: zone.name } };
  }

  let coupon: PipelineCoupon | null = null;
  if (input.couponCode) {
    const c = await db.coupon.findUnique({ where: { storeId_code: { storeId: store.id, code: input.couponCode.toUpperCase() } } });
    if (!c) return { ok: false, error: COUPON_INVALID, field: "couponCode" };
    coupon = {
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value,
      minSubtotal: c.minSubtotal,
      active: c.active,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      maxUses: c.maxUses,
      usesCount: c.usesCount,
      combinesWithAutomatic: c.combinesWithAutomatic,
      appliesTo: couponAppliesTo(c.appliesTo),
    };
  }

  // Points et avoir : uniquement pour l'acheteur connecté par code.
  const loyalty =
    account?.loyaltyEnabled && buyer && (input.loyaltyPoints ?? 0) > 0
      ? { points: input.loyaltyPoints!, balance: buyer.customer.loyaltyPoints, rewardPoints: loyaltyCfg.rewardPoints, rewardValue: loyaltyCfg.rewardValue, maxRedeemPercent: maxRedeemPercent(store.loyaltyConfig) }
      : null;
  const storeCredit = buyer && input.useStoreCredit ? buyer.customer.storeCreditBalance : 0;

  // Lot 2 : taxes et devise d'affichage (cotation verrouillée 15 min sur le panier serveur s'il existe).
  const tax = await loadTaxSettings(db, store);
  // Une panne de la couche devises ne bloque jamais le checkout : repli sur la devise de la boutique.
  const wanted = await getDisplayCurrency(store, now).catch(() => null);
  const display = wanted && wanted.currency !== store.currency
    ? await resolveDisplayFx(db, { store, currency: wanted.currency, cartToken: input.cartToken ?? null, now, persist: true }).catch(() => ({ fx: null, fallback: null }))
    : { fx: null, fallback: null };
  if (display.fallback) warnings.push(display.fallback);

  /**
   * Lot 3 — tarifs d'expédition de la zone (poids et sous-total net) : MÊME source que `createOrder`
   * (`chooseZoneShipping`), pour que les frais affichés soient exactement ceux qui seront facturés.
   * Un premier passage sans fidélité donne le net après remises automatiques et coupon (§0.2-6) ;
   * une zone sans tarif actif conserve son forfait.
   */
  if (shippingZone) {
    const probe = priceCart({ lines, delivery, coupon, automaticDiscounts, now, currency: store.currency, tax });
    const choice = await chooseZoneShipping(db, {
      storeId: store.id,
      zoneId: shippingZone.id,
      zone: shippingZone.fallback,
      lines: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, isGiftCard: l.isGiftCard, kind: l.kind, netTotal: probe.lines[i].netTotal })),
    });
    // `freeAbove` est déjà tranché par le tarif : il ne doit pas être rejoué par le pipeline.
    if (choice.source === "rate") delivery = { type: "DELIVERY", fee: choice.fee, freeAbove: null };
  }

  const base = { lines, delivery, coupon, automaticDiscounts, loyalty, now, currency: store.currency, tax };

  // Cartes cadeaux : 1re passe sans tender pour l'assiette, lecture sans verrou (mêmes contrôles et même
  // répartition que le débit réel), puis montants exacts transmis au pipeline.
  let giftCards: { last4: string; applied: number; remainingAfter: number }[] = [];
  const codes = (input.giftCardCodes ?? []).filter((c) => c !== "");
  // Cartes cadeaux : uniquement dans la devise de la boutique (refusées en affichage étranger, sans recherche du code).
  if (codes.length > 0 && display.fx) return { ok: false, error: giftCardForeignMessage(store.currency), field: "giftCardCodes" };
  if (codes.length > 0) {
    const cartKey = input.cartToken ?? `ip:${ip}`;
    const blocked = await giftCardGuard(store.id, ip, cartKey, codes);
    if (blocked) return { ok: false, error: blocked, field: "giftCardCodes" };
    const first = priceCart(base);
    const tenderBase = first.total - first.lines.reduce((s, l) => s + (l.isGiftCard ? l.netTotal : 0), 0);
    try {
      const { previewGiftCardTenders } = await import("@/lib/giftcards/service");
      giftCards = (await previewGiftCardTenders(store.id, codes, Math.max(0, tenderBase), { currency: store.currency, now })).cards;
    } catch (e) {
      if (e instanceof GiftCardError) {
        if (e.code === "invalid" || e.code === "empty") {
          await recordGiftCardCartFailure(cartKey);
          return { ok: false, error: GIFT_CARD_INVALID_MESSAGE, field: "giftCardCodes" };
        }
        return { ok: false, error: e.message, field: "giftCardCodes" };
      }
      throw e;
    }
  }
  const priced = priceCart({ ...base, giftCards: giftCards.map((g, i) => ({ id: `gc${i}`, last4: g.last4, balance: g.applied, expiresAt: null })), storeCredit });
  if (coupon && priced.couponError) return { ok: false, error: COUPON_INVALID, field: "couponCode" };

  const out: PreviewLine[] = priced.lines.map((l, i) => ({
    key: meta[i].key,
    name: l.name,
    variantName: l.variantName ?? null,
    optionNames: meta[i].optionNames,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    discountAllocated: l.discountAllocated,
    netTotal: l.netTotal,
    ...(l.isGiftCard ? { isGiftCard: true } : {}),
    ...(meta[i].backorder ? { backorder: true } : {}),
  }));
  const totals: PreviewTotals = {
    subtotal: priced.subtotal,
    discount: priced.discount,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    couponApplied: priced.couponApplied,
    automaticDiscount: priced.automaticDiscount,
    couponDiscount: priced.couponDiscount,
    loyaltyDiscount: priced.loyaltyDiscount,
    loyaltyPointsRedeemed: priced.loyaltyPointsRedeemed,
    giftCardAmount: priced.giftCardAmount,
    storeCreditAmount: priced.storeCreditAmount,
    amountDue: priced.amountDue,
    freeDelivery: priced.freeDelivery,
    couponSuperseded: priced.couponSuperseded,
    taxTotal: priced.taxTotal,
    taxesIncluded: priced.taxesIncluded,
    taxLines: priced.taxLines,
  };
  const presentment = await presentFor(db, store.id, priced, display.fx, tax);
  const discounts: PreviewDiscount[] = priced.discounts
    .map((d, i) => ({ d, shown: presentment?.discounts[i]?.amount }))
    .filter(({ d }) => d.amount > 0 || d.freeDelivery)
    .map(({ d, shown }) => ({ source: d.source, label: d.label, amount: d.amount, ...(d.freeDelivery ? { freeDelivery: true } : {}), ...(shown != null ? { presentedAmount: shown } : {}) }));

  return { ok: true, lines: out, totals, discounts, messages: priced.messages, giftCards, account, warnings, minOrderAmount: store.minOrderAmount, currency: store.currency, presentment, taxMention };
}

/* ───────────────────────── Passer commande ───────────────────────── */

/**
 * Crée la commande via `createOrder` (recalcul serveur, idempotence, stock, tenders) puis redirige :
 *  - GATEWAY avec un reste à payer → URL de paiement du fournisseur ;
 *  - sinon → page de confirmation `/s/{slug}/merci/{token}`.
 * Retourne uniquement en cas d'erreur (la redirection interrompt l'exécution).
 */
export async function placeOrder(raw: PlaceOrderInput): Promise<PlaceOrderResult> {
  const parsed = placeSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path ?? [];
    const field = path[0] === "customer" ? String(path[1] ?? "") : String(path[0] ?? "");
    return { ok: false, error: issue?.message ?? "Formulaire invalide.", field: field || undefined };
  }
  const input = parsed.data;
  const whatsapp = input.fulfillmentType === "WHATSAPP";
  const ip = await clientIp();
  const rl = await rateLimit(`order:ip:${ip}`, 10, 10 * 60);
  if (!rl.ok) return { ok: false, error: rateLimitMessage(rl.retryAfter) };

  // Arrêt d'urgence acheteurs : avoir et points refusés (le reste de la commande reste possible).
  if (input.useStoreCredit || (input.loyaltyPoints ?? 0) > 0) {
    const kill = await getBuyerKillSwitch(true);
    if (kill.enabled) return { ok: false, error: kill.message || ACCOUNT_SUSPENDED, field: input.useStoreCredit ? "storeCredit" : "loyaltyPoints" };
  }

  // Acheteur connecté par code (jamais déduit d'une saisie) : téléphone vérifié, points et avoir utilisables.
  const buyerStore = await db.store.findUnique({ where: { slug: input.storeSlug }, select: { id: true, slug: true, currency: true, subscription: true } });
  const buyer = buyerStore ? await getBuyer(buyerStore).catch(() => null) : null;
  // Lot 2 : devise d'affichage relue côté serveur (cookie axi_cur), jamais fournie par le formulaire.
  const display = buyerStore ? await getDisplayCurrency(buyerStore).catch(() => null) : null;

  // Cartes cadeaux : limites par IP et par panier avant toute recherche de code.
  const codes = (input.giftCardCodes ?? []).filter((c) => c !== "");
  const cartKey = input.cartToken ?? input.idempotencyKey;
  if (buyerStore && codes.length > 0) {
    const blocked = await giftCardGuard(buyerStore.id, ip, cartKey, codes);
    if (blocked) return { ok: false, error: blocked, field: "giftCardCodes" };
  }

  const result = await createOrder({
    storeSlug: input.storeSlug,
    idempotencyKey: input.idempotencyKey,
    items: input.items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity, optionIds: i.optionIds, giftCard: i.giftCard ?? null })),
    fulfillmentType: input.fulfillmentType,
    deliveryZoneId: input.fulfillmentType === "DELIVERY" ? input.deliveryZoneId ?? null : null,
    deliveryAddress: input.fulfillmentType === "DELIVERY" ? input.deliveryAddress ?? null : null,
    pickupSlotId: input.fulfillmentType === "PICKUP" ? input.pickupSlotId ?? null : null,
    customer: { name: input.customer.name, phone: input.customer.phone, email: input.customer.email || null, note: input.customer.note || null },
    couponCode: input.couponCode || null,
    paymentMethodId: whatsapp ? null : input.paymentMethodId ?? null,
    paymentReference: whatsapp ? null : input.paymentReference || null,
    paymentChannel: whatsapp ? null : input.paymentChannel ?? null,
    payerPhone: whatsapp ? null : input.payerPhone || null,
    marketingConsent: input.marketingConsent,
    channel: whatsapp ? "WHATSAPP" : "STORE",
    cartToken: input.cartToken ?? null,
    giftCardCodes: input.giftCardCodes ?? [],
    useStoreCredit: input.useStoreCredit ?? false,
    loyaltyPoints: input.loyaltyPoints ?? 0,
    buyerCustomerId: buyer?.customerId ?? null,
    attribution: input.attribution ?? null,
    presentmentCurrency: display && display.currency !== display.storeCurrency ? display.currency : null,
    locale: await requestOrderLocale(buyerStore),
    buyerCompany: input.buyerCompany || null,
    buyerTaxId: input.buyerTaxId || null,
  });

  if (!result.ok) {
    if (result.field === "giftCardCodes" && result.error === GIFT_CARD_INVALID_MESSAGE) await recordGiftCardCartFailure(cartKey);
    return { ok: false, error: result.field === "couponCode" ? COUPON_INVALID : result.error, field: result.field };
  }

  const thanksUrl = `/s/${input.storeSlug}/merci/${result.trackingToken}`;

  // Paiement en ligne du reste : initier auprès de la passerelle puis rediriger (les clés restent côté serveur).
  if (!whatsapp && input.paymentMethodId && result.amountDue > 0) {
    const method = await db.paymentMethod.findFirst({ where: { id: input.paymentMethodId, kind: "GATEWAY", store: { slug: input.storeSlug } }, select: { provider: true, storeId: true } });
    if (method) {
      // Retry idempotent après un paiement déjà confirmé : ne pas ré-initier.
      const order = await db.order.findUnique({ where: { id: result.orderId }, select: { paymentStatus: true } });
      if (order?.paymentStatus === "PAID") redirect(thanksUrl);
      const base = SITE.url.replace(/\/$/, "");
      const pay = await initiateGatewayPayment({
        orderId: result.orderId,
        storeId: method.storeId,
        returnUrl: `${base}${thanksUrl}`,
        cancelUrl: `${base}${thanksUrl}?paiement=annule`,
        callbackUrl: `${base}/api/webhooks/payments/${encodeURIComponent(method.provider ?? "unknown")}`,
      });
      if (!pay.ok) return { ok: false, error: `Votre commande ${result.reference} est enregistrée, mais le paiement en ligne n'a pas pu démarrer : ${pay.error}`, trackingToken: result.trackingToken };
      redirect(pay.redirectUrl);
    }
  }

  redirect(thanksUrl);
}

/* ───────────────────── Journal du clic WhatsApp ───────────────────── */

/**
 * Journalise une *tentative* d'envoi WhatsApp (clic sur le bouton wa.me). N'atteste jamais de l'envoi.
 * Le jeton de suivi sert d'autorisation : pas d'accès par id seul.
 */
export async function logWhatsappClick(orderId: string, trackingToken: string): Promise<{ ok: boolean }> {
  if (!/^[\w-]{8,64}$/.test(orderId) || !/^[0-9a-f]{16,128}$/.test(trackingToken)) return { ok: false };
  const order = await db.order.findFirst({ where: { id: orderId, trackingToken }, select: { id: true } });
  if (!order) return { ok: false };
  const recent = await db.orderEvent.count({ where: { orderId: order.id, type: "whatsapp_click", createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recent >= 5) return { ok: true }; // anti-spam : pas plus de 5 traces / minute
  await db.orderEvent.create({ data: { orderId: order.id, actorLabel: "Client", type: "whatsapp_click", message: "Clic sur « Envoyer la commande sur WhatsApp » (tentative, envoi non vérifié)" } });
  return { ok: true };
}
