-- Research candidate verification (owner, 2026-10-08: research listed news sites, job boards,
-- associations and vendors as prospect companies). Additive: new enums, nullable columns, one new
-- table. The old image runs on this schema unchanged.
--
-- The candidate -> classification foreign key sets only "classificationId" to null on delete
-- (PostgreSQL 15+ column list). Prisma's default SET NULL would null "tenantId" too, which is NOT NULL,
-- so deleting a cached classification would fail instead of detaching it.

-- CreateEnum
CREATE TYPE "ResearchVerification" AS ENUM ('pending', 'verified_fit', 'needs_review', 'rejected', 'unverified');

-- CreateEnum
CREATE TYPE "ResearchClassificationStatus" AS ENUM ('pending', 'completed', 'failed');

-- AlterTable
ALTER TABLE "ResearchCandidate" ADD COLUMN     "classificationId" TEXT,
ADD COLUMN     "verification" "ResearchVerification",
ADD COLUMN     "verificationJson" JSONB,
ADD COLUMN     "verificationReason" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifyClaimToken" TEXT,
ADD COLUMN     "verifyClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN     "verificationFinishedAt" TIMESTAMP(3),
ADD COLUMN     "verificationStartedAt" TIMESTAMP(3),
ADD COLUMN     "verificationWarning" TEXT;

-- CreateTable
CREATE TABLE "ResearchDomainClassification" (
    "id" TEXT NOT NULL,
    "canonicalDomain" TEXT NOT NULL,
    "classifierVersion" INTEGER NOT NULL,
    "status" "ResearchClassificationStatus" NOT NULL DEFAULT 'pending',
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "classificationJson" JSONB,
    "evidenceJson" JSONB,
    "sourcesJson" JSONB,
    "confidence" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchDomainClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchDomainClassification_tenantId_idx" ON "ResearchDomainClassification"("tenantId");

-- CreateIndex
CREATE INDEX "ResearchDomainClassification_tenantId_expiresAt_idx" ON "ResearchDomainClassification"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDomainClassification_id_tenantId_key" ON "ResearchDomainClassification"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDomainClassification_tenantId_canonicalDomain_class_key" ON "ResearchDomainClassification"("tenantId", "canonicalDomain", "classifierVersion");

-- CreateIndex
CREATE INDEX "ResearchCandidate_tenantId_runId_verification_idx" ON "ResearchCandidate"("tenantId", "runId", "verification");

-- CreateIndex (the foreign key's own index: deleting a cached classification sets this column to null)
CREATE INDEX "ResearchCandidate_tenantId_classificationId_idx" ON "ResearchCandidate"("tenantId", "classificationId");

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_classificationId_tenantId_fkey" FOREIGN KEY ("classificationId", "tenantId") REFERENCES "ResearchDomainClassification"("id", "tenantId") ON DELETE SET NULL ("classificationId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchDomainClassification" ADD CONSTRAINT "ResearchDomainClassification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

