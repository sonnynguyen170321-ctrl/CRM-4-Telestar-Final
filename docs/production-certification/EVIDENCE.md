# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
**Evidence records**: 14
**Requirements verified**: 95 / 108
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
| `EV-DR-BACKUP` | `dr-backup` | `1fbd7b0` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `1fbd7b0` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `1fbd7b0` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `1fbd7b0` | NOT_EXECUTED | 127 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `1fbd7b0` | BLOCKED_EXTERNAL | 127 | 0 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `1fbd7b0` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | — ⚠ | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `1fbd7b0` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `1fbd7b0` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `1fbd7b0` | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `1fbd7b0` | **PASS** | 0 | 20 |
| `EV-RUN-2` | `certification-run` | `1fbd7b0` | **PASS** | 0 | 20 |
| `EV-RUN-3` | `certification-run` | `1fbd7b0` | **PASS** | 0 | 20 |
| `EV-VITEST` | `vitest` | `1fbd7b0` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --file C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T20-19-22-364Z.dump`
- **Ran**: 2026-08-19T20:19:27.500Z → 2026-08-19T20:19:42.849Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2098 bytes, sha256 `43202b97857aa763…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 414 bytes, sha256 `5caecf5340c14f1f…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 259 bytes, sha256 `52a0eb86af2108e5…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-19T20:21:25.055Z → 2026-08-19T20:21:35.228Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `fe83f7f0652763c7…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260819t201922 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main\.dr-artifacts\telestar_2026-08-19T20-19-22-364Z.dump`
- **Ran**: 2026-08-19T20:19:44.410Z → 2026-08-19T20:21:17.041Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `9a73d3eaeb6ae48f…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 434 bytes, sha256 `d5f86de83e17683d…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2228 bytes, sha256 `0155c00bc9ba1935…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: certification workstation - no container runtime installed
- **Command**: `(not executed) rollback between two immutable image digests`
- **Ran**: 2026-08-19T20:19:22.128Z → 2026-08-19T20:19:22.128Z
- **Exit code**: 127 · **Status**: NOT_EXECUTED
- **Reason**: docker is not installed on this machine, so no image has been built and no digest exists to roll between.
- **Artifacts**: none
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: certification workstation - gcloud CLI not installed
- **Command**: `gcloud sql instances describe telestar-crm-db --project=telestar-crm-final`
- **Ran**: 2026-08-19T20:19:22.128Z → 2026-08-19T20:19:22.128Z
- **Exit code**: 127 · **Status**: BLOCKED_EXTERNAL
- **Reason**: gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.
- **Artifacts**: none
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-19T20:36:50.167Z → 2026-08-19T20:36:50.446Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `33f566f9ee4bffda…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: —
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-19T20:37:18.267Z → 2026-08-19T20:38:04.181Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-19T20:39:28.199Z → 2026-08-19T20:40:01.267Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2066 bytes, sha256 `78cd4a1a419ff2bc…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-19T20:39:06.263Z → 2026-08-19T20:39:09.566Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `32269a12e772cede…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-19T20:41:45.879Z → 2026-08-19T20:41:45.879Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230274 bytes, sha256 `842ef18ba5bdabb6…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 221162 bytes, sha256 `2082cee75d2c8935…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 133589 bytes, sha256 `8d5f3169fb7b0e98…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137755 bytes, sha256 `4a54105168c2bdab…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 121777 bytes, sha256 `ab7449d5492be7cd…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 218674 bytes, sha256 `3e302832c83dacb4…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 1fbd7b00d4a00375ee93f6f46314f10c211535d6 --run 1`
- **Ran**: 2026-08-19T20:21:51.974Z → 2026-08-19T20:28:44.412Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `309251bc01b8c66a…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 318 bytes, sha256 `8cc161b02a8b3bff…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `7fc774017d281616…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 365 bytes, sha256 `616b4825a10e7a35…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1757 bytes, sha256 `22c43a815b6773dd…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 451 bytes, sha256 `dabbae7324bd98d3…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 555 bytes, sha256 `273f26bb13dd05a3…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 770 bytes, sha256 `6fdd360d545d157d…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 625 bytes, sha256 `9e1797a5752e3ee6…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 604 bytes, sha256 `384c171fda016435…`
  - `docs/production-certification/evidence/raw/gate-13-queue-load.log` — 524 bytes, sha256 `5971ced0e84d5fe7…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 777 bytes, sha256 `1059a9d1465b45cc…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7421 bytes, sha256 `219f9df7d8909b30…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles.log` — 2174 bytes, sha256 `16cf2f4cf147e63c…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/gate-17-golden-browser-journey.log` — 2220 bytes, sha256 `00b93ebb327f1249…`
  - `docs/production-certification/evidence/raw/gate-18-worker-readiness.log` — 187 bytes, sha256 `382b48ea8a534f24…`
  - `docs/production-certification/evidence/raw/gate-22-health-smoke.log` — 1165 bytes, sha256 `176ab9a37d8c8e0e…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `e129aefa56d43559…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 1fbd7b00d4a00375ee93f6f46314f10c211535d6 --run 2`
- **Ran**: 2026-08-19T20:28:44.876Z → 2026-08-19T20:35:32.653Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `c35611f371673699…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 318 bytes, sha256 `a45d0fa8b956f8a6…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `89e7bff194dc01a5…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 365 bytes, sha256 `3b7cafc2727cbb06…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1757 bytes, sha256 `d9036a62a755df77…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 451 bytes, sha256 `346f74f03a0ce5fe…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 555 bytes, sha256 `e8e86c90a7feb1bf…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 770 bytes, sha256 `869466e99bff7fb4…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 625 bytes, sha256 `fbb621722f7bc2ab…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 604 bytes, sha256 `cb9341f652b85561…`
  - `docs/production-certification/evidence/raw/gate-13-queue-load.log` — 1257 bytes, sha256 `686fb9851774d2d5…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 777 bytes, sha256 `cf941761183b51cb…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 7416 bytes, sha256 `7aabb2be86dd16c9…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles.log` — 2174 bytes, sha256 `d3ce6c23ae4ae4f9…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/gate-17-golden-browser-journey.log` — 2217 bytes, sha256 `5e0bb83bcf4a5175…`
  - `docs/production-certification/evidence/raw/gate-18-worker-readiness.log` — 187 bytes, sha256 `41c9aae23b7ec65f…`
  - `docs/production-certification/evidence/raw/gate-22-health-smoke.log` — 1165 bytes, sha256 `03e9c1814f6f7971…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `e3148c38514c3edd…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 1fbd7b00d4a00375ee93f6f46314f10c211535d6 --run 3`
- **Ran**: 2026-08-19T20:35:33.030Z → 2026-08-19T20:42:13.685Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-02-environment.log` — 469 bytes, sha256 `f12cf723aecfa458…`
  - `docs/production-certification/evidence/raw/run3-03-typecheck.log` — 261 bytes, sha256 `ca9a747dd5d0f515…`
  - `docs/production-certification/evidence/raw/run3-04-lint.log` — 318 bytes, sha256 `e562aa2c0e2b5336…`
  - `docs/production-certification/evidence/raw/run3-05-test-discipline.log` — 324 bytes, sha256 `33f566f9ee4bffda…`
  - `docs/production-certification/evidence/raw/run3-06-migration-validation.log` — 365 bytes, sha256 `00904d446ed62b3c…`
  - `docs/production-certification/evidence/raw/run3-07-database-integrity.log` — 1757 bytes, sha256 `c1e6b6142299bc05…`
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `075766b7efe460ac…`
  - `docs/production-certification/evidence/raw/run3-09-redis-integration.log` — 555 bytes, sha256 `32269a12e772cede…`
  - `docs/production-certification/evidence/raw/run3-10-ai-certification.log` — 770 bytes, sha256 `e78a908871d7c116…`
  - `docs/production-certification/evidence/raw/run3-11-email-safety.log` — 625 bytes, sha256 `107abaa2de55c271…`
  - `docs/production-certification/evidence/raw/run3-12-import-fault-matrix.log` — 604 bytes, sha256 `a37e20099e458de3…`
  - `docs/production-certification/evidence/raw/gate-13-queue-load.log` — 524 bytes, sha256 `d329f5b864f8b9a0…`
  - `docs/production-certification/evidence/raw/run3-14-security-suite.log` — 777 bytes, sha256 `e4d5ab53549b8fa4…`
  - `docs/production-certification/evidence/raw/run3-15-production-build.log` — 7420 bytes, sha256 `68a0e3174d3029a2…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles.log` — 2174 bytes, sha256 `8303d2388f6caf42…`
  - `docs/production-certification/evidence/raw/gate-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/gate-17-golden-browser-journey.log` — 2219 bytes, sha256 `7aafd13f43d53d6f…`
  - `docs/production-certification/evidence/raw/gate-18-worker-readiness.log` — 187 bytes, sha256 `b8b546a9da6f2119…`
  - `docs/production-certification/evidence/raw/gate-22-health-smoke.log` — 1165 bytes, sha256 `6661bd5e8812e0cf…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `252ede5ef9189606…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-19T20:36:58.266Z → 2026-08-19T20:39:06.245Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-08-vitest.log` — 451 bytes, sha256 `075766b7efe460ac…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
