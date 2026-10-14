import "server-only";
import { db, type Tx } from "@/lib/db";
import { DEFAULT_LOCATION_NAME, type LocationRow } from "./types";

export { DEFAULT_LOCATION_NAME, MAX_LOCATIONS_HARD, LOCATION_TYPE_LABELS, locationLimit, locationLimitMessage } from "./types";
export type { LocationRow, LocationType } from "./types";

/**
 * Dépôts (lot 3 §1.1). Chaque boutique a un dépôt par défaut (« Dépôt principal ») ; les boutiques
 * antérieures au lot 3 sont rattrapées par `scripts/migrate-locations.ts` (idempotent) et, à la volée,
 * par `ensureDefaultLocationTx` lors de la première écriture de stock par dépôt.
 */

export async function listLocations(storeId: string, client: Tx | typeof db = db): Promise<LocationRow[]> {
  return client.location.findMany({
    where: { storeId },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, city: true, isDefault: true, active: true, fulfillsOnlineOrders: true, pickupEnabled: true, position: true },
  });
}

/** Dépôt par défaut (sinon le premier dépôt actif). `null` si la boutique n'a encore aucun dépôt. */
export async function getDefaultLocationId(storeId: string, client: Tx | typeof db = db): Promise<string | null> {
  const row = await client.location.findFirst({
    where: { storeId, active: true },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Dépôt par défaut, créé s'il n'existe pas (transaction de l'appelant), avec initialisation des niveaux
 * depuis les stocks agrégés. Appelé à la CRÉATION D'UNE BOUTIQUE (majeur n° 8 : sans cela, une boutique
 * née après la migration n'avait aucun dépôt — caisse inutilisable, aucun niveau écrit, puis autant
 * d'écarts d'inventaire que d'articles le jour où le commerçant créait son premier dépôt).
 */
export async function ensureDefaultLocationTx(tx: Tx, storeId: string, opts: { country?: string; city?: string | null } = {}): Promise<string> {
  const existing = await getDefaultLocationId(storeId, tx);
  if (existing) return existing;
  const created = await tx.location.create({
    data: {
      storeId,
      name: DEFAULT_LOCATION_NAME,
      type: "WAREHOUSE",
      country: opts.country ?? "BJ",
      city: opts.city ?? null,
      isDefault: true,
      pickupEnabled: true,
      position: 0,
    },
    select: { id: true },
  });
  await initializeLevelsFromAggregateTx(tx, storeId, created.id);
  return created.id;
}

/**
 * Initialise les niveaux d'un dépôt depuis les stocks AGRÉGÉS (même logique idempotente que
 * `scripts/migrate-locations.ts`) : chaque produit simple suivi et chaque variante suivie reçoit un
 * niveau égal à son stock courant, SAUF s'il possède déjà un niveau (dans n'importe quel dépôt) —
 * un stock déjà réparti n'est jamais recrédité. Invariant visé : agrégat = Σ niveaux + en transit.
 * Renvoie le nombre de niveaux créés.
 */
export async function initializeLevelsFromAggregateTx(tx: Tx, storeId: string, locationId: string): Promise<number> {
  const products = await tx.product.findMany({
    where: { storeId, trackStock: true, status: { not: "ARCHIVED" } },
    select: { id: true, stock: true, variants: { select: { id: true, stock: true } } },
    take: 5_000,
  });
  const targets: { productId: string; variantId: string | null; itemKey: string; stock: number }[] = [];
  for (const p of products) {
    if (!p.variants.length) {
      targets.push({ productId: p.id, variantId: null, itemKey: p.id, stock: p.stock });
      continue;
    }
    for (const v of p.variants) targets.push({ productId: p.id, variantId: v.id, itemKey: v.id, stock: v.stock });
  }
  if (!targets.length) return 0;
  const existing = await tx.inventoryLevel.findMany({
    where: { storeId, itemKey: { in: targets.map((t) => t.itemKey) } },
    select: { itemKey: true },
  });
  const known = new Set(existing.map((e) => e.itemKey));
  const todo = targets.filter((t) => !known.has(t.itemKey));
  if (!todo.length) return 0;
  const created = await tx.inventoryLevel.createMany({
    data: todo.map((t) => ({ storeId, locationId, productId: t.productId, variantId: t.variantId, itemKey: t.itemKey, available: t.stock })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Stock restant dans un dépôt (archivage refusé tant qu'il n'est pas vide).
 * `net` est la somme ALGÉBRIQUE, `lines` le nombre d'articles dont le niveau n'est pas nul : un dépôt
 * portant +5 et −5 paraîtrait vide alors qu'il reste des écarts à régulariser (mineur n° 11).
 */
export async function locationStock(storeId: string, locationId: string, client: Tx | typeof db = db): Promise<{ net: number; lines: number }> {
  const rows = await client.inventoryLevel.findMany({
    where: { storeId, locationId, available: { not: 0 } },
    select: { available: true },
    take: 5_000,
  });
  return { net: rows.reduce((sum, r) => sum + r.available, 0), lines: rows.length };
}

/** Somme algébrique du stock d'un dépôt (compatibilité : préférez `locationStock`). */
export async function locationStockUnits(storeId: string, locationId: string, client: Tx | typeof db = db): Promise<number> {
  return (await locationStock(storeId, locationId, client)).net;
}
