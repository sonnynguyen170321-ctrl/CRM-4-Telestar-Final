# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
**Evidence records**: 42
**Requirements verified**: 98 / 108
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
| `EV-AI-CAPABILITY-ROUTING` | `ai-capability-routing` | `949eefe` | **PASS** | 0 | 1 |
| `EV-AI-DURABLE-BUDGET` | `ai-durable-budget` | `949eefe` | **PASS** | 0 | 1 |
| `EV-AI-SHARED-CIRCUIT` | `ai-shared-circuit` | `949eefe` | **PASS** | 0 | 1 |
| `EV-AI-STREAM-GOVERNANCE` | `ai-stream-governance` | `949eefe` | **PASS** | 0 | 1 |
| `EV-BRANCH-PROTECTION` | `branch-governance` | `016e020` ⚠ | **PASS** | 0 | 1 |
| `EV-CI-RUN` | `ci-run` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-DEPLOYED-STATE` | `deployed-state` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-BACKUP` | `dr-backup` | `c7bf639` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-NEGATIVE-CONTROL` | `dr-negative-control` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-RESTORE` | `dr-restore` | `c7bf639` ⚠ | **PASS** | 0 | 3 |
| `EV-DR-ROLLBACK` | `dr-rollback` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-DR-RPO` | `dr-rpo` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-EMAIL-EXACTLY-ONCE` | `email-exactly-once` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-FAILURE-MATRIX` | `failure-matrix` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-03-TYPECHECK` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-04-LINT` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-05-TEST-DISCIPLINE` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-06-MIGRATION-VALIDATION` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-07-DATABASE-INTEGRITY` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-08-VITEST` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-09-REDIS-INTEGRATION` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-10-AI-CERTIFICATION` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-11-EMAIL-SAFETY` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-12-IMPORT-FAULT-MATRIX` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-14-SECURITY-SUITE` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-15-PRODUCTION-BUILD` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-21-COMPOSE-VALIDATION` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-GATE-TEST-DISCIPLINE` | `gate` | `949eefe` | **PASS** | 0 | 1 |
| `EV-LOAD-HANDLER` | `load-benchmark` | `949eefe` | **PASS** | 0 | 0 |
| `EV-LOAD-QUEUE` | `load-benchmark` | `949eefe` | **PASS** | 0 | 1 |
| `EV-REDIS-INTEGRATION` | `redis-integration` | `949eefe` | **PASS** | 0 | 1 |
| `EV-RELEASE-IDENTITY` | `release-identity` | `c7bf639` ⚠ | **PASS** | 0 | 0 |
| `EV-RLS-POSTURE` | `rls-posture` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-ROLE-BROWSER` | `role-browser` | `949eefe` | **PASS** | 0 | 6 |
| `EV-ROLE-MODEL` | `role-model` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-RUN-1` | `certification-run` | `949eefe` | **FAIL** | 1 | 22 |
| `EV-RUN-2` | `certification-run` | `c7bf639` ⚠ | **PASS** | 0 | 23 |
| `EV-RUN-3` | `certification-run` | `c7bf639` ⚠ | **PASS** | 0 | 23 |
| `EV-SECURITY-BOUNDARIES` | `security-boundaries` | `c7bf639` ⚠ | **PASS** | 0 | 1 |
| `EV-SECURITY-INVENTORY` | `security-inventory` | `949eefe` | **PASS** | 0 | 1 |
| `EV-VALIDATOR-SELFTEST` | `validator-self` | `949eefe` | **PASS** | 0 | 1 |
| `EV-VITEST` | `vitest` | `949eefe` | **PASS** | 0 | 1 |

---

## 3. Record detail

### `EV-AI-CAPABILITY-ROUTING`
- **Kind**: `ai-capability-routing`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-AI-DURABLE-BUDGET`
- **Kind**: `ai-durable-budget`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-AI-SHARED-CIRCUIT`
- **Kind**: `ai-shared-circuit`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-AI-STREAM-GOVERNANCE`
- **Kind**: `ai-stream-governance`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-BRANCH-PROTECTION`
- **Kind**: `branch-governance`
- **Candidate**: `016e0205b5ece66aab5266a94e744fb9fd2ed2ad`
- **Environment**: GitHub REST API and git push against sonnynguyen170321-ctrl/CRM-4-Telestar-Final from the certification workstation
- **Command**: `gh api -X PUT .../branches/main/protection; gh pr create; gh api -X PUT .../pulls/111/merge; git push origin main`
- **Ran**: 2026-08-25T09:46:01.958Z → 2026-08-25T10:16:01.959Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/branch-protection-behavioral-proof.log` — 2790 bytes, sha256 `44c5e18353ace61d…`
### `EV-CI-RUN`
- **Kind**: `ci-run`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: GitHub Actions
- **Command**: `gh run view 32711776013`
- **Ran**: 2026-08-24T09:28:55Z → 2026-08-24T09:34:40Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/ci-run-32711776013.log` — 29927 bytes, sha256 `2f262b7e8aceb0ec…`
### `EV-DEPLOYED-STATE`
- **Kind**: `deployed-state`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: read-only probe of the live production health endpoint from the certification workstation
- **Command**: `curl -s https://crm.telestar.cloud/api/health`
- **Ran**: 2026-08-24T09:42:16.857Z → 2026-08-24T09:42:16.859Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/deployed-health-probe.log` — 211 bytes, sha256 `ca426bebb525f481…`
### `EV-DR-BACKUP`
- **Kind**: `dr-backup`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_crm --format=custom --no-owner --no-acl --snapshot 00000003-000B3A46-1 --file C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T19-45-22-091Z.dump`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-pre-backup-counts.log` — 1976 bytes, sha256 `2e5b509d264a65c3…`
  - `docs/production-certification/evidence/raw/dr-backup-command.log` — 437 bytes, sha256 `0ab0595ec14a1d7d…`
  - `docs/production-certification/evidence/raw/dr-backup-sha256.log` — 292 bytes, sha256 `28b672b16dedbed8…`
### `EV-DR-NEGATIVE-CONTROL`
- **Kind**: `dr-negative-control`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / postgres 16
- **Command**: `node scripts/certification/dr-negative-fixture.mjs`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-negative-fixture.log` — 6199 bytes, sha256 `615096abca5fca8e…`
### `EV-DR-RESTORE`
- **Kind**: `dr-restore`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / postgres 16 / source telestar_crm
- **Command**: `C:\Program Files\PostgreSQL\16\bin\pg_restore.exe -h 127.0.0.1 -p 5432 -U postgres -d telestar_dr_drill_20260823t194522 --no-owner --no-acl --exit-on-error C:\Users\admin\Desktop\Sonny & AI\CRM-4-Telestar-Final\.dr-artifacts\telestar_2026-08-23T19-45-22-091Z.dump`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-createdb.log` — 275 bytes, sha256 `9417e58918b20bb1…`
  - `docs/production-certification/evidence/raw/dr-restore-command.log` — 426 bytes, sha256 `7a0f9018972a02f0…`
  - `docs/production-certification/evidence/raw/dr-restore-integrity.log` — 2095 bytes, sha256 `addd695d7ee3f054…`
### `EV-DR-ROLLBACK`
- **Kind**: `dr-rollback`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: telestar-crm-vm / docker compose / GCE ubuntu-2204-lts
- **Command**: `scripts/deploy.sh + scripts/rollback.sh, observed over three phases`
- **Ran**: 2026-08-24T09:41:00.000Z → 2026-08-24T09:42:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rollback-c7bf639.log` — 565 bytes, sha256 `9d8263dd1e442d1a…`
### `EV-DR-RPO`
- **Kind**: `dr-rpo`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: certification workstation - gcloud probe outcome MEASURED
- **Command**: `gcloud sql instances describe telestar-db --project=telestar-crm-final --format=json`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: point-in-time recovery is enabled, so recovery is bounded by transaction-log durability rather than by the backup interval
- **Artifacts**:
  - `docs/production-certification/evidence/raw/dr-rpo-gcloud.log` — 2021 bytes, sha256 `e2ea8c74b6cedc6f…`
### `EV-EMAIL-EXACTLY-ONCE`
- **Kind**: `email-exactly-once`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: certification workstation - real PostgreSQL; only the provider and the queue are substituted
- **Command**: `node node_modules/vitest/vitest.mjs run tests/email-send-once-invariant.test.ts tests/email-idempotency.test.ts tests/email-worker.test.ts tests/email-safety.test.ts tests/demo-email-barrier.test.ts tests/sequence-worker.test.ts tests/sequence-execute.test.ts`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/email-exactly-once.log` — 245 bytes, sha256 `c08486466891fe0d…`
### `EV-FAILURE-MATRIX`
- **Kind**: `failure-matrix`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-GATE-03-TYPECHECK`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit`
- **Ran**: 2026-08-25T10:47:52.066Z → 2026-08-25T10:48:27.711Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-03-typecheck.log` — 261 bytes, sha256 `257d6e089ea01680…`
### `EV-GATE-04-LINT`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/eslint/bin/eslint.js app components lib context tests workers scripts e2e`
- **Ran**: 2026-08-25T10:49:58.208Z → 2026-08-25T10:51:16.508Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-04-lint.log` — 847 bytes, sha256 `b4ba28afe6d7c7b6…`
### `EV-GATE-05-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-25T10:48:27.945Z → 2026-08-25T10:48:28.814Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-05-test-discipline.log` — 324 bytes, sha256 `ad3daf9dcb5ee34d…`
### `EV-GATE-06-MIGRATION-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-migration-order.mjs`
- **Ran**: 2026-08-25T10:48:29.427Z → 2026-08-25T10:48:30.008Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-06-migration-validation.log` — 337 bytes, sha256 `f2f1f1e9fcd24585…`
### `EV-GATE-07-DATABASE-INTEGRITY`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs scripts/verify-db-integrity.ts`
- **Ran**: 2026-08-25T10:48:30.433Z → 2026-08-25T10:48:35.811Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-07-database-integrity.log` — 1741 bytes, sha256 `f9c14f1f55fbf3e0…`
### `EV-GATE-08-VITEST`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T10:51:20.268Z → 2026-08-25T11:00:27.043Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-08-vitest.log` — 468 bytes, sha256 `7c9f29e3c387ce05…`
### `EV-GATE-09-REDIS-INTEGRATION`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-25T10:48:36.030Z → 2026-08-25T10:48:42.035Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-09-redis-integration.log` — 572 bytes, sha256 `13e85bcb7f7fa484…`
### `EV-GATE-10-AI-CERTIFICATION`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/ai-durable-budget.test.ts tests/ai-stream-governance.test.ts tests/ai-shared-circuit.test.ts tests/ai-capability-routing.test.ts tests/ai-structured-budget.test.ts tests/ai-down-resilience.test.ts`
- **Ran**: 2026-08-25T10:48:42.271Z → 2026-08-25T10:49:04.267Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-10-ai-certification.log` — 9143 bytes, sha256 `c6eea2f589260c36…`
### `EV-GATE-11-EMAIL-SAFETY`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/demo-email-barrier.test.ts tests/email-idempotency.test.ts tests/email-safety.test.ts`
- **Ran**: 2026-08-25T10:49:04.669Z → 2026-08-25T10:49:12.164Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-11-email-safety.log` — 1117 bytes, sha256 `1e38c9ebca86a59b…`
### `EV-GATE-12-IMPORT-FAULT-MATRIX`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/import-fault-injection.test.ts tests/import-race-stress.test.ts`
- **Ran**: 2026-08-25T10:49:12.449Z → 2026-08-25T10:49:29.364Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-12-import-fault-matrix.log` — 9715 bytes, sha256 `f838072148ade6be…`
### `EV-GATE-14-SECURITY-SUITE`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/tenant-inject.test.ts tests/object-auth-red-team.test.ts tests/mass-assignment.test.ts tests/security-injection.test.ts tests/gitleaks-allowlist.test.ts tests/csp.test.ts tests/login-throttle.test.ts`
- **Ran**: 2026-08-25T10:49:30.414Z → 2026-08-25T10:49:43.068Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-14-security-suite.log` — 2310 bytes, sha256 `b09f6f07d463e1c7…`
### `EV-GATE-15-PRODUCTION-BUILD`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/build.cjs`
- **Ran**: 2026-08-25T11:00:33.703Z → 2026-08-25T11:02:52.843Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-15-production-build.log` — 7394 bytes, sha256 `813304ac16d2056f…`
### `EV-GATE-21-COMPOSE-VALIDATION`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-production-compose.mjs`
- **Ran**: 2026-08-25T10:49:43.336Z → 2026-08-25T10:49:50.979Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/gate-21-compose-validation.log` — 1413 bytes, sha256 `ab59832ce2f6132e…`
### `EV-GATE-TEST-DISCIPLINE`
- **Kind**: `gate`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/check-test-discipline.mjs`
- **Ran**: 2026-08-25T11:05:54.478Z → 2026-08-25T11:05:55.653Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-05-test-discipline.log` — 324 bytes, sha256 `794b123f49d8e98b…`
### `EV-LOAD-HANDLER`
- **Kind**: `load-benchmark`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / BullMQ mocked
- **Command**: `node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts`
- **Ran**: 2026-08-25T11:06:36.652Z → 2026-08-25T11:09:21.871Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.
- **Artifacts**: none
### `EV-LOAD-QUEUE`
- **Kind**: `load-benchmark`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ
- **Command**: `npx tsx scripts/certification/queue-load-benchmark.ts`
- **Ran**: 2026-08-25T11:14:33.488Z → 2026-08-25T11:15:31.590Z
- **Exit code**: 0 · **Status**: **PASS**
- **Note**: Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/load-queue-benchmark.log` — 2072 bytes, sha256 `09c4a644fb0acf19…`
### `EV-REDIS-INTEGRATION`
- **Kind**: `redis-integration`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/redis-integration.test.ts tests/ai-shared-circuit.test.ts tests/redis-readiness.test.ts --reporter=json --outputFile=.certification/redis.json`
- **Ran**: 2026-08-25T11:13:52.611Z → 2026-08-25T11:13:58.386Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-09-redis-integration.log` — 572 bytes, sha256 `5a1837b964cd5e67…`
### `EV-RELEASE-IDENTITY`
- **Kind**: `release-identity`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / deploy host
- **Command**: `docker buildx imagetools inspect; docker inspect; curl /api/health`
- **Ran**: 2026-08-24T09:41:35.285Z → 2026-08-24T09:42:12.554Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**: none
### `EV-RLS-POSTURE`
- **Kind**: `rls-posture`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: certification workstation - local PostgreSQL 16; each script builds its own throwaway database and roles
- **Command**: `node scripts/verify-rls.mjs; node scripts/verify-rls-app-paths.mjs; node scripts/verify-rls-enablement.mjs; node scripts/verify-rls-live.mjs`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Reason**: DB_RLS_ENFORCED appears in no environment file and no compose file, so database-level RLS is NOT enforced in production. Production tenant isolation rests on the application-layer Prisma extension. DB-level RLS is available and now proven to work; enabling it is a separate infrastructure decision.
- **Artifacts**:
  - `docs/production-certification/evidence/raw/rls-posture-gates.log` — 4850 bytes, sha256 `df6073d9ad2ccda1…`
### `EV-ROLE-BROWSER`
- **Kind**: `role-browser`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
- **Command**: `node node_modules/@playwright/test/cli.js test --project=certification-roles`
- **Ran**: 2026-08-25T11:18:05.920Z → 2026-08-25T11:18:05.920Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-screenshots/director.png` — 151007 bytes, sha256 `995827fb34a50eeb…`
  - `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` — 183614 bytes, sha256 `fbc00dbfbfb8c42b…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` — 92840 bytes, sha256 `bb0aa3ec996694aa…`
  - `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` — 137181 bytes, sha256 `2fcb1291836acb81…`
  - `docs/production-certification/evidence/raw/role-screenshots/sdr.png` — 100037 bytes, sha256 `247200242d60c62c…`
  - `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` — 216554 bytes, sha256 `2120b0bfb9d07adb…`
### `EV-ROLE-MODEL`
- **Kind**: `role-model`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: certification workstation - real PostgreSQL
- **Command**: `vitest run tests/role-journeys tests/phase-9-role-surfaces tests/floor-manager-administration tests/leadgen tests/leadgen-redesign tests/ai-briefing-scope tests/client-report-scope tests/certification-role-evidence`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/role-model-suites.log` — 275 bytes, sha256 `d4ed710993d6be2c…`
### `EV-RUN-1`
- **Kind**: `certification-run`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate 949eefe3a474ab76db1064cb3bb597715d9599bf --run 1`
- **Ran**: 2026-08-25T11:03:36.146Z → 2026-08-25T11:23:34.794Z
- **Exit code**: 1 · **Status**: **FAIL**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-02-environment.log` — 469 bytes, sha256 `2de0b7db645c4f4f…`
  - `docs/production-certification/evidence/raw/run1-949eefe-03-typecheck.log` — 261 bytes, sha256 `cd39123859b6d844…`
  - `docs/production-certification/evidence/raw/run1-949eefe-04-lint.log` — 847 bytes, sha256 `012b3f9029e35dfb…`
  - `docs/production-certification/evidence/raw/run1-949eefe-05-test-discipline.log` — 324 bytes, sha256 `794b123f49d8e98b…`
  - `docs/production-certification/evidence/raw/run1-949eefe-06-migration-validation.log` — 337 bytes, sha256 `b82339896388d78d…`
  - `docs/production-certification/evidence/raw/run1-949eefe-07-database-integrity.log` — 1741 bytes, sha256 `ed94d544ff5429a6…`
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
  - `docs/production-certification/evidence/raw/run1-949eefe-09-redis-integration.log` — 572 bytes, sha256 `5a1837b964cd5e67…`
  - `docs/production-certification/evidence/raw/run1-949eefe-10-ai-certification.log` — 8820 bytes, sha256 `9de0360424907460…`
  - `docs/production-certification/evidence/raw/run1-949eefe-11-email-safety.log` — 1116 bytes, sha256 `aa6949d4768744f9…`
  - `docs/production-certification/evidence/raw/run1-949eefe-12-import-fault-matrix.log` — 9713 bytes, sha256 `1a58cde20146c09e…`
  - `docs/production-certification/evidence/raw/run1-949eefe-13-queue-load.log` — 526 bytes, sha256 `0b852e1b06712a08…`
  - `docs/production-certification/evidence/raw/run1-949eefe-14-security-suite.log` — 2557 bytes, sha256 `47c3b09b4399181b…`
  - `docs/production-certification/evidence/raw/run1-949eefe-15-production-build.log` — 7406 bytes, sha256 `9fcc663f8389bebd…`
  - `docs/production-certification/evidence/raw/run1-949eefe-16-playwright-roles.log` — 2175 bytes, sha256 `014c705c8d7ab6ff…`
  - `docs/production-certification/evidence/raw/run1-949eefe-16-playwright-roles-evidence.log` — 156 bytes, sha256 `576a1d9f71438d9f…`
  - `docs/production-certification/evidence/raw/run1-949eefe-17-golden-browser-journey.log` — 2217 bytes, sha256 `e509856b3a623bd7…`
  - `docs/production-certification/evidence/raw/run1-949eefe-18-worker-readiness.log` — 187 bytes, sha256 `41c17dfb3f4d6ced…`
  - `docs/production-certification/evidence/raw/run1-949eefe-22-health-smoke.log` — 210 bytes, sha256 `004d21ad0205f202…`
  - `docs/production-certification/evidence/raw/run1-949eefe-19-docker-build.log` — 16256 bytes, sha256 `2fc0da88ad17405d…`
  - `docs/production-certification/evidence/raw/run1-949eefe-21-compose-validation.log` — 1413 bytes, sha256 `588322b52cc61f19…`
  - `docs/production-certification/evidence/raw/run1-949eefe-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
### `EV-RUN-2`
- **Kind**: `certification-run`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate c7bf639ef988a6ba9fffba3c88761dad245ef7a3 --run 2`
- **Ran**: 2026-08-24T09:36:00.000Z → 2026-08-24T09:38:00.000Z
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
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `node scripts/certification/run-full-certification.mjs --candidate c7bf639ef988a6ba9fffba3c88761dad245ef7a3 --run 3`
- **Ran**: 2026-08-24T09:39:00.000Z → 2026-08-24T09:41:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
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
  - `docs/production-certification/evidence/raw/run3-22-health-smoke.log` — 210 bytes, sha256 `453881481683c223…`
  - `docs/production-certification/evidence/raw/run3-19-docker-build.log` — 20437 bytes, sha256 `5b9b4d75378f4a42…`
  - `docs/production-certification/evidence/raw/run3-20-image-inspection.log` — 275 bytes, sha256 `51dd2c3fa658dcf2…`
  - `docs/production-certification/evidence/raw/run3-21-compose-validation.log` — 1413 bytes, sha256 `3227f3c7e3189920…`
  - `docs/production-certification/evidence/raw/run3-23-validator-selftest.log` — 1554 bytes, sha256 `f0aa07d6c388d17c…`
### `EV-SECURITY-BOUNDARIES`
- **Kind**: `security-boundaries`
- **Candidate**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
- **Environment**: certification workstation - real PostgreSQL; gitleaks v8.28.0 in docker
- **Command**: `vitest run (13 security suites); docker run zricethezav/gitleaks:v8.28.0 detect --config=.gitleaks.toml --exit-code 1`
- **Ran**: 2026-08-24T09:30:00.000Z → 2026-08-24T09:32:00.000Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/security-boundaries.log` — 490 bytes, sha256 `0025d8c71eee0382…`
### `EV-SECURITY-INVENTORY`
- **Kind**: `security-inventory`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `derived from C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
### `EV-VALIDATOR-SELFTEST`
- **Kind**: `validator-self`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe scripts/certification/validator-selftest.mjs`
- **Ran**: 2026-08-25T11:23:29.716Z → 2026-08-25T11:23:34.793Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-23-validator-selftest.log` — 3175 bytes, sha256 `158e709c0dec9a91…`
### `EV-VITEST`
- **Kind**: `vitest`
- **Candidate**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
- **Environment**: win32 / node 24.16.0 / postgres 16 / redis real
- **Command**: `C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.certification/vitest.json`
- **Ran**: 2026-08-25T11:06:04.222Z → 2026-08-25T11:13:52.583Z
- **Exit code**: 0 · **Status**: **PASS**
- **Artifacts**:
  - `docs/production-certification/evidence/raw/run1-949eefe-08-vitest.log` — 468 bytes, sha256 `468aa6c8dd0b350e…`
---

## 4. Raw output

Every artifact above lives under `evidence/raw/` and is re-hashed on each validation run.
A drifted or missing artifact fails checks `G`/`H`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
