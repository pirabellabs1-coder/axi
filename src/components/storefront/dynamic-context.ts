import { viewCurrency, viewMoney } from "@/lib/storefront/currency-view";
import type { DynamicRenderContext, PublicMetafield, SourceEntity } from "@/lib/theme-engine/dynamic-sources";
import type { RenderData } from "@/lib/storefront/render-types";
import type { RenderMetafield } from "./lot4-types";

/**
 * Lot 4 §5 (T3) : contexte des sources dynamiques construit à partir des données de rendu (pur, client et serveur).
 * Uniquement des données publiques déjà présentes dans `RenderData` (aucun client, aucune commande).
 */

function mf(map: Record<string, RenderMetafield> | undefined): Record<string, PublicMetafield> | undefined {
  return map;
}

export function dynamicContextFromData(data: RenderData): DynamicRenderContext {
  const base = `/s/${data.store.slug}${data.store.localePrefix ?? ""}`; // lot 2 : segment de langue des liens
  const m = data.metafields ?? {};
  // Lot 2 (devises) : un prix connecté par « Connecter une donnée » suit la devise d'affichage de l'acheteur.
  const view = data.currency;
  const currency = viewCurrency(view) || data.store.currency;
  const ctx: DynamicRenderContext = {
    currency,
    formatMoney: (amount) => viewMoney(view, amount),
    resolveReference: (type, id) => {
      if (type === "product_reference") {
        const p = data.products[id];
        return p ? `${base}/p/${p.slug}` : null;
      }
      const c = data.collections.find((x) => x.id === id);
      return c ? `${base}/collections/${c.handle}` : null;
    },
  };

  const s = data.store;
  const storeImage = s.logoUrl ? { url: s.logoUrl, alt: s.name } : s.bannerUrl ? { url: s.bannerUrl, alt: s.name } : null;
  ctx.store = { title: s.name, description: s.description ?? s.tagline, image: storeImage, url: base, metafields: mf(m.store) };

  const p = data.product;
  if (p) {
    ctx.product = { title: p.name, vendor: p.vendor, description: p.description, type: p.productType, tags: p.tags, price: p.basePrice, compare_at_price: p.compareAt, image: p.images[0] ?? null, url: p.url, metafields: mf(m.product) };
    const v = p.variants.find((x) => x.id === p.requestedVariantId) ?? p.variants[0];
    if (v) {
      const variant: SourceEntity = { title: v.name, price: v.price ?? p.basePrice, compare_at_price: v.compareAtPrice, image: v.imageUrl ? { url: v.imageUrl, alt: p.name } : (p.images[0] ?? null), url: `${p.url}?variante=${encodeURIComponent(v.id)}`, metafields: mf(m.variant) };
      ctx.variant = variant;
    }
  }

  const l = data.listing;
  if (l?.kind === "collection" && l.collectionId) {
    const c = data.collections.find((x) => x.id === l.collectionId);
    ctx.collection = { title: c?.name ?? l.title, description: c?.description ?? l.description, image: c?.image ?? l.image, url: l.basePath, metafields: mf(m.collection) };
  }

  if (data.page) ctx.page = { title: data.page.title, description: data.page.body, url: null, metafields: mf(m.page) };
  return ctx;
}
