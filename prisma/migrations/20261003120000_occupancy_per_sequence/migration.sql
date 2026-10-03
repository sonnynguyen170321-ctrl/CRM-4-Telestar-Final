-- A lead may now run several sequences at once (owner decision, 2026-10-02). The occupancy key
-- moves from "<tenantId>:<leadId>" to "<tenantId>:<leadId>:<sequenceId>": still unique, so the
-- same sequence can never run twice on one lead, but different sequences no longer collide.
--
-- The CHECK constraint from 20260812020000 pins the key's exact shape, so it is replaced in the
-- same migration rather than dropped: an occupying row (active / paused) must carry exactly the new
-- key, a terminal row none. Before this migration at most one occupying row existed per lead, so
-- the re-keyed values cannot collide.

ALTER TABLE "SequenceEnrollment" DROP CONSTRAINT "SequenceEnrollment_occupancy_status_check";

UPDATE "SequenceEnrollment"
SET "occupancyKey" = "tenantId" || ':' || "leadId" || ':' || "sequenceId"
WHERE "occupancyKey" IS NOT NULL;

ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_occupancy_status_check" CHECK (
    CASE
      WHEN "status" IN ('active', 'paused')
        THEN "occupancyKey" IS NOT NULL
             AND "occupancyKey" = "tenantId" || ':' || "leadId" || ':' || "sequenceId"
      ELSE "occupancyKey" IS NULL
    END
  );
