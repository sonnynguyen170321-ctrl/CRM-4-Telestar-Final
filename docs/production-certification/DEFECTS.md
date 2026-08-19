# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification  
**Authoritative Baseline SHA**: `353f650bebc78db83e50fc3a254d9712046245d6`  
**Last Updated**: 2026-08-19T22:11:00+07:00  

---

## 1. Defect Summary

| Severity | Total Discovered | Resolved | Retested & Verified | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 0 | 0 | 0 | 0 |
| **P1** (Critical) | 4 | 4 | 4 | 0 |
| **P2** (Important) | 3 | 3 | 3 | 0 |
| **P3** (Minor Polish) | 0 | 0 | 0 | 0 |
| **TOTAL** | **7** | **7** | **7** | **0** |

---

## 2. Defect Resolution Ledger

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
- **Fix**: Separated `APPLICATION_SOURCE_SHA` (`353f650bebc78db83e50fc3a254d9712046245d6`) from certification metadata tracking commits.
- **Status**: RESOLVED & VERIFIED
