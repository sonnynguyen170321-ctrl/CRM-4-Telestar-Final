-- Move the proposal -> draft link onto the version, where it can be enforced.
--
-- "One proposal produces at most one draft" was previously only an ordering the service got right:
-- `PlaybookProposal.createdVersionId` is unique on the *version*, so setting it twice overwrites
-- and orphans the first draft instead of refusing the second. A unique key on the version side
-- refuses it in the database.
--
-- The statement order matters. The new column is added and backfilled *before* the old one is
-- dropped, so an existing deployment carries its links across rather than losing them.

-- AlterTable
ALTER TABLE "CampaignPlaybookVersion" ADD COLUMN     "fromProposalId" TEXT;

-- Backfill from the column being replaced, before it goes.
UPDATE "CampaignPlaybookVersion" AS v
SET "fromProposalId" = p."id"
FROM "PlaybookProposal" AS p
WHERE p."createdVersionId" = v."id";

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybookVersion_fromProposalId_key" ON "CampaignPlaybookVersion"("fromProposalId");

-- AddForeignKey
ALTER TABLE "CampaignPlaybookVersion" ADD CONSTRAINT "CampaignPlaybookVersion_fromProposalId_fkey" FOREIGN KEY ("fromProposalId") REFERENCES "PlaybookProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "PlaybookProposal" DROP CONSTRAINT "PlaybookProposal_createdVersionId_fkey";

-- DropIndex
DROP INDEX "PlaybookProposal_createdVersionId_key";

-- AlterTable
ALTER TABLE "PlaybookProposal" DROP COLUMN "createdVersionId";
