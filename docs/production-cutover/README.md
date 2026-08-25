# Production cutover — current state

**Classification**: CURRENT_CANONICAL
**Last measured**: 2026-08-25

## No production cutover has occurred

The production database has not been altered by this tooling. Anything claiming
otherwise is wrong; this file is the measured state.

## Why the previous manifest was withdrawn

`purge-manifest.json` was removed rather than kept, because it was not a
production manifest and was not safe to leave on disk where an operator could
point `--mode=EXECUTE` at it.

It recorded `productionDatabaseFingerprint: localhost:5432/telestar_crm` — the
local development database. `prod:cutover:*` runs with `--env-file=.env.local`,
whose `DATABASE_URL` is local, so PLAN never reached Cloud SQL.

It also queued **68,983 of 69,028 scanned rows** for deletion and reported
**zero** rows requiring review. That was not a property of the data. The
classifier decided demo/real by matching how an identifier *looked*:

- `endsWith('-tenant')` matched `default-tenant`, the **approved production
  tenant**, so every row that tenant owns was classified `PURGE_SEED`;
- loose prefixes (`ci`, `wo`, `test`, `load`, `temp`) matched real addresses —
  `cindy@itelestar.com` classified as a fixture.

Executing that manifest would have deleted real business data. The classifier
now decides by tenant provenance and defaults unknown rows to `REVIEW_REQUIRED`;
see `scripts/cutover/safe-cutover-tool.ts` and the regression tests in
`tests/safe-cutover-tool.test.ts`.

## What must happen before a manifest is trustworthy again

1. Read-only inventory against the **production** Cloud SQL instance
   (`telestar-crm-final` / `telestar-db` / `telestar_crm`), not localhost.
2. Every `REVIEW_REQUIRED` row deliberately resolved by the operator — zero
   because each was decided, never because the tool stopped producing them.
3. Backup + PITR verified, restored to an isolated clone, and the exact manifest
   hash rehearsed there.
4. Authorization packet issued and approved before `--mode=EXECUTE`.

Production Cloud SQL is not reachable from the certification workstation: the
active gcloud account is not authorized for project `telestar-crm-final`. Step 1
is blocked on operator credentials.
