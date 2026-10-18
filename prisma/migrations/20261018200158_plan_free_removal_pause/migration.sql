-- AlterEnum
ALTER TYPE "StoreStatus" ADD VALUE 'PAUSED';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "statusBeforePause" "StoreStatus";

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "coveredBySubscriptionId" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Subscription_coveredBySubscriptionId_idx" ON "Subscription"("coveredBySubscriptionId");
