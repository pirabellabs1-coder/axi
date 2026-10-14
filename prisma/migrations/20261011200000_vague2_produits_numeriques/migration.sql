-- Vague 2 — produits numériques et services (migration ADDITIVE : aucune colonne ni table supprimée,
-- aucune valeur existante modifiée ; `kind` vaut PHYSICAL pour tout le catalogue existant).
-- Retour arrière : voir docs/vague2/N-produits-numeriques.md § « Migration et retour arrière ».

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'DIGITAL', 'SERVICE', 'GIFT_CARD');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'PHYSICAL',
ADD COLUMN     "downloadLimit" INTEGER,
ADD COLUMN     "downloadValidityDays" INTEGER,
ADD COLUMN     "serviceDurationMinutes" INTEGER,
ADD COLUMN     "serviceLocation" TEXT,
ADD COLUMN     "serviceRemote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceBookingNote" TEXT,
ADD COLUMN     "postPurchaseInstructions" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'PHYSICAL';

-- Cohérence avec le drapeau historique : les produits carte cadeau existants prennent kind = GIFT_CARD
-- (isGiftCard reste la source d'autorité du lot 1 ; les deux sont tenus synchronisés par l'application).
UPDATE "Product" SET "kind" = 'GIFT_CARD' WHERE "isGiftCard" = true;
UPDATE "OrderItem" SET "kind" = 'GIFT_CARD' WHERE "isGiftCard" = true;

-- CreateTable
CREATE TABLE "DigitalAsset" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadGrant" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "customerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "downloadLimit" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "lastDownloadAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigitalAsset_storeId_productId_idx" ON "DigitalAsset"("storeId", "productId");

-- CreateIndex
CREATE INDEX "DigitalAsset_productId_variantId_idx" ON "DigitalAsset"("productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadGrant_tokenHash_key" ON "DownloadGrant"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadGrant_orderItemId_key" ON "DownloadGrant"("orderItemId");

-- CreateIndex
CREATE INDEX "DownloadGrant_storeId_orderId_idx" ON "DownloadGrant"("storeId", "orderId");

-- CreateIndex
CREATE INDEX "DownloadGrant_customerId_createdAt_idx" ON "DownloadGrant"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "DigitalAsset" ADD CONSTRAINT "DigitalAsset_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAsset" ADD CONSTRAINT "DigitalAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAsset" ADD CONSTRAINT "DigitalAsset_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
