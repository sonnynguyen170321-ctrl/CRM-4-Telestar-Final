# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
**Evidence records**: 28
**Requirements verified**: 106 / 108
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
| Static analysis | `EV-GATE-TEST-DISCIPLINE` |
| Production build | `EV-GATE-TEST-DISCIPLINE` |
| Database integrity | `EV-GATE-TEST-DISCIPLINE` |
| Unit and integration tests | `EV-VITEST` |
| Redis integration | `EV-REDIS-INTEGRATION` |
| Import load — handler | `EV-LOAD-HANDLER`, `EV-LOAD-QUEUE` |
| Import load — real queue | `EV-LOAD-HANDLER`, `EV-LOAD-QUEUE` |
| Six-role browser acceptance | `EV-ROLE-BROWSER` |
| Disaster recovery — backup | `EV-DR-BACKUP` |
| Disaster recovery — restore | `EV-DR-RESTORE` |
| Disaster recovery — integrity control | `EV-DR-NEGATIVE-CONTROL` |
| Disaster recovery — RPO | `EV-DR-RPO` |
| Rollback | `EV-DR-ROLLBACK` |
| Release identity | `EV-RELEASE-IDENTITY` |
| Certification runs | `EV-RUN-1`, `EV-RUN-2`, `EV-RUN-3` |

---

## 2. All records

| Evidence ID | Kind | Candidate | Status | Exit | Artifacts |
|---|---|---|---|---:|---:|
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `d5d7cf8` | **FAIL** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `d5d7cf8` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `d5d7cf8` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `d5d7cf8` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-RLS-POSTURE` | `rls-posture` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `d5d7cf8` | **PASS** | 0 | 6 |
| `EV-ROLE-MODEL` | `role-model` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-RUN-1` | `certification-run` | `d5d7cf8` | **PASS** | 0 | 23 |
| `EV-RUN-2` | `certification-run` | `d5d7cf8` | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `d5d7cf8` | **PASS** | 0 | 23 |
| `EV-SECURITY-BOUNDARIES` | `security-boundaries` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `d5d7cf8` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32658798987`
- **Ran**: 2026-08-23T18:40:49Z → 2026-08-23T18:47:01Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32658798987.log` — 29927 bytes, sha256 `1c9dafd92e56b5b3…`
### `EV-DEPLOYED-STATE`
- **Kind**: `deployed-state`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: read-only probe of the live production health endpoint from the certification workstation
- **Command**: `curl -s https://crm.telestar.cloud/api/health`
- **Ran**: 2026-08-23T18:54:31.239Z → 2026-08-23T18:54:31.239Z
- **Exit code**: 0 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/deployed-health-probe.log` — 211 bytes, sha256 `75e90939f1946704…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-000B3A46-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T19-45-22-091Z.dump`
- **Ran**: 2026-08-23T19:45:29.600Z → 2026-08-23T19:45:36.027Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 1976 bytes, sha256 `2e5b509d264a65c3…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 437 bytes, sha256 `0ab0595ec14a1d7d…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 292 bytes, sha256 `28b672b16dedbed8…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-23T19:46:14.714Z → 2026-08-23T19:46:30.190Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 6199 bytes, sha256 `615096abca5fca8e…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260823t194522 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T19-45-22-091Z.dump`
- **Ran**: 2026-08-23T19:45:39.203Z → 2026-08-23T19:45:46.038Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `9417e58918b20bb1…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `7a0f9018972a02f0…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2095 bytes, sha256 `addd695d7ee3f054…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
- **Environment**: telestar-crm-vm / docker compose / GCE ubuntu-2204-lts
- **Command**: `scripts/deploy.sh + scripts/rollback.sh, observed over three phases`
- **Ran**: 2026-08-22T07:05:00.000Z → 2026-08-22T07:37:23.282Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: certification workstation - gcloud probe outcome MEASURED
- **Command**: `gcloud sql instances describe telestar-db --project=telestar-crm-final --format=json`
- **Ran**: 2026-08-23T19:45:52.290Z → 2026-08-23T19:46:00.026Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: point-in-time recovery is enabled, so recovery is bounded by transaction-log durability rather than by the backup interval
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rpo-gcloud.log` — 2021 bytes, sha256 `e2ea8c74b6cedc6f…`
### `EV-EMAIL-EXACTLY-ONCE`
- **Kind**: `email-exactly-once`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: certification workstation - real PostgreSQL; only the provider and the queue are substituted
- **Command**: `node node_modules/vitest/vitest.mjs run tests/email-send-once-invariant.test.ts tests/email-idempotency.test.ts tests/email-worker.test.ts tests/email-safety.test.ts tests/demo-email-barrier.test.ts tests/sequence-worker.test.ts tests/sequence-execute.test.ts`
- **Ran**: 2026-08-23T19:49:41.237Z → 2026-08-23T19:49:41.237Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/email-exactly-once.log` — 245 bytes, sha256 `c08486466891fe0d…`
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-23T19:30:29.049Z → 2026-08-23T19:30:29.422Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-05-test-discipline.log` — 324 bytes, sha256 `4aa2ce0f212352c6…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-23T19:30:42.178Z → 2026-08-23T19:31:19.504Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-23T19:33:40.617Z → 2026-08-23T19:34:01.840Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2061 bytes, sha256 `af8da07750f27147…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-23T19:33:18.132Z → 2026-08-23T19:33:21.663Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-09-redis-integration.log` — 547 bytes, sha256 `99245d5ecf1679e1…`
### `EV-RELEASE-IDENTITY`
- **Kind**: `release-identity`
- **Candidate**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
- **Environment**: win32 / node 24.16.0 / deploy host
- **Command**: `docker buildx imagetools inspect; docker inspect; curl /api/health`
- **Ran**: 2026-08-22T06:38:07.408Z → 2026-08-22T06:38:07.410Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**: none
### `EV-RLS-POSTURE`
- **Kind**: `rls-posture`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: certification workstation - local PostgreSQL 16; each script builds its own throwaway database and roles
- **Command**: `node scripts/verify-rls.mjs; node scripts/verify-rls-app-paths.mjs; node scripts/verify-rls-enablement.mjs; node scripts/verify-rls-live.mjs`
- **Ran**: 2026-08-23T19:49:41.091Z → 2026-08-23T19:49:41.091Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: DB_RLS_ENFORCED appears in no environment file and no compose file, so database-level RLS is NOT enforced in production. Production tenant isolation rests on the application-layer Prisma extension. DB-level RLS is available and now proven to work; enabling it is a separate infrastructure decision.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/rls-posture-gates.log` — 4850 bytes, sha256 `df6073d9ad2ccda1…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-23T19:35:53.972Z → 2026-08-23T19:35:53.972Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230325 bytes, sha256 `79fb46fb6100ce1e…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 219771 bytes, sha256 `6dabebb37d180605…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 429862 bytes, sha256 `d42b7f125ca7fec3…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 138408 bytes, sha256 `8bbcb0684f600291…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 119896 bytes, sha256 `e5507d5cd81d8343…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 188305 bytes, sha256 `8305ae263041a0da…`
### `EV-ROLE-MODEL`
- **Kind**: `role-model`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: certification workstation - real PostgreSQL
- **Command**: `vitest run tests/role-journeys tests/phase-9-role-surfaces tests/floor-manager-administration tests/leadgen tests/leadgen-redesign tests/ai-briefing-scope tests/client-report-scope tests/certification-role-evidence`
- **Ran**: 2026-08-23T19:49:41.382Z → 2026-08-23T19:49:41.382Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-model-suites.log` — 275 bytes, sha256 `d4ed710993d6be2c…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate d5d7cf83679faa1187ffd1ab095a37c28f5136f4 --run 1`
- **Ran**: 2026-08-23T18:52:03.437Z → 2026-08-23T19:09:42.624Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-03-typecheck.log` — 261 bytes, sha256 `f1ff53a33052c71a…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-04-lint.log` — 318 bytes, sha256 `203413b885992c9e…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-05-test-discipline.log` — 324 bytes, sha256 `91da53c66b496b01…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-06-migration-validation.log` — 337 bytes, sha256 `bfe25fbe84d18db2…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-07-database-integrity.log` — 1635 bytes, sha256 `726e0bb83c7429d0…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `916ad9ee18dc4f85…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-09-redis-integration.log` — 547 bytes, sha256 `42073bec60be2075…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-10-ai-certification.log` — 762 bytes, sha256 `2e89e68cdcd57809…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-11-email-safety.log` — 617 bytes, sha256 `7df5620c6740863b…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-12-import-fault-matrix.log` — 596 bytes, sha256 `6ba6d78f9e203627…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-13-queue-load.log` — 524 bytes, sha256 `bf0b6b8a4f30b400…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-14-security-suite.log` — 769 bytes, sha256 `7f983e84d87c025a…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-15-production-build.log` — 7404 bytes, sha256 `7c9a6c2e844dac8c…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-16-playwright-roles.log` — 2174 bytes, sha256 `04ccbff342bfa6ee…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-17-golden-browser-journey.log` — 2219 bytes, sha256 `8f5c2a3818a394c7…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-18-worker-readiness.log` — 187 bytes, sha256 `7f488ecdc15b00c5…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-22-health-smoke.log` — 210 bytes, sha256 `453881481683c223…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-19-docker-build.log` — 20528 bytes, sha256 `f267621b5d55804f…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-20-image-inspection.log` — 275 bytes, sha256 `bbaed1a2b9655409…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-21-compose-validation.log` — 1413 bytes, sha256 `7a5582da8ada9408…`
  - `docs/production-certification/evidence/raw/run1-d5d7cf8-23-validator-selftest.log` — 1760 bytes, sha256 `d9c1458150e71773…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate d5d7cf83679faa1187ffd1ab095a37c28f5136f4 --run 2`
- **Ran**: 2026-08-23T19:10:48.730Z → 2026-08-23T19:27:35.926Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-03-typecheck.log` — 261 bytes, sha256 `2233d50584a69642…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-04-lint.log` — 318 bytes, sha256 `a9c0e604b8232d62…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-05-test-discipline.log` — 324 bytes, sha256 `c1c7fa9a2d716006…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-06-migration-validation.log` — 337 bytes, sha256 `2261927d3b2ed81f…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-07-database-integrity.log` — 1635 bytes, sha256 `181f442e1cfc39db…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-09-redis-integration.log` — 547 bytes, sha256 `55bef9399d638be0…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-10-ai-certification.log` — 762 bytes, sha256 `d02688667187d4cc…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-11-email-safety.log` — 617 bytes, sha256 `6af23fd873679f90…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-12-import-fault-matrix.log` — 596 bytes, sha256 `5015f9daa4b52c7b…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-13-queue-load.log` — 524 bytes, sha256 `a3d2c5ed5dad808f…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-14-security-suite.log` — 769 bytes, sha256 `cd6ad6b9d05c2698…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-15-production-build.log` — 7406 bytes, sha256 `e119739e1c87e1e6…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-16-playwright-roles.log` — 2174 bytes, sha256 `8cd57a32cdf6fb77…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-17-golden-browser-journey.log` — 2218 bytes, sha256 `634f4e6b8e1a3b13…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-18-worker-readiness.log` — 187 bytes, sha256 `2f7daae73d07ec4b…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-22-health-smoke.log` — 210 bytes, sha256 `453881481683c223…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-19-docker-build.log` — 20918 bytes, sha256 `018d619a04fa9d67…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-20-image-inspection.log` — 275 bytes, sha256 `7db9ede27bd3f3cf…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-21-compose-validation.log` — 1413 bytes, sha256 `5c3648082d81816f…`
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-23-validator-selftest.log` — 1760 bytes, sha256 `d9c1458150e71773…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate d5d7cf83679faa1187ffd1ab095a37c28f5136f4 --run 3`
- **Ran**: 2026-08-23T19:28:43.915Z → 2026-08-23T19:44:19.223Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-03-typecheck.log` — 261 bytes, sha256 `bf13b5d95fdfffa2…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-04-lint.log` — 318 bytes, sha256 `f9fdb5d4853b5b84…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-05-test-discipline.log` — 324 bytes, sha256 `4aa2ce0f212352c6…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-06-migration-validation.log` — 337 bytes, sha256 `ab7259f41bdd4e2b…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-07-database-integrity.log` — 1635 bytes, sha256 `3589e6a7dbd0556c…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-09-redis-integration.log` — 547 bytes, sha256 `99245d5ecf1679e1…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-10-ai-certification.log` — 762 bytes, sha256 `36cdd5faa06f8b10…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-11-email-safety.log` — 617 bytes, sha256 `3c74404dbb259658…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-12-import-fault-matrix.log` — 596 bytes, sha256 `6cdb9c20e622fb53…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-13-queue-load.log` — 524 bytes, sha256 `b4340aa5e15d03ee…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-14-security-suite.log` — 769 bytes, sha256 `4398920faad832c6…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-15-production-build.log` — 7393 bytes, sha256 `ef82006c510cba62…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-16-playwright-roles.log` — 2174 bytes, sha256 `f9ad580b4fee4952…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-17-golden-browser-journey.log` — 2219 bytes, sha256 `2d0e4b4d42b5b789…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-18-worker-readiness.log` — 187 bytes, sha256 `a2ce2d1c3ba97a2d…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-22-health-smoke.log` — 210 bytes, sha256 `453881481683c223…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-19-docker-build.log` — 20437 bytes, sha256 `5b9b4d75378f4a42…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-20-image-inspection.log` — 275 bytes, sha256 `51dd2c3fa658dcf2…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-21-compose-validation.log` — 1413 bytes, sha256 `eee33edbebad7434…`
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-23-validator-selftest.log` — 1760 bytes, sha256 `d9c1458150e71773…`
### `EV-SECURITY-BOUNDARIES`
- **Kind**: `security-boundaries`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: certification workstation - real PostgreSQL; gitleaks v8.28.0 in docker
- **Command**: `vitest run (13 security suites); docker run zricethezav/gitleaks:v8.28.0 detect --config=.gitleaks.toml --exit-code 1`
- **Ran**: 2026-08-23T19:49:41.382Z → 2026-08-23T19:49:41.382Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/security-boundaries.log` — 490 bytes, sha256 `0025d8c71eee0382…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-23T19:44:14.869Z → 2026-08-23T19:44:19.222Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-23-validator-selftest.log` — 1760 bytes, sha256 `d9c1458150e71773…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:30:34.754Z → 2026-08-23T19:33:18.110Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `5639ba1918334cd0…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
