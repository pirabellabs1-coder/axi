"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { requireStore, planFeature, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zId, zOptionalString, type ActionResult } from "@/lib/action";
import { checkProductsQuota, quotaMessage } from "@/lib/commerce/quotas";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { PLANS } from "@/config/plans";
import { productPayloadSchema, normalizeTag, giftCardFaceValueIssue, resolveProductKind, type ProductData, type ProductPayload } from "./schemas";
import { kindRequiresShipping, kindTracksStock } from "@/lib/digital/kinds";
import { attrKey, variantName, type ProductOption } from "./variants";
import { cleanMarkdown } from "./markdown";
import { parseCatalogRows, type CsvColumn } from "./csv-catalog";
import { readRules } from "@/lib/collections/rules";
import { lockStoreCategories } from "@/lib/collections/service";
import { stockDelta, StockConflictError } from "./stock-sync";
import { draftToPayload, type ImportExisting } from "./import-payload";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { importProductMetafieldRow, prepareProductMetafieldImport } from "@/lib/metafields/csv-server";

/* ───────────── Utilitaires ───────────── */

function zodFail(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = error.issues[0];
  const where = first?.path.length ? ` (${first.path.join(".")})` : "";
  return fail(`${first?.message ?? "Formulaire invalide"}${first && first.path.length > 1 ? where : ""}`, fieldErrors);
}

async function uniqueSlug(storeId: string, base: string, excludeId?: string, tx: Tx | typeof db = db): Promise<string> {
  const root = (slugify(base) || "produit").slice(0, 100);
  let candidate = root;
  for (let i = 2; i < 200; i++) {
    const clash = await tx.product.findFirst({ where: { storeId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (!clash) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function ensureCollection(storeId: string, name: string, tx: Tx): Promise<string> {
  const slug = slugify(name) || "collection";
  const existing = await tx.category.findUnique({ where: { storeId_slug: { storeId, slug } } });
  if (existing) return existing.id;
  const count = await tx.category.count({ where: { storeId } });
  const c = await tx.category.create({ data: { storeId, name: name.trim().slice(0, 60), slug, position: count } });
  return c.id;
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map(normalizeTag)) {
    const k = t.toLocaleLowerCase("fr");
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Synchronise l'appartenance d'un produit aux collections MANUELLES (liste `productIds` des règles). */
async function syncManualCollections(tx: Tx, storeId: string, productId: string, wanted: Set<string>) {
  const cols = await tx.category.findMany({ where: { storeId }, select: { id: true, rules: true } });
  for (const c of cols) {
    const rules = readRules(c.rules);
    if (rules.type !== "manual") continue;
    const has = rules.productIds.includes(productId);
    const want = wanted.has(c.id);
    if (has === want) continue;
    const productIds = want ? [...rules.productIds, productId] : rules.productIds.filter((id) => id !== productId);
    await tx.category.update({ where: { id: c.id }, data: { rules: { type: "manual", productIds } } });
  }
}

function revalidateCatalog(ctx: StoreContext, productId?: string) {
  revalidatePath(`/app/${ctx.store.id}/produits`);
  revalidatePath(`/app/${ctx.store.id}/collections`);
  if (productId) revalidatePath(`/app/${ctx.store.id}/produits/${productId}`);
  revalidatePath(`/s/${ctx.store.slug}`, "layout");
}

/* ───────────── Enregistrement d'un produit ───────────── */

const existingSelect = {
  id: true,
  name: true,
  stock: true,
  trackStock: true,
  images: true,
  options: true,
  lowStockThreshold: true,
  isGiftCard: true,
  kind: true,
  variants: { select: { id: true, name: true, stock: true, attributes: true, imageUrl: true } },
} satisfies Prisma.ProductSelect;

type Existing = Prisma.ProductGetPayload<{ select: typeof existingSelect }>;

/**
 * Incrément du stock + mouvement de stock. Un delta négatif est CONDITIONNEL (le résultat ne descend jamais sous zéro,
 * même en concurrence) ; un delta positif s'applique toujours, y compris sur un stock négatif (survente en politique
 * « continuer à vendre »). Lève `StockConflictError` si le stock courant ne permet pas d'appliquer un delta négatif.
 */
async function bumpStock(
  tx: Tx,
  ctx: StoreContext,
  target: { productId: string; variantId: string | null; label: string },
  delta: number,
  reason: "ADJUSTMENT" | "IMPORT",
  note: string,
) {
  if (delta === 0) return;
  const guardStock = delta < 0 ? { stock: { gte: -delta } } : {};
  const r = target.variantId
    ? await tx.variant.updateMany({ where: { id: target.variantId, productId: target.productId, ...guardStock }, data: { stock: { increment: delta } } })
    : await tx.product.updateMany({ where: { id: target.productId, storeId: ctx.store.id, ...guardStock }, data: { stock: { increment: delta } } });
  if (r.count === 0) throw new StockConflictError(target.label);
  await tx.inventoryMovement.create({ data: { storeId: ctx.store.id, productId: target.productId, variantId: target.variantId, delta, reason, note, actorId: ctx.user.id } });
}

/**
 * Écriture transactionnelle d'un produit complet (fiche, options, variantes, suppléments, collections).
 * Les variantes existantes gardent leur id (paniers et commandes intacts) : correspondance par id, puis par combinaison.
 * Stock des fiches existantes : seul le delta (saisie − `stockBase`, ou − valeur courante sans base) est appliqué,
 * par incrément conditionnel, pour ne pas annuler les ventes intervenues pendant l'édition.
 */
async function writeProduct(
  tx: Tx,
  ctx: StoreContext,
  d: ProductData,
  existingId: string | null,
  opts: { slug: string; reason?: "ADJUSTMENT" | "IMPORT"; keepOptionGroups: boolean },
): Promise<string> {
  const storeId = ctx.store.id;
  const reason = opts.reason ?? "ADJUSTMENT";
  const editNote = reason === "IMPORT" ? "Import CSV (mise à jour)" : "Modifié depuis la fiche produit";
  // Verrou des collections d'abord (ordre constant), puis relecture de l'état courant dans la transaction.
  await lockStoreCategories(tx, storeId);
  let existing: Existing | null = null;
  if (existingId) {
    existing = await tx.product.findFirst({ where: { id: existingId, storeId }, select: existingSelect });
    if (!existing) throw new Error("Produit introuvable");
  }
  // Carte cadeau (lot 1) : jamais de suivi de stock ; TVA exonérée (lot 2). Indicateur absent = inchangé (import).
  // Vague 2 : la NATURE (`kind`) décide du stock et de l'expédition ; `isGiftCard` reste synchronisé.
  const kind = resolveProductKind(d, existing);
  const giftCard = kind === "GIFT_CARD";
  if (!kindTracksStock(kind) && d.trackStock) d = { ...d, trackStock: false };
  const options = d.options as ProductOption[];
  const imageUrls = new Set(d.images.map((i) => i.url));

  // Images d'options (couleurs) : uniquement parmi les médias du produit.
  const cleanOptions: ProductOption[] = options.map((o) => ({
    name: o.name,
    type: o.type,
    values: o.values.map((v) => ({
      value: v.value,
      ...(o.type === "color" && v.swatch ? { swatch: v.swatch } : {}),
      ...(v.image && imageUrls.has(v.image) ? { image: v.image } : {}),
    })),
  }));

  // Collection principale (catégorie) + collections manuelles supplémentaires
  let categoryId = d.categoryId;
  const extra = new Set(d.collectionIds);
  if (d.newCollection) {
    const id = await ensureCollection(storeId, d.newCollection, tx);
    if (!categoryId) categoryId = id;
    else extra.add(id);
  }
  if (categoryId) extra.add(categoryId);

  const hasVariants = d.variants.length > 0;
  const base = {
    categoryId,
    name: d.name,
    slug: opts.slug,
    description: cleanMarkdown(d.description) || null,
    status: d.status,
    price: d.price,
    compareAtPrice: d.compareAtPrice != null && d.compareAtPrice > d.price ? d.compareAtPrice : null,
    promoPrice: d.promoPrice,
    promoStart: d.promoPrice != null ? d.promoStart : null,
    promoEnd: d.promoPrice != null ? d.promoEnd : null,
    costPrice: d.costPrice,
    sku: hasVariants ? null : d.sku,
    barcode: hasVariants ? null : d.barcode,
    trackStock: d.trackStock,
    inventoryPolicy: d.inventoryPolicy,
    lowStockThreshold: d.lowStockThreshold,
    minQty: d.minQty,
    maxQty: d.maxQty,
    weightGrams: d.weightGrams,
    isFeatured: d.isFeatured,
    images: d.images as unknown as Prisma.InputJsonValue,
    options: (cleanOptions.length ? cleanOptions : []) as unknown as Prisma.InputJsonValue,
    tags: dedupeTags(d.tags),
    vendor: d.vendor,
    productType: d.productType,
    seoTitle: d.seoTitle,
    seoDescription: d.seoDescription,
    details: d.details as unknown as Prisma.InputJsonValue,
    ...(d.isGiftCard !== undefined || d.kind !== undefined ? { isGiftCard: giftCard, giftCardValidityDays: giftCard ? d.giftCardValidityDays : null } : {}),
    // Vague 2 : nature + réglages propres au numérique et aux services (remis à zéro si la nature change).
    kind,
    downloadLimit: kind === "DIGITAL" ? d.downloadLimit : null,
    downloadValidityDays: kind === "DIGITAL" ? d.downloadValidityDays : null,
    serviceDurationMinutes: kind === "SERVICE" ? d.serviceDurationMinutes : null,
    serviceLocation: kind === "SERVICE" ? d.serviceLocation : null,
    serviceRemote: kind === "SERVICE" ? d.serviceRemote === true : false,
    serviceBookingNote: kind === "SERVICE" ? d.serviceBookingNote : null,
    postPurchaseInstructions: kind === "DIGITAL" || kind === "SERVICE" ? d.postPurchaseInstructions : null,
    // Ni poids ni expédition pour un produit qui ne part pas physiquement.
    ...(kindRequiresShipping(kind) ? {} : { weightGrams: null }),
    // Catégorie fiscale : une carte cadeau est TOUJOURS exonérée. Symétrie : décocher la case rend le produit
    // taxable au taux normal (sinon il resterait exonéré à vie). Indicateur ABSENT (import CSV sans colonne
    // « carte cadeau ») : la catégorie fiscale saisie dans la fiche produit n'est pas touchée.
    ...(giftCard ? { taxCategory: "exempt" } : (d.isGiftCard === false || (d.kind !== undefined && d.kind !== "GIFT_CARD")) && existing?.isGiftCard ? { taxCategory: "standard" } : {}),
  } satisfies Omit<Prisma.ProductUncheckedCreateInput, "storeId">;

  let id: string;
  if (existing) {
    // Seuil modifié : horodaté, pour ne pas alerter sur des franchissements antérieurs au nouveau seuil.
    const thresholdChanged = existing.lowStockThreshold !== d.lowStockThreshold;
    await tx.product.update({ where: { id: existing.id }, data: { ...base, ...(thresholdChanged ? { lowStockThresholdChangedAt: new Date() } : {}) } });
    id = existing.id;
    if (d.trackStock && !hasVariants) {
      await bumpStock(tx, ctx, { productId: id, variantId: null, label: d.name }, stockDelta(d.stock, d.stockBase, existing.stock), reason, editNote);
    }
  } else {
    id = (await tx.product.create({ data: { ...base, storeId, stock: d.trackStock && !hasVariants ? d.stock : 0 } })).id;
    if (d.trackStock && !hasVariants && d.stock > 0) {
      await tx.inventoryMovement.create({ data: { storeId, productId: id, delta: d.stock, reason, note: reason === "IMPORT" ? "Import CSV" : "Stock initial", actorId: ctx.user.id } });
    }
  }

  /* Variantes */
  const current = existing?.variants ?? [];
  const claimed = new Set<string>();
  const byKey = new Map<string, (typeof current)[number]>();
  for (const c of current) {
    const attrs = (c.attributes && typeof c.attributes === "object" ? c.attributes : {}) as Record<string, string>;
    if (options.length && Object.keys(attrs).length === options.length) byKey.set(attrKey(attrs, options), c);
  }
  const plan: { incoming: ProductData["variants"][number]; matchId: string | null }[] = d.variants.map((v) => {
    let matchId: string | null = v.id && current.some((c) => c.id === v.id) && !claimed.has(v.id) ? v.id : null;
    if (!matchId) {
      const hit = byKey.get(attrKey(v.attributes, options));
      if (hit && !claimed.has(hit.id)) matchId = hit.id;
    }
    if (matchId) claimed.add(matchId);
    return { incoming: v, matchId };
  });
  const removed = current.filter((c) => !claimed.has(c.id));
  const toDelete = removed.map((c) => c.id);
  if (toDelete.length) {
    // Le stock restant des combinaisons supprimées sort de l'inventaire : mouvement négatif tracé (variantId → null ensuite).
    for (const c of removed) {
      if (c.stock > 0) await tx.inventoryMovement.create({ data: { storeId, productId: id, variantId: c.id, delta: -c.stock, reason: "ADJUSTMENT", note: `Variante supprimée : ${c.name}`.slice(0, 200), actorId: ctx.user.id } });
    }
    // Combinaisons retirées : on les sort des paniers ; les commandes gardent leur libellé (variantId → null).
    await tx.cartItem.deleteMany({ where: { variantId: { in: toDelete } } });
    await tx.variant.deleteMany({ where: { id: { in: toDelete }, productId: id } });
  }
  for (let i = 0; i < plan.length; i++) {
    const { incoming: v, matchId } = plan[i];
    // Image de la variante : choisie parmi les médias, sinon héritée de la valeur d'option (couleur) qui en a une.
    let imageUrl = v.imageUrl && imageUrls.has(v.imageUrl) ? v.imageUrl : null;
    if (!imageUrl) {
      for (const o of cleanOptions) {
        const val = o.values.find((x) => x.value === v.attributes[o.name]);
        if (val && "image" in val && val.image) {
          imageUrl = val.image;
          break;
        }
      }
    }
    const prev = matchId ? current.find((c) => c.id === matchId)! : null;
    const attributes = Object.fromEntries(options.map((o) => [o.name, v.attributes[o.name]]));
    const data = {
      name: variantName(attributes, options),
      attributes: attributes as Prisma.InputJsonValue,
      price: v.price,
      compareAtPrice: v.compareAtPrice != null && v.compareAtPrice > (v.price ?? d.price) ? v.compareAtPrice : null,
      sku: v.sku,
      barcode: v.barcode,
      weightGrams: v.weightGrams,
      imageUrl,
      available: v.available,
      inventoryPolicy: v.inventoryPolicy,
      position: i,
    };
    if (prev) {
      await tx.variant.update({ where: { id: prev.id }, data });
      if (d.trackStock) {
        // La base affichée n'a de sens que pour la variante d'origine (même id).
        const baseStock = v.id === prev.id ? v.stockBase : null;
        await bumpStock(tx, ctx, { productId: id, variantId: prev.id, label: `${d.name} (${data.name})` }, stockDelta(v.stock, baseStock, prev.stock), reason, editNote);
      }
    } else {
      const stock = d.trackStock ? v.stock : 0;
      const created = await tx.variant.create({ data: { ...data, stock, productId: id } });
      if (d.trackStock && stock > 0) {
        await tx.inventoryMovement.create({ data: { storeId, productId: id, variantId: created.id, delta: stock, reason, note: reason === "IMPORT" ? "Import CSV" : "Stock initial", actorId: ctx.user.id } });
      }
    }
  }

  /* Suppléments (OptionGroup) */
  if (!opts.keepOptionGroups) {
    const currentGroups = await tx.optionGroup.findMany({ where: { productId: id }, include: { options: { select: { id: true } } } });
    const keepGroupIds = new Set(d.optionGroups.map((g) => g.id).filter((x): x is string => !!x && currentGroups.some((c) => c.id === x)));
    const groupsToDelete = currentGroups.filter((c) => !keepGroupIds.has(c.id)).map((c) => c.id);
    if (groupsToDelete.length) await tx.optionGroup.deleteMany({ where: { id: { in: groupsToDelete }, productId: id } });
    for (let gi = 0; gi < d.optionGroups.length; gi++) {
      const g = d.optionGroups[gi];
      const gData = { name: g.name, required: g.required, minSelect: g.minSelect, maxSelect: g.maxSelect, position: gi };
      let groupId: string;
      if (g.id && keepGroupIds.has(g.id)) {
        await tx.optionGroup.update({ where: { id: g.id }, data: gData });
        groupId = g.id;
      } else groupId = (await tx.optionGroup.create({ data: { ...gData, productId: id } })).id;
      const existingOpts = currentGroups.find((c) => c.id === groupId)?.options.map((o) => o.id) ?? [];
      const keepOptIds = new Set(g.options.map((o) => o.id).filter((x): x is string => !!x && existingOpts.includes(x)));
      const optsToDelete = existingOpts.filter((oid) => !keepOptIds.has(oid));
      if (optsToDelete.length) await tx.option.deleteMany({ where: { id: { in: optsToDelete }, groupId } });
      for (let oi = 0; oi < g.options.length; oi++) {
        const o = g.options[oi];
        const oData = { name: o.name, priceDelta: o.priceDelta, position: oi };
        if (o.id && keepOptIds.has(o.id)) await tx.option.update({ where: { id: o.id }, data: oData });
        else await tx.option.create({ data: { ...oData, groupId } });
      }
    }
  }

  await syncManualCollections(tx, storeId, id, extra);
  return id;
}

/** Vérifications de plan communes (création, modification, import). Renvoie un message d'erreur ou null. */
function planIssue(ctx: StoreContext, d: ProductData, existingImageCount: number): string | null {
  const upsell = `/app/${ctx.store.id}/abonnement`;
  const plan = PLANS[ctx.planId];
  if (d.trackStock && !planFeature(ctx.planId, "stockTracking")) return `Le suivi de stock n'est pas inclus dans le plan ${plan.name}. Voir les plans : ${upsell}`;
  if ((d.variants.length > 0 || d.options.length > 0) && !planFeature(ctx.planId, "variants")) return `Les variantes nécessitent un plan supérieur : ${upsell}`;
  const maxPhotos = plan.limits.photosPerProduct;
  if (d.images.length > maxPhotos && d.images.length > existingImageCount) return `Votre plan ${plan.name} autorise ${maxPhotos} photo${maxPhotos > 1 ? "s" : ""} par produit. Retirez-en ou changez de plan : ${upsell}`;
  return null;
}

/**
 * Création / mise à jour d'un produit depuis le formulaire (charge utile JSON validée par `productPayloadSchema`).
 */
export async function saveProduct(storeId: string, payload: ProductPayload): Promise<ActionResult<{ productId: string; slug: string }>> {
  return guard(async () => {
    const bad = badIds(storeId) ?? (payload?.productId != null ? badIds(payload.productId) : null);
    if (bad) return bad;
    const parsed = productPayloadSchema.safeParse(payload);
    if (!parsed.success) return zodFail(parsed.error);
    const d = parsed.data;
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;

    let existing: Existing | null = null;
    if (d.productId) {
      existing = await db.product.findFirst({ where: { id: d.productId, storeId: sid }, select: existingSelect });
      if (!existing) return fail("Produit introuvable");
    } else {
      const quota = await checkProductsQuota(sid, ctx.planId);
      if (!quota.allowed && d.status !== "ARCHIVED") return fail(`${quotaMessage(quota)} /app/${sid}/abonnement`);
    }
    // Images : aucune nouvelle data-URL (seule une valeur identique à l'existant passe), aucun média d'une autre boutique.
    const imageIssue = checkImageWrite({ images: d.images, options: d.options, variants: d.variants.map((v) => v.imageUrl) }, { storeId: sid, existing: [existing?.images, existing?.options, existing?.variants] });
    if (imageIssue) return fail(imageIssue, { images: [imageIssue] });
    const existingImages = Array.isArray(existing?.images) ? (existing!.images as unknown[]).length : 0;
    const issue = planIssue(ctx, d, existingImages);
    if (issue) return fail(issue);
    // Vague 2 : nature numérique ou service → fonction de plan `digitalProducts` (incluse dans tous les plans,
    // bornée par le quota de stockage ; voir src/config/plans.ts).
    const nextKind = resolveProductKind(d, existing);
    if ((nextKind === "DIGITAL" || nextKind === "SERVICE") && existing?.kind !== nextKind && !planFeature(ctx.planId, "digitalProducts")) {
      return fail(`Les produits numériques et les services ne sont pas inclus dans le plan ${PLANS[ctx.planId].name}. Voir les plans : /app/${sid}/abonnement`, { kind: ["Plan supérieur requis"] });
    }
    // Carte cadeau : plan (pour l'activer), valeurs faciales bornées.
    if (d.isGiftCard) {
      if (!existing?.isGiftCard && !planFeature(ctx.planId, "giftCards")) return fail(`Les cartes cadeaux ne sont pas incluses dans le plan ${PLANS[ctx.planId].name}. Voir les plans : /app/${sid}/abonnement`, { isGiftCard: ["Plan supérieur requis"] });
      const faceIssue = giftCardFaceValueIssue(d, ctx.store.currency);
      if (faceIssue) return fail(faceIssue, { price: [faceIssue] });
    }

    // Collections : doivent appartenir à la boutique ; seules les manuelles acceptent des produits.
    const colIds = [...new Set([...(d.categoryId ? [d.categoryId] : []), ...d.collectionIds])];
    if (colIds.length) {
      const cols = await db.category.findMany({ where: { id: { in: colIds }, storeId: sid }, select: { id: true } });
      if (cols.length !== colIds.length) return fail("Collection invalide", { collectionIds: ["Collection introuvable"] });
    }

    const keepOptionGroups = !planFeature(ctx.planId, "options");
    const slug = await uniqueSlug(sid, d.slug || d.name, existing?.id);
    let productId: string;
    try {
      productId = await db.$transaction(
        async (tx) => {
          const id = await writeProduct(tx, ctx, d, existing?.id ?? null, { slug, keepOptionGroups });
          await audit({ storeId: sid, actorId: ctx.user.id, action: existing ? "product.updated" : "product.created", target: id, metadata: { variants: d.variants.length, options: d.options.length } }, tx);
          await emitDomainEvent(tx, sid, existing ? "product.updated" : "product.created", { product_id: id, status: d.status }); // Lot 2 (W) : webhooks
          return id;
        },
        { timeout: 30000 },
      );
    } catch (e) {
      if (e instanceof StockConflictError) return fail(e.message, { stock: [e.message] });
      throw e;
    }
    revalidateCatalog(ctx, productId);
    return success({ productId, slug }, existing ? "Produit enregistré" : "Produit créé");
  });
}

/* ───────────── Statut, vedette, duplication ───────────── */

async function setStatus(storeId: string, productId: string, status: "ACTIVE" | "ARCHIVED", action: string, message: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, productId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const current = await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { status: true } });
    if (!current) return fail("Produit introuvable");
    if (status === "ACTIVE" && current.status === "ARCHIVED") {
      const quota = await checkProductsQuota(ctx.store.id, ctx.planId);
      if (!quota.allowed) return fail(`${quotaMessage(quota)} /app/${ctx.store.id}/abonnement`);
    }
    await db.product.updateMany({ where: { id: productId, storeId: ctx.store.id }, data: { status } });
    await emitDomainEvent(db, ctx.store.id, status === "ARCHIVED" ? "product.deleted" : "product.updated", { product_id: productId, status }); // Lot 2 (W) : archivage = retrait de la vente
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action, target: productId });
    revalidateCatalog(ctx, productId);
    return success(undefined, message);
  });
}

export async function archiveProduct(storeId: string, productId: string): Promise<ActionResult> {
  return setStatus(storeId, productId, "ARCHIVED", "product.archived", "Produit archivé");
}

export async function restoreProduct(storeId: string, productId: string): Promise<ActionResult> {
  return setStatus(storeId, productId, "ACTIVE", "product.restored", "Produit restauré");
}

export async function toggleFeatured(storeId: string, productId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, productId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const p = await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { isFeatured: true } });
    if (!p) return fail("Produit introuvable");
    await db.product.update({ where: { id: productId }, data: { isFeatured: !p.isFeatured } });
    revalidateCatalog(ctx, productId);
    return success(undefined, p.isFeatured ? "Retiré des vedettes" : "Mis en vedette");
  });
}

/** Duplication complète (fiche, options, variantes, suppléments, détails, SEO, collections) en brouillon, stock à zéro. */
export async function duplicateProduct(storeId: string, productId: string): Promise<ActionResult<{ productId: string }>> {
  return guard(async () => {
    const bad = badIds(storeId, productId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;
    const quota = await checkProductsQuota(sid, ctx.planId);
    if (!quota.allowed) return fail(`${quotaMessage(quota)} /app/${sid}/abonnement`);
    const src = await db.product.findFirst({ where: { id: productId, storeId: sid }, include: { variants: { orderBy: { position: "asc" } }, optionGroups: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } } });
    if (!src) return fail("Produit introuvable");
    const slug = await uniqueSlug(sid, `${src.slug}-copie`);
    const copyId = await db.$transaction(async (tx) => {
      await lockStoreCategories(tx, sid);
      const copy = await tx.product.create({
        data: {
          storeId: sid,
          categoryId: src.categoryId,
          name: `${src.name} (copie)`.slice(0, 120),
          slug,
          description: src.description,
          status: "DRAFT",
          price: src.price,
          compareAtPrice: src.compareAtPrice,
          promoPrice: src.promoPrice,
          promoStart: src.promoStart,
          promoEnd: src.promoEnd,
          costPrice: src.costPrice,
          sku: null,
          barcode: null,
          trackStock: src.trackStock,
          stock: 0,
          inventoryPolicy: src.inventoryPolicy,
          lowStockThreshold: src.lowStockThreshold,
          minQty: src.minQty,
          maxQty: src.maxQty,
          weightGrams: src.weightGrams,
          isFeatured: false,
          images: (src.images ?? []) as Prisma.InputJsonValue,
          options: (src.options ?? []) as Prisma.InputJsonValue,
          tags: src.tags,
          vendor: src.vendor,
          productType: src.productType,
          seoTitle: src.seoTitle,
          seoDescription: src.seoDescription,
          details: (src.details ?? []) as Prisma.InputJsonValue,
          isGiftCard: src.isGiftCard,
          giftCardValidityDays: src.giftCardValidityDays,
          taxable: src.taxable,
          taxCategory: src.taxCategory,
          // Vague 2 : nature et réglages numériques / services conservés.
          kind: src.kind,
          downloadLimit: src.downloadLimit,
          downloadValidityDays: src.downloadValidityDays,
          serviceDurationMinutes: src.serviceDurationMinutes,
          serviceLocation: src.serviceLocation,
          serviceRemote: src.serviceRemote,
          serviceBookingNote: src.serviceBookingNote,
          postPurchaseInstructions: src.postPurchaseInstructions,
          variants: {
            create: src.variants.map((v) => ({
              name: v.name,
              attributes: v.attributes as Prisma.InputJsonValue,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              sku: null,
              barcode: null,
              weightGrams: v.weightGrams,
              imageUrl: v.imageUrl,
              available: v.available,
              stock: 0,
              inventoryPolicy: v.inventoryPolicy,
              position: v.position,
            })),
          },
          optionGroups: {
            create: src.optionGroups.map((g) => ({
              name: g.name,
              required: g.required,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              position: g.position,
              options: { create: g.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta, position: o.position })) },
            })),
          },
        },
      });
      // Vague 2 : les fichiers vendus sont rattachés à la copie (même objet stocké : aucun octet dupliqué,
      // le stockage est adressé par contenu). Les fichiers propres à une variante ne sont pas rattachés
      // (les variantes de la copie ont de nouveaux identifiants) : ils restent à recharger.
      const assets = await tx.digitalAsset.findMany({ where: { storeId: sid, productId: src.id, variantId: null }, orderBy: { position: "asc" }, select: { name: true, storageKey: true, bytes: true, mime: true, version: true, position: true } });
      for (const a of assets) {
        await tx.digitalAsset.create({ data: { ...a, storeId: sid, productId: copy.id } });
      }
      // Mêmes collections manuelles que l'original
      const cols = await tx.category.findMany({ where: { storeId: sid }, select: { id: true, rules: true } });
      const wanted = new Set(cols.filter((c) => { const r = readRules(c.rules); return r.type === "manual" && r.productIds.includes(src.id); }).map((c) => c.id));
      if (src.categoryId) wanted.add(src.categoryId);
      await syncManualCollections(tx, sid, copy.id, wanted);
      await audit({ storeId: sid, actorId: ctx.user.id, action: "product.duplicated", target: copy.id, metadata: { from: productId } }, tx);
      await emitDomainEvent(tx, sid, "product.created", { product_id: copy.id, status: "DRAFT", duplicated_from: productId }); // Lot 2 (W)
      return copy.id;
    });
    revalidateCatalog(ctx);
    return success({ productId: copyId }, "Produit dupliqué en brouillon");
  });
}

/* ───────────── Actions groupées (liste) ───────────── */

const bulkSchema = z.object({
  ids: z.array(zId).min(1, "Sélectionnez au moins un produit").max(500),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("status"), status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]) }),
    z.object({ type: z.literal("addTag"), tag: z.string().trim().min(1, "Étiquette vide").max(40) }),
    z.object({ type: z.literal("removeTag"), tag: z.string().trim().min(1).max(40) }),
    z.object({ type: z.literal("addToCollection"), collectionId: zId }),
    z.object({ type: z.literal("feature"), value: z.boolean() }),
    z.object({ type: z.literal("inventoryPolicy"), policy: z.enum(["DENY", "CONTINUE"]) }),
  ]),
});

export type BulkAction = z.infer<typeof bulkSchema>["action"];

export async function bulkUpdateProducts(storeId: string, ids: string[], action: BulkAction): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const parsed = bulkSchema.safeParse({ ids, action });
    if (!parsed.success) return zodFail(parsed.error);
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;
    const a = parsed.data.action;
    const products = await db.product.findMany({ where: { storeId: sid, id: { in: parsed.data.ids } }, select: { id: true, status: true, tags: true } });
    if (products.length === 0) return fail("Aucun produit trouvé");
    const pids = products.map((p) => p.id);
    let message = "";

    if (a.type === "status") {
      if (a.status !== "ARCHIVED") {
        const reviving = products.filter((p) => p.status === "ARCHIVED").length;
        if (reviving > 0) {
          const quota = await checkProductsQuota(sid, ctx.planId);
          if (quota.limit != null && quota.used + reviving > quota.limit) return fail(`${quotaMessage({ ...quota, used: quota.used + reviving })} /app/${sid}/abonnement`);
        }
      }
      await db.product.updateMany({ where: { storeId: sid, id: { in: pids } }, data: { status: a.status } });
      message = { ACTIVE: "activé", DRAFT: "passé en brouillon", ARCHIVED: "archivé" }[a.status];
    } else if (a.type === "addTag" || a.type === "removeTag") {
      const tag = normalizeTag(a.tag);
      await db.$transaction(
        products.map((p) =>
          db.product.update({
            where: { id: p.id },
            data: { tags: a.type === "addTag" ? dedupeTags([...p.tags, tag]) : p.tags.filter((t) => t.toLocaleLowerCase("fr") !== tag.toLocaleLowerCase("fr")) },
          }),
        ),
      );
      message = a.type === "addTag" ? `étiqueté « ${tag} »` : `sans l'étiquette « ${tag} »`;
    } else if (a.type === "addToCollection") {
      // Lecture-modification-écriture de rules.productIds sous verrou (pas d'écrasement concurrent).
      const r = await db.$transaction(async (tx): Promise<{ error: string } | { name: string }> => {
        await lockStoreCategories(tx, sid);
        const col = await tx.category.findFirst({ where: { id: a.collectionId, storeId: sid }, select: { id: true, name: true, rules: true } });
        if (!col) return { error: "Collection introuvable" };
        const rules = readRules(col.rules);
        if (rules.type !== "manual") return { error: `« ${col.name} » est une collection automatique : ses produits dépendent de ses conditions.` };
        const productIds = [...rules.productIds, ...pids.filter((id) => !rules.productIds.includes(id))];
        await tx.category.update({ where: { id: col.id }, data: { rules: { type: "manual", productIds } } });
        return { name: col.name };
      });
      if ("error" in r) return fail(r.error);
      message = `ajouté à « ${r.name} »`;
    } else if (a.type === "inventoryPolicy") {
      // Produit simple : réglage du produit ; produit à variantes : appliqué à toutes ses variantes.
      await db.$transaction([
        db.product.updateMany({ where: { storeId: sid, id: { in: pids } }, data: { inventoryPolicy: a.policy } }),
        db.variant.updateMany({ where: { productId: { in: pids }, product: { storeId: sid } }, data: { inventoryPolicy: a.policy } }),
      ]);
      message = a.policy === "CONTINUE" ? "vendu(s) aussi en rupture (précommande)" : "bloqué(s) en rupture de stock";
    } else {
      await db.product.updateMany({ where: { storeId: sid, id: { in: pids } }, data: { isFeatured: a.value } });
      message = a.value ? "mis en vedette" : "retiré des vedettes";
    }
    await audit({ storeId: sid, actorId: ctx.user.id, action: `product.bulk.${a.type}`, metadata: { count: pids.length, ...a } });
    // Lot 2 (W) : un événement par produit modifié (archivage = retrait de la vente), écrits ensemble.
    await db.$transaction(async (tx) => {
      for (const p of products) {
        const event = a.type === "status" && a.status === "ARCHIVED" ? "product.deleted" : "product.updated";
        await emitDomainEvent(tx, sid, event, { product_id: p.id, ...(a.type === "status" ? { status: a.status } : {}), bulk: a.type });
      }
    });
    revalidateCatalog(ctx);
    const n = pids.length;
    return success({ count: n }, `${n} produit${n > 1 ? "s" : ""} ${message}`);
  });
}

/* ───────────── Stock ───────────── */

const adjustSchema = z.object({
  storeId: zId,
  productId: zId,
  variantId: zOptionalString,
  delta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Indiquez une quantité différente de zéro"),
  note: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(200).optional()),
});

async function applyStockDelta(ctx: StoreContext, productId: string, variantId: string | null, delta: number, note: string | null): Promise<ActionResult<{ stock: number }>> {
  if (!planFeature(ctx.planId, "stockTracking")) return fail(`Le suivi de stock n'est pas inclus dans votre plan : /app/${ctx.store.id}/abonnement`);
  const product = await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { id: true, trackStock: true, stock: true, variants: { select: { id: true, stock: true } } } });
  if (!product) return fail("Produit introuvable");
  if (!product.trackStock) return fail("Activez le suivi de stock sur ce produit d'abord.");
  if (product.variants.length > 0 && !variantId) return fail("Choisissez une variante");
  let stock = 0;
  try {
    stock = await db.$transaction(async (tx) => {
      let next: number;
      if (variantId) {
        const v = product.variants.find((x) => x.id === variantId);
        if (!v) throw new Error("Variante introuvable");
        // Décrément conditionnel : un ajustement manuel ne rend jamais le stock négatif, même en concurrence
        // (un réassort positif s'applique toujours, y compris après une survente).
        const r = await tx.variant.updateMany({ where: { id: variantId, productId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) }, data: { stock: { increment: delta } } });
        if (r.count === 0) throw new Error("Le stock ne peut pas devenir négatif");
        next = (await tx.variant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })).stock;
      } else {
        const r = await tx.product.updateMany({ where: { id: productId, storeId: ctx.store.id, ...(delta < 0 ? { stock: { gte: -delta } } : {}) }, data: { stock: { increment: delta } } });
        if (r.count === 0) throw new Error("Le stock ne peut pas devenir négatif");
        next = (await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { stock: true } })).stock;
      }
      await tx.inventoryMovement.create({ data: { storeId: ctx.store.id, productId, variantId, delta, reason: "ADJUSTMENT", note, actorId: ctx.user.id } });
      await emitDomainEvent(tx, ctx.store.id, "inventory.updated", { product_id: productId, variant_id: variantId, delta, stock: next }); // Lot 2 (W) : webhooks
      return next;
    });
  } catch (e) {
    return fail((e as Error).message);
  }
  await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "inventory.adjusted", target: variantId ?? productId, metadata: { productId, delta } });
  revalidatePath(`/app/${ctx.store.id}/produits`);
  revalidatePath(`/app/${ctx.store.id}/produits/${productId}`);
  revalidatePath(`/app/${ctx.store.id}/produits/${productId}/stock`);
  revalidatePath(`/app/${ctx.store.id}/produits/stock`);
  return success({ stock }, "Stock ajusté");
}

export async function adjustStock(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(adjustSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, productId, variantId, delta, note } = parsed.data;
    const ctx = await requireStore(storeId, "products.manage");
    const r = await applyStockDelta(ctx, productId, variantId ?? null, delta, note ?? null);
    return r.ok ? success(undefined, r.message) : r;
  });
}

/** Ajustement rapide en ligne (page d'inventaire) : nouvelle quantité absolue → mouvement audité du delta. */
export async function setStockLevel(storeId: string, input: { productId: string; variantId?: string | null; quantity: number; note?: string }): Promise<ActionResult<{ stock: number }>> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    // Quantité négative admise (stock en survente) : le serveur n'applique qu'une hausse dans ce cas (retrait conditionnel).
    const parsed = z.object({ productId: zId, variantId: zId.nullish(), quantity: z.number().int().min(-1_000_000).max(1_000_000), note: z.string().trim().max(200).optional() }).safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const ctx = await requireStore(storeId, "products.manage");
    const { productId, variantId, quantity } = parsed.data;
    const current = variantId
      ? await db.variant.findFirst({ where: { id: variantId, productId, product: { storeId: ctx.store.id } }, select: { stock: true } })
      : await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { stock: true } });
    if (!current) return fail("Article introuvable");
    const delta = quantity - current.stock;
    if (delta === 0) return success({ stock: quantity }, "Aucun changement");
    return applyStockDelta(ctx, productId, variantId ?? null, delta, parsed.data.note || "Inventaire (ajustement en ligne)");
  });
}

/* ───────────── Import CSV (une ligne par variante) ───────────── */

export type ImportReport = { created: number; updated: number; skipped: number; errors: { line: number; message: string }[] };

/** Largeur maximale d'une ligne de CSV catalogue (colonnes catalogue + champs personnalisés). */
const MAX_CSV_WIDTH = 200;

const importInputSchema = z.object({
  // Largeur d'une ligne : un export maison peut compter jusqu'à 100 colonnes de champs personnalisés
  // (plan Business) en plus des colonnes catalogue ; 200 couvre l'aller-retour export → import.
  rows: z.array(z.array(z.string().max(20_000)).max(MAX_CSV_WIDTH)).min(1, "Aucune ligne à importer").max(2000, "2 000 lignes maximum par import"),
  mapping: z.array(z.string().max(30)).max(MAX_CSV_WIDTH),
  firstLine: z.number().int().min(1).max(10).default(2),
  overwrite: z.boolean().default(false),
  /** Lot 4 : colonnes `metafield:{namespace}.{key}` du fichier (index dans la ligne, en-tête). */
  metafieldColumns: z.array(z.object({ index: z.number().int().min(0).max(MAX_CSV_WIDTH - 1), header: z.string().trim().min(1).max(120) })).max(MAX_CSV_WIDTH).default([]),
});

/**
 * Le client envoie les lignes BRUTES et l'association des colonnes : le serveur reparse (même parseur que l'aperçu)
 * et revalide chaque produit avec le schéma du formulaire. Rien de calculé côté client n'est cru.
 */
export async function importCatalog(storeId: string, input: { rows: string[][]; mapping: (CsvColumn | "")[]; firstLine?: number; overwrite?: boolean; metafieldColumns?: { index: number; header: string }[] }): Promise<ActionResult<ImportReport>> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const parsedInput = importInputSchema.safeParse(input);
    if (!parsedInput.success) return zodFail(parsedInput.error);
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;
    if (!planFeature(ctx.planId, "csvImport")) return fail(`L'import CSV n'est pas inclus dans votre plan : /app/${sid}/abonnement`);
    const { rows, firstLine, overwrite, metafieldColumns } = parsedInput.data;
    const mapping = parsedInput.data.mapping as (CsvColumn | "")[];
    if (!mapping.includes("title") || !mapping.includes("price")) return fail("Associez au minimum les colonnes Titre et Prix.");
    const { products, issues } = parseCatalogRows(rows, mapping, firstLine);
    if (products.length > 500) return fail("500 produits maximum par import");

    const stockOk = planFeature(ctx.planId, "stockTracking");
    const quota = await checkProductsQuota(sid, ctx.planId);
    let room = quota.limit == null ? Infinity : Math.max(0, quota.limit - quota.used);
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [...issues] };
    const collections = await db.category.findMany({ where: { storeId: sid }, select: { id: true, name: true, slug: true, rules: true } });
    // Lot 4 : champs personnalisés (une préparation par fichier ; cellules lues sur la 1re ligne du produit).
    const mfCtx = metafieldColumns.length ? await prepareProductMetafieldImport(sid, ctx.store.currency, ctx.planId, metafieldColumns.map((c) => c.header)) : null;
    if (mfCtx && !mfCtx.enabled && mfCtx.mapping.columns.length) report.errors.push({ line: 1, message: "Les champs personnalisés ne sont pas inclus dans votre plan : colonnes metafield ignorées." });
    if (mfCtx?.mapping.unknown.length) report.errors.push({ line: 1, message: `Colonnes inconnues ignorées (aucun champ personnalisé produit correspondant) : ${mfCtx.mapping.unknown.join(", ").slice(0, 300)}` });
    const metafieldRow = (line: number): Record<string, string> => {
      const cells = rows[line - firstLine] ?? [];
      return Object.fromEntries(metafieldColumns.map((c) => [c.header, cells[c.index] ?? ""]));
    };
    const manualOf = (productId: string) => collections.filter((c) => { const r = readRules(c.rules); return r.type === "manual" && r.productIds.includes(productId); }).map((c) => c.id);

    for (const p of products) {
      const row = await db.product.findFirst({
        where: { storeId: sid, slug: p.handle },
        select: {
          id: true, description: true, status: true, isFeatured: true, categoryId: true, productType: true, vendor: true, tags: true, seoTitle: true, seoDescription: true,
          compareAtPrice: true, costPrice: true, promoPrice: true, promoStart: true, promoEnd: true, sku: true, barcode: true, trackStock: true, stock: true, minQty: true, maxQty: true,
          inventoryPolicy: true, lowStockThreshold: true, weightGrams: true, images: true, options: true, details: true, kind: true,
          variants: { orderBy: { position: "asc" }, select: { id: true, attributes: true, price: true, compareAtPrice: true, sku: true, barcode: true, stock: true, weightGrams: true, imageUrl: true, available: true, inventoryPolicy: true } },
        },
      });
      const existing: ImportExisting | null = row ? { ...row, manualCollectionIds: manualOf(row.id) } : null;
      if (existing && !overwrite) {
        report.skipped++;
        report.errors.push({ line: p.line, message: `« ${p.name} » existe déjà (handle ${p.handle}) : ignoré. Cochez « Mettre à jour les produits existants » pour le remplacer.` });
        continue;
      }
      if (!existing && room <= 0) {
        report.skipped++;
        report.errors.push({ line: p.line, message: `Limite de ${quota.limit} produits du plan atteinte : « ${p.name} » non importé.` });
        continue;
      }
      // Mise à jour : on part de la fiche existante, seules les colonnes non vides la remplacent.
      const payload = draftToPayload(p, stockOk, collections, existing, (message) => report.errors.push({ line: p.line, message }));
      const parsed = productPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        report.skipped++;
        report.errors.push({ line: p.line, message: `« ${p.name} » : ${parsed.error.issues[0]?.message ?? "données invalides"}` });
        continue;
      }
      const d = parsed.data;
      const imageIssue = checkImageWrite({ images: d.images, options: d.options, variants: d.variants.map((v) => v.imageUrl) }, { storeId: sid, existing: [existing?.images, existing?.options, existing?.variants] });
      if (imageIssue) {
        report.skipped++;
        report.errors.push({ line: p.line, message: `« ${p.name} » : ${imageIssue}` });
        continue;
      }
      const issue = planIssue(ctx, d, Array.isArray(existing?.images) ? (existing!.images as unknown[]).length : 0);
      if (issue) {
        report.skipped++;
        report.errors.push({ line: p.line, message: `« ${p.name} » : ${issue}` });
        continue;
      }
      try {
        const mfErrors = await db.$transaction(
          async (tx) => {
            const slug = existing ? p.handle : await uniqueSlug(sid, p.handle, undefined, tx);
            const id = await writeProduct(tx, ctx, d, existing?.id ?? null, { slug, reason: "IMPORT", keepOptionGroups: true });
            await emitDomainEvent(tx, sid, existing ? "product.updated" : "product.created", { product_id: id, status: d.status, source: "csv_import" }); // Lot 2 (W)
            // Champs personnalisés : tout ou rien pour la ligne, le produit reste enregistré ; erreurs rapportées.
            if (!mfCtx) return [];
            const mfRes = await importProductMetafieldRow(tx, mfCtx, id, metafieldRow(p.line));
            return Object.values(mfRes.errors);
          },
          { timeout: 30000 },
        );
        for (const message of mfErrors) report.errors.push({ line: p.line, message: `« ${p.name} » : champ personnalisé non enregistré, ${message}` });
        if (existing) report.updated++;
        else {
          report.created++;
          room--;
        }
      } catch (e) {
        report.skipped++;
        if (e instanceof StockConflictError) report.errors.push({ line: p.line, message: e.message });
        else {
          console.error("[import]", e);
          report.errors.push({ line: p.line, message: `« ${p.name} » : échec de l'enregistrement` });
        }
      }
    }
    await audit({ storeId: sid, actorId: ctx.user.id, action: "product.imported", metadata: { created: report.created, updated: report.updated, skipped: report.skipped } });
    revalidateCatalog(ctx);
    report.errors.sort((a, b) => a.line - b.line);
    return success(report, `${report.created} créé${report.created > 1 ? "s" : ""}, ${report.updated} mis à jour`);
  });
}
