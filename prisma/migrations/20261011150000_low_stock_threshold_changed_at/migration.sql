-- Horodatage du dernier changement du seuil « stock bas » d'un produit (colonne nullable, additive).
-- Les alertes ne retiennent que les franchissements postérieurs (pas d'alerte rétroactive quand on relève un seuil).
-- Rollback : ALTER TABLE "Product" DROP COLUMN "lowStockThresholdChangedAt";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "lowStockThresholdChangedAt" TIMESTAMP(3);
