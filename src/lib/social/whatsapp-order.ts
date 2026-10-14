import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { effectivePrice } from "@/lib/commerce/pricing";
import { canSell } from "@/lib/inventory/policy";
import { formatMoney } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { CreditError, queueOutboundMessage, scheduleDispatch } from "@/lib/inbox/service";
import { appBaseUrl } from "./sync";

/**
 * Retour de commande depuis WhatsApp (catalogue Meta, Meta Business Agent) : un acheteur envoie un panier du
 * catalogue (message webhook `type: "order"`). Axi crée un lien de panier (même mécanisme que `create_checkout_link`
 * et les liens de relance : Cart + `/s/{slug}?panier={jeton}`) et répond au client avec ce lien dans la conversation.
 * L'acheteur finalise sur la boutique (livraison, paiement) : prix et stock recalculés par le pipeline de commande.
 *
 * Isolation : les `product_retailer_id` (variantId ?? productId) ne sont résolus que parmi les produits ACTIFS de la
 * boutique propriétaire du numéro (routage du webhook par Integration.phoneNumberId). Le prix annoncé par Meta
 * (`item_price`) n'est jamais utilisé.
 */

const orderSchema = z.object({
  catalog_id: z.string().max(64).optional(),
  text: z.string().max(1000).optional(),
  product_items: z
    .array(
      z.object({
        product_retailer_id: z.string().min(1).max(100),
        quantity: z.coerce.number().int().min(1).max(999).catch(1),
      }),
    )
    .min(1)
    .max(50),
});

export type WhatsappOrder = z.infer<typeof orderSchema>;

export function parseWhatsappOrder(raw: unknown): WhatsappOrder | null {
  const r = orderSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Texte de la boîte de réception pour un message « order ». */
export function catalogOrderSummary(raw: unknown): string {
  const order = parseWhatsappOrder(raw);
  if (!order) return "[Panier WhatsApp reçu]";
  const units = order.product_items.reduce((s, i) => s + i.quantity, 0);
  const note = order.text?.trim() ? ` ${order.text.trim()}` : "";
  return `[Panier WhatsApp reçu] ${units} article${units > 1 ? "s" : ""}${note}`.slice(0, 4000);
}

type Line = { productId: string; variantId: string | null; quantity: number; name: string; unitPrice: number };

export type ResolvedOrder = { lines: Line[]; unavailable: number };

/** Résout les articles du panier WhatsApp parmi le catalogue ACTIF de la boutique (quantités cumulées par article). */
export async function resolveOrderItems(storeId: string, order: WhatsappOrder, now = new Date()): Promise<ResolvedOrder> {
  const qty = new Map<string, number>();
  for (const i of order.product_items) qty.set(i.product_retailer_id, Math.min(999, (qty.get(i.product_retailer_id) ?? 0) + i.quantity));
  const ids = [...qty.keys()].filter((id) => /^[A-Za-z0-9_-]{8,64}$/.test(id));
  if (!ids.length) return { lines: [], unavailable: order.product_items.length };

  const [variants, products] = await Promise.all([
    db.variant.findMany({
      where: { id: { in: ids }, product: { storeId, status: "ACTIVE", isGiftCard: false } },
      select: { id: true, name: true, price: true, available: true, stock: true, inventoryPolicy: true, productId: true },
    }),
    db.product.findMany({
      where: { storeId, status: "ACTIVE", isGiftCard: false, id: { in: ids } },
      select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, trackStock: true, stock: true, inventoryPolicy: true, minQty: true, maxQty: true, variants: { select: { id: true } } },
    }),
  ]);
  // Produits parents des variantes trouvées (même boutique, vérifiée par la requête ci-dessus).
  const parentIds = [...new Set(variants.map((v) => v.productId))].filter((id) => !products.some((p) => p.id === id));
  const parents = parentIds.length
    ? await db.product.findMany({
        where: { storeId, status: "ACTIVE", id: { in: parentIds } },
        select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, trackStock: true, stock: true, inventoryPolicy: true, minQty: true, maxQty: true, variants: { select: { id: true } } },
      })
    : [];
  const allProducts = [...products, ...parents];

  const lines: Line[] = [];
  let unavailable = 0;
  for (const [id, quantity] of qty) {
    const v = variants.find((x) => x.id === id);
    const p = v ? allProducts.find((x) => x.id === v.productId) : allProducts.find((x) => x.id === id && x.variants.length === 0);
    if (!p) {
      unavailable++;
      continue;
    }
    const stockItem = { trackStock: p.trackStock, stock: v ? v.stock : p.stock, policy: String(v ? v.inventoryPolicy : p.inventoryPolicy) };
    if ((v && !v.available) || !canSell(stockItem, 1)) {
      unavailable++;
      continue;
    }
    // Quantité ramenée dans les bornes du produit ; l'acheteur peut l'ajuster sur la boutique.
    const q = Math.max(p.minQty, p.maxQty != null ? Math.min(quantity, p.maxQty) : quantity);
    lines.push({ productId: p.id, variantId: v?.id ?? null, quantity: q, name: v ? `${p.name} (${v.name})` : p.name, unitPrice: v?.price ?? effectivePrice(p, now).price });
  }
  return { lines, unavailable };
}

export function buildOrderReply(p: { storeName: string; url: string | null; lines: Line[]; unavailable: number; currency: string; closed?: boolean }): string {
  if (p.closed) return `Merci pour votre panier ! ${p.storeName} est fermée temporairement et ne prend pas de commande pour le moment. Nous revenons vers vous dès la réouverture.`;
  if (!p.url || !p.lines.length) {
    return `Merci pour votre panier ! Les articles choisis ne sont plus disponibles chez ${p.storeName}. Répondez à ce message et nous vous proposerons une alternative.`;
  }
  const total = p.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const out = [
    "Merci pour votre panier ! Finalisez votre commande ici (livraison et paiement) :",
    p.url,
    "",
    ...p.lines.map((l) => `▪ ${l.quantity} × ${l.name} : ${formatMoney(l.unitPrice * l.quantity, p.currency)}`),
    `Total indicatif : ${formatMoney(total, p.currency)} (prix et frais confirmés à la commande)`,
  ];
  if (p.unavailable > 0) out.push("", `${p.unavailable} article${p.unavailable > 1 ? "s" : ""} indisponible${p.unavailable > 1 ? "s" : ""} retiré${p.unavailable > 1 ? "s" : ""} du panier.`);
  return out.join("\n");
}

export type CatalogOrderResult = { status: "replied" | "link_only" | "ignored"; cartToken?: string; reason?: string };

/**
 * Traite un message « order » déjà enregistré dans la boîte de réception (le webhook a vérifié la signature,
 * l'idempotence par id de message et la boutique). Erreurs : à journaliser par l'appelant, sans relancer Meta.
 */
export async function handleCatalogOrderMessage(p: { storeId: string; phone: string; messageId: string; order: unknown }, now = new Date()): Promise<CatalogOrderResult> {
  const order = parseWhatsappOrder(p.order);
  if (!order) return { status: "ignored", reason: "Panier illisible" };
  const phone = p.phone.replace(/\D/g, "");
  if (!/^\d{6,15}$/.test(phone)) return { status: "ignored", reason: "Numéro invalide" };

  const store = await db.store.findUnique({ where: { id: p.storeId }, select: { id: true, slug: true, name: true, currency: true, status: true, subscription: true } });
  if (!store) return { status: "ignored", reason: "Boutique introuvable" };
  const features = PLANS[effectivePlanId(store.subscription, now)].features;
  if (!features.catalogSync && !features.catalogFeeds) return { status: "ignored", reason: "Plan" };
  if (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY") return { status: "ignored", reason: "Boutique non publiée" };

  // Anti-abus : un même numéro ne génère pas plus de 10 paniers en 10 minutes (le message reste dans la boîte).
  const rl = await rateLimit(`wa-order:${store.id}:${phone}`, 10, 600);
  if (!rl.ok) return { status: "ignored", reason: "Trop de paniers" };

  const conversation = await db.conversation.findUnique({ where: { storeId_phone_channel: { storeId: store.id, phone, channel: "whatsapp" } }, select: { id: true } });
  if (!conversation) return { status: "ignored", reason: "Conversation introuvable" };

  const closed = store.status === "CLOSED_TEMPORARILY";
  const resolved = closed ? { lines: [], unavailable: 0 } : await resolveOrderItems(store.id, order, now);

  let token: string | null = null;
  if (resolved.lines.length) {
    token = randomToken(16);
    await db.cart.create({
      data: {
        storeId: store.id,
        token,
        attribution: { source: "whatsapp_catalog", messageId: p.messageId.slice(0, 190) } as Prisma.InputJsonValue,
        items: { create: resolved.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })) },
      },
    });
  }
  const body = buildOrderReply({ storeName: store.name, url: token ? `${appBaseUrl()}/s/${store.slug}?panier=${token}` : null, lines: resolved.lines, unavailable: resolved.unavailable, currency: store.currency, closed });
  const base = { storeId: store.id, conversationId: conversation.id, phone, body, authorId: null, creditType: "WA_UTILITY" as const, template: "catalog.order_link" };
  try {
    // Envoi par l'API (crédit débité dans la même transaction que le message ; tout est annulé si le solde manque).
    await db.$transaction(async (tx) => {
      await queueOutboundMessage(tx, { ...base, apiActive: true });
      await scheduleDispatch(store.id, tx);
    });
    return { status: "replied", cartToken: token ?? undefined };
  } catch (e) {
    if (!(e instanceof CreditError)) throw e;
  }
  // Crédits insuffisants : réponse préparée (lien wa.me) visible dans la boîte, à envoyer par le commerçant.
  await db.$transaction((tx) => queueOutboundMessage(tx, { ...base, apiActive: false }));
  return { status: "link_only", cartToken: token ?? undefined };
}
