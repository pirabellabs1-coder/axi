import "server-only";
import type { ReturnStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/auth/permissions";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { buyerResolutions, isItemReturnable, orderEligibility, parseReturnPolicy, remainingQuantities, type ReturnPolicy } from "./policy";

/**
 * Vues acheteur des retours (suivi par jeton, compte client). L'appelant a déjà prouvé la possession de la commande
 * (jeton de suivi valide ou session acheteur propriétaire) ; tout est filtré par `storeId` et `orderId`.
 * Les notes internes du commerçant ne sont jamais exposées.
 */

export type BuyerReturnItem = { id: string; name: string; variantName: string | null; unitPrice: number; remaining: number; returnable: boolean; image: string | null; variants: { id: string; name: string }[] };

export type BuyerReturnSummary = {
  id: string;
  reference: string;
  status: ReturnStatus;
  resolution: string;
  createdAt: Date;
  refundAmount: number;
  storeCreditAmount: number;
  rejectionReason: string | null;
  items: { name: string; variantName: string | null; quantity: number }[];
  events: { id: string; toStatus: ReturnStatus | null; createdAt: Date }[];
};

export type BuyerReturnView = {
  policy: ReturnPolicy;
  /** Libre-service ouvert : politique active, plan, boutique publiée. */
  portalOpen: boolean;
  eligible: boolean;
  eligibilityMessage: string | null;
  deadline: Date | null;
  resolutions: ("REFUND" | "STORE_CREDIT" | "EXCHANGE")[];
  items: BuyerReturnItem[];
  canRequest: boolean;
  returns: BuyerReturnSummary[];
};

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const url = (images as { url?: unknown }[]).map((i) => (typeof i?.url === "string" ? i.url : null)).find((u) => isDisplayableImageUrl(u));
  return url ?? null;
}

export async function getBuyerReturnView(storeId: string, orderId: string): Promise<BuyerReturnView | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, storeId },
    select: {
      id: true, status: true, deliveredAt: true,
      store: { select: { status: true, returnPolicy: true, subscription: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, name: true, variantName: true, variantId: true, unitPrice: true, quantity: true, isGiftCard: true, productId: true, product: { select: { tags: true, images: true } } } },
      returnRequests: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, reference: true, status: true, resolution: true, createdAt: true, refundAmount: true, storeCreditAmount: true, rejectionReason: true,
          items: { select: { orderItemId: true, quantity: true } },
          events: { orderBy: { createdAt: "asc" }, select: { id: true, toStatus: true, createdAt: true } },
        },
      },
    },
  });
  if (!order) return null;
  const policy = parseReturnPolicy(order.store.returnPolicy);
  const portalOpen = policy.enabled && order.store.status === "PUBLISHED" && PLANS[effectivePlanId(order.store.subscription)].features.returnsPortal;
  const elig = orderEligibility(order, policy);
  const remaining = remainingQuantities(
    order.items,
    order.returnRequests.flatMap((r) => r.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, status: r.status, returnId: r.id }))),
  );

  const productIds = [...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const variants = policy.allowExchange && productIds.length
    ? await db.variant.findMany({ where: { productId: { in: productIds }, available: true, product: { storeId, status: "ACTIVE" } }, orderBy: { position: "asc" }, select: { id: true, name: true, productId: true } })
    : [];

  const items: BuyerReturnItem[] = order.items.map((i) => ({
    id: i.id,
    name: i.name,
    variantName: i.variantName,
    unitPrice: i.unitPrice,
    remaining: remaining.get(i.id) ?? 0,
    returnable: isItemReturnable({ isGiftCard: i.isGiftCard, productTags: i.product?.tags ?? null }, policy),
    image: firstImage(i.product?.images),
    variants: variants.filter((v) => v.productId === i.productId && v.id !== i.variantId).map((v) => ({ id: v.id, name: v.name })),
  }));
  const nameOf = new Map(order.items.map((i) => [i.id, i]));
  const resolutions = buyerResolutions(policy);
  return {
    policy,
    portalOpen,
    eligible: elig.ok,
    eligibilityMessage: elig.ok ? null : elig.message,
    deadline: elig.ok ? elig.deadline : null,
    resolutions,
    items,
    canRequest: portalOpen && elig.ok && resolutions.length > 0 && items.some((i) => i.returnable && i.remaining > 0),
    returns: order.returnRequests.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt,
      refundAmount: r.refundAmount,
      storeCreditAmount: r.storeCreditAmount,
      rejectionReason: r.rejectionReason,
      items: r.items.map((i) => ({ name: nameOf.get(i.orderItemId)?.name ?? "Article", variantName: nameOf.get(i.orderItemId)?.variantName ?? null, quantity: i.quantity })),
      events: r.events,
    })),
  };
}

/** Lien « Retourner des articles » sur le suivi : affiché si un retour existe ou si le libre-service est ouvert. */
export async function trackingReturnLink(storeId: string, orderId: string): Promise<{ show: boolean; hasReturns: boolean }> {
  const [order, count] = await Promise.all([
    db.order.findFirst({ where: { id: orderId, storeId }, select: { status: true, deliveredAt: true, store: { select: { status: true, returnPolicy: true, subscription: true } } } }),
    db.returnRequest.count({ where: { storeId, orderId } }),
  ]);
  if (!order) return { show: false, hasReturns: false };
  const policy = parseReturnPolicy(order.store.returnPolicy);
  const open = policy.enabled && order.store.status === "PUBLISHED" && PLANS[effectivePlanId(order.store.subscription)].features.returnsPortal && orderEligibility(order, policy).ok;
  return { show: open || count > 0, hasReturns: count > 0 };
}
