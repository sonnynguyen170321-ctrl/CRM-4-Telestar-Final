-- PlaybookProposalEvidence joins two tenant-owned tables and carried no tenant of its own.
--
-- `supabase/rls.sql` builds its policies by looping over tables that have a `tenantId`
-- column, so this table received no ENABLE and no policy, while
-- `GRANT ... ON ALL TABLES IN SCHEMA public` still gave the application role full DML on it.
-- It was readable and writable by every tenant. `tests/rls-policy-coverage.test.ts` selects on
-- the same column, so the one table that needed a policy was invisible to the test that proves
-- coverage.
--
-- Adding the column is what enrols it: rls.sql will generate its policies on the next apply,
-- with no change to rls.sql itself.

-- DropForeignKey
ALTER TABLE "PlaybookProposalEvidence" DROP CONSTRAINT "PlaybookProposalEvidence_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "PlaybookProposalEvidence" DROP CONSTRAINT "PlaybookProposalEvidence_signalId_fkey";

-- AlterTable: nullable first, because a NOT NULL column cannot be added to a populated table.
ALTER TABLE "PlaybookProposalEvidence" ADD COLUMN     "tenantId" TEXT;

-- Backfill from the proposal. The row belongs to whichever tenant owns the proposal it is
-- evidence for; the pre-existing foreign key guarantees that proposal exists.
UPDATE "PlaybookProposalEvidence" e
   SET "tenantId" = p."tenantId"
  FROM "PlaybookProposal" p
 WHERE p."id" = e."proposalId";

-- A row whose proposal and signal belong to different tenants is precisely the cross-tenant
-- relationship this migration exists to make impossible, and there is no correct tenant to
-- assign it to. Refuse rather than silently pick the proposal's side and destroy the evidence
-- that it happened.
DO $$
DECLARE offending bigint;
BEGIN
  SELECT count(*) INTO offending
    FROM "PlaybookProposalEvidence" e
    JOIN "PlaybookProposal" p ON p."id" = e."proposalId"
    JOIN "OutcomeSignal"    s ON s."id" = e."signalId"
   WHERE p."tenantId" <> s."tenantId";

  IF offending > 0 THEN
    RAISE EXCEPTION
      'PlaybookProposalEvidence holds % row(s) whose proposal and signal belong to different tenants. Resolve them before applying this migration; see scripts/audit-cross-tenant-rows.mjs.',
      offending;
  END IF;
END $$;

ALTER TABLE "PlaybookProposalEvidence" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeSignal_id_tenantId_key" ON "OutcomeSignal"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PlaybookProposalEvidence_tenantId_idx" ON "PlaybookProposalEvidence"("tenantId");

-- AddForeignKey
ALTER TABLE "PlaybookProposalEvidence" ADD CONSTRAINT "PlaybookProposalEvidence_proposalId_tenantId_fkey" FOREIGN KEY ("proposalId", "tenantId") REFERENCES "PlaybookProposal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposalEvidence" ADD CONSTRAINT "PlaybookProposalEvidence_signalId_tenantId_fkey" FOREIGN KEY ("signalId", "tenantId") REFERENCES "OutcomeSignal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposalEvidence" ADD CONSTRAINT "PlaybookProposalEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
