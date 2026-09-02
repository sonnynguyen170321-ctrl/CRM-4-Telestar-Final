-- CreateEnum
CREATE TYPE "V2AccountPreRank" AS ENUM ('STRONG_ACCOUNT_FIT', 'POSSIBLE_ACCOUNT_FIT', 'WEAK_FIT', 'CLEAR_MISMATCH');

-- AlterEnum
ALTER TYPE "V2Qualification" ADD VALUE 'COMPANY_QUALIFIED_NEEDS_CONTACT';

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_assignedToUserId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_companyId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_contactId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_hardRuleAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_icpVersionId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_leadAssignmentId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_projectId_fkey";

-- DropForeignKey
ALTER TABLE "V2ManagerReviewItem" DROP CONSTRAINT "V2ManagerReviewItem_resolvedByUserId_fkey";

-- AlterTable
ALTER TABLE "V2HardRuleAssessment" ADD COLUMN     "accountPreRank" "V2AccountPreRank";

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_accountPreRank_idx" ON "V2HardRuleAssessment"("accountPreRank");
