import "server-only";
import type { FulfillmentType, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DeliveryInput } from "./pricing";
import { priceCart, type PipelineCoupon, type PipelineGiftCard, type PipelineLoyalty, type PricedCart } from "./checkout-pipeline";
import { CheckoutError, createOrderItemsTx, resolveLinesTx, type CheckoutItemInput } from "./checkout-lines";
import { canTransition, ORDER_STATUS_LABELS } from "./order-state";
import { checkOrdersQuota, incrementUsage } from "./quotas";
import { effectivePlanId } from "@/lib/auth/permissions";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { randomReference, randomToken, addDays, normalizePhone } from "@/lib/utils";
import { getCountry } from "@/config/site";
import { PLANS } from "@/config/plans";
import { restockPlan } from "./restock";
import { storeShowsStock } from "@/lib/storefront/stock-visibility";
import { collectionIdsByProduct, loadActiveAutomaticDiscounts, needsCollections, recordOfferConversionsTx } from "@/lib/discounts/service";
import { parseLoyaltyConfig } from "@/lib/loyalty/config";
import { giftCardOrderLimitError } from "@/lib/giftcards/state";
import { codRefusedMessage, summarizeCartKinds } from "@/lib/digital/kinds";
import { GiftCardError } from "@/lib/giftcards/errors";
import { StoreCreditError } from "@/lib/store-credit/errors";
import { canUseStoreCredit } from "@/lib/store-credit/rules";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { customerEventData } from "@/lib/customers/events";
import { chargePlan } from "@/lib/currency/payment";
import { formatMoney } from "@/lib/money";
import { giftCardForeignMessage, loadTaxSettings, presentFor, resolveDisplayFx } from "./checkout-context";
import { orderEventData } from "./domain-events";
import { missingWeightWarning, type ZoneFallback } from "@/lib/shipping/rates";
import { chooseZoneShipping } from "@/lib/shipping/zone-rate";

export { CheckoutError } from "./checkout-lines";
export type { CheckoutItemInput } from "./checkout-lines";

/** Portefeuille et numéro du payeur retenus pour la tentative (pur : ignorés s'ils ne correspondent pas au moyen). */
export function gatewayPayerOf(
  method: { kind: string; channels?: string[] | null } | null,
  channel: string | null | undefined,
  payerPhone: string | null | undefined,
  dialCode: string,
): { channel?: string; payerPhone?: string } {
  if (!method || method.kind !== "GATEWAY" || !channel || !(method.channels ?? []).includes(channel)) return {};
  const phone = payerPhone ? normalizePhone(payerPhone, dialCode) : null;
  if (payerPhone && !phone) throw new CheckoutError("Numéro du portefeuille invalide.", "payerPhone");
  return phone ? { channel, payerPhone: phone } : { channel };
}

export type CheckoutInput = {
  storeSlug: string;
  idempotencyKey: string;
  items: CheckoutItemInput[];
  fulfillmentType: FulfillmentType;
  deliveryZoneId?: string | null;
  deliveryAddress?: string | null;
  pickupSlotId?: string | null;
  scheduledFor?: Date | null;
  customer: { name: string; phone: string; email?: string | null; note?: string | null };
  couponCode?: string | null;
  paymentMethodId?: string | null;
  paymentReference?: string | null;
  /**
   * Lot 1 bis : portefeuille choisi par le client (moyen GATEWAY proposant ce portefeuille) et numéro à débiter,
   * pour la demande poussée (pawaPay). Ignorés s'ils ne correspondent pas au moyen ; sans eux, page hébergée.
   */
  paymentChannel?: string | null;
  payerPhone?: string | null;
  marketingConsent?: boolean;
  channel?: "STORE" | "WHATSAPP" | "MANUAL";
  cartToken?: string | null;
  /** Lot 1 — codes de cartes cadeaux (3 max), débités dans la transaction. */
  giftCardCodes?: string[];
  /** Lot 1 — utiliser l'avoir du client (acheteur connecté par code, ou commerçant). */
  useStoreCredit?: boolean;
  /** Lot 1 — points de fidélité à utiliser (acheteur connecté par code uniquement). */
  loyaltyPoints?: number;
  /**
   * Lot 1 — client de la session acheteur (`getBuyer(store)`), JAMAIS déduit d'une saisie : son téléphone
   * (vérifié) remplace celui du formulaire ; l'avoir et les points ne sont utilisables qu'avec lui (ou en commerçant).
   */
  buyerCustomerId?: string | null;
  /** Lot 1 — commande saisie par le commerçant (`customers.manage` vérifié par l'appelant) : avoir utilisable. */
  merchantCanUseStoreCredit?: boolean;
  /** Lot 1 — offres au panier ajoutées (ids `CartOffer`), mesurées dans `Order.attribution.offers`. */
  attribution?: { offers?: string[] } | null;
  /**
   * Lot 2 — devise d'affichage choisie par l'acheteur (cookie `axi_cur`, relu par l'appelant). Les montants sont
   * TOUJOURS calculés en devise boutique ; la devise d'affichage ne produit qu'un instantané `presentment*`.
   */
  presentmentCurrency?: string | null;
  /** Lot 2 (langues) — langue d'affichage de l'acheteur (segment d'URL, relu par l'appelant) : mémorisée sur la commande. */
  locale?: string | null;
  /** Lot 2 — facture au nom d'une entreprise (raison sociale, numéro fiscal IFU / NIF…). */
  buyerCompany?: string | null;
  buyerTaxId?: string | null;
};

export type CheckoutResult =
  | { ok: true; orderId: string; reference: string; trackingToken: string; total: number; amountDue: number; duplicate: boolean }
  | { ok: false; error: string; field?: string };

const MAX_REDEEM_FALLBACK = 50;

/** `maxRedeemPercent` (nouveau réglage de fidélité, défaut 50 %) lu de façon tolérante dans `Store.loyaltyConfig`. */
function maxRedeemPercent(raw: unknown): number {
  const v = raw && typeof raw === "object" ? (raw as { maxRedeemPercent?: unknown }).maxRedeemPercent : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100 ? v : MAX_REDEEM_FALLBACK;
}

function readCouponAppliesTo(raw: unknown): PipelineCoupon["appliesTo"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { productIds?: unknown; collectionIds?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  const productIds = ids(r.productIds);
  const collectionIds = ids(r.collectionIds);
  return productIds.length || collectionIds.length ? { productIds, collectionIds } : null;
}

/** Offres au panier déclarées par le panier serveur (Cart.attribution.offers) et la requête, dédoublonnées. */
function offerIdsFrom(...sources: unknown[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    const offers = s && typeof s === "object" ? (s as { offers?: unknown }).offers : undefined;
    if (Array.isArray(offers)) for (const o of offers) if (typeof o === "string") out.add(o);
  }
  return [...out];
}

/**
 * Création de commande : recalcul serveur intégral par le pipeline unique (`priceCart`), idempotence,
 * stock atomique, remises et tenders débités de façon conditionnelle, outbox. Aucun montant client n'est accepté.
 *
 * Stock (si suivi) : décrément CONDITIONNEL, sous verrou des lignes produit (voir checkout-lines.ts).
 * Compteurs (`usesCount` des remises et coupons), soldes de cartes, d'avoir et de points : décrément conditionnel
 * dans la même transaction ; un échec annule tout (§0.4).
 */
export async function createOrder(input: CheckoutInput): Promise<CheckoutResult> {
  try {
    const store = await db.store.findUnique({ where: { slug: input.storeSlug }, include: { subscription: true } });
    if (!store || store.status !== "PUBLISHED") throw new CheckoutError("Cette boutique n'accepte pas de commandes pour le moment.");
    if (!input.items.length) throw new CheckoutError("Votre panier est vide.");
    if (input.items.length > 50) throw new CheckoutError("Trop d'articles dans le panier.");

    // Idempotence : même clé → même commande
    const existing = await db.order.findUnique({ where: { storeId_idempotencyKey: { storeId: store.id, idempotencyKey: input.idempotencyKey } } });
    if (existing) return { ok: true, orderId: existing.id, reference: existing.reference, trackingToken: existing.trackingToken, total: existing.total, amountDue: existing.amountDue ?? existing.total, duplicate: true };

    // Acheteur connecté par code : son téléphone (vérifié) fait foi.
    const buyer = input.buyerCustomerId
      ? await db.customer.findFirst({ where: { id: input.buyerCustomerId, storeId: store.id }, select: { id: true, phone: true, loyaltyPoints: true, storeCreditBalance: true } })
      : null;
    if (input.buyerCustomerId && !buyer) throw new CheckoutError("Votre session a expiré. Reconnectez-vous ou commandez sans compte.");

    const country = getCountry(store.country);
    const phone = buyer ? buyer.phone : normalizePhone(input.customer.phone, country.dialCode);
    if (!phone) throw new CheckoutError("Numéro de téléphone invalide.", "phone");
    const name = input.customer.name.trim();
    if (name.length < 2) throw new CheckoutError("Indiquez votre nom.", "name");

    /**
     * Vague 2 — nature des articles commandés, lue AVANT les contrôles de mode : un panier sans aucun article
     * à expédier (numérique, service, carte cadeau) n'a ni livraison, ni retrait, ni adresse, quel que soit le
     * mode envoyé par la vitrine. Lecture indicative (sans verrou) : elle est refaite, ligne à ligne et sous
     * verrou, dans la transaction (`summarizeCartKinds(lines)`), qui reste la source de vérité.
     */
    const kindRows = await db.product.findMany({
      where: { id: { in: [...new Set(input.items.map((i) => i.productId))] }, storeId: store.id },
      select: { kind: true, isGiftCard: true },
    });
    const intangibleCart = kindRows.length > 0 && summarizeCartKinds(kindRows).digitalOnly;
    let fulfillmentType: FulfillmentType = intangibleCart && input.fulfillmentType !== "WHATSAPP" ? "DIGITAL" : input.fulfillmentType;
    let deliveryZoneId: string | null = input.deliveryZoneId ?? null;
    let deliveryAddress: string | null = input.deliveryAddress ?? null;

    if (fulfillmentType === "DELIVERY" && !store.deliveryEnabled) throw new CheckoutError("La livraison n'est pas disponible.");
    if (fulfillmentType === "PICKUP" && !store.pickupEnabled) throw new CheckoutError("Le retrait n'est pas disponible.");
    if (fulfillmentType === "WHATSAPP" && !store.whatsappOrdering) throw new CheckoutError("La commande WhatsApp n'est pas disponible.");

    let delivery: DeliveryInput = { type: fulfillmentType === "DELIVERY" ? "DELIVERY" : fulfillmentType === "WHATSAPP" ? "WHATSAPP" : "PICKUP", fee: 0 } as DeliveryInput;
    let zoneName: string | null = null;
    /** Lot 3 — forfait de la zone : repli si aucun tarif d'expédition ne s'applique (compatibilité). */
    let zoneFallback: ZoneFallback | null = null;
    if (fulfillmentType === "DELIVERY") {
      if (!deliveryZoneId) throw new CheckoutError("Choisissez une zone de livraison.", "deliveryZoneId");
      const zone = await db.deliveryZone.findFirst({ where: { id: deliveryZoneId, storeId: store.id, active: true } });
      if (!zone) throw new CheckoutError("Zone de livraison invalide.", "deliveryZoneId");
      if (!deliveryAddress || deliveryAddress.trim().length < 5) throw new CheckoutError("Indiquez une adresse ou un repère de livraison.", "deliveryAddress");
      delivery = { type: "DELIVERY", fee: zone.fee, freeAbove: zone.freeAbove };
      zoneName = zone.name;
      zoneFallback = { fee: zone.fee, freeAbove: zone.freeAbove, etaLabel: zone.etaLabel, name: zone.name };
    }

    // m8 : un créneau de retrait doit appartenir à la boutique (et être actif).
    let pickupSlotId: string | null = null;
    if (fulfillmentType === "PICKUP" && input.pickupSlotId) {
      const slot = await db.pickupSlot.findFirst({ where: { id: input.pickupSlotId, storeId: store.id, active: true }, select: { id: true } });
      if (!slot) throw new CheckoutError("Créneau de retrait invalide.", "pickupSlotId");
      pickupSlotId = slot.id;
    }

    const paymentMethod = input.paymentMethodId ? await db.paymentMethod.findFirst({ where: { id: input.paymentMethodId, storeId: store.id, active: true } }) : null;
    if (fulfillmentType !== "WHATSAPP" && input.paymentMethodId && !paymentMethod) throw new CheckoutError("Moyen de paiement invalide.", "paymentMethodId");
    // Lot 1 bis : portefeuille et numéro du payeur, seulement pour un moyen en ligne qui propose ce portefeuille.
    const gatewayPayer = gatewayPayerOf(paymentMethod, input.paymentChannel, input.payerPhone, country.dialCode);

    const planId = effectivePlanId(store.subscription);
    // Message d'erreur de stock : la quantité restante n'est citée que si le thème affiche le stock.
    const revealStock = input.channel === "MANUAL" || storeShowsStock(store);
    const now = new Date();

    // Lectures préalables hors transaction (aucune écriture) : remises actives, collections des produits.
    const automaticDiscounts = await loadActiveAutomaticDiscounts(store.id, planId, now);
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const collections = needsCollections(automaticDiscounts) || input.couponCode ? await collectionIdsByProduct(store.id, productIds) : new Map<string, string[]>();

    // Fidélité : acheteur connecté, programme actif, plan avec fidélité.
    const loyaltyCfg = parseLoyaltyConfig(store.loyaltyConfig);
    const wantsPoints = Math.max(0, Math.floor(input.loyaltyPoints ?? 0));
    if (wantsPoints > 0 && !buyer) throw new CheckoutError("Connectez-vous pour utiliser vos points.");
    const loyalty: PipelineLoyalty | null =
      buyer && wantsPoints > 0 && loyaltyCfg.enabled && PLANS[planId].features.loyalty
        ? { points: wantsPoints, balance: buyer.loyaltyPoints, rewardPoints: loyaltyCfg.rewardPoints, rewardValue: loyaltyCfg.rewardValue, maxRedeemPercent: maxRedeemPercent(store.loyaltyConfig) }
        : null;

    // Avoir : acheteur connecté par code, ou commerçant ; jamais en invité (téléphone saisi librement).
    let creditCustomerId: string | null = null;
    let creditAvailable = 0;
    if (input.useStoreCredit) {
      if (buyer) {
        creditCustomerId = buyer.id;
        creditAvailable = buyer.storeCreditBalance;
      } else if (input.merchantCanUseStoreCredit) {
        const c = await db.customer.findUnique({ where: { storeId_phone: { storeId: store.id, phone } }, select: { id: true, storeCreditBalance: true } });
        if (c) {
          creditCustomerId = c.id;
          creditAvailable = c.storeCreditBalance;
        }
      } else {
        throw new CheckoutError("Connectez-vous pour utiliser votre avoir.");
      }
      // Règle partagée avec l'équipe C : jamais d'avoir en invité.
      if (creditCustomerId && !canUseStoreCredit({ customerId: creditCustomerId, buyerSessionCustomerId: buyer?.id ?? null, merchant: input.merchantCanUseStoreCredit === true })) {
        throw new CheckoutError("Connectez-vous pour utiliser votre avoir.");
      }
    }

    const giftCardCodes = (input.giftCardCodes ?? []).filter((c) => typeof c === "string" && c.trim() !== "");
    const buyerCompany = input.buyerCompany?.trim().slice(0, 120) || null;
    const buyerTaxId = buyerCompany ? input.buyerTaxId?.trim().slice(0, 40) || null : null;

    const result = await db.$transaction(
      async (tx) => {
        const lines = await resolveLinesTx(tx, { storeId: store.id, items: input.items, now, revealStock, collections });

        const giftLines = lines.filter((l) => l.isGiftCard);
        if (giftLines.length > 0) {
          const limit = giftCardOrderLimitError(giftLines, store.currency);
          if (limit) throw new CheckoutError(limit);
        }
        // Vague 2 : règles déduites de la NATURE des lignes (recalculées serveur, jamais fournies par le client).
        const kinds = summarizeCartKinds(lines);
        // Remise après paiement confirmé (fichier ou carte cadeau) : paiement à la livraison refusé.
        if (kinds.prepaymentRequired && paymentMethod?.kind === "CASH_ON_DELIVERY") {
          throw new CheckoutError(codRefusedMessage(kinds), "paymentMethodId");
        }
        // Panier sans aucune ligne expédiée : remise `DIGITAL`, sans livraison, sans retrait, sans adresse
        // (le mode envoyé par la vitrine est ignoré : la nature des lignes fait foi).
        if (kinds.digitalOnly) {
          if (fulfillmentType !== "WHATSAPP") {
            fulfillmentType = "DIGITAL";
            delivery = { type: "PICKUP" };
          }
          zoneName = null;
          deliveryZoneId = null;
          deliveryAddress = null;
          pickupSlotId = null;
        } else if (fulfillmentType === "DIGITAL") {
          // Mode numérique demandé alors qu'un article doit partir : refus explicite.
          throw new CheckoutError("La remise numérique est réservée aux commandes sans article à livrer.");
        }

        let coupon: PipelineCoupon | null = null;
        if (input.couponCode) {
          const c = await tx.coupon.findUnique({ where: { storeId_code: { storeId: store.id, code: input.couponCode.trim().toUpperCase() } } });
          if (!c) throw new CheckoutError("Code promo invalide.", "couponCode");
          // Sérialise les commandes simultanées d'un même numéro sur ce code : les comptages ci-dessous
          // (maxUsesPerCustomer, firstOrderOnly) ne peuvent pas être lus deux fois avant écriture.
          if (c.maxUsesPerCustomer != null || c.firstOrderOnly) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${c.id}:${phone}`}))`;
          }
          if (c.maxUsesPerCustomer != null) {
            const used = await tx.couponRedemption.count({ where: { couponId: c.id, phone } });
            if (used >= c.maxUsesPerCustomer) throw new CheckoutError("Vous avez déjà utilisé ce code.", "couponCode");
          }
          if (c.firstOrderOnly) {
            // Première commande : contrôlé par téléphone (limite connue : un nouveau numéro contourne, documenté).
            const known = await tx.customer.findUnique({ where: { storeId_phone: { storeId: store.id, phone } }, select: { ordersCount: true } });
            const previous = await tx.order.count({ where: { storeId: store.id, customerPhone: phone, status: { not: "CANCELLED" } } });
            if ((known?.ordersCount ?? 0) > 0 || previous > 0) throw new CheckoutError("Ce code est réservé à une première commande.", "couponCode");
          }
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
            combinesWithAutomatic: c.combinesWithAutomatic ?? true,
            appliesTo: readCouponAppliesTo(c.appliesTo),
          };
        }

        // Lot 2 : devise d'affichage (cotation verrouillée du panier, sinon taux courant) et taxes de la boutique.
        // Cartes cadeaux refusées en devise étrangère (elles ne vivent qu'en devise boutique).
        const display = await resolveDisplayFx(tx, { store, currency: input.presentmentCurrency, cartToken: input.cartToken, now, persist: false });
        if (display.fx && giftCardCodes.length > 0) throw new CheckoutError(giftCardForeignMessage(store.currency), "giftCardCodes");
        const tax = await loadTaxSettings(tx, store);

        // Cartes cadeaux : verrou + contrôles AVANT lecture des soldes (§0.4).
        let giftCards: PipelineGiftCard[] = [];
        if (giftCardCodes.length > 0) {
          const { lockGiftCardsTx } = await import("@/lib/giftcards/service");
          const locked = await lockGiftCardsTx(tx, store.id, giftCardCodes, { currency: store.currency, now });
          giftCards = locked.map((c) => ({ id: c.id, last4: c.last4, balance: c.balance, expiresAt: c.expiresAt }));
        }

        /**
         * Lot 3 — tarifs d'expédition de la zone (poids et sous-total net), appliqués AVANT `priceCart` pour
         * que la TVA sur la livraison et les paliers travaillent sur les frais réellement facturés.
         * Le sous-total net vient d'un premier passage du pipeline SANS fidélité (les points n'interviennent
         * qu'après le choix du tarif, §0.2-6 : ils ne doivent jamais changer les frais de livraison).
         * Une zone SANS tarif actif conserve exactement le forfait `DeliveryZone.fee` (aucune régression).
         */
        let shippingRateId: string | null = null;
        let shippingRateName: string | null = null;
        let shippingWeightWarning: string | null = null;
        if (fulfillmentType === "DELIVERY" && deliveryZoneId && zoneFallback) {
          const probe = priceCart({ lines, delivery, coupon, automaticDiscounts, now, currency: store.currency, tax });
          const choice = await chooseZoneShipping(tx, {
            storeId: store.id,
            zoneId: deliveryZoneId,
            zone: zoneFallback,
            lines: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, isGiftCard: l.isGiftCard, kind: l.kind, netTotal: probe.lines[i].netTotal })),
          });
          if (choice.source === "rate") {
            // `freeAbove` est déjà tranché par le tarif (`ratePrice`) : ne pas le rejouer dans le pipeline.
            delivery = { type: "DELIVERY", fee: choice.fee, freeAbove: null };
            shippingRateId = choice.rateId;
            shippingRateName = choice.rateName;
            shippingWeightWarning = missingWeightWarning(choice.missingWeight);
          }
        }

        const priced: PricedCart = priceCart({ lines, delivery, coupon, automaticDiscounts, loyalty, giftCards, storeCredit: creditAvailable, now, currency: store.currency, tax });
        if (coupon && priced.couponError) throw new CheckoutError(priced.couponError, "couponCode");
        if (store.minOrderAmount > 0 && priced.subtotal < store.minOrderAmount) throw new CheckoutError(`Commande minimum : ${store.minOrderAmount} ${store.currency}.`);

        const quota = await checkOrdersQuota(store.id, planId, tx);

        // Conversion APRÈS le pipeline (seuils évalués en devise boutique), et devise d'encaissement.
        const presented = await presentFor(tx, store.id, priced, display.fx, tax);
        const charge = chargePlan({ method: paymentMethod, storeCurrency: store.currency, storeDue: priced.amountDue, presentment: presented });

        // Client (fiche par boutique, dédoublonnage par téléphone uniquement)
        // m8 : une fiche existante n'est jamais écrasée depuis le checkout (n'importe qui peut saisir
        // ce numéro) ; seuls les champs vides sont complétés. Les données saisies restent sur la commande.
        const known = await tx.customer.findUnique({ where: { storeId_phone: { storeId: store.id, phone } } });
        const customer = known
          ? await tx.customer.update({
              where: { id: known.id },
              data: {
                ...(!known.email && input.customer.email ? { email: input.customer.email } : {}),
                ...(!known.address && deliveryAddress ? { address: deliveryAddress } : {}),
              },
            })
          : await tx.customer.upsert({
              where: { storeId_phone: { storeId: store.id, phone } },
              create: { storeId: store.id, name, phone, email: input.customer.email || null, address: deliveryAddress || null },
              update: {},
            });
        // Lot 2 (W) : nouvelle fiche client (coordonnées sous `customer`, filtrées au fan-out).
        if (!known) await emitDomainEvent(tx, store.id, "customer.created", customerEventData(customer, { source: input.channel === "MANUAL" ? "manual_order" : "checkout" }));
        await tx.consent.create({ data: { customerId: customer.id, channel: "WHATSAPP", purpose: "TRANSACTIONAL", granted: true, source: "checkout" } });
        if (typeof input.marketingConsent === "boolean") {
          await tx.consent.create({ data: { customerId: customer.id, channel: "WHATSAPP", purpose: "MARKETING", granted: input.marketingConsent, source: "checkout" } });
        }

        // Référence unique par boutique (retry sur collision)
        let reference = randomReference("AX");
        for (let i = 0; i < 5; i++) {
          const clash = await tx.order.findUnique({ where: { storeId_reference: { storeId: store.id, reference } } });
          if (!clash) break;
          reference = randomReference("AX");
        }

        // Lot 3 — dépôts : quel dépôt sert chaque ligne (le stock AGRÉGÉ a déjà été décrémenté par
        // resolveLinesTx et reste la référence de disponibilité ; les niveaux suivent dans cette transaction).
        const { planOrderAllocation } = await import("@/lib/inventory/order-levels");
        const zoneLocationId = deliveryZoneId
          ? ((await tx.deliveryZone.findFirst({ where: { id: deliveryZoneId, storeId: store.id }, select: { locationId: true } }))?.locationId ?? null)
          : null;
        const allocation = await planOrderAllocation(tx, {
          storeId: store.id,
          lines: lines.map((l, i) => ({ lineId: String(i), productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, trackStock: l.trackStock })),
          zoneLocationId,
        });
        const orderLocationId = allocation.allocations[0]?.locationId ?? zoneLocationId ?? allocation.defaultLocationId;

        const couponApplied = coupon && priced.couponApplied ? coupon : null;
        const paid = priced.amountDue === 0;
        const paymentLabel = paymentMethod?.label ?? (fulfillmentType === "WHATSAPP" ? "À convenir sur WhatsApp" : null);
        const tenderNote = [
          priced.giftCardAmount > 0 ? `carte cadeau ${priced.giftCardAmount} ${store.currency}` : null,
          priced.storeCreditAmount > 0 ? `avoir ${priced.storeCreditAmount} ${store.currency}` : null,
        ].filter(Boolean);
        const discountNote = priced.discounts.filter((d) => d.amount > 0 || d.freeDelivery).map((d) => (d.freeDelivery && d.amount === 0 ? `${d.label} (livraison offerte)` : `${d.label} (−${d.amount} ${store.currency})`));

        const order = await tx.order.create({
          data: {
            storeId: store.id,
            customerId: customer.id,
            reference,
            idempotencyKey: input.idempotencyKey,
            trackingToken: randomToken(24),
            trackingExpiresAt: addDays(now, 90),
            fulfillmentType,
            channel: input.channel ?? "STORE",
            locale: input.locale ?? null, // lot 2 : notifications dans cette langue si un modèle existe
            customerName: name,
            customerPhone: phone,
            customerEmail: input.customer.email || null,
            deliveryAddress: deliveryAddress || null,
            deliveryZoneId: deliveryZoneId || null,
            deliveryZoneName: zoneName,
            // Lot 3 : instantané du tarif d'expédition retenu (null = forfait de zone).
            shippingRateId,
            shippingRateName,
            pickupSlotId,
            scheduledFor: input.scheduledFor ?? null,
            customerNote: input.customer.note || null,
            currency: store.currency,
            subtotal: priced.subtotal,
            discount: priced.discount,
            deliveryFee: priced.deliveryFee,
            total: priced.total,
            taxTotal: priced.taxTotal,
            taxesIncluded: priced.taxesIncluded,
            taxLines: priced.taxLines.length ? (priced.taxLines as unknown as Prisma.InputJsonValue) : undefined,
            buyerCompany,
            buyerTaxId,
            ...(presented
              ? {
                  presentmentCurrency: presented.currency,
                  presentmentRate: presented.rate,
                  presentmentTotal: presented.total,
                  presentmentAmounts: { ...presented, source: display.fx?.source ?? null, charge } as unknown as Prisma.InputJsonValue,
                }
              : {}),
            couponCode: couponApplied?.code ?? null,
            automaticDiscount: priced.automaticDiscount,
            loyaltyDiscount: priced.loyaltyDiscount,
            loyaltyPointsRedeemed: priced.loyaltyPointsRedeemed,
            giftCardAmount: priced.giftCardAmount,
            storeCreditAmount: priced.storeCreditAmount,
            amountDue: priced.amountDue,
            buyerVerified: !!buyer,
            paymentMethodId: paymentMethod?.id ?? null,
            paymentMethodLabel: paid && !paymentMethod ? (tenderNote.length ? "Carte cadeau / avoir" : paymentLabel) : paymentLabel,
            paymentReference: input.paymentReference || null,
            paymentStatus: paid ? "PAID" : paymentMethod && paymentMethod.kind !== "CASH_ON_DELIVERY" ? "PENDING" : "UNPAID",
            outOfQuota: !quota.allowed,
            locationId: orderLocationId,
            events: {
              create: [
                { actorLabel: "Client", type: "status_changed", toValue: "NEW", message: "Commande créée" },
                ...(lines.some((l) => l.backorder)
                  ? [{ actorLabel: "Système", type: "note", message: `Précommande (stock épuisé, expédition différée) : ${lines.filter((l) => l.backorder).map((l) => `${l.name}${l.variantName ? ` (${l.variantName})` : ""} × ${l.quantity}`).join(", ")}`.slice(0, 500) }]
                  : []),
                ...(discountNote.length ? [{ actorLabel: "Système", type: "note", message: `Remises appliquées : ${discountNote.join(" ; ")}`.slice(0, 500) }] : []),
                ...(shippingRateName ? [{ actorLabel: "Système", type: "note", message: `Tarif d'expédition « ${shippingRateName} » : ${priced.deliveryFee} ${store.currency}.${shippingWeightWarning ? ` ${shippingWeightWarning}` : ""}`.slice(0, 500) }] : []),
                ...(tenderNote.length ? [{ actorLabel: "Système", type: "note", message: `Réglé par ${tenderNote.join(" et ")}. Reste à payer : ${priced.amountDue} ${store.currency}.` }] : []),
                ...(presented
                  ? [{ actorLabel: "Système", type: "note", message: `Affiché en ${presented.currency} (taux ${presented.rate}) : total ${formatMoney(presented.total, presented.currency)}. ${charge.mention ?? `Encaissement en ${charge.currency}.`}`.slice(0, 500) }]
                  : []),
              ],
            },
          },
        });

        // Lignes (ids nécessaires aux allocations), mouvements de stock SALE.
        const itemIds = await createOrderItemsTx(tx, {
          storeId: store.id,
          orderId: order.id,
          lines: lines.map((l, i) => ({
            ...l,
            discountAllocated: priced.lines[i].discountAllocated,
            taxAmount: priced.lines[i].taxAmount,
            taxRateBps: priced.lines[i].taxRateBps,
            presentmentUnitPrice: presented?.lines[i]?.unitPrice ?? null,
          })),
          allocations: allocation.allocations,
          defaultLocationId: allocation.defaultLocationId,
        });

        // Détail des remises (retours, taxes et conversions s'appuient sur les allocations).
        for (const d of priced.discounts) {
          if (d.amount <= 0 && !d.freeDelivery) continue;
          await tx.orderDiscount.create({
            data: {
              orderId: order.id,
              storeId: store.id,
              source: d.source,
              automaticDiscountId: d.source === "automatic" ? d.id : null,
              couponId: d.source === "coupon" ? d.id : null,
              label: d.label.slice(0, 200),
              amount: d.amount,
              allocations: d.allocations.map((a) => ({ lineIndex: a.lineIndex, orderItemId: itemIds[a.lineIndex], amount: a.amount })) as Prisma.InputJsonValue,
            },
          });
        }

        // Remises automatiques : maxUses = nombre de commandes, incrément conditionnel.
        const autoMax = new Map(automaticDiscounts.map((a) => [a.id, a.maxUses ?? null]));
        for (const id of priced.appliedAutomaticIds) {
          const max = autoMax.get(id) ?? null;
          const used = await tx.automaticDiscount.updateMany({
            where: { id, storeId: store.id, active: true, ...(max != null ? { usesCount: { lt: max } } : {}) },
            data: { usesCount: { increment: 1 } },
          });
          if (used.count === 0) throw new CheckoutError("Une offre vient de se terminer : vérifiez votre panier et réessayez.");
        }

        if (couponApplied?.id) {
          // m5 : incrément conditionnel (deux commandes simultanées ne dépassent jamais maxUses).
          const used = await tx.coupon.updateMany({
            where: { id: couponApplied.id, active: true, ...(couponApplied.maxUses != null ? { usesCount: { lt: couponApplied.maxUses } } : {}) },
            data: { usesCount: { increment: 1 } },
          });
          if (used.count === 0) throw new CheckoutError("Ce code promo a atteint sa limite d'utilisation.", "couponCode");
          await tx.couponRedemption.create({ data: { couponId: couponApplied.id, orderId: order.id, phone, amount: priced.couponDiscount } });
        }

        // Points de fidélité (décrément conditionnel).
        if (priced.loyaltyPointsRedeemed > 0 && buyer) {
          const { redeemPointsTx } = await import("@/lib/loyalty/service");
          const r = await redeemPointsTx(tx, { storeId: store.id, customerId: buyer.id, points: priced.loyaltyPointsRedeemed, orderId: order.id });
          if (!r.ok) throw new CheckoutError("Votre solde de points a changé. Vérifiez votre commande et réessayez.");
        }

        // Tenders : cartes cadeaux (soldes verrouillés), puis avoir. Le débit doit égaler la répartition du pipeline.
        if (priced.giftCardAmount > 0) {
          const { redeemGiftCardsTx } = await import("@/lib/giftcards/service");
          const giftBase = priced.total - priced.lines.reduce((s, l) => s + (l.isGiftCard ? l.netTotal : 0), 0);
          const r = await redeemGiftCardsTx(tx, store.id, giftCardCodes, Math.min(giftBase, priced.giftCardAmount), { orderId: order.id, currency: store.currency, now });
          if (r.total !== priced.giftCardAmount) throw new CheckoutError("Le solde d'une carte cadeau vient de changer. Vérifiez votre commande et réessayez.", "giftCardCodes");
        }
        if (priced.storeCreditAmount > 0 && creditCustomerId) {
          const { redeemStoreCreditTx } = await import("@/lib/store-credit/service");
          await redeemStoreCreditTx(tx, store.id, creditCustomerId, priced.storeCreditAmount, { orderId: order.id });
        }

        // Paiement du reste : tentative créée EN DERNIER (initiateGatewayPayment lit la tentative la plus récente).
        if (paymentMethod && priced.amountDue > 0) {
          await tx.paymentAttempt.create({
            data: {
              orderId: order.id,
              paymentMethodId: paymentMethod.id,
              provider: paymentMethod.kind === "GATEWAY" ? (paymentMethod.provider ?? "gateway") : paymentMethod.kind === "CASH_ON_DELIVERY" ? "cash" : "manual",
              status: paymentMethod.kind === "CASH_ON_DELIVERY" ? "CREATED" : "PENDING",
              // Devise d'encaissement : boutique, sauf passerelle acceptant la devise d'affichage (voir currency/payment.ts).
              amount: charge.amount,
              currency: charge.currency,
              customerRef: input.paymentReference || null,
              ...gatewayPayer,
            },
          });
        }

        // Offres au panier : attribution et conversions (dans la transaction, idempotent par commande).
        let cartAttribution: unknown = null;
        if (input.cartToken) {
          const cart = await tx.cart.findFirst({ where: { token: input.cartToken, storeId: store.id }, select: { attribution: true } });
          cartAttribution = cart?.attribution ?? null;
        }
        const offerIds = offerIdsFrom(input.attribution, cartAttribution);
        if (offerIds.length > 0) {
          const kept = await recordOfferConversionsTx(tx, store.id, offerIds, priced.lines.map((l) => ({ productId: l.productId, netTotal: l.netTotal })));
          if (kept.length > 0) await tx.order.update({ where: { id: order.id }, data: { attribution: { offers: kept } } });
        }

        await tx.customer.update({ where: { id: customer.id }, data: { ordersCount: { increment: 1 }, totalSpent: { increment: priced.total }, lastOrderAt: now } });
        await incrementUsage(store.id, "orders", 1, tx);
        if (input.cartToken) await tx.cart.updateMany({ where: { token: input.cartToken, storeId: store.id }, data: { convertedOrderId: order.id } });
        await enqueue("order.created", { orderId: order.id }, { storeId: store.id }, tx);
        if (paid && priced.total > 0) await enqueue("payment.succeeded", { orderId: order.id, attemptId: null }, { storeId: store.id }, tx);
        // Webhooks sortants (outbox, même transaction) : charge minimale, sans coordonnées personnelles.
        const eventData = orderEventData(order);
        await emitDomainEvent(tx, store.id, "order.created", eventData);
        if (paid && priced.total > 0) await emitDomainEvent(tx, store.id, "order.paid", eventData);

        return { order, amountDue: priced.amountDue };
      },
      { isolationLevel: "ReadCommitted", timeout: 15000 },
    );

    return { ok: true, orderId: result.order.id, reference: result.order.reference, trackingToken: result.order.trackingToken, total: result.order.total, amountDue: result.amountDue, duplicate: false };
  } catch (e) {
    if (e instanceof CheckoutError) return { ok: false, error: e.message, field: e.field };
    if (e instanceof GiftCardError) return { ok: false, error: e.message, field: "giftCardCodes" };
    if (e instanceof StoreCreditError) return { ok: false, error: e.message === "Solde d'avoir insuffisant." ? "Votre solde d'avoir a changé. Vérifiez votre commande et réessayez." : e.message, field: "storeCredit" };
    // Course d'idempotence (deux requêtes simultanées) : renvoyer la commande existante
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      const store = await db.store.findUnique({ where: { slug: input.storeSlug }, select: { id: true } });
      const existing = store ? await db.order.findUnique({ where: { storeId_idempotencyKey: { storeId: store.id, idempotencyKey: input.idempotencyKey } } }) : null;
      if (existing) return { ok: true, orderId: existing.id, reference: existing.reference, trackingToken: existing.trackingToken, total: existing.total, amountDue: existing.amountDue ?? existing.total, duplicate: true };
    }
    console.error("[checkout]", e);
    return { ok: false, error: "Impossible de créer la commande. Réessayez." };
  }
}

/**
 * Transition de statut autorisée, auditée, avec restock et recrédit des tenders à l'annulation, et outbox.
 * `actorId` peut être null (transition automatique du système : remise d'une commande numérique).
 * `intangible` ouvre les transitions supplémentaires des commandes sans expédition (voir order-state.ts) ;
 * il est TOUJOURS revérifié ici sur les lignes réelles de la commande, jamais accordé sur simple demande.
 */
export type TransitionParams = { orderId: string; storeId: string; to: OrderStatus; actorId: string | null; actorLabel: string; reason?: string; intangible?: boolean };

export async function transitionOrder(params: TransitionParams) {
  const result = await transitionOrderTx(params);
  // Fidélité : points à la livraison, retirés à l'annulation / au remboursement (hors transaction, idempotent).
  try {
    const { awardLoyaltyForOrder, revokeLoyaltyForOrder } = await import("@/lib/loyalty/service");
    if (params.to === "DELIVERED") await awardLoyaltyForOrder(params.orderId);
    if (params.to === "CANCELLED" || params.to === "REFUNDED") await revokeLoyaltyForOrder(params.orderId);
  } catch (e) {
    console.error("[loyalty]", e);
    // Échec transitoire : relance par la file de jobs (backoff). Les deux traitements sont idempotents.
    if (params.to === "DELIVERED" || params.to === "CANCELLED" || params.to === "REFUNDED") {
      await enqueue("loyalty.sync", { orderId: params.orderId, to: params.to }, { storeId: params.storeId }).catch((err) =>
        console.error("[loyalty] mise en file impossible", (err as Error).message),
      );
    }
  }
  return result;
}

async function transitionOrderTx(params: TransitionParams) {
  const { orderId, storeId, to, actorId, actorLabel, reason } = params;
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, storeId }, include: { items: true } });
    if (!order) throw new Error("Commande introuvable");
    // Vague 2 : les transitions « sans expédition » ne sont ouvertes que si AUCUNE ligne n'est physique.
    const intangible = params.intangible === true && summarizeCartKinds(order.items).digitalOnly;
    if (!canTransition(order.status, to, { intangible })) throw new Error(`Transition impossible : ${ORDER_STATUS_LABELS[order.status]} → ${ORDER_STATUS_LABELS[to]}`);
    if (to === "REFUNDED" && order.paymentStatus !== "REFUNDED") throw new Error("Une commande ne passe en « Remboursée » qu'après un remboursement total enregistré dans le panneau Paiement.");

    const data: Prisma.OrderUpdateManyMutationInput = { status: to };
    if (to === "CONFIRMED") data.confirmedAt = new Date();
    if (to === "DELIVERED") data.deliveredAt = new Date();
    if (to === "CANCELLED") data.cancelledAt = new Date();

    // m7 : transition conditionnelle sur le statut lu. Deux transitions concurrentes (ex. double
    // annulation) ne peuvent pas s'appliquer toutes les deux (ni restocker deux fois).
    const moved = await tx.order.updateMany({ where: { id: orderId, storeId, status: order.status }, data });
    if (moved.count === 0) throw new Error("La commande a été modifiée entre-temps. Rechargez la page.");

    // Restock à l'annulation : on rend exactement ce que la commande a retiré (mouvements SALE de la commande,
    // net des CANCEL déjà écrits), y compris une survente (stock négatif) en politique CONTINUE.
    if (to === "CANCELLED") {
      const moves = await tx.inventoryMovement.findMany({ where: { storeId, orderId, reason: { in: ["SALE", "CANCEL"] } }, select: { productId: true, variantId: true, delta: true } });
      for (const r of restockPlan(moves, order.items)) {
        const p = await tx.product.findFirst({ where: { id: r.productId, storeId }, select: { trackStock: true, variants: { select: { id: true } } } });
        if (!p?.trackStock) continue;
        if (r.variantId) {
          const done = await tx.variant.updateMany({ where: { id: r.variantId, productId: r.productId }, data: { stock: { increment: r.quantity } } });
          if (done.count === 0) continue; // variante supprimée depuis : rien à restocker
        } else {
          // Mouvement sans variante alors que le produit en a désormais (variante supprimée) : ne pas gonfler le stock produit.
          if (p.variants.length > 0) continue;
          await tx.product.updateMany({ where: { id: r.productId, storeId }, data: { stock: { increment: r.quantity } } });
        }
        const move = await tx.inventoryMovement.create({ data: { storeId, productId: r.productId, variantId: r.variantId, delta: r.quantity, reason: "CANCEL", orderId, actorId }, select: { id: true } });
        // Lot 3 : restitution aux dépôts qui avaient servi la vente (sans effet si la vente est antérieure aux dépôts).
        const { creditOrderLevelsTx } = await import("@/lib/inventory/order-levels");
        await creditOrderLevelsTx(tx, { storeId, orderId, productId: r.productId, variantId: r.variantId, quantity: r.quantity, movementId: move.id });
      }

      // Lot 1 : recrédit des cartes cadeaux, de l'avoir et des points utilisés.
      // Seul le net NON DÉJÀ REMBOURSÉ est recrédité : les tenders encore débités (REDEEM − REVERSAL, les REVERSAL
      // des remboursements compris), plafonnés par le remboursable de la commande (refundableRemaining) : une valeur
      // déjà rendue (remboursement en avoir, retour en avoir…) ne l'est jamais une seconde fois.
      const notes: string[] = [];
      const hasTenders = (order.giftCardAmount ?? 0) > 0 || (order.storeCreditAmount ?? 0) > 0;
      if (hasTenders) {
        const { refundableRemaining } = await import("./refunds");
        const ledger = await refundableRemaining(tx, { id: orderId, storeId, total: order.total });
        let budget = ledger.remaining;
        if ((order.giftCardAmount ?? 0) > 0 && budget > 0 && ledger.ledger.outstanding.giftCards > 0) {
          const { reverseGiftCardsTx } = await import("@/lib/giftcards/service");
          const r = await reverseGiftCardsTx(tx, storeId, orderId, { amount: Math.min(budget, ledger.ledger.outstanding.giftCards), actorId, note: "Annulation de commande" });
          budget -= r.total;
          if (r.total > 0) notes.push(`cartes cadeaux recréditées (${r.total} ${order.currency})`);
        }
        if ((order.storeCreditAmount ?? 0) > 0 && budget > 0 && ledger.ledger.outstanding.storeCredit > 0) {
          const { reverseStoreCreditTx } = await import("@/lib/store-credit/service");
          const r = await reverseStoreCreditTx(tx, storeId, orderId, { amount: Math.min(budget, ledger.ledger.outstanding.storeCredit), actorId, note: "Annulation de commande" });
          if (r.total > 0) notes.push(`avoir recrédité (${r.total} ${order.currency})`);
        }
      }
      // Cartes cadeaux ACHETÉES par la commande : le solde non dépensé est retiré et les cartes désactivées
      // (l'émission future est bloquée par issueGiftCardsForOrder sur une commande annulée).
      if (order.items.some((i) => i.isGiftCard)) {
        const { neutralizePurchasedGiftCardsTx } = await import("@/lib/giftcards/service");
        const n = await neutralizePurchasedGiftCardsTx(tx, storeId, orderId, { actorId, note: "Commande annulée", disableAll: true });
        if (n.disabled > 0) notes.push(`${n.disabled} carte(s) cadeau achetée(s) désactivée(s), ${n.debited} ${order.currency} de solde retiré`);
      }
      if ((order.loyaltyPointsRedeemed ?? 0) > 0) {
        const { reverseRedeemedPointsTx } = await import("@/lib/loyalty/service");
        const r = await reverseRedeemedPointsTx(tx, { storeId, orderId });
        if (r.restored > 0) notes.push(`${r.restored} points rendus`);
      }
      if (notes.length) await tx.orderEvent.create({ data: { orderId, actorId, actorLabel: "Système", type: "note", message: `Annulation : ${notes.join(", ")}.` } });
    }

    await tx.orderEvent.create({ data: { orderId, actorId, actorLabel, type: "status_changed", fromValue: order.status, toValue: to, message: reason } });
    await audit({ storeId, actorId, action: "order.status_changed", target: orderId, metadata: { from: order.status, to, reason } }, tx);
    await enqueue("order.status_changed", { orderId, from: order.status, to }, { storeId }, tx);
    if (to === "DELIVERED") await enqueue("order.fulfilled", { orderId }, { storeId }, tx);
    // Webhooks sortants : changement de statut, et annulation dédiée (le remboursement est émis par requestRefund).
    const eventData = { ...orderEventData({ ...order, status: to }), from: order.status, to, reason: reason ?? null };
    await emitDomainEvent(tx, storeId, "order.status_changed", eventData);
    if (to === "CANCELLED") await emitDomainEvent(tx, storeId, "order.cancelled", eventData);
    return { from: order.status, to };
  });
}
