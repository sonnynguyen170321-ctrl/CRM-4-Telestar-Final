-- CreateEnum
CREATE TYPE "V2MessageTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "V2MessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT,
    "requiredVariablesJson" JSONB,
    "category" TEXT,
    "status" "V2MessageTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2MessageTemplate_org_status_deleted_idx" ON "V2MessageTemplate"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "V2MessageTemplate_org_category_idx" ON "V2MessageTemplate"("organizationId", "category");

-- CreateIndex
CREATE INDEX "V2MessageTemplate_org_updated_idx" ON "V2MessageTemplate"("organizationId", "updatedAt");