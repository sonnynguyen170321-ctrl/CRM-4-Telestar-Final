# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `84e4482` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `84e4482` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `84e4482` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `84e4482` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `84e4482` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `84e4482` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `84e4482` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `84e4482` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `84e4482` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `84e4482` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `84e4482` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `84e4482` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `84e4482` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `84e4482` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `84e4482` | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `84e4482` | **FAIL** | 1 | 20 |
| `EV-RUN-2` | `certification-run` | `84e4482` | **FAIL** | 1 | 20 |
| `EV-RUN-3` | `certification-run` | `84e4482` | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `84e4482` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `84e4482` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `84e4482` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --file C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T21-19-28-785Z.dump`
- **Ran**: 2026-08-19T21:19:38.074Z → 2026-08-19T21:19:54.080Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2098 bytes, sha256 `ec3949415e6e3104…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 414 bytes, sha256 `9c4d476b026fd191…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `4421a02ac643951a…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-19T21:21:39.045Z → 2026-08-19T21:21:49.790Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `e4c6c4aaf66e3e55…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260819t211928 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T21-19-28-785Z.dump`
- **Ran**: 2026-08-19T21:19:55.824Z → 2026-08-19T21:21:31.938Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `914434e3603ce1af…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 434 bytes, sha256 `282af84b75a95615…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2228 bytes, sha256 `b62192d71985fe7e…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-19T21:19:28.653Z → 2026-08-19T21:19:28.653Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-19T21:19:28.653Z → 2026-08-19T21:19:28.653Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-19T21:37:55.967Z → 2026-08-19T21:37:56.501Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `c83c355a23f977ed…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-19T21:38:25.516Z → 2026-08-19T21:39:10.359Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-19T21:40:49.203Z → 2026-08-19T21:41:22.943Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2065 bytes, sha256 `afd83e801a185cf9…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-19T21:40:26.849Z → 2026-08-19T21:40:30.158Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `13e17068f352729e…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-19T21:43:10.241Z → 2026-08-19T21:43:10.241Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230355 bytes, sha256 `fbac69e4972eeb57…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 220403 bytes, sha256 `31623a5e2621814e…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 196889 bytes, sha256 `caa880c71905c5e1…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137438 bytes, sha256 `f0a3c163ce709083…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 122023 bytes, sha256 `6b861c1280c787e1…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 217925 bytes, sha256 `5f87aea62d351378…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 84e4482bf40befe09bfc5824f8fb368f759c9a83 --run 1`
- **Ran**: 2026-08-19T21:22:08.741Z → 2026-08-19T21:29:32.129Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `e9e6a38e127f3039…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 318 bytes, sha256 `36b00d25a5536be0…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `d57828b79198c472…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 365 bytes, sha256 `4ebc182e159b0c29…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1757 bytes, sha256 `1af5f2dfbb90e04a…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 451 bytes, sha256 `82c2c752bfb818ba…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 555 bytes, sha256 `8364d2866ee7f741…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 769 bytes, sha256 `2ab0b8f82ce336b9…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 625 bytes, sha256 `5f8fe28a1a49514a…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 604 bytes, sha256 `bd0ce93ecc98b260…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 524 bytes, sha256 `68b81c9b44bb688d…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 777 bytes, sha256 `dd42b7451bd9cac5…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7371 bytes, sha256 `964987cbecb2b86d…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `e810cd4094ada9c8…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2217 bytes, sha256 `3af24bb6367aba01…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `204f92326860ca9e…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `66e8d557a38ef802…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 84e4482bf40befe09bfc5824f8fb368f759c9a83 --run 2`
- **Ran**: 2026-08-19T21:29:32.416Z → 2026-08-19T21:36:37.467Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `13f23feb3f1227d6…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 318 bytes, sha256 `00f512fd96a8e730…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `b00157c73aa9cfcb…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 365 bytes, sha256 `d3b0c6616589ac42…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1757 bytes, sha256 `d836b696b6efe978…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 451 bytes, sha256 `ebc982b83b7cbfda…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 555 bytes, sha256 `99796e71c128b311…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 770 bytes, sha256 `99b999db4d81d662…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 625 bytes, sha256 `ee3305d623f8fd4c…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 604 bytes, sha256 `134ecdbbbf1d8c96…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 523 bytes, sha256 `3515163b8462f113…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 777 bytes, sha256 `b851458ce28d2da0…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7416 bytes, sha256 `fb30218fa4576ef6…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `9f851865b07f981a…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2219 bytes, sha256 `e4628bbacc1159e0…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `dd9dd72283d53858…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `f3073d90200dcac7…`
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 84e4482bf40befe09bfc5824f8fb368f759c9a83 --run 3`
- **Ran**: 2026-08-19T21:36:37.749Z → 2026-08-19T21:43:38.421Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `90d0c19a616c2819…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 318 bytes, sha256 `749f81961efcdae0…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `c83c355a23f977ed…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 365 bytes, sha256 `64e0ba7077b4eced…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1757 bytes, sha256 `1004cfce43f5b9c2…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `13e17068f352729e…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 770 bytes, sha256 `e9a10ecf8f2b48bb…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 625 bytes, sha256 `e1efe48027945599…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 604 bytes, sha256 `6ae970266d9f3f09…`
  - `docs/production-certification/evidence/raw/run3-13-queue-load.log` — 524 bytes, sha256 `04eae9269027f216…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 777 bytes, sha256 `c057b712e3ff308e…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7372 bytes, sha256 `4e9cdf3091817906…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles.log` — 2174 bytes, sha256 `105c62a6665a2489…`
  - `docs/production-certification/evidence/raw/run3-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-17-golden-browser-journey.log` — 2217 bytes, sha256 `54df0bd680664fd8…`
  - `docs/production-certification/evidence/raw/run3-18-worker-readiness.log` — 187 bytes, sha256 `bc6c99dcdff6e379…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `5747ff47ceec5052…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-19T21:43:37.659Z → 2026-08-19T21:43:38.420Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `84e4482bf40befe09bfc5824f8fb368f759c9a83`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T21:38:05.647Z → 2026-08-19T21:40:26.830Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `bcd127ce430bb808…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
