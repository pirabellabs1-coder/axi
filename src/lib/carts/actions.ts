"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { getCountry } from "@/config/site";
import { normalizePhone, randomToken } from "@/lib/utils";
import { cancelCartCheck, scheduleCartCheck } from "./service";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { customerEventData } from "@/lib/customers/events";

/**
 * Brouillon de checkout (boutique publique, sans compte). À appeler depuis le formulaire de
 * commande quand le client a saisi son téléphone (au blur du champ, puis à chaque changement de
 * panier, avec un anti-rebond côté client). Le panier est recalculé côté serveur au moment de la
 * relance ; aucun montant client n'est utilisé.
 */

const tokenRe = /^[0-9a-f]{32}$/;

const itemSchema = z.object({
  productId: z.string().min(8).max(64),
  variantId: z.string().min(8).max(64).nullable().optional(),
  optionIds: z.array(z.string().min(8).max(64)).max(30).default([]),
  quantity: z.number().int().min(1).max(999),
});

const draftSchema = z.object({
  cartToken: z.string().regex(tokenRe).nullable().optional(),
  items: z.array(itemSchema).max(50),
  customer: z.object({ name: z.string().trim().max(80).default(""), phone: z.string().trim().max(20).default("") }),
  marketingConsent: z.boolean().default(false),
});

export type CheckoutDraftInput = z.input<typeof draftSchema>;
export type CheckoutDraftResult = { ok: true; cartToken: string; reminder: boolean } | { ok: false; error: string };

export async function saveCheckoutDraft(slug: string, payload: CheckoutDraftInput): Promise<CheckoutDraftResult> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{3,48}$/.test(slug)) return { ok: false, error: "Boutique introuvable." };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Panier invalide." };
  const input = parsed.data;

  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `cart-draft:ip:${ip}`, limit: 40, windowSec: 10 * 60 },
    { key: `cart-draft:slug:${slug}:ip:${ip}`, limit: 20, windowSec: 10 * 60 },
  ]);
  if (!rl.ok) return { ok: false, error: rateLimitMessage(rl.retryAfter) };

  const store = await db.store.findUnique({ where: { slug }, select: { id: true, status: true, country: true } });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return { ok: false, error: "Boutique indisponible." };

  // Seuls les articles réellement en vente dans CETTE boutique sont conservés.
  const products = await db.product.findMany({
    where: { id: { in: [...new Set(input.items.map((i) => i.productId))] }, storeId: store.id, status: "ACTIVE" },
    select: { id: true, variants: { select: { id: true } }, optionGroups: { select: { options: { select: { id: true, name: true, priceDelta: true } } } } },
  });
  const items = input.items.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    if (!p) return [];
    const variantId = i.variantId && p.variants.some((v) => v.id === i.variantId) ? i.variantId : null;
    if (p.variants.length > 0 && !variantId) return [];
    const options = p.optionGroups.flatMap((g) => g.options).filter((o) => i.optionIds.includes(o.id)).map((o) => ({ optionId: o.id, name: o.name, priceDelta: o.priceDelta }));
    return [{ productId: p.id, variantId, quantity: i.quantity, options }];
  });

  const dial = getCountry(store.country)?.dialCode ?? "229";
  const phone = input.customer.phone ? normalizePhone(input.customer.phone, dial) : null;
  const name = input.customer.name.trim();
  const wantsReminder = input.marketingConsent && !!phone && items.length > 0;

  const result = await db.$transaction(async (tx) => {
    let cart = input.cartToken ? await tx.cart.findUnique({ where: { token: input.cartToken }, select: { id: true, storeId: true, token: true, convertedOrderId: true } }) : null;
    // Jeton d'une autre boutique ou panier déjà converti : nouveau panier.
    if (!cart || cart.storeId !== store.id || cart.convertedOrderId) {
      cart = await tx.cart.create({ data: { storeId: store.id, token: randomToken(16) }, select: { id: true, storeId: true, token: true, convertedOrderId: true } });
    } else {
      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    }
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    if (items.length) {
      await tx.cartItem.createMany({ data: items.map((i) => ({ cartId: cart!.id, productId: i.productId, variantId: i.variantId, quantity: i.quantity, options: i.options as unknown as Prisma.InputJsonValue })) });
    }

    if (!wantsReminder) {
      await cancelCartCheck(tx, store.id, cart.id);
      return { token: cart.token, reminder: false };
    }

    // Consentement explicite : fiche client (jamais écrasée, comme au checkout) + preuve du consentement.
    const known = await tx.customer.findUnique({ where: { storeId_phone: { storeId: store.id, phone: phone! } }, select: { id: true, name: true } });
    const customer = known ?? (await tx.customer.create({ data: { storeId: store.id, phone: phone!, name: name || `+${phone}` }, select: { id: true, name: true } }));
    if (!known) await emitDomainEvent(tx, store.id, "customer.created", customerEventData({ id: customer.id, name: customer.name, phone }, { source: "cart_reminder" })); // Lot 2 (W)
    const last = await tx.consent.findFirst({ where: { customerId: customer.id, channel: "WHATSAPP", purpose: "MARKETING" }, orderBy: { createdAt: "desc" }, select: { granted: true } });
    if (last?.granted !== true) {
      await tx.consent.create({ data: { customerId: customer.id, channel: "WHATSAPP", purpose: "MARKETING", granted: true, source: "checkout_draft" } });
    }
    await scheduleCartCheck(tx, { storeId: store.id, cartId: cart.id, customerId: customer.id, phone: phone!, name: name || customer.name });
    return { token: cart.token, reminder: true };
  });

  return { ok: true, cartToken: result.token, reminder: result.reminder };
}

export type CartDraftItem = { productId: string; variantId: string | null; optionIds: string[]; quantity: number };

/**
 * Reprise d'un panier depuis le lien de relance (`/s/{slug}?panier={token}`). Renvoie uniquement
 * les articles encore en vente ; le client retrouve son panier sans ses coordonnées.
 */
export async function loadCartDraft(slug: string, token: string): Promise<{ ok: true; items: CartDraftItem[] } | { ok: false; error: string }> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{3,48}$/.test(slug) || typeof token !== "string" || !tokenRe.test(token)) return { ok: false, error: "Lien de panier invalide." };
  const rl = await rateLimitAll([{ key: `cart-load:ip:${await clientIp()}`, limit: 60, windowSec: 10 * 60 }]);
  if (!rl.ok) return { ok: false, error: rateLimitMessage(rl.retryAfter) };
  const cart = await db.cart.findFirst({
    where: { token, store: { slug } },
    select: { convertedOrderId: true, items: { select: { productId: true, variantId: true, quantity: true, options: true, product: { select: { status: true } } } } },
  });
  if (!cart) return { ok: false, error: "Ce panier n'existe plus." };
  if (cart.convertedOrderId) return { ok: false, error: "Ce panier a déjà été commandé." };
  const items = cart.items
    .filter((i) => i.product.status === "ACTIVE")
    .map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      optionIds: Array.isArray(i.options) ? (i.options as { optionId?: string }[]).map((o) => o.optionId).filter((x): x is string => typeof x === "string") : [],
    }));
  return { ok: true, items };
}
