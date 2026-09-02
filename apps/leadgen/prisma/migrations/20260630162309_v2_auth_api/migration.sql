-- AlterTable
ALTER TABLE "V2AuthSession" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2ProviderUsageDaily" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2RuntimeChunk" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2RuntimeRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2RuntimeStage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2RuntimeWorkerHeartbeat" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "V2UserCredential" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "V2CompanyResearchStaging_org_company_version_key" RENAME TO "V2CompanyResearchStaging_organizationId_companyId_researchV_key";

-- RenameIndex
ALTER INDEX "V2CompanyResearchStaging_org_createdAt_idx" RENAME TO "V2CompanyResearchStaging_organizationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "V2ProviderUsageDaily_org_date_idx" RENAME TO "V2ProviderUsageDaily_organizationId_usageDate_idx";

-- RenameIndex
ALTER INDEX "V2ProviderUsageDaily_org_provider_date_key" RENAME TO "V2ProviderUsageDaily_organizationId_provider_usageDate_key";

-- RenameIndex
ALTER INDEX "V2RuntimeChunk_org_dedupe_key" RENAME TO "V2RuntimeChunk_organizationId_dedupeKey_key";

-- RenameIndex
ALTER INDEX "V2RuntimeChunk_org_run_status_idx" RENAME TO "V2RuntimeChunk_organizationId_runId_status_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeChunk_org_stage_status_idx" RENAME TO "V2RuntimeChunk_organizationId_stageId_status_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeChunk_run_index_key" RENAME TO "V2RuntimeChunk_runId_chunkIndex_key";

-- RenameIndex
ALTER INDEX "V2RuntimeRun_org_createdAt_idx" RENAME TO "V2RuntimeRun_organizationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeRun_org_project_status_idx" RENAME TO "V2RuntimeRun_organizationId_projectId_status_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeRun_org_type_status_idx" RENAME TO "V2RuntimeRun_organizationId_runType_status_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeStage_org_run_type_idx" RENAME TO "V2RuntimeStage_organizationId_runId_stageType_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeStage_org_status_idx" RENAME TO "V2RuntimeStage_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "V2RuntimeWorkerHeartbeat_queue_status_idx" RENAME TO "V2RuntimeWorkerHeartbeat_queueName_status_idx";
