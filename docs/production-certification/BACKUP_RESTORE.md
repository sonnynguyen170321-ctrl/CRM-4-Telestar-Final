# Telestar CRM — Disaster Recovery: Backup, Restore, Rollback

**Requirements**: `DR-001`, `DR-002`, `DR-003`, `DR-006`, `DR-007`
**Defect**: `TEL-P0-001` (this document's previous revision was the defect)
**Last Updated**: 2026-08-20T09:00:00+07:00

> **Every number below was observed.** Nothing here is a target restated as a result.
> The evidence records are `EV-DR-BACKUP`, `EV-DR-RESTORE`, and `EV-DR-NEGATIVE-CONTROL`
> under `evidence/`, with raw command logs under `evidence/raw/`.
>
> **What the previous revision said, and why it was void:** it documented a 48.2 MB backup
> whose SHA-256 was `e3b0c442…b855` — the digest of an *empty* input, which a 48.2 MB file
> cannot have. It reported RTO 4m 12s, RPO 15m, and a 38s rollback, none of which were
> measured. It instructed the operator to run `scripts/verify-db-integrity.ts`, which did
> not exist. All of it is withdrawn.

---

## 1. Status summary

| Requirement | What it asks | Status | Basis |
|---|---|---|---|
| `DR-001` | Backup created and integrity-verified | **PASS** | `EV-DR-BACKUP` — real dump, real digest, `sha256sum -c` verified |
| `DR-002` | Restore into an isolated database, verified | **PASS** | `EV-DR-RESTORE` — restored, integrity-checked, counts reconciled |
| `DR-006` | Measured RTO | **PASS** | 96.08 s observed |
| `DR-007` | Measured RPO | **BLOCKED_EXTERNAL** | requires GCP inspection; see §5 and `TEL-P0-002` |
| `DR-003` | Rollback drill between image digests | **NOT EXECUTED** | requires a container runtime; see §6 and `TEL-P1-018` |

---

## 2. Backup (`DR-001`)

Executed by `scripts/certification/dr-drill.mjs`. Raw log:
`evidence/raw/dr-backup-command.log`.

```bash
pg_dump -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm \
  --format=custom --no-owner --no-acl --file <artifact>.dump
sha256sum -c <artifact>.dump.sha256
```

| Observation | Value |
|---|---|
| Source database | `telestar_crm` (local certification source) |
| Backup started | 2026-08-19T17:44:49.539Z |
| Backup finished | 2026-08-19T17:45:05.067Z |
| `pg_dump` exit code | 0 |
| **Artifact size** | **86,737,818 bytes (82.72 MB)** |
| **SHA-256** | **`6973d111728f0173fb9c0d48df90bf8add6dcfc7753957f6038ac7f7e73472fa`** |
| Checksum verification | `sha256sum -c` → OK (exit 0) |

The artifact itself is **not committed**. It contains real row data, and
`.dr-artifacts/` is gitignored. Its size and digest are recorded here and in the evidence
record so the same file can be re-verified wherever it is stored.

The validator refuses any backup evidence whose size is zero or whose digest equals the
empty-file digest, so the specific failure that produced `TEL-P0-001` cannot recur silently.

---

## 3. Restore drill (`DR-002`, `DR-006`)

Restored into a freshly created, isolated database — never over the source. Raw logs:
`evidence/raw/dr-createdb.log`, `dr-restore-command.log`, `dr-restore-integrity.log`.

```bash
createdb -h 127.0.0.1 -U postgres telestar_dr_drill_<stamp>
pg_restore -h 127.0.0.1 -U postgres -d telestar_dr_drill_<stamp> \
  --no-owner --no-acl --exit-on-error <artifact>.dump
DATABASE_URL=<isolated target> npx tsx scripts/verify-db-integrity.ts \
  --json --expect-counts counts.json
```

| Observation | Value |
|---|---|
| Restore started | 2026-08-19T17:45:06.802Z |
| Restore finished | 2026-08-19T17:46:42.879Z |
| `pg_restore` exit code | 0 |
| **Measured RTO** | **96.08 s**, from `pg_restore` invocation to `pg_restore` exit |
| Integrity verification | PASS |
| Record counts | reconciled against the pre-backup snapshot, all 13 models equal |

RTO here is *restore duration for this dataset on this host*. It is not a production SLA:
production runs on managed Postgres with a different dataset size and restore path. It is
the honest local measurement, labelled as such.

### Record count reconciliation (`§10.3`)

Counts — never row contents — for `Tenant`, `User`, `Client`, `Campaign`, `Account`,
`Contact`, `Lead`, `Task`, `Activity`, `Sequence`, `SequenceEnrollment`, `OutboundMessage`,
`ImportBatch`, captured before the dump and compared after the restore. Every model matched.
Values are in `EV-DR-BACKUP.metrics.preBackupCounts` and
`EV-DR-RESTORE.metrics.restoredCounts`.

---

## 4. The integrity script is not a rubber stamp

`scripts/verify-db-integrity.ts` checks: every datamodel model has a table; the migration
ledger is complete and applied; no foreign key points at a missing row (209 single-column
FKs re-proved); no tenant-owned row has a null `tenantId` (63 tables); row-level security
configuration; and representative record counts.

A verification script that always exits 0 is indistinguishable from no verification, so it
has a negative control — `scripts/certification/dr-negative-fixture.mjs`, evidence
`EV-DR-NEGATIVE-CONTROL`, raw log `evidence/raw/dr-negative-fixture.log`:

| Injected fault | Expected | Observed |
|---|---|---|
| Empty database, no tables | FAIL | detected — reported the missing tables |
| Freshly migrated database, undamaged | PASS | verified clean |
| Orphaned foreign key, written with `session_replication_role = replica` | FAIL | detected — reported the orphan |
| `Activity` table dropped | FAIL | detected — reported the missing table |

The orphan case reproduces the real failure mode: a restore that loads data with constraint
enforcement bypassed exits 0 and leaves a database Postgres will never complain about.

---

## 5. RPO (`DR-007`) — BLOCKED_EXTERNAL

**RPO is not measured, and the previously published figure is withdrawn.**

RPO is a property of the production backup configuration, not of a local drill. It cannot be
established from this machine: `gcloud` is not installed here, so the Cloud SQL instance
cannot be inspected.

It must not be estimated, because the repository's own documentation disagrees with itself:

| Source | Says |
|---|---|
| `docs/BACKUP_RESTORE_RUNBOOK.md` §1 | automated daily backups and 7-day PITR are **enabled**; RPO < 5 minutes |
| `docs/CLOUD_RUN_DEPLOY.md` §Cloud SQL | the instance is created with `--availability-type=zonal --no-backup` |
| `docs/DEPLOY.md` §8 | as of 2026-08-05, `gcloud sql backups list` returned one manual snapshot — "There is no schedule." |

If the deploy documentation is correct, there is no automated backup and no PITR, and the
real RPO is *"everything since the last manual snapshot"* — unbounded. This is registered as
**`TEL-P0-002`** and must be resolved by inspecting the live instance, not by choosing which
document to believe.

To close it, run against the real project and attach the raw output:

```bash
gcloud sql instances describe telestar-crm-db \
  --project=telestar-crm-final \
  --format="value(settings.backupConfiguration.enabled,\
settings.backupConfiguration.pointInTimeRecoveryEnabled,\
settings.backupConfiguration.transactionLogRetentionDays,\
settings.backupConfiguration.startTime)"
gcloud sql backups list --instance=telestar-crm-db --project=telestar-crm-final
```

RPO then follows from the transaction-log retention and backup cadence actually reported.

---

## 6. Rollback (`DR-003`) — NOT EXECUTED

No rollback drill has been performed, and the previously published "38 seconds" is withdrawn.

A rollback exercise requires two immutable image digests to move between. No container
runtime is available on this machine (`docker` is not installed), so no image has been built
and no digest exists. This is tracked as part of **`TEL-P1-018`**.

The exercise, when it runs, must record: candidate image digest, previous image digest,
rollback command, start and finish timestamps, web health, worker health, database schema
compatibility, and redeployment of the candidate. Until it is executed with those values,
`DR-003` stays **NOT EXECUTED** — not "documented", not "runbook available".

### Rollback design (intent, not evidence)

1. Both web and worker deploy from the **same** image digest; rollback moves both.
2. Worker drains before restart so in-flight jobs finish.
3. Migrations follow expand-and-contract, so rolling application containers back does not
   break against the newer schema. This property is *claimed by design* and is exactly what
   the drill must confirm.

---

## 7. Reproducing this drill

```bash
node scripts/certification/dr-drill.mjs --source telestar_crm --candidate <40-char sha>
node scripts/certification/dr-negative-fixture.mjs --candidate <40-char sha>
npm run certify:validate
```

Evidence is bound to the candidate SHA it was produced against. When the release candidate
is re-frozen, this drill must be re-run: the validator rejects DR evidence carrying a
superseded SHA rather than letting it drift forward silently.
