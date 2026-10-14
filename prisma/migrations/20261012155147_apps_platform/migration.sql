-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AppPricingType" AS ENUM ('FREE', 'SUBSCRIPTION', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "AppInstallStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNINSTALLED');

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "iconUrl" TEXT,
    "category" TEXT NOT NULL,
    "developerName" TEXT NOT NULL,
    "developerUserId" TEXT,
    "firstParty" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppStatus" NOT NULL DEFAULT 'DRAFT',
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "requestedScopes" TEXT[],
    "appUrl" TEXT,
    "webhookUrl" TEXT,
    "supportUrl" TEXT,
    "pricingType" "AppPricingType" NOT NULL DEFAULT 'FREE',
    "priceAmount" INTEGER NOT NULL DEFAULT 0,
    "priceInterval" TEXT,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "oauthClientId" TEXT,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInstallation" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "AppInstallStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedScopes" TEXT[],
    "installedById" TEXT,
    "oauthGrantId" TEXT,
    "config" JSONB,
    "priceAmount" INTEGER NOT NULL DEFAULT 0,
    "billingStatus" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_slug_key" ON "App"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "App_oauthClientId_key" ON "App"("oauthClientId");

-- CreateIndex
CREATE INDEX "App_listed_category_idx" ON "App"("listed", "category");

-- CreateIndex
CREATE INDEX "App_developerUserId_idx" ON "App"("developerUserId");

-- CreateIndex
CREATE INDEX "App_status_idx" ON "App"("status");

-- CreateIndex
CREATE INDEX "AppInstallation_storeId_status_idx" ON "AppInstallation"("storeId", "status");

-- CreateIndex
CREATE INDEX "AppInstallation_appId_idx" ON "AppInstallation"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstallation_appId_storeId_key" ON "AppInstallation"("appId", "storeId");

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_developerUserId_fkey" FOREIGN KEY ("developerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
