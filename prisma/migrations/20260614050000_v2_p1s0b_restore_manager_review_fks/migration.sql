-- RestoreManualForeignKeys
-- The P1.S0B Prisma-generated migration dropped the manual MR1 foreign keys
-- because the Prisma model intentionally keeps scalar ids only. Re-add them
-- idempotently so existing local databases and fresh replays converge.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_organizationId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_leadAssignmentId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_leadAssignmentId_fkey" FOREIGN KEY ("leadAssignmentId") REFERENCES "V2LeadAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_hardRuleAssessmentId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_hardRuleAssessmentId_fkey" FOREIGN KEY ("hardRuleAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_projectId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_companyId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "V2Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_contactId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "V2Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_icpVersionId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_assignedToUserId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'V2ManagerReviewItem_resolvedByUserId_fkey'
  ) THEN
    ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
