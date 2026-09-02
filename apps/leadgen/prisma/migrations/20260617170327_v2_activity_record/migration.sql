-- T2: V2ActivityRecord (contract docs/v2/plan/V2_ACTIVITY_AND_TIMELINE_CONTRACT.md §2).
-- Durable, insert-only, tenant-scoped activity event attached to a LeadAssignment.
-- Soft references (plain columns + indexes) per the V2ManagerReviewItem pattern;
-- idempotent by sourceActivityHash; soft-deleted. Additive only.

-- CreateTable
CREATE TABLE "V2ActivityRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "actorUserId" TEXT,
    "channel" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timestampQuality" TEXT NOT NULL,
    "sourceActivityHash" TEXT NOT NULL,
    "sourceUploadId" TEXT,
    "sourceRowNumber" INTEGER,
    "note" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2ActivityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2ActivityRecord_organizationId_leadAssignmentId_occurredAt_idx" ON "V2ActivityRecord"("organizationId", "leadAssignmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "V2ActivityRecord_organizationId_companyId_occurredAt_idx" ON "V2ActivityRecord"("organizationId", "companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "V2ActivityRecord_organizationId_occurredAt_idx" ON "V2ActivityRecord"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "V2ActivityRecord_deletedAt_idx" ON "V2ActivityRecord"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2ActivityRecord_organizationId_sourceActivityHash_key" ON "V2ActivityRecord"("organizationId", "sourceActivityHash");
