-- Per-account visibility for sequences and templates (lib/visibility.ts). Both were visible to the
-- whole tenant; from here a row is seen by its creator, the managers above them, and — when a
-- manager marks it shared — everyone.
--
-- Default false, by the owner's decision (2026-10-05): existing rows become private to their
-- creator at once, and a manager shares the ones the team uses. Nothing stops sending: visibility
-- is an API concern, and a cadence already running keeps running whoever can see its sequence.
ALTER TABLE "Sequence" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Template" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;
