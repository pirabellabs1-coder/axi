import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getBuyer } from "@/lib/buyer/session";
import { getStorefrontMetafields, type StorefrontMetafields } from "@/lib/metafields/read";
import { internalHref } from "@/lib/theme-engine/resolve";
import { customerSegments, defaultAudience, deviceFromHints, isBotUserAgent, parseSourceCookie, type AudienceContext } from "@/lib/theme-engine/audience";
import { motionEnvFromRequest, type MotionEnv } from "@/lib/theme-engine/motion";
import type { SourceOwner } from "@/lib/theme-engine/dynamic-sources";
import type { RenderData } from "@/lib/storefront/render-types";
import type { TemplateId } from "@/lib/theme-engine/types";
import type { RenderMetafield, RenderMetafields } from "./lot4-types";

/**
 * Lot 4 (équipe T3) : données de rendu complémentaires, calculées côté serveur à chaque requête.
 *  - `loadTemplateSuffix` : modèle alternatif choisi par l'élément (Product / Category / StorePage.templateSuffix) ;
 *  - `loadRenderMetafields` : champs personnalisés publics du contexte (helpers de l'équipe D, `getStorefrontMetafields`) ;
 *  - `requestAudience` : contexte d'audience (session acheteur, cookies `axi_city` / `axi_src`, appareil, robots) ;
 *  - `requestMotionEnv` : Save-Data et mode économie (`axi_lite=1`).
 * Aucune donnée personnelle ne quitte le serveur : seuls des segments et des valeurs publiques sont transmis.
 */

/* ───────────── Modèles alternatifs ───────────── */

export type ItemRef = { productSlug?: string; collectionHandle?: string; pageSlug?: string };

/** Suffixe de modèle de l'élément affiché, et identifiant de la page de contenu (champs personnalisés). */
export async function loadTemplateSuffix(storeId: string, template: TemplateId, ref: ItemRef): Promise<{ suffix: string | null; pageId: string | null }> {
  try {
    if (template === "product" && ref.productSlug) {
      const p = await db.product.findFirst({ where: { storeId, slug: ref.productSlug, status: "ACTIVE" }, select: { templateSuffix: true } });
      return { suffix: p?.templateSuffix ?? null, pageId: null };
    }
    if (template === "collection" && ref.collectionHandle) {
      const c = await db.category.findFirst({ where: { storeId, slug: ref.collectionHandle, published: true }, select: { templateSuffix: true } });
      return { suffix: c?.templateSuffix ?? null, pageId: null };
    }
    if (template === "page" && ref.pageSlug && /^[a-z0-9-]{1,80}$/.test(ref.pageSlug)) {
      const pg = await db.storePage.findFirst({ where: { storeId, slug: ref.pageSlug, published: true }, select: { id: true, templateSuffix: true } });
      return { suffix: pg?.templateSuffix ?? null, pageId: pg?.id ?? null };
    }
  } catch {
    /* lecture impossible : modèle par défaut */
  }
  return { suffix: null, pageId: null };
}

/* ───────────── Champs personnalisés ───────────── */

function toRender(map: StorefrontMetafields, ownerId: string | null | undefined, base: string): Record<string, RenderMetafield> | undefined {
  const entries = ownerId ? map[ownerId] : undefined;
  if (!entries) return undefined;
  const out: Record<string, RenderMetafield> = {};
  const sorted = Object.entries(entries).sort(([, a], [, b]) => a.name.localeCompare(b.name, "fr"));
  for (const [k, m] of sorted) {
    out[k] = { namespace: m.namespace, key: m.key, name: m.name, type: m.type, value: m.value, storefrontVisible: true, text: m.text, url: m.url ? internalHref(base, m.url) : null, image: m.image };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Champs personnalisés publics des éléments du contexte de rendu (produit, variante, collection, boutique, page). */
export async function loadRenderMetafields(storeId: string, data: RenderData, opts: { pageId?: string | null } = {}): Promise<RenderMetafields> {
  const base = `/s/${data.store.slug}${data.store.localePrefix ?? ""}`; // lot 2 : segment de langue des liens
  const product = data.product;
  const variantId = product ? (product.requestedVariantId ?? product.variants[0]?.id ?? null) : null;
  const collectionId = data.listing?.kind === "collection" ? data.listing.collectionId : null;
  const safe = (p: Promise<StorefrontMetafields>) => p.catch(() => ({}) as StorefrontMetafields);
  const [p, v, c, s, pg] = await Promise.all([
    product ? safe(getStorefrontMetafields(storeId, "PRODUCT", [product.id])) : {},
    variantId ? safe(getStorefrontMetafields(storeId, "VARIANT", [variantId])) : {},
    collectionId ? safe(getStorefrontMetafields(storeId, "COLLECTION", [collectionId])) : {},
    safe(getStorefrontMetafields(storeId, "STORE", [storeId])),
    opts.pageId ? safe(getStorefrontMetafields(storeId, "PAGE", [opts.pageId])) : {},
  ]);
  const out: RenderMetafields = {};
  const set = (owner: SourceOwner, v2: Record<string, RenderMetafield> | undefined) => {
    if (v2) out[owner] = v2;
  };
  set("product", toRender(p, product?.id, base));
  set("variant", toRender(v, variantId, base));
  set("collection", toRender(c, collectionId, base));
  set("store", toRender(s, storeId, base));
  set("page", toRender(pg, opts.pageId, base));
  return out;
}

/* ───────────── Audience ───────────── */

function cookieCity(raw: string | undefined): string | null {
  if (!raw) return null;
  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    return null;
  }
  v = v.replace(/[\u0000-\u001f<>]/g, "").trim();
  return v && v.length <= 80 ? v : null;
}

/**
 * Contexte d'audience de la requête. Robots (et agent vide) : audience par défaut (anti-cloaking).
 * Ville : adresse par défaut de l'acheteur connecté, sinon cookie `axi_city`, sinon en-tête géographique de l'hébergeur.
 */
export async function requestAudience(store: { id: string; slug: string; timezone: string }, opts: { now: Date }): Promise<AudienceContext> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const ua = h.get("user-agent");
  const timeZone = store.timezone || undefined;
  if (isBotUserAgent(ua)) return { ...defaultAudience({ now: opts.now, timeZone }), isBot: true };

  const buyer = await getBuyer(store).catch(() => null);
  let city: string | null = null;
  if (buyer) {
    const addr = await db.customerAddress
      .findFirst({ where: { storeId: store.id, customerId: buyer.customerId, city: { not: null } }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], select: { city: true } })
      .catch(() => null);
    city = addr?.city?.trim().slice(0, 80) || null;
  }
  city ??= cookieCity(jar.get("axi_city")?.value) ?? cookieCity(h.get("x-vercel-ip-city") ?? undefined);

  const lang = h.get("accept-language")?.split(",")[0]?.trim().toLowerCase().split(/[-_;]/)[0] ?? null;
  return {
    city,
    customer: customerSegments({ loggedIn: !!buyer, orderCount: buyer?.customer.ordersCount, points: buyer?.customer.loyaltyPoints }),
    source: parseSourceCookie(jar.get("axi_src")?.value) ?? "direct",
    locale: lang && /^[a-z]{2,3}$/.test(lang) ? lang : null,
    device: deviceFromHints({ chUaMobile: h.get("sec-ch-ua-mobile"), userAgent: ua }),
    now: opts.now,
    timeZone,
    isBot: false,
  };
}

/* ───────────── Animations ───────────── */

/** Save-Data et mode économie de données (cookie `axi_lite=1`) : toutes les animations sont coupées. */
export async function requestMotionEnv(): Promise<MotionEnv> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  return motionEnvFromRequest({ saveDataHeader: h.get("save-data"), liteCookie: jar.get("axi_lite")?.value ?? null });
}
