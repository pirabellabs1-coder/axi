-- CreateEnum
CREATE TYPE "MetafieldOwner" AS ENUM ('PRODUCT', 'VARIANT', 'COLLECTION', 'CUSTOMER', 'ORDER', 'STORE', 'PAGE', 'BLOG_POST');

-- CreateEnum
CREATE TYPE "ThemeScheduleStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LiveEventStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ConsentChannel" ADD VALUE 'PUSH';

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "templateSuffix" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "templateSuffix" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "templateSuffix" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "brandKit" JSONB,
ADD COLUMN     "pwaConfig" JSONB;

-- AlterTable
ALTER TABLE "StorePage" ADD COLUMN     "templateSuffix" TEXT;

-- CreateTable
CREATE TABLE "MetafieldDefinition" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ownerType" "MetafieldOwner" NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "validations" JSONB,
    "storefrontVisible" BOOLEAN NOT NULL DEFAULT true,
    "pinnedPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetafieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetafieldValue" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "ownerType" "MetafieldOwner" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetafieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSection" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "previewUrl" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionLibraryItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "previewUrl" TEXT,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "minPlan" "PlanId" NOT NULL DEFAULT 'FREE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeSchedule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occasion" TEXT,
    "document" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ThemeScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeGeneration" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "candidates" JSONB,
    "chosenIndex" INTEGER,
    "model" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL,
    "winnerKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentStat" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExperimentStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" TEXT,
    "userAgent" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "streamUrl" TEXT NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pinnedId" TEXT,
    "status" "LiveEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetafieldDefinition_storeId_ownerType_namespace_key_key" ON "MetafieldDefinition"("storeId", "ownerType", "namespace", "key");

-- CreateIndex
CREATE INDEX "MetafieldValue_storeId_ownerType_ownerId_idx" ON "MetafieldValue"("storeId", "ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MetafieldValue_definitionId_ownerId_key" ON "MetafieldValue"("definitionId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSection_storeId_name_key" ON "SavedSection"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SectionLibraryItem_slug_key" ON "SectionLibraryItem"("slug");

-- CreateIndex
CREATE INDEX "SectionLibraryItem_published_category_idx" ON "SectionLibraryItem"("published", "category");

-- CreateIndex
CREATE INDEX "ThemeSchedule_storeId_startsAt_endsAt_idx" ON "ThemeSchedule"("storeId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ThemeGeneration_storeId_createdAt_idx" ON "ThemeGeneration"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "ThemeGeneration_expiresAt_idx" ON "ThemeGeneration"("expiresAt");

-- CreateIndex
CREATE INDEX "Experiment_storeId_status_idx" ON "Experiment"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentStat_experimentId_variantKey_day_metric_key" ON "ExperimentStat"("experimentId", "variantKey", "day", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_storeId_revokedAt_idx" ON "PushSubscription"("storeId", "revokedAt");

-- CreateIndex
CREATE INDEX "LiveEvent_storeId_startsAt_idx" ON "LiveEvent"("storeId", "startsAt");

-- AddForeignKey
ALTER TABLE "MetafieldDefinition" ADD CONSTRAINT "MetafieldDefinition_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetafieldValue" ADD CONSTRAINT "MetafieldValue_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetafieldValue" ADD CONSTRAINT "MetafieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "MetafieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSection" ADD CONSTRAINT "SavedSection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeSchedule" ADD CONSTRAINT "ThemeSchedule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeGeneration" ADD CONSTRAINT "ThemeGeneration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentStat" ADD CONSTRAINT "ExperimentStat_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveEvent" ADD CONSTRAINT "LiveEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

