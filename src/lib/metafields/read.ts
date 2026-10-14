import "server-only";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isMetafieldType, ownerCanBePublic, type MetafieldDefinitionDTO, type MetafieldOwnerType, type MetafieldType, type MetafieldValidations } from "./types";
import { metafieldText, readValidations } from "./validate";
import { sortDefinitions, toDefinitionDTO } from "./server";

/**
 * Lectures des champs personnalisés.
 *  - `listMetafieldDefinitions` / `getOwnerMetafields` : espace marchand (éditeur, écran de gestion).
 *  - `getStorefrontMetafields` : rendu boutique (équipe T3, sources dynamiques `…metafields.ns.key`, section
 *    `product-specs`, bloc `metafield`). Uniquement les définitions `storefrontVisible` d'un propriétaire public :
 *    jamais de champ de client ni de commande.
 */

export async function listMetafieldDefinitions(storeId: string, ownerType?: MetafieldOwnerType): Promise<MetafieldDefinitionDTO[]> {
  const rows = await db.metafieldDefinition.findMany({ where: { storeId, ...(ownerType ? { ownerType } : {}) }, orderBy: [{ ownerType: "asc" }, { name: "asc" }] });
  return sortDefinitions(rows.map(toDefinitionDTO).filter((d): d is MetafieldDefinitionDTO => d !== null));
}

export type OwnerMetafields = {
  definitions: MetafieldDefinitionDTO[];
  /** Valeurs actuelles par identifiant de définition. */
  values: Record<string, unknown>;
  /** Titres des produits / collections référencés (affichage dans l'éditeur). */
  refTitles: Record<string, string>;
};

/** Définitions et valeurs d'un élément. Le propriétaire doit avoir été vérifié dans la boutique par l'appelant. */
export async function getOwnerMetafields(storeId: string, ownerType: MetafieldOwnerType, ownerId: string): Promise<OwnerMetafields> {
  const [definitions, rows] = await Promise.all([
    listMetafieldDefinitions(storeId, ownerType),
    db.metafieldValue.findMany({ where: { storeId, ownerType, ownerId }, select: { definitionId: true, value: true } }),
  ]);
  const values: Record<string, unknown> = {};
  for (const r of rows) values[r.definitionId] = r.value;
  const refTitles = await referenceTitles(storeId, definitions, [values]);
  return { definitions, values, refTitles };
}

async function referenceTitles(storeId: string, defs: { id: string; type: MetafieldType }[], valueMaps: Record<string, unknown>[]): Promise<Record<string, string>> {
  const productIds = new Set<string>();
  const collectionIds = new Set<string>();
  for (const d of defs) {
    for (const m of valueMaps) {
      const v = m[d.id];
      if (typeof v !== "string") continue;
      if (d.type === "product_reference") productIds.add(v);
      if (d.type === "collection_reference") collectionIds.add(v);
    }
  }
  const [products, collections] = await Promise.all([
    productIds.size ? db.product.findMany({ where: { storeId, id: { in: [...productIds] } }, select: { id: true, name: true, slug: true } }) : [],
    collectionIds.size ? db.category.findMany({ where: { storeId, id: { in: [...collectionIds] } }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  const out: Record<string, string> = {};
  for (const p of products) out[p.id] = p.name;
  for (const c of collections) out[c.id] = c.name;
  return out;
}

/* ───────────── Boutique ───────────── */

export type StorefrontMetafield = {
  namespace: string;
  key: string;
  name: string;
  type: MetafieldType;
  /** Valeur JSON validée (forme : voir `types.ts`). */
  value: unknown;
  /** Texte lisible (dates en français, montants formatés, « Oui » / « Non », titre de la référence…). */
  text: string;
  /** Lien interne de la boutique (références : `/p/{slug}`, `/collections/{slug}`) ou lien du type `url`. */
  url: string | null;
  /** Image (type `image`). */
  image: { url: string; alt?: string } | null;
  validations: MetafieldValidations;
};

/** { [ownerId]: { ["namespace.key"]: StorefrontMetafield } } */
export type StorefrontMetafields = Record<string, Record<string, StorefrontMetafield>>;

const MAX_OWNERS = 500;

/**
 * Champs visibles en boutique pour une liste d'éléments d'UNE boutique (une requête pour les définitions, une pour
 * les valeurs, une par type de référence). Références vers un produit non actif ou une collection non publiée :
 * omises. Propriétaire client ou commande : toujours `{}`.
 */
export async function getStorefrontMetafields(storeId: string, ownerType: MetafieldOwnerType, ownerIds: string[]): Promise<StorefrontMetafields> {
  const ids = [...new Set(ownerIds.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, MAX_OWNERS);
  const out: StorefrontMetafields = {};
  if (!ids.length || !ownerCanBePublic(ownerType)) return out;
  const defs = await db.metafieldDefinition.findMany({ where: { storeId, ownerType, storefrontVisible: true } });
  const usable = defs.filter((d) => isMetafieldType(d.type));
  if (!usable.length) return out;
  const rows = await db.metafieldValue.findMany({
    where: { storeId, ownerType, ownerId: { in: ids }, definitionId: { in: usable.map((d) => d.id) } },
    select: { definitionId: true, ownerId: true, value: true },
  });
  if (!rows.length) return out;
  const byDef = new Map(usable.map((d) => [d.id, d]));

  // Références : uniquement ce qui est public.
  const refDefs = usable.map((d) => ({ id: d.id, type: d.type as MetafieldType }));
  const valueMaps = rows.map((r) => ({ [r.definitionId]: r.value }));
  const refTargets = await publicReferenceTargets(storeId, refDefs, valueMaps);

  for (const r of rows) {
    const d = byDef.get(r.definitionId);
    if (!d) continue;
    const type = d.type as MetafieldType;
    const validations = readValidations(type, d.validations);
    let url: string | null = null;
    let refTitle: string | null = null;
    if (type === "product_reference" || type === "collection_reference") {
      const t = typeof r.value === "string" ? refTargets.get(r.value) : undefined;
      if (!t) continue; // référence supprimée, brouillon ou non publiée : rien n'est exposé
      url = t.url;
      refTitle = t.title;
    }
    if (type === "url" && typeof r.value === "string") url = r.value;
    const image = type === "image" && r.value && typeof r.value === "object" && typeof (r.value as { url?: unknown }).url === "string" ? (r.value as { url: string; alt?: string }) : null;
    const text = metafieldText(type, r.value, { formatMoney, refTitle, validations });
    (out[r.ownerId] ??= {})[`${d.namespace}.${d.key}`] = { namespace: d.namespace, key: d.key, name: d.name, type, value: r.value, text, url, image, validations };
  }
  return out;
}

async function publicReferenceTargets(storeId: string, defs: { id: string; type: MetafieldType }[], valueMaps: Record<string, unknown>[]): Promise<Map<string, { title: string; url: string }>> {
  const productIds = new Set<string>();
  const collectionIds = new Set<string>();
  for (const m of valueMaps) {
    for (const d of defs) {
      const v = m[d.id];
      if (typeof v !== "string") continue;
      if (d.type === "product_reference") productIds.add(v);
      if (d.type === "collection_reference") collectionIds.add(v);
    }
  }
  const [products, collections] = await Promise.all([
    productIds.size ? db.product.findMany({ where: { storeId, id: { in: [...productIds] }, status: "ACTIVE" }, select: { id: true, name: true, slug: true } }) : [],
    collectionIds.size ? db.category.findMany({ where: { storeId, id: { in: [...collectionIds] }, published: true }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  const out = new Map<string, { title: string; url: string }>();
  for (const p of products) out.set(p.id, { title: p.name, url: `/p/${p.slug}` });
  for (const c of collections) out.set(c.id, { title: c.name, url: `/collections/${c.slug}` });
  return out;
}

/** Aide au rendu : valeur d'une source `…metafields.{namespace}.{key}` pour un propriétaire, ou undefined. */
export function pickStorefrontMetafield(map: StorefrontMetafields, ownerId: string, namespace: string, key: string): StorefrontMetafield | undefined {
  return map[ownerId]?.[`${namespace}.${key}`];
}
