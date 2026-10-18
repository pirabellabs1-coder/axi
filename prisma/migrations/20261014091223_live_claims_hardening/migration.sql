-- AlterTable
ALTER TABLE "LiveEvent" ADD COLUMN     "claimActiveCapPercent" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "claimActiveCapUnits" INTEGER,
ALTER COLUMN "claimMaxPerAuthor" SET DEFAULT 2;
