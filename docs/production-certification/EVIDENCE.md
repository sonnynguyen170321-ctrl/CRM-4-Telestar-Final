# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
**Evidence records**: 42
**Requirements verified**: 108 / 108
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
| Static analysis | `EV-GATE-03-TYPECHECK`, `EV-GATE-04-LINT`, `EV-GATE-05-TEST-DISCIPLINE`, `EV-GATE-06-MIGRATION-VALIDATION`, `EV-GATE-07-DATABASE-INTEGRITY`, `EV-GATE-08-VITEST`, `EV-GATE-09-REDIS-INTEGRATION`, `EV-GATE-10-AI-CERTIFICATION`, `EV-GATE-11-EMAIL-SAFETY`, `EV-GATE-12-IMPORT-FAULT-MATRIX`, `EV-GATE-14-SECURITY-SUITE`, `EV-GATE-15-PRODUCTION-BUILD`, `EV-GATE-21-COMPOSE-VALIDATION`, `EV-GATE-TEST-DISCIPLINE` |
| Production build | `EV-GATE-03-TYPECHECK`, `EV-GATE-04-LINT`, `EV-GATE-05-TEST-DISCIPLINE`, `EV-GATE-06-MIGRATION-VALIDATION`, `EV-GATE-07-DATABASE-INTEGRITY`, `EV-GATE-08-VITEST`, `EV-GATE-09-REDIS-INTEGRATION`, `EV-GATE-10-AI-CERTIFICATION`, `EV-GATE-11-EMAIL-SAFETY`, `EV-GATE-12-IMPORT-FAULT-MATRIX`, `EV-GATE-14-SECURITY-SUITE`, `EV-GATE-15-PRODUCTION-BUILD`, `EV-GATE-21-COMPOSE-VALIDATION`, `EV-GATE-TEST-DISCIPLINE` |
| Database integrity | `EV-GATE-03-TYPECHECK`, `EV-GATE-04-LINT`, `EV-GATE-05-TEST-DISCIPLINE`, `EV-GATE-06-MIGRATION-VALIDATION`, `EV-GATE-07-DATABASE-INTEGRITY`, `EV-GATE-08-VITEST`, `EV-GATE-09-REDIS-INTEGRATION`, `EV-GATE-10-AI-CERTIFICATION`, `EV-GATE-11-EMAIL-SAFETY`, `EV-GATE-12-IMPORT-FAULT-MATRIX`, `EV-GATE-14-SECURITY-SUITE`, `EV-GATE-15-PRODUCTION-BUILD`, `EV-GATE-21-COMPOSE-VALIDATION`, `EV-GATE-TEST-DISCIPLINE` |
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `396d365` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `396d365` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `396d365` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `396d365` | **PASS** | 0 | 1 |
| `EV-BRANCH-PROTECTION` | `branch-governance` | `396d365` | **PASS** | 0 | 2 |
| `EV-CI-RUN` | `ci-run` | `396d365` | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `396d365` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `396d365` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-RPO` | `dr-rpo` | `396d365` | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-03-TYPECHECK` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-04-LINT` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-05-TEST-DISCIPLINE` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-06-MIGRATION-VALIDATION` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-07-DATABASE-INTEGRITY` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-08-VITEST` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-09-REDIS-INTEGRATION` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-10-AI-CERTIFICATION` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-11-EMAIL-SAFETY` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-12-IMPORT-FAULT-MATRIX` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-14-SECURITY-SUITE` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-15-PRODUCTION-BUILD` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-21-COMPOSE-VALIDATION` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `396d365` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `396d365` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `396d365` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `396d365` | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `396d365` | **PASS** | 0 | 4 |
| `EV-RLS-POSTURE` | `rls-posture` | `396d365` | **FAIL** | 1 | 4 |
| `EV-ROLE-BROWSER` | `role-browser` | `396d365` | **PASS** | 0 | 6 |
| `EV-ROLE-MODEL` | `role-model` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-RUN-1` | `certification-run` | `396d365` | **PASS** | 0 | 23 |
| `EV-RUN-2` | `certification-run` | `396d365` | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `396d365` | **PASS** | 0 | 23 |
| `EV-SECURITY-BOUNDARIES` | `security-boundaries` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `396d365` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `396d365` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `396d365` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-BRANCH-PROTECTION`
- **Kind**: `branch-governance`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: GitHub REST API against sonnynguyen170321-ctrl/CRM-4-Telestar-Final from the certification workstation
- **Command**: `node scripts/certification/record-branch-protection.mjs`
- **Ran**: 2026-08-27T19:46:36.838Z → 2026-08-27T19:46:37.736Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/branch-protection-api-readout.log` — 915 bytes, sha256 `d9be7eb977c54587…`
  - `docs/production-certification/evidence/raw/branch-protection-behavioral-proof.log` — 2790 bytes, sha256 `44c5e18353ace61d…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: GitHub Actions
- **Command**: `gh run view 33108408475`
- **Ran**: 2026-08-27T19:26:00Z → 2026-08-27T19:32:19Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-33108408475.log` — 30216 bytes, sha256 `2d0cba85d29a09ec…`
### `EV-DEPLOYED-STATE`
- **Kind**: `deployed-state`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: read-only probe of https://crm.telestar.cloud/api/health from the certification workstation
- **Command**: `node scripts/certification/record-deployed-state.mjs --url https://crm.telestar.cloud/api/health`
- **Ran**: 2026-08-27T19:46:37.906Z → 2026-08-27T19:46:38.487Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/deployed-health-probe.log` — 186 bytes, sha256 `69c5857e7d856120…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-0000D7D7-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-27T20-43-55-936Z.dump`
- **Ran**: 2026-08-27T20:43:59.191Z → 2026-08-27T20:44:01.232Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2013 bytes, sha256 `984247db05c8c5e0…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 437 bytes, sha256 `052f0f0bfafd20e7…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 292 bytes, sha256 `2f6a19a455f370ee…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-27T20:44:36.989Z → 2026-08-27T20:45:00.613Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 6197 bytes, sha256 `d8014cc790f728db…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260827t204355 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-27T20-43-55-936Z.dump`
- **Ran**: 2026-08-27T20:44:02.693Z → 2026-08-27T20:44:17.648Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `4bc80a2832cc406e…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `a02c4c39decd8446…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2132 bytes, sha256 `c91473c7781a806d…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: production (sonnynguyen170321@localhost)
- **Command**: `node scripts/certification/dr-rollback-drill.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --previous 7592278d7e4190ea855cfc39de140299c1faa191`
- **Ran**: 2026-08-27T19:44:16.534Z → 2026-08-27T19:45:42.362Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rollback-deploy-candidate.log` — 4861 bytes, sha256 `deca2da44efac72c…`
  - `docs/production-certification/evidence/raw/dr-rollback-rollback-to-previous.log` — 4867 bytes, sha256 `2f999c206297e1b0…`
  - `docs/production-certification/evidence/raw/dr-rollback-restore-candidate.log` — 4859 bytes, sha256 `7fdec011e5488a1e…`
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: certification workstation - gcloud probe outcome MEASURED
- **Command**: `gcloud sql instances describe telestar-db --project=telestar-crm-final --format=json`
- **Ran**: 2026-08-27T19:46:21.362Z → 2026-08-27T19:46:26.609Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: point-in-time recovery is enabled, so recovery is bounded by transaction-log durability rather than by the backup interval
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rpo-gcloud.log` — 2020 bytes, sha256 `fe235077aa690f96…`
### `EV-EMAIL-EXACTLY-ONCE`
- **Kind**: `email-exactly-once`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: certification workstation - real PostgreSQL; only the provider and the queue are substituted
- **Command**: `node node_modules/vitest/vitest.mjs run tests/email-send-once-invariant.test.ts tests/email-idempotency.test.ts tests/email-worker.test.ts tests/email-safety.test.ts tests/demo-email-barrier.test.ts tests/sequence-worker.test.ts tests/sequence-execute.test.ts`
- **Ran**: 2026-08-25T21:50:57.000Z → 2026-08-25T21:51:12.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/email-exactly-once.log` — 245 bytes, sha256 `c08486466891fe0d…`
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-GATE-03-TYPECHECK`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit`
- **Ran**: 2026-08-27T20:49:40.342Z → 2026-08-27T20:50:20.945Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-03-typecheck.log` — 261 bytes, sha256 `a6f2ea55b17a9a63…`
### `EV-GATE-04-LINT`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/eslint/bin/eslint.js app components lib context tests workers scripts e2e`
- **Ran**: 2026-08-27T20:50:21.182Z → 2026-08-27T20:52:02.940Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-04-lint.log` — 318 bytes, sha256 `788587437be15435…`
### `EV-GATE-05-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-27T20:52:03.077Z → 2026-08-27T20:52:03.416Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-05-test-discipline.log` — 324 bytes, sha256 `224b83947f1c9d15…`
### `EV-GATE-06-MIGRATION-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-migration-order.mjs`
- **Ran**: 2026-08-27T20:52:03.557Z → 2026-08-27T20:52:03.721Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-06-migration-validation.log` — 337 bytes, sha256 `65560c43dd1409b3…`
### `EV-GATE-07-DATABASE-INTEGRITY`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs scripts/verify-db-integrity.ts`
- **Ran**: 2026-08-27T20:52:03.863Z → 2026-08-27T20:52:05.893Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-07-database-integrity.log` — 1669 bytes, sha256 `fa750ef88cf565c1…`
### `EV-GATE-08-VITEST`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T20:52:06.054Z → 2026-08-27T20:54:56.402Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-08-vitest.log` — 458 bytes, sha256 `03a7158ff778704f…`
### `EV-GATE-09-REDIS-INTEGRATION`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-27T20:54:56.592Z → 2026-08-27T20:55:00.199Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-09-redis-integration.log` — 547 bytes, sha256 `f3bd70af29cd2a0a…`
### `EV-GATE-10-AI-CERTIFICATION`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/ai-durable-budget.test.ts tests/ai-stream-governance.test.ts tests/ai-shared-circuit.test.ts tests/ai-capability-routing.test.ts tests/ai-structured-budget.test.ts tests/ai-down-resilience.test.ts`
- **Ran**: 2026-08-27T20:55:00.344Z → 2026-08-27T20:55:08.148Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-10-ai-certification.log` — 762 bytes, sha256 `b3c189f81f0821db…`
### `EV-GATE-11-EMAIL-SAFETY`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/demo-email-barrier.test.ts tests/email-idempotency.test.ts tests/email-safety.test.ts`
- **Ran**: 2026-08-27T20:55:08.319Z → 2026-08-27T20:55:10.748Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-11-email-safety.log` — 617 bytes, sha256 `20ec885594e27ecf…`
### `EV-GATE-12-IMPORT-FAULT-MATRIX`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/import-fault-injection.test.ts tests/import-race-stress.test.ts`
- **Ran**: 2026-08-27T20:55:10.892Z → 2026-08-27T20:55:17.522Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-12-import-fault-matrix.log` — 596 bytes, sha256 `99858fda213a11a4…`
### `EV-GATE-14-SECURITY-SUITE`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/tenant-inject.test.ts tests/object-auth-red-team.test.ts tests/mass-assignment.test.ts tests/security-injection.test.ts tests/gitleaks-allowlist.test.ts tests/csp.test.ts tests/login-throttle.test.ts`
- **Ran**: 2026-08-27T20:55:17.656Z → 2026-08-27T20:55:21.301Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-14-security-suite.log` — 769 bytes, sha256 `570fbc32e1e28684…`
### `EV-GATE-15-PRODUCTION-BUILD`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/build.cjs`
- **Ran**: 2026-08-27T20:55:21.442Z → 2026-08-27T20:56:54.141Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-15-production-build.log` — 7393 bytes, sha256 `c8f0edcd9e3dc4e1…`
### `EV-GATE-21-COMPOSE-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-production-compose.mjs`
- **Ran**: 2026-08-27T20:56:54.356Z → 2026-08-27T20:56:55.275Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-21-compose-validation.log` — 1413 bytes, sha256 `e072f4af00c1d063…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-27T22:29:44.733Z → 2026-08-27T22:29:45.074Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-05-test-discipline.log` — 324 bytes, sha256 `c4feda9de72d4658…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-27T22:29:57.671Z → 2026-08-27T22:33:58.327Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-27T22:34:21.860Z → 2026-08-27T22:35:30.919Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2074 bytes, sha256 `94ba041b2fc40a9d…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-27T22:33:58.653Z → 2026-08-27T22:34:02.144Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-09-redis-integration.log` — 547 bytes, sha256 `05cc3d0adcb217ea…`
### `EV-RELEASE-IDENTITY`
- **Kind**: `release-identity`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: read-only observation from the certification workstation: container registry, GitHub API, live health endpoint
- **Command**: `node scripts/certification/verify-release-identity.mjs --image sha256:0b0f49774e3b64d2d77c0a682a3b2fb52ed51762596669ef4e2f21a1ffa2a9eb --ci-run 33108408475 --url https://crm.telestar.cloud/api/health --via "ssh -i /c/Users/admin/.ssh/google_compute_engine -o BatchMode=yes -o ConnectTimeout=25 -p 2223 sonnynguyen170321@localhost"`
- **Ran**: 2026-08-27T19:50:19.049Z → 2026-08-27T19:50:29.244Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/release-identity-imagetools.log` — 14926 bytes, sha256 `1249cf5e60d780cf…`
  - `docs/production-certification/evidence/raw/release-identity-ci-run.log` — 184 bytes, sha256 `7208c87529e0e989…`
  - `docs/production-certification/evidence/raw/release-identity-health.log` — 234 bytes, sha256 `864cc90228c666ea…`
  - `docs/production-certification/evidence/raw/deployment-host-probe-396d365.log` — 745 bytes, sha256 `391aef325ffb77c9…`
### `EV-RLS-POSTURE`
- **Kind**: `rls-posture`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: certification workstation, local PostgreSQL 16; each script builds and drops its own throwaway database and roles
- **Command**: `node scripts/verify-rls.mjs; node scripts/verify-rls-app-paths.mjs; node scripts/verify-rls-enablement.mjs; node scripts/verify-rls-live.mjs`
- **Ran**: 2026-08-27T19:49:01.986Z → 2026-08-27T19:49:32.398Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Reason**: DB_RLS_ENFORCED appears in no environment file and no compose file, and the production database carries no policies: 69 public tables, 0 with rowsecurity, 0 policies, and no migration containing ENABLE ROW LEVEL SECURITY. Production tenant isolation rests on the application-layer Prisma extension alone. The database-level layer is built and proven to work; applying it is an infrastructure decision (TEL-P1-038).
- **Artifacts**:
  - `docs/production-certification/evidence/raw/rls-verify-rls.log` — 1671 bytes, sha256 `14ce77edc1986a4c…`
  - `docs/production-certification/evidence/raw/rls-verify-rls-app-paths.log` — 2212 bytes, sha256 `5cbd378e7cd92bd8…`
  - `docs/production-certification/evidence/raw/rls-verify-rls-enablement.log` — 1349 bytes, sha256 `c4d1b5fefd4564e3…`
  - `docs/production-certification/evidence/raw/rls-verify-rls-live.log` — 832 bytes, sha256 `9ff2b3c32eaecb65…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-27T22:37:19.892Z → 2026-08-27T22:37:19.892Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 135626 bytes, sha256 `4a24913a4cedde07…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 171717 bytes, sha256 `d8adec0ddc990798…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 172268 bytes, sha256 `1b512b418f6191f1…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 85183 bytes, sha256 `fca024fda0f03f63…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 124261 bytes, sha256 `2f6293039b4ca4fe…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 169844 bytes, sha256 `9ac33d52a29db696…`
### `EV-ROLE-MODEL`
- **Kind**: `role-model`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: certification workstation - real PostgreSQL
- **Command**: `vitest run tests/role-journeys tests/phase-9-role-surfaces tests/floor-manager-administration tests/leadgen tests/leadgen-redesign tests/ai-briefing-scope tests/client-report-scope tests/certification-role-evidence`
- **Ran**: 2026-08-25T21:51:20.000Z → 2026-08-25T21:51:32.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-model-suites.log` — 275 bytes, sha256 `d4ed710993d6be2c…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --run 1`
- **Ran**: 2026-08-27T21:51:00.570Z → 2026-08-27T22:09:20.669Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run1-396d365-03-typecheck.log` — 261 bytes, sha256 `b13cd411d96a2aea…`
  - `docs/production-certification/evidence/raw/run1-396d365-04-lint.log` — 318 bytes, sha256 `ff8fdee6ec226c10…`
  - `docs/production-certification/evidence/raw/run1-396d365-05-test-discipline.log` — 324 bytes, sha256 `5c7242a7427069fe…`
  - `docs/production-certification/evidence/raw/run1-396d365-06-migration-validation.log` — 337 bytes, sha256 `4dd41781ced70bad…`
  - `docs/production-certification/evidence/raw/run1-396d365-07-database-integrity.log` — 1669 bytes, sha256 `b08f475ea491ebd3…`
  - `docs/production-certification/evidence/raw/run1-396d365-08-vitest.log` — 458 bytes, sha256 `09f16bd644e35d2b…`
  - `docs/production-certification/evidence/raw/run1-396d365-09-redis-integration.log` — 547 bytes, sha256 `799a9bca390f1938…`
  - `docs/production-certification/evidence/raw/run1-396d365-10-ai-certification.log` — 762 bytes, sha256 `24a9ab4f01420131…`
  - `docs/production-certification/evidence/raw/run1-396d365-11-email-safety.log` — 617 bytes, sha256 `e61ca329a672cf85…`
  - `docs/production-certification/evidence/raw/run1-396d365-12-import-fault-matrix.log` — 597 bytes, sha256 `2bc24132ebc3d74b…`
  - `docs/production-certification/evidence/raw/run1-396d365-13-queue-load.log` — 526 bytes, sha256 `7c60052f73aaf20f…`
  - `docs/production-certification/evidence/raw/run1-396d365-14-security-suite.log` — 769 bytes, sha256 `fdd8cbb6b01e6774…`
  - `docs/production-certification/evidence/raw/run1-396d365-15-production-build.log` — 7396 bytes, sha256 `711b5fb610868bc3…`
  - `docs/production-certification/evidence/raw/run1-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `0da1a9edc6fe0c49…`
  - `docs/production-certification/evidence/raw/run1-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-396d365-17-golden-browser-journey.log` — 2219 bytes, sha256 `afec24f014db28f7…`
  - `docs/production-certification/evidence/raw/run1-396d365-18-worker-readiness.log` — 187 bytes, sha256 `b8f6b245b215c4a9…`
  - `docs/production-certification/evidence/raw/run1-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run1-396d365-19-docker-build.log` — 20944 bytes, sha256 `05142b66a9bc862c…`
  - `docs/production-certification/evidence/raw/run1-396d365-20-image-inspection.log` — 275 bytes, sha256 `61ec0103cb5e2a4d…`
  - `docs/production-certification/evidence/raw/run1-396d365-21-compose-validation.log` — 1413 bytes, sha256 `ab36471b16506604…`
  - `docs/production-certification/evidence/raw/run1-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --run 2`
- **Ran**: 2026-08-27T22:09:26.390Z → 2026-08-27T22:27:50.844Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run2-396d365-03-typecheck.log` — 261 bytes, sha256 `34660afeac4c0fa3…`
  - `docs/production-certification/evidence/raw/run2-396d365-04-lint.log` — 318 bytes, sha256 `1e4ffd2ad2bc34d0…`
  - `docs/production-certification/evidence/raw/run2-396d365-05-test-discipline.log` — 324 bytes, sha256 `72990de0c93e24a7…`
  - `docs/production-certification/evidence/raw/run2-396d365-06-migration-validation.log` — 337 bytes, sha256 `fc527ae8cc22caf6…`
  - `docs/production-certification/evidence/raw/run2-396d365-07-database-integrity.log` — 1669 bytes, sha256 `973b0ca882f7d343…`
  - `docs/production-certification/evidence/raw/run2-396d365-08-vitest.log` — 458 bytes, sha256 `f8044f845b3020d1…`
  - `docs/production-certification/evidence/raw/run2-396d365-09-redis-integration.log` — 547 bytes, sha256 `a72fef3e0d8f1a74…`
  - `docs/production-certification/evidence/raw/run2-396d365-10-ai-certification.log` — 762 bytes, sha256 `7073e27e42150922…`
  - `docs/production-certification/evidence/raw/run2-396d365-11-email-safety.log` — 617 bytes, sha256 `ee33b184c57eaf0c…`
  - `docs/production-certification/evidence/raw/run2-396d365-12-import-fault-matrix.log` — 597 bytes, sha256 `ff08575545998c1e…`
  - `docs/production-certification/evidence/raw/run2-396d365-13-queue-load.log` — 525 bytes, sha256 `25e69d86cf86357f…`
  - `docs/production-certification/evidence/raw/run2-396d365-14-security-suite.log` — 769 bytes, sha256 `f7fdf4c729351b3a…`
  - `docs/production-certification/evidence/raw/run2-396d365-15-production-build.log` — 7396 bytes, sha256 `8001e212095f4a71…`
  - `docs/production-certification/evidence/raw/run2-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `2235b9ca8e5d65a6…`
  - `docs/production-certification/evidence/raw/run2-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-396d365-17-golden-browser-journey.log` — 2219 bytes, sha256 `0d77a295079bf085…`
  - `docs/production-certification/evidence/raw/run2-396d365-18-worker-readiness.log` — 187 bytes, sha256 `a8ab37a8ecc8ca4b…`
  - `docs/production-certification/evidence/raw/run2-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run2-396d365-19-docker-build.log` — 21399 bytes, sha256 `9cf0e607e72934a3…`
  - `docs/production-certification/evidence/raw/run2-396d365-20-image-inspection.log` — 275 bytes, sha256 `4aeb62edba5769ce…`
  - `docs/production-certification/evidence/raw/run2-396d365-21-compose-validation.log` — 1413 bytes, sha256 `ccaed69572fa4077…`
  - `docs/production-certification/evidence/raw/run2-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --run 3`
- **Ran**: 2026-08-27T22:27:56.530Z → 2026-08-27T22:46:00.544Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run3-396d365-03-typecheck.log` — 261 bytes, sha256 `f605d02afb397e06…`
  - `docs/production-certification/evidence/raw/run3-396d365-04-lint.log` — 318 bytes, sha256 `235e64cbe35ce798…`
  - `docs/production-certification/evidence/raw/run3-396d365-05-test-discipline.log` — 324 bytes, sha256 `c4feda9de72d4658…`
  - `docs/production-certification/evidence/raw/run3-396d365-06-migration-validation.log` — 337 bytes, sha256 `bd7d5ef2b37126d8…`
  - `docs/production-certification/evidence/raw/run3-396d365-07-database-integrity.log` — 1669 bytes, sha256 `5b1eed6e9d162143…`
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
  - `docs/production-certification/evidence/raw/run3-396d365-09-redis-integration.log` — 547 bytes, sha256 `05cc3d0adcb217ea…`
  - `docs/production-certification/evidence/raw/run3-396d365-10-ai-certification.log` — 762 bytes, sha256 `c7d9002a67b81502…`
  - `docs/production-certification/evidence/raw/run3-396d365-11-email-safety.log` — 617 bytes, sha256 `eb4636d9a7de05ad…`
  - `docs/production-certification/evidence/raw/run3-396d365-12-import-fault-matrix.log` — 597 bytes, sha256 `46914201f612e039…`
  - `docs/production-certification/evidence/raw/run3-396d365-13-queue-load.log` — 781 bytes, sha256 `1d087db083e1abb8…`
  - `docs/production-certification/evidence/raw/run3-396d365-14-security-suite.log` — 769 bytes, sha256 `e07e7df8ee637e01…`
  - `docs/production-certification/evidence/raw/run3-396d365-15-production-build.log` — 7350 bytes, sha256 `d5efe6863b339ffd…`
  - `docs/production-certification/evidence/raw/run3-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `e5e86f6bf0428a2f…`
  - `docs/production-certification/evidence/raw/run3-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-396d365-17-golden-browser-journey.log` — 2218 bytes, sha256 `d2075a1a997423c4…`
  - `docs/production-certification/evidence/raw/run3-396d365-18-worker-readiness.log` — 187 bytes, sha256 `14d7f46c23a438d0…`
  - `docs/production-certification/evidence/raw/run3-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run3-396d365-19-docker-build.log` — 21019 bytes, sha256 `62a3b7d9ae46becd…`
  - `docs/production-certification/evidence/raw/run3-396d365-20-image-inspection.log` — 275 bytes, sha256 `8245c3d6957c5150…`
  - `docs/production-certification/evidence/raw/run3-396d365-21-compose-validation.log` — 1413 bytes, sha256 `f5a0da266c7da058…`
  - `docs/production-certification/evidence/raw/run3-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-SECURITY-BOUNDARIES`
- **Kind**: `security-boundaries`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: certification workstation - real PostgreSQL; gitleaks v8.28.0 in docker
- **Command**: `vitest run (13 security suites); docker run zricethezav/gitleaks:v8.28.0 detect --config=.gitleaks.toml --exit-code 1`
- **Ran**: 2026-08-25T21:51:38.000Z → 2026-08-25T21:51:55.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/security-boundaries.log` — 490 bytes, sha256 `0025d8c71eee0382…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-27T22:45:52.666Z → 2026-08-27T22:46:00.543Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T22:29:47.849Z → 2026-08-27T22:33:58.628Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `a137810a860e7811…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
