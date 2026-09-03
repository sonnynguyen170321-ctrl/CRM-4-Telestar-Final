-- Discovery promotes candidates into the lead pool, and where a record came from is the first thing
-- an SDR asks. Without this value a researched company would land as `other` and be indistinguishable
-- from a manual paste.
ALTER TYPE "LeadSourceType" ADD VALUE IF NOT EXISTS 'research';
