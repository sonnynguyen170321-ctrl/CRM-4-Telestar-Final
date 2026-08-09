-- Make a transition occurrence resumable.
--
-- The ledger row was already a durable idempotency claim, but a retry treated its mere
-- existence as proof the transition had finished. A crash between the insert and the state
-- write therefore stranded the prospect: every retry returned "already applied" while the lead
-- had never moved, and only manual repair could finish it. Manual repair is for genuinely
-- irreconcilable data, not for an ordinary crash window.
--
-- The row now carries execution status and the set of consequences already claimed, so an
-- interrupted occurrence converges to completion while each business consequence still runs at
-- most once.
ALTER TABLE "ProspectTransition"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN "appliedEffects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "completedAt" TIMESTAMP(3);

-- Rows written before this migration ran to completion under the old all-or-nothing path.
UPDATE "ProspectTransition"
   SET "status" = 'completed',
       "completedAt" = "createdAt",
       "appliedEffects" = ARRAY['activity']::TEXT[]
 WHERE "status" = 'pending';

-- Finding unfinished work is the resume path's main query.
CREATE INDEX "ProspectTransition_status_createdAt_idx" ON "ProspectTransition"("status", "createdAt");
