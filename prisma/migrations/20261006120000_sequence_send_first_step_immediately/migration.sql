-- Per-sequence switch: step 1 sends the moment a lead is enrolled (lib/sequences/rules.ts).
-- Additive with a default, so the running image keeps working on the new schema.
ALTER TABLE "Sequence" ADD COLUMN "sendFirstStepImmediately" BOOLEAN NOT NULL DEFAULT false;
