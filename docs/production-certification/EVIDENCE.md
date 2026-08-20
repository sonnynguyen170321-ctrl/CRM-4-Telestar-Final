# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
**Evidence records**: 22
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `3672f97` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `3672f97` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `3672f97` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `3672f97` | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `3672f97` | **FAIL** | 1 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `3672f97` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `3672f97` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `3672f97` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `3672f97` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `3672f97` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `3672f97` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `3672f97` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `3672f97` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `3672f97` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `3672f97` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `3672f97` | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `3672f97` | **FAIL** | 1 | 20 |
| `EV-RUN-2` | `certification-run` | `3672f97` | **FAIL** | 1 | 20 |
| `EV-RUN-3` | `certification-run` | `3672f97` | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `3672f97` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `3672f97` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `3672f97` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32326914380`
- **Ran**: 2026-08-20T03:04:24Z → 2026-08-20T03:13:31Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32326914380.log` — 27704 bytes, sha256 `053702c5ccd0263a…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-000E3D26-1 --file C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-20T03-01-46-674Z.dump`
- **Ran**: 2026-08-20T03:01:56.403Z → 2026-08-20T03:02:12.808Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2101 bytes, sha256 `cb0c08e9af4fce69…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 445 bytes, sha256 `802dd0ce9496ffdb…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `94b047063f4a5c23…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-20T03:04:05.860Z → 2026-08-20T03:04:16.624Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `98433c3349df3961…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260820t030146 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-20T03-01-46-674Z.dump`
- **Ran**: 2026-08-20T03:02:14.832Z → 2026-08-20T03:03:58.585Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `d12a668ad9d693e4…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 434 bytes, sha256 `2ba14737e4d7ae4a…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2228 bytes, sha256 `5d3aa9e080126ae7…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-20T03:01:46.545Z → 2026-08-20T03:01:46.545Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-20T03:01:46.545Z → 2026-08-20T03:01:46.545Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-20T03:20:35.242Z → 2026-08-20T03:20:35.811Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `ea3ceddd549d8ce7…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-20T03:21:05.557Z → 2026-08-20T03:21:51.531Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-20T03:23:34.149Z → 2026-08-20T03:24:12.140Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2068 bytes, sha256 `3111fda4dfde4cfa…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-20T03:23:10.592Z → 2026-08-20T03:23:14.178Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `67e11dcfa474794a…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-20T03:26:03.342Z → 2026-08-20T03:26:03.342Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230244 bytes, sha256 `e48cb189c9771b24…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 220670 bytes, sha256 `58e83a3e718ed4d1…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 260540 bytes, sha256 `f012b6475d4953aa…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 138094 bytes, sha256 `b847910fa892cb7f…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 122665 bytes, sha256 `14c05bb0dc4c7b58…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 218189 bytes, sha256 `30f80215475f34f6…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32 --run 1`
- **Ran**: 2026-08-20T03:04:32.573Z → 2026-08-20T03:11:53.099Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 469 bytes, sha256 `93b193ce89241635…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `56a651877ceb13c7…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 318 bytes, sha256 `3245224bda3c8c02…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `1eec1dd1e6471768…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 406 bytes, sha256 `630a1112e5dd34fc…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1757 bytes, sha256 `458764a024bf03bd…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 451 bytes, sha256 `a4d00b6293c96048…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 555 bytes, sha256 `f9833ceab37478a5…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 770 bytes, sha256 `fb14188be6129488…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 625 bytes, sha256 `b6a10eaf2eb23ffd…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 604 bytes, sha256 `97e1a2e63baef40c…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 524 bytes, sha256 `0a5897df3c03cd1d…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 777 bytes, sha256 `70b253ce6a971f54…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7421 bytes, sha256 `7dc3163b314c3336…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `5e871199e1d9def5…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2217 bytes, sha256 `4a9a92bc59f9943a…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `713b80dc84569962…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `d184404320403411…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32 --run 2`
- **Ran**: 2026-08-20T03:11:53.372Z → 2026-08-20T03:19:12.939Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 469 bytes, sha256 `93b193ce89241635…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `c73d462963c9cb8d…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 318 bytes, sha256 `007462a05d4dcc1a…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `04b76a600a5eca69…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 406 bytes, sha256 `c98561c9143aa591…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1757 bytes, sha256 `bb719a20bcc93ed1…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 451 bytes, sha256 `f8f39e79f9848e0b…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 555 bytes, sha256 `a8a381bbaaf33e50…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 770 bytes, sha256 `a8f13749b6a7a0ac…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 625 bytes, sha256 `af3034f6eda65580…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 604 bytes, sha256 `1bb9254876e86c57…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 523 bytes, sha256 `1c22ca05f7dab644…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 777 bytes, sha256 `999a6bd7c400e4db…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7428 bytes, sha256 `3ca8d5354fde655d…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `3904a060f0def8f8…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2218 bytes, sha256 `f759cda79f1e0ee4…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `2cd1a787062f0e45…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `861a291414d460b4…`
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32 --run 3`
- **Ran**: 2026-08-20T03:19:13.205Z → 2026-08-20T03:26:31.654Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-02-environment.log` — 469 bytes, sha256 `93b193ce89241635…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `655dbb9fa654614a…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 318 bytes, sha256 `2bc8a683e7f5a6c0…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `ea3ceddd549d8ce7…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 406 bytes, sha256 `7801179d9b4c6cd9…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1757 bytes, sha256 `abb0c3e9a2554902…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `67e11dcfa474794a…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 770 bytes, sha256 `a7fcfe9ac5f6b870…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 625 bytes, sha256 `02bd5f50ce746995…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 605 bytes, sha256 `1cfa7be83c453569…`
  - `docs/production-certification/evidence/raw/run3-13-queue-load.log` — 524 bytes, sha256 `46e2e8a13e6186ec…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 777 bytes, sha256 `f822145cd913b0ff…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7416 bytes, sha256 `9fc97cebb2b27cf9…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles.log` — 2174 bytes, sha256 `24f883aaaacb9697…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-17-golden-browser-journey.log` — 2219 bytes, sha256 `39228b1edb222d7f…`
  - `docs/production-certification/evidence/raw/run3-18-worker-readiness.log` — 187 bytes, sha256 `2a88f5505caa1bff…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `3003f7ac385b6c36…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-20T03:26:30.835Z → 2026-08-20T03:26:31.654Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-20T03:20:45.132Z → 2026-08-20T03:23:10.573Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `d75b85ea5d521a7a…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
