# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
**Evidence records**: 21
**Requirements verified**: 101 / 108
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `dfb172f` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `dfb172f` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `dfb172f` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `dfb172f` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `dfb172f` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `dfb172f` | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `dfb172f` | **FAIL** | 1 | 20 |
| `EV-RUN-2` | `certification-run` | `dfb172f` | **FAIL** | 1 | 20 |
| `EV-RUN-3` | `certification-run` | `dfb172f` | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `dfb172f` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `dfb172f` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --file C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T20-50-10-991Z.dump`
- **Ran**: 2026-08-19T20:50:19.220Z → 2026-08-19T20:50:35.153Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2098 bytes, sha256 `dd7c3cad53f374c4…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 414 bytes, sha256 `6905b8dac699cc99…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `fd0fda0893b985ef…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-19T20:52:20.103Z → 2026-08-19T20:52:31.311Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `0cf0c45c801a2a18…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260819t205010 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T20-50-10-991Z.dump`
- **Ran**: 2026-08-19T20:50:36.938Z → 2026-08-19T20:52:12.924Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `c73b33740ba6d728…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 434 bytes, sha256 `b04ec2512274d21b…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2228 bytes, sha256 `0567544465a58469…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-19T20:50:10.845Z → 2026-08-19T20:50:10.845Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-19T20:50:10.845Z → 2026-08-19T20:50:10.845Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-19T21:11:30.853Z → 2026-08-19T21:11:31.397Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `f780eb4bdbf4a281…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-19T21:11:59.138Z → 2026-08-19T21:12:43.490Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-19T21:14:22.057Z → 2026-08-19T21:14:56.042Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2063 bytes, sha256 `202936b268192f7f…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-19T21:13:59.102Z → 2026-08-19T21:14:02.527Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `a456d0e99902c29e…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-19T21:16:40.383Z → 2026-08-19T21:16:40.383Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 229983 bytes, sha256 `8e19da616aa837b8…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 221035 bytes, sha256 `d50c90dadf66e3b3…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 165032 bytes, sha256 `e4b2027f83310f75…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 138118 bytes, sha256 `9d14de6f8ce13a36…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 121562 bytes, sha256 `92213bb95b2542a5…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 218512 bytes, sha256 `797c4020542b1503…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate dfb172f53afaaae5f8304dd22b8f0dd37af69bcb --run 1`
- **Ran**: 2026-08-19T20:52:43.386Z → 2026-08-19T21:01:06.267Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `bfa6d2a949769460…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 318 bytes, sha256 `fc93abcc968795d1…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `334d51b3cbe823b5…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 365 bytes, sha256 `482004e8a40503bc…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1757 bytes, sha256 `e7b4653e8435531d…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 451 bytes, sha256 `d3281ec956551a20…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 555 bytes, sha256 `4ae928c23db274c8…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 770 bytes, sha256 `01c108fdab79abd8…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 625 bytes, sha256 `e9c17c089612ece1…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 604 bytes, sha256 `f6bc85a649f422da…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 524 bytes, sha256 `a08a1a943ad240c0…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 777 bytes, sha256 `39963e75daa38c43…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7420 bytes, sha256 `37bdec56d4a7c1c7…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `6626c9363e5e12e9…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2218 bytes, sha256 `1c844131134d06a5…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `a468c549378682ac…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `f4989adcad9e4c6b…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate dfb172f53afaaae5f8304dd22b8f0dd37af69bcb --run 2`
- **Ran**: 2026-08-19T21:01:06.853Z → 2026-08-19T21:10:12.449Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `a6b584aadda14f8a…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 318 bytes, sha256 `e15da973c4be2236…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `a8d5917963d257b0…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 365 bytes, sha256 `4cb62ec27ff4132d…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1757 bytes, sha256 `e8226e9ca8d8d6bf…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 451 bytes, sha256 `42249b55d98d292f…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 555 bytes, sha256 `045e2f3fabaf7569…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 770 bytes, sha256 `960a950fc4099686…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 625 bytes, sha256 `65da7d69fe10121c…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 604 bytes, sha256 `089b64d98aeb4a81…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 521 bytes, sha256 `39ab43874b3258f6…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 777 bytes, sha256 `ca72663681ed90b8…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7427 bytes, sha256 `e5a676592e5187df…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `b1e07aabbe99866f…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2218 bytes, sha256 `c17a9c594074cbd2…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `09553a8ebe834741…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `d6d2eeef3289c013…`
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate dfb172f53afaaae5f8304dd22b8f0dd37af69bcb --run 3`
- **Ran**: 2026-08-19T21:10:12.792Z → 2026-08-19T21:17:08.801Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `663c7589bc671697…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 318 bytes, sha256 `dc5427160590f859…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `f780eb4bdbf4a281…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 365 bytes, sha256 `f430e2b338b44976…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1757 bytes, sha256 `c83dc3f3cf057ee0…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `a456d0e99902c29e…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 770 bytes, sha256 `825beefdac65c62f…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 625 bytes, sha256 `8e4d2501ade29392…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 604 bytes, sha256 `e83718fb5c44917f…`
  - `docs/production-certification/evidence/raw/run3-13-queue-load.log` — 521 bytes, sha256 `bf7d6dbf1498c05b…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 777 bytes, sha256 `34568d94cf27c078…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7420 bytes, sha256 `9fa64410f81c3752…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles.log` — 2174 bytes, sha256 `c30d49b68d214184…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-17-golden-browser-journey.log` — 2219 bytes, sha256 `37de33431f418e17…`
  - `docs/production-certification/evidence/raw/run3-18-worker-readiness.log` — 187 bytes, sha256 `c8863ac21fb99661…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `c774f723119e0755…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-19T21:17:07.845Z → 2026-08-19T21:17:08.800Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:11:39.796Z → 2026-08-19T21:13:59.085Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `2b62db1e4ce697e1…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
