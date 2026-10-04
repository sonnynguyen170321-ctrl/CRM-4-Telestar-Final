-- Per-sequence rules (lib/sequences/rules.ts). All default off, so every existing sequence keeps
-- exactly the behaviour it had: weekends skipped, no company-wide stop, several sequences allowed.
ALTER TABLE "Sequence" ADD COLUMN "sendOnWeekends" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sequence" ADD COLUMN "stopOnCompanyReply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sequence" ADD COLUMN "excludeLeadsInOtherSequences" BOOLEAN NOT NULL DEFAULT false;
