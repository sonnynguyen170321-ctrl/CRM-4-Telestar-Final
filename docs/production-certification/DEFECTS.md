# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification  
**Authoritative Candidate Source SHA**: `cf23182cdd291d9f180bb36ec88d7fe6df0cdfb9`  
**Last Updated**: 2026-08-19T22:58:00+07:00  

---

## 1. Defect Summary

| Severity | Total Discovered | Resolved | Retested & Verified | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 0 | 0 | 0 | 0 |
| **P1** (Critical) | 8 | 8 | 8 | 0 |
| **P2** (Important) | 7 | 7 | 7 | 0 |
| **P3** (Minor Polish) | 0 | 0 | 0 | 0 |
| **TOTAL** | **15** | **15** | **15** | **0** |

---

## 2. Master Defect Ledger

### `TEL-P1-001`: Import Partial-Write & Crash Convergence Risk
- **Discovered**: 2026-08-19
- **Subsystem**: Background Import Worker (`workers/import.ts`)
- **Symptom**: `handleImportChunk` executed non-transactional writes across Lead, ImportRow, Activity, SequenceEnrollment, and Task without retry idempotency.
- **Root Cause**: If worker crashed mid-chunk after creating a Lead, subsequent retries would attempt duplicate creations or fail unhandled.
- **Fix**: Refactored `handleImportChunk` and `handlePoolChunk` with state reconciliation: queries pre-existing leads by `row.leadId` or unique constraints, updates `importRow`, and verifies existence before creating `Activity` or `Task`. Added state-driven commit barrier in `handleImportCommit` rejecting premature commits during in-flight chunks.
- **Verification Evidence**: `tests/import-fault-injection.test.ts` (100% pass across crash-recovery and in-flight commit tests).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-002`: Import Stress Test Misrepresents Actual Load Coverage
- **Discovered**: 2026-08-19
- **Subsystem**: Test Harness (`tests/import-race-stress.test.ts`)
- **Symptom**: Test title claimed 120 attempts but executed only 15 attempts (`ROUNDS = 5`).
- **Root Cause**: Premature test downsizing to speed up local execution.
- **Fix**: Restored `ROUNDS = 40`, `CONCURRENCY = 3` (120 total attempts across 40 shared accounts).
- **Verification Evidence**: `tests/import-race-stress.test.ts` passed: 120 attempts fulfilled, 40 accounts created, 120 leads created, 0 dropped leads, 0 errors.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-003`: Demo Tenant Live Email Barrier Not Proven at Transport Boundary
- **Discovered**: 2026-08-19
- **Subsystem**: Email Worker & Outbound Dispatcher (`workers/email.ts`, `lib/emailSafety.ts`)
- **Symptom**: No test proved that demo tenant cannot reach real network transport when `EMAIL_SEND_DRY_RUN=false`.
- **Root Cause**: Worker relied only on global `isDryRun()` flag without tenant-aware transport guard.
- **Fix**: Added `effectiveDryRun(tenantId)` in `lib/emailSafety.ts` guaranteeing demo tenants (`demo-telestar`, `demo-*`) ALWAYS evaluate to `dryRun=true` at worker side-effect boundary.
- **Verification Evidence**: `tests/demo-email-barrier.test.ts` passed verifying demo tenant dryRun invariance even under `EMAIL_SEND_DRY_RUN="false"`.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-004`: Demo Seed Password Allows Insecure Default Fallback in Production
- **Discovered**: 2026-08-19
- **Subsystem**: Database Seeding & Auth (`lib/seed-guard.ts`, `scripts/demo-seed.ts`)
- **Symptom**: Demo seed allowed `TelestarDemo!2026` fallback password when `DEMO_PASSWORD` was unset.
- **Root Cause**: Default fallback was not guarded against `NODE_ENV=production`.
- **Fix**: Implemented `resolveDemoPassword(rawPassword?, nodeEnv?)` in `lib/seed-guard.ts` strictly throwing `SeedGuardError` if `DEMO_PASSWORD` is missing or matches `TelestarDemo!2026` in production.
- **Verification Evidence**: `tests/seed-guard.test.ts` (22/22 unit tests passing including production password rejection).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-005`: Import Commit Eventual Completion
- **Discovered**: 2026-08-19
- **Subsystem**: Background Import Worker (`workers/import.ts`)
- **Symptom**: `handleImportCommit` returned `{ chunks_still_in_flight }` without re-enqueuing or creating completion dependency, risking stuck batches.
- **Root Cause**: Premature commit call without retry mechanism.
- **Fix**: Implemented delayed commit re-enqueueing (`delay: 1000`) in `handleImportCommit` and auto-dispatch commit when the final in-flight chunk completes in `handleImportChunk`.
- **Verification Evidence**: `tests/import-fault-injection.test.ts` (TEL-P1-005 test suite passed).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-006`: Import True Failure Convergence with Deterministic Failpoints
- **Discovered**: 2026-08-19
- **Subsystem**: Background Import Worker (`workers/import.ts`)
- **Symptom**: Worker partial writes could leave unlinked database records without retry test coverage at fine-grained boundaries.
- **Root Cause**: Missing programmatic failpoint injection at write boundaries.
- **Fix**: Added `__failpoint` deterministic crash injection across all write stages (`after_account`, `after_contact`, `after_lead`, `after_import_row`, `after_activity_lead_created`, `after_activity_sequence_enrolled`, `after_task`) and verified idempotency on retry.
- **Verification Evidence**: `tests/import-fault-injection.test.ts` (TEL-P1-006 test suite passed across all 5 failpoint combinations).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-007`: Concurrent Duplicate Job Delivery Idempotency
- **Discovered**: 2026-08-19
- **Subsystem**: Background Import Worker (`workers/import.ts`)
- **Symptom**: Duplicate BullMQ job delivery running concurrently on two workers could create duplicate activities or throw unhandled collisions.
- **Root Cause**: Non-atomic read-then-create without concurrent collision handling.
- **Fix**: Added concurrency safe duplicate handling and activity/task race protection.
- **Verification Evidence**: `tests/import-fault-injection.test.ts` (TEL-P1-007 test suite passed with 2 concurrent workers executing identical payload).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P1-008`: Release Identity Candidate Freeze & Metadata Separation
- **Discovered**: 2026-08-19
- **Subsystem**: Release Management (`docs/production-certification/`)
- **Symptom**: Source code changes were made while tracker referenced superseded baseline `353f650`.
- **Root Cause**: Mixing code fixes with certification metadata tracking.
- **Fix**: Defined candidate source SHA `cf23182cdd291d9f180bb36ec88d7fe6df0cdfb9` and separated `APPLICATION_SOURCE_SHA` from documentation metadata SHAs.
- **Verification Evidence**: Tracker identity chain synchronized in `MASTER_TRACKER.md` and `progress.json`.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-001`: Incomplete Boundary & Fault Evidence Across Requirements
- **Discovered**: 2026-08-19
- **Fix**: Decomposed requirements into 108 granular items in `docs/production-certification/REQUIREMENT_TRACEABILITY.md` with explicit test mapping.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-002`: Timestamp Representation Semantics
- **Discovered**: 2026-08-19
- **Fix**: Standardized on explicit ISO-8601 timestamps throughout all certification documents.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-003`: Ambiguity in Release Candidate Identity
- **Discovered**: 2026-08-19
- **Fix**: Separated `APPLICATION_SOURCE_SHA` from certification metadata tracking commits.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-004`: Traceability Count Alignment (108 Physical Requirements)
- **Discovered**: 2026-08-19
- **Subsystem**: Traceability Matrix (`docs/production-certification/REQUIREMENT_TRACEABILITY.md`)
- **Symptom**: Prior tracker claimed 108 requirements but physically only contained 56 rows with a rolled-up Domain H count.
- **Root Cause**: Incomplete markdown table generation.
- **Fix**: Physically expanded all 108 individual requirement rows across Domains A through H with unique IDs, severity, verification methods, and defect mappings.
- **Verification Evidence**: `REQUIREMENT_TRACEABILITY.md` physical row count = 108.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-005`: Demo Worker Handler Live Transport Proof
- **Discovered**: 2026-08-19
- **Subsystem**: Email Worker (`workers/email.ts`)
- **Symptom**: Prior test only checked helper function `effectiveDryRun()`, not the actual `handleEmailSend` worker handler.
- **Root Cause**: Missing end-to-end handler test with mocked `EmailService.send`.
- **Fix**: Created `tests/demo-email-barrier.test.ts` executing `handleEmailSend` for demo tenant under `EMAIL_SEND_DRY_RUN="false"` and asserting `EmailService.send` call count is 0.
- **Verification Evidence**: `tests/demo-email-barrier.test.ts` passed (4/4 tests).
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-006`: Tracker State Synchronization
- **Discovered**: 2026-08-19
- **Fix**: Synchronized `MASTER_TRACKER.md`, `progress.json`, `DEFECTS.md`, `EVIDENCE.md`, and `BURNDOWN.md`.
- **Status**: RESOLVED & VERIFIED

---

### `TEL-P2-007`: Timestamp Audit
- **Discovered**: 2026-08-19
- **Fix**: Standardized all local timestamps with explicit `+07:00` offset or UTC `Z`.
- **Status**: RESOLVED & VERIFIED
