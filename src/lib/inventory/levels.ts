import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { randomToken } from "@/lib/utils";

/**
 * Stock par dépôt (`InventoryLevel`) — lot 3 §1.1.
 *
 * INVARIANT : pour chaque article suivi, `Σ InventoryLevel.available` (tous dépôts) = `Product.stock`
 * (produit simple) ou `Variant.stock`. Le stock AGRÉGÉ reste la référence de disponibilité du checkout
 * (`createOrder` : aucune régression) ; les niveaux servent l'affectation, les transferts et la caisse.
 *
 * Règle d'écriture : toute écriture de stock met à jour l'agrégat ET le niveau du dépôt DANS LA MÊME
 * TRANSACTION. Deux portes d'entrée :
 *  - `recordStockChangeTx` : agrégat + niveau + mouvement (ajustement, comptage, retour, vente en caisse) ;
 *  - `applyLevelDeltaTx`   : niveau seul, quand l'agrégat a déjà été écrit par l'appelant (checkout, qui
 *    décrémente l'agrégat de façon conditionnelle) ou quand l'agrégat ne doit PAS bouger (transferts).
 * Le job quotidien `inventory.reconcile` signale tout écart sans correction automatique.
 */

export type InventoryReasonValue = "ADJUSTMENT" | "SALE" | "CANCEL" | "RETURN" | "IMPORT" | "TRANSFER" | "RECEIVE" | "COUNT";

/** Clé d'article d'un niveau de stock : la variante prime sur le produit (fonction pure). */
export function itemKeyOf(productId: string, variantId?: string | null): string {
  return variantId ?? productId;
}

/** Mouvements neutres pour le stock agrégé (transfert entre dépôts) : exclus des reconstitutions d'historique. */
export const AGGREGATE_NEUTRAL_REASONS: readonly InventoryReasonValue[] = ["TRANSFER", "RECEIVE"] as const;

function levelId(): string {
  return `lvl${randomToken(12)}`;
}

/**
 * Applique un delta au niveau d'un dépôt (création implicite si le niveau n'existe pas).
 * `upsert` sur la clé unique `(locationId, itemKey)` : Postgres l'exécute en
 * `INSERT … ON CONFLICT DO UPDATE` (atomique, sans lecture préalable).
 * Ne touche jamais l'agrégat : l'appelant en est responsable.
 */
export async function applyLevelDeltaTx(
  tx: Tx,
  p: { storeId: string; locationId: string; productId: string; variantId?: string | null; delta: number },
): Promise<void> {
  if (!Number.isInteger(p.delta)) throw new Error("applyLevelDeltaTx : delta entier attendu");
  if (p.delta === 0) return;
  const itemKey = itemKeyOf(p.productId, p.variantId);
  await tx.inventoryLevel.upsert({
    where: { locationId_itemKey: { locationId: p.locationId, itemKey } },
    create: {
      id: levelId(),
      storeId: p.storeId,
      locationId: p.locationId,
      productId: p.productId,
      variantId: p.variantId ?? null,
      itemKey,
      available: p.delta,
    },
    update: { available: { increment: p.delta } },
  });
}

/**
 * Applique un delta au niveau SOUS CONDITION de disponibilité (`available ≥ -delta` pour un retrait) :
 * renvoie `false` si le dépôt ne couvre pas la quantité (sortie de transfert, par exemple).
 */
export async function applyLevelDeltaIfAvailableTx(
  tx: Tx,
  p: { storeId: string; locationId: string; productId: string; variantId?: string | null; delta: number },
): Promise<boolean> {
  if (p.delta >= 0) {
    await applyLevelDeltaTx(tx, p);
    return true;
  }
  const itemKey = itemKeyOf(p.productId, p.variantId);
  const n = await tx.inventoryLevel.updateMany({
    where: { storeId: p.storeId, locationId: p.locationId, itemKey, available: { gte: -p.delta } },
    data: { available: { increment: p.delta } },
  });
  return n.count > 0;
}

/**
 * Écriture complète de stock : agrégat (Product.stock ou Variant.stock) + niveau du dépôt + mouvement,
 * dans la transaction de l'appelant. `delta` signé. Renvoie l'id du mouvement créé.
 */
export async function recordStockChangeTx(
  tx: Tx,
  p: {
    storeId: string;
    locationId: string | null;
    productId: string;
    variantId?: string | null;
    delta: number;
    reason: InventoryReasonValue;
    note?: string | null;
    orderId?: string | null;
    actorId?: string | null;
    /** false : l'agrégat n'est pas touché (transfert entre dépôts). */
    aggregate?: boolean;
  },
): Promise<string> {
  if (!Number.isInteger(p.delta)) throw new Error("recordStockChangeTx : delta entier attendu");
  if (p.delta !== 0 && p.aggregate !== false) {
    if (p.variantId) {
      await tx.variant.updateMany({ where: { id: p.variantId, productId: p.productId }, data: { stock: { increment: p.delta } } });
    } else {
      await tx.product.updateMany({ where: { id: p.productId, storeId: p.storeId }, data: { stock: { increment: p.delta } } });
    }
  }
  if (p.locationId) {
    await applyLevelDeltaTx(tx, { storeId: p.storeId, locationId: p.locationId, productId: p.productId, variantId: p.variantId ?? null, delta: p.delta });
  }
  const move = await tx.inventoryMovement.create({
    data: {
      storeId: p.storeId,
      productId: p.productId,
      variantId: p.variantId ?? null,
      locationId: p.locationId,
      delta: p.delta,
      reason: p.reason,
      note: p.note?.slice(0, 250) ?? null,
      orderId: p.orderId ?? null,
      actorId: p.actorId ?? null,
    },
    select: { id: true },
  });
  return move.id;
}

export type LevelRow = { locationId: string; itemKey: string; available: number };

/** Niveaux d'une liste d'articles, par dépôt (filtré par boutique). */
export async function levelsFor(storeId: string, itemKeys: readonly string[], client: Tx | typeof db = db): Promise<LevelRow[]> {
  if (!itemKeys.length) return [];
  return client.inventoryLevel.findMany({
    where: { storeId, itemKey: { in: [...itemKeys] } },
    select: { locationId: true, itemKey: true, available: true },
  });
}

/** Niveaux regroupés par dépôt (entrée d'`allocateLocations`). */
export function groupByLocation(rows: readonly LevelRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = out.get(r.locationId) ?? new Map<string, number>();
    m.set(r.itemKey, r.available);
    out.set(r.locationId, m);
  }
  return out;
}

export type LevelDiscrepancy = {
  productId: string;
  variantId: string | null;
  name: string;
  aggregate: number;
  levelsSum: number;
  /** Quantités sorties d'un dépôt et pas encore reçues (transferts IN_TRANSIT). */
  inTransit: number;
  diff: number;
};

/**
 * Forme exacte de l'invariant (fonction pure, testée) :
 *   `Product.stock` (ou `Variant.stock`) = Σ `InventoryLevel.available` + quantités en transit.
 * Une marchandise en transit a quitté le niveau du dépôt source sans avoir été créditée à la destination ;
 * elle appartient toujours au stock agrégé de la boutique. `diff = 0` ⇔ invariant respecté.
 */
export function invariantDiff(p: { aggregate: number; levelsSum: number; inTransit?: number }): number {
  return p.aggregate - (p.levelsSum + (p.inTransit ?? 0));
}

/**
 * Écarts d'invariant pour les articles SUIVIS d'une boutique. Requête unique (pas de N+1), filtrée
 * par `storeId` ; seules les lignes dont `diff ≠ 0` sont renvoyées.
 */
export async function findLevelDiscrepancies(storeId: string, limit = 500, client: Tx | typeof db = db): Promise<LevelDiscrepancy[]> {
  const transit = (key: Prisma.Sql) => Prisma.sql`
    COALESCE((SELECT SUM(ti."quantity" - ti."receivedQuantity") FROM "StockTransferItem" ti
              JOIN "StockTransfer" t ON t.id = ti."transferId"
              WHERE t."storeId" = ${storeId} AND t.status = 'IN_TRANSIT'
                AND COALESCE(ti."variantId", ti."productId") = ${key}), 0)`;
  const rows = await client.$queryRaw<{ productId: string; variantId: string | null; name: string; aggregate: number | bigint; levelsSum: number | bigint; inTransit: number | bigint }[]>(Prisma.sql`
    SELECT p.id AS "productId", NULL::text AS "variantId", p.name,
           p.stock AS "aggregate",
           COALESCE((SELECT SUM(l.available) FROM "InventoryLevel" l WHERE l."itemKey" = p.id AND l."storeId" = p."storeId"), 0) AS "levelsSum",
           ${transit(Prisma.sql`p.id`)} AS "inTransit"
    FROM "Product" p
    WHERE p."storeId" = ${storeId} AND p."trackStock" AND p.status <> 'ARCHIVED'
      AND NOT EXISTS (SELECT 1 FROM "Variant" v WHERE v."productId" = p.id)
    UNION ALL
    SELECT p.id, v.id, p.name || ' (' || v.name || ')',
           v.stock,
           COALESCE((SELECT SUM(l.available) FROM "InventoryLevel" l WHERE l."itemKey" = v.id AND l."storeId" = p."storeId"), 0),
           ${transit(Prisma.sql`v.id`)}
    FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
    WHERE p."storeId" = ${storeId} AND p."trackStock" AND p.status <> 'ARCHIVED'
    LIMIT ${Math.max(1, Math.min(limit, 5000))}`);
  return rows
    .map((r) => {
      const aggregate = Number(r.aggregate);
      const levelsSum = Number(r.levelsSum);
      const inTransit = Number(r.inTransit);
      return { productId: r.productId, variantId: r.variantId, name: r.name, aggregate, levelsSum, inTransit, diff: invariantDiff({ aggregate, levelsSum, inTransit }) };
    })
    .filter((r) => r.diff !== 0);
}
