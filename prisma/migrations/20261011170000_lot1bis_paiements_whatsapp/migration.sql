-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "payerPhone" TEXT;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "channels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SocialCatalogSync" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "settings" JSONB,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "externalCatalogId" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialCatalogSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialCatalogItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "retailerId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "lastError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialCatalogSync_enabled_nextSyncAt_idx" ON "SocialCatalogSync"("enabled", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialCatalogSync_storeId_channel_key" ON "SocialCatalogSync"("storeId", "channel");

-- CreateIndex
CREATE INDEX "SocialCatalogItem_storeId_status_idx" ON "SocialCatalogItem"("storeId", "status");

-- CreateIndex
CREATE INDEX "SocialCatalogItem_syncId_productId_idx" ON "SocialCatalogItem"("syncId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialCatalogItem_syncId_retailerId_key" ON "SocialCatalogItem"("syncId", "retailerId");

-- AddForeignKey
ALTER TABLE "SocialCatalogSync" ADD CONSTRAINT "SocialCatalogSync_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCatalogItem" ADD CONSTRAINT "SocialCatalogItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCatalogItem" ADD CONSTRAINT "SocialCatalogItem_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "SocialCatalogSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

