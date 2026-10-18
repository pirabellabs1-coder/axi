import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { addDays, randomReference, randomToken } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { formatRate, invert } from "@/lib/currency/convert";
import { createOrderItemsTx, type LineAmounts, type ResolvedLine } from "@/lib/commerce/checkout-lines";
import { orderEventData } from "@/lib/commerce/domain-events";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { platformRate } from "./fx";
import { marketFor } from "./markets";
import { SIMPLE_KEY } from "./mapping";
import type { TtsConfig } from "./model";
import { CANCELLED_STATUS, IMPORTABLE_STATUSES, idempotencyKeyFor, planOrder, usablePhone, type SkuTarget } from "./order-plan";
import type { TiktokOrder } from "./types";

/**
 * Import des commandes TikTok Shop en commandes Axi (webhook + rattrapage périodique).
 *
 * Idempotence STRUCTURELLE : `Order.idempotencyKey = "tiktok_shop:{id TikTok}"`, unique par boutique
 * (@@unique([storeId, idempotencyKey])). Deux imports concurrents (webhook et relève) : le second échoue sur la
 * contrainte (P2002), sa transaction est annulée (stock compris) et il est compté comme doublon.
 *
 * Stock : la vente a déjà eu lieu (payée dans TikTok) ; le décrément est INCONDITIONNEL (une survente éventuelle
 * est signalée dans l'historique de la commande), sous verrou des lignes produit, avec mouvements SALE et niveaux
 * de dépôts via `createOrderItemsTx` — l'annulation (transitionOrder) rend exactement ce qui a été retiré.
 * Commandes expédiées par TikTok (FULFILLMENT_BY_TIKTOK) : pas de décrément (stock détenu par TikTok).
 *
 * Canal : l'énumération `OrderChannel` n'a pas (encore) de valeur TikTok — modification de schéma soumise à accord.
 * La commande est enregistrée en canal MANUAL, référence « TT-… », `attribution.source = "tiktok_shop"`.
 */

export type ImportOutcome = "imported" | "duplicate" | "skipped" | "cancelled" | "unchanged";

type Attribution = { source: "tiktok_shop"; tiktok: { orderId: string; shopId: string | null; region: string | null; fulfilledBy: "seller" | "tiktok"; lineItems: Record<string, string[]>; deliveryOptionId: string | null } };

export function isTiktokAttribution(v: unknown): v is Attribution {
  return !!v && typeof v === "object" && (v as { source?: unknown }).source === "tiktok_shop";
}

/** Index SKU TikTok → produit/variante Axi, construit UNIQUEMENT depuis les liens de cette boutique (isolation). */
export function skuResolver(config: TtsConfig): (skuId: string, sellerSku: string | null) => SkuTarget | null {
  const byId = new Map<string, SkuTarget>();
  for (const [productId, link] of Object.entries(config.products)) {
    for (const [key, skuId] of Object.entries(link.skus)) byId.set(skuId, { productId, variantId: key === SIMPLE_KEY ? null : key });
  }
  return (skuId) => byId.get(skuId) ?? null;
}

async function cancelImported(storeId: string, o: TiktokOrder): Promise<ImportOutcome> {
  const order = await db.order.findFirst({ where: { storeId, idempotencyKey: idempotencyKeyFor(o.id) }, select: { id: true, status: true } });
  if (!order) return "skipped"; // jamais importée : rien n'a été retiré du stock
  if (order.status === "CANCELLED" || order.status === "REFUNDED") return "unchanged";
  const { transitionOrder } = await import("@/lib/commerce/orders");
  try {
    await transitionOrder({ orderId: order.id, storeId, to: "CANCELLED", actorId: null, actorLabel: "TikTok Shop", reason: "Commande annulée dans TikTok Shop (remboursement géré par TikTok)." });
    return "cancelled";
  } catch (e) {
    // Ex. commande déjà livrée : on trace sans forcer une transition interdite.
    await db.orderEvent.create({ data: { orderId: order.id, actorLabel: "TikTok Shop", type: "note", message: `Annulation TikTok non appliquée automatiquement : ${(e as Error).message}`.slice(0, 500) } });
    return "unchanged";
  }
}

export async function importTiktokOrder(storeId: string, o: TiktokOrder, config: TtsConfig, now = new Date()): Promise<ImportOutcome> {
  if (!o.id || !/^[\w-]{1,64}$/.test(o.id)) return "skipped";
  if (o.status === CANCELLED_STATUS) return cancelImported(storeId, o);
  if (!IMPORTABLE_STATUSES.has(o.status) || !o.lineItems.length) return "skipped";

  const key = idempotencyKeyFor(o.id);
  const existing = await db.order.findFirst({ where: { storeId, idempotencyKey: key }, select: { id: true } });
  if (existing) return "duplicate";

  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, currency: true } });
  if (!store) return "skipped";
  const market = (o.payment.currency || marketFor(config.shop?.region)?.currency || store.currency).toUpperCase();
  const fx = await platformRate(market, store.currency, now);
  const plan = planOrder(o, { storeCurrency: store.currency, region: config.shop?.region ?? null, resolveSku: skuResolver(config), rate: fx.rate });

  const phone = usablePhone(o.recipient.phone);
  const name = (o.recipient.name || "Client TikTok").trim().slice(0, 120);
  const address = o.recipient.fullAddress.trim().slice(0, 500) || null;

  try {
    return await db.$transaction(async (tx) => {
      // Produits de la boutique uniquement (un SKU d'une autre boutique ne peut pas être résolu : index par boutique).
      const productIds = [...new Set(plan.lines.map((l) => l.target?.productId).filter((x): x is string => !!x))];
      if (productIds.length) await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(productIds)}) AND "storeId" = ${storeId} ORDER BY id FOR UPDATE`;
      const products = productIds.length
        ? await tx.product.findMany({ where: { id: { in: productIds }, storeId }, select: { id: true, trackStock: true, kind: true, isGiftCard: true, taxable: true, taxCategory: true, stock: true, variants: { select: { id: true, stock: true } } } })
        : [];
      const notes: string[] = [];
      const resolved: (ResolvedLine & LineAmounts & { lineItemIds: string[] })[] = [];
      const unmapped: typeof plan.lines = [];

      for (const l of plan.lines) {
        const prod = l.target ? products.find((p) => p.id === l.target!.productId) : undefined;
        const variant = prod && l.target?.variantId ? prod.variants.find((v) => v.id === l.target!.variantId) : undefined;
        if (!prod || (l.target?.variantId && !variant)) {
          unmapped.push(l);
          continue;
        }
        const trackStock = plan.sellerFulfilled && prod.trackStock && prod.kind === "PHYSICAL" && !prod.isGiftCard;
        if (trackStock) {
          if (variant) await tx.variant.updateMany({ where: { id: variant.id, productId: prod.id }, data: { stock: { decrement: l.quantity } } });
          else await tx.product.updateMany({ where: { id: prod.id, storeId }, data: { stock: { decrement: l.quantity } } });
          const before = variant ? variant.stock : prod.stock;
          if (before < l.quantity) notes.push(`${l.name}${l.variantName ? ` (${l.variantName})` : ""} : stock insuffisant dans Axi (${before}), survente de ${l.quantity - Math.max(0, before)}.`);
        }
        resolved.push({
          productId: prod.id,
          variantId: variant?.id ?? null,
          name: l.name,
          variantName: l.variantName,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          options: [],
          collectionIds: [],
          isGiftCard: false,
          kind: "PHYSICAL",
          onSale: false,
          taxable: prod.taxable !== false,
          taxCategory: prod.taxCategory ?? "standard",
          trackStock,
          backorder: false,
          storedOptions: [],
          presentmentUnitPrice: plan.presentment ? l.marketUnitPrice : null,
          lineItemIds: l.lineItemIds,
        });
      }
      if (unmapped.length) notes.push(`Articles non reliés à un produit Axi (stock non modifié) : ${unmapped.map((l) => `${l.name} × ${l.quantity}`).join(", ")}.`);

      const customer = phone
        ? await tx.customer.upsert({ where: { storeId_phone: { storeId, phone } }, create: { storeId, name, phone, address }, update: {} })
        : null;

      let reference = randomReference("TT");
      for (let i = 0; i < 5; i++) {
        if (!(await tx.order.findUnique({ where: { storeId_reference: { storeId, reference } }, select: { id: true } }))) break;
        reference = randomReference("TT");
      }

      let allocations: { lineId: string; locationId: string; quantity: number }[] = [];
      let defaultLocationId: string | null = null;
      try {
        const { planOrderAllocation } = await import("@/lib/inventory/order-levels");
        const planned = await planOrderAllocation(tx, { storeId, lines: resolved.map((l, i) => ({ lineId: String(i), productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, trackStock: l.trackStock })) });
        allocations = planned.allocations;
        defaultLocationId = planned.defaultLocationId;
      } catch {
        // Niveaux de dépôts incohérents : la vente est enregistrée sans affectation (réconciliation quotidienne).
      }

      const breakdown = plan.presentment
        ? `Payé dans TikTok : ${formatMoney(plan.presentment.total, plan.presentment.currency)} (livraison ${formatMoney(plan.presentment.shipping, plan.presentment.currency)}, remises vendeur ${formatMoney(plan.presentment.sellerDiscount, plan.presentment.currency)}, remises TikTok ${formatMoney(plan.presentment.platformDiscount, plan.presentment.currency)}). Converti en ${plan.storeCurrency} au taux ${fx.source}.`
        : `Payé dans TikTok : ${formatMoney(plan.total, plan.storeCurrency)}.`;

      const order = await tx.order.create({
        data: {
          storeId,
          customerId: customer?.id ?? null,
          reference,
          idempotencyKey: key,
          trackingToken: randomToken(24),
          trackingExpiresAt: addDays(now, 90),
          status: "CONFIRMED",
          confirmedAt: now,
          paymentStatus: "PAID",
          fulfillmentType: "DELIVERY",
          channel: "MANUAL",
          customerName: name,
          customerPhone: phone ?? "",
          // Coordonnées de messagerie TikTok non utilisées : contact hors plateforme interdit par TikTok.
          customerEmail: null,
          deliveryAddress: address,
          customerNote: o.buyerMessage ? o.buyerMessage.slice(0, 500) : null,
          currency: plan.storeCurrency,
          subtotal: plan.subtotal,
          discount: plan.discount,
          deliveryFee: plan.deliveryFee,
          total: plan.total,
          amountDue: 0,
          taxTotal: plan.taxTotal,
          taxesIncluded: plan.taxesIncluded,
          ...(plan.presentment
            ? {
                presentmentCurrency: plan.presentment.currency,
                presentmentRate: formatRate(invert(fx.rate)),
                presentmentTotal: plan.presentment.total,
                presentmentAmounts: { source: `tiktok_shop:${fx.source}`, ...plan.presentment } as unknown as Prisma.InputJsonValue,
              }
            : {}),
          paymentMethodLabel: "TikTok Shop",
          paymentReference: o.id,
          locationId: allocations[0]?.locationId ?? defaultLocationId,
          attribution: {
            source: "tiktok_shop",
            tiktok: { orderId: o.id, shopId: config.shop?.id ?? null, region: config.shop?.region ?? null, fulfilledBy: plan.sellerFulfilled ? "seller" : "tiktok", lineItems: {}, deliveryOptionId: o.deliveryOptionId },
          } satisfies Attribution as unknown as Prisma.InputJsonValue,
          events: {
            create: [
              { actorLabel: "TikTok Shop", type: "status_changed", toValue: "CONFIRMED", message: `Commande TikTok Shop n° ${o.id} (${o.status}), déjà payée.` },
              { actorLabel: "Système", type: "note", message: breakdown.slice(0, 500) },
              ...(plan.sellerFulfilled ? [] : [{ actorLabel: "Système", type: "note", message: "Expédiée par TikTok (Fulfilled by TikTok) : stock Axi non modifié, aucune expédition à saisir." }]),
              ...notes.map((m) => ({ actorLabel: "Système", type: "note", message: m.slice(0, 500) })),
            ],
          },
        },
        select: { id: true, reference: true, status: true, paymentStatus: true, currency: true, subtotal: true, discount: true, deliveryFee: true, total: true, channel: true, fulfillmentType: true, createdAt: true, taxTotal: true, taxesIncluded: true, amountDue: true, presentmentCurrency: true, presentmentTotal: true },
      });

      const itemIds = resolved.length
        ? await createOrderItemsTx(tx, { storeId, orderId: order.id, lines: resolved, allocations, defaultLocationId })
        : [];
      const lineItems: Record<string, string[]> = {};
      itemIds.forEach((id, i) => (lineItems[id] = resolved[i].lineItemIds));
      for (const l of unmapped) {
        const item = await tx.orderItem.create({
          data: { orderId: order.id, productId: null, variantId: null, name: l.name, variantName: l.variantName, unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.unitPrice * l.quantity, presentmentUnitPrice: plan.presentment ? l.marketUnitPrice : null },
          select: { id: true },
        });
        lineItems[item.id] = l.lineItemIds;
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          attribution: {
            source: "tiktok_shop",
            tiktok: { orderId: o.id, shopId: config.shop?.id ?? null, region: config.shop?.region ?? null, fulfilledBy: plan.sellerFulfilled ? "seller" : "tiktok", lineItems, deliveryOptionId: o.deliveryOptionId },
          } satisfies Attribution as unknown as Prisma.InputJsonValue,
        },
      });
      if (customer) await tx.customer.update({ where: { id: customer.id }, data: { ordersCount: { increment: 1 }, totalSpent: { increment: plan.total }, lastOrderAt: now } });

      await audit({ storeId, actorId: null, action: "tiktok_shop.order_imported", target: order.id, metadata: { tiktokOrderId: o.id, total: plan.total, currency: plan.storeCurrency } }, tx);
      await enqueue("order.created", { orderId: order.id }, { storeId }, tx);
      await emitDomainEvent(tx, storeId, "order.created", orderEventData(order));
      return "imported" as const;
    });
  } catch (e) {
    // Contrainte d'unicité : doublon SEULEMENT si la commande existe bien (sinon collision de référence → job retenté).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const already = await db.order.findFirst({ where: { storeId, idempotencyKey: key }, select: { id: true } });
      if (already) return "duplicate";
    }
    throw e;
  }
}
