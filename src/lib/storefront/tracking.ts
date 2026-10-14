import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/**
 * Commande publique par jeton de suivi (jamais par id). Renvoie `expired` si le lien a dépassé `trackingExpiresAt`.
 * Les notes internes et le détail des autres commandes ne sont jamais exposés.
 */
export const getPublicOrderByToken = cache(async (token: string) => {
  if (!/^[0-9a-f]{16,128}$/.test(token)) return null;
  const order = await db.order.findUnique({
    where: { trackingToken: token },
    include: {
      items: { orderBy: { id: "asc" } },
      events: { where: { type: { in: ["status_changed", "payment_changed"] } }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, fromValue: true, toValue: true, createdAt: true } },
      store: { select: { id: true, slug: true, name: true, status: true, timezone: true, whatsappNumber: true, whatsappOrdering: true, logoUrl: true, themeId: true, sector: true, themeConfig: true, address: true, city: true, contactPhone: true } },
    },
  });
  if (!order) return null;
  const expired = order.trackingExpiresAt.getTime() < Date.now();
  const paymentMethod = order.paymentMethodId
    ? await db.paymentMethod.findFirst({ where: { id: order.paymentMethodId, storeId: order.storeId }, select: { kind: true, label: true, instructions: true, accountNumber: true, accountName: true } })
    : null;
  return { order, expired, paymentMethod };
});

/** Produits de la commande déjà notés par le client (un avis par commande et par produit). */
export async function getReviewedProductIds(orderId: string): Promise<Set<string>> {
  const rows = await db.review.findMany({ where: { orderId }, select: { productId: true } });
  return new Set(rows.map((r) => r.productId).filter((x): x is string => !!x));
}
