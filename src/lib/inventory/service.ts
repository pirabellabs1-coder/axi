import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorePrefs } from "@/lib/notifications/prefs";

/**
 * Inventaire côté serveur : seuil de la boutique et listes « stock bas » (seuil du produit sinon de la boutique).
 * Alertes de franchissement : ./alerts.ts. Toutes les requêtes sont filtrées par `storeId`.
 */

/** Seuil « stock bas » par défaut de la boutique (réglages de notifications, défaut 5). */
export async function storeLowStockThreshold(storeId: string): Promise<number> {
  return (await getStorePrefs(storeId)).lowStockThreshold;
}

export type LowStockRow = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  stock: number;
  policy: "DENY" | "CONTINUE";
  threshold: number;
  /** Seuil propre au produit (null = seuil de la boutique). */
  productThreshold: number | null;
  images: unknown;
  imageUrl: string | null;
};

type Scope = "active" | "catalog";

function statusSql(scope: Scope) {
  return scope === "active" ? Prisma.sql`p.status = 'ACTIVE'` : Prisma.sql`p.status <> 'ARCHIVED'`;
}

/**
 * Articles suivis dont le stock est au plus leur seuil effectif (produit, sinon boutique), ruptures et surventes
 * comprises, du stock le plus bas au plus haut. Les variantes désactivées (hors vente) sont exclues. Produit simple : une ligne ; produit à variantes : une ligne par variante.
 */
export async function lowStockItems(storeId: string, opts: { storeThreshold: number; scope?: Scope; limit?: number; productIds?: string[]; ignoreProductThreshold?: boolean }): Promise<LowStockRow[]> {
  const t = opts.storeThreshold;
  // Seuil effectif : celui du produit, sinon celui de la boutique ; ou un seuil imposé pour tous (ignoreProductThreshold).
  const eff = opts.ignoreProductThreshold ? Prisma.sql`${t}::int` : Prisma.sql`COALESCE(p."lowStockThreshold", ${t})`;
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 5000));
  const status = statusSql(opts.scope ?? "active");
  const only = opts.productIds ? (opts.productIds.length ? Prisma.sql`AND p.id IN (${Prisma.join(opts.productIds)})` : Prisma.sql`AND FALSE`) : Prisma.empty;
  const rows = await db.$queryRaw<(Omit<LowStockRow, "stock" | "threshold"> & { stock: number | bigint; threshold: number | bigint })[]>`
    SELECT * FROM (
      SELECT p.id AS "productId", NULL::text AS "variantId", p.name, NULL::text AS "variantName", p.sku, p.stock,
             p."inventoryPolicy"::text AS policy, ${eff} AS threshold, p."lowStockThreshold" AS "productThreshold",
             p.images, NULL::text AS "imageUrl"
      FROM "Product" p
      WHERE p."storeId" = ${storeId} AND p."trackStock" AND ${status} ${only}
        AND NOT EXISTS (SELECT 1 FROM "Variant" x WHERE x."productId" = p.id)
        AND p.stock <= ${eff}
      UNION ALL
      SELECT p.id, v.id, p.name, v.name, v.sku, v.stock,
             v."inventoryPolicy"::text, ${eff}, p."lowStockThreshold",
             p.images, v."imageUrl"
      FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p."storeId" = ${storeId} AND p."trackStock" AND ${status} ${only}
        AND v.available AND v.stock <= ${eff}
    ) items
    ORDER BY stock ASC, name ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, stock: Number(r.stock), threshold: Number(r.threshold), policy: r.policy === "CONTINUE" ? "CONTINUE" : "DENY" }));
}

/** Nombre d'articles en stock bas (même définition que `lowStockItems`). */
export async function countLowStock(storeId: string, storeThreshold: number, scope: Scope = "active"): Promise<number> {
  const status = statusSql(scope);
  const [r] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM "Product" p
        WHERE p."storeId" = ${storeId} AND p."trackStock" AND ${status}
          AND NOT EXISTS (SELECT 1 FROM "Variant" x WHERE x."productId" = p.id)
          AND p.stock <= COALESCE(p."lowStockThreshold", ${storeThreshold}))
      +
      (SELECT COUNT(*) FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
        WHERE p."storeId" = ${storeId} AND p."trackStock" AND ${status}
          AND v.available AND v.stock <= COALESCE(p."lowStockThreshold", ${storeThreshold})) AS n`;
  return Number(r?.n ?? 0);
}

/** Ids des produits ayant au moins un article en stock bas (filtre « Stock bas » de la liste produits). */
export async function lowStockProductIds(storeId: string, storeThreshold: number, scope: Scope = "catalog"): Promise<string[]> {
  const rows = await lowStockItems(storeId, { storeThreshold, scope, limit: 5000 });
  return [...new Set(rows.map((r) => r.productId))];
}
