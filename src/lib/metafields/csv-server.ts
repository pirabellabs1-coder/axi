import "server-only";
import { db, type Tx } from "@/lib/db";
import { listMetafieldDefinitions } from "./read";
import { metafieldsEnabled, writeOwnerMetafields, type WriteResult } from "./server";
import { mapMetafieldColumns, metafieldCsvCells, metafieldCsvHeaders, metafieldEntriesFromRow, type MetafieldColumns, type RefIds } from "./csv";
import type { PlanId } from "@/config/plans";

/**
 * Pont serveur entre le CSV du catalogue et les champs personnalisés produit.
 * Export : `productMetafieldCsv(storeId, productIds)` → en-têtes + cellules par produit.
 * Import : `prepareProductMetafieldImport(storeId, planId, headers)` une fois par fichier, puis
 *          `importProductMetafieldRow(tx, ctx, productId, row)` pour chaque ligne, dans la transaction du produit.
 */

export async function productMetafieldCsv(storeId: string, productIds: string[]): Promise<{ headers: string[]; cells: Map<string, Record<string, string>> }> {
  const defs = await listMetafieldDefinitions(storeId, "PRODUCT");
  const cells = new Map<string, Record<string, string>>();
  if (!defs.length || !productIds.length) return { headers: metafieldCsvHeaders(defs), cells };
  const rows = await db.metafieldValue.findMany({ where: { storeId, ownerType: "PRODUCT", ownerId: { in: productIds } }, select: { ownerId: true, definitionId: true, value: true } });
  const byOwner = new Map<string, Record<string, unknown>>();
  for (const r of rows) (byOwner.get(r.ownerId) ?? byOwner.set(r.ownerId, {}).get(r.ownerId)!)[r.definitionId] = r.value;
  const refIds = { product: new Set<string>(), collection: new Set<string>() };
  for (const r of rows) {
    const d = defs.find((x) => x.id === r.definitionId);
    if (typeof r.value !== "string" || !d) continue;
    if (d.type === "product_reference") refIds.product.add(r.value);
    if (d.type === "collection_reference") refIds.collection.add(r.value);
  }
  const [products, collections] = await Promise.all([
    refIds.product.size ? db.product.findMany({ where: { storeId, id: { in: [...refIds.product] } }, select: { id: true, slug: true } }) : [],
    refIds.collection.size ? db.category.findMany({ where: { storeId, id: { in: [...refIds.collection] } }, select: { id: true, slug: true } }) : [],
  ]);
  const slugById = { product: Object.fromEntries(products.map((p) => [p.id, p.slug])), collection: Object.fromEntries(collections.map((c) => [c.id, c.slug])) };
  for (const id of productIds) cells.set(id, metafieldCsvCells(defs, byOwner.get(id) ?? {}, slugById));
  return { headers: metafieldCsvHeaders(defs), cells };
}

/** Nombre maximal de produits / collections chargés pour résoudre les références par slug d'un import. */
const REF_SLUG_LIMIT = 5000;

export type MetafieldImportContext = { storeId: string; currency: string; mapping: MetafieldColumns; idBySlug: RefIds; enabled: boolean };

/** À appeler une fois par fichier. `enabled` faux (plan sans champs personnalisés) : colonnes ignorées. */
export async function prepareProductMetafieldImport(storeId: string, currency: string, planId: PlanId, headers: string[]): Promise<MetafieldImportContext> {
  const defs = await listMetafieldDefinitions(storeId, "PRODUCT");
  const mapping = mapMetafieldColumns(headers, defs);
  const needsRefs = mapping.columns.some((c) => c.definition.type === "product_reference" || c.definition.type === "collection_reference");
  let idBySlug: RefIds = {};
  if (needsRefs) {
    // Borne de sécurité : au-delà, les références par slug des dernières lignes ne sont pas résolues
    // (erreur « référence inconnue » explicite côté import) plutôt que de charger tout le catalogue en mémoire.
    const [products, collections] = await Promise.all([
      db.product.findMany({ where: { storeId }, select: { id: true, slug: true }, orderBy: { createdAt: "asc" }, take: REF_SLUG_LIMIT }),
      db.category.findMany({ where: { storeId }, select: { id: true, slug: true }, orderBy: { position: "asc" }, take: REF_SLUG_LIMIT }),
    ]);
    idBySlug = { product: Object.fromEntries(products.map((p) => [p.slug.toLowerCase(), p.id])), collection: Object.fromEntries(collections.map((c) => [c.slug.toLowerCase(), c.id])) };
  }
  return { storeId, currency, mapping, idBySlug, enabled: metafieldsEnabled(planId) };
}

/** Écrit les champs d'une ligne pour un produit de la boutique (tout ou rien pour la ligne ; erreurs par définition). */
export async function importProductMetafieldRow(tx: Tx, ctx: MetafieldImportContext, productId: string, row: Record<string, string | undefined>): Promise<WriteResult> {
  if (!ctx.enabled || !ctx.mapping.columns.length) return { errors: {}, written: 0, deleted: 0 };
  const entries = metafieldEntriesFromRow(row, ctx.mapping, ctx.idBySlug);
  return writeOwnerMetafields(tx, { storeId: ctx.storeId, currency: ctx.currency, ownerType: "PRODUCT", ownerId: productId, entries });
}
