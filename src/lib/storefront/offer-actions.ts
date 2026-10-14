"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/auth/permissions";
import { effectivePrice } from "@/lib/commerce/pricing";
import { collectionIdsByProduct, getCartOffers } from "@/lib/discounts/service";
import { matchUpgradeSelection, readVariantAttributes } from "@/lib/discounts/upgrade";
import { canSell, isSellable } from "@/lib/inventory/policy";
import { PLANS } from "@/config/plans";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import type { OfferCard } from "./render-types";

/**
 * Lot 1 (équipe E) : offres au panier (placement CART ou CHECKOUT) pour le contenu du panier local.
 * Lecture publique, débit limité, isolée par boutique ; aucun montant n'est calculé ici pour la commande
 * (les prix affichés sont indicatifs, le serveur recalcule tout dans previewTotals / createOrder).
 */
const schema = z.object({
  storeSlug: z.string().min(3).max(48),
  placement: z.enum(["CART", "CHECKOUT"]),
  productIds: z.array(z.string().min(8).max(64)).max(50),
});

export async function loadCartOffers(raw: z.input<typeof schema>): Promise<OfferCard[]> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data.productIds.length === 0) return [];
  const rl = await rateLimit(`offers:ip:${await clientIp()}`, 120, 10 * 60);
  if (!rl.ok) return [];
  const store = await db.store.findUnique({ where: { slug: parsed.data.storeSlug }, select: { id: true, status: true, subscription: true } });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return [];
  const ids = [...new Set(parsed.data.productIds)];
  const offers = await getCartOffers({ id: store.id, planId: effectivePlanId(store.subscription) }, parsed.data.placement, { contextProductIds: ids, cartProductIds: ids });
  if (offers.length === 0) return [];
  const extra = await db.product.findMany({
    where: { storeId: store.id, id: { in: offers.map((o) => o.productId) } },
    select: { id: true, minQty: true, optionGroups: { where: { required: true }, select: { id: true } } },
  });
  const now = new Date();
  return offers.map((o) => {
    const p = o.product;
    const e = extra.find((x) => x.id === p.id);
    const { price, isPromo } = effectivePrice(p, now);
    const images = Array.isArray(p.images) ? (p.images as { url?: unknown }[]) : [];
    const image = images.map((i) => (typeof i?.url === "string" ? i.url : null)).find((u): u is string => !!u && isDisplayableImageUrl(u)) ?? null;
    return {
      offerId: o.offerId,
      title: o.title,
      mode: o.mode,
      product: { id: p.id, slug: p.slug, name: p.name, price, compareAt: isPromo ? p.price : null, image, simple: !p.hasVariants && (e?.optionGroups.length ?? 0) === 0, minQty: e?.minQty ?? 1 },
    };
  });
}

/* ───────────────────────── Montée en gamme (mode « replace ») ───────────────────────── */

const zId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const upgradeSchema = z.object({
  storeSlug: z.string().min(3).max(48),
  offerId: zId,
  productId: zId,
  lines: z
    .array(z.object({ key: z.string().min(1).max(400), productId: zId, variantId: zId.nullable(), optionIds: z.array(zId).max(30), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50),
});

export type UpgradeLine = {
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  snapshot: { name: string; variantName: string | null; unitPrice: number; image: string | null; productSlug: string; optionNames: string[] };
};

/** `replaced` : la ligne `key` du panier est à remplacer par `line` ; sinon l'acheteur choisit sur la fiche `href`. */
export type UpgradeResult = { kind: "replaced"; key: string; fromName: string; line: UpgradeLine } | { kind: "choose"; href: string | null };

function firstImageUrl(images: unknown, variantImage: string | null | undefined): string | null {
  if (variantImage && isDisplayableImageUrl(variantImage)) return variantImage;
  if (!Array.isArray(images)) return null;
  for (const i of images as { url?: unknown }[]) if (typeof i?.url === "string" && isDisplayableImageUrl(i.url)) return i.url;
  return null;
}

/**
 * Montée en gamme : remplace la ligne déclencheuse du panier par le produit proposé, avec les mêmes valeurs
 * d'options (par nom) quand elles existent (`matchUpgradeSelection`), sinon renvoie la fiche à ouvrir.
 * Tout est revalidé ici (boutique publiée, plan, offre active de mode `replace`, produit proposé par l'offre, ligne
 * réellement déclencheuse, disponibilité) ; quantité conservée telle quelle, sinon fiche ; le prix renvoyé est
 * indicatif (recalcul serveur à la commande).
 */
export async function resolveOfferUpgrade(raw: z.input<typeof upgradeSchema>): Promise<UpgradeResult> {
  const parsed = upgradeSchema.safeParse(raw);
  if (!parsed.success) return { kind: "choose", href: null };
  const { storeSlug, offerId, productId, lines } = parsed.data;
  const rl = await rateLimit(`offers:upgrade:ip:${await clientIp()}`, 60, 10 * 60);
  if (!rl.ok) return { kind: "choose", href: null };
  const store = await db.store.findUnique({ where: { slug: storeSlug }, select: { id: true, slug: true, status: true, subscription: true } });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return { kind: "choose", href: null };
  if (!PLANS[effectivePlanId(store.subscription)].features.cartOffers) return { kind: "choose", href: null };

  const offer = await db.cartOffer.findFirst({ where: { id: offerId, storeId: store.id, active: true, mode: "replace" }, select: { triggerProductIds: true, triggerCollectionIds: true, offerProductIds: true } });
  if (!offer || !offer.offerProductIds.includes(productId)) return { kind: "choose", href: null };

  const productInclude = { variants: { orderBy: { position: "asc" as const } }, optionGroups: { orderBy: { position: "asc" as const }, include: { options: { orderBy: { position: "asc" as const } } } } };
  const target = await db.product.findFirst({ where: { id: productId, storeId: store.id, status: "ACTIVE", isGiftCard: false }, include: productInclude });
  if (!target) return { kind: "choose", href: null };
  const href = `/s/${store.slug}/p/${target.slug}`;

  // Ligne déclencheuse : premier article du panier visé par l'offre (produit, ou collection du produit).
  const candidateIds = [...new Set(lines.map((l) => l.productId))].filter((id) => id !== target.id);
  const cols = offer.triggerCollectionIds.length ? await collectionIdsByProduct(store.id, candidateIds) : new Map<string, string[]>();
  const triggers = new Set(offer.triggerProductIds);
  const triggerCols = new Set(offer.triggerCollectionIds);
  const sourceLine = lines.find((l) => l.productId !== target.id && (triggers.has(l.productId) || (cols.get(l.productId) ?? []).some((c) => triggerCols.has(c))));
  if (!sourceLine) return { kind: "choose", href };
  const source = await db.product.findFirst({ where: { id: sourceLine.productId, storeId: store.id, status: "ACTIVE", isGiftCard: false }, include: productInclude });
  if (!source) return { kind: "choose", href };

  const sourceVariant = sourceLine.variantId ? source.variants.find((v) => v.id === sourceLine.variantId) : null;
  if (sourceLine.variantId && !sourceVariant) return { kind: "choose", href };
  const sourceOptions = sourceLine.optionIds.map((id) => {
    const g = source.optionGroups.find((gr) => gr.options.some((o) => o.id === id));
    return g ? { group: g.name, name: g.options.find((o) => o.id === id)!.name } : null;
  });
  if (sourceOptions.some((o) => o === null)) return { kind: "choose", href };

  const stockOf = (v: (typeof target.variants)[number] | null) => (v ? { trackStock: target.trackStock, stock: v.stock, policy: v.inventoryPolicy } : { trackStock: target.trackStock, stock: target.stock, policy: target.inventoryPolicy });
  const selection = matchUpgradeSelection(
    { attributes: readVariantAttributes(sourceVariant?.attributes), options: sourceOptions as { group: string; name: string }[] },
    {
      variants: target.variants.map((v) => ({ id: v.id, attributes: readVariantAttributes(v.attributes), purchasable: v.available && isSellable(stockOf(v)) })),
      optionGroups: target.optionGroups.map((g) => ({ id: g.id, name: g.name, required: g.required, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ id: o.id, name: o.name })) })),
    },
  );
  if (!selection) return { kind: "choose", href };
  const variant = selection.variantId ? target.variants.find((v) => v.id === selection.variantId)! : null;
  const stockItem = stockOf(variant);
  if (!isSellable(stockItem)) return { kind: "choose", href };

  // Même quantité que la ligne remplacée, jamais ajustée en silence : si elle sort des bornes du produit proposé
  // (minimum, maximum, stock), l'acheteur choisit sur la fiche. La réponse ne révèle jamais le stock.
  const quantity = sourceLine.quantity;
  if (quantity < (target.minQty ?? 1) || (target.maxQty != null && quantity > target.maxQty) || !canSell(stockItem, quantity)) return { kind: "choose", href };

  const picked = selection.optionIds.map((id) => target.optionGroups.flatMap((g) => g.options).find((o) => o.id === id)!);
  const unitPrice = (variant?.price ?? effectivePrice(target, new Date()).price) + picked.reduce((s, o) => s + o.priceDelta, 0);
  return {
    kind: "replaced",
    key: sourceLine.key,
    fromName: source.name,
    line: {
      productId: target.id,
      variantId: variant?.id ?? null,
      optionIds: selection.optionIds,
      quantity,
      snapshot: { name: target.name, variantName: variant?.name ?? null, unitPrice, image: firstImageUrl(target.images, variant?.imageUrl), productSlug: target.slug, optionNames: picked.map((o) => o.name) },
    },
  };
}
