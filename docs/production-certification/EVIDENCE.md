# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
**Evidence records**: 23
**Requirements verified**: 1 / 108
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `daa8ffb` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `daa8ffb` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `daa8ffb` ⚠ | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `daa8ffb` ⚠ | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `daa8ffb` ⚠ | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `9fa36d3` | **PASS** | 0 | 0 |
| `EV-ROLE-BROWSER` | `role-browser` | `daa8ffb` ⚠ | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `daa8ffb` ⚠ | **FAIL** | 1 | 20 |
| `EV-RUN-2` | `certification-run` | `daa8ffb` ⚠ | **FAIL** | 1 | 20 |
| `EV-RUN-3` | `certification-run` | `daa8ffb` ⚠ | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `daa8ffb` ⚠ | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32418164738`
- **Ran**: 2026-08-20T21:12:02Z → 2026-08-20T21:17:34Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32418164738.log` — 29927 bytes, sha256 `643bcff0a59a8e5b…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_audit_e2e_test
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_audit_e2e_test --format=custom --no-owner --no-acl --snapshot 00000003-0004144D-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-21T03-04-00-363Z.dump`
- **Ran**: 2026-08-21T03:04:02.575Z → 2026-08-21T03:04:03.753Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2035 bytes, sha256 `6503bee444a9f002…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 448 bytes, sha256 `c1017426d0ede817…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `7a0c24ed4e50a640…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-21T03:04:13.898Z → 2026-08-21T03:04:24.047Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `5b88b5d00a550855…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_audit_e2e_test
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260821t030400 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-21T03-04-00-363Z.dump`
- **Ran**: 2026-08-21T03:04:04.916Z → 2026-08-21T03:04:09.688Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `5803cd74429eb977…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `68c6e0a235c3af09…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2143 bytes, sha256 `4eddc5a15970ef9b…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-21T03:04:24.204Z → 2026-08-21T03:04:24.204Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-21T03:04:24.204Z → 2026-08-21T03:04:24.204Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-21T02:58:11.055Z → 2026-08-21T02:58:11.405Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `ec4f8c739d65285c…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-21T02:58:18.078Z → 2026-08-21T02:58:58.350Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-21T03:00:48.088Z → 2026-08-21T03:01:07.405Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2063 bytes, sha256 `fa651a2f7e7ec84d…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-21T03:00:27.602Z → 2026-08-21T03:00:31.107Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 547 bytes, sha256 `830acee60b902a35…`
### `EV-RELEASE-IDENTITY`
- **Kind**: `release-identity`
- **Candidate**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
- **Environment**: win32 / node 24.16.0 / deploy host
- **Command**: `docker buildx imagetools inspect; docker inspect; curl /api/health`
- **Ran**: 2026-08-22T06:38:07.408Z → 2026-08-22T06:38:07.410Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**: none
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-21T03:03:03.382Z → 2026-08-21T03:03:03.382Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 151257 bytes, sha256 `d386bcfe8e24b916…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 219467 bytes, sha256 `577f615896dcfa91…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 83723 bytes, sha256 `9e39c3e443a4123c…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137939 bytes, sha256 `40bfaa486f5af7a5…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 92706 bytes, sha256 `a1ebfba37e26bf51…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 217040 bytes, sha256 `d5028a2f9746573b…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate daa8ffb679b7bee87a907d4913123318b697eab6 --run 1`
- **Ran**: 2026-08-21T02:41:25.907Z → 2026-08-21T02:50:06.633Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `45f1527d3d7fdba7…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 782 bytes, sha256 `2982eea9654da06e…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `7a43e59423166944…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 337 bytes, sha256 `b907e68c187b787f…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1672 bytes, sha256 `6e7e034a7684546c…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 443 bytes, sha256 `8e5706f8f659b1fc…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 547 bytes, sha256 `e9b6c98bb179d7f2…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 761 bytes, sha256 `3b492b2973c84841…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 617 bytes, sha256 `60e9bb6286eeacd0…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 596 bytes, sha256 `d258123bbf63dbd7…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 523 bytes, sha256 `eec8dc7e56bfeca6…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 769 bytes, sha256 `8891a73659b0db56…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 8267 bytes, sha256 `8e15a2c5dbc28d97…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `5b2503cd1eb412d3…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2218 bytes, sha256 `c600770d5e1f40d9…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `3768151e76da389b…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `0f633a226b05dbd7…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate daa8ffb679b7bee87a907d4913123318b697eab6 --run 2`
- **Ran**: 2026-08-21T02:50:20.923Z → 2026-08-21T02:56:32.425Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `7fa135c01a429888…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 782 bytes, sha256 `956290a14ef03383…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `ef5082558cf126e3…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 337 bytes, sha256 `03d2fc7b0ef93e39…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1672 bytes, sha256 `514aefd33b18252f…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `ce795001fd1656b6…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 547 bytes, sha256 `fe5e8bdeb6ef75db…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 762 bytes, sha256 `fa3b13c0170b1d1e…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 617 bytes, sha256 `68a3270cac9c657a…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 596 bytes, sha256 `8438df88f3fc227c…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 524 bytes, sha256 `0b7f7fefb1498b79…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 769 bytes, sha256 `c7e0b20c88103737…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7398 bytes, sha256 `40558a131231b36a…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `4daf56a146eda0a5…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2220 bytes, sha256 `077b3b88e2ca1e86…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `e264cfc05cddef5e…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `727683d0a2f2cfc2…`
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
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
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-21T03:03:30.021Z → 2026-08-21T03:03:30.822Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `daa8ffb679b7bee87a907d4913123318b697eab6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-21T02:58:13.515Z → 2026-08-21T03:00:27.582Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `94c38898a256a2f6…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
