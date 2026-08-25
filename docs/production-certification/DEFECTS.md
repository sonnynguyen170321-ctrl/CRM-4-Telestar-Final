# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Authoritative Source**: `docs/production-certification/defects.json`
**Last Updated**: 2026-08-25T09:58:45.105Z

> **Closure rule.** A defect moves `OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`
> only. `VERIFIED` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under `docs/production-certification/evidence/`. "Fix implemented" is
> **not** `VERIFIED`.

---

## 1. Defect Summary

| Severity | Discovered | Verified Closed | Accepted Risk | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 7 | 1 | 0 | **6** |
| **P1** (Critical) | 34 | 1 | 0 | **33** |
| **P2** (Important) | 21 | 1 | 0 | **20** |
| **P3** (Minor Polish) | 0 | 0 | 0 | **0** |
| **TOTAL** | **62** | **3** | **0** | **59** |

---

## 2. Defects Ledger

### `TEL-P2-024` — A Redelivered Bounce Webhook Recorded The Same Bounce Twice

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `handleApplyBounce` writes its timeline `Activity` **unconditionally**, before
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-023` — The Send-Once Invariant Was Only Ever Tested Against A Mocked Compare-And-Set

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `tests/email-worker.test.ts` mocks `@/lib/prisma` **entirely**, including
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-037` — A Signing Secret Generated With `Math.random()`

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the rewritten webhook test endpoint generated its throwaway signing value with
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-034` — The Health Gate Passed On 401, 403, 404, A Login Redirect, And The Wrong Release

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: gate 22 decided everything on one line — `if (response.status >= 500) ok = false;`.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-035` — Playwright Skips Were Invisible To The Certifier

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `mandatorySkips = (vitest?.testsSkipped ?? 0) + (redisGate?.metrics?.skipped ?? 0)`.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-036` — The Rollback Drill Let The Caller Define What Correct Meant

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `evaluateDrill` compared each phase's observed health against
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-033` — A Test Guarding A Secret Printed It, And Depended On The Ambient Environment

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-022` — `lib/authRoles.ts` Was Owned By No Domain

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `auth-rbac-tenancy` maps `lib/auth.ts` and `lib/auth/**`, and the new module
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P0-005` — API Keys Authenticated As Managers Regardless Of Who Created Them

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `getSessionUser()` in `lib/auth.ts` has two authentication paths that had
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-029` — Demo Diagnostics Endpoint Readable Against Live Tenants, Without Object Authorization

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `app/api/demo/diagnostics/route.ts` gated on `requireAuth()` and a tenant
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-030` — Webhook Delivery Was Server-Side Request Forgery With A Response Oracle

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `deliverWebhook()` called `fetch(url)` with no validation. The only check
- **Fix SHA**: `2130706433`
- **Verification evidence**: `N/A`

### `TEL-P1-031` — Webhook Administration Needed Only Authentication, And Read Back Signing Secrets

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `GET`, `POST` and `DELETE` on `/api/webhooks` — and `POST /api/webhooks/test`
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-032` — Webhook Configuration Has No Durable Authority And Writes Can Fail Silently

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

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
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: DR evidence was authored, not measured.
- **Fix SHA**: `6973d111`
- **Verification evidence**: `EV-DR-BACKUP`

### `TEL-P0-002` — Production Backup Posture Contradicts Itself; RPO Unsubstantiated

- **Severity**: P0
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `1787245200000`
- **Verification evidence**: `EV-DR-RPO`

### `TEL-P1-014` — Final Three-Run Certification Ladder Incomplete

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `RUN_1/2/3` executed a 4-gate subset but were documented as full
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-015` — AI Budget Governance Is Process-Local

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Budget reservations are held in an in-process `Map`.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-016` — AI Streaming Governance Incomplete

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `stream()` was implemented without parity to the non-stream path.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-017` — AI Circuit State Is Process-Local

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Circuit state `Map` and HALF_OPEN lease `Set` coordinate a single Node process.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: Database/service role tests were treated as satisfying a browser-acceptance
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-ROLE-BROWSER`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-LOAD-HANDLER`

### `TEL-P2-016` — Load Benchmark Does Not Exercise The Real BullMQ System

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-017` — AI Capability Routing Not Strictly Enforced

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-019` — Requirements Verified Against Test Files That Do Not Exist

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: requirement rows were authored with plausible-sounding test filenames that
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/certification/run-full-certification.mjs` recorded gates
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `DEPLOY-001` — A Failed Audit-Trail Write Did Not Fail The Deploy

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/deploy.sh` appended to `deployments.ndjson` as its **last** step. The
- **Fix SHA**: `353f650`
- **Verification evidence**: `N/A`

### `DEPLOY-002` — The Pre-Deploy Backup Prompt Accepted Any String

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/deploy.sh` prompted for a Cloud SQL backup id and accepted anything
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `DEPLOY-003` — Every Pull Failure Was Reported As A Missing Image

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `$DOCKER pull … || fail "No image published for commit ${COMMIT}. CI publishes
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-024` — The RPO Evidence Record Was A Constant Asserting A Stale Blocker

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `scripts/certification/record-blocked-evidence.mjs` wrote `EV-DR-RPO` from a
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-DR-RPO`

### `TEL-P2-019` — A Windows Batch Shim Would Have Reported gcloud As Absent

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: on Windows `gcloud` is `gcloud.cmd`, a batch file. `spawnSync('gcloud', …)`
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P2-020` — `scripts/rollback.sh` Was Owned By No Domain

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `production-release` mapped `scripts/deploy*` but not `scripts/rollback*`, so
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-025` — Any Branch's Test Fixtures Fail Every Pull Request's Secret Scan

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: the finding was not in the pull request. `gitleaks` reported
- **Fix SHA**: `5d46eaa`
- **Verification evidence**: `N/A`

### `TEL-P2-021` — The Ladder Could Not Read This Project's Own Configuration

- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `run-full-certification.mjs` loaded configuration with
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-026` — DR-003 Has No Script That Can Ever Produce A Pass

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-DR-ROLLBACK`

### `TEL-P1-027` — Measured RPO Is 24 Hours; DR-007 Requires Under One Hour

- **Severity**: P1
- **Status**: `VERIFIED`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-DR-RPO`

### `TEL-P2-032` — The Production Database Can Be Deleted, And Nothing Says So

- **Severity**: P2
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: N/A
- **Fix SHA**: `N/A`
- **Verification evidence**: `EV-DR-RPO`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `withServer`'s readiness loop treated `response.status < 500` as the sole
- **Fix SHA**: `063d49e`
- **Verification evidence**: `N/A`

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
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-22T00:00:00.000Z
- **Root cause**: `handleEmailSend` reads the row, checks its status, and *then* runs the
- **Fix SHA**: `a6d8c0d`
- **Verification evidence**: `N/A`

### `TEL-P0-008` — The Cutover Classifier Condemned The Approved Production Tenant By Name Shape

- **Severity**: P0
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: scripts/cutover/safe-cutover-tool.ts decided demo-vs-real from how an identifier looked. isKnownTestFixture() returned true for any value ending in '-tenant', which matches 'default-tenant' — the approved PRODUCTION tenant — and for any value opening with a loose prefix ('ci', 'wo', 'test', 'load', 'temp'), which matches real addresses such as cindy@itelestar.com. Every business row is classified from its tenant, so the whole production tenant classified PURGE_SEED: the generated manifest queued 68,983 of 69,028 scanned rows for deletion and reported zero rows requiring review. Executing it would have deleted real business data. Directive section 24 forbids classifying by name appearance; section 23 forbids defaulting an unknown business row to delete.
- **Fix SHA**: `N/A`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — "Classification must not condemn a row by appearance (regression)", 6 cases`

### `TEL-P1-042` — The Purge Manifest Hash Could Never Be Reproduced, So VERIFY Never Checked It

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: planMode hashed the manifest serialization taken BEFORE manifestSha256 was stamped onto it, then wrote the stamped object. Re-hashing the file on disk could therefore never reproduce the recorded digest, and verifyMode did not attempt it — so a hand-edited manifest (changed id, changed classification, changed count) passed every precondition. Directive sections 22, 26 and 33 require the manifest hash to be verified before execution.
- **Fix SHA**: `N/A`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — "Manifest integrity (Sections 26, 33)", 2 cases; verifyMode now recomputes canonicalManifestHash and cross-checks summary counts against listed rows`

### `TEL-P1-043` — Renderers Strip VERDICT_MISMATCH Before Computing Eligibility

- **Severity**: P1
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: generate-certificate.mjs and render-tracker.mjs both filter findings with check !== 'VERDICT_MISMATCH' and then compute eligibility from what remains. Directive section 14 states VERDICT_MISMATCH must never be removed before eligibility is computed. Today other FAIL findings keep the verdict at NO-GO, so the effect is latent rather than active, but the path by which a document disagreement stops blocking release exists in the renderer.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-044` — REHEARSE Runs Against The Live Target, Not A Restored Backup Clone

- **Severity**: P1
- **Status**: `OPEN`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: --mode=REHEARSE is executeMode(dryRun=true), which opens a transaction against the SAME database the manifest targets and rolls it back. Directive section 36 requires rehearsal against an isolated environment restored from the production backup, followed by application and worker boot, authentication and empty-state checks. A dry-run transaction on the live target proves neither the restore nor the post-cutover application state.
- **Fix SHA**: `N/A`
- **Verification evidence**: `N/A`

### `TEL-P1-045` — VERIFY Omits The Backup, PITR, Email-Pause And Queue Preconditions

- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Owner**: core-team
- **Discovered**: 2026-08-25T00:00:00.000Z
- **Root cause**: Directive section 30 lists the preconditions prod:cutover:verify must fail closed on. verifyMode checks database fingerprint, roster hash, zero review and row drift. It does not check: backup verified and recent, PITR enabled, recovery access, EMAIL_GLOBAL_PAUSE true, SEQUENCE_AUTOSEND_ENABLED false, queues paused or drained, imports prevented, candidate deployment healthy, candidate identity expected.
- **Fix SHA**: `N/A`
- **Verification evidence**: `tests/safe-cutover-tool.test.ts — "Fail-closed preconditions (Section 30)", 7 cases; executeMode refuses on any unmet precondition before the first delete`

