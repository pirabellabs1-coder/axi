import "server-only";
import { db } from "@/lib/db";
import { getThemeDocument } from "@/lib/theme-engine/resolve";
import { themeTextFields } from "./localize-theme";
import { isStale } from "./hash";
import {
  RESOURCE_META,
  THEME_RESOURCE_ID,
  blogCategorySourceFields,
  blogPostSourceFields,
  collectionSourceFields,
  menuSourceFields,
  optionSourceFields,
  pageSourceFields,
  productSourceFields,
  storeSourceFields,
  variantSourceFields,
  type SourceField,
  type TranslatableResourceType,
} from "./resources";

/**
 * Lecture des contenus traduisibles d'une boutique (lot 2 §1.1) : textes sources par ressource, état des
 * traductions et couverture. TOUJOURS filtré par `storeId` (isolation, §8) ; aucune écriture ici.
 */

export type ResourceEntry = {
  type: TranslatableResourceType;
  id: string;
  /** Nom affiché dans l'écran marchand. */
  label: string;
  /** Lien vers la ressource dans l'espace marchand, si elle en a un. */
  href?: string;
  fields: SourceField[];
};

/** Plafonds de lecture : un écran de traduction ne charge jamais tout le catalogue d'un coup. */
export const RESOURCE_PAGE_SIZE = 50;
const MAX_IDS = 200;

type StoreRow = { id: string; slug: string };

const ids = (v?: string[] | null) => (v && v.length ? [...new Set(v)].slice(0, MAX_IDS) : null);

export async function loadResources(storeId: string, type: TranslatableResourceType, only?: string[] | null, opts: { skip?: number; take?: number } = {}): Promise<ResourceEntry[]> {
  const list = ids(only);
  const take = Math.min(opts.take ?? RESOURCE_PAGE_SIZE, MAX_IDS);
  const skip = Math.max(0, opts.skip ?? 0);
  const where = list ? { id: { in: list } } : {};

  switch (type) {
    case "STORE": {
      const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, tagline: true, description: true, orderNotes: true } });
      return store ? [{ type, id: store.id, label: store.name, href: `/app/${storeId}/parametres`, fields: storeSourceFields(store) }] : [];
    }
    case "PRODUCT": {
      const rows = await db.product.findMany({
        where: { storeId, ...where },
        select: { id: true, name: true, slug: true, description: true, seoTitle: true, seoDescription: true, details: true, options: true },
        orderBy: { name: "asc" },
        skip,
        take,
      });
      return rows.map((p) => ({ type, id: p.id, label: p.name, href: `/app/${storeId}/produits/${p.id}`, fields: productSourceFields(p) }));
    }
    case "VARIANT": {
      const rows = await db.variant.findMany({
        where: { product: { storeId }, ...where },
        select: { id: true, name: true, product: { select: { name: true } } },
        orderBy: { name: "asc" },
        skip,
        take,
      });
      return rows.map((v) => ({ type, id: v.id, label: `${v.product.name} · ${v.name}`, fields: variantSourceFields(v) }));
    }
    case "OPTION": {
      const rows = await db.option.findMany({
        where: { group: { product: { storeId } }, ...where },
        select: { id: true, name: true, group: { select: { name: true } } },
        orderBy: { name: "asc" },
        skip,
        take,
      });
      return rows.map((o) => ({ type, id: o.id, label: `${o.group.name} · ${o.name}`, fields: optionSourceFields(o) }));
    }
    case "COLLECTION": {
      const rows = await db.category.findMany({
        where: { storeId, ...where },
        select: { id: true, name: true, description: true, seoTitle: true, seoDescription: true },
        orderBy: { position: "asc" },
        skip,
        take,
      });
      return rows.map((c) => ({ type, id: c.id, label: c.name, href: `/app/${storeId}/collections/${c.id}`, fields: collectionSourceFields(c) }));
    }
    case "PAGE": {
      const rows = await db.storePage.findMany({ where: { storeId, ...where }, select: { id: true, title: true, body: true }, orderBy: { position: "asc" }, skip, take });
      return rows.map((p) => ({ type, id: p.id, label: p.title, href: `/app/${storeId}/pages`, fields: pageSourceFields(p) }));
    }
    case "MENU": {
      const rows = await db.storeMenu.findMany({ where: { storeId }, select: { handle: true, items: true } });
      return rows
        .filter((m) => !list || list.includes(m.handle))
        .map((m) => ({ type, id: m.handle, label: `Menu « ${m.handle} »`, href: `/app/${storeId}/navigation`, fields: menuSourceFields(m.items) }));
    }
    case "THEME": {
      const store = await db.store.findUnique({
        where: { id: storeId },
        select: { sector: true, themeId: true, themeConfig: true, bannerUrl: true, logoUrl: true, name: true, tagline: true, description: true, whatsappNumber: true, themeDoc: true, themeDocDraft: true },
      });
      if (!store) return [];
      const doc = getThemeDocument(store);
      return [{ type, id: THEME_RESOURCE_ID, label: "Textes du thème publié", href: `/app/${storeId}/apparence`, fields: themeTextFields(doc).map((f) => ({ field: f.path, label: f.label, value: f.value, kind: f.kind === "richtext" ? "markdown" : "long" })) }];
    }
    case "BLOG_POST": {
      const rows = await db.blogPost.findMany({
        where: { storeId, ...where },
        select: { id: true, title: true, excerpt: true, body: true, seoTitle: true, seoDescription: true },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      });
      return rows.map((p) => ({ type, id: p.id, label: p.title, href: `/app/${storeId}/blog/${p.id}`, fields: blogPostSourceFields(p) }));
    }
    case "BLOG_CATEGORY": {
      const rows = await db.blogCategory.findMany({ where: { storeId, ...where }, select: { id: true, name: true, description: true }, orderBy: { position: "asc" }, skip, take });
      return rows.map((c) => ({ type, id: c.id, label: c.name, href: `/app/${storeId}/blog`, fields: blogCategorySourceFields(c) }));
    }
    default:
      return [];
  }
}

/** Nombre total de ressources d'un type (pagination de l'écran marchand). */
export async function countResources(storeId: string, type: TranslatableResourceType): Promise<number> {
  switch (type) {
    case "STORE":
    case "THEME":
      return 1;
    case "PRODUCT":
      return db.product.count({ where: { storeId } });
    case "VARIANT":
      return db.variant.count({ where: { product: { storeId } } });
    case "OPTION":
      return db.option.count({ where: { group: { product: { storeId } } } });
    case "COLLECTION":
      return db.category.count({ where: { storeId } });
    case "PAGE":
      return db.storePage.count({ where: { storeId } });
    case "MENU":
      return db.storeMenu.count({ where: { storeId } });
    case "BLOG_POST":
      return db.blogPost.count({ where: { storeId } });
    case "BLOG_CATEGORY":
      return db.blogCategory.count({ where: { storeId } });
    default:
      return 0;
  }
}

export type FieldState = {
  field: string;
  label: string;
  source: string;
  kind: SourceField["kind"];
  /** Traduction enregistrée, ou null (repli sur la langue principale au rendu). */
  value: string | null;
  /** MANUAL | AI | IMPORT */
  origin: string | null;
  /** Source modifiée depuis la traduction : « à revoir », mais la traduction reste affichée. */
  stale: boolean;
};

export type ResourceState = ResourceEntry & {
  fieldStates: FieldState[];
  translated: number;
  total: number;
  stale: number;
};

/** État des traductions d'un ensemble de ressources pour une langue (tableau « source / traduction / état »). */
export async function resourceStates(storeId: string, locale: string, entries: ResourceEntry[]): Promise<ResourceState[]> {
  if (!entries.length) return [];
  const rows = await db.translation.findMany({
    where: { storeId, locale, OR: entries.map((e) => ({ resourceType: e.type, resourceId: e.id })) },
    select: { resourceType: true, resourceId: true, field: true, value: true, source: true, sourceHash: true },
    take: 5_000,
  });
  const index = new Map<string, { value: string; source: string; sourceHash: string }>();
  for (const r of rows) index.set(`${r.resourceType}:${r.resourceId}:${r.field}`, r);

  return entries.map((entry) => {
    const fieldStates: FieldState[] = entry.fields.map((f) => {
      const row = index.get(`${entry.type}:${entry.id}:${f.field}`);
      return {
        field: f.field,
        label: f.label,
        source: f.value,
        kind: f.kind,
        value: row?.value ?? null,
        origin: row?.source ?? null,
        stale: !!row && isStale(row.sourceHash, f.value),
      };
    });
    return {
      ...entry,
      fieldStates,
      total: fieldStates.length,
      translated: fieldStates.filter((f) => f.value !== null).length,
      stale: fieldStates.filter((f) => f.stale).length,
    };
  });
}

/** Couverture par type de ressource (résumé de l'écran marchand et ressource MCP `axi://i18n/coverage`). */
export async function translationCoverage(storeId: string, locale: string, types: readonly TranslatableResourceType[]): Promise<{ type: TranslatableResourceType; label: string; translated: number; total: number; stale: number }[]> {
  const out: { type: TranslatableResourceType; label: string; translated: number; total: number; stale: number }[] = [];
  for (const type of types) {
    const entries = await loadResources(storeId, type, null, { take: MAX_IDS });
    const states = await resourceStates(storeId, locale, entries);
    out.push({
      type,
      label: RESOURCE_META[type].plural,
      translated: states.reduce((n, s) => n + s.translated, 0),
      total: states.reduce((n, s) => n + s.total, 0),
      stale: states.reduce((n, s) => n + s.stale, 0),
    });
  }
  return out;
}

export type { StoreRow };
