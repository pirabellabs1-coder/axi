import "server-only";
import type { PlanId } from "@/config/plans";
import { toSavedSectionDTO } from "@/lib/saved-sections/rules";
import { listPublishedLibrary } from "@/lib/section-library/service";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getStorefrontMetafields, listMetafieldDefinitions, type StorefrontMetafields } from "@/lib/metafields/read";
import { ownerCanBePublic } from "@/lib/metafields/types";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { editorLot4Rules } from "@/lib/theme/editor-plan";
import type { QualityFacts } from "@/lib/theme-engine/quality";
import type { AlternateOwner, EditorLibraryItem, EditorLot4, EditorSavedSection } from "@/components/theme-editor/types";

type StoreLike = { id: string; name: string; slug: string; description: string | null; currency: string; logoUrl: string | null; city: string | null; whatsappNumber: string | null };

/**
 * Faits de qualité (lot 4 §3) chargés une fois par ouverture de l'éditeur. Les métadonnées des images du stockage
 * objet (`facts.images`) ne sont pas chargées : aucune table ne les conserve (les data-URL sont mesurées par quality.ts).
 */
async function loadQualityFacts(store: StoreLike): Promise<QualityFacts> {
  const storeId = store.id;
  const [products, collections, reviewCount] = await Promise.all([
    db.product.findMany({ where: { storeId, status: "ACTIVE" }, take: 500, orderBy: { position: "asc" }, select: { id: true, name: true, images: true, seoTitle: true } }),
    db.category.findMany({ where: { storeId, published: true }, take: 200, select: { id: true, name: true, description: true } }),
    db.review.count({ where: { storeId, status: "APPROVED" } }),
  ]);
  const noAlt = products.filter((p) => Array.isArray(p.images) && (p.images as { alt?: unknown }[]).some((im) => !(typeof im?.alt === "string" && im.alt.trim())));
  return {
    storeName: store.name,
    storeDescription: store.description,
    productsWithoutAlt: noAlt.map((p) => ({ id: p.id, name: p.name })),
    collectionsWithoutDescription: collections.filter((c) => !c.description?.trim()).map((c) => ({ id: c.id, name: c.name })),
    productsWithLongSeoTitle: products.filter((p) => (p.seoTitle?.length ?? 0) > 60).map((p) => ({ id: p.id, name: p.name, length: p.seoTitle!.length })),
    reviewCount,
    hasWhatsapp: !!store.whatsappNumber,
  };
}

const OWNERS_TAKE = 300;
const clip = (s: string | null | undefined, n = 90) => {
  const t = (s ?? "").replace(/[*_#>[\]()`]/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const url = (images[0] as { url?: unknown } | undefined)?.url;
  return typeof url === "string" ? url : null;
}

function addMetafieldSamples(out: Record<string, string>, owner: string, map: StorefrontMetafields, ownerId: string | undefined) {
  if (!ownerId) return;
  for (const [nk, mf] of Object.entries(map[ownerId] ?? {})) {
    const text = mf.text || mf.url || mf.image?.url || "";
    if (text) out[`${owner}.metafields.${nk}`] = clip(text);
  }
}

/** Données lot 4 de l'éditeur : plan, modèles alternatifs utilisés, champs personnalisés publics, exemples, sections. */
export async function loadEditorLot4(store: StoreLike, planId: PlanId): Promise<EditorLot4> {
  const storeId = store.id;
  const rules = editorLot4Rules(planId);
  const [products, collections, pages, posts, definitions, sampleProduct, sampleCollection, samplePage, saved, library, qualityFacts] = await Promise.all([
    db.product.findMany({ where: { storeId, templateSuffix: { not: null }, status: { not: "ARCHIVED" } }, orderBy: { position: "asc" }, take: OWNERS_TAKE, select: { name: true, slug: true, templateSuffix: true } }),
    db.category.findMany({ where: { storeId, templateSuffix: { not: null } }, orderBy: { position: "asc" }, take: OWNERS_TAKE, select: { name: true, slug: true, templateSuffix: true } }),
    db.storePage.findMany({ where: { storeId, templateSuffix: { not: null } }, orderBy: { position: "asc" }, take: OWNERS_TAKE, select: { title: true, slug: true, templateSuffix: true } }),
    db.blogPost.findMany({ where: { storeId, templateSuffix: { not: null } }, take: OWNERS_TAKE, select: { title: true, slug: true, templateSuffix: true } }),
    listMetafieldDefinitions(storeId),
    db.product.findFirst({
      where: { storeId, status: "ACTIVE" },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      select: { id: true, name: true, slug: true, description: true, vendor: true, productType: true, tags: true, price: true, compareAtPrice: true, images: true, variants: { orderBy: { position: "asc" }, take: 1, select: { id: true, name: true, price: true, compareAtPrice: true, imageUrl: true } } },
    }),
    db.category.findFirst({ where: { storeId, published: true }, orderBy: { position: "asc" }, select: { id: true, name: true, slug: true, description: true, imageUrl: true } }),
    db.storePage.findFirst({ where: { storeId, published: true }, orderBy: { position: "asc" }, select: { id: true, title: true, slug: true, body: true } }),
    db.savedSection.findMany({ where: { storeId }, orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }], take: 200, select: { id: true, name: true, sectionType: true, previewUrl: true, usageCount: true, createdAt: true } }),
    listPublishedLibrary(planId),
    loadQualityFacts(store),
  ]);

  const alternateOwners: AlternateOwner[] = [
    ...products.map((p) => ({ type: "product" as const, suffix: p.templateSuffix!, name: p.name, path: `/p/${p.slug}` })),
    ...collections.map((c) => ({ type: "collection" as const, suffix: c.templateSuffix!, name: c.name, path: `/collections/${c.slug}` })),
    ...pages.map((p) => ({ type: "page" as const, suffix: p.templateSuffix!, name: p.title, path: `/pages/${p.slug}` })),
    ...posts.map((p) => ({ type: "article" as const, suffix: p.templateSuffix!, name: p.title, path: `/blog/${p.slug}` })),
  ];

  // Exemples (aperçu des sources dynamiques) : données publiques uniquement.
  const money = (n: number | null | undefined) => (typeof n === "number" ? formatMoney(n, store.currency) : "");
  const samples: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => {
    const t = clip(v);
    if (t) samples[k] = t;
  };
  put("store.title", store.name);
  put("store.description", store.description);
  put("store.url", `/s/${store.slug}`);
  if (store.logoUrl && isDisplayableImageUrl(store.logoUrl)) put("store.image", "Logo de la boutique");
  const p = sampleProduct;
  if (p) {
    put("product.title", p.name);
    put("product.vendor", p.vendor);
    put("product.type", p.productType);
    put("product.description", p.description);
    put("product.tags", p.tags.join(", "));
    put("product.price", money(p.price));
    put("product.compare_at_price", money(p.compareAtPrice));
    if (firstImageUrl(p.images)) put("product.image", `Photo principale de « ${p.name} »`);
    put("product.url", `/p/${p.slug}`);
    const v = p.variants[0];
    if (v) {
      put("variant.title", v.name);
      put("variant.price", money(v.price ?? p.price));
      put("variant.compare_at_price", money(v.compareAtPrice));
      if (v.imageUrl) put("variant.image", `Photo de la variante « ${v.name} »`);
    }
  }
  if (sampleCollection) {
    put("collection.title", sampleCollection.name);
    put("collection.description", sampleCollection.description);
    if (sampleCollection.imageUrl) put("collection.image", `Image de « ${sampleCollection.name} »`);
    put("collection.url", `/collections/${sampleCollection.slug}`);
  }
  if (samplePage) {
    put("page.title", samplePage.title);
    put("page.description", samplePage.body);
    put("page.url", `/pages/${samplePage.slug}`);
  }
  const publicDefs = definitions.filter((d) => d.storefrontVisible && ownerCanBePublic(d.ownerType));
  if (publicDefs.length) {
    const [pm, vm, cm, sm, pgm] = await Promise.all([
      p ? getStorefrontMetafields(storeId, "PRODUCT", [p.id]) : {},
      p?.variants[0] ? getStorefrontMetafields(storeId, "VARIANT", [p.variants[0].id]) : {},
      sampleCollection ? getStorefrontMetafields(storeId, "COLLECTION", [sampleCollection.id]) : {},
      getStorefrontMetafields(storeId, "STORE", [storeId]),
      samplePage ? getStorefrontMetafields(storeId, "PAGE", [samplePage.id]) : {},
    ]);
    addMetafieldSamples(samples, "product", pm, p?.id);
    addMetafieldSamples(samples, "variant", vm, p?.variants[0]?.id);
    addMetafieldSamples(samples, "collection", cm, sampleCollection?.id);
    addMetafieldSamples(samples, "store", sm, storeId);
    addMetafieldSamples(samples, "page", pgm, samplePage?.id);
  }

  const savedSections: EditorSavedSection[] = saved.map((row) => {
    const d = toSavedSectionDTO(row);
    return { id: d.id, name: d.name, sectionType: d.sectionType, sectionName: d.sectionName, createdAt: d.createdAt };
  });
  const libraryItems: EditorLibraryItem[] = library.map((it) => ({
    id: it.id,
    slug: it.slug,
    name: it.name,
    description: it.description,
    category: it.category,
    sectionType: it.sectionType,
    previewUrl: it.previewUrl && isDisplayableImageUrl(it.previewUrl) ? it.previewUrl : null,
    premium: it.premium,
    requiredPlanName: it.requiredPlanName,
    locked: it.locked,
    lockReason: it.lockReason,
  }));

  return {
    planId,
    rules,
    alternateOwners,
    metafields: publicDefs.map((d) => ({ ownerType: d.ownerType, namespace: d.namespace, key: d.key, type: d.type, name: d.name, storefrontVisible: d.storefrontVisible })),
    samples,
    sampleProductName: p?.name ?? null,
    savedSections,
    library: libraryItems,
    storeCity: store.city,
    qualityFacts,
  };
}
