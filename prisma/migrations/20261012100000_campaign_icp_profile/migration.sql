-- Every campaign scores against its own ICP (owner decision 2026-10-10: no silent fallback to the
-- company default). Additive: one enum, nullable columns, indexes, composite foreign keys, and a
-- backfill. The old image runs on this schema unchanged: it still reads and writes
-- "Campaign"."icpVersionId", which stays as history.
--
-- Both foreign keys set only their own column to null on delete (PostgreSQL 15+ column list).
-- Prisma's default SET NULL would null "tenantId" too, which is NOT NULL, so deleting a user or a
-- profile would fail instead of detaching it. Precedent: 20261008120000_research_verification.

-- Review workflow (owner correction 2026-10-11): a rep's Publish only submits a version for review
-- (status pending_review); a team lead or manager approves or rejects. The resolver reads published
-- versions only, so pending_review never scores. The routes and UI come in the next PR.
-- AlterEnum
ALTER TYPE "IcpVersionStatus" ADD VALUE 'pending_review' BEFORE 'published';

-- CreateEnum
CREATE TYPE "IcpProfileKind" AS ENUM ('library', 'custom');

-- AlterTable
ALTER TABLE "IcpProfile" ADD COLUMN     "kind" "IcpProfileKind" NOT NULL DEFAULT 'library',
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "IcpVersion" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "icpProfileId" TEXT;

-- CreateIndex
CREATE INDEX "IcpProfile_tenantId_ownerUserId_idx" ON "IcpProfile"("tenantId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_icpProfileId_idx" ON "Campaign"("tenantId", "icpProfileId");

-- AddForeignKey
ALTER TABLE "IcpProfile" ADD CONSTRAINT "IcpProfile_ownerUserId_tenantId_fkey" FOREIGN KEY ("ownerUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("ownerUserId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVersion" ADD CONSTRAINT "IcpVersion_submittedById_tenantId_fkey" FOREIGN KEY ("submittedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("submittedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVersion" ADD CONSTRAINT "IcpVersion_reviewedById_tenantId_fkey" FOREIGN KEY ("reviewedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("reviewedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_icpProfileId_tenantId_fkey" FOREIGN KEY ("icpProfileId", "tenantId") REFERENCES "IcpProfile"("id", "tenantId") ON DELETE SET NULL ("icpProfileId") ON UPDATE CASCADE;

-- Backfill: a campaign pinned to a version follows that version's profile from now on.
-- Campaigns with no pinned version stay NULL: they have no ICP and are not scored.
UPDATE "Campaign" AS c
SET "icpProfileId" = v."icpProfileId"
FROM "IcpVersion" AS v
WHERE c."icpVersionId" IS NOT NULL
  AND v."id" = c."icpVersionId"
  AND v."tenantId" = c."tenantId"
  AND c."icpProfileId" IS NULL;
