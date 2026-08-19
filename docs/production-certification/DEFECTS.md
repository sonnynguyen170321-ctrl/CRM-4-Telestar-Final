# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Certificate State**: INVALIDATED — evidence reconciliation in progress
**Candidate SHA**: *(re-freeze pending — `a6d8c0d` invalidated as candidate)*
**Last Updated**: 2026-08-20T09:00:00+07:00

> **Closure rule.** A defect moves `OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`
> only. `VERIFIED` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under `docs/production-certification/evidence/`. "Fix implemented" is
> **not** `VERIFIED`.
>
> **Performance and count metrics are deliberately NOT duplicated in this file.** They live in
> the evidence manifest and are rendered by the generator. See `PROTOCOL.md` §20.

---

## 1. Defect Summary

| Severity | Discovered | Verified Closed | Reopened | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 1 | 0 | 0 | **1** |
| **P1** (Critical) | 19 | 9 | 4 | **10** |
| **P2** (Important) | 17 | 9 | 3 | **8** |
| **P3** (Minor Polish) | 0 | 0 | 0 | 0 |
| **TOTAL** | **37** | **18** | **7** | **19** |

The defect total is permitted to increase. Finding more defects is successful auditing.
The prior cap of 25 is void.

---

## 2. Active Defects

### `TEL-P0-001` — Disaster Recovery Evidence Invalid
- **Severity**: P0 (Launch Blocker)
- **Status**: `OPEN`
- **Root cause**: DR evidence was authored, not measured.
- **Finding 1**: `BACKUP_RESTORE.md` documents a 48.2 MB backup artifact
  `telestar_backup_20260819_prod.dump` with SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
  That digest is the SHA-256 of the **empty byte sequence**. A 48.2 MB file cannot produce it.
  The artifact was therefore never hashed, and very likely never created.
- **Finding 2**: The documented restore procedure step 4 executes
  `scripts/verify-db-integrity.ts`. That file **does not exist** in the repository.
- **Finding 3**: Consequently RTO `4m 12s`, RPO `15m`, rollback `38s`, and
  "48/48 tables reconciled" are unsupported numbers.
- **Required remediation**: implement `scripts/verify-db-integrity.ts` with real invariants;
  take a real non-empty dump; hash it; `sha256sum -c` it; restore into an isolated database;
  run the integrity script; compare pre/post record counts; measure RTO from observation;
  derive RPO from actual infrastructure configuration or mark `BLOCKED_EXTERNAL`.
- **Invariant the validator must enforce**: `backupSizeBytes > 0` **and**
  `backupSha256 != e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-014` — Final Three-Run Certification Ladder Incomplete
- **Severity**: P1
- **Status**: `OPEN`
- **Root cause**: `RUN_1/2/3` executed a 4-gate subset but were documented as full
  certification runs.
- **Detail**: The runs prove TypeScript, ESLint, migration order, and Vitest. They do not
  prove production build, Playwright, Redis integration, queue load, Docker build, image
  inspection, compose validation, worker readiness, or health smoke. Redis was skipped.
- **Required remediation**: `scripts/certification/run-full-certification.mjs` defining the
  complete ladder in code, invoked as `npm run certify:full`; run manifests generated from
  raw run output, not hand-written.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-015` — AI Budget Governance Is Process-Local
- **Severity**: P1
- **Status**: `OPEN`
- **Root cause**: Budget reservations are held in an in-process `Map`.
- **Detail**: Process restart erases budget truth. Two web replicas do not share reservations.
  The worker does not observe the web tier's reservations. This is not a durable tenant hard
  budget, and must not be certified as one.
- **Required remediation**: database-authoritative budget ledger
  (`TenantAiBudgetPeriod`: `tenantId`, `periodKey`, `limit`, `used`, `reserved`, `updatedAt`),
  integer minor-units (no floating-point money), atomic conditional reservation.
- **Invariant**: N concurrent processes cannot collectively reserve past the hard limit.
  Must be tested with **actual parallel** requests against the shared store, not sequential calls.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-016` — AI Streaming Governance Incomplete
- **Severity**: P1
- **Status**: `OPEN`
- **Root cause**: `stream()` was implemented without parity to the non-stream path.
- **Missing**: pre-call budget reservation, provider timeout / abort, usage reconciliation,
  attribution recording, cancellation accounting.
- **Required tests**: successful stream; provider error before first token; provider error
  mid-stream; timeout; consumer cancellation; fallback provider; budget exceeded; AI-down
  degraded behaviour.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-017` — AI Circuit State Is Process-Local
- **Severity**: P1
- **Status**: `OPEN`
- **Root cause**: Circuit state `Map` and HALF_OPEN lease `Set` coordinate a single Node process.
- **Detail**: Multi-instance resilience cannot be claimed from process-local state. Instance B
  keeps calling a provider that instance A has already circuit-opened.
- **Required remediation**: shared circuit state in Redis (already an operational dependency).
  `circuit:{provider}:{model}` holding state / failure count / lastFailure / openedAt.
  HALF_OPEN probe lease via `SET key value NX PX <timeout>` so exactly one process probes.
  Behaviour when Redis is unavailable must be explicitly defined and tested.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-018` — Release Deployment Identity Chain Missing
- **Severity**: P1
- **Status**: `OPEN`
- **Root cause**: Release identity was asserted at source-SHA level only.
- **Missing authoritative values**: `CI_RUN_ID`, `IMAGE_DIGEST`, `WEB_DIGEST`, `WORKER_DIGEST`,
  `HEALTH_SHA`.
- **Required remediation**: `DEPLOYMENT.md` carrying the full chain; image built from the frozen
  candidate SHA and referenced **by digest**, never by `latest`/`main`/floating tag; proof that
  `EXPECTED_SHA == HEALTH_SHA` and `EXPECTED_IMAGE == WEB_IMAGE == WORKER_IMAGE`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-013` — Six-Role Real Browser Acceptance Not Evidenced
- **Severity**: P2
- **Status**: `OPEN`
- **Root cause**: Database/service role tests were treated as satisfying a browser-acceptance
  requirement.
- **Detail**: `tests/role-journeys.test.ts` is valuable and is retained. It does not prove that
  Director, Floor Manager, Team Lead, SDR, Leadgen Manager, and Leadgen can log in and operate
  the real UI.
- **Required remediation**: `ROLE_BROWSER_EVIDENCE.md` backed by Playwright against a
  production build with real Postgres, real Redis, real server, real browser. Per role: login
  result, landing page, key navigation, allowed workflow, forbidden workflow, object
  authorization attempt, console errors, network failures, screenshot, trace.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-014` — Master Evidence Ledger Stale
- **Severity**: P2
- **Status**: `OPEN`
- **Detail**: `EVIDENCE.md` declares candidate `cf23182` and totals `149 files / 1,880 tests`
  while the certificate declared `a6d8c0d` and `154 files / 1,922 tests`. It also lacks
  evidence for the majority of active certification domains.
- **Required remediation**: rebuild from the evidence manifest, covering static, build,
  database, Redis, unit/integration, import, queue load, email, AI, security, roles, Playwright,
  DR, rollback, deployment, and the three final runs.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-015` — Load Results Contradict Certificate
- **Severity**: P2
- **Status**: `OPEN`
- **Detail**: For the 1,000-row case `LOAD_TEST.md` recorded `26.11s / 38.3 rows/s / p95 1423ms`
  while the certificate recorded `19.71s / 50.75 rows/s / p95 950ms`. Two authoritative answers
  to one question is a certification failure regardless of which is correct.
- **Required remediation**: one machine-written source of truth (`load-results.json`);
  `LOAD_TEST.md` and the certificate both rendered from it; no manual duplication anywhere.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-016` — Load Benchmark Does Not Exercise The Real BullMQ System
- **Severity**: P2
- **Status**: `OPEN`
- **Detail**: The existing benchmark mocks BullMQ and invokes the worker handler directly. That
  is a legitimate **handler** benchmark and is retained under the name
  `IMPORT_HANDLER_BENCHMARK`. It is not queue/system evidence: it measures nothing about
  enqueue latency, queue wait, retry, redelivery, or worker concurrency.
- **Required remediation**: add `IMPORT_SYSTEM_QUEUE_BENCHMARK` using real Redis, real BullMQ,
  real worker, real queue, at 120 / 500 / 1000 rows, recording queue wait and processing
  percentiles, failed jobs, retries, lost/duplicate/stuck rows.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-017` — AI Capability Routing Not Strictly Enforced
- **Severity**: P2
- **Status**: `OPEN`
- **Detail**: `requiresTools`, `requiresVision`, `requiresStructuredOutput` do not constrain the
  selected model, and do not constrain **fallback** models at all.
- **Required remediation**: capability filtering applied before preference ranking; every
  fallback must satisfy the same hard requirements as the primary; an unknown preferred model
  must produce an explicit validation error or an explicit fallback decision carrying
  `requestedModel` / `fallbackModel` / `fallbackReason` — never a silent remap.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-019` — Requirements Verified Against Test Files That Do Not Exist
- **Severity**: P1
- **Status**: `OPEN`
- **Discovered by**: `npm run certify:validate` check `J2`, on the first run of the validator.
- **Root cause**: requirement rows were authored with plausible-sounding test filenames that
  were never written.
- **Detail**: five requirements cite test files absent from the repository and absent from all
  git history (no delete commit exists, so they were never present):

  | Requirement | Cited test file | Exists |
  |---|---|---|
  | `IMP-011` | `tests/leadgen-pool.test.ts` | no |
  | `ROLE-011` | `tests/leadgen-pool.test.ts` | no |
  | `OPS-008` | `tests/transfer-work.test.ts` | no |
  | `OPS-020` | `tests/lead-lifecycle.test.ts` | no |
  | `OPS-021` | `tests/activities.test.ts` | no |

  Application routes of similar names exist (`app/api/leadgen-pool`, `app/admin/transfer-work`),
  which is likely how the names were invented. A citation to a nonexistent test can never be
  satisfied by any run, and reads as coverage that was never written.
- **Required remediation**: for each requirement either write the missing test, or repoint the
  requirement at the test that genuinely exercises the invariant. Repointing must be justified
  in the commit, never done silently to clear the check.
- **Evidence ID**: *(none yet)*

---

## 3. Reopened Defects

These were previously marked `VERIFIED`. The evidence supporting that closure does not meet the
closure rule, so they return to `OPEN` under a successor ID.

| ID | Prior claim | Why reopened | Successor |
|---|---|---|---|
| `TEL-P1-011` | Atomic pre-provider budget reservation VERIFIED | Reservation is process-local; not durable, not shared | `TEL-P1-015` |
| `TEL-P1-012` | Streaming attribution + single-probe breaker VERIFIED | Breaker state is process-local; streaming lacks budget/timeout/reconciliation parity | `TEL-P1-016`, `TEL-P1-017` |
| `TEL-P1-013` | End-to-end release identity chain VERIFIED | No image/web/worker/health digest chain exists | `TEL-P1-018` |
| `TEL-P1-009` | Certification source code freeze VERIFIED | Candidate `a6d8c0d` invalidated; re-freeze required after remediation | *(re-freeze)* |
| `TEL-P2-008` | Six-role operational journeys VERIFIED | Browser layer never executed | `TEL-P2-013` |
| `TEL-P2-009` | Backup / restore / rollback drill VERIFIED | Empty-file checksum; nonexistent verification script | `TEL-P0-001` |
| `TEL-P2-010` | Test counts reconciled VERIFIED | Two conflicting authoritative totals in tree | `TEL-P2-014` |
| `TEL-P2-012` | 1,000-row load benchmark VERIFIED | Contradictory published results; handler-only scope | `TEL-P2-015`, `TEL-P2-016` |

---

## 4. Retained Verified Defects

These closures are supported by tests that genuinely exercise the invariant. They are retained
and must be re-confirmed against the **new** candidate SHA once it is frozen (a pass on an
earlier SHA does not certify later behaviour-changing code).

| ID | Description | Verifying test |
|---|---|---|
| `TEL-P1-001` | Import partial-write & crash convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-002` | 120-row import concurrency, zero lost rows | `tests/import-race-stress.test.ts` |
| `TEL-P1-003` | Demo tenant live-email transport barrier | `tests/demo-email-barrier.test.ts` |
| `TEL-P1-004` | Production demo seed password guard | `tests/seed-guard.test.ts` |
| `TEL-P1-005` | Eventual batch commit completion | `tests/import-fault-injection.test.ts` |
| `TEL-P1-006` | Import true failure convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-007` | Concurrent duplicate job delivery idempotency | `tests/import-fault-injection.test.ts` |
| `TEL-P1-008` | Release candidate identity separation | `MASTER_TRACKER.md` |
| `TEL-P1-010` | AI structured output runtime Zod validation | `tests/ai-structured-budget.test.ts` |
| `TEL-P2-001`–`TEL-P2-007` | CSV formula injection, email sanitisation, RLS audit, role permissions, traceability mapping, doc synchronisation, ISO-8601 timestamps | see `EVIDENCE.md` |
| `TEL-P2-011` | Import durable-write failpoint matrix | `tests/import-fault-injection.test.ts` |
