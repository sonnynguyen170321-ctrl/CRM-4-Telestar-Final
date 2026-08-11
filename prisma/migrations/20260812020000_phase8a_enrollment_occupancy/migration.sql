-- Phase 8a — one occupying enrollment per lead, enforced by the database.
--
-- `occupancyKey` is "<tenantId>:<leadId>" while an enrollment is active or paused, and NULL once
-- it reaches a terminal status. Two constraints together make the invariant a database fact:
--
--   * a plain UNIQUE index — one non-NULL key per lead. PostgreSQL allows any number of NULLs,
--     so terminal rows never collide, and no partial index is needed (a partial index would drift
--     from what the Prisma datamodel describes).
--   * a CHECK tying the status to the exact key — without it, `status = 'active'` with a NULL key
--     slips past the unique index entirely, which is precisely what the enrollment status route
--     used to do when it reactivated a terminal row.

-- ---------------------------------------------------------------------------
-- Preflight FIRST — before any schema change.
-- ---------------------------------------------------------------------------
-- If a lead already has two live cadences, this migration must not choose which one survives.
-- Picking a winner here would silently end an SDR's in-flight sequence with no record of who did
-- it. Fail before touching the table, so a refused migration leaves the schema untouched rather
-- than relying on transactional rollback to undo a half-applied change.
DO $$
DECLARE
  conflicts INT;
  sample TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(MIN("tenantId" || ':' || "leadId"), '')
    INTO conflicts, sample
  FROM (
    SELECT "tenantId", "leadId"
    FROM "SequenceEnrollment"
    WHERE "status" IN ('active', 'paused')
    GROUP BY "tenantId", "leadId"
    HAVING COUNT(*) > 1
  ) duplicated;

  IF conflicts > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce enrollment occupancy: % lead(s) already have more than one active/paused enrollment (for example %). Resolve these manually — decide which cadence is real and unenroll the others — then re-run this migration.',
      conflicts, sample;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Only once the data is clean.
-- ---------------------------------------------------------------------------
ALTER TABLE "SequenceEnrollment" ADD COLUMN "occupancyKey" TEXT;

-- Backfill: only occupying statuses take a key. Historical completed/unenrolled rows stay NULL
-- and can coexist freely, however many there are for one lead.
UPDATE "SequenceEnrollment"
SET "occupancyKey" = "tenantId" || ':' || "leadId"
WHERE "status" IN ('active', 'paused');

CREATE UNIQUE INDEX "SequenceEnrollment_occupancyKey_key" ON "SequenceEnrollment"("occupancyKey");

-- The half the unique index cannot express: an occupying status must carry *its own* key, and a
-- terminal one must carry none. Any writer that forgets either half now fails loudly here
-- instead of silently creating a second live cadence.
ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_occupancy_status_check" CHECK (
    CASE
      WHEN "status" IN ('active', 'paused')
        THEN "occupancyKey" IS NOT NULL
             AND "occupancyKey" = "tenantId" || ':' || "leadId"
      ELSE "occupancyKey" IS NULL
    END
  );
-- CASE, not `(A AND B) OR (C AND D)`. A CHECK passes when it evaluates to NULL, and
-- `"occupancyKey" = ...` is NULL whenever the column is NULL — so the OR form silently admitted
-- exactly the row it exists to forbid: status 'active' with no occupancy key. CASE yields a
-- real boolean on every branch.
