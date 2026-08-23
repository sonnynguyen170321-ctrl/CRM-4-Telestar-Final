# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `12ea8ae4791ad0c79fb6a1403475015dc6acb399`
**Evidence records**: 23
**Requirements verified**: 4 / 108
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `12ea8ae` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `12ea8ae` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `12ea8ae` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-DR-RPO` | `dr-rpo` | `12ea8ae` | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `fa3a54b` ⚠ | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `9fa36d3` ⚠ | **PASS** | 0 | 0 |
| `EV-ROLE-BROWSER` | `role-browser` | `fa3a54b` ⚠ | **PASS** | 0 | 6 |
| `EV-RUN-1` | `certification-run` | `fa3a54b` ⚠ | **PASS** | 0 | 23 |
| `EV-RUN-2` | `certification-run` | `fa3a54b` ⚠ | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `daa8ffb` ⚠ | **FAIL** | 1 | 20 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `fa3a54b` ⚠ | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32639980424`
- **Ran**: 2026-08-23T12:38:42Z → 2026-08-23T12:44:53Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32639980424.log` — 29927 bytes, sha256 `b574c029b6d41b74…`
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
- **Ran**: 2026-08-23T14:47:55.984Z → 2026-08-23T14:48:09.586Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 4641 bytes, sha256 `f7ef56e927ff1abc…`
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
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-23T13:23:40.959Z → 2026-08-23T13:23:41.740Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `69762cd999b574b4…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-23T13:24:05.779Z → 2026-08-23T13:24:52.142Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-23T13:28:18.604Z → 2026-08-23T13:28:47.421Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2070 bytes, sha256 `c9f16faa3b7a52c1…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-23T13:27:44.800Z → 2026-08-23T13:27:49.060Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 547 bytes, sha256 `fb9db0e4dd38d0e5…`
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
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-23T13:31:51.051Z → 2026-08-23T13:31:51.051Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 230320 bytes, sha256 `523befec6c750a17…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 220283 bytes, sha256 `c34c5403fee0538f…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 387422 bytes, sha256 `edeee760aad37e26…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 139153 bytes, sha256 `22120c018ed6c562…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 119415 bytes, sha256 `71bb4f922f45fa5a…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 217815 bytes, sha256 `0bd3a5eff9db75b7…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb --run 1`
- **Ran**: 2026-08-23T12:48:54.499Z → 2026-08-23T13:13:42.477Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run1-03-typecheck.log` — 261 bytes, sha256 `9a0a4703597cc75c…`
  - `docs/production-certification/evidence/raw/run1-04-lint.log` — 318 bytes, sha256 `315e2cddec6a6cef…`
  - `docs/production-certification/evidence/raw/run1-05-test-discipline.log` — 324 bytes, sha256 `f83276893b1f4a21…`
  - `docs/production-certification/evidence/raw/run1-06-migration-validation.log` — 337 bytes, sha256 `d2fd72125aa5493b…`
  - `docs/production-certification/evidence/raw/run1-07-database-integrity.log` — 1635 bytes, sha256 `0f50a20610af6395…`
  - `docs/production-certification/evidence/raw/run1-08-vitest.log` — 443 bytes, sha256 `10c4ec061577f213…`
  - `docs/production-certification/evidence/raw/run1-09-redis-integration.log` — 547 bytes, sha256 `b04bf59515cc245f…`
  - `docs/production-certification/evidence/raw/run1-10-ai-certification.log` — 762 bytes, sha256 `61fdd38b5821fc78…`
  - `docs/production-certification/evidence/raw/run1-11-email-safety.log` — 617 bytes, sha256 `e189a95145a81e26…`
  - `docs/production-certification/evidence/raw/run1-12-import-fault-matrix.log` — 596 bytes, sha256 `0dbf51f314ddb784…`
  - `docs/production-certification/evidence/raw/run1-13-queue-load.log` — 525 bytes, sha256 `1c788a84cdaa82e0…`
  - `docs/production-certification/evidence/raw/run1-14-security-suite.log` — 769 bytes, sha256 `bf2bc8df537f002f…`
  - `docs/production-certification/evidence/raw/run1-15-production-build.log` — 7395 bytes, sha256 `15dbcb2af6ecafb1…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles.log` — 2174 bytes, sha256 `1f862b7329808044…`
  - `docs/production-certification/evidence/raw/run1-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-17-golden-browser-journey.log` — 2220 bytes, sha256 `83d74d92eb807c05…`
  - `docs/production-certification/evidence/raw/run1-18-worker-readiness.log` — 187 bytes, sha256 `1e3ddfd3d914ef8e…`
  - `docs/production-certification/evidence/raw/run1-22-health-smoke.log` — 210 bytes, sha256 `d6c3e3ef2b51ba97…`
  - `docs/production-certification/evidence/raw/run1-19-docker-build.log` — 21318 bytes, sha256 `1d796b15c691ed54…`
  - `docs/production-certification/evidence/raw/run1-20-image-inspection.log` — 275 bytes, sha256 `00670c65bc1aa998…`
  - `docs/production-certification/evidence/raw/run1-21-compose-validation.log` — 1413 bytes, sha256 `0ccba4d1ee0f50dd…`
  - `docs/production-certification/evidence/raw/run1-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb --run 2`
- **Ran**: 2026-08-23T13:20:27.637Z → 2026-08-23T13:55:42.369Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run2-03-typecheck.log` — 261 bytes, sha256 `3093d842b6aa3e69…`
  - `docs/production-certification/evidence/raw/run2-04-lint.log` — 318 bytes, sha256 `dcc2ed782b0988f5…`
  - `docs/production-certification/evidence/raw/run2-05-test-discipline.log` — 324 bytes, sha256 `69762cd999b574b4…`
  - `docs/production-certification/evidence/raw/run2-06-migration-validation.log` — 337 bytes, sha256 `6f0dd31d265bde88…`
  - `docs/production-certification/evidence/raw/run2-07-database-integrity.log` — 1635 bytes, sha256 `d83113e294a617d6…`
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
  - `docs/production-certification/evidence/raw/run2-09-redis-integration.log` — 547 bytes, sha256 `fb9db0e4dd38d0e5…`
  - `docs/production-certification/evidence/raw/run2-10-ai-certification.log` — 763 bytes, sha256 `55049d0ed48459b1…`
  - `docs/production-certification/evidence/raw/run2-11-email-safety.log` — 617 bytes, sha256 `34a4914336364658…`
  - `docs/production-certification/evidence/raw/run2-12-import-fault-matrix.log` — 598 bytes, sha256 `f55573f861a7b211…`
  - `docs/production-certification/evidence/raw/run2-13-queue-load.log` — 524 bytes, sha256 `85e2c8195890f82a…`
  - `docs/production-certification/evidence/raw/run2-14-security-suite.log` — 769 bytes, sha256 `1d190ea68e726984…`
  - `docs/production-certification/evidence/raw/run2-15-production-build.log` — 8257 bytes, sha256 `15d758e69ed52878…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles.log` — 2174 bytes, sha256 `8a82fc157d6187e2…`
  - `docs/production-certification/evidence/raw/run2-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-17-golden-browser-journey.log` — 2218 bytes, sha256 `0eefa60749b91c3e…`
  - `docs/production-certification/evidence/raw/run2-18-worker-readiness.log` — 187 bytes, sha256 `bdaef602f737905c…`
  - `docs/production-certification/evidence/raw/run2-22-health-smoke.log` — 210 bytes, sha256 `d6c3e3ef2b51ba97…`
  - `docs/production-certification/evidence/raw/run2-19-docker-build.log` — 20619 bytes, sha256 `55101dc153aff721…`
  - `docs/production-certification/evidence/raw/run2-20-image-inspection.log` — 275 bytes, sha256 `51e12416c9f9bb71…`
  - `docs/production-certification/evidence/raw/run2-21-compose-validation.log` — 1413 bytes, sha256 `c12904ed70af16f4…`
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
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-23T13:55:38.666Z → 2026-08-23T13:55:42.368Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-23T13:23:47.596Z → 2026-08-23T13:27:44.760Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-08-vitest.log` — 443 bytes, sha256 `1c0fea1d5e3085e7…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
