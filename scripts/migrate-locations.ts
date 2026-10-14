/**
 * Migration de données du lot 3 : dépôts et stock par dépôt.
 *
 *   pnpm exec tsx scripts/migrate-locations.ts --dry-run          # inventaire, aucune écriture
 *   pnpm exec tsx scripts/migrate-locations.ts                    # toutes les boutiques
 *   pnpm exec tsx scripts/migrate-locations.ts --store <storeId>  # une seule boutique
 *
 * Pour chaque boutique :
 *  1. un « Dépôt principal » (`Location`, `isDefault`) est créé s'il n'en existe aucun ;
 *  2. chaque produit simple suivi et chaque variante suivie reçoit un `InventoryLevel` au dépôt par
 *     défaut, égal à son stock agrégé courant.
 *
 * IDEMPOTENT : un article qui possède déjà au moins un niveau (dans n'importe quel dépôt) est laissé
 * tel quel — une seconde exécution ne double jamais le stock, et une répartition manuelle déjà faite
 * n'est pas écrasée. Invariant visé : `Product.stock` (ou `Variant.stock`) = Σ niveaux + en transit.
 */

import { PrismaClient } from "@prisma/client";

// Variables d'environnement du projet (DATABASE_URL) comme pour les autres scripts.
type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // pas de .env : on s'appuie sur l'environnement du shell
  }
}

const db = new PrismaClient();

const DEFAULT_LOCATION_NAME = "Dépôt principal";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyStore = arg("store");
  const stores = await db.store.findMany({
    where: onlyStore ? { id: onlyStore } : {},
    select: { id: true, name: true, country: true, city: true },
    orderBy: { createdAt: "asc" },
  });
  if (!stores.length) {
    console.log("Aucune boutique à traiter.");
    return;
  }

  let createdLocations = 0;
  let createdLevels = 0;
  for (const store of stores) {
    let location = await db.location.findFirst({
      where: { storeId: store.id },
      orderBy: [{ isDefault: "desc" }, { position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isDefault: true },
    });
    if (!location) {
      if (dryRun) {
        console.log(`[${store.name}] dépôt principal à créer`);
      } else {
        location = await db.location.create({
          data: { storeId: store.id, name: DEFAULT_LOCATION_NAME, type: "WAREHOUSE", country: store.country, city: store.city, isDefault: true, pickupEnabled: true },
          select: { id: true, name: true, isDefault: true },
        });
        createdLocations += 1;
      }
    }
    if (!location) continue; // --dry-run sans dépôt : rien à répartir

    // Produits simples suivis (sans variante) et variantes suivies.
    const products = await db.product.findMany({
      where: { storeId: store.id, trackStock: true, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, stock: true, variants: { select: { id: true, name: true, stock: true } } },
    });
    const targets: { productId: string; variantId: string | null; itemKey: string; stock: number; label: string }[] = [];
    for (const p of products) {
      if (!p.variants.length) {
        targets.push({ productId: p.id, variantId: null, itemKey: p.id, stock: p.stock, label: p.name });
        continue;
      }
      for (const v of p.variants) targets.push({ productId: p.id, variantId: v.id, itemKey: v.id, stock: v.stock, label: `${p.name} (${v.name})` });
    }
    if (!targets.length) continue;

    const existing = await db.inventoryLevel.findMany({
      where: { storeId: store.id, itemKey: { in: targets.map((t) => t.itemKey) } },
      select: { itemKey: true },
    });
    const known = new Set(existing.map((e) => e.itemKey));
    const todo = targets.filter((t) => !known.has(t.itemKey));
    if (!todo.length) {
      console.log(`[${store.name}] déjà réparti (${targets.length} articles)`);
      continue;
    }
    if (dryRun) {
      console.log(`[${store.name}] ${todo.length} niveau(x) à créer au dépôt « ${location.name} »`);
      continue;
    }
    // createMany + skipDuplicates : sûr si deux exécutions se croisent (clé unique (locationId, itemKey)).
    const result = await db.inventoryLevel.createMany({
      data: todo.map((t) => ({
        storeId: store.id,
        locationId: location!.id,
        productId: t.productId,
        variantId: t.variantId,
        itemKey: t.itemKey,
        available: t.stock,
      })),
      skipDuplicates: true,
    });
    createdLevels += result.count;
    console.log(`[${store.name}] ${result.count} niveau(x) créé(s) au dépôt « ${location.name} »`);
  }

  console.log(dryRun ? "— simulation terminée —" : `Terminé : ${createdLocations} dépôt(s) et ${createdLevels} niveau(x) créés.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
