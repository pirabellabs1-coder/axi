-- CreateEnum
CREATE TYPE "CollaboratorStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "StoreCollaborator" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "status" "CollaboratorStatus" NOT NULL DEFAULT 'PENDING',
    "permissions" TEXT[],
    "message" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreCollaborator_tokenHash_key" ON "StoreCollaborator"("tokenHash");

-- CreateIndex
CREATE INDEX "StoreCollaborator_userId_status_idx" ON "StoreCollaborator"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCollaborator_storeId_email_key" ON "StoreCollaborator"("storeId", "email");

-- AddForeignKey
ALTER TABLE "StoreCollaborator" ADD CONSTRAINT "StoreCollaborator_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCollaborator" ADD CONSTRAINT "StoreCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCollaborator" ADD CONSTRAINT "StoreCollaborator_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
