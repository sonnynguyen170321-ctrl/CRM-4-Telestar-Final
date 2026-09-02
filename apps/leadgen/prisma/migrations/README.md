# V2 migrations — operating notes

## V2ManagerReviewItem foreign-key drift (READ BEFORE ANY `prisma migrate dev`)

`V2ManagerReviewItem` intentionally uses **scalar id fields only** in `schema.prisma`
(no Prisma `@relation`). Its 10 foreign keys are created by **manual SQL**, in
`20260614050000_v2_p1s0b_restore_manager_review_fks/migration.sql`.

Because the Prisma model has no relations, the shadow-DB diff treats those manual
FKs as "drift to remove" and **auto-generates `DROP CONSTRAINT` statements for all
10 of them on every new migration**. This already happened twice (P1.S0B,
S-ENRICH-A) and required a manual `_prisma_migrations.checksum` repair each time.

### Rule for any schema session that runs `prisma migrate dev`
1. After generating a migration, **inspect the SQL and STRIP any
   `DROP CONSTRAINT "V2ManagerReviewItem_*_fkey"`** statements before applying it,
   so a fresh DB replays with the FKs intact.
2. If the dev DB already lost the constraints, re-run the `DO $$ ... $$` restore
   block from `20260614050000_v2_p1s0b_restore_manager_review_fks` and update the
   migration checksum.
3. **Add `node scripts/check-v2-mr-fks.mjs` to the session exit gate.** It asserts
   the 10 FKs still exist on the live DB (via `pg_constraint`) and fails loudly on
   drift. If the FK set legitimately changes, update `EXPECTED_MIN_FKS` in that
   script in the same session.

The 10 FKs (for reference):
`organizationId`→V2Organization · `companyId`→V2Company · `contactId`→V2Contact ·
`projectId`→V2Project · `icpVersionId`→V2ICPVersion ·
`leadAssignmentId`→V2LeadAssignment · `hardRuleAssessmentId`→V2HardRuleAssessment ·
`createdByUserId`/`assignedToUserId`/`resolvedByUserId`→V2User.
