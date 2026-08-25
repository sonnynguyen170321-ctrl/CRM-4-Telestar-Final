# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
**Evidence records**: 42
**Requirements verified**: 108 / 108
**Verdict**: GO

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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-BRANCH-PROTECTION` | `branch-governance` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `9b2b44c` | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `9b2b44c` | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-DR-RPO` | `dr-rpo` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-03-TYPECHECK` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-04-LINT` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-05-TEST-DISCIPLINE` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-06-MIGRATION-VALIDATION` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-07-DATABASE-INTEGRITY` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-08-VITEST` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-09-REDIS-INTEGRATION` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-10-AI-CERTIFICATION` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-11-EMAIL-SAFETY` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-12-IMPORT-FAULT-MATRIX` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-14-SECURITY-SUITE` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-15-PRODUCTION-BUILD` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-21-COMPOSE-VALIDATION` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `9b2b44c` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `9b2b44c` | **PASS** | 0 | 0 |
| `EV-RLS-POSTURE` | `rls-posture` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `9b2b44c` | **PASS** | 0 | 6 |
| `EV-ROLE-MODEL` | `role-model` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-RUN-1` | `certification-run` | `9b2b44c` | **PASS** | 0 | 23 |
| `EV-RUN-2` | `certification-run` | `9b2b44c` | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `9b2b44c` | **PASS** | 0 | 23 |
| `EV-SECURITY-BOUNDARIES` | `security-boundaries` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `9b2b44c` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `9b2b44c` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
### `EV-BRANCH-PROTECTION`
- **Kind**: `branch-governance`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: GitHub REST API and git push against sonnynguyen170321-ctrl/CRM-4-Telestar-Final from the certification workstation
- **Command**: `gh api -X PUT .../branches/main/protection; gh pr create; gh api -X PUT .../pulls/111/merge; git push origin main`
- **Ran**: 2026-08-25T21:50:00.000Z → 2026-08-25T21:51:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: read-only probe of the live production health endpoint from the certification workstation
- **Command**: `curl -s https://crm.telestar.cloud/api/health`
- **Ran**: 2026-08-25T21:50:00.000Z → 2026-08-25T21:50:01.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/deployed-health-probe.log` — 211 bytes, sha256 `ca426bebb525f481…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-0001FF27-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-25T19-53-41-153Z.dump`
- **Ran**: 2026-08-25T19:53:43.845Z → 2026-08-25T19:53:45.031Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 2014 bytes, sha256 `5172f0ce37dcfccb…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 437 bytes, sha256 `3d4bf6f203ad04e5…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 292 bytes, sha256 `761720d8f52e0d2d…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-25T19:53:57.981Z → 2026-08-25T19:54:09.990Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 6199 bytes, sha256 `dc22187ca3818d75…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260825t195341 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-25T19-53-41-153Z.dump`
- **Ran**: 2026-08-25T19:53:45.615Z → 2026-08-25T19:53:52.038Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `c8537eabc1791936…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `3ab4ca3d7aadf095…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2133 bytes, sha256 `3953e03b08682acb…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: telestar-crm-vm / docker compose / GCE ubuntu-2204-lts
- **Command**: `scripts/deploy.sh + scripts/rollback.sh, observed over three phases`
- **Ran**: 2026-08-25T19:53:00.000Z → 2026-08-25T19:54:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rollback-c7bf639.log` — 565 bytes, sha256 `9d8263dd1e442d1a…`
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: certification workstation - gcloud probe outcome MEASURED
- **Command**: `gcloud sql instances describe telestar-db --project=telestar-crm-final --format=json`
- **Ran**: 2026-08-25T21:39:52.641Z → 2026-08-25T21:39:59.127Z
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-25T21:22:44.076Z → 2026-08-25T21:22:44.391Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-05-test-discipline.log` — 324 bytes, sha256 `d3129b4a5f4dc231…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-25T21:22:59.969Z → 2026-08-25T21:24:32.904Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-25T21:28:19.285Z → 2026-08-25T21:29:19.566Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2075 bytes, sha256 `66b2ed377faf2fc5…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-25T21:27:33.884Z → 2026-08-25T21:27:39.245Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-09-redis-integration.log` — 547 bytes, sha256 `38d2d8bf0dcd6f3f…`
### `EV-RELEASE-IDENTITY`
- **Kind**: `release-identity`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / deploy host
- **Command**: `docker buildx imagetools inspect; docker inspect; curl /api/health`
- **Ran**: 2026-08-25T21:39:18.398Z → 2026-08-25T21:39:18.403Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**: none
### `EV-RLS-POSTURE`
- **Kind**: `rls-posture`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: certification workstation - local PostgreSQL 16; each script builds its own throwaway database and roles
- **Command**: `node scripts/verify-rls.mjs; node scripts/verify-rls-app-paths.mjs; node scripts/verify-rls-enablement.mjs; node scripts/verify-rls-live.mjs`
- **Ran**: 2026-08-25T21:50:00.000Z → 2026-08-25T21:51:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: DB_RLS_ENFORCED appears in no environment file and no compose file, so database-level RLS is NOT enforced in production. Production tenant isolation rests on the application-layer Prisma extension. DB-level RLS is available and now proven to work; enabling it is a separate infrastructure decision.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/rls-posture-gates.log` — 4850 bytes, sha256 `df6073d9ad2ccda1…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-25T21:31:16.776Z → 2026-08-25T21:31:16.776Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 151137 bytes, sha256 `9fd26a9c2f32f038…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 219240 bytes, sha256 `3c0f0059c1485004…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 124929 bytes, sha256 `d30f97540d825fe6…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137572 bytes, sha256 `8ab44585b053e195…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 120196 bytes, sha256 `159a972008c31200…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 216812 bytes, sha256 `1e8ede4210e4c12e…`
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 9b2b44c9f0987139e2f48ee21b14ec36e10690a8 --run 1`
- **Ran**: 2026-08-25T20:41:52.111Z → 2026-08-25T21:00:15.101Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-9b2b44c-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-03-typecheck.log` — 261 bytes, sha256 `2769fa55cd3281d0…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-04-lint.log` — 318 bytes, sha256 `d7660dd48c0368c0…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-05-test-discipline.log` — 324 bytes, sha256 `38e42516f0045895…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-06-migration-validation.log` — 337 bytes, sha256 `c6821f319f4a3225…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-07-database-integrity.log` — 1670 bytes, sha256 `3768189a2987ab4c…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-08-vitest.log` — 458 bytes, sha256 `be272968c5c3c38a…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-09-redis-integration.log` — 547 bytes, sha256 `5567f8f47868f6c6…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-10-ai-certification.log` — 8531 bytes, sha256 `7b6b10b8ee5525db…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-11-email-safety.log` — 1091 bytes, sha256 `bdc02118512d5935…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-12-import-fault-matrix.log` — 8692 bytes, sha256 `bcf1c6809aa32de4…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-13-queue-load.log` — 4636 bytes, sha256 `00d8538d4ecfdde7…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-14-security-suite.log` — 2159 bytes, sha256 `2770726003c75f34…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-15-production-build.log` — 7398 bytes, sha256 `ef92b77f7b1f06c2…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-16-playwright-roles.log` — 2174 bytes, sha256 `709372bfa37479bb…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-17-golden-browser-journey.log` — 2219 bytes, sha256 `f0e0d5fb76ccfadf…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-18-worker-readiness.log` — 187 bytes, sha256 `6178f5bd85ed7e38…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-22-health-smoke.log` — 210 bytes, sha256 `4ebf23d8d1d3ece3…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-19-docker-build.log` — 20828 bytes, sha256 `16e65ae1666d83e4…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-20-image-inspection.log` — 275 bytes, sha256 `2998d148c1e81c9a…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-21-compose-validation.log` — 1413 bytes, sha256 `ea6c2b73c137620e…`
  - `docs/production-certification/evidence/raw/run1-9b2b44c-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 9b2b44c9f0987139e2f48ee21b14ec36e10690a8 --run 2`
- **Ran**: 2026-08-25T21:00:36.254Z → 2026-08-25T21:20:37.987Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run2-9b2b44c-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-03-typecheck.log` — 261 bytes, sha256 `b89c624f6060036c…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-04-lint.log` — 318 bytes, sha256 `a8941b9d4fb5aff2…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-05-test-discipline.log` — 324 bytes, sha256 `c498fcf0a5259c75…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-06-migration-validation.log` — 337 bytes, sha256 `a3ca5476ed7c5961…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-07-database-integrity.log` — 1670 bytes, sha256 `b4d227a6b72ea434…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f4c43d347d4c6296…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-09-redis-integration.log` — 547 bytes, sha256 `88a6a96d5f4a6e31…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-10-ai-certification.log` — 8775 bytes, sha256 `42321d5144894d80…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-11-email-safety.log` — 1091 bytes, sha256 `3a381a9e20ad2aa4…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-12-import-fault-matrix.log` — 8160 bytes, sha256 `61aaee604f5e7473…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-13-queue-load.log` — 4899 bytes, sha256 `25082f9cbe691e64…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-14-security-suite.log` — 2411 bytes, sha256 `7e90795734c934b1…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-15-production-build.log` — 7393 bytes, sha256 `aeb7a561a03c592d…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-16-playwright-roles.log` — 2174 bytes, sha256 `17089c3028ab5854…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-17-golden-browser-journey.log` — 2218 bytes, sha256 `988e8f90df6331ab…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-18-worker-readiness.log` — 187 bytes, sha256 `3638f287075980ce…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-22-health-smoke.log` — 210 bytes, sha256 `4ebf23d8d1d3ece3…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-19-docker-build.log` — 20233 bytes, sha256 `4946c595d2d8d238…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-20-image-inspection.log` — 275 bytes, sha256 `2e26d19a8de40e5a…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-21-compose-validation.log` — 1413 bytes, sha256 `5ef9c7225593cf24…`
  - `docs/production-certification/evidence/raw/run2-9b2b44c-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
### `EV-RUN-3`
- **Kind**: `certification-run`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 9b2b44c9f0987139e2f48ee21b14ec36e10690a8 --run 3`
- **Ran**: 2026-08-25T21:20:50.756Z → 2026-08-25T21:39:06.254Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-02-environment.log` — 469 bytes, sha256 `241d5ed30c07734c…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-03-typecheck.log` — 261 bytes, sha256 `f8f31d8ad80f68e8…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-04-lint.log` — 318 bytes, sha256 `f789d4844975f859…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-05-test-discipline.log` — 324 bytes, sha256 `d3129b4a5f4dc231…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-06-migration-validation.log` — 337 bytes, sha256 `9c699f4f5d488967…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-07-database-integrity.log` — 1670 bytes, sha256 `5b90eb878aff5348…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-09-redis-integration.log` — 547 bytes, sha256 `38d2d8bf0dcd6f3f…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-10-ai-certification.log` — 8531 bytes, sha256 `96af06346ae4aefe…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-11-email-safety.log` — 1091 bytes, sha256 `ed54957a02435e7e…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-12-import-fault-matrix.log` — 7833 bytes, sha256 `49da49d40ffc3da3…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-13-queue-load.log` — 2166 bytes, sha256 `10240d8a2710c64e…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-14-security-suite.log` — 2285 bytes, sha256 `ec37ea1484051fb0…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-15-production-build.log` — 7406 bytes, sha256 `ba1bbb35dc785be2…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-16-playwright-roles.log` — 2174 bytes, sha256 `845a30389d1b9f3f…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-17-golden-browser-journey.log` — 2218 bytes, sha256 `f9f19c759cf29f8b…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-18-worker-readiness.log` — 187 bytes, sha256 `4ef1e5f4ce8cff7a…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-22-health-smoke.log` — 210 bytes, sha256 `4ebf23d8d1d3ece3…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-19-docker-build.log` — 20491 bytes, sha256 `8eec46a74a14cfa2…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-20-image-inspection.log` — 275 bytes, sha256 `64788aa7382fb13c…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-21-compose-validation.log` — 1413 bytes, sha256 `2bdfa53a0b407c2f…`
  - `docs/production-certification/evidence/raw/run3-9b2b44c-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
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
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-25T21:38:59.227Z → 2026-08-25T21:39:06.252Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T21:22:49.549Z → 2026-08-25T21:27:33.861Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run3-9b2b44c-08-vitest.log` — 458 bytes, sha256 `f69cb90edcbb08bf…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
