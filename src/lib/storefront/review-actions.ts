"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";

/**
 * Avis client déposé depuis la page de suivi d'une commande LIVRÉE.
 * Autorisation : le jeton de suivi (jamais l'id seul). Un avis par commande et par produit.
 * L'avis est créé en PENDING : il n'apparaît sur la boutique qu'après modération du marchand.
 * Le nom est repris de la commande (aucune saisie libre d'identité).
 */
const schema = z.object({
  token: z.string().regex(/^[0-9a-f]{16,128}$/, "Lien de suivi invalide."),
  productId: z.string().min(8).max(64),
  rating: z.coerce.number({ error: "Choisissez une note." }).int().min(1, "Choisissez une note de 1 à 5.").max(5, "Choisissez une note de 1 à 5."),
  body: z.string().trim().min(10, "Écrivez au moins 10 caractères.").max(1000, "1 000 caractères maximum."),
});

export async function submitReview(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const { token, productId, rating, body } = parsed.data;
    const rl = await rateLimit(`review:ip:${await clientIp()}`, 5, 3600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const order = await db.order.findUnique({
      where: { trackingToken: token },
      select: { id: true, storeId: true, status: true, customerName: true, trackingExpiresAt: true, items: { select: { productId: true } }, store: { select: { slug: true, status: true } } },
    });
    if (!order || order.trackingExpiresAt.getTime() < Date.now()) return fail("Ce lien de suivi n'est plus valable.");
    if (order.store.status !== "PUBLISHED" && order.store.status !== "CLOSED_TEMPORARILY") return fail("Cette boutique n'accepte plus d'avis.");
    if (order.status !== "DELIVERED") return fail("Vous pourrez donner votre avis une fois la commande livrée.");
    if (!order.items.some((i) => i.productId === productId)) return fail("Ce produit ne fait pas partie de la commande.");

    // Le produit doit appartenir à la même boutique (isolation).
    const product = await db.product.findFirst({ where: { id: productId, storeId: order.storeId }, select: { id: true } });
    if (!product) return fail("Ce produit n'est plus disponible.");

    // Vérification + création atomiques : verrou transactionnel par (commande, produit) contre les doubles envois.
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review:${order.id}:${productId}`}))`;
      const existing = await tx.review.findFirst({ where: { storeId: order.storeId, orderId: order.id, productId }, select: { id: true } });
      if (existing) return false;
      await tx.review.create({
        data: { storeId: order.storeId, orderId: order.id, productId, customerName: order.customerName.slice(0, 80), rating, body, status: "PENDING" },
      });
      return true;
    });
    if (!created) return fail("Vous avez déjà donné votre avis sur ce produit. Merci !");
    revalidatePath(`/suivi/${token}`);
    return success(undefined, "Merci ! Votre avis sera publié après validation par la boutique.");
  });
}
