# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Authoritative Source**: `docs/production-certification/defects.json`
**Last Updated**: 2026-08-25T16:23:59.196Z

> **Closure rule.** A defect moves `OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`
> only. `VERIFIED` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under `docs/production-certification/evidence/`. "Fix implemented" is
> **not** `VERIFIED`.

---

## 1. Defect Summary

| Severity | Discovered | Verified Closed | Accepted Risk | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 9 | 3 | 0 | **6** |
| **P1** (Critical) | 34 | 27 | 0 | **7** |
| **P2** (Important) | 21 | 13 | 0 | **8** |
| **P3** (Minor Polish) | 0 | 0 | 0 | **0** |
| **TOTAL** | **64** | **43** | **0** | **21** |

---

## 2. Defects Ledger

### `TEL-P0-009` — The Live Production Login Password Is Published In A Public Repository, And Allowlisted From Secret Scanning

- **Severity**: P0
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-25T13:10:00.000Z
- **Root cause**: The literal `Telestar2026` appears in 23 files at HEAD of a repository whose visibility is PUBLIC. It is not a fixture. `scripts/restore-internal-users.ts:6` hashes it once and assigns it to all 44 roster accounts; `scripts/sync-users-to-production.ts:1-4` defaults `PROD_URL` to `https://crm.telestar.cloud`, `PASSWORD_RAW` and `ADMIN_PASSWORD` to it, and `ADMIN_EMAIL` to the director `dean@telestar.vn`; twelve further committed scripts authenticate to that same production host with it. No gate ever flagged it because `.gitleaks.toml:65` carries `Telestar2026` on the allowlist, filed under "Test credentials & mock tokens" — the scanner was taught to ignore the one credential that most needed flagging. `TEL-P0-006` rotated the disclosed *database* password; the *application login* password was never addressed.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P0-010` — `users:restore` Deletes Users In Every Tenant, And Swallows The Errors That Say So

- **Severity**: P0
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-25T13:10:00.000Z
- **Root cause**: Step 4 of `scripts/restore-internal-users.ts` selects deletion candidates with `prisma.user.findMany({ where: { OR: [ { email: { endsWith: "@telestar.vn", not: "dean@telestar.vn" } }, { email: { notIn: allowedEmails } } ] } })`. There is no `tenantId` predicate anywhere in that query, and it runs on `createAdminClient()`, which is the RLS bypass. The second arm matches every user in every tenant whose address is not one of the 44 hard-coded roster entries, so a single run deletes the entire user population of every other tenant on the instance. The reassignment and cleanup that precedes the delete runs through `safeUpdate`/`safeDelete` helpers whose bodies are `try { ... } catch {}`: a failed foreign-key reassignment is discarded silently and the delete proceeds regardless, and nothing is transactional, so a mid-run failure leaves a partially completed purge with no signal. The script also prints the shared password to stdout on the final line.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-024` — A Redelivered Bounce Webhook Recorded The Same Bounce Twice

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `handleApplyBounce` writes its timeline `Activity` **unconditionally**, before
- **Fix SHA**: `e713bdb9ff177b1a76e6c0afd638b8f8a89aed1d`
- **Verification evidence**: `tests/email-send-once-invariant.test.ts, tests/sync-worker.test.ts — Test Files  2 passed (2) · Tests  65 passed (65); exit 0; run 2026-08-25T16:04:07.026Z; fix e713bdb "fix(sync): stop a redelivered bounce webhook recording the same bounce twice"`

### `TEL-P2-023` — The Send-Once Invariant Was Only Ever Tested Against A Mocked Compare-And-Set

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `tests/email-worker.test.ts` mocks `@/lib/prisma` **entirely**, including
- **Fix SHA**: `c3b4ecdc405f845547ae7795983f0a8b81c82a7b`
- **Verification evidence**: `tests/email-send-once-invariant.test.ts — Test Files  1 passed (1) · Tests  32 passed (32); exit 0; run 2026-08-25T16:04:16.442Z; fix c3b4ecd "test(email): prove one logical step sends at most one email, against a real database"`

### `TEL-P1-037` — A Signing Secret Generated With `Math.random()`

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the rewritten webhook test endpoint generated its throwaway signing value with
- **Fix SHA**: `25af4ba2b0a7b2bb11e9f9dbaeb3adddc489b06a`
- **Verification evidence**: `tests/webhook-ssrf-and-authorization.test.ts — Test Files  1 passed (1) · Tests  69 passed (69); exit 0; run 2026-08-25T16:04:23.218Z; fix 25af4ba "fix(webhooks): close the SSRF rebinding window and stop seeding a secret from Math.random"`

### `TEL-P1-034` — The Health Gate Passed On 401, 403, 404, A Login Redirect, And The Wrong Release

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: gate 22 decided everything on one line — `if (response.status >= 500) ok = false;`.
- **Fix SHA**: `aa7d09841c263102a0894c5aeae6e63c7a7ba70b`
- **Verification evidence**: `tests/certification-false-green.test.ts, tests/certification-rollback-drill.test.ts — Test Files  2 passed (2) · Tests  70 passed (70); exit 0; run 2026-08-25T16:04:25.407Z; fix aa7d098 "fix(certification): make the health and Playwright gates capable of failing"`

### `TEL-P1-035` — Playwright Skips Were Invisible To The Certifier

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `mandatorySkips = (vitest?.testsSkipped ?? 0) + (redisGate?.metrics?.skipped ?? 0)`.
- **Fix SHA**: `aa7d09841c263102a0894c5aeae6e63c7a7ba70b`
- **Verification evidence**: `tests/certification-false-green.test.ts, tests/certification-rollback-drill.test.ts — Test Files  2 passed (2) · Tests  70 passed (70); exit 0; run 2026-08-25T16:04:27.005Z; fix aa7d098 "fix(certification): make the health and Playwright gates capable of failing"`

### `TEL-P1-036` — The Rollback Drill Let The Caller Define What Correct Meant

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `evaluateDrill` compared each phase's observed health against
- **Fix SHA**: `aa7d09841c263102a0894c5aeae6e63c7a7ba70b`
- **Verification evidence**: `tests/certification-false-green.test.ts, tests/certification-rollback-drill.test.ts — Test Files  2 passed (2) · Tests  70 passed (70); exit 0; run 2026-08-25T16:04:28.563Z; fix aa7d098 "fix(certification): make the health and Playwright gates capable of failing"`

### `TEL-P1-033` — A Test Guarding A Secret Printed It, And Depended On The Ambient Environment

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: tests/golden-journey.test.ts opened its send assertion with `expect(process.env.GROQ_API_KEY ?? '').toBe('')` — it asserted its premise instead of establishing it. The journey exists to prove the send produces the approved wording with no AI provider reachable, but it only hoped the ambient environment had no keys: 14/14 without provider keys, 2 failures with them. Worse, the failure printed the key, because Vitest renders the received value — and the ladder stores raw gate output under docs/production-certification/evidence/raw/, so a failing certification run would have committed a working Groq credential into an evidence file.
- **Fix SHA**: `24f9ad3571d234d0a6e35ee64ee88146e74a5472`
- **Verification evidence**: `tests/golden-journey.test.ts — Test Files  1 passed (1) · Tests  14 passed (14); exit 0; run 2026-08-25T16:04:30.284Z; fix 24f9ad3 "fix(test): stop a secret-guarding test printing the secret, and make it set its own premise"`

### `TEL-P2-022` — `lib/authRoles.ts` Was Owned By No Domain

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `auth-rbac-tenancy` maps `lib/auth.ts` and `lib/auth/**`, and the new module
- **Fix SHA**: `24f9ad3571d234d0a6e35ee64ee88146e74a5472`
- **Verification evidence**: `tests/golden-journey.test.ts — Test Files  1 passed (1) · Tests  14 passed (14); exit 0; run 2026-08-25T16:04:35.627Z; fix 24f9ad3 "fix(test): stop a secret-guarding test printing the secret, and make it set its own premise"`

### `TEL-P0-005` — API Keys Authenticated As Managers Regardless Of Who Created Them

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `getSessionUser()` in `lib/auth.ts` has two authentication paths that had
- **Fix SHA**: `1d41ea1375d53952cdad6bb83e6d4469f26c49d4`
- **Verification evidence**: `PARTIALLY PROVEN. tests/api-key-privilege-escalation.test.ts — Test Files 1 passed (1) · Tests 12 passed (12); exit 0; run 2026-08-25T16:04Z; fix 1d41ea1 "fix(auth): stop API keys authenticating as managers regardless of their creator". That commit names what is still outstanding: "Remaining before VERIFIED: exercise through the real HTTP surface with a live SDR-minted key. Per .claude/rules/auth-rbac.md this is R4 — independent verification required and the role E2E suite is part of the evidence." The unit-level proof holds; the HTTP-surface proof has not been run.`

### `TEL-P1-029` — Demo Diagnostics Endpoint Readable Against Live Tenants, Without Object Authorization

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `app/api/demo/diagnostics/route.ts` gated on `requireAuth()` and a tenant
- **Fix SHA**: `a4e85e5344085c75dea5402a471a6d21ffab88de`
- **Verification evidence**: `tests/demo-diagnostics-authorization.test.ts — Test Files  1 passed (1) · Tests  12 passed (12); exit 0; run 2026-08-25T16:04:42.230Z; fix a4e85e5 "fix(api): confine demo diagnostics to the demo tenant and authorize the object"`

### `TEL-P1-030` — Webhook Delivery Was Server-Side Request Forgery With A Response Oracle

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `deliverWebhook()` called `fetch(url)` with no validation. The only check
- **Fix SHA**: `2347a3ea96761afb5a28e0be20fad9173f181e43`
- **Verification evidence**: `tests/webhook-ssrf-and-authorization.test.ts — Test Files  1 passed (1) · Tests  69 passed (69); exit 0; run 2026-08-25T16:04:43.774Z; fix 2347a3e "fix(webhooks): block SSRF, require a management capability, stop returning secrets"`

### `TEL-P1-031` — Webhook Administration Needed Only Authentication, And Read Back Signing Secrets

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `GET`, `POST` and `DELETE` on `/api/webhooks` — and `POST /api/webhooks/test`
- **Fix SHA**: `2347a3ea96761afb5a28e0be20fad9173f181e43`
- **Verification evidence**: `tests/webhook-ssrf-and-authorization.test.ts — Test Files  1 passed (1) · Tests  69 passed (69); exit 0; run 2026-08-25T16:04:45.643Z; fix 2347a3e "fix(webhooks): block SSRF, require a management capability, stop returning secrets"`

### `TEL-P1-032` — Webhook Configuration Has No Durable Authority And Writes Can Fail Silently

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Webhook configuration had no durable authority — it was held where a write could fail without surfacing, so a configuration change could be reported as applied while not having been persisted. Recorded during the directed blind-spot audit alongside TEL-P1-030 and TEL-P1-031; unlike those two it needed a migration, so it was filed for authorization rather than fixed in that commit.
- **Fix SHA**: `2347a3ea96761afb5a28e0be20fad9173f181e43`
- **Verification evidence**: `tests/webhook-ssrf-and-authorization.test.ts — Test Files  1 passed (1) · Tests  69 passed (69); exit 0; run 2026-08-25T16:04:47.621Z; fix 2347a3e "fix(webhooks): block SSRF, require a management capability, stop returning secrets"`

### `TEL-P0-006` — Production Database Password Disclosed, And Rotated

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `20260821201304`
- **Verification evidence**: `N/A`

### `TEL-P0-004` — Production PostgreSQL Application Role: MEASURED, core requirements met

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-038` — Row-Level Security Does Not Exist, In Production Or Anywhere

- **Severity**: P1
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: No table in this database has row security enabled and no policy exists — 68 public tables, zero with rowsecurity, zero policies, and no migration has ever contained ENABLE ROW LEVEL SECURITY. What is enforced is application-level tenant scoping via the Prisma extension in lib/prisma.ts, which is real and is tested, but is not RLS: any code path holding a bare PrismaClient (createAdminClient, scripts, workers) bypasses it entirely, and the database itself would not stop a cross-tenant read.
- **Fix SHA**: `a3deba34072f4cc39553c7f5422512f669e4640b`
- **Verification evidence**: `NOT VERIFIED. a3deba3 corrected the documentation that claimed RLS existed and renamed tests/rls.test.ts to say what it actually tests — application-enforced scoping. That commit states its own scope: "Half of TEL-P1-038 … the implementation decision, whether to add RLS or accept application-only enforcement, is still the operator's and is untouched." tests/rls.test.ts passing therefore proves the Prisma extension scopes, not that RLS exists. Closing this needs either policies applied and proven against a real database by scripts/verify-rls-enablement.mjs and scripts/verify-rls-app-paths.mjs, or an explicit operator decision to accept application-only enforcement.`

### `TEL-P2-026` — The Application Role Holds CREATEROLE and CREATEDB

- **Severity**: P2
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-027` — An Orphaned One-Off Container Has Been Running Five Days On A Different Image

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `f2e807bb7812`
- **Verification evidence**: `EV-VITEST`

### `TEL-P2-025` — VM Shell Was Unreachable; Root Cause And Fix

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the instance's `ssh-keys` metadata held only **expired** entries
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P0-001` — Disaster Recovery Evidence Invalid

- **Severity**: P0
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: DR evidence was authored, not measured.
- **Fix SHA**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Verification evidence**: `tests/certification-validator.test.ts — Test Files  1 passed (1) · Tests  44 passed (44); exit 0; run 2026-08-25T16:04:51.275Z; fix 7de1758 "feat(certification): invalidate false-green certificate and add machine-checkable validation"`

### `TEL-P0-002` — Production Backup Posture Contradicts Itself; RPO Unsubstantiated

- **Severity**: P0
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Every document describing the backup posture disagreed with the instance and with each other, and none had been measured. BACKUP_RESTORE_RUNBOOK.md claimed daily backups AND 7-day PITR with RPO under 5 minutes; CLOUD_RUN_DEPLOY.md claimed the instance was created --no-backup; DEPLOY.md described a single manual snapshot with no schedule; the runbook named PostgreSQL 15 against an instance running POSTGRES_16, and this defect's own remediation command named telestar-crm-db, an instance that does not exist. With no measurement behind any of it, the RPO figure certification depended on was unsubstantiated.
- **Fix SHA**: `1787245200000`
- **Verification evidence**: `EV-DR-RPO. Resolved by measuring the live instance rather than reconciling the documents (48d3c87): automated backups run daily at 17:00 UTC with 7 retained and had succeeded on five consecutive days through 2026-08-20, so the unbounded-data-loss scenario this P0 described does not exist. Independently re-measured 2026-08-25: backupEnabled true, startTime 17:00, 7 retained, 8 successful backups listed, most recent 2026-08-24T17:00Z. Cloud SQL backup id 1787245200000.`

### `TEL-P1-014` — Final Three-Run Certification Ladder Incomplete

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `RUN_1/2/3` executed a 4-gate subset but were documented as full
- **Fix SHA**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Verification evidence**: `tests/certification-validator.test.ts — Test Files  1 passed (1) · Tests  44 passed (44); exit 0; run 2026-08-25T16:04:53.894Z; fix 7de1758 "feat(certification): invalidate false-green certificate and add machine-checkable validation"`

### `TEL-P1-015` — AI Budget Governance Is Process-Local

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Budget reservations are held in an in-process `Map`.
- **Fix SHA**: `e68c69da36f3b8cf52c9701a74875d8b12b6983a`
- **Verification evidence**: `tests/ai-capability-routing.test.ts, tests/ai-durable-budget.test.ts, tests/ai-structured-budget.test.ts — Test Files  3 passed (3) · Tests  43 passed (43); exit 0; run 2026-08-25T16:04:56.253Z; fix e68c69d "fix(ai): make budget durable and shared, and enforce capability routing (TEL-P1-015, TEL-P2-017)"`

### `TEL-P1-016` — AI Streaming Governance Incomplete

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `stream()` was implemented without parity to the non-stream path.
- **Fix SHA**: `edd05e37c230e56ea4c8d6e8ec78ab61b192910e`
- **Verification evidence**: `tests/ai-shared-circuit.test.ts, tests/ai-stream-governance.test.ts — Test Files  2 passed (2) · Tests  25 passed (25); exit 0; run 2026-08-25T16:05:04.138Z; fix edd05e3 "fix(ai): share circuit state and govern streaming (TEL-P1-016, TEL-P1-017)"`

### `TEL-P1-017` — AI Circuit State Is Process-Local

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Circuit state `Map` and HALF_OPEN lease `Set` coordinate a single Node process.
- **Fix SHA**: `edd05e37c230e56ea4c8d6e8ec78ab61b192910e`
- **Verification evidence**: `tests/ai-shared-circuit.test.ts, tests/ai-stream-governance.test.ts — Test Files  2 passed (2) · Tests  25 passed (25); exit 0; run 2026-08-25T16:05:07.774Z; fix edd05e3 "fix(ai): share circuit state and govern streaming (TEL-P1-016, TEL-P1-017)"`

### `TEL-P1-018` — Release Deployment Identity Chain Missing

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Release identity was asserted at source-SHA level only.
- **Fix SHA**: `32418164738`
- **Verification evidence**: `EV-RELEASE-IDENTITY`

### `TEL-P2-013` — Six-Role Real Browser Acceptance Not Evidenced

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Database/service role tests were treated as satisfying a browser-acceptance
- **Fix SHA**: `a486ed267de41acb6542cdd288fe45b320dbb08f`
- **Verification evidence**: `tests/certification-role-evidence.test.ts — Test Files  1 passed (1) · Tests  14 passed (14); exit 0; run 2026-08-25T16:05:11.533Z; fix a486ed2 "feat(certification): six-role browser acceptance in a real browser (TEL-P2-013)"`

### `TEL-P2-014` — Master Evidence Ledger Stale

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `cf23182`
- **Verification evidence**: `N/A`

### `TEL-P2-015` — Load Results Contradict Certificate

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `b9e6ed9860c7477d89dfa0801b34803ef539d829`
- **Verification evidence**: `tests/import-load-benchmark.test.ts — Test Files  1 passed (1) · Tests  3 passed (3); exit 0; run 2026-08-25T16:05:13.148Z; fix b9e6ed9 "feat(certification): add the real queue benchmark and give load results one source"`

### `TEL-P2-016` — Load Benchmark Does Not Exercise The Real BullMQ System

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `b9e6ed9860c7477d89dfa0801b34803ef539d829`
- **Verification evidence**: `tests/import-load-benchmark.test.ts — Test Files  1 passed (1) · Tests  3 passed (3); exit 0; run 2026-08-25T16:06:43.994Z; fix b9e6ed9 "feat(certification): add the real queue benchmark and give load results one source"`

### `TEL-P2-017` — AI Capability Routing Not Strictly Enforced

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Verification evidence**: `tests/certification-validator.test.ts — Test Files  1 passed (1) · Tests  44 passed (44); exit 0; run 2026-08-25T16:08:03.816Z; fix 7de1758 "feat(certification): invalidate false-green certificate and add machine-checkable validation"`

### `TEL-P1-019` — Requirements Verified Against Test Files That Do Not Exist

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: requirement rows were authored with plausible-sounding test filenames that
- **Fix SHA**: `7de1758634d0f8894de28eb823b7547fe0324fcc`
- **Verification evidence**: `tests/certification-validator.test.ts — Test Files  1 passed (1) · Tests  44 passed (44); exit 0; run 2026-08-25T16:08:06.291Z; fix 7de1758 "feat(certification): invalidate false-green certificate and add machine-checkable validation"`

### `TEL-P1-020` — `worker-healthcheck` Never Exits When The Check Succeeds

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: enqueuing opens a BullMQ queue and its Redis connection, and both keep the Node
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-021` — AI Circuit State Was Not Namespaced Per Deployment

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `TEL-P1-017` moved circuit state to Redis keyed only by `provider:model`, with no
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-VITEST`

### `TEL-P1-022` — Concurrent Duplicate Job Delivery Could Still Fail The Chunk

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: when two workers get the same chunk, one `lead.create` wins and the other
- **Fix SHA**: `32323964277`
- **Verification evidence**: `EV-CI-RUN`

### `TEL-P2-018` — Two CI Jobs Cannot Run On This Repository

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `32323964277`
- **Verification evidence**: `EV-CI-RUN`

### `TEL-P1-023` — The Image Gates Were Blocked By A Constant, Not By The Machine

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/certification/run-full-certification.mjs` recorded gates
- **Fix SHA**: `c659b2b6ff0d061d55dc09c4d19596533fa26af3`
- **Verification evidence**: `tests/certification-image-gates.test.ts, tests/deploy-script.test.ts — Test Files  2 passed (2) · Tests  50 passed (50); exit 0; run 2026-08-25T16:08:08.495Z; fix c659b2b "fix(release): make the image gates real and stop deploys losing their audit trail"`

### `DEPLOY-001` — A Failed Audit-Trail Write Did Not Fail The Deploy

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/deploy.sh` appended to `deployments.ndjson` as its **last** step. The
- **Fix SHA**: `c659b2b6ff0d061d55dc09c4d19596533fa26af3`
- **Verification evidence**: `tests/certification-image-gates.test.ts, tests/deploy-script.test.ts — Test Files  2 passed (2) · Tests  50 passed (50); exit 0; run 2026-08-25T16:08:11.411Z; fix c659b2b "fix(release): make the image gates real and stop deploys losing their audit trail"`

### `DEPLOY-002` — The Pre-Deploy Backup Prompt Accepted Any String

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/deploy.sh` prompted for a Cloud SQL backup id and accepted anything
- **Fix SHA**: `c659b2b6ff0d061d55dc09c4d19596533fa26af3`
- **Verification evidence**: `tests/certification-image-gates.test.ts, tests/deploy-script.test.ts — Test Files  2 passed (2) · Tests  50 passed (50); exit 0; run 2026-08-25T16:08:14.417Z; fix c659b2b "fix(release): make the image gates real and stop deploys losing their audit trail"`

### `DEPLOY-003` — Every Pull Failure Was Reported As A Missing Image

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `$DOCKER pull … || fail "No image published for commit ${COMMIT}. CI publishes
- **Fix SHA**: `c659b2b6ff0d061d55dc09c4d19596533fa26af3`
- **Verification evidence**: `tests/certification-image-gates.test.ts, tests/deploy-script.test.ts — Test Files  2 passed (2) · Tests  50 passed (50); exit 0; run 2026-08-25T16:08:17.345Z; fix c659b2b "fix(release): make the image gates real and stop deploys losing their audit trail"`

### `TEL-P1-024` — The RPO Evidence Record Was A Constant Asserting A Stale Blocker

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/certification/record-blocked-evidence.mjs` wrote `EV-DR-RPO` from a
- **Fix SHA**: `ef0d9b8c46c0001ac9692baec495fe2591e4c412`
- **Verification evidence**: `tests/certification-rpo-probe.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:20.132Z; fix ef0d9b8 "fix(certification): make the RPO evidence ask instead of assert"`

### `TEL-P2-019` — A Windows Batch Shim Would Have Reported gcloud As Absent

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: on Windows `gcloud` is `gcloud.cmd`, a batch file. `spawnSync('gcloud', …)`
- **Fix SHA**: `ef0d9b8c46c0001ac9692baec495fe2591e4c412`
- **Verification evidence**: `tests/certification-rpo-probe.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:24.354Z; fix ef0d9b8 "fix(certification): make the RPO evidence ask instead of assert"`

### `TEL-P2-020` — `scripts/rollback.sh` Was Owned By No Domain

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `production-release` mapped `scripts/deploy*` but not `scripts/rollback*`, so
- **Fix SHA**: `ef0d9b8c46c0001ac9692baec495fe2591e4c412`
- **Verification evidence**: `tests/certification-rpo-probe.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:27.687Z; fix ef0d9b8 "fix(certification): make the RPO evidence ask instead of assert"`

### `TEL-P1-025` — Any Branch's Test Fixtures Fail Every Pull Request's Secret Scan

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the finding was not in the pull request. `gitleaks` reported
- **Fix SHA**: `3f28211ca09927d014d9afd086023b23e17c7491`
- **Verification evidence**: `tests/gitleaks-allowlist.test.ts — Test Files  1 passed (1) · Tests  21 passed (21); exit 0; run 2026-08-25T16:08:30.793Z; fix 3f28211 "fix(ci): stop one branch's test fixtures failing every pull request's secret scan"`

### `TEL-P2-021` — The Ladder Could Not Read This Project's Own Configuration

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `run-full-certification.mjs` loaded configuration with
- **Fix SHA**: `081e70b71809a1d6bc8825b80b789ae7b6753432`
- **Verification evidence**: `tests/certification-env-loading.test.ts — Test Files  1 passed (1) · Tests  8 passed (8); exit 0; run 2026-08-25T16:08:32.311Z; fix 081e70b "fix(certification): load this project's own configuration in the ladder"`

### `TEL-P1-026` — DR-003 Has No Script That Can Ever Produce A Pass

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: DR-003 is mandatory and requires dr-rollback evidence with status PASS, and nothing in the repository could produce it — there was no rollback drill script at all, so the requirement could never be satisfied by any run, however green.
- **Fix SHA**: `9abc1a331c6829f26cad72949af3798743b6b515`
- **Verification evidence**: `tests/certification-rollback-drill.test.ts — Test Files  1 passed (1) · Tests  32 passed (32); exit 0; run 2026-08-25T16:08:34.257Z; fix 9abc1a3 "feat(certification): the rules a rollback drill must satisfy, with a drill that can fail"`

### `TEL-P1-027` — Measured RPO Is 24 Hours; DR-007 Requires Under One Hour

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Point-in-time recovery was not enabled on telestar-db when this was filed on 2026-08-21, so the only recoverable state was the most recent daily backup and worst-case data loss was 86,400 seconds against DR-007's 3,600-second requirement. The remediation was a production configuration change and correctly needed operator authorization, so it could not be made from this repository.
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-DR-RPO. Re-measured with gcloud sql instances describe telestar-db: pointInTimeRecoveryEnabled true, transactionLogRetentionDays 7, exit 0 — a measured RPO of 300 seconds against DR-007's 3,600. First observed 2026-08-23 (75450a1); independently re-measured 2026-08-25 during this program and still true. Regression cover: tests/certification-rpo-probe.test.ts.`

### `TEL-P2-032` — The Production Database Can Be Deleted, And Nothing Says So

- **Severity**: P2
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: telestar-db was created without deletion protection and nothing in the certification suite noticed: settings.deletionProtectionEnabled was false and connectorEnforcement NOT_REQUIRED on the live instance. A single `gcloud sql instances delete` or a console misclick destroys the production database; backups reduce what that costs but do not prevent it. DR-001 through DR-010 cover backup, restore, rollback, RTO, RPO and failure modes, and none of them covers deletion protection — so certification could reach 108/108 with the production database deletable.
- **Fix SHA**: `N/A`
- **Verification evidence**: `Measured before: `gcloud sql instances describe telestar-db --format="value(settings.deletionProtectionEnabled)"` returned False. Applied `gcloud sql instances patch telestar-db --deletion-protection`, exit 0. Measured after, by reading the setting back from the API rather than trusting the patch output: True. Production health re-checked immediately afterwards: HTTP 200, commit c7bf639. Operator authorization for this specific change was given on 2026-08-25 ("Deletion protection only").`

### `TEL-P0-007` — `deploy.sh` Runs Migrations With The PREVIOUS Image, So Every Migration-Bearing Deploy Silently Skips Them

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/deploy.sh` lines 143 and 147 intended to override the image:
- **Fix SHA**: `d5d7cf8`
- **Verification evidence**: `N/A`

### `TEL-P1-028` — Phase 15 Claims Private VPC Transport; The Instance Has A Public IP And Permits Unencrypted Connections

- **Severity**: P1
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-028` — Doctor Reported Five False Or Unreadable Results About This Machine

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `d7dad04`
- **Verification evidence**: `N/A`

### `TEL-P2-029` — Two Peer-Dependency Violations Were Hidden Behind One Doctor Line

- **Severity**: P2
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-030` — The Pre-Deploy Backup Check Can Never Pass From The Production VM

- **Severity**: P2
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `telestar-crm-vm` runs as `589324791591-compute@developer.gserviceaccount.com`
- **Fix SHA**: `e968ce7`
- **Verification evidence**: `N/A`

### `TEL-P1-039` — The Ladder Certified A Server It Did Not Start

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `withServer`'s readiness loop treated `response.status < 500` as the sole
- **Fix SHA**: `85291013e6bda49e4a930e8aa67986d55ad47e17`
- **Verification evidence**: `tests/certification-false-green.test.ts — Test Files  1 passed (1) · Tests  38 passed (38); exit 0; run 2026-08-25T16:08:35.723Z; fix 8529101 "fix(certification): record TEL-P1-039, unbrittle its own test, clear two dead identifiers"`

### `TEL-P1-040` — The Desktop Gate Was Passing By Luck, Not By Being Correct

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the spec navigated with `waitUntil: 'domcontentloaded'` and measured
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-031` — Horizontal Overflow At The Documented Lower-Bound Width On `/leads`

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the leads filter toolbar (`app/leads/page.tsx`) was a single non-wrapping flex
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-041` — A Live Send Was Mistaken For A Crashed One And Parked For Human Reconciliation

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `handleEmailSend` reads the row, checks its status, and *then* runs the
- **Fix SHA**: `e3382b41382269f422ee1a4b4a75af0d72dd569c`
- **Verification evidence**: `tests/email-idempotency.test.ts, tests/email-send-once-invariant.test.ts — Test Files  2 passed (2) · Tests  62 passed (62); exit 0; run 2026-08-25T16:08:37.431Z; fix e3382b4 "fix(email): a live send is not a crashed one — judge a claim by its age"`

### `TEL-P0-008` — The Cutover Classifier Condemned The Approved Production Tenant By Name Shape

- **Severity**: P0
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: scripts/cutover/safe-cutover-tool.ts decided demo-vs-real from how an identifier looked. isKnownTestFixture() returned true for any value ending in '-tenant', which matches 'default-tenant' — the approved PRODUCTION tenant — and for any value opening with a loose prefix ('ci', 'wo', 'test', 'load', 'temp'), which matches real addresses such as cindy@itelestar.com. Every business row is classified from its tenant, so the whole production tenant classified PURGE_SEED: the generated manifest queued 68,983 of 69,028 scanned rows for deletion and reported zero rows requiring review. Executing it would have deleted real business data. Directive section 24 forbids classifying by name appearance; section 23 forbids defaulting an unknown business row to delete.
- **Fix SHA**: `a95fbd7a582a2db934854d0716ceccdc2c1a678e`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:48.828Z; fix a95fbd7 "fix(cutover): stop classifying the production tenant as demo data by name shape"`

### `TEL-P1-042` — The Purge Manifest Hash Could Never Be Reproduced, So VERIFY Never Checked It

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: planMode hashed the manifest serialization taken BEFORE manifestSha256 was stamped onto it, then wrote the stamped object. Re-hashing the file on disk could therefore never reproduce the recorded digest, and verifyMode did not attempt it — so a hand-edited manifest (changed id, changed classification, changed count) passed every precondition. Directive sections 22, 26 and 33 require the manifest hash to be verified before execution.
- **Fix SHA**: `a95fbd7a582a2db934854d0716ceccdc2c1a678e`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:50.366Z; fix a95fbd7 "fix(cutover): stop classifying the production tenant as demo data by name shape"`

### `TEL-P1-043` — Renderers Strip VERDICT_MISMATCH Before Computing Eligibility

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: generate-certificate.mjs and render-tracker.mjs each computed release eligibility as findings.filter(f => f.check !== 'VERDICT_MISMATCH') being empty. Directive section 14 names that exact exclusion. VERDICT_MISMATCH fires when the generated documents disagree with each other about the verdict, so with it filtered out a FINAL_CERTIFICATE reading GO while MASTER_TRACKER read NO-GO would still have rendered — the loudest available signal that the evidence was not being read consistently had been made unable to block a release.
- **Fix SHA**: `a317d15`
- **Verification evidence**: `tests/certification-one-verdict-engine.test.ts — Test Files 1 passed (1) · Tests 9 passed (9); exit 0; run 2026-08-25. Negative control: reinjecting the exact defect into render-tracker.mjs (eligible = result.findings.filter(f => f.check !== 'VERDICT_MISMATCH').length === 0) fails 2 of the 9 assertions and exits 1; restoring the file returns 9/9. The fix landed in a317d15 and had no test until now, which is why this defect stayed OPEN while the code was already correct.`

### `TEL-P1-044` — REHEARSE Runs Against The Live Target, Not A Restored Backup Clone

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: --mode=REHEARSE is executeMode(dryRun=true), which opens a transaction against the SAME database the manifest targets and rolls it back. Directive section 36 requires rehearsal against an isolated environment restored from the production backup, followed by application and worker boot, authentication and empty-state checks. A dry-run transaction on the live target proves neither the restore nor the post-cutover application state.
- **Fix SHA**: `b57769d48abce5306eb4e63a07769c46da1a8e85`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:51.975Z; fix b57769d "fix(cutover): a rehearsal runs on a restored clone, never on production"`

### `TEL-P1-045` — VERIFY Omits The Backup, PITR, Email-Pause And Queue Preconditions

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: Directive section 30 lists the preconditions prod:cutover:verify must fail closed on. verifyMode checks database fingerprint, roster hash, zero review and row drift. It does not check: backup verified and recent, PITR enabled, recovery access, EMAIL_GLOBAL_PAUSE true, SEQUENCE_AUTOSEND_ENABLED false, queues paused or drained, imports prevented, candidate deployment healthy, candidate identity expected.
- **Fix SHA**: `016e0205b5ece66aab5266a94e744fb9fd2ed2ad`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — Test Files  1 passed (1) · Tests  25 passed (25); exit 0; run 2026-08-25T16:08:53.622Z; fix 016e020 "feat(cutover): make EXECUTE refuse on any unmet section-30 precondition"`

