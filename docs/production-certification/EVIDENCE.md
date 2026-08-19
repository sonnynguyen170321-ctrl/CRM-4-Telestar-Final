# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: *(not frozen)*
**Evidence records**: 8
**Requirements verified**: 0 / 108
**Verdict**: NO-GO

> This ledger is generated. The previous one was maintained by hand and drifted: it declared
> a candidate SHA and test totals that the certificate contradicted, and nothing could detect
> that it had. A record cannot appear here without existing, and cannot vanish while it does.
>
> A ⚠ marks a record produced against a **superseded** candidate. Such a record does not
> satisfy any requirement — the validator only resolves evidence bound to the current
> candidate — and must be regenerated.

---

## 1. Domain coverage

| Certification domain | Evidence |
|---|---|
| Static analysis | **no evidence** |
| Production build | **no evidence** |
| Database integrity | **no evidence** |
| Unit and integration tests | **no evidence** |
| Redis integration | **no evidence** |
| Import load — handler | `EV-LOAD-HANDLER`, `EV-LOAD-QUEUE` |
| Import load — real queue | `EV-LOAD-HANDLER`, `EV-LOAD-QUEUE` |
| Six-role browser acceptance | `EV-ROLE-BROWSER` |
| Disaster recovery — backup | `EV-DR-BACKUP` |
| Disaster recovery — restore | `EV-DR-RESTORE` |
| Disaster recovery — integrity control | `EV-DR-NEGATIVE-CONTROL` |
| Disaster recovery — RPO | `EV-DR-RPO` |
| Rollback | `EV-DR-ROLLBACK` |
| Release identity | **no evidence** |
| Certification runs | **no evidence** |

---

## 2. All records

| Evidence ID | Kind | Candidate | Status | Exit | Artifacts |
|---|---|---|---|---:|---:|
| `EV-DR-BACKUP` | `dr-backup` | `7de1758` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `7de1758` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `7de1758` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `7de1758` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `7de1758` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `1ee045c` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `1ee045c` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `b9e6ed9` | **PASS** | 0 | 6 |

---

## 3. Record detail

### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --file C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T17-44-44-936Z.dump`
- **Ran**: 2026-08-19T17:44:49.539Z → 2026-08-19T17:45:05.067Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2098 bytes, sha256 `7a27ff0645427ef7…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 414 bytes, sha256 `97f608928fa13cd9…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `1b9d0417aa161968…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-19T17:48:29.663Z → 2026-08-19T17:48:39.499Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `6e5e34d78289a43f…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260819t174444 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T17-44-44-936Z.dump`
- **Ran**: 2026-08-19T17:45:06.802Z → 2026-08-19T17:46:42.879Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `8721f876a4fca653…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 434 bytes, sha256 `f0bcbb0b5982dc9f…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2228 bytes, sha256 `db14762a3634f49a…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Environment**: certification workstation (win32) — no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-20T09:00:00+07:00 → 2026-08-20T09:00:00+07:00
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no image digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Environment**: certification workstation (win32) — gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-20T09:00:00+07:00 → 2026-08-20T09:00:00+07:00
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `1ee045c4a8c645397df0a8d6866c6b4bd13decc2`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-19T18:56:45.132Z → 2026-08-19T18:57:20.867Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `1ee045c4a8c645397df0a8d6866c6b4bd13decc2`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-19T18:53:42.771Z → 2026-08-19T18:54:20.780Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2067 bytes, sha256 `7dd4cdd1a302d829…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `b9e6ed9860c7477d89dfa0801b34803ef539d829`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-19T19:17:20.985Z → 2026-08-19T19:17:20.985Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230240 bytes, sha256 `9df26d86318281a2…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 221318 bytes, sha256 `47d843e603b7ff69…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 83735 bytes, sha256 `4a79cafc3ee33850…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137939 bytes, sha256 `40bfaa486f5af7a5…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 92874 bytes, sha256 `6cab54690074b754…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 218836 bytes, sha256 `c2e7b11952eb9097…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
