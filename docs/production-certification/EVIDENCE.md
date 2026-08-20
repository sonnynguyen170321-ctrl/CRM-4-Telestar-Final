# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `28669f0a76b33e4538eda0006550e192774ce17c`
**Evidence records**: 22
**Requirements verified**: 102 / 108
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
| Release identity | **no evidence** |
| Certification runs | `EV-RUN-1`, `EV-RUN-2`, `EV-RUN-3` |

---

## 2. All records

| Evidence ID | Kind | Candidate | Status | Exit | Artifacts |
|---|---|---|---|---:|---:|
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `28669f0` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `28669f0` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `28669f0` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `28669f0` | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `28669f0` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `28669f0` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `28669f0` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `28669f0` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `28669f0` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `28669f0` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `28669f0` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `28669f0` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `28669f0` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `28669f0` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `28669f0` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `28669f0` | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `28669f0` | **FAIL** | 1 | 20 |
| `EV-RUN-2` | `certification-run` | `28669f0` | **FAIL** | 1 | 20 |
| `EV-RUN-3` | `certification-run` | `28669f0` | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `28669f0` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `28669f0` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `28669f0` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32416213512`
- **Ran**: 2026-08-20T20:50:02Z → 2026-08-20T21:03:01Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32416213512.log` — 29927 bytes, sha256 `758c83dba9d24f73…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_audit_e2e_test
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_audit_e2e_test --format=custom --no-owner --no-acl --snapshot 00000003-00033721-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-20T21-09-19-090Z.dump`
- **Ran**: 2026-08-20T21:09:21.417Z → 2026-08-20T21:09:22.534Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2035 bytes, sha256 `3c8c896b424c8bee…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 448 bytes, sha256 `9886e2d32cc04da5…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `78e9d14aacc90b6b…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-20T21:09:42.293Z → 2026-08-20T21:09:53.047Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `78914086d2a552df…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_audit_e2e_test
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260820t210919 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-20T21-09-19-090Z.dump`
- **Ran**: 2026-08-20T21:09:23.350Z → 2026-08-20T21:09:28.120Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `143d63da5edfbcf0…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `736288d869878ce5…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2143 bytes, sha256 `1e83e3f9ef090903…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-20T21:11:23.492Z → 2026-08-20T21:11:23.492Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-20T21:11:23.492Z → 2026-08-20T21:11:23.492Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-20T21:04:04.207Z → 2026-08-20T21:04:04.506Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `7d9d2ac71b9ae2cb…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-20T21:04:10.689Z → 2026-08-20T21:04:47.994Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-20T21:06:34.373Z → 2026-08-20T21:06:54.509Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2065 bytes, sha256 `48bb7cc3c65c192c…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-20T21:06:14.640Z → 2026-08-20T21:06:18.030Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 547 bytes, sha256 `729d7cf2a77dbbd8…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-20T21:08:29.908Z → 2026-08-20T21:08:29.908Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 150986 bytes, sha256 `5b77b3c8494969c3…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 219467 bytes, sha256 `577f615896dcfa91…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 83723 bytes, sha256 `9e39c3e443a4123c…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137939 bytes, sha256 `40bfaa486f5af7a5…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 92706 bytes, sha256 `a1ebfba37e26bf51…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 217038 bytes, sha256 `c1a8dc130c931a31…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 28669f0a76b33e4538eda0006550e192774ce17c --run 1`
- **Ran**: 2026-08-20T20:50:21.499Z → 2026-08-20T20:56:31.623Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `67a96b0ccafd9ebb…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 782 bytes, sha256 `aaf33c6470005b53…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `f47d8be609b3b51a…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 337 bytes, sha256 `e14bf8917fc3dfd2…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1672 bytes, sha256 `335892ae41e2e108…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 443 bytes, sha256 `3b81099cd8b7df6c…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 547 bytes, sha256 `df1c066b8238e4e8…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 761 bytes, sha256 `28f73619f906e91a…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 617 bytes, sha256 `50248e0f0d3014e8…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 596 bytes, sha256 `d9f2786af01797c1…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 524 bytes, sha256 `bc777c5319063976…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 769 bytes, sha256 `de89204e18e9c792…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7408 bytes, sha256 `9351da262b874192…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `17ebb4e3d2eed548…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2220 bytes, sha256 `aa23546660d1b291…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `7f6a687a2622148b…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `8cb0c42a33e54d72…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 28669f0a76b33e4538eda0006550e192774ce17c --run 2`
- **Ran**: 2026-08-20T20:56:44.764Z → 2026-08-20T21:02:36.078Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `8afc5bcbf25013d9…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 782 bytes, sha256 `04324679a3a19ecd…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `ae934e6dca0643c4…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 337 bytes, sha256 `2f6e917dcf54f57f…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1672 bytes, sha256 `4ef496e0c999b32d…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `9d155014a9ae92eb…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 547 bytes, sha256 `7b735af4a61af163…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 761 bytes, sha256 `b89167b562f69658…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 617 bytes, sha256 `365ababf77b53c5e…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 596 bytes, sha256 `7afaa7cfc0139ebc…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 524 bytes, sha256 `244cfc5e4fbaf066…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 769 bytes, sha256 `730eacca174789d9…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7393 bytes, sha256 `f8b18a183ed452f3…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `35f9c9f58c589daf…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2220 bytes, sha256 `2f3152609c67d46b…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `7db622bc916d449d…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `133c512ae0497dd5…`
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 28669f0a76b33e4538eda0006550e192774ce17c --run 3`
- **Ran**: 2026-08-20T21:02:49.289Z → 2026-08-20T21:08:56.180Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-02-environment.log` — 477 bytes, sha256 `43c8440331e83250…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `7ac4f3174c1f6c75…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 782 bytes, sha256 `a20d37e897698e6e…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `7d9d2ac71b9ae2cb…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 337 bytes, sha256 `af9e7440b40d06df…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1672 bytes, sha256 `6d9c65f83a3dfdfa…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 547 bytes, sha256 `729d7cf2a77dbbd8…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 762 bytes, sha256 `d04266cd74c661bc…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 617 bytes, sha256 `2f1c453160304f03…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 596 bytes, sha256 `03bbc41ffc2651bb…`
  - `docs/production-certification/evidence/raw/run3-13-queue-load.log` — 523 bytes, sha256 `dfdaa4672d2dba2e…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 769 bytes, sha256 `3286382ffe59c6be…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7392 bytes, sha256 `cf8edd80b30c3024…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles.log` — 2174 bytes, sha256 `033f5ce2a1574ff4…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-17-golden-browser-journey.log` — 2219 bytes, sha256 `1d69da5a116727ae…`
  - `docs/production-certification/evidence/raw/run3-18-worker-readiness.log` — 187 bytes, sha256 `0bcd0defba3f1149…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `ae8a57b88f8110dd…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-20T21:08:55.337Z → 2026-08-20T21:08:56.179Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `28669f0a76b33e4538eda0006550e192774ce17c`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T21:04:06.151Z → 2026-08-20T21:06:14.621Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 443 bytes, sha256 `b948c859cc6e704f…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
