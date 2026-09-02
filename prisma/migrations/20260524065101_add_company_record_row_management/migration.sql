-- AlterTable
ALTER TABLE "CompanyRecord" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CompanyRecord_archivedAt_idx" ON "CompanyRecord"("archivedAt");

-- CreateIndex
CREATE INDEX "CompanyRecord_deletedAt_idx" ON "CompanyRecord"("deletedAt");
