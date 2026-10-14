-- CreateEnum
CREATE TYPE "DomainRegistrationStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING', 'REGISTERED', 'FAILED', 'EXPIRED', 'TRANSFERRED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DomainChargeKind" AS ENUM ('REGISTER', 'RENEW');

-- CreateEnum
CREATE TYPE "DomainChargeStatus" AS ENUM ('OPEN', 'PAID', 'PROCESSING', 'APPLIED', 'FAILED', 'VOID');

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "registrationId" TEXT;

-- CreateTable
CREATE TABLE "DomainRegistration" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "storeName" TEXT,
    "domainName" TEXT NOT NULL,
    "registrar" TEXT NOT NULL DEFAULT 'route53',
    "status" "DomainRegistrationStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "operationId" TEXT,
    "years" INTEGER NOT NULL DEFAULT 1,
    "registeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "privacyProtection" BOOLEAN NOT NULL DEFAULT true,
    "wholesaleCostUsdCents" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "margin" INTEGER NOT NULL,
    "contact" JSONB NOT NULL,
    "hostedZoneId" TEXT,
    "dnsConfiguredAt" TIMESTAMP(3),
    "reminders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainCharge" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "storeId" TEXT,
    "kind" "DomainChargeKind" NOT NULL,
    "years" INTEGER NOT NULL DEFAULT 1,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "DomainChargeStatus" NOT NULL DEFAULT 'OPEN',
    "wholesaleCostUsdCents" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "margin" INTEGER NOT NULL,
    "fxRate" TEXT,
    "marginPercent" INTEGER NOT NULL,
    "expectedExpiry" TIMESTAMP(3),
    "operationId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainRegistration_storeId_status_idx" ON "DomainRegistration"("storeId", "status");

-- CreateIndex
CREATE INDEX "DomainRegistration_domainName_idx" ON "DomainRegistration"("domainName");

-- CreateIndex
CREATE INDEX "DomainRegistration_status_expiresAt_idx" ON "DomainRegistration"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainCharge_invoiceId_key" ON "DomainCharge"("invoiceId");

-- CreateIndex
CREATE INDEX "DomainCharge_registrationId_createdAt_idx" ON "DomainCharge"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "DomainCharge_storeId_status_idx" ON "DomainCharge"("storeId", "status");

-- CreateIndex
CREATE INDEX "DomainCharge_status_idx" ON "DomainCharge"("status");

-- CreateIndex
CREATE INDEX "Domain_registrationId_idx" ON "Domain"("registrationId");

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "DomainRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRegistration" ADD CONSTRAINT "DomainRegistration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainCharge" ADD CONSTRAINT "DomainCharge_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "DomainRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainCharge" ADD CONSTRAINT "DomainCharge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainCharge" ADD CONSTRAINT "DomainCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Archivage à la suppression d'une boutique : les achats de domaines sont conservés (trace comptable), le titulaire
-- est anonymisé et le nom de la boutique figé. S'exécute avant les SET NULL des clés étrangères.
CREATE OR REPLACE FUNCTION domain_registration_archive() RETURNS trigger AS $$
BEGIN
  UPDATE "DomainRegistration"
     SET "contact" = jsonb_build_object('anonymized', true), "storeName" = OLD."name"
   WHERE "storeId" = OLD."id";
  UPDATE "DomainCharge" c
     SET "invoiceNumber" = COALESCE(i."number", c."invoiceNumber")
    FROM "Invoice" i
   WHERE c."storeId" = OLD."id" AND i."id" = c."invoiceId";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER domain_registration_archive
BEFORE DELETE ON "Store"
FOR EACH ROW EXECUTE FUNCTION domain_registration_archive();
