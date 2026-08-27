# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
**Evidence records**: 42
**Requirements verified**: 107 / 108
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
| `EV-CI-RUN` | `ci-run` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `396d365` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `396d365` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `396d365` | **PASS** | 0 | 3 |
| `EV-DR-RPO` | `dr-rpo` | `396d365` | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `396d365` | **PASS** | 0 | 1 |
| `EV-GATE-03-TYPECHECK` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-04-LINT` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-05-TEST-DISCIPLINE` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-06-MIGRATION-VALIDATION` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-07-DATABASE-INTEGRITY` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-08-VITEST` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-09-REDIS-INTEGRATION` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-10-AI-CERTIFICATION` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-11-EMAIL-SAFETY` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-12-IMPORT-FAULT-MATRIX` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-14-SECURITY-SUITE` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-15-PRODUCTION-BUILD` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
| `EV-GATE-21-COMPOSE-VALIDATION` | `gate` | `9b2b44c` ⚠ | **PASS** | 0 | 1 |
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
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32891125645`
- **Ran**: 2026-08-25T19:42:51Z → 2026-08-25T19:49:11Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32891125645.log` — 30216 bytes, sha256 `f5a67c206dff960c…`
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
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
### `EV-GATE-03-TYPECHECK`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit`
- **Ran**: 2026-08-25T21:40:48.528Z → 2026-08-25T21:41:37.186Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-03-typecheck.log` — 261 bytes, sha256 `12cd7cc1d78f4028…`
### `EV-GATE-04-LINT`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/eslint/bin/eslint.js app components lib context tests workers scripts e2e`
- **Ran**: 2026-08-25T21:41:37.367Z → 2026-08-25T21:42:29.868Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-04-lint.log` — 318 bytes, sha256 `dd176f25bafe0d03…`
### `EV-GATE-05-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-25T21:42:30.027Z → 2026-08-25T21:42:30.344Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-05-test-discipline.log` — 324 bytes, sha256 `0b271ca1e681dae9…`
### `EV-GATE-06-MIGRATION-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-migration-order.mjs`
- **Ran**: 2026-08-25T21:42:30.467Z → 2026-08-25T21:42:30.657Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-06-migration-validation.log` — 337 bytes, sha256 `d147bda4d53a34b5…`
### `EV-GATE-07-DATABASE-INTEGRITY`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs scripts/verify-db-integrity.ts`
- **Ran**: 2026-08-25T21:42:30.781Z → 2026-08-25T21:42:36.770Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-07-database-integrity.log` — 1670 bytes, sha256 `a8668e9c648ef0de…`
### `EV-GATE-08-VITEST`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:44:51.413Z → 2026-08-25T21:50:28.216Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-08-vitest.log` — 458 bytes, sha256 `269a57595920fe76…`
### `EV-GATE-09-REDIS-INTEGRATION`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-25T21:42:36.897Z → 2026-08-25T21:42:42.857Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-09-redis-integration.log` — 547 bytes, sha256 `a178d25363da0478…`
### `EV-GATE-10-AI-CERTIFICATION`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/ai-durable-budget.test.ts tests/ai-stream-governance.test.ts tests/ai-shared-circuit.test.ts tests/ai-capability-routing.test.ts tests/ai-structured-budget.test.ts tests/ai-down-resilience.test.ts`
- **Ran**: 2026-08-25T21:42:42.978Z → 2026-08-25T21:42:59.158Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-10-ai-certification.log` — 8532 bytes, sha256 `a30e2bab5d17cdb7…`
### `EV-GATE-11-EMAIL-SAFETY`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/demo-email-barrier.test.ts tests/email-idempotency.test.ts tests/email-safety.test.ts`
- **Ran**: 2026-08-25T21:42:59.274Z → 2026-08-25T21:43:03.442Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-11-email-safety.log` — 1091 bytes, sha256 `705522f4b3ec3663…`
### `EV-GATE-12-IMPORT-FAULT-MATRIX`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/import-fault-injection.test.ts tests/import-race-stress.test.ts`
- **Ran**: 2026-08-25T21:43:03.564Z → 2026-08-25T21:43:19.945Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-12-import-fault-matrix.log` — 8430 bytes, sha256 `5dc50da0f68811b7…`
### `EV-GATE-14-SECURITY-SUITE`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/tenant-inject.test.ts tests/object-auth-red-team.test.ts tests/mass-assignment.test.ts tests/security-injection.test.ts tests/gitleaks-allowlist.test.ts tests/csp.test.ts tests/login-throttle.test.ts`
- **Ran**: 2026-08-25T21:43:20.072Z → 2026-08-25T21:43:29.642Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-14-security-suite.log` — 2160 bytes, sha256 `123f3a317c694df1…`
### `EV-GATE-15-PRODUCTION-BUILD`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/build.cjs`
- **Ran**: 2026-08-25T21:43:29.765Z → 2026-08-25T21:44:45.152Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-15-production-build.log` — 7408 bytes, sha256 `9a5bde24f43540ed…`
### `EV-GATE-21-COMPOSE-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-production-compose.mjs`
- **Ran**: 2026-08-25T21:44:45.285Z → 2026-08-25T21:44:46.532Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-21-compose-validation.log` — 1413 bytes, sha256 `48e9a92e6e742289…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-27T20:27:49.735Z → 2026-08-27T20:27:50.058Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-05-test-discipline.log` — 324 bytes, sha256 `c055f1574ac48422…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-27T20:28:01.810Z → 2026-08-27T20:31:35.824Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-27T20:31:59.838Z → 2026-08-27T20:32:51.268Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2069 bytes, sha256 `de626b76055e51ca…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-27T20:31:36.017Z → 2026-08-27T20:31:39.270Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-09-redis-integration.log` — 547 bytes, sha256 `1794474e4d42d28f…`
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
- **Ran**: 2026-08-27T20:34:49.929Z → 2026-08-27T20:34:49.929Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 135245 bytes, sha256 `1054b33ca9542670…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 171234 bytes, sha256 `37840763ba6a9514…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 108732 bytes, sha256 `83d8cc5693d86859…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 145259 bytes, sha256 `bdd8f5ff6590aaa1…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 113536 bytes, sha256 `4246303d144b072a…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 169351 bytes, sha256 `644c3d7aaedd951c…`
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
- **Ran**: 2026-08-27T19:52:55.593Z → 2026-08-27T20:09:08.651Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run1-396d365-03-typecheck.log` — 261 bytes, sha256 `f63e5f5d7bf8ad59…`
  - `docs/production-certification/evidence/raw/run1-396d365-04-lint.log` — 318 bytes, sha256 `13b746df0298564f…`
  - `docs/production-certification/evidence/raw/run1-396d365-05-test-discipline.log` — 324 bytes, sha256 `873569c692e98f68…`
  - `docs/production-certification/evidence/raw/run1-396d365-06-migration-validation.log` — 337 bytes, sha256 `0e92bbfcbb8753b1…`
  - `docs/production-certification/evidence/raw/run1-396d365-07-database-integrity.log` — 1669 bytes, sha256 `96fe66761253388c…`
  - `docs/production-certification/evidence/raw/run1-396d365-08-vitest.log` — 458 bytes, sha256 `7d303dc6cbbddb39…`
  - `docs/production-certification/evidence/raw/run1-396d365-09-redis-integration.log` — 547 bytes, sha256 `6cf37c9478ee6743…`
  - `docs/production-certification/evidence/raw/run1-396d365-10-ai-certification.log` — 762 bytes, sha256 `f5e23486ee219f83…`
  - `docs/production-certification/evidence/raw/run1-396d365-11-email-safety.log` — 617 bytes, sha256 `3e68fdfeaa4e22b2…`
  - `docs/production-certification/evidence/raw/run1-396d365-12-import-fault-matrix.log` — 596 bytes, sha256 `31a634ca75e019ea…`
  - `docs/production-certification/evidence/raw/run1-396d365-13-queue-load.log` — 871 bytes, sha256 `b5149eb2c2f3e9d2…`
  - `docs/production-certification/evidence/raw/run1-396d365-14-security-suite.log` — 769 bytes, sha256 `81be64b1f1e9f69c…`
  - `docs/production-certification/evidence/raw/run1-396d365-15-production-build.log` — 7389 bytes, sha256 `51304a55cd949deb…`
  - `docs/production-certification/evidence/raw/run1-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `29fd0acc4e4c216a…`
  - `docs/production-certification/evidence/raw/run1-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-396d365-17-golden-browser-journey.log` — 2216 bytes, sha256 `31c0bc2f8892340a…`
  - `docs/production-certification/evidence/raw/run1-396d365-18-worker-readiness.log` — 187 bytes, sha256 `54a723f911e25dca…`
  - `docs/production-certification/evidence/raw/run1-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run1-396d365-19-docker-build.log` — 21069 bytes, sha256 `11b5c4522ee112ae…`
  - `docs/production-certification/evidence/raw/run1-396d365-20-image-inspection.log` — 275 bytes, sha256 `8639516dd9176ff3…`
  - `docs/production-certification/evidence/raw/run1-396d365-21-compose-validation.log` — 1413 bytes, sha256 `074abaa687e0514c…`
  - `docs/production-certification/evidence/raw/run1-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --run 2`
- **Ran**: 2026-08-27T20:09:35.551Z → 2026-08-27T20:25:44.102Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run2-396d365-03-typecheck.log` — 261 bytes, sha256 `d7c2d2fa49c61056…`
  - `docs/production-certification/evidence/raw/run2-396d365-04-lint.log` — 318 bytes, sha256 `38dbeabe257ed4d4…`
  - `docs/production-certification/evidence/raw/run2-396d365-05-test-discipline.log` — 324 bytes, sha256 `61635be5bb4484fe…`
  - `docs/production-certification/evidence/raw/run2-396d365-06-migration-validation.log` — 337 bytes, sha256 `20e761fd2fea7a2e…`
  - `docs/production-certification/evidence/raw/run2-396d365-07-database-integrity.log` — 1669 bytes, sha256 `bd6aecfbf0af805a…`
  - `docs/production-certification/evidence/raw/run2-396d365-08-vitest.log` — 458 bytes, sha256 `569d113fd255e135…`
  - `docs/production-certification/evidence/raw/run2-396d365-09-redis-integration.log` — 547 bytes, sha256 `cbb428376e147a49…`
  - `docs/production-certification/evidence/raw/run2-396d365-10-ai-certification.log` — 761 bytes, sha256 `fdc1cba8cc66da0d…`
  - `docs/production-certification/evidence/raw/run2-396d365-11-email-safety.log` — 617 bytes, sha256 `502877ea5f1c5e8e…`
  - `docs/production-certification/evidence/raw/run2-396d365-12-import-fault-matrix.log` — 596 bytes, sha256 `30a831994a3ebe20…`
  - `docs/production-certification/evidence/raw/run2-396d365-13-queue-load.log` — 523 bytes, sha256 `0ed9e5fb1172a764…`
  - `docs/production-certification/evidence/raw/run2-396d365-14-security-suite.log` — 769 bytes, sha256 `688ab988214139db…`
  - `docs/production-certification/evidence/raw/run2-396d365-15-production-build.log` — 7393 bytes, sha256 `bf8c55b612482176…`
  - `docs/production-certification/evidence/raw/run2-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `568249daeccd55be…`
  - `docs/production-certification/evidence/raw/run2-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-396d365-17-golden-browser-journey.log` — 2217 bytes, sha256 `730c287ae1dd3b8d…`
  - `docs/production-certification/evidence/raw/run2-396d365-18-worker-readiness.log` — 187 bytes, sha256 `790fdeecc94dc7f7…`
  - `docs/production-certification/evidence/raw/run2-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run2-396d365-19-docker-build.log` — 20868 bytes, sha256 `45e72d1a22e020f5…`
  - `docs/production-certification/evidence/raw/run2-396d365-20-image-inspection.log` — 275 bytes, sha256 `15de4bf4ea62e849…`
  - `docs/production-certification/evidence/raw/run2-396d365-21-compose-validation.log` — 1413 bytes, sha256 `ea77cc0ef36c695f…`
  - `docs/production-certification/evidence/raw/run2-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 396d3652c619c25f8f26005127e9b7291cdaeedf --run 3`
- **Ran**: 2026-08-27T20:26:15.439Z → 2026-08-27T20:43:32.563Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-02-environment.log` — 469 bytes, sha256 `59e33ed1a2956743…`
  - `docs/production-certification/evidence/raw/run3-396d365-03-typecheck.log` — 261 bytes, sha256 `7d15b70a93c04e20…`
  - `docs/production-certification/evidence/raw/run3-396d365-04-lint.log` — 318 bytes, sha256 `b560cf6917296592…`
  - `docs/production-certification/evidence/raw/run3-396d365-05-test-discipline.log` — 324 bytes, sha256 `c055f1574ac48422…`
  - `docs/production-certification/evidence/raw/run3-396d365-06-migration-validation.log` — 337 bytes, sha256 `c985bf9565c356dd…`
  - `docs/production-certification/evidence/raw/run3-396d365-07-database-integrity.log` — 1669 bytes, sha256 `8369603da3b08b6f…`
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
  - `docs/production-certification/evidence/raw/run3-396d365-09-redis-integration.log` — 547 bytes, sha256 `1794474e4d42d28f…`
  - `docs/production-certification/evidence/raw/run3-396d365-10-ai-certification.log` — 762 bytes, sha256 `ac0fa880902b82ac…`
  - `docs/production-certification/evidence/raw/run3-396d365-11-email-safety.log` — 617 bytes, sha256 `2bb1f6eee31bb968…`
  - `docs/production-certification/evidence/raw/run3-396d365-12-import-fault-matrix.log` — 597 bytes, sha256 `007ac88d85beea2a…`
  - `docs/production-certification/evidence/raw/run3-396d365-13-queue-load.log` — 524 bytes, sha256 `93a9ad120a7f961d…`
  - `docs/production-certification/evidence/raw/run3-396d365-14-security-suite.log` — 769 bytes, sha256 `95c5705ae98c4c65…`
  - `docs/production-certification/evidence/raw/run3-396d365-15-production-build.log` — 7391 bytes, sha256 `c4a61b626fc81446…`
  - `docs/production-certification/evidence/raw/run3-396d365-16-playwright-roles.log` — 2174 bytes, sha256 `5c7099bb07296358…`
  - `docs/production-certification/evidence/raw/run3-396d365-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-396d365-17-golden-browser-journey.log` — 2217 bytes, sha256 `0212e4b5737d6d61…`
  - `docs/production-certification/evidence/raw/run3-396d365-18-worker-readiness.log` — 187 bytes, sha256 `cf69764f50d96249…`
  - `docs/production-certification/evidence/raw/run3-396d365-22-health-smoke.log` — 210 bytes, sha256 `c292af6b893e0d2f…`
  - `docs/production-certification/evidence/raw/run3-396d365-19-docker-build.log` — 21072 bytes, sha256 `1cd47f4eb0a9a5ed…`
  - `docs/production-certification/evidence/raw/run3-396d365-20-image-inspection.log` — 275 bytes, sha256 `449e5ed4a3cb1ab3…`
  - `docs/production-certification/evidence/raw/run3-396d365-21-compose-validation.log` — 1413 bytes, sha256 `da49c4e079009a78…`
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
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-27T20:43:26.335Z → 2026-08-27T20:43:32.562Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-23-validator-selftest.log` — 4258 bytes, sha256 `47939774a64e8674…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-27T20:27:52.662Z → 2026-08-27T20:31:35.993Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-396d365-08-vitest.log` — 458 bytes, sha256 `8cd9fa18d98f4518…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
