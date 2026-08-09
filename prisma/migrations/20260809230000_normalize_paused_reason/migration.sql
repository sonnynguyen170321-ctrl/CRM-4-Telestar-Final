-- Collapse the paused-reason vocabularies onto the one the UI and the schema comment
-- already declared. `pauseSequence` used to write its own four-value list, so rows paused
-- by a reply or a bounce carry tokens the label map has no key for and the lead panel
-- renders raw. Two of the four overlapped and need no remap.
--
-- `bounced` did not distinguish hard from soft; the writer now does, but the historical
-- rows cannot be told apart after the fact. They map to hard_bounce, which is what the
-- bounce path suppressed on and therefore the safer reading of an already-paused run.
UPDATE "SequenceEnrollment" SET "pausedReason" = 'reply'       WHERE "pausedReason" = 'replied';
UPDATE "SequenceEnrollment" SET "pausedReason" = 'hard_bounce' WHERE "pausedReason" = 'bounced';
