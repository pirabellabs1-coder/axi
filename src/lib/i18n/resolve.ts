import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/auth/permissions";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  LOCALE_PATH_HEADER,
  isPlatformLocale,
  localeDir,
  localeEndonym,
  storeBasePath,
  storeLocales,
  suggestLocale,
  withLocalePath,
  type LocaleDir,
  type LocaleView,
  type StoreLocales,
} from "@/i18n/locales";
import { localizeSectorCopy } from "@/i18n/dictionary";
import { resourceKey, THEME_RESOURCE_ID, optionNameField, optionValueField, pick, type TranslatableResourceType } from "./resources";
import { localizeThemeDocument } from "./localize-theme";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { isStale } from "./hash";

/**
 * Langue de la requête courante et application des traductions au rendu (lot 2 §1.1).
 *
 *  - l'URL fait foi : la langue vient de l'en-tête `x-axi-locale`, TOUJOURS écrasé par `src/proxy.ts`
 *    (une valeur envoyée par un client est ignorée, §8) ;
 *  - une langue non servie par la boutique retombe sur la langue principale (le proxy redirige en 302) ;
 *  - cookie `axi_locale` et `Accept-Language` ne servent qu'au bandeau de suggestion, jamais à rediriger ;
 *  - un champ non traduit garde la langue principale : on ne mélange jamais deux langues dans un champ.
 */

export type LocaleContext = {
  /** Langue affichée. */
  locale: string;
  /** Langue principale de la boutique. */
  primary: string;
  /** Langue affichée différente de la principale (URL préfixée). */
  isSecondary: boolean;
  dir: LocaleDir;
  /** Langues servies (principale d'abord), quota du plan appliqué. */
  served: string[];
  /** Préfixe des liens : "" ou "/en". */
  prefix: string;
  /** Base des liens de la boutique : `/s/{slug}` ou `/s/{slug}/en`. */
  basePath: string;
  /** Chemin public SANS segment de langue (transmis par le proxy), pour les alternatives hreflang. */
  path: string;
  /** Suggestion de langue (bandeau), jamais une redirection. */
  suggestion: { locale: string; label: string; href: string } | null;
};

type LocaleStore = { id: string; slug: string; locale?: string | null; enabledLocales?: readonly string[] | null; subscription?: Subscription | null };

/** Quota de langues du plan (`limits.languages`, null = illimité). */
export function languageAllowance(planId: keyof typeof PLANS): number | null {
  return PLANS[planId].limits.languages;
}

/** Langues servies par une boutique, quota du plan appliqué (langues en trop conservées mais désactivées). */
export function servedLocales(store: LocaleStore): StoreLocales {
  return storeLocales(store, languageAllowance(effectivePlanId(store.subscription ?? null)));
}

/** Un emplacement par boutique et par requête (React `cache` : mémoire propre à la requête). */
const slot = cache((storeId: string) => ({ storeId }) as { storeId: string; ctx?: Promise<LocaleContext> });

export function requestLocale(store: LocaleStore): Promise<LocaleContext> {
  const s = slot(store.id);
  return (s.ctx ??= buildContext(store).catch(() => fallbackContext(store)));
}

function fallbackContext(store: LocaleStore): LocaleContext {
  const locales = storeLocales(store, null);
  return {
    locale: locales.primary,
    primary: locales.primary,
    isSecondary: false,
    dir: localeDir(locales.primary),
    served: [locales.primary],
    prefix: "",
    basePath: `/s/${store.slug}`,
    path: `/s/${store.slug}`,
    suggestion: null,
  };
}

async function buildContext(store: LocaleStore): Promise<LocaleContext> {
  const locales = servedLocales(store);
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const requested = h.get(LOCALE_HEADER);
  const locale = isPlatformLocale(requested) && locales.all.includes(requested) ? requested : locales.primary;
  // Chemin public sans segment de langue : posé par le proxy ; à défaut, l'accueil de la boutique.
  const rawPath = h.get(LOCALE_PATH_HEADER);
  const path = typeof rawPath === "string" && rawPath.startsWith("/") && rawPath.length < 1024 ? rawPath : `/s/${store.slug}`;
  const suggested = suggestLocale({
    current: locale,
    cookie: jar.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: h.get("accept-language"),
    served: locales.all,
  });
  return {
    locale,
    primary: locales.primary,
    isSecondary: locale !== locales.primary,
    dir: localeDir(locale),
    served: locales.all,
    prefix: locale === locales.primary ? "" : `/${locale}`,
    basePath: storeBasePath(store.slug, locale, locales.primary),
    path,
    suggestion: suggested
      ? { locale: suggested, label: localeEndonym(suggested), href: withLocalePath(path, suggested === locales.primary ? null : suggested) }
      : null,
  };
}

/**
 * Langue à mémoriser sur une commande (`Order.locale`, §1.1 « Commandes ») : celle de l'URL si la boutique
 * la sert réellement, sinon sa langue principale. Jamais fournie par le formulaire : relue de l'en-tête
 * `x-axi-locale` posé par le proxy.
 */
export async function requestOrderLocale(store: { id: string } | null | undefined): Promise<string | null> {
  if (!store) return null;
  // Hors requête HTTP (caisse, tâche de fond, import) : aucune langue d'affichage, la commande reste neutre.
  let requested: string | null = null;
  try {
    requested = (await headers()).get(LOCALE_HEADER);
  } catch {
    return null;
  }
  if (!isPlatformLocale(requested)) return null;
  const row = await db.store.findUnique({ where: { id: store.id }, select: { locale: true, enabledLocales: true, subscription: true } });
  if (!row) return null;
  const locales = servedLocales({ id: store.id, slug: "", ...row });
  return locales.all.includes(requested) ? requested : locales.primary;
}

/* ───────────────────────── SEO : hreflang et alternatives ───────────────────────── */

/**
 * `alternates.languages` de `generateMetadata` : une URL par langue servie, plus `x-default` sur la langue
 * principale (§1.1). Chemins relatifs : Next les résout avec `metadataBase`.
 */
export function localeAlternates(ctx: Pick<LocaleContext, "served" | "primary" | "path">, path = ctx.path): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const code of ctx.served) languages[code] = withLocalePath(path, code === ctx.primary ? null : code);
  languages["x-default"] = withLocalePath(path, null);
  return { canonical: withLocalePath(path, null), languages };
}

/* ───────────────────────── Chargement des traductions ───────────────────────── */

/** Champs traduits d'une ressource : `field` → valeur. */
export type FieldMap = Record<string, string>;
export type TranslationBundle = Map<string, FieldMap>;

export type Selector = Partial<Record<TranslatableResourceType, string[]>>;

const MAX_ROWS = 5_000;

/**
 * Traductions d'une boutique pour une langue, limitées aux ressources demandées. Toujours filtré par
 * `storeId` : une boutique ne peut jamais lire les traductions d'une autre.
 */
export async function loadTranslations(storeId: string, locale: string, want: Selector): Promise<TranslationBundle> {
  const or = Object.entries(want)
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([resourceType, ids]) => ({ resourceType: resourceType as TranslatableResourceType, resourceId: { in: [...new Set(ids!)].slice(0, 2_000) } }));
  const bundle: TranslationBundle = new Map();
  if (!or.length || !isPlatformLocale(locale)) return bundle;
  const rows = await db.translation.findMany({
    where: { storeId, locale, OR: or },
    select: { resourceType: true, resourceId: true, field: true, value: true },
    take: MAX_ROWS,
  });
  for (const r of rows) {
    const key = resourceKey(r.resourceType, r.resourceId);
    const map = bundle.get(key) ?? {};
    map[r.field] = r.value;
    bundle.set(key, map);
  }
  return bundle;
}

const fields = (bundle: TranslationBundle, type: TranslatableResourceType, id: string): FieldMap | undefined => bundle.get(resourceKey(type, id));

/** Boutique traduite pour les métadonnées (titre, description, hreflang) sans charger tout le rendu. */
export async function localizedStore<T extends { name: string; tagline?: string | null; description?: string | null }>(store: LocaleStore & T): Promise<{ ctx: LocaleContext; name: string; tagline: string | null; description: string | null }> {
  const ctx = await requestLocale(store);
  const base = { name: store.name, tagline: store.tagline ?? null, description: store.description ?? null };
  if (!ctx.isSecondary) return { ctx, ...base };
  const bundle = await loadTranslations(store.id, ctx.locale, { STORE: [store.id] });
  const t = fields(bundle, "STORE", store.id);
  return { ctx, name: pick(t, "name", base.name), tagline: pick(t, "tagline", base.tagline), description: pick(t, "description", base.description) };
}

/* ───────────────────────── Application au rendu ───────────────────────── */

type RenderDataLike = import("@/lib/storefront/render-types").RenderData;

/** Adresses des pages de contenu (id ↔ slug) : nécessaire car `RenderData.pages` ne porte pas d'identifiant. */
const loadPageIds = cache(async (storeId: string) => db.storePage.findMany({ where: { storeId }, select: { id: true, slug: true } }));

/** Libellés sources des menus, par chemin d'index (`0`, `0.2`) : pour appliquer les traductions au rendu. */
const loadMenuLabels = cache(async (storeId: string) => {
  const rows = await db.storeMenu.findMany({ where: { storeId }, select: { handle: true, items: true } });
  const out = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const map = new Map<string, string>();
    walkMenu(row.items, "", 0, map);
    out.set(row.handle, map);
  }
  return out;
});

function walkMenu(items: unknown, prefix: string, depth: number, out: Map<string, string>) {
  if (!Array.isArray(items) || depth > 2) return;
  for (const [i, raw] of items.slice(0, 20).entries()) {
    const it = (raw && typeof raw === "object" ? raw : {}) as { label?: unknown; children?: unknown };
    const path = prefix ? `${prefix}.${i}` : String(i);
    if (typeof it.label === "string" && it.label.trim()) out.set(path, it.label.trim().slice(0, 60));
    walkMenu(it.children, path, depth + 1, out);
  }
}

/** Ressources présentes dans les données de rendu, à charger en une requête. */
function selectorsFor(store: { id: string }, data: RenderDataLike, pageIds: { id: string; slug: string }[]): Selector {
  const productIds = new Set<string>(Object.keys(data.products ?? {}));
  if (data.product) productIds.add(data.product.id);
  const variantIds = (data.product?.variants ?? []).map((v) => v.id);
  const optionIds = (data.product?.optionGroups ?? []).flatMap((g) => g.options.map((o) => o.id));
  const slugs = new Set((data.pages ?? []).map((p) => p.slug));
  return {
    STORE: [store.id],
    THEME: [THEME_RESOURCE_ID],
    PRODUCT: [...productIds],
    VARIANT: variantIds,
    OPTION: optionIds,
    COLLECTION: (data.collections ?? []).map((c) => c.id),
    PAGE: pageIds.filter((p) => slugs.has(p.slug)).map((p) => p.id),
    MENU: Object.keys(data.menus ?? {}),
  };
}

/**
 * Traduit les données de rendu EN PLACE (objet construit juste avant par `loadRenderData`, jamais partagé)
 * et renvoie le document de thème traduit. Les identifiants, prix, URLs d'images et stocks ne sont jamais
 * touchés : seules des chaînes de texte sont remplacées.
 */
export async function localizeStorefront(store: LocaleStore, doc: ThemeDocument, data: RenderDataLike): Promise<{ ctx: LocaleContext; doc: ThemeDocument }> {
  const ctx = await requestLocale(store);
  // La langue principale n'a pas de traductions : on pose seulement le préfixe (vide) et la vue de langue.
  data.store.localePrefix = ctx.prefix;
  data.locale = localeView(ctx);
  if (!ctx.isSecondary) return { ctx, doc };

  const pageIds = await loadPageIds(store.id);
  const [bundle, menuLabels] = await Promise.all([loadTranslations(store.id, ctx.locale, selectorsFor(store, data, pageIds)), loadMenuLabels(store.id)]);

  /* Boutique et libellés d'interface */
  const s = fields(bundle, "STORE", store.id);
  data.store.name = pick(s, "name", data.store.name);
  data.store.tagline = pick(s, "tagline", data.store.tagline);
  data.store.description = pick(s, "description", data.store.description);
  data.store.copy = localizeSectorCopy(data.store.copy, ctx.locale);

  /* Produits (cartes) */
  for (const card of Object.values(data.products ?? {})) {
    const t = fields(bundle, "PRODUCT", card.id);
    if (!t) continue;
    card.name = pick(t, "name", card.name);
    card.description = pick(t, "description", card.description);
    localizeOptions(card, t);
  }

  /* Fiche produit */
  const p = data.product;
  if (p) {
    const t = fields(bundle, "PRODUCT", p.id);
    if (t) {
      p.name = pick(t, "name", p.name);
      p.description = pick(t, "description", p.description);
      p.details = p.details.map((d, i) => ({ title: pick(t, `details.${i}.title`, d.title), body: pick(t, `details.${i}.body`, d.body) }));
      localizeOptions(p, t);
    }
    for (const v of p.variants) v.name = pick(fields(bundle, "VARIANT", v.id), "name", v.name);
    for (const g of p.optionGroups) {
      g.name = pick(t, optionNameField(g.name), g.name);
      for (const o of g.options) o.name = pick(fields(bundle, "OPTION", o.id), "name", o.name);
    }
    if (p.collection) {
      const c = data.collections.find((x) => x.handle === p.collection!.handle);
      if (c) p.collection.name = pick(fields(bundle, "COLLECTION", c.id), "name", p.collection.name);
    }
    p.url = `${ctx.basePath}/p/${p.slug}`;
  }

  /* Collections */
  for (const c of data.collections ?? []) {
    const t = fields(bundle, "COLLECTION", c.id);
    if (!t) continue;
    c.name = pick(t, "name", c.name);
    c.description = pick(t, "description", c.description);
    c.seoTitle = pick(t, "seoTitle", c.seoTitle);
    c.seoDescription = pick(t, "seoDescription", c.seoDescription);
  }

  /* Pages de contenu */
  const bySlug = new Map(pageIds.map((x) => [x.slug, x.id]));
  for (const page of data.pages ?? []) {
    const t = fields(bundle, "PAGE", bySlug.get(page.slug) ?? "");
    page.title = pick(t, "title", page.title);
  }
  if (data.page) {
    // La page rendue est identifiée par son titre source dans `pages` (même requête, même ordre).
    const match = (data.pages ?? []).find((x) => x.title === data.page!.title);
    const id = match ? bySlug.get(match.slug) : undefined;
    const t = id ? fields(bundle, "PAGE", id) : undefined;
    data.page = { ...data.page, title: pick(t, "title", data.page.title), body: pick(t, "body", data.page.body) };
  }

  /* Menus : libellé traduit par chemin d'index, retrouvé par le libellé source */
  for (const [handle, links] of Object.entries(data.menus ?? {})) {
    const t = fields(bundle, "MENU", handle);
    const labels = menuLabels.get(handle);
    if (t && labels) {
      const byLabel = new Map<string, string>();
      for (const [path, source] of labels) {
        const value = t[path];
        if (typeof value === "string" && value.trim()) byLabel.set(source, value);
      }
      applyMenuLabels(links, byLabel);
    }
    prefixLinks(links, store.slug, ctx.prefix);
  }

  /* Listes : titre de collection et chemin de base préfixé */
  if (data.listing) {
    if (data.listing.collectionId) {
      const c = data.collections.find((x) => x.id === data.listing!.collectionId);
      if (c) {
        data.listing.title = c.name;
        data.listing.description = c.description;
      }
    }
    data.listing.basePath = prefixPath(data.listing.basePath, store.slug, ctx.prefix);
  }

  /* Thème : seuls les champs texte, revalidés par sanitizeFieldValue */
  const themeFields = fields(bundle, "THEME", THEME_RESOURCE_ID);
  const localizedDoc = themeFields ? localizeThemeDocument(doc, themeFields) : doc;
  return { ctx, doc: localizedDoc };
}

/** Options et attributs de variantes : remplacement par correspondance de TEXTE, de façon cohérente. */
function localizeOptions(target: { options: { name: string; values: { value: string }[] }[]; variants: { attributes: Record<string, string> }[] }, t: FieldMap) {
  for (const o of target.options) {
    const name = pick(t, optionNameField(o.name), o.name);
    for (const v of o.values) v.value = pick(t, optionValueField(v.value), v.value);
    o.name = name;
  }
  for (const v of target.variants) {
    const next: Record<string, string> = {};
    for (const [k, value] of Object.entries(v.attributes)) next[pick(t, optionNameField(k), k)] = pick(t, optionValueField(value), value);
    v.attributes = next;
  }
}

function applyMenuLabels(links: { label: string; children: { label: string; children: unknown[] }[] }[], byLabel: Map<string, string>) {
  for (const link of links) {
    const v = byLabel.get(link.label);
    if (v) link.label = v;
    applyMenuLabels(link.children as never, byLabel);
  }
}

/** Ajoute le segment de langue aux liens internes de la boutique (`/s/{slug}/…`). */
function prefixLinks(links: { href: string; children: unknown[] }[], slug: string, prefix: string) {
  if (!prefix) return;
  for (const link of links) {
    link.href = prefixPath(link.href, slug, prefix);
    prefixLinks(link.children as never, slug, prefix);
  }
}

function prefixPath(href: string, slug: string, prefix: string): string {
  if (!prefix || !href.startsWith(`/s/${slug}`)) return href;
  const rest = href.slice(`/s/${slug}`.length);
  if (rest.startsWith(`${prefix}/`) || rest === prefix) return href;
  return `/s/${slug}${prefix}${rest}`;
}

/* ───────────────────────── Vue passée au rendu ───────────────────────── */

export type { LocaleView };

export function localeView(ctx: LocaleContext): LocaleView {
  return {
    locale: ctx.locale,
    primary: ctx.primary,
    dir: ctx.dir,
    prefix: ctx.prefix,
    options: ctx.served.map((code) => ({
      code,
      label: localeEndonym(code),
      href: withLocalePath(ctx.path, code === ctx.primary ? null : code),
      current: code === ctx.locale,
    })),
    suggestion: ctx.suggestion,
  };
}

/* ───────────────────────── Écran marchand : état des traductions ───────────────────────── */

export type TranslationRow = { field: string; value: string; source: string; sourceHash: string; updatedAt: Date };

/** Traductions d'UNE ressource, avec l'état d'obsolescence calculé par rapport aux sources actuelles. */
export async function resourceTranslations(storeId: string, type: TranslatableResourceType, resourceId: string, locale: string): Promise<Map<string, TranslationRow>> {
  const rows = await db.translation.findMany({
    where: { storeId, resourceType: type, resourceId, locale },
    select: { field: true, value: true, source: true, sourceHash: true, updatedAt: true },
  });
  return new Map(rows.map((r) => [r.field, r]));
}

/** Un champ traduit est-il « à revoir » (source modifiée depuis la traduction) ? Reste affiché malgré tout. */
export function fieldIsStale(row: TranslationRow | undefined, source: string): boolean {
  return !!row && isStale(row.sourceHash, source);
}

export { DEFAULT_LOCALE };
