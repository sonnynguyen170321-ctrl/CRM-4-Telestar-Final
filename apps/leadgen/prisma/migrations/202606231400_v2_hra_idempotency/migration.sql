-- P3: DB-enforced HardRuleAssessment idempotency. Preflight confirmed 0 duplicates on
-- this key, so the unique index applies cleanly. Additive (IF NOT EXISTS).
-- The score persist path already guards by SELECT-then-insert in a txn; this makes the
-- guarantee structural and enables ON CONFLICT-safe (incl. future bulk) inserts.
CREATE UNIQUE INDEX IF NOT EXISTS "V2HRA_org_lead_icp_fingerprint_version_unique"
  ON "V2HardRuleAssessment" ("organizationId", "leadAssignmentId", "icpVersionId", "inputFingerprint", "scoringVersion");
