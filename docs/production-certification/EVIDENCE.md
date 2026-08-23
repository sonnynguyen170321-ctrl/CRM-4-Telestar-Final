# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
**Evidence records**: 28
**Requirements verified**: 100 / 108
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
| `EV-CI-RUN` | `ci-run` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `d5d7cf8` | **FAIL** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `12ea8ae` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `12ea8ae` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `d5d7cf8` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `d5d7cf8` | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-RLS-POSTURE` | `rls-posture` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `d5d7cf8` | **PASS** | 0 | 6 |
| `EV-ROLE-MODEL` | `role-model` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
| `EV-RUN-1` | `certification-run` | `d5d7cf8` | **PASS** | 0 | 23 |
| `EV-RUN-2` | `certification-run` | `d5d7cf8` | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `daa8ffb` ⚠ | **FAIL** | 1 | 20 |
| `EV-SECURITY-BOUNDARIES` | `security-boundaries` | `12ea8ae` ⚠ | **PASS** | 0 | 1 |
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
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32639980424`
- **Ran**: 2026-08-23T12:38:42Z → 2026-08-23T12:44:53Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32639980424.log` — 29927 bytes, sha256 `b574c029b6d41b74…`
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
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-0008CE71-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T14-47-36-944Z.dump`
- **Ran**: 2026-08-23T14:47:42.496Z → 2026-08-23T14:47:47.145Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 1976 bytes, sha256 `08b70ceb23a231cd…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 437 bytes, sha256 `37e6e0d795d242a1…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 292 bytes, sha256 `63a28cb2c6bac52c…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-23T18:15:14.409Z → 2026-08-23T18:15:26.009Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 6199 bytes, sha256 `cca70da75d0ead24…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260823t144736 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T14-47-36-944Z.dump`
- **Ran**: 2026-08-23T14:47:48.325Z → 2026-08-23T14:47:53.722Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `578dc21c8f3a9f3e…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `455999038fc3a4b2…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2095 bytes, sha256 `320cb8912dacd821…`
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
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: certification workstation - gcloud probe outcome MEASURED
- **Command**: `gcloud sql instances describe telestar-db --project=telestar-crm-final --format=json`
- **Ran**: 2026-08-23T17:24:34.314Z → 2026-08-23T17:24:39.963Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: point-in-time recovery is enabled, so recovery is bounded by transaction-log durability rather than by the backup interval
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rpo-gcloud.log` — 2021 bytes, sha256 `e2ea8c74b6cedc6f…`
### `EV-EMAIL-EXACTLY-ONCE`
- **Kind**: `email-exactly-once`
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: certification workstation - real PostgreSQL; only the provider and the queue are substituted
- **Command**: `node node_modules/vitest/vitest.mjs run tests/email-send-once-invariant.test.ts tests/email-idempotency.test.ts tests/email-worker.test.ts tests/email-safety.test.ts tests/demo-email-barrier.test.ts tests/sequence-worker.test.ts tests/sequence-execute.test.ts`
- **Ran**: 2026-08-23T18:17:47.168Z → 2026-08-23T18:17:47.168Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/email-exactly-once.log` — 247 bytes, sha256 `4ee73aca8682a4bc…`
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-23T19:12:39.137Z → 2026-08-23T19:12:39.545Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-05-test-discipline.log` — 324 bytes, sha256 `c1c7fa9a2d716006…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-23T19:12:53.300Z → 2026-08-23T19:13:34.158Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-23T19:16:07.854Z → 2026-08-23T19:16:30.391Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2065 bytes, sha256 `56fc585cb915ebfd…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-23T19:15:43.943Z → 2026-08-23T19:15:47.678Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-09-redis-integration.log` — 547 bytes, sha256 `55bef9399d638be0…`
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
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: certification workstation - local PostgreSQL 16; each script builds its own throwaway database and roles
- **Command**: `node scripts/verify-rls.mjs; node scripts/verify-rls-app-paths.mjs; node scripts/verify-rls-enablement.mjs; node scripts/verify-rls-live.mjs`
- **Ran**: 2026-08-23T18:10:04.738Z → 2026-08-23T18:10:04.738Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: DB_RLS_ENFORCED appears in no environment file and no compose file, so database-level RLS is NOT enforced in production. Production tenant isolation rests on the application-layer Prisma extension. DB-level RLS is available and now proven to work; enabling it is a separate infrastructure decision.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/rls-posture-gates.log` — 4850 bytes, sha256 `244b3c4b29e8a858…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-23T19:18:26.115Z → 2026-08-23T19:18:26.115Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230616 bytes, sha256 `6dae8a90a14c086f…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 219973 bytes, sha256 `0031dc8645d41d72…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 419340 bytes, sha256 `a48161e23e2cc381…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 139069 bytes, sha256 `fd68933e90cc77fa…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 119881 bytes, sha256 `c53ff0852162f234…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 217488 bytes, sha256 `5f53f3560505f3e5…`
### `EV-ROLE-MODEL`
- **Kind**: `role-model`
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: certification workstation - real PostgreSQL
- **Command**: `vitest run tests/role-journeys tests/phase-9-role-surfaces tests/floor-manager-administration tests/leadgen tests/leadgen-redesign tests/ai-briefing-scope tests/client-report-scope tests/certification-role-evidence`
- **Ran**: 2026-08-23T18:25:37.736Z → 2026-08-23T18:25:37.736Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-model-suites.log` — 275 bytes, sha256 `2fca0542829964cc…`
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
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate daa8ffb679b7bee87a907d4913123318b697eab6 --run 3`
- **Ran**: 2026-08-21T02:56:50.536Z → 2026-08-21T03:03:30.823Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `7147b86d854fa1c5…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 782 bytes, sha256 `4091a8f0169d6bfa…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `ec4f8c739d65285c…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 337 bytes, sha256 `492eacea70d547d5…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1672 bytes, sha256 `2018c45c7993289e…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 547 bytes, sha256 `830acee60b902a35…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 762 bytes, sha256 `5c7f1592676a4c6b…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 617 bytes, sha256 `3e659cd6ce1cae8a…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 596 bytes, sha256 `16d9914f8e1a1c2d…`
  - `docs/production-certification/evidence/raw/run3-13-queue-load.log` — 524 bytes, sha256 `c64f23217f9fab38…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 769 bytes, sha256 `8d71c48d1ba4fa2f…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7350 bytes, sha256 `1cee7e71a1fb80f1…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles.log` — 2174 bytes, sha256 `4434be622721792c…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-17-golden-browser-journey.log` — 2218 bytes, sha256 `7ca079681978179c…`
  - `docs/production-certification/evidence/raw/run3-18-worker-readiness.log` — 187 bytes, sha256 `aed5273b83519656…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `3227f3c7e3189920…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-BOUNDARIES`
- **Kind**: `security-boundaries`
- **Candidate**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
- **Environment**: certification workstation - real PostgreSQL; gitleaks v8.28.0 in docker
- **Command**: `vitest run (13 security suites); docker run zricethezav/gitleaks:v8.28.0 detect --config=.gitleaks.toml --exit-code 1`
- **Ran**: 2026-08-23T18:25:37.736Z → 2026-08-23T18:25:37.736Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/security-boundaries.log` — 492 bytes, sha256 `ed3f6ef84ed9c35c…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-23T19:27:33.359Z → 2026-08-23T19:27:35.925Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-23-validator-selftest.log` — 1760 bytes, sha256 `d9c1458150e71773…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T19:12:45.058Z → 2026-08-23T19:15:43.921Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-d5d7cf8-08-vitest.log` — 443 bytes, sha256 `969af2c16ffa3609…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
