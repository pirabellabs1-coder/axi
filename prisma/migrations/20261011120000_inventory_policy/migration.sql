-- Inventaire façon Shopify : « continuer à vendre en cas de rupture », seuil de stock bas par produit,
-- code-barres d'un produit sans variante. Migration additive (colonnes nullables ou avec défaut) :
-- aucune réécriture des lignes existantes, compatible avec le code précédent (rollback = DROP des colonnes/du type).

-- CreateEnum
CREATE TYPE "InventoryPolicy" AS ENUM ('DENY', 'CONTINUE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "inventoryPolicy" "InventoryPolicy" NOT NULL DEFAULT 'DENY',
ADD COLUMN     "lowStockThreshold" INTEGER;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "inventoryPolicy" "InventoryPolicy" NOT NULL DEFAULT 'DENY';

-- Seuil borné (invariant aussi validé par Zod côté serveur).
ALTER TABLE "Product" ADD CONSTRAINT "Product_lowStockThreshold_check" CHECK ("lowStockThreshold" IS NULL OR ("lowStockThreshold" >= 0 AND "lowStockThreshold" <= 100000));
