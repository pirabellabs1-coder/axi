import "server-only";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { checkQuantity, effectivePrice } from "./pricing";
import type { PipelineLine } from "./checkout-pipeline";
import { pickOrderVariant } from "@/lib/storefront/variants";
import { kindTracksStock, productKindOf } from "@/lib/digital/kinds";

/**
 * Résolution serveur des lignes d'un panier (partagée par createOrder et createExchangeOrder) :
 * produits verrouillés (SELECT … FOR UPDATE), variantes, options, bornes min/max, stock agrégé, décrément
 * CONDITIONNEL (politique DENY : jamais négatif ; CONTINUE : précommande). Aucun montant client n'est utilisé.
 */

export type GiftCardRecipientInput = {
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  message?: string | null;
  sendAt?: string | null;
};

export type CheckoutItemInput = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  optionIds?: string[];
  /** Ligne carte cadeau : destinataire (stocké dans OrderItem.options, lu par l'émission). */
  giftCard?: GiftCardRecipientInput | null;
};

export type ResolvedLine = PipelineLine & {
  trackStock: boolean;
  backorder: boolean;
  /** Valeur de OrderItem.options : suppléments, plus `{ giftCard }` pour une carte cadeau. */
  storedOptions: Prisma.InputJsonValue;
};

export class CheckoutError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** Prix unitaire normatif (§0.2-1) : prix de variante, sinon promo datée, sinon prix ; plus les suppléments. */
export function unitPricing(
  p: { price: number; promoPrice?: number | null; promoStart?: Date | null; promoEnd?: Date | null },
  variant: { price: number | null } | null,
  selected: readonly { priceDelta: number }[],
  now: Date,
): { unitPrice: number; onSale: boolean } {
  const eff = effectivePrice(p, now);
  const base = variant?.price ?? eff.price;
  return { unitPrice: base + selected.reduce((s, o) => s + o.priceDelta, 0), onSale: variant?.price == null && eff.isPromo };
}

function recipientOptions(r: GiftCardRecipientInput | null | undefined) {
  if (!r) return null;
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return { recipientName: s(r.recipientName, 80), recipientPhone: s(r.recipientPhone, 20), recipientEmail: s(r.recipientEmail, 160), message: s(r.message, 300), sendAt: s(r.sendAt, 40) };
}

export async function resolveLinesTx(
  tx: Tx,
  p: { storeId: string; items: CheckoutItemInput[]; now: Date; revealStock: boolean; collections: ReadonlyMap<string, string[]> },
): Promise<ResolvedLine[]> {
  const { storeId, items, now, revealStock } = p;
  const productIds = [...new Set(items.map((i) => i.productId))];
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`;
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, storeId, status: "ACTIVE" },
    include: { variants: true, optionGroups: { include: { options: true } } },
  });
  const lines: ResolvedLine[] = [];
  // m6 : un même produit peut apparaître sur plusieurs lignes (options différentes) ; min/max et
  // stock sont contrôlés sur la quantité AGRÉGÉE par produit et par variante.
  const qtyByProduct = new Map<string, number>();
  const qtyByVariant = new Map<string, number>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10_000) throw new CheckoutError("Quantité invalide.");
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
    if (item.variantId) qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const checkedProducts = new Set<string>();

  for (const item of items) {
    const prod = products.find((x) => x.id === item.productId);
    if (!prod) throw new CheckoutError("Un article n'est plus disponible.");
    // Variante inconnue ou désactivée (available: false) → refus.
    const picked = pickOrderVariant(prod, item.variantId);
    if (!picked.ok) throw new CheckoutError(picked.error);
    const variant = picked.variant;

    // Politique de rupture : celle de la variante, sinon celle du produit simple.
    const policy = variant ? variant.inventoryPolicy : prod.inventoryPolicy;
    const aggregated = variant ? (qtyByVariant.get(variant.id) ?? item.quantity) : (qtyByProduct.get(prod.id) ?? item.quantity);
    const available = variant ? variant.stock : prod.stock;
    // Nature du produit (vague 2) : DIGITAL et GIFT_CARD n'ont jamais de stock ; SERVICE peut en avoir
    // (places limitées) ; PHYSICAL inchangé. Carte cadeau : pas de suivi de stock (lot 1 §3).
    const kind = productKindOf(prod);
    const trackStock = prod.trackStock && kindTracksStock(kind);
    const qtyErr = checkQuantity({ name: prod.name, minQty: 1, maxQty: null, trackStock, stock: available, inventoryPolicy: policy }, aggregated, { revealStock });
    if (qtyErr) throw new CheckoutError(qtyErr);
    if (!checkedProducts.has(prod.id)) {
      checkedProducts.add(prod.id);
      const totalErr = checkQuantity({ name: prod.name, minQty: prod.minQty, maxQty: prod.maxQty, trackStock: false, stock: 0 }, qtyByProduct.get(prod.id) ?? item.quantity);
      if (totalErr) throw new CheckoutError(totalErr);
    }

    // Options : groupes obligatoires / bornes
    const selected: { name: string; priceDelta: number }[] = [];
    for (const g of prod.optionGroups) {
      const chosen = g.options.filter((o) => item.optionIds?.includes(o.id));
      if (g.required && chosen.length < Math.max(1, g.minSelect)) throw new CheckoutError(`Choisissez « ${g.name} » pour ${prod.name}.`);
      if (chosen.length > g.maxSelect) throw new CheckoutError(`Trop d'options pour « ${g.name} » (${prod.name}).`);
      for (const o of chosen) selected.push({ name: o.name, priceDelta: o.priceDelta });
    }

    const { unitPrice, onSale } = unitPricing(prod, variant, selected, now);
    const backorder = trackStock && policy === "CONTINUE" && aggregated > available;
    const recipient = prod.isGiftCard ? recipientOptions(item.giftCard) : null;
    const storedOptions = (recipient ? [...selected, { giftCard: recipient }] : selected) as unknown as Prisma.InputJsonValue;
    lines.push({
      productId: prod.id,
      variantId: variant?.id ?? null,
      name: prod.name,
      variantName: variant?.name ?? null,
      unitPrice,
      quantity: item.quantity,
      options: selected,
      collectionIds: p.collections.get(prod.id) ?? [],
      isGiftCard: prod.isGiftCard,
      kind,
      onSale,
      // Lot 2 : champs fiscaux (une carte cadeau est exonérée par le pipeline, quelle que soit sa catégorie).
      taxable: prod.taxable !== false,
      taxCategory: prod.taxCategory ?? "standard",
      trackStock,
      backorder,
      storedOptions,
    });

    if (trackStock) {
      // DENY : stock suffisant exigé ; CONTINUE : décrément sans condition de stock (peut devenir négatif).
      const sellable = { OR: [{ stock: { gte: item.quantity } }, { inventoryPolicy: "CONTINUE" as const }] };
      if (variant) {
        const r = await tx.variant.updateMany({ where: { id: variant.id, productId: prod.id, ...sellable }, data: { stock: { decrement: item.quantity } } });
        if (r.count === 0) throw new CheckoutError(`Stock insuffisant pour ${prod.name} (${variant.name}).`);
      } else {
        const r = await tx.product.updateMany({ where: { id: prod.id, storeId, ...sellable }, data: { stock: { decrement: item.quantity } } });
        if (r.count === 0) throw new CheckoutError(`Stock insuffisant pour ${prod.name}.`);
      }
    }
  }
  return lines;
}

/** Montants par ligne issus du pipeline (remises allouées) et du lot 2 (taxes, prix affiché converti). */
export type LineAmounts = { discountAllocated?: number; taxAmount?: number; taxRateBps?: number | null; presentmentUnitPrice?: number | null };

/**
 * Crée les OrderItem dans l'ordre des lignes (ids nécessaires aux allocations) et les mouvements de stock SALE.
 *
 * Lot 3 — dépôts : `allocations` (clé = index de ligne, produite par `planOrderAllocation`) répartit chaque
 * ligne entre dépôts. Un mouvement SALE est alors écrit PAR DÉPÔT, avec son `locationId`, et le niveau du
 * dépôt est décrémenté dans la même transaction (le stock agrégé l'a déjà été par `resolveLinesTx`).
 * Sans allocation (boutique sans dépôt), le comportement d'origine est conservé à l'identique.
 */
export async function createOrderItemsTx(
  tx: Tx,
  p: {
    storeId: string;
    orderId: string;
    lines: readonly (ResolvedLine & LineAmounts)[];
    actorId?: string | null;
    allocations?: readonly { lineId: string; locationId: string; quantity: number }[];
    defaultLocationId?: string | null;
  },
): Promise<string[]> {
  const ids: string[] = [];
  let index = -1;
  for (const l of p.lines) {
    index += 1;
    const lineAllocations = (p.allocations ?? []).filter((a) => a.lineId === String(index));
    const primaryLocationId = lineAllocations[0]?.locationId ?? p.defaultLocationId ?? null;
    const item = await tx.orderItem.create({
      data: {
        orderId: p.orderId,
        productId: l.productId,
        variantId: l.variantId ?? null,
        name: l.name,
        variantName: l.variantName ?? null,
        options: l.storedOptions,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.unitPrice * l.quantity,
        isGiftCard: l.isGiftCard,
        // Instantané de la nature vendue (vague 2) : le produit peut changer de nature ensuite.
        kind: l.kind ?? "PHYSICAL",
        discountAllocated: l.discountAllocated ?? 0,
        taxAmount: l.taxAmount ?? 0,
        taxRateBps: l.taxRateBps ?? null,
        presentmentUnitPrice: l.presentmentUnitPrice ?? null,
        locationId: primaryLocationId,
      },
      select: { id: true },
    });
    ids.push(item.id);
    if (l.trackStock) {
      if (lineAllocations.length) {
        const { applyLevelDeltaTx } = await import("@/lib/inventory/levels");
        for (const a of lineAllocations) {
          await tx.inventoryMovement.create({
            data: { storeId: p.storeId, productId: l.productId, variantId: l.variantId ?? null, locationId: a.locationId, delta: -a.quantity, reason: "SALE", orderId: p.orderId, actorId: p.actorId ?? null },
          });
          await applyLevelDeltaTx(tx, { storeId: p.storeId, locationId: a.locationId, productId: l.productId, variantId: l.variantId ?? null, delta: -a.quantity });
        }
      } else {
        await tx.inventoryMovement.create({ data: { storeId: p.storeId, productId: l.productId, variantId: l.variantId ?? null, delta: -l.quantity, reason: "SALE", orderId: p.orderId, actorId: p.actorId ?? null } });
      }
    }
  }
  return ids;
}
