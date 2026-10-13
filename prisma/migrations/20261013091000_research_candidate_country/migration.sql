-- Contact research: the country of a person's stated location, read from the head of their profile.
-- Additive and backward compatible: nullable, no default, no backfill (null means unknown, never guessed).

-- AlterTable
ALTER TABLE "ResearchCandidate" ADD COLUMN IF NOT EXISTS "country" TEXT;
