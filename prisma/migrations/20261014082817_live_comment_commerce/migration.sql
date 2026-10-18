-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "LiveClaimStatus" AS ENUM ('RESERVED', 'MESSAGED', 'PAID', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "LiveEvent" ADD COLUMN     "claimHoldMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "claimMaxPerAuthor" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "claimMessage" TEXT,
ADD COLUMN     "claimPublicReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "claimPublicText" TEXT,
ADD COLUMN     "claimsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "socialObjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "tokenEncrypted" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveKeyword" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "liveEventId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveClaim" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "liveEventId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "commentId" TEXT NOT NULL,
    "objectId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT,
    "commentText" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "heldQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "LiveClaimStatus" NOT NULL DEFAULT 'RESERVED',
    "token" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "replyLockedAt" TIMESTAMP(3),
    "messageId" TEXT,
    "recipientId" TEXT,
    "messagedAt" TIMESTAMP(3),
    "publicRepliedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_storeId_idx" ON "SocialAccount"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");

-- CreateIndex
CREATE INDEX "LiveKeyword_storeId_idx" ON "LiveKeyword"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveKeyword_liveEventId_code_key" ON "LiveKeyword"("liveEventId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClaim_token_key" ON "LiveClaim"("token");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClaim_cartId_key" ON "LiveClaim"("cartId");

-- CreateIndex
CREATE INDEX "LiveClaim_storeId_liveEventId_createdAt_idx" ON "LiveClaim"("storeId", "liveEventId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveClaim_liveEventId_platform_authorId_idx" ON "LiveClaim"("liveEventId", "platform", "authorId");

-- CreateIndex
CREATE INDEX "LiveClaim_status_expiresAt_idx" ON "LiveClaim"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClaim_platform_commentId_key" ON "LiveClaim"("platform", "commentId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveKeyword" ADD CONSTRAINT "LiveKeyword_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveKeyword" ADD CONSTRAINT "LiveKeyword_liveEventId_fkey" FOREIGN KEY ("liveEventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveKeyword" ADD CONSTRAINT "LiveKeyword_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveKeyword" ADD CONSTRAINT "LiveKeyword_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClaim" ADD CONSTRAINT "LiveClaim_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClaim" ADD CONSTRAINT "LiveClaim_liveEventId_fkey" FOREIGN KEY ("liveEventId") REFERENCES "LiveEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClaim" ADD CONSTRAINT "LiveClaim_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClaim" ADD CONSTRAINT "LiveClaim_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClaim" ADD CONSTRAINT "LiveClaim_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
