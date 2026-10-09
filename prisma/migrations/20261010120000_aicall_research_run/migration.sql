-- Attribute AI spend to the research run that caused it (2026-10-10). Additive: one nullable column,
-- one index, one foreign key. The old image runs on this schema unchanged.
--
-- The foreign key sets only "researchRunId" to null on delete (PostgreSQL 15+ column list), the same
-- as ResearchCandidate.classificationId. Prisma's default SET NULL would null "tenantId" too, which is
-- NOT NULL, so deleting a run would fail instead of detaching its AiCall accounting rows.

-- AlterTable
ALTER TABLE "AiCall" ADD COLUMN     "researchRunId" TEXT;

-- CreateIndex
CREATE INDEX "AiCall_tenantId_researchRunId_idx" ON "AiCall"("tenantId", "researchRunId");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_researchRunId_tenantId_fkey" FOREIGN KEY ("researchRunId", "tenantId") REFERENCES "ResearchRun"("id", "tenantId") ON DELETE SET NULL ("researchRunId") ON UPDATE CASCADE;
