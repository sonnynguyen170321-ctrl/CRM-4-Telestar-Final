# All-Green Acceptance Matrix

Independent QA / release audit of the Telestar CRM (`sonnynguyen170321-ctrl/CRM-4-Telestar-Final`).
This document is maintained by the auditor, not by the implementing agent. It records what is
*proven*, not what is *claimed*.

| Field | Value |
|---|---|
| Current baseline (BASE) | `c87b67e` — `origin/main`, merge of PR #67. **Post-merge CI #243 on this SHA is `failure`** — it reproduced the five weekend failures this audit found. |
| Current candidate (AUDIT) | `0e1986c` — head of PR #68, branch `all-green/production-hardening` |
| Matrix revision | **2** — see §9. Revision 1 (§1–§8) is kept verbatim as the historical record; two factual errors in it are corrected in place and labelled. |
| Audit dates | rev 1: 2026-08-15 (pre-merge, candidate `9cedaf7`) · rev 2: 2026-08-15 (post-merge, candidate `0e1986c`) |
| Superseded baseline | `2046b76` (rev 1 BASE) |
| Superseded candidate | `9cedaf7` — head of PR #67, **now merged**. Rev 1's REJECT stands as a record of why; it is no longer an open decision. |

---

## 1. Rules of evidence

A row is **GREEN** only when the claim is backed by an artefact the auditor executed or read
directly. The following are explicitly **not** accepted as evidence:

- a green CI run, on its own;
- a weakened or narrowed assertion;
- a raised timeout offered as a flake fix;
- a skipped, quarantined, or unmatched test;
- retry-to-green;
- a mocked/dry-run provider presented as proof of live provider behaviour;
- a document describing infrastructure, presented as proof the infrastructure exists;
- a configuration file or env var, presented as proof of runtime behaviour.

### Status legend

| Status | Meaning |
|---|---|
| **GREEN** | Implemented **and** proven by evidence the auditor executed or read. No known open defect. |
| **YELLOW** | Implemented and partially proven. A named dimension is missing, weak, or environment-dependent. Shippable with declared debt. |
| **RED** | Not proven, or proven broken. Blocks the all-green claim until resolved. |
| **N/A** | Dimension does not apply to this capability. |

### Dimension codes

`IMP` implementation · `UNI` unit test · `INT` integration / real-DB behaviour · `E2E` browser
journey · `RBAC` role enforcement · `TEN` tenant isolation · `NEG` negative path ·
`IDM` idempotency · `RET` retry / failure behaviour · `EXT` external dependency ·
`OBS` observability · `REC` recovery · `PRF` performance · `DOC` documentation.

A dimension listed under **Proven** was verified. A dimension under **Gap** was not.

---

## 2. Gate evidence — executed by the auditor

All commands run against the working tree at **`9cedaf7`** on Windows, Node from `.nvmrc`,
local PostgreSQL 16 (`postgresql-x64-16`, service `Running`). Exit codes captured from the tool
itself, never from a pipe.

| Gate | Command | Result | Verdict |
|---|---|---|---|
| Type check | `node node_modules/typescript/bin/tsc --noEmit --pretty false` | **exit 0**, 0 lines of output | PASS |
| Unit + integration | `node node_modules/vitest/vitest.mjs run` | **exit 1** — `Test Files 2 failed \| 107 passed \| 1 skipped (110)`, `Tests 5 failed \| 1601 passed \| 5 skipped (1611)` | **FAIL** |
| Failing files in isolation | `… run tests/phase-8-stabilization.test.ts tests/golden-journey.test.ts` | **exit 1** — `Test Files 2 failed (2)`, `Tests 5 failed \| 17 passed (22)` | **FAIL — reproduces in isolation, so not the known shared-database parallel-wipe flake** |
| Production build | `npm run build` | not executed by the auditor | UNVERIFIED |
| Playwright | `npx playwright test` | not executed by the auditor (needs Redis + a built server; no Redis on this host) | UNVERIFIED |
| Docker image | `docker buildx build` | not executed by the auditor (no Docker on this host) | UNVERIFIED |
| Migration replay | `prisma migrate diff --from-migrations … --exit-code` | not executed by the auditor (no shadow DB provisioned here) | UNVERIFIED |

### 2.1 The five reproduced failures

```
FAIL tests/golden-journey.test.ts > 8. the message that goes out carries the human wording…
  AssertionError: expected 'deferred' to be 'completed'   (golden-journey.test.ts:511)
FAIL tests/golden-journey.test.ts > 11. AI cannot resume outreach while the SDR owns the prospect
  AssertionError: expected +0 to be 1
FAIL tests/phase-8-stabilization.test.ts > S1 > releases lockedAt when OutboundMessage creation fails
  AssertionError: promise resolved "{ status: 'deferred', …(2) }" instead of rejecting
FAIL tests/phase-8-stabilization.test.ts > S1 > releases lockedAt when EMAIL_SEND enqueue fails
  AssertionError: promise resolved "{ status: 'deferred', …(2) }" instead of rejecting
FAIL tests/phase-8-stabilization.test.ts > S1 > retries idempotently after releasing lock without
  duplicate OutboundMessage or email
  AssertionError: promise resolved "{ status: 'deferred', …(2) }" instead of rejecting
```

Run clock at time of failure: `2026-08-15T04:27:22Z`, `getUTCDay() === 6` (**Saturday**);
`Asia/Ho_Chi_Minh` local time `8/15/2026, 11:27 AM` (**also Saturday**).

**Signature match.** `status: 'deferred'` where `'completed'` was expected is the *exact*
signature of the defect Agent A diagnosed and fixed in commit `1d47b6c`:
`lib/automation/eligibility.ts` applies `businessDayPolicy: 'skip_weekends'` even when a step's
send-window minutes are null, and the sequence worker resolves eligibility against real
wall-clock time (`workers/sequence.ts`, `now: new Date()`). That commit pinned the clock to a
Monday in **one** file. Measured clock-pinning coverage across the affected suites:

| Suite | `setSystemTime` present | Weekend-safe |
|---|---|---|
| `tests/sequence-ladder-execution.test.ts` | yes — file-level `beforeEach` (added in `1d47b6c`) | yes |
| `tests/sequence-execute.test.ts` | yes | yes |
| `tests/phase-8a-execution-lock.test.ts` | yes | yes |
| `tests/phase-8-stabilization.test.ts` | ~~yes, but only inside the `S1` describe~~ — **CORRECTED (rev 2):** at the failing SHA this file had **no** clock pin anywhere. The auditor read this line from a working tree that had already moved to Agent A's fix. Verified with `git cat-file -p c87b67e:tests/phase-8-stabilization.test.ts`. | **no** |
| `tests/golden-journey.test.ts` | **none** | **no** |

**Auditor's position.** The failures are reproduced, isolated, and deterministic on this host.
The root-cause attribution above is a *hypothesis* consistent with every observed fact and with
Agent A's own written diagnosis; it is not yet proven, because this host differs from CI
(Windows, local Postgres, no Redis, a `.env.local` present that CI does not have). Agent A must
either reproduce these five failures and fix the class, or produce evidence that refutes the
attribution. **Until then the candidate's green CI cannot be treated as reproducible**, and the
`Lint · types · tests` gate is calendar-dependent.

---

## 3. Acceptance matrix

### 3.1 Platform, runtime and tenancy

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| P1 | Tenant injection extension (`lib/prisma.ts`, `lib/tenant-inject.ts`) | YELLOW | IMP, UNI (`tenant-inject`, `tenant-context`), NEG (fails closed with no context in production), DOC | TEN at DB level is optional: `DB_RLS_ENFORCED` defaults **false**, so app-layer injection is the *only* isolation layer on any deployment that has not set it. Not proven on a live RLS-enabled database. |
| P2 | Postgres RLS policies (`supabase/rls.sql`, `scripts/verify-rls.mjs`) | YELLOW | IMP, UNI (`rls`, `rls-policy-coverage`), DOC (`docs/DEPLOY.md` §9) | Prisma migrations deliberately contain no `ENABLE`/`POLICY`; correctness depends on a manual re-apply after every tenant-owned table added. No CI gate proves the applied policy set matches the schema. REC unproven. |
| P3 | Worker tenant resolution (`resolveWorkerJobTenant`, `wrapProcessor`) | YELLOW | IMP, UNI (`tests/bullmq.test.ts`, added in `d8a9f67`) | Every worker job then runs under `bypassRls: true` for its whole lifetime — DB-level isolation contributes nothing inside workers by design. The new test does not discriminate the new implementation from the old one (see §5.1), so it is not a red-green regression test for the failure it was written for. |
| P4 | Auth / session (`auth.ts`, `authVersion` revocation, login throttle) | GREEN | IMP, UNI (`session-revocation`, `login-throttle`, `create-user`, `create-admin`), E2E (`e2e/auth/*`), NEG | — |
| P5 | Role hierarchy + pod scoping (`lib/permissions.ts`, `lib/podScoping.ts`) | GREEN | IMP, UNI (`podScoping`, `access-control`, `role-journeys`, `phase-9-role-surfaces`), E2E (`e2e/roles/role-negative-access.spec.ts`), RBAC, NEG | PRF unmeasured on deep hierarchies. |
| P6 | Cross-tenant isolation, browser level | YELLOW | E2E (`e2e/roles/tenant-isolation.spec.ts`) | Spec exists and is matched by the `audit` project, but the auditor did not execute Playwright. Unverified at this SHA. |
| P7 | CSP / security headers (`lib/security/csp.ts`) | YELLOW | IMP, UNI (`tests/csp.test.ts`) | No root `middleware.ts`; header application per route not proven at runtime. External font CDN (`fonts.gstatic.com`) is now *allowlisted out* of the E2E console/network assertions (see §5.3) — the app fetches from a third-party CDN that the CSP discussion in the rules says to avoid. |
| P8 | Secret hygiene | GREEN | CI `Secret scan` job (gitleaks v8.28.0, pinned by SHA) is a required check; `tests/gitleaks-allowlist.test.ts` guards the allowlist | — |

### 3.2 Background workers and queueing

Eight workers registered in `workers/index.ts`: `healthcheck`, `sequence`, `email`,
`notification`, `maintenance`, `sync`, `import`, `agent`.

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| W1 | BullMQ enqueue / `JobRun` ledger | YELLOW | IMP, UNI (`bullmq`, `queue-reconciliation`, `redis-readiness`), OBS (`JobRun` progress written by `wrapProcessor`) | EXT: `tests/redis-integration.test.ts` is the only suite touching a real Redis and it **skipped** in the auditor's run (1 skipped file / 5 skipped tests). Real-Redis behaviour unverified here. |
| W2 | Sequence worker | RED | IMP, UNI (`sequence-worker`, `sequence-execute`, `sequence-ladder*`, `defer-scheduling`) | Its own integration suites `golden-journey` and `phase-8-stabilization` **fail on this host** (§2.1). Execution outcome is wall-clock dependent. |
| W3 | Email worker | YELLOW | IMP, UNI (`email-worker`, `email-idempotency`, `email-safety`), IDM | EXT: every non-Redis suite mocks the provider. No live-provider proof exists, and none should be produced under the current operating restrictions — so this dimension stays permanently YELLOW until a controlled live test is authorised. |
| W4 | Import worker | YELLOW | IMP, UNI (`import-worker`, `import-rows`), OBS (`scripts/diagnose-import.mjs`), readiness probe (`scripts/verify-import-worker.ts`) | Account/contact resolution is find-then-create inside an interactive transaction at `{ concurrency: 3 }`, with **no `P2002` handling** (`grep P2002 workers/import.ts` → no match). The three regression tests that pinned the race and the "blank field must not null out a prior value" data-integrity property were **deleted** in `934bf05` (§5.2). |
| W5 | Notification worker | GREEN | IMP, UNI (`notification-worker`, `notif-prefs`) | PRF unmeasured. |
| W6 | Maintenance worker | GREEN | IMP, UNI (`maintenance-worker`, `phase-8a-maintenance-occurrence`) | — |
| W7 | Sync worker (inbox / replies) | YELLOW | IMP, UNI (`sync-worker`, `phase-8b-replies`, `bounceDetection`) | EXT: IMAP (`imapflow`) and Gmail (`googleapis`) adapters are mocked throughout. No live-mailbox proof. |
| W8 | Agent worker | YELLOW | IMP, UNI (`agent-runtime-integration`, `work-order-*` ×6, `agent-sla-priority`), RET (lease fencing, retryable research errors) | No E2E. REC after a lease-expiry storm unproven. |
| W9 | Worker health surface (`/admin/worker-health`, `/api/admin/worker-health`) | YELLOW | IMP, OBS | Not covered by any executed E2E in this audit. |

### 3.3 Automation engine

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| A1 | Single scheduling authority (`lib/automation/scheduling.ts`) | GREEN | IMP, UNI (`scheduling`, `businessDays`, `eligibility`), DOC | — |
| A2 | Send-window / business-day policy | YELLOW | IMP, UNI | The policy is correct; the **test suites around it are not clock-independent**. Two suites read real wall-clock time (§2.1). This is a test-determinism defect, not a product defect. |
| A3 | Seeded jitter + A/B variant selection from durable ids | GREEN | IMP, UNI (`sequence-ladder`, `variant-attribution`), DOC | — |
| A4 | Quota exhaustion is `DEFER`, preflight before reservation | GREEN | IMP, UNI (`eligibility`, `defer-scheduling`) | — |
| A5 | Execution lock / stranded-lock release | RED | IMP, UNI (`phase-8a-execution-lock` passes) | `phase-8-stabilization` **S1 fails 3/3** on this host — the three tests that prove `lockedAt` is released on failure and that retry is idempotent. IDM and RET are therefore **unproven** at this SHA. |
| A6 | Schedule-drift repair (`repairEnrollmentScheduleDrift`) | YELLOW | IMP, UNI (`phase-8-stabilization` S2 passes), REC | Claimed closed in `8580140`; that commit changed a status document only. |
| A7 | Enrollment lifecycle / auto-unenrollment | GREEN | IMP, UNI (`lifecycle-integration`, `phase-8a-lifecycle-routes`, `phase-8a-resume-convergence`) | — |

### 3.4 Email and deliverability

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| E1 | Outbound kill switches (`lib/emailSafety.ts`) | GREEN | IMP (read line by line: both flags fail **closed** — dry-run ON unless literally `"false"`, autosend OFF unless literally `"true"`), UNI (`email-safety`), DOC | Documented carve-out, not a defect but a real exposure: the sequence-engine **cron route** calls `EmailService.send()` directly and `EMAIL_SEND_DRY_RUN` **does not apply there**. On a deployment with no worker, `SEQUENCE_AUTOSEND_ENABLED` is the only guard. |
| E2 | `OutboundMessage` as the single send ledger | GREEN | IMP, UNI (`email-idempotency`, `variant-attribution`), IDM | — |
| E3 | Suppression / bounce handling | YELLOW | IMP, UNI (`bounceDetection`, `email-health-scoring`) | EXT unproven (no live bounce). |
| E4 | Email health + auto-pause (13 API routes) | YELLOW | IMP, UNI (`email-health-p8`, `email-health-access`, `email-health-scoring`), RBAC (`email-health-access`) | No E2E directory `e2e/email/` exists despite the Playwright `audit` project matching one — the pattern matches nothing. |
| E5 | Provider adapters — Gmail/OAuth, Microsoft, IMAP/SMTP | YELLOW | IMP, UNI (`email-oauth`) | EXT: all mocked. `googleapis`, `imapflow`, `nodemailer` never exercised against a real endpoint in any gate. |
| E6 | Manual send idempotency | GREEN | IMP, UNI (`email-idempotency`), IDM | — |

### 3.5 CRM core

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| C1 | Leads — kanban/list, slide-over, CRUD | GREEN | IMP, UNI, E2E (`e2e/leads/lead-crud`, `filters-and-scope`, `dashboard-counters`), RBAC | Not executed in this audit; specs exist and are matched by the `audit` project. |
| C2 | Tasks / dashboard | YELLOW | IMP, UNI | E2E only indirect (`deep-smoke`). |
| C3 | Sequences UI + builder | YELLOW | IMP, UNI (`sequence-step-copy`, `sequence-analytics`) | `e2e/sequences/` does not exist — the `audit` project's `sequences` pattern matches nothing. |
| C4 | Templates | YELLOW | IMP | No dedicated unit suite found; no E2E. |
| C5 | Notes / reminders / notifications | GREEN | IMP, UNI (`notif-prefs`, `notification-worker`) | — |
| C6 | Meetings → opportunity handoff | GREEN | IMP, UNI (`meetings`, `opportunities`, `opportunity-handoff`), E2E (`e2e/meetings/meeting-to-opportunity.spec.ts`) | Not executed in this audit. |
| C7 | Search | YELLOW | IMP, UNI (`search-terms`) | PRF unmeasured; no E2E. |
| C8 | CSV import (API + worker path) | YELLOW | see W4 | see W4 |

### 3.6 Admin Control Center

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| M1 | Users / teams / clients / campaign membership | GREEN | IMP, UNI (`admin`, `admin-org`, `admin-org-rules`, `admin-overview`), E2E (`e2e/admin/*` ×3), RBAC | Not executed in this audit. |
| M2 | Impact check — 409 unless a handling mode + reason is supplied | GREEN | IMP, UNI (`admin-impact`), NEG, DOC | — |
| M3 | Work transfer | YELLOW | IMP, UNI (`admin-impact`), REC (idempotent-resumable by design) | Deliberately non-transactional. Five stale-attribution columns are disclosed but never rewritten, and four have no FK — a documented, accepted data-integrity gap. |
| M4 | Audit log | GREEN | IMP, UNI (`admin-audit`) | — |

### 3.7 Revenue AI / agent runtime

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| R1 | Capability authorization (`lib/agent/authorization.ts`), 8 permanent rules | GREEN | IMP, UNI (`agent-capability-autonomy`, `agent-object-authorization`), NEG (unregistered tool fails closed; missing context fails closed), DOC | — |
| R2 | Object authorization stays in domain services | GREEN | IMP, UNI (`agent-object-authorization` — also fails the build on any new internal-HTTP call from the agent layer) | — |
| R3 | "AI down never means CRM down" | GREEN | IMP, UNI (`ai-optional`, `ai-down-resilience`) | — |
| R4 | Work orders — typed, leased, budgeted | YELLOW | IMP, UNI (`work-order-approvals/-boundary/-bounds/-dispatch/-execution/-leases/-lifecycle`), RET | EXT: research providers (Groq, Gemini, Tavily, Jina) mocked everywhere. No live-provider cost/latency evidence. PRF unmeasured. |
| R5 | Approval is a decision, never a stored permission (`resumeApprovedAction`) | GREEN | IMP, UNI (`work-order-approvals`), NEG | — |
| R6 | Golden journey (end-to-end business chain) | RED | — | **2 of 14 tests fail on this host** (§2.1). This is the suite the project designates as "the whole business in one test". |
| R7 | AI cost attribution / ledger | GREEN | IMP, UNI (`ai-cost-attribution`, `ai-execution-id`) | — |
| R8 | ICP adherence measurement | GREEN | IMP, UNI (`icp-adherence`) | — |
| R9 | One-proposal-one-draft DB constraint + repair | GREEN | IMP, INT (`phase-10-draft-guard-db` — real-DB suite), REC (`scripts/repair-approved-proposals.ts`) | — |
| R10 | Client/server boundary (`lib/ai/models.ts` import-free) | YELLOW | IMP, UNI (`ai-optional`, two tests hold the line) | The stated failure mode is a `next build` failure that tsc and Vitest cannot see — and `next build` was **not executed** in this audit. |

### 3.8 Reporting

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| B1 | Client reports + public share token | YELLOW | IMP, UNI (`client-reports`, `client-report-scope`), RBAC, E2E (`e2e/reports/client-report-share.spec.ts`) | Not executed in this audit. Token-expiry / revocation negative path not confirmed by the auditor. |
| B2 | Team view / leaderboard / funnel | YELLOW | IMP, UNI (`phase-9-role-surfaces`) | No dedicated E2E; PRF unmeasured. |
| B3 | Sequence performance + A/B attribution | GREEN | IMP, UNI (`sequence-analytics`, `variant-attribution`) | — |

### 3.9 Production dependencies and delivery

| # | Capability | Status | Proven | Gap |
|---|---|---|---|---|
| D1 | CI required checks (`quality`, `migrations`, `e2e`, `docker`, `secret-scan`) aggregated by `ci-required` with an explicit `always()` result test | GREEN | Read in full. Skipped/cancelled correctly counted as failure. Third-party actions pinned to commit SHAs. | `codeql` and `dependency-review` are **not** in `ci-required`'s `needs` — they can fail without blocking. |
| D2 | Playwright gate scope | YELLOW | The candidate widened CI from two named specs to `npx playwright test` (all projects) — a genuine improvement over BASE. `retries: 0`, so no retry-to-green. | Three `audit`-project path patterns (`sequences`, `email`, `opportunities`, `resilience`) match **no directory**. `e2e/qa/**` (8 lane specs, ~4,000 lines, one unconditional `test.skip`) matches no project and never runs — self-labelled throwaway scaffolding, but it is not coverage. |
| D3 | Migration order + replay-from-empty gate | GREEN | Read in full: `check-migration-order.mjs` preflight then `migrate diff --from-migrations` against an empty shadow DB with `--exit-code`. 47 migrations at AUDIT vs 37 at BASE. | Not executed by the auditor. |
| D4 | Docker image usability (tsx baked in, operational scripts run with `--omit=dev`) | GREEN | Read in full — asserts on message text, not exit code, and uses `npx --no-install`. | Not executed by the auditor. |
| D5 | Destructive seed defused (`prisma.seed` removed, `lib/seed-guard.ts`) | GREEN | IMP, UNI (`seed-guard`), NEG, DOC | — |
| D6 | Env contract (`lib/env-contract.ts`, `scripts/prod-check-env.ts`) | GREEN | IMP, UNI (`prod-env`, `doctor`) | Configuration is not runtime proof — this row certifies the *checker*, not any deployment. |
| D7 | Redis (managed) | RED-for-proof | — | No Redis reachable in the audit environment; the one real-Redis suite skipped. Provisioning is P10 of the runtime-hardening plan and is **still open**. |
| D8 | Cloud Run / Cloud SQL deployment | N/A for this matrix | Documented only (`docs/CLOUD_RUN_DEPLOY.md`, `GCP_DEPLOY.md`, `MIGRATION_RUNBOOK.md`) | Documents are not infrastructure proof. No deployment was inspected. |
| D9 | Cron routes (`email-health`, `inbox-sync`, `maintenance`, `sequence-engine`) | YELLOW | IMP | Authentication of the cron endpoints not verified by the auditor. `sequence-engine` is the direct-send path noted in **E1**. |
| D10 | `npm audit` / dependency freshness | YELLOW | `dependency-review` runs on PRs at `fail-on-severity: high` | 5 open Dependabot PRs; 4 of 5 currently red on `Lint · types · tests` (§4). |

---

## 4. Open pull requests

No PR was merged, closed, or modified by this audit.

| PR | Title | Head | Checks | Classification | Reason |
|---|---|---|---|---|---|
| **#67** | Phase 8 + 9 + 10 + Email Automation — release candidate | `integrate/phase-8-10-final` @ `9cedaf7` | all green, `MERGEABLE`, `mergeStateStatus: CLEAN` | **KEEP** | The candidate under audit. Green CI is not reproducible on this host (§2.1). Do not merge until the five failures are explained or fixed. |
| **#63** | chore: make the dev environment verifiable and identical across machines | `chore/unify-dev-environment` | all green when last run; now `CONFLICTING` | **CLOSE-SUPERSEDED** | Same lane as PR #64, already merged to `main` as `c587c9e` ("chore(dev): make environment reproducible across machines"). Conflicting and duplicative. Salvage `scripts/doctor.mjs` / `scripts/with-env.mjs` only if they are absent from `main`. |
| **#44** | fix(auth): make create-user revoke sessions, and add --deactivate | `fix/create-user-revokes-sessions` | all green | **CLOSE-SUPERSEDED** | Verified content-identical: `git diff 5d548b1 HEAD -- scripts/create-user.ts` is **empty**, and `origin/main:scripts/create-user.ts` already contains `authVersion`. Nothing left to merge. |
| **#58** | bump `@prisma/client` 6.2.1 → 7.9.1 | dependabot | quality, migrations, e2e, docker all **FAILURE** | **ISOLATED-UPGRADE** | Major ORM version. Breaks four gates. Needs its own branch with the extension/`$transaction` code in `lib/prisma.ts` re-verified — that file is the single most upgrade-sensitive module in the repo. |
| **#57** | bump `typescript` 5.9.3 → 7.0.2 | dependabot | quality **FAILURE**, rest green | **ISOLATED-UPGRADE** | Major compiler version. Must be taken deliberately, not as a dependency bump. |
| **#56** | bump `isomorphic-dompurify` 3.21.0 → 3.22.0 | dependabot | quality **FAILURE** | **ISOLATED-UPGRADE** | A patch bump failing the quality gate is a signal, not noise. Re-run against current `main` before assuming it is stale. |
| **#55** | bump `nodemailer` 9.0.1 → 9.0.5 | dependabot | quality **FAILURE**, e2e never reported | **ISOLATED-UPGRADE** | Touches the outbound-email path. Requires the email suites green plus a deliberate decision about live-send verification. |
| **#54** | bump `groq-sdk` 1.2.1 → 1.5.0 | dependabot | quality **FAILURE** | **ISOLATED-UPGRADE** | AI provider SDK. Re-run after #67 lands; the AI surface changed substantially in the candidate. |

No PR currently qualifies as **READY-TO-MERGE**.

---

## 5. Findings against the candidate's own history

PR #67 produced **ten consecutive red CI runs** before turning green at `d8a9f67`. Each fix
commit was reviewed for the prohibited patterns.

### 5.1 `d8a9f67` — worker tenant resolution (accepted, with a test-quality objection)

Replaces a `prisma.jobRun.findUnique` executed under a `{ tenantId: 'default-tenant',
bypassRls: true }` context with a raw `SELECT "tenantId" FROM "JobRun" WHERE "id" = $1` inside a
transaction that sets `app.bypass_rls` transaction-locally. The raw query is narrow (one column,
one row, by primary key) and mirrors the prior intent. `tenantStorage` is **re-exported** from
`lib/prisma.ts` (`export { tenantStorage }` at line 6), not redefined, so there is no split
`AsyncLocalStorage` instance — checked explicitly. Accepted.

~~**Objection:** the accompanying test in `tests/bullmq.test.ts` … does not distinguish the fix
from the defect. It is a smoke test, not a regression test.~~

> **WITHDRAWN — refuted by experiment (rev 2).** The auditor ran the red-green cycle in a pinned
> worktree: reverting `lib/prisma.ts` and `lib/bullmq/workerUtils.ts` to `934bf05` (pre-`d8a9f67`)
> and re-running `tests/bullmq.test.ts` produces **2 failed / 6 passed**, and the two failures are
> `should resolve worker job tenant via bootstrap resolver without ambient tenant context` and
> `should transition JobRun to active and completed with wrapProcessor`. Restoring the files
> returns the suite to green. The test **does** discriminate. The rev-1 objection was reasoned
> from `applyBypassTenant` alone and was wrong; the deciding behaviour is elsewhere in the
> extension path. Regression strength: **adequate**.

### 5.2 `934bf05` — three tests deleted to get green (**not accepted as-is**)

`tests/import-worker.test.ts` lost 87 net lines. The deleted cases were:

1. `resolves the account and contact through upsert, not find-then-create` — the regression test
   for a TOCTOU race whose Postgres error was quoted **verbatim from a live CI server**
   (`duplicate key value violates unique constraint "Account_tenantId_name_key"`).
2. `never lets a blank incoming field null out a value another row already set` — a
   **data-integrity** property, not a race property.
3. `still fails the row when the upsert throws for a reason other than the conflict it targets` —
   a negative path.

The implementation reverted with them: `workers/import.ts` now does
`tx.account.findUnique` → `tx.account.create` inside `prisma.$transaction`, at
`{ concurrency: 3 }`, and `grep -n "P2002" workers/import.ts` returns **no match**. Agent A's
later reasoning (`38d384c`) was that the observed P2002 could not have come from the 31-step
spec, which imports ten different companies. That is a sound refutation of the *diagnosis*; it is
not a refutation of the *race*, and the P2002 was still emitted by a real server. Net effect: an
unhandled concurrent-create race and a dropped data-integrity assertion.

Relative to BASE this is not a regression — those tests never existed on `main`. Relative to the
candidate's own peak coverage it is a reduction, and it was made while chasing green.

### 5.3 `934bf05` — E2E console assertion widened (**flagged**)

`e2e/deep-smoke.spec.ts` and `e2e/support/test.ts` gained a `fonts.gstatic.com` allowlist entry,
and the matcher was widened from testing only `msg.text()` to also testing
`msg.location()?.url`. Two separate concerns:

- Suppressing a **third-party font CDN 404** hides a real product signal: the app is fetching
  webfonts from Google's CDN, which the project's own brand and CSP rules argue against, and a
  failing font fetch is a user-visible defect (fallback font), not test noise.
- Matching allowlist patterns against the **source URL** broadens the suppression surface
  permanently, for every future entry, not just this one.

The reason strings are honest and the change is small — but this is an assertion being relaxed to
make a gate pass, which the audit charter does not accept without a compensating control.

### 5.4 `38d384c` — timeouts raised (**flagged, non-blocking**)

`waitTimeoutMs` 10s → 45s and `sleep(300)` → `sleep(1_000)` in `tests/phase-7-knowledge.test.ts`.
Mitigating: `waitTimeoutMs` is a parameter of the function under test, not a harness timeout; the
assertion (`reused === true`) was not weakened; `staleAfterMs` (the fence actually under test)
is unchanged; ten consecutive passes were claimed. Aggravating: the commit states production's
default is untouched — so the test now proves coalescing at 45s while production still waits at
its default. If a CI runner takes 30.7s for this path, a loaded production host can too, and the
production behaviour under that condition is now **less** tested than before, not more.

### 5.5 `1d47b6c` — clock pinned to a Monday (**accepted**)

Legitimate determinism fix, matching the existing pattern in `tests/sequence-execute.test.ts`,
with a correct and well-evidenced root-cause narrative. The objection is scope, not method: the
same root cause was left in `tests/golden-journey.test.ts` (no pin at all) and in the `S1` block
of `tests/phase-8-stabilization.test.ts` — which is exactly what fails today (§2.1).

### 5.6 `a589d09`, `ffdebb7`, `934bf05` — CI widened (**credit where due**)

The Playwright gate went from two named specs to every project, worker startup replaced a fixed
2-second sleep with a bounded readiness poll on the worker's own `[worker] ready` log line, and
`scripts/verify-import-worker.ts` plus `scripts/diagnose-import.mjs` were added. These are real
improvements over BASE and are recorded as such in D2.

---

## 6. Audit report — candidate `9cedaf7`

```
AUDIT SHA: 9cedaf7105fb9c383717a545d8a5f3f10efec44d
BASE SHA:  2046b7689ee273d04ff23e2095cff8f9defd29a8

CLAIMS VERIFIED:
- tsc --noEmit is clean: exit 0, zero diagnostics (auditor-executed).
- CI at 9cedaf7 is green across all 9 checks including CI required checks (GitHub run 31834467537).
- The Playwright gate really was widened from two specs to all projects; retries stay at 0.
- Migration count grew 37 -> 47 with the order preflight + replay-from-empty gate intact.
- package.json changed without package-lock.json, but only npm scripts were added — no new
  dependency, so npm ci is not at risk.
- Email kill switches fail closed, verified by reading lib/emailSafety.ts line by line.
- create-user session revocation is present and identical to PR #44's version.
- tenantStorage is re-exported, not redefined — no split AsyncLocalStorage instance.

CLAIMS NOT VERIFIED:
- "All gates green." The unit/integration gate fails on this host: 5 failed / 1601 passed,
  exit code 1, reproduced in isolation.
- The d8a9f67 regression test does not discriminate the fix from the defect it replaced.
- next build, Playwright, Docker build and migration replay were not executed by the auditor;
  they remain CI-only claims at this SHA.
- Live-provider behaviour (SMTP/IMAP/Gmail/Groq/Gemini/Tavily/Jina) is mocked everywhere.
- Real-Redis behaviour: the only real-Redis suite skipped in the auditor's run.

REGRESSIONS:
- None against BASE.
- Within the candidate's own history: three import-worker tests deleted in 934bf05, including a
  data-integrity assertion unrelated to the race that motivated the deletion.

SECURITY/RBAC:
- No new authorization bypass found. Capability/object authorization separation holds; the guard
  test that fails the build on new internal-HTTP calls from the agent layer is intact.
- codeql and dependency-review are not part of ci-required's needs and can fail without blocking.
- fonts.gstatic.com is fetched at runtime and now allowlisted out of E2E console/network checks.

TENANT/RLS:
- resolveWorkerJobTenant's raw bypass is narrow and acceptable.
- Structural, pre-existing, not introduced here: DB_RLS_ENFORCED defaults false, so app-layer
  injection is the only isolation layer unless a deployment opts in; and every worker job runs
  under bypassRls: true for its entire lifetime.

EMAIL SAFETY:
- Both kill switches fail closed. EMAIL_SEND_DRY_RUN does not cover the sequence-engine cron
  route's direct EmailService.send() — documented, and the sole guard there is
  SEQUENCE_AUTOSEND_ENABLED.

SEQUENCE SAFETY:
- Scheduling authority is single and seeded from durable ids — intact.
- Execution-lock release and retry idempotency are UNPROVEN at this SHA: the three S1 tests that
  assert them fail here.

DATA INTEGRITY:
- Import account/contact resolution is find-then-create at concurrency 3 with no P2002 handling,
  and the test asserting that a blank incoming field cannot null out a previously set value was
  deleted.
- Work-transfer stale attributions remain unrewritten by design (accepted, documented debt).

TEST QUALITY:
- 1611 tests, 110 files — broad and largely well-targeted.
- Three deletions and one broadened E2E allowlist were made while chasing green.
- ~20 suites use describe.skipIf(!hasDb); they run in CI and ran here, but the pattern means a
  missing DATABASE_URL silently converts an integration gate into a no-op.
- 8 e2e/qa lane specs match no Playwright project and never execute.

FLAKINESS:
- Not flakiness — determinism. 5 tests fail deterministically on a Saturday-UTC host and pass on
  a weekday, matching the send-window/business-day defect Agent A fixed in exactly one file.
- Timing-sensitive waits remain in tests/phase-7-knowledge.test.ts (45s wait, 1s sleep).

MATRIX GREEN:  31
MATRIX YELLOW: 29
MATRIX RED:     4   (W2 sequence worker, A5 execution lock, R6 golden journey, D7 Redis proof)
MATRIX N/A:     1   (D8 Cloud Run / Cloud SQL — documentation only, no deployment inspected)
                    65 rows total across §3.1–§3.9.

DECISION: REJECT

BLOCKERS:
1. The unit/integration gate does not pass on an independent host at this SHA. 5 deterministic
   failures in tests/golden-journey.test.ts (2) and tests/phase-8-stabilization.test.ts (3),
   reproduced in isolation, exit code 1. Green CI on 2026-08-14 (Friday UTC) is therefore not
   evidence that the gate is green on an arbitrary day.
2. Clock-dependence must be fixed as a class, not per file: pin the clock in
   tests/golden-journey.test.ts and at file level in tests/phase-8-stabilization.test.ts, then
   demonstrate a full green run with the system clock set to a Saturday and to a Sunday.
3. Restore import-worker coverage: the concurrent account/contact create race must be either
   handled (P2002 recovery outside the aborted transaction, or a genuine single-statement
   upsert on the bare client) or explicitly and testably ruled out, and the deleted
   "blank field must not null out a prior value" data-integrity test must come back.
4. Replace the d8a9f67 smoke test with a real red-green regression test: it must fail against
   the pre-d8a9f67 implementation.
5. Justify or revert the fonts.gstatic.com E2E allowlist. If the app should not be fetching
   webfonts from a third-party CDN, fix the app rather than the assertion.
```

---

## 7. What would move each RED to GREEN

| Row | Required evidence |
|---|---|
| W2, A5, R6 | A full `vitest run` at exit 0 on a host whose clock is a Saturday, and again on a Sunday, with the output attached. |
| D7 | A worker process connected to the provisioned managed Redis, `tests/redis-integration.test.ts` executed (not skipped), and a `JobRun` observed transitioning `active → completed` through that instance. |

## 8. Maintenance

Revision 1 is the baseline. Each subsequent Agent A candidate SHA appends a new §6-format report
block and updates the affected matrix rows in place. Rows are never promoted to GREEN without the
evidence named in the row's own **Gap** column being produced.

---

# 9. Revision 2 — candidate `0e1986c` (PR #68)

PR #67 merged. `main` is now `c87b67e`, and **post-merge CI #243 on that SHA failed**, reproducing
the five weekend-dependent failures this audit reported. Revision 1's REJECT is therefore closed as
a historical record, not an open decision. Everything below audits the *next* candidate against the
merged baseline.

## 9.1 Measurement integrity — read this before trusting any number

The primary checkout is **not stable**: Agent A edits it live. During this audit `HEAD` moved twice
(`9cedaf7` → `187068e` → `0e1986c`) and at one point carried uncommitted changes to
`workers/import.ts` and `tests/import-worker.test.ts`. One rev-1 statement was written from a tree
that had already moved (corrected in §2.1).

Every measurement in this revision was therefore taken in a **pinned, detached, clean worktree** at
`C:\awt`, checked out at `0e1986c`, with `node_modules` junctioned from the primary checkout.
`HEAD` and `git status --porcelain` were re-verified **before and after** each run; both were
`0e1986c` / empty throughout. Runs taken in the primary checkout are labelled as such.

## 9.2 Candidate content

| SHA | Subject |
|---|---|
| `42ec1a5` | synchronise the Phase 7 research-claim tests on a barrier, not the clock |
| `ccefd02` | pin the golden journey and Phase 8 S1 to a business-day clock |
| `187068e` | fail CI on disabled tests and on silently skipped integration suites |
| `e7d1671` | assert the weekend policy on purpose, not by calendar luck |
| `0e1986c` | require every quality gate, not five of the seven |

Nothing in `lib/`, `app/`, `workers/` or `prisma/` changes. This is a test- and gate-only candidate,
which is the correct shape for the defect it answers.

## 9.3 The eleven verification items

| # | Item | Verdict | Evidence produced by the auditor |
|---|---|---|---|
| 1 | Weekday/weekend behaviour | **VERIFIED** | Full suite run on a **Saturday** (`getUTCDay()===6`, `2026-08-15T04:xxZ`, also Saturday in `Asia/Ho_Chi_Minh`): `exit 0`, `Tests 1625 passed / 5 skipped (1630)`, zero failures. Additionally `e7d1671` adds 19 cases asserting deferral *through* `evaluateAutomationEligibility` on four boundary days with pinned clocks and explicit timezone resolution — so the weekend branch is now asserted, not merely avoided. |
| 2 | Golden journey | **VERIFIED** | Passes inside the exit-0 full run above. The fix fakes only `Date` with `shouldAdvanceTime`, so real database I/O keeps real timers — the correct shape for a suite doing real Postgres work. No assertion weakened; the diff adds a clock and nothing else. |
| 3 | Phase-8 stabilization | **VERIFIED** | Passes inside the exit-0 full run. S1's three lock-release / idempotent-retry assertions now execute instead of short-circuiting on `weekend_adjustment`. |
| 4 | Phase-7 heartbeat 50-run stability | **CORROBORATED at N=20** | 20 consecutive runs of `tests/phase-7-knowledge.test.ts`: **20 pass / 0 fail**, `27 passed (27)` each. `git diff 187068e..0e1986c -- tests/phase-7-knowledge.test.ts` is empty, so all 20 exercised identical content. Agent A's "50 consecutive" is not contradicted; the auditor independently confirms 20. The method is what earns the row: timers replaced by an explicit provider gate plus state polling, `waitTimeoutMs` overrides **removed** so the production default runs, test budget **tightened** 90s → 60s, and the orphan-reclaim `sleep(1_000)` replaced by backdating `claimedAt`. That is the opposite of a raised timeout, and it retires rev-1 finding §5.4. |
| 5 | Restored import tests | **NOT DONE in this candidate** | `git diff --stat c87b67e..0e1986c -- tests/import-worker.test.ts workers/import.ts` is empty. Work is in flight uncommitted in the primary checkout and is deliberately **not** judged here. |
| 6 | Does the import concurrency bug actually reproduce | **YES — REPRODUCED** | See §9.4. This answers the rev-1 classification nuance: the row is RED on measured behaviour, not on absent tests. |
| 7 | Tenant-bootstrap regression strength | **VERIFIED — rev-1 objection withdrawn** | Red-green cycle run in the pinned worktree; see the withdrawal note in §5.1. Reverting to `934bf05` yields `2 failed / 6 passed`; restoring yields green. |
| 8 | Font-network behaviour | **NOT ADDRESSED — and worse than rev 1 recorded** | `app/globals.css` line 1 is a render-blocking `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex…')`. `find public -iname "*.woff*"` returns **nothing** — there is no self-hosted fallback. `lib/security/csp.ts` allows both hosts by design (`font-src: 'self', https://fonts.gstatic.com, data:`). The product's entire typography is a hard runtime dependency on two Google CDN hosts, and since `934bf05` **every browser gate suppresses errors from them**, matched against the console message's source URL. A CDN outage, a corporate proxy, or a jurisdiction that blocks Google Fonts degrades the product and no gate can see it. |
| 9 | CI aggregate includes CodeQL + dependency review | **VERIFIED** | `0e1986c` changes `needs:` to `[quality, migrations, e2e, docker, secret-scan, codeql, dependency-review]` and replaces the `contains(needs.*.result, …)` wildcard with a per-job `require` allowing exactly the results each job may legitimately produce — `dependency-review` must be `success` on `pull_request` and `skipped` on `push`, which is correct and is the case a wildcard would have got wrong. CI run #249 on the candidate: all 8 checks `success`. |
| 10 | Mandatory DB/Redis tests cannot silently skip | **VERIFIED, with one weakness** | Exercised the guard directly. Red-green on the env gate: with `DATABASE_URL`/`REDIS_URL` unset → `exit 1`, both named; with both set → `exit 0`. Red-green on the runtime-results gate: a report with 2 pending + 1 todo → `exit 1` naming each test; a clean report → `exit 0`. A **real** Vitest JSON report emits `numPendingTests` / `numTodoTests` / `numTotalTests`, so the check is live today. **Weakness:** `checkResults` reads `report.numPendingTests ?? 0`, so a report in any other shape passes vacuously — the auditor fed it a file declaring `{"stats":{"skipped":7}}` and the guard printed `test discipline OK … 0 skipped at runtime` and exited 0. A Vitest major bump would silently turn this gate into a no-op. Fix: assert the keys exist and that `numTotalTests` is non-zero. |
| 11 | QA scaffolding has no unique unexecuted coverage | **FALSIFIED — it does** | `e2e/qa/**` (4,412 lines across 8 specs) matches no Playwright project and never runs. `e2e/qa/laneG.spec.ts` exists for one rule — the no-silent-removal guarantee — and its own header states what only a browser can prove. Its test `'the removal dialog shows non-zero impact and Cancel keeps the member'` has **no executed counterpart**: the spec that does run, `e2e/admin/campaign-member-impact.spec.ts`, takes `{ baseURL }` / `{ baseURL, recorder }` and asserts the **API** 409, the handling-mode pass-through, the assignments door and the deactivation guard — never the dialog. The UI half of a rule CLAUDE.md names as "the rule that must not regress" is asserted only in code that never executes. Lane C additionally carries the C5/C7 leadgen-visibility product finding, which now exists only inside an unexecuted file and an allowlist comment. |

## 9.4 Import concurrency — the race reproduces

The rev-1 finding was that three import tests were deleted and no `P2002` handling remains. Per the
revised classification rule, absent tests alone do not justify RED, so the auditor measured the
behaviour instead.

**Method.** The exact statement sequence committed at `0e1986c` in `workers/import.ts` — inside
`prisma.$transaction(async (tx) => …)`: `tx.account.findUnique({ where: { tenantId_name } })`, then
`tx.account.update(...)` if found, else `tx.account.create(...)` — driven concurrently at the
worker's own `{ concurrency: 3 }` against the local PostgreSQL 16 instance, in a throwaway tenant
deleted afterwards. No existing row was read or written.

**Result.**

```
concurrency=3 rounds=40 attempts=120
fulfilled=42  P2002=78  otherErrors=0
distinct accounts created=40 (expected 40)
sample: P2002 :: Invalid `prisma.account.create()` invocation:
VERDICT: the race REPRODUCES against real Postgres with the current code shape.
```

**78 of 120 attempts fail** with `P2002` on `Account_tenantId_name_key`. The constraint holds — 40
accounts for 40 companies — so this is not corruption; it is loss.

**Consequence in production.** The chunk handler catches per row and writes
`status: 'error', errors: { reason: 'Database error while creating pool record' }`, then `errors++`.
A raced row does not crash the job: **the lead is silently dropped and reported as a generic row
error.** An operator sees a partially successful import with an unexplained error count.

**Honest bound on the claim.** The harness resolves the same company name concurrently by
construction, which is the worst case; production only hits it when two in-flight chunks contain
rows for the same company. With `CHUNK_SIZE = 500` and `{ concurrency: 3 }`, an import where any
company appears more than once across a chunk boundary meets that precondition — ordinary for a
scraped or client-supplied list. The mechanism is unhandled; only the rate is uncertain.

This is a **pre-existing defect on `main`**, not something PR #68 introduces.

## 9.5 New finding — `tests/bullmq.test.ts` is flaky in isolation

Not present in rev 1. Measured at `0e1986c` in the pinned worktree, solo runs only:

| Runs | Pass | Fail | Failures observed |
|---|---|---|---|
| 16 | 14 | 2 | `should resolve worker job tenant via bootstrap resolver without ambient tenant context` — `AssertionError: expected null to be 'default-tenant'`; and `should reuse and reset JobRun record for duplicate enqueue requests` — `PrismaClientKnownRequestError` |

Roughly a 12% solo failure rate, two distinct symptoms, both consistent with a `JobRun` row not
being visible when it is read back. It passes inside the full suite, so CI does not see it. The
first symptom lands on the very test that guards the tenant bootstrap (item 7) — the assertion least
able to afford being noisy.

## 9.6 Matrix row changes

| Row | Rev 1 | Rev 2 | Why |
|---|---|---|---|
| W2 sequence worker | RED | **GREEN** | Its suites pass in a pinned isolated run on a Saturday. |
| A5 execution lock / stranded-lock release | RED | **GREEN** | Phase-8 S1 executes and passes; the idempotent-retry assertion is now reached. |
| R6 golden journey | RED | **GREEN** | 14/14 inside the exit-0 run. |
| A2 send-window / business-day policy | YELLOW | **GREEN** | Determinism fixed *and* the weekend branch positively asserted — 19 cases, 4 boundary days, timezone-resolved. |
| D1 CI required checks | GREEN (with gap) | **GREEN**, gap closed | All seven jobs required, per-job allowed-result matching. |
| W4 import worker | YELLOW | **RED** | Promoted on **measured** behaviour (§9.4), not on missing tests. |
| D7 Redis | RED-for-proof | **split** — D7a *CI Redis integration* **GREEN**; D7b *live managed/durable Redis production evidence* **RED** | The distinction the brief asks for. CI now cannot skip the real-Redis suite (`REDIS_URL` mandatory; run #249 green). No production Redis has been observed by anyone. |
| **D11 test-discipline gate** *(new)* | — | **GREEN** | Red-green verified in both modes; one hardening note in item 10. |
| **D12 third-party font CDN dependency** *(new)* | — | **YELLOW** | Real, intentional, unmonitored, and now suppressed in every browser gate. |
| **T1 `tests/bullmq.test.ts` isolation flake** *(new)* | — | **YELLOW** | §9.5. |
| D2 Playwright gate scope | YELLOW | **YELLOW**, sharpened | Item 11 falsified: unique unexecuted coverage identified by name. |

**Rev 2 totals: GREEN 37 · YELLOW 29 · RED 2 · N/A 1 — 69 rows.**
RED: **W4** import concurrency (reproduced) and **D7b** live Redis production evidence.

## 9.7 Report — candidate `0e1986c`

```
AUDIT SHA: 0e1986ca017f4819b878c9aff832cf6233bbd546   (PR #68 head)
BASE SHA:  c87b67e90650f04fc475733b0504417faccfb3ba   (main; its own CI run #243 = failure)

GREEN:  37
YELLOW: 29
RED:     2
N/A:     1

NEW REGRESSIONS:
- None introduced by this candidate. No lib/, app/, workers/ or prisma/ file changes.
- Newly *discovered*, pre-existing, not caused by #68: tests/bullmq.test.ts fails about 12% of
  solo runs (2 of 16), with two distinct symptoms.

CLAIMS VERIFIED:
- Full suite green on a Saturday: exit 0, 1625 passed / 5 skipped / 0 failed, in a pinned detached
  worktree at 0e1986c verified clean before and after the run.
- Phase 7 stability: 20/20 consecutive runs, 27/27 each, file unchanged across all 20.
- Phase 7 was fixed by removing timing dependence, not by widening it — waitTimeoutMs overrides
  deleted, suite budget tightened 90s to 60s, sleeps replaced by observed state.
- Weekend behaviour is now asserted deliberately: 19 eligibility cases across four boundary days,
  with timezone resolution and a businessDayPolicy:'none' counter-case.
- ci-required now requires all seven jobs with per-job allowed results; CI #249 all 8 green.
- Test-discipline guard works: red-green demonstrated for the missing-dependency gate and for the
  runtime-skip gate; a real Vitest report carries the keys it reads.
- Tenant-bootstrap regression test discriminates: reverting to 934bf05 turns it red.

CLAIMS REJECTED:
- "QA scaffolding has no unique unexecuted coverage" — false. e2e/qa/laneG.spec.ts uniquely asserts
  the impact-dialog half of the no-silent-removal rule, and never executes.
- The allowlist entry in scripts/check-test-discipline.mjs states that e2e/qa/laneC.spec.ts:987 is
  "tracked as a RED row in docs/ALL_GREEN_ACCEPTANCE_MATRIX.md". It was not; rev 1 recorded it under
  D2 as YELLOW. An exemption must not cite the auditor's document for a status that document does
  not carry.
- Not a rejection but a correction against the auditor's own rev 1: the objection to d8a9f67's
  regression test is withdrawn, refuted by experiment.

PRODUCTION-EVIDENCE BLOCKERS:
1. Import account/contact resolution races: 78 of 120 concurrent attempts fail P2002 against real
   Postgres, and the handler converts each into a silently dropped lead. Blocks the all-green
   claim; does not block PR #68, which does not touch that code.
2. No live managed/durable Redis evidence exists. CI Redis integration is now mandatory and green,
   which is a different claim. Nothing has observed a JobRun surviving a real broker restart.
3. next build, Playwright, Docker build and migration replay remain CI-only at this SHA — not
   independently executed by the auditor.
4. Every external provider (SMTP/IMAP/Gmail/Groq/Gemini/Tavily/Jina) is mocked in every gate.
5. Typography is an unmonitored hard dependency on fonts.googleapis.com and fonts.gstatic.com, with
   no self-hosted fallback, and browser-gate errors from both hosts are suppressed.

DECISION: APPROVE

Scope of approval: candidate 0e1986c does exactly what it claims, is verified independently on the
day of week that broke main, weakens no assertion, deletes no test, adds two real gates, and
introduces no regression. The all-green *program* is not approved — blockers 1-5 stand against it.

Non-blocking debt to carry:
- Harden checkResults against an unexpected report shape (item 10).
- Fix, or quarantine with a reason, the tests/bullmq.test.ts solo flake.
- Correct the laneC allowlist entry's citation.
- Decide the QA-scaffolding question: promote laneG's dialog assertion into e2e/admin/, or accept
  in writing that the UI half of no-silent-removal is unasserted.
```

## 9.8 Open pull requests — rev 2

| PR | Head | Classification | Change from rev 1 |
|---|---|---|---|
| #68 | `0e1986c` | **READY-TO-MERGE** | New. First PR in this audit to earn it. |
| #67 | — | merged | Was KEEP. |
| #63 | `857326a` | CLOSE-SUPERSEDED | unchanged |
| #44 | `5d548b1` | CLOSE-SUPERSEDED | unchanged |
| #58 #57 #56 #55 #54 | rebased onto `c87b67e` | ISOLATED-UPGRADE | All five re-ran against the new main (CI #244–#248) and **all five still fail**. The rebase removes "stale base" as an explanation: these are real incompatibilities, not drift. |

---

# 10. Revision 3 — CI-only gates, and Wave-2 candidate `d8e7258`

Two tracks: the gates this audit had never executed (D3 / D4 / D7b), and Agent A's Wave-2 work.

## 10.1 Governance finding — the "frozen" SHA is not the branch tip

PR #68 was certified and frozen at `0e1986c`. **Its head is now `d8e7258`**: three further commits
were pushed onto the same branch and the same PR. A certification pinned to a SHA remains valid for
that SHA, but the PR that carries the certificate no longer points at it — so "PR #68 is certified"
and "PR #68 is what merges" are now two different statements. Recommendation: either merge `0e1986c`
as certified and open Wave-2 as its own PR, or re-certify the head. This audit does both SHAs so the
choice is not blocked either way. `C:\awt` stays pinned at `0e1986c`; `C:\awt2` is pinned at
`d8e7258`.

## 10.2 CI-only gates — what could and could not be executed here

| Gate | Executable on this host? | Result |
|---|---|---|
| **D3** migration order + replay-from-empty | **Yes** — PostgreSQL 16 is local and `telestar_shadow` exists | **EXECUTED, PASS** |
| **D4** Docker image build + operational-scripts check | **No** — `docker: command not found`, no WSL distro | UNVERIFIED, and it stays UNVERIFIED |
| **D7b** live managed/durable Redis | **No** — no `redis-server`, no `redis-cli`, no Memurai service, no container runtime | UNVERIFIED, and it stays UNVERIFIED |

### D3 — executed, from the pinned worktree at `0e1986c` (clean, verified before the run)

```
$ node scripts/check-migration-order.mjs origin/main
[migration-order] ok — 46 migrations, no new migrations
PREFLIGHT_EXIT=0

$ prisma migrate diff --from-migrations ./prisma/migrations \
    --to-schema-datamodel ./prisma/schema.prisma \
    --shadow-database-url postgresql://…/telestar_shadow --exit-code
No difference detected.
REPLAY_EXIT=0
```

Both halves pass: every migration replays into an empty database in order, and the resulting
database and `schema.prisma` describe the same thing. `git diff 0e1986c..d8e7258 -- prisma/` is
empty, so this result covers the Wave-2 candidate unchanged. **D3 → GREEN, auditor-executed.**

### D4 and D7b — no substitute accepted

Neither can be measured here, and neither will be marked GREEN on the strength of a green CI job:
the audit charter rejects a CI run as standalone evidence, and it rejects configuration as runtime
proof. They remain UNVERIFIED with a named reason rather than being quietly promoted. For D7b
specifically the distinction the brief asks for now has a settled shape:

- **D7a — CI Redis integration: GREEN.** `REDIS_URL` is mandatory via the test-discipline guard, so
  `tests/redis-integration.test.ts` can no longer skip itself into a green run.
- **D7b — live managed/durable Redis: RED.** Nothing anywhere has observed a real broker: no
  restart-survival test, no eviction-policy check, no `maxmemory` behaviour, no reconnect storm, no
  observed queue depth under load. This is the last remaining piece of the runtime-hardening plan
  (P10) and it cannot be closed from a laptop or from CI.

## 10.3 Wave-2 candidate `d8e7258` — the six items

Three commits on top of the certified `0e1986c`:

| SHA | Subject |
|---|---|
| `b991d38` | restore race-safe account/contact resolution, and cover it against real Postgres |
| `411fe5d` | prove the JobRun tenant bootstrap is necessary, not just working |
| `d8e7258` | self-host IBM Plex instead of excusing a failing font CDN |

**Full suite, pinned worktree `C:\awt2` at `d8e7258`, clean before and after, on a Saturday
(`getUTCDay()===6`):** `exit 0`, `Test Files 111 passed | 1 skipped (112)`,
`Tests 1634 passed | 5 skipped (1639)`, zero failures.

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Import concurrency RED → GREEN | **VERIFIED** | §10.4 — the identical harness that produced 78 P2002 failures now produces zero, on both extension paths. |
| 2 | Zero valid-row loss under P2002 races | **VERIFIED** | §10.4 — 120/120 attempts fulfilled, 40 accounts for 40 companies, no row dropped. |
| 3 | Restored blank-field preservation regression | **VERIFIED, and exceeded** | All three deleted cases are back verbatim in `tests/import-worker.test.ts` — `resolves the account and contact through upsert, not find-then-create`, `never lets a blank incoming field null out a value another row already set`, `still fails the row when the upsert throws for a reason other than the conflict it targets`. A **new real-Postgres** suite `tests/import-concurrency.test.ts` (262 lines) adds four cases the mocks structurally cannot prove: two concurrent chunks converging on one account *losing no lead*, the same for contacts, `a blank incoming field leaves the known value in place`, and `a populated incoming field still fills a gap the first import left empty`. Mock-level and real-database-level coverage of the same property. |
| 4 | Test-discipline fail-closed schema handling | **NOT DONE** | `git diff 0e1986c..d8e7258 -- scripts/check-test-discipline.mjs` is empty. Line 171 is still `report.numPendingTests ?? 0`, with no assertion that the keys exist or that `numTotalTests` is non-zero. The rev-2 finding stands unchanged: a report in an unexpected shape still passes vacuously, printing `0 skipped at runtime`. |
| 5 | Lane G genuinely executable | **NOT DONE** | `playwright.config.ts` still carries `testIgnore: ['**/qa/**']`. `e2e/qa/laneG.spec.ts` remains unexecutable, so the impact-dialog half of the no-silent-removal rule is still asserted nowhere that runs. Sharpened observation: because Playwright *ignores* the whole directory, the `ALLOWED_DISABLED` entry for `e2e/qa/laneC.spec.ts:987` exempts a test that could not have run regardless — the exemption documents a product finding but gates nothing. |
| 6 | External font dependency resolution | **VERIFIED** | `app/globals.css` line 1 — the render-blocking `@import url('https://fonts.googleapis.com/…')` — is **deleted**. `app/fonts.ts` loads the three IBM Plex cuts through `next/font/google`, which downloads them at build time and serves them same-origin. The token stack now reads `var(--font-plex-sans), 'IBM Plex Sans', -apple-system, …`, so a locally installed Plex is still tried before the system stack. Critically, **both E2E allowlists are removed** (`e2e/deep-smoke.spec.ts` −1, `e2e/support/test.ts` −8): the assertion weakened in `934bf05` is restored rather than permanently excused. This retires rev-1 finding §5.3 and rev-2 row D12. |

## 10.4 The Wave-2 race experiment — before and after on one harness

The fix moves `account`/`contact` resolution out of the interactive transaction and onto the bare
client as a Prisma `upsert`, so Postgres's native `INSERT … ON CONFLICT DO UPDATE` is used and
serializes the conflict itself. `nonBlank()` strips blank keys so one payload is safe as both the
`create` and the `update` half — the blank-field-preservation property is now enforced in
**production code**, not only asserted in a test.

The auditor's v2 harness drives the application's **own extended client** (`@/lib/prisma`) inside a
worker-shaped `tenantStorage` context, so the client extension is in the path exactly as it is in
`workers/import.ts`. It also seeds one row per company with an `industry` and the rest without, so
row loss and field clobbering are measured together. Two scenarios, because the extension takes two
different paths — and the second is the one that could have quietly undone the fix.

| Scenario | Shape under test | fulfilled | P2002 | accounts | industry preserved |
|---|---|---|---|---|---|
| Rev-2 baseline (`0e1986c`) | find-then-create inside `$transaction` | 42 / 120 | **78** | 40 | n/a |
| A — `DB_RLS_ENFORCED` unset | `prisma.account.upsert` on the bare client | **120 / 120** | **0** | 40 | **40 / 40** |
| B — `DB_RLS_ENFORCED=true` | same, through the extension's `$transaction([...])` array-batch path | **120 / 120** | **0** | 40 | **40 / 40** |

Scenario B was run because `lib/prisma.ts` wraps every query in `client.$transaction([set_config, query])`
when RLS is enforced, and this repository's own notes warn that the `$extends` wrappers defeat array
batching — the same class of decomposition that broke the previous `tx.upsert()` attempt. It does
**not** recur: the native upsert survives that path intact. The fix holds on an RLS-enabled
deployment as well as on one without.

## 10.5 A disagreement worth recording, now moot

`411fe5d` states that the `d8a9f67` resolver test "would have passed just as well against a plain
`prisma.jobRun.findUnique()`" — i.e. it did **not** discriminate. The auditor's rev-2 red-green
experiment found the opposite: reverting `lib/prisma.ts` and `lib/bullmq/workerUtils.ts` to
`934bf05` turned that test red. Both results were measured; they disagree, most likely because the
revert changed two files rather than one and because the extension's "local or script" branch grants
bypass whenever `NODE_ENV !== 'production'`, which makes the outcome sensitive to ambient env.

It is moot either way, and in the safer direction: `411fe5d` asserts the asymmetry **directly, under
the production tenant policy**, where the model read resolves to `null` and the raw resolver still
answers — which is precisely the shape of the original production failure. A second test asserts
that the processor bootstraps from the durable `JobRun` and **ignores `job.data.tenantId`**, so a
forged or stale payload cannot move a job across a tenant boundary. That is a stronger property than
either party was arguing about.

## 10.6 T1 flake — root-caused by Agent A, re-measured by the auditor

Rev 2 recorded `tests/bullmq.test.ts` failing 2 of 16 solo runs with `expected null to be
'default-tenant'` and a `PrismaClientKnownRequestError`. `411fe5d` identifies the cause
independently: a manual env save/restore leaked `NODE_ENV=production` into later tests, where the
extension's production branch turns every read into `null`. The fix is `vi.stubEnv` with an
unconditional `afterEach(vi.unstubAllEnvs)`.

Auditor re-measurement at `d8e7258`, solo runs only — and the first attempt at it is itself a
lesson in measurement hygiene:

| Database | Other consumers active? | Runs | Pass | Fail |
|---|---|---|---|---|
| shared `telestar_crm` | **yes** — Agent A was running its own race measurements against it (`race-measure-result.txt` appeared in the primary checkout, whose `HEAD` moved to `7d61aee` mid-measurement) | 32 | 24 | 8 |
| private `telestar_audit_test` (created for this audit, `migrate deploy`, 63 tables) | no | 20 | **20** | **0** |

The 8 failures were **not** distributed like a flake: they were runs 25–32, eight consecutively at
the end, with `PrismaClientKnownRequestError` while writing `JobRun` rows and `expected undefined`
where a row should have been — the signature of another process truncating tables underneath the
run, not of an intermittent fault. On a database no other process touches, the suite is 20/20.

**T1 → GREEN**, on the private-database measurement.

Two corrections follow from this, and they cut against the auditor:

1. An earlier draft of this section claimed "32 runs, 32 pass". That was written before the second
   batch reported. It was wrong, and it was caught by checking the result before publishing rather
   than after. Recorded here because an audit that hides its own near-misses is not an audit.
2. **Rev 2's "≈12% solo flake rate" (2 of 16) is now suspect.** It was measured on the same shared
   database while Agent A was active in the same checkout, so contention cannot be excluded as its
   cause either. A real fault did exist — `411fe5d` independently root-causes a leaked
   `NODE_ENV=production` and reports the same "10/12 runs green" symptom — but the auditor's *rate*
   should not be treated as having measured it. Every future stability measurement in this audit
   uses `telestar_audit_test`.

## 10.7 Matrix row changes

| Row | Rev 2 | Rev 3 | Why |
|---|---|---|---|
| W4 import worker | RED | **GREEN** | Race closed and measured on both extension paths; zero row loss; blank-field preservation now enforced in production code and covered by mock *and* real-Postgres regressions. |
| D3 migration order + replay | GREEN (CI-only) | **GREEN (auditor-executed)** | §10.2. |
| D7 Redis | D7a GREEN / D7b RED | **unchanged** | Nothing in Wave-2 touches it; not executable on this host. |
| D12 third-party font CDN | YELLOW | **GREEN** | Self-hosted via `next/font`; both E2E allowlists removed. See the reclassification in §10.8. |
| T1 `tests/bullmq.test.ts` flake | YELLOW | **GREEN** | 20/20 solo runs on a private database after a root-caused fix; rev 2's rate retracted as contaminated. |
| P3 worker tenant resolution | YELLOW | **GREEN** | `411fe5d` asserts the bootstrap is *necessary* under the production tenant policy, and that transport is not authority. |
| D2 Playwright gate scope | YELLOW | **YELLOW** | Item 5 not done — lane G still ignored. |
| D11 test-discipline gate | GREEN | **YELLOW** | Item 4 not done — downgraded, because rev 2 promoted it to GREEN with the vacuous-report weakness recorded as a note, and a gate that can silently become a no-op should not sit at GREEN once that is known and unfixed. |
| D4 Docker image | GREEN (read, CI-only) | **YELLOW** | Honest reclassification: rev 1 marked it GREEN from reading the workflow. Reading a gate is not executing it, and it cannot be executed here. |

**Rev 3 totals: GREEN 41 · YELLOW 26 · RED 1 · N/A 1 — 69 rows.**
The single RED is **D7b — live managed/durable Redis production evidence**.

## 10.8 Typography — corrected classification

Rev 2 wrote that a font-CDN outage "degrades the product" and implied an availability risk. That
over-stated it and is corrected here. The pre-fix token stack was
`'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` — **system
fallbacks were always present**. The correct distinction:

- **Brand typography unavailable** — accurate. A blocked or failing `fonts.gstatic.com` meant pages
  rendered in the system stack instead of IBM Plex: wrong typeface, wrong metrics, layout shift,
  and the brand rules' explicit "not Inter/Geist/system-default" intent silently violated.
- **Application cannot render** — never true. No functionality depended on it.

The real costs were therefore brand fidelity, a render-blocking round trip to a third-party origin
on every page load, every visitor's IP disclosed to Google for a BPO handling EU prospect data, and
— the audit-relevant one — a browser-gate assertion widened to tolerate it. Wave-2 removes all four.

## 10.9 Report — candidate `d8e7258`

```
AUDIT SHA: d8e725840da8f059779f22a840710a696bf58af0   (PR #68 head; Wave-2)
BASE SHA:  c87b67e90650f04fc475733b0504417faccfb3ba   (main)
CERTIFIED PREDECESSOR: 0e1986ca017f4819b878c9aff832cf6233bbd546 (frozen, still pinned at C:\awt)

GREEN:  41
YELLOW: 26
RED:     1
N/A:     1

NEW REGRESSIONS:
- None. Full suite exit 0 in a pinned clean worktree on a Saturday: 1634 passed / 5 skipped / 0
  failed. Test count rises 1625 -> 1634; nothing is deleted, no assertion is relaxed, and two
  previously relaxed assertions (the font allowlists) are restored.

CLAIMS VERIFIED:
- Import race closed: same harness, 78 P2002 before, 0 after, 120/120 fulfilled.
- Verified additionally under DB_RLS_ENFORCED=true, where the extension's array-batch path could
  have decomposed the native upsert. It does not.
- Zero valid-row loss: 40 accounts for 40 companies, no dropped lead.
- Blank-field preservation: 40/40 industries survived a concurrent blank row, and the property is
  now enforced by nonBlank() in production code rather than only asserted.
- All three deleted import tests restored verbatim, plus 4 new real-Postgres concurrency cases.
- Font CDN eliminated: @import deleted, next/font self-hosting, both E2E allowlists removed.
- Tenant bootstrap now asserted as necessary under the production tenant policy, and transport is
  proven not to be authority (job.data.tenantId ignored).
- T1 flake root-caused and gone: 20/20 solo runs on a private database. The 8 failures seen on the
  shared database were cross-process contention from Agent A's concurrent experiments, not the
  candidate — and rev 2's flake *rate* is retracted for the same reason.
- D3 executed independently: preflight exit 0, replay-from-empty --exit-code exit 0, no drift.

CLAIMS REJECTED:
- Item 4 not done: check-test-discipline.mjs is unchanged and still reads numPendingTests ?? 0,
  so a report in an unexpected shape passes vacuously. Demonstrated, not inferred.
- Item 5 not done: playwright.config.ts still has testIgnore ['**/qa/**']; lane G cannot run, so
  the impact-dialog half of the no-silent-removal rule remains unasserted.
- Auditor self-correction: rev 2's typography wording implied an availability risk. System font
  fallbacks were always present. Brand typography unavailable, never application cannot render.

PRODUCTION-EVIDENCE BLOCKERS:
1. No live managed/durable Redis evidence — no restart survival, eviction, maxmemory, reconnect
   or queue-depth observation. Not executable on this host; not satisfiable by CI. Sole RED.
2. Docker image build and the operational-scripts check remain auditor-UNVERIFIED: no container
   runtime here. CI green is not accepted as a substitute.
3. next build and Playwright remain auditor-UNVERIFIED at this SHA.
4. Every external provider (SMTP/IMAP/Gmail/Groq/Gemini/Tavily/Jina) is mocked in every gate.

DECISION: APPROVE

Scope: candidate d8e7258 closes the only evidence-backed RED this audit raised, restores two
weakened assertions, deletes nothing, and regresses nothing. Items 4 and 5 are not done and are
carried as declared debt rather than blockers — neither is a correctness defect, and neither was
introduced here. Overall production readiness remains NOT approved: blocker 1 is the last RED and
blockers 2-4 are gaps no laptop and no CI run can close.

Carried debt:
- Item 4: harden checkResults — assert the report keys exist and numTotalTests is non-zero.
- Item 5: promote lane G's dialog assertion into e2e/admin/, or record in writing that the UI half
  of no-silent-removal is deliberately unasserted.
- Correct the laneC allowlist citation, which claims a matrix status this document does not carry
  and gates a file Playwright already ignores.
```

---

# 11. Revision 4 — re-certification of PR #68 head `7d61aee`

`0e1986c` was certified and PR #68 has moved twice since. New exact target:
`7d61aeec4c652ccbde06d64946e6d6dd996edf4b`, measured in a **fresh pinned detached worktree**
`C:\awt3`, on a **private database** `telestar_audit_test` created for this audit
(`migrate deploy`, 63 tables) so no other process shares it.

`HEAD` and `git status --porcelain` were captured before and after every run.

## 11.1 Worktree integrity — and one thing it did not isolate

`PRE_HEAD` = `POST_HEAD` = `7d61aee…f4b` for every run in this revision. No tracked file changed
under measurement — `git status --porcelain` never reported an `M` entry.

It did, however, report one untracked file that **was not there when the worktree was created**:
`race-measure-result.txt`, containing Agent A's own measurement output. Agent A is running commands
with `C:\awt3` as its working directory. A pinned worktree isolates the *commit*, not the
*filesystem*: it protected the code under test, and it would not have protected a run from a
concurrently regenerated `node_modules` or a shared database. The private database is what covers
that second half, and it is why the numbers below are trustworthy where revision 2's flake rate was
not.

Worth recording rather than complaining about: Agent A's file reports `chunk calls fulfilled = 120`,
`distinct accounts = 40`, `leads created = 120`, `import rows errored = 0` — identical to the
auditor's independently written experiment. Two separately built harnesses agreeing is stronger
evidence than either alone.

## 11.2 The ten required re-audits at `7d61aee`

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Full Vitest | **PASS** | `exit 0` — `Test Files 112 passed \| 1 skipped (113)`, `Tests 1635 passed \| 5 skipped (1640)`. PRE_HEAD == POST_HEAD. |
| 2 | Weekend / calendar cases | **PASS** | The run above executed on a **Saturday** (`getUTCDay()===6`), which is the exact condition that failed on merged `main` in CI #243. The 19 deliberate eligibility cases from `e7d1671` — four boundary days, timezone-resolved, plus a `businessDayPolicy:'none'` counter-case — are inside that green run. |
| 3 | Phase-7 determinism | **PASS** | 15 consecutive solo runs of `tests/phase-7-knowledge.test.ts` on the private database: **15 pass / 0 fail**. Cumulative across revisions: 35 runs, 0 failures. |
| 4 | Test-discipline fail-closed | **PASS — fixed and verified** | See §11.3. Six inputs, exit codes captured from the tool and not from a pipe. |
| 5 | CI aggregate semantics | **PASS** | `needs: [quality, migrations, e2e, docker, secret-scan, codeql, dependency-review]` — all seven, with per-job allowed-result matching. CI run **#253 on `7d61aee` = success**. Noted in passing: run #252 on `d8e7258` was **cancelled**, superseded by this push — so the SHA approved in revision 3 never completed a CI run, and this one has. |
| 6 | Tenant bootstrap regressions | **PASS** | `tests/bullmq.test.ts` green inside the full run and 15/15 solo. `411fe5d`'s two properties execute: the raw resolver answers where the model read returns `null` under the production tenant policy, and the processor bootstraps from the durable `JobRun`, ignoring `job.data.tenantId` — transport is not authority. |
| 7 | Import race | **GREEN — proven RED→GREEN on one harness** | §11.4. |
| 8 | Blank-field preservation | **PASS** | Measured in the same end-to-end run: `industry` survived on **40/40** accounts while two of every three concurrent rows carried it blank. Enforced in production code by `nonBlank()`, not only asserted in tests. |
| 9 | Font runtime CDN removal | **PASS at runtime; build dependency remains, correctly** | §11.5. |
| 10 | BullMQ flake classification | **GREEN — not a production defect** | §11.6. |

## 11.3 Item 4 — test-discipline fail-closed matrix

`7d61aee` replaces `report.numPendingTests ?? 0` with an explicit shape check that returns a failure
listing the top-level keys it did find. The same commit also corrects the `ALLOWED_DISABLED` entry
that previously claimed a status in this document — it now states that the acceptance matrix is
maintained by the independent auditor and deliberately claims nothing about it. Both were auditor
findings from revisions 2 and 3; both are closed.

Six inputs, exit code taken from the process, never from a pipe:

| Input | Exit | Behaviour |
|---|---|---|
| valid report, no skips | **0** | `test discipline OK — 1 allowlisted exemption(s), 0 skipped at runtime` |
| valid report, 2 skips | **1** | `2 skipped and 0 todo test(s) ran as non-executed on CI` + names `tests/x.test.ts: S > a [pending]` |
| valid report, 1 todo | **1** | names `tests/y.test.ts: S > b [todo]` |
| `{"stats":{"skipped":7}}` | **1** | *"The Vitest JSON reporter format this gate reads has changed… Top-level keys present: stats"* |
| malformed JSON | **1** | `Could not parse …: Unexpected end of JSON input` |
| missing result file | **1** | `Vitest result file not found: …` |

Unknown shape fails closed, and names why. **D11 → GREEN.**

## 11.4 Item 7 — the decisive RED→GREEN proof

Method upgraded from revisions 2–3: this experiment drives the **real exported
`handleImportChunk`** from `workers/import.ts`, through the application's own extended Prisma
client, inside a worker-shaped tenant context, against real Postgres — with a real `ImportBatch`,
real `ImportRow`s, a real `Campaign`, `Client` and `User`. Three chunks run concurrently, and every
chunk carries a row for every company, which is the collision the defect requires. Chunk 0 supplies
an `industry`; the other two leave it blank, so field clobbering is measured by the same run.

**40 companies × 3 concurrent chunks = 120 rows = 120 attempts.** Identical harness, two commits:

| Measure | pre-fix `0e1986c` | **`7d61aee`** | expected |
|---|---|---|---|
| **leads** | **40** | **120** | 120 |
| **accounts** | 40 | 40 | 40 |
| contacts | 40 | 120 | 120 |
| **P2002** (classified from row error records) | 0 † | **0** | 0 |
| **errored rows** | **80** | **0** | 0 |
| **lost valid rows** | **80** | **0** | 0 |
| chunk failures | 0 | 0 | 0 |
| blank-field preservation | 40/40 | 40/40 | 40/40 |

**Two of every three valid rows were silently lost before the fix — 66.7%.** After it, none.

† **An observability defect the fix does not address, and the reason that cell reads 0.** The
Postgres server raised `P2002` 80 times — the pre-fix run's stderr shows
`Invalid tx.account.create() invocation … Unique constraint failed on the fields: (tenantId, name)`
at `workers/import.ts:687` — but the row-level record written to `ImportRow.errors` is the generic
`{"reason":"Database error while creating lead"}`. The uniqueness signal is flattened away, so an
operator investigating 80 dropped leads has no way to learn *why* from the data. That is why a
programmatic classifier scanning the persisted errors finds zero P2002 while the defect is at its
worst. The catch-and-flatten shape is unchanged in the fixed code, so any *future* row failure is
equally undiagnosable. Carried as debt, not a blocker: with the race closed there is no longer a
routine failure to diagnose.

## 11.5 Item 9 — runtime and build dependencies, classified separately

- **Runtime (browser) dependency: REMOVED.** No source file that ships to the client references
  either host. `app/globals.css`'s render-blocking `@import` is gone. Fonts are declared through
  `next/font/google` in `app/fonts.ts` (`subsets`, `variable`, `display: 'swap'`) and wired onto
  `<html>` in `app/layout.tsx` via `fontVariables`, so Next emits same-origin
  `/_next/static/media/*.woff2` and no request leaves for Google. Both E2E allowlists stay removed.
- **Build dependency: PRESENT, and accepted.** `next/font/google` fetches the families at build
  time. Per the brief this is explicitly not grounds for rejection; it is a build-time supply-chain
  dependency, not a runtime one, and it fails a build loudly rather than degrading a user's page
  quietly.
- **Residual, and the one thing still to fix:** `lib/security/csp.ts` still allows
  `https://fonts.googleapis.com` in `style-src` and `https://fonts.gstatic.com` in `font-src`, with
  a header comment describing the deleted `@import`. Not a dependency — a stale permission. A CSP
  that permits an external stylesheet origin nothing loads from is a widening with no purpose left.
  Folded into row **P7** as a YELLOW note, not a new RED.
- **Not performed:** a rendered-page network capture against a built server. No production build was
  run here — `npm run build` regenerates the Prisma client into the `node_modules` shared by
  junction with Agent A's active checkout, and corrupting a collaborator's working tree is not an
  acceptable price for a confirmation the static evidence already supports. The runtime claim rests
  on `next/font` semantics plus the absence of any client-side reference, and is labelled as such.

## 11.6 Item 10 — BullMQ flake, classified

| Database | Other consumers | Runs | Pass | Fail |
|---|---|---|---|---|
| shared `telestar_crm`, Agent A concurrently running destructive DB experiments | yes | 32 | 24 | 8 |
| private `telestar_audit_test`, sole consumer (rev 3, `d8e7258`) | no | 20 | 20 | 0 |
| private `telestar_audit_test`, sole consumer (**this SHA**) | no | 15 | **15** | **0** |

**35 consecutive solo passes on an uncontended database.** The 8 failures were runs 25–32
consecutively — a state change, not an intermittent fault — with `PrismaClientKnownRequestError`
writing `JobRun` rows and `expected undefined` where a row should have been: another process
truncating tables underneath the run. Per the brief, that is **not** grounds for a production RED,
and it is not recorded as one. Revision 2's "≈12% flake rate" stays retracted. A real fault did
exist and was fixed independently by `411fe5d` (a leaked `NODE_ENV=production` from a manual env
save/restore); it is gone. **T1 stays GREEN.**

## 11.7 Matrix row changes

| Row | Rev 3 | Rev 4 | Why |
|---|---|---|---|
| D11 test-discipline gate | YELLOW | **GREEN** | Fails closed on unknown shape, malformed JSON and missing file; six-input matrix verified. |
| W4 import worker | GREEN | **GREEN**, upgraded evidence | Now proven through the real `handleImportChunk` end to end, with a measured RED half on the same harness. |
| T1 BullMQ flake | GREEN | **GREEN**, confirmed | 15/15 more on an uncontended database; 35 cumulative. |
| P7 CSP / headers | YELLOW | **YELLOW**, sharpened | Stale `fonts.googleapis.com` / `fonts.gstatic.com` allowances now serve nothing. |
| D2 Playwright gate scope | YELLOW | **YELLOW** | Lane G still `testIgnore`d; unchanged this SHA. |
| D7b live Redis | RED | **RED** | Untouched, unmeasurable here. |

**Rev 4 totals: GREEN 42 · YELLOW 25 · RED 1 · N/A 1 — 69 rows.**

## 11.8 Report — exact SHA `7d61aee`

```
AUDIT SHA: 7d61aeec4c652ccbde06d64946e6d6dd996edf4b   (PR #68 head)
BASE SHA:  c87b67e90650f04fc475733b0504417faccfb3ba   (main)
MEASURED IN: C:\awt3 (fresh pinned detached worktree) on private DB telestar_audit_test
PRE_HEAD == POST_HEAD == 7d61aeec4c652ccbde06d64946e6d6dd996edf4b on every run

GREEN:  42
YELLOW: 25
RED:     1
N/A:     1

NEW REGRESSIONS: none.
  Full suite exit 0. Test count 1634 -> 1635. Nothing deleted, no assertion relaxed.

IMPORT (concurrency=3, rounds=40, attempts=120, real handleImportChunk):
  leads:            120   (pre-fix 0e1986c: 40)
  accounts:          40   (pre-fix: 40)
  P2002:              0   (pre-fix: 0 as persisted — 80 raised by the server, see below)
  errored rows:       0   (pre-fix: 80)
  lost valid rows:    0   (pre-fix: 80)
  blank-field preservation: 40/40 accounts kept `industry`

CLAIMS VERIFIED:
- Full Vitest exit 0 on a Saturday, pinned SHA, private database: 1635 passed / 5 skipped / 0 failed.
- Weekend branch asserted deliberately, not avoided; the green run happened on the failing weekday.
- Phase 7 determinism: 15/15 solo (35/35 cumulative).
- Test discipline fails closed on all five bad inputs and passes only the valid clean report.
- CI aggregate requires all seven jobs; CI #253 on this exact SHA is success.
- Tenant bootstrap: raw resolver necessary under production policy; job.data.tenantId ignored.
- Import race closed end to end through the production handler, with the RED half measured on the
  identical harness: 80 lost rows before, 0 after.
- Blank-field preservation holds under concurrency and lives in production code.
- No client-side reference to either Google Fonts host remains; both E2E allowlists stay removed.
- BullMQ: 15/15 solo on an uncontended database; the earlier failures were shared-DB collision.

CLAIMS REJECTED:
- None outstanding against this SHA.
- Two prior auditor positions remain retracted: rev 2's BullMQ flake rate (contaminated) and
  rev 2's implication that the font CDN was an availability risk (system fallbacks existed).

PRODUCTION-EVIDENCE BLOCKERS:
1. Live managed/durable Redis: no restart survival, eviction, maxmemory, reconnect or queue-depth
   observation anywhere. Not executable on this host, not satisfiable by CI. Sole RED.
2. Docker image build and operational-scripts check: auditor-UNVERIFIED, no container runtime here.
3. next build and Playwright: auditor-UNVERIFIED at this SHA; a rendered-page network capture for
   the font claim was deliberately not run to avoid corrupting the shared node_modules.
4. Every external provider (SMTP/IMAP/Gmail/Groq/Gemini/Tavily/Jina) mocked in every gate.

DECISION: APPROVE 7d61aeec4c652ccbde06d64946e6d6dd996edf4b

Scope: this exact SHA. Overall production readiness remains NOT approved — blocker 1 is the last
RED and blockers 2-4 are gaps neither this host nor CI can close.

Carried debt (non-blocking):
- ImportRow.errors flattens P2002 to "Database error while creating lead"; a future row failure is
  undiagnosable from the data. Preserve the Prisma error code.
- lib/security/csp.ts still allows both Google Fonts origins that nothing loads from.
- Lane G remains unexecutable; the impact-dialog half of no-silent-removal is asserted nowhere
  that runs.
```

---

# 12. Revision 5 — the CI-only gates, executed

Revisions 1–4 left four gates marked UNVERIFIED because this host could not run them without
corrupting Agent A's working tree. `C:\awt3` now has its **own** `node_modules` (`npm ci`, exit 0,
**0 vulnerabilities**), so three of the four are now measured. All still at
`7d61aee…f4b`, `git status` clean of tracked changes.

The junction was removed with `cmd rmdir`, not `rm -rf` — `rm -rf` follows a Windows junction and
would have deleted the target. Target verified intact afterwards.

**Environment delta to note:** local Node is `v24.16.0`; `.nvmrc` pins `24.18.0` and CI asserts the
exact string. Everything below therefore ran one patch release behind CI.

## 12.1 Gates executed

| Gate | Command | Result |
|---|---|---|
| **Production build** | `npm run build` (`NODE_OPTIONS=--max-old-space-size=8192`) | **exit 0** — full route manifest emitted |
| **Playwright — the documented gate** | `playwright test crm-journeys deep-smoke` against `npm start` on the production build | **exit 0 — 20 passed (1.6m)** |
| **Dependency install** | `npm ci` | **exit 0**, `found 0 vulnerabilities` |
| Docker image | — | still **not executable**: no container runtime on this host |

`next build` is the gate this repository's own notes call mandatory for anything touching shared
imports or the server/client boundary, precisely because tsc and Vitest cannot see bundling
failures. It had never been executed by this audit. It passes.

## 12.2 A false failure the auditor produced, and did not report as a finding

The **first** Playwright attempt returned `17 failed / 3 passed`. It was not evidence about the
candidate and is not recorded as such.

Diagnosis: every failure was a rejected sign-in — `TimeoutError: page.waitForURL` still on
`/login`, and `expect(received).toBe('signed-in') … Received: "rejected"`. The database was
`telestar_audit_test`, which this audit had already used for **35 full Vitest runs**; it held
**1,172** users with addresses like `b.eaafe8e4-…@other.test`, and the demo seed had logged an FK
error on `SequenceEnrollment_leadId_fkey` rather than completing. The personas the specs sign in as
were not in the state the specs require.

Re-run on a purpose-built database — `CREATE DATABASE`, `migrate deploy` (exit 0), `db:seed`
(exit 0, 17 users, personas printed), production server restarted against it — gives **20/20
passed**. A 17-failure result caused by the auditor's own polluted fixture would have been a
serious false accusation had it been published.

**Incidental live proof of D5.** The first clean database was named `telestar_e2e_audit`, and the
destructive-seed guard **refused it**:

```
✖ Destructive seed refused.
Database name "telestar_e2e_audit" does not contain any of: dev, development, test, local.
Refusing to wipe a database that is not clearly disposable.
```

D5 was previously GREEN on unit tests. It is now GREEN on observed runtime behaviour, having
refused a real database this audit asked it to wipe.

## 12.3 Font dependency — runtime proof, from the served page

Revision 4 classified the runtime dependency as removed on static evidence and explicitly declined
to claim a rendered-page capture. That capture now exists.

Against `npm start` on the production build, `GET /login`:

- **Zero** occurrences of `fonts.gstatic.com` or `fonts.googleapis.com` in the served HTML.
- Fonts are served same-origin: `_next/static/media/03fc1b4a8d284b5e-s.p.…woff2` and siblings.
- **29** `.woff2` files emitted into `.next/static/media/`.
- No reference to either host anywhere in `.next/static/` (the client bundle).

The only build-output references are in `.next/server/` chunks, and they are the CSP *policy
string* — the stale allowance described below — not a fetch.

**Runtime dependency: removed, proven. Build dependency: present, accepted.** As instructed, the
two are not conflated: `next/font/google` fetching at build time fails a build loudly; it does not
reach a user's browser.

## 12.4 New finding — the CSP does not enforce

Runtime headers on every response (`next.config.ts` applies `SECURITY_HEADERS` to `/:path*`):

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; …
```

The header is **`Content-Security-Policy-Report-Only`**. `lib/security/csp.ts` line 107 sets
`CSP_HEADER_NAME = 'Content-Security-Policy-Report-Only'` as a literal, and the file's header
comment says this is deliberate — violations post to `/api/csp-report` "so the real origin
inventory can be observed before enforcement". That is a defensible staging step.

Three things follow, and they are why this is a finding rather than a note:

1. **Nothing is blocked today.** The XSS mitigation the policy describes is not in force in
   production. `script-src` also carries `'unsafe-inline'`, so even once enforced it would not stop
   inline-script injection without a nonce.
2. **There is no switch.** The header name is a hard-coded constant with no environment flag and no
   dated owner, so "before enforcement" has no mechanism that ends it. A staged rollout with no
   trigger is indistinguishable from a permanent one.
3. **The policy is already stale.** It still allows `https://fonts.googleapis.com` in `style-src`
   and `https://fonts.gstatic.com` in `font-src` for an `@import` that was deleted in `d8e7258` —
   so the observation period is calibrating against origins the app no longer uses.

Recorded against row **P7**, which stays **YELLOW**: the other five headers are correct and now
runtime-proven, and report-only is a real stage in a real rollout — but the matrix will not call a
non-enforcing CSP a satisfied security boundary.

**Correction to revision 1.** P7 said "No root `middleware.ts`; header application per route not
proven at runtime." Both halves were wrong in substance: Next 16 renames middleware to
`proxy.ts`, which exists and sets four of the headers, and `next.config.ts` applies the full set to
`/:path*`. Header application is now proven at runtime for every header above.

## 12.5 Matrix row changes

| Row | Rev 4 | Rev 5 | Why |
|---|---|---|---|
| **D13 production build** *(new)* | — | **GREEN** | `npm run build` exit 0, auditor-executed. |
| **D14 Playwright documented gate** *(new)* | — | **GREEN** | 20/20 against the production build on a clean seeded database. |
| D2 Playwright gate scope | YELLOW | **YELLOW** | The 20/20 covers `crm-journeys` + `deep-smoke` only. The `audit` and `demo` projects were not run here, and `e2e/qa/**` is still `testIgnore`d with lane G's dialog assertion unexecutable. |
| D5 destructive-seed guard | GREEN (unit) | **GREEN** (runtime-proven) | Refused a real database by name during this audit. |
| D12 font dependency | GREEN (static) | **GREEN** (runtime-proven) | Served-HTML capture. |
| P7 CSP / security headers | YELLOW | **YELLOW**, re-scoped | Five headers proven at runtime; CSP is report-only with no enforcement switch and a stale font allowance. Rev-1 wording corrected. |
| D4 Docker image | YELLOW | **YELLOW** | Still no container runtime. Unchanged. |
| D7b live Redis | RED | **RED** | Unchanged. |

**Rev 5 totals: GREEN 44 · YELLOW 25 · RED 1 · N/A 1 — 71 rows.**

## 12.6 Report — `7d61aee`, gates completed

```
AUDIT SHA: 7d61aeec4c652ccbde06d64946e6d6dd996edf4b   (PR #68 head, unchanged)
BASE SHA:  c87b67e90650f04fc475733b0504417faccfb3ba

GREEN:  44
YELLOW: 25
RED:     1
N/A:     1

NEWLY EXECUTED BY THE AUDITOR:
- npm ci                exit 0, 0 vulnerabilities
- npm run build         exit 0
- playwright (gate)     exit 0, 20 passed, against the production build
- migrate deploy        exit 0 (twice, on fresh databases)
- db:seed               exit 0 on a compliant name; REFUSED a non-compliant one

CLAIMS VERIFIED:
- The production build compiles. This gate had never been run by the auditor and is the one the
  fast gates structurally cannot substitute for.
- The documented 20/20 Playwright gate reproduces independently against a production server.
- Font CDN removal is proven from the served page, not inferred: zero CDN references in the HTML,
  fonts served from _next/static/media, 29 woff2 emitted.
- Five security headers are applied to every path at runtime.
- The destructive-seed guard refuses a real database by name.

CLAIMS REJECTED / WITHDRAWN:
- The auditor's own first Playwright run (17 failed) is withdrawn as environmental: a database
  polluted by 35 prior Vitest runs and a seed that did not complete. Not a candidate defect.
- Revision 1's P7 claim that no root middleware exists and header application was unproven is
  corrected: proxy.ts exists, next.config.ts applies headers to /:path*, verified at runtime.

NEW FINDING:
- The Content-Security-Policy is served as Content-Security-Policy-Report-Only. It blocks nothing.
  The header name is a hard-coded constant with no environment toggle, script-src carries
  'unsafe-inline', and the policy still allows both Google Fonts origins that nothing loads from.
  Deliberate and documented as pre-enforcement staging; recorded because a staged rollout with no
  trigger is indistinguishable from a permanent one. YELLOW, not RED.

PRODUCTION-EVIDENCE BLOCKERS:
1. Live managed/durable Redis — no restart survival, eviction, maxmemory, reconnect or queue-depth
   observation. Not executable here, not satisfiable by CI. Sole RED.
2. Docker image build and the operational-scripts check — no container runtime on this host.
3. Playwright audit/demo projects and e2e/qa lanes were not executed; lane G's impact-dialog
   assertion remains unexecutable by configuration.
4. Every external provider (SMTP/IMAP/Gmail/Groq/Gemini/Tavily/Jina) mocked in every gate.
5. Node here is v24.16.0 against a pinned 24.18.0; CI asserts the exact string.

DECISION: APPROVE 7d61aeec4c652ccbde06d64946e6d6dd996edf4b  (unchanged, now on more evidence)

Carried debt, unchanged plus one:
- ImportRow.errors flattens the Prisma code; no worker in the repository preserves one.
- CSP is report-only with no enforcement trigger, and its font origins are stale.
- Lane G remains unexecutable.
```

## 12.7 Audit environment left behind

For reproducibility, and so it can be cleaned up deliberately rather than discovered:

| Artefact | Purpose |
|---|---|
| `C:\awt` @ `0e1986c` | pinned, certified predecessor (retained per instruction) |
| `C:\awt2` @ `d8e7258` | pinned, Wave-2 |
| `C:\awt3` @ `7d61aee` | pinned, current — **has its own `node_modules` and a `.next` build** |
| `C:/c/Users/admin/awt` | stray worktree registration from a failed path attempt; prune when convenient |
| DB `telestar_shadow` | pre-existing; used for the D3 replay |
| DB `telestar_audit_test` | created by this audit; Vitest and the import experiments |
| DB `telestar_audit_e2e_test` | created by this audit; seeded, used for the 20/20 Playwright run |
| server on port 3100 | production build under test; stopped at the end of this revision |

---

# 13. PR #68 merged — certification carried to `main`; Wave-3 register opened

## 13.1 The certified tree is the tree that landed

A certificate for a SHA is worth nothing if a different tree merges. Verified:

```
$ git merge-base --is-ancestor 7d61aee origin/main   -> YES
$ git diff --stat 7d61aee origin/main                -> (empty)
```

`main` is now `daf45fe`, a merge commit whose tree is **byte-identical** to the certified
`7d61aeec4c652ccbde06d64946e6d6dd996edf4b`. Nothing was added, amended or squashed between
certification and merge. **The revision-5 APPROVE transfers to `main` unchanged.**

Merged 2026-08-15T06:29:41Z. PR #68 head at merge: `7d61aee` — the exact SHA audited.

## 13.2 Reconciliation — lane G

Revisions 2–5 recorded lane G's impact-dialog assertion as unexecutable (`testIgnore: ['**/qa/**']`),
and that finding is **correct at every SHA it was recorded against**, including the certified one.
It is now confirmed to be deliberate sequencing rather than an omission: the fix lives in the next
stacked PR (`9b10f28 test(e2e): execute the no-silent-removal dialog, and make dead spec surface
impossible`).

**The PR #68 verdict is not revised.** Work that deliberately lives in a later stacked PR is not a
defect in the earlier one, and an auditor that retro-grades a certified SHA on the strength of a
successor's contents makes certification meaningless. The row stays as written, with this note
attached; it is re-measured against Wave 3, where it belongs.

## 13.3 Standing classifications — carried forward verbatim

These three do not move without new evidence of the specific kind named:

| Item | Status | What it means, and what would change it |
|---|---|---|
| **CI Redis integration** | **GREEN** | `REDIS_URL` is mandatory via the test-discipline guard, so `tests/redis-integration.test.ts` cannot skip itself into a green run. Already satisfied. |
| **LIVE managed / durable Redis** | **RED** | A different claim, and the audit's sole RED. Requires observation of a real broker: restart survival of an in-flight `JobRun`, eviction and `maxmemory` behaviour, reconnect under a dropped connection, queue depth under load. No CI service container and no laptop can supply it. |
| **CSP** | **YELLOW** | Served as `Content-Security-Policy-Report-Only`; blocks nothing. **Promotion criterion, stated so it is testable rather than negotiable:** the enforcing header must actually be served — verified by reading the response header name on a running build, not by reading a constant — and reaching it must not depend on someone remembering. A hard-coded switch flipped by hand still satisfies "enforcing" if the header is observed; what will not satisfy it is a policy that stays report-only with no owner, no trigger and stale origins in it. `script-src 'unsafe-inline'` is recorded alongside: enforcing that policy as written would still not stop inline injection without a nonce. |

## 13.4 Wave-3 audit register — plan, not findings

PR #69 `all-green/wave-3-feature-security` is already rebased onto the new `main`
(`git merge-base origin/main 5d6eadf` = `daf45fe`). Seven commits, mapped against the ten targets.
**Nothing below is measured yet** — this is the plan, recorded in advance so the verdict cannot be
fitted to whatever the diff turns out to contain.

| # | Target | Apparent owner commit | How it will be measured |
|---|---|---|---|
| 1 | Lane G really executes | `9b10f28` | Run the promoted spec against a production build and confirm it appears in the Playwright run list — a spec that matches no project must fail the gate, not pass silently. |
| 2 | `Lead.campaignId` RED → GREEN | `b532177` | Independent request-level probe: a cross-tenant `campaignId` must be refused. |
| 3 | Rejected Lead relation requests cause zero partial writes | `b532177` | Count rows before and after a rejected request; any created `Account`/`Contact`/`Activity` is a partial write. Must be measured, not read. |
| 4 | Work Order tenant reference safety | `e7c66fb`, `5d6eadf` | Cross-tenant target reference refused before dispatch. |
| 5 | Work Order object-level RBAC | `5d6eadf` | Authorization derived from session, not request body; capability ≠ object scope. |
| 6 | Booking Links reference authorization | tbd | Same probe shape as 2/3. |
| 7 | Client Reports reference authorization | tbd | Same, plus the public share token's negative path. |
| 8 | Request-supplied foreign-key matrix completeness | `e7c66fb` | Enumerate FK-accepting request bodies from the route surface **independently**, then diff against what the PR's matrix covers. Completeness is the claim; an auditor-built inventory is the only way to test it. |
| 9 | BullMQ shared-DB cleanup isolation | `1ce8229` | Directly relevant to revision 2's retracted flake rate. Re-measure solo on a private database **and** deliberately alongside a competing suite. |
| 10 | Expanded lint coverage | `fe588c7` | Confirm `workers/`, `scripts/` and `e2e/` are genuinely linted and that the gate fails on a seeded violation — coverage claimed by configuration is not coverage. |

**Target SHA not yet fixed.** PR #68's head moved twice while labelled frozen, so the exact SHA for
this pass will be taken on instruction rather than inferred from whatever the branch tip happens to
be at the moment of measurement. Current tip is `5d6eadf`.

---

# 14. Wave-3 preparatory audit — PROVISIONAL, no certification

Certified `main` is `daf45fedfaf84b9ce082334033908db2e3de3d4f`. PR #69 is **not** being certified here:
Agent A is still working Booking Links, Client Reports, the request-reference matrix and Work Order
object-RBAC completion on the same branch. Everything below is measured at pinned
`5d6eadfb4c69e8fc1e942ea81fbb8764c1f71169` in a fresh detached worktree `C:\awt4`
(`node_modules` junctioned from the auditor's own `C:\awt3`, never from Agent A's checkout), on the
private database `telestar_audit_test`.

Every finding in §14.1 is marked **PROVISIONAL — REVERIFY AT FINAL SHA**.

Full suite at `5d6eadf`: `exit 0`, `Test Files 115 passed | 1 skipped (116)`,
`Tests 1648 passed | 5 skipped (1653)`. PRE_HEAD == POST_HEAD.

## 14.1 Provisional findings — red-green, not read

A gate claimed by configuration is not a gate until it fails on a seeded violation. Each item below
was broken deliberately and then restored.

| # | Target | Method | Result |
|---|---|---|---|
| 1 | Lane G really executes | The dialog spec is promoted to `e2e/admin/member-removal-dialog.spec.ts`, a directory the `audit` project's `testMatch` covers. Both assertions the auditor named as unique in rev 2 are present: `confirm must be disabled before a mode is picked`, and Cancel verified by a **reload** rather than a re-query. The QA lanes are renamed `*.qa.ts` so they can no longer look like specs. | **PROVISIONAL PASS** |
| 1b | Dead spec surface made impossible | New `checkEverySpecIsExecuted()` parses `playwright.config.ts` `testMatch` patterns and fails on any orphan. Seeded `e2e/zz-orphan.spec.ts` → **exit 1**, naming the file under *"Playwright specs that no project executes"*. Removed → **exit 0**. | **PROVISIONAL PASS — red-green verified** |
| 2 | Lead campaign reference security | Reverted `app/api/leads/route.ts` + `lib/auth.ts` to `daf45fe`, ran `tests/lead-reference-integrity.test.ts` → **3 failed / 1 passed**. Restored → **4 passed**. | **PROVISIONAL PASS — red-green verified** |
| 3 | Lead zero-partial-write | The three failing names are the property itself: *refuses a campaign in another tenant with 404, **creating nothing at all***; *refuses a campaign id that does not exist with the same 404*; *refuses an in-tenant campaign the caller is not a member of with 403, **creating nothing***. The check sits before the `try` that upserts Account and Contact, so ordering is structural, not incidental. | **PROVISIONAL PASS** |
| 5 | Work Order dispatch object RBAC | Reverted `lib/workorders/dispatch.ts` + the dispatch route to `daf45fe`, ran both work-order suites → **1 failed / 8 passed**; the failure is `refuses an SDR dispatching a work order targeting a peer lead, queueing nothing`. Restored → **9 passed**. | **PROVISIONAL PASS, with a caveat** |
| 4 | Work Order tenant reference integrity | In the same revert, `tests/work-order-reference-integrity.test.ts` contributed **zero** failures — every one of its cases passes against pre-Wave-3 code. | **DOCUMENTS existing behaviour; closes no regression** |
| 10 | Expanded lint coverage | `lint` now runs `eslint app components lib context tests workers scripts e2e`. Baseline **exit 0**. Seeded three violations into `workers/healthcheck.ts` — a newly covered directory — → **exit 1**, `3 problems (1 error, 2 warnings)`, file named. Restored → **exit 0**. | **PROVISIONAL PASS — red-green verified** |

**The caveat on #5, stated plainly:** only **1 of 9** work-order tests discriminates the fix from its
absence. The other eight pass either way. That is not a defect — a suite may legitimately document
behaviour — but the regression strength for object-level RBAC currently rests on a single
assertion, and #4's suite rests on none. At the final SHA the auditor will ask what a *second*
independent failure mode would look like, rather than accepting suite size as evidence of coverage.

**Not yet measured at this SHA:** BullMQ fixture isolation (target #13). `1ce8229` scopes JobRun
cleanup; the auditor's test is to run `tests/bullmq.test.ts` solo on a private database *and*
deliberately alongside a competing DB suite, since rev 2's retracted flake rate came from exactly
that collision. Deferred to the frozen SHA so it is measured once, against final code.

## 14.2 Target A — independent FK / reference surface inventory

Built from the route source, **not** from `docs/REQUEST_REFERENCE_SECURITY_MATRIX.md`, which has
deliberately not been read. Method, so it can be re-run and disputed:

1. `app/api/**/route.ts` exporting `POST`, `PUT` or `PATCH` → **91 routes**.
2. Of those, keep the ones that read a relational id **off the request body** — `body.<field>`,
   `data.<field>`, `parsed.<field>` — for the twenty field names in the brief. This is the
   distinction that matters: a route that merely *mentions* `tenantId` while stamping it from the
   session is not attack surface; a route that reads one a client sent is.
3. Record which authorization helpers each route file calls.

**21 routes accept a request-controlled relational id.**

| Route (`app/api/…`) | Method(s) | Request-controlled FK fields | Authorization helpers in the route |
|---|---|---|---|
| `leads/route.ts` | POST | `assignedToId`, `campaignId` | `canAccessUser`, **`canReferenceCampaign`**, `getLeadWhereScope` |
| `leads/[id]/route.ts` | PUT/PATCH | `assignedToId` | `canAccessLead`, `canAccessUser` |
| `leads/import/route.ts` | POST | `assignedToId`, `campaignId`, `sequenceId` | `canAccessUser` |
| `activities/route.ts` | POST | `leadId`, `sequenceId` | `canAccessLead` |
| `ai/draft-outcome/route.ts` | POST | `leadId` | `canAccessLead` |
| `email/send/route.ts` | POST | `accountId`, `leadId`, `templateId` | `canAccessLead` |
| `meetings/route.ts` | POST | `bookingLinkId`, `leadId` | `canAccessLead`, `getLeadWhereScope` |
| `notes/route.ts` | POST | `leadId` | `canAccessLead` |
| `reminders/route.ts` | POST | `leadId` | `canAccessLead` |
| `tasks/bulk/route.ts` | POST | `userId` | `canAccessLead`, `canAccessUser` |
| `campaigns/route.ts` | POST | `clientId` | `getVisibleCampaignIds`, `requireRole` |
| `booking-links/route.ts` | POST | `campaignId`, `clientId` | `requireRole` only |
| `booking-links/[id]/route.ts` | PUT/PATCH | `campaignId` | `requireRole` only |
| `client-reports/route.ts` | POST | `campaignId`, `clientId` | **none in route** |
| `client-reports/preview/route.ts` | POST | `campaignId`, `clientId` | **none in route** |
| `work-orders/route.ts` | POST | `campaignId`, `leadId` | **none in route** |
| `tasks/route.ts` | POST | `leadId`, `sequenceId`, `userId` | **none in route** |
| `sequences/preview/route.ts` | POST | `leadId`, `sequenceId` | **none in route** |
| `campaigns/[id]/members/route.ts` | POST | `userId` | **none in route** |
| `admin/transfer-work/route.ts` | POST | `campaignId` | **none in route** |
| `demo/inbound-reply/route.ts` | POST | `leadId` | **none in route** |

### What this inventory does and does not claim

It does **not** claim the eight "none in route" rows are vulnerabilities. Several are known to
delegate: `tasks/route.ts` goes through `lib/tasks/service.ts`, which the agent-authorization work
made the single owner of task create/list; `admin/transfer-work` delegates to
`lib/admin/campaignMembers.ts`, which owns the 409 impact gate; `campaigns/[id]/members` delegates
to the same module. Absence of a helper *in the route file* is a **candidate for verification**, not
a finding.

It does claim something testable: **completeness becomes measurable.** At the frozen SHA this table
is diffed against `docs/REQUEST_REFERENCE_SECURITY_MATRIX.md`. Any row here that is missing there is
a gap in the matrix; any row there that is not here is either a route this method missed — in which
case the method is refined and said so — or a claim about a surface that does not exist.

Three rows to watch, because they sit inside Agent A's declared in-flight areas and the fix is not
yet written: `booking-links` (both), `client-reports` (both). Two sit outside them and have no
declared owner: `work-orders/route.ts` (`campaignId`, `leadId` — note this is *creation*, distinct
from the dispatch path fixed in `5d6eadf`) and `sequences/preview/route.ts` (`leadId`,
`sequenceId`).

## 14.3 Target B — zero-partial-write harness, designed

The principle the harness encodes: **an HTTP 403 or 404 is not the assertion.** A rejected request
must leave no durable trace. The status code is necessary and insufficient.

Shape, per endpoint under test:

1. Seed two tenants and the actor, in a throwaway tenant prefix, on the private database.
2. Snapshot `count()` **and** the id set for every model the endpoint can touch, restricted to the
   models relevant to that endpoint: `Lead`, `Account`, `Contact`, `Activity`, `BookingLink`,
   `Meeting`, `Opportunity`, `Task`, `JobRun`, `AgentAction`.
3. Issue the rejected request against the **real route handler**, with the session supplied by
   mocking `@/auth` only — never by mocking Prisma, a domain service, or the check under test.
4. Re-snapshot. Assert equality of both counts and id sets. Id sets matter as well as counts: a
   create paired with a rollback-that-deletes-something-else nets to zero.
5. Assert the status code **last**, so a green status can never stand in for the absence of writes.

Why id sets and not just counts: revision 5's false Playwright failure came from trusting an
environment rather than measuring it. Counts alone are the same class of shortcut.

## 14.4 Target D — Booking Link matrix, designed before seeing the fix

Prepared independently and deliberately **not** derived from Agent A's proposed fix, which has not
been read. `booking-links/route.ts` and `booking-links/[id]/route.ts` today call `requireRole` and
nothing else, while accepting `clientId` and `campaignId` from the body — the same shape that made
`POST /api/leads` exploitable at HTTP 201.

**Client reference:** own authorized · same-tenant unauthorized · foreign tenant · nonexistent.
**Campaign reference:** own authorized · same-tenant unauthorized · foreign tenant · nonexistent.

**Relational consistency, the case a per-field check cannot catch:** `clientId` = Client A and
`campaignId` = a campaign belonging to Client B, **both inside the caller's own tenant**. Each field
passes its own ownership check; the pair is still incoherent, and `lead → campaign → client` is the
chain every client-facing report walks.

**Default behaviour:**
- Can an `isDefault` POST clear or modify a **default belonging to another tenant**? The mechanism
  matters: if the "unset the previous default" step is an `updateMany` whose `where` omits
  `tenantId`, it reaches across the boundary even when the create itself is properly scoped.
- Can **two concurrent** `isDefault` creates leave more than one default for one scope? Measured the
  way the import race was — real concurrency against real Postgres, not a sequential simulation —
  and answered by counting defaults afterwards, not by reading the code.

**GET disclosure, independent of whether POST is fixed:** construct a poisoned fixture directly in
the database — a tenant A `BookingLink` pointing at a tenant B `Client`/`Campaign` — then `GET` it
as tenant A and inspect the response body for foreign client name, foreign campaign name, or any
other foreign metadata. A POST-side fix does not sanitise rows that already exist, and rows like
these can exist from any earlier version of the code.

## 14.5 Target E — Client Report matrix, designed

Fields to inventory and probe: `clientId`, `campaignId`, `generatedById`, `approvedById`, owner /
actor identity, recipient, share token, `tenantId`.

Cases: cross-tenant reference · same-tenant unauthorized reference · nonexistent reference ·
client/campaign mismatch · spoofed actor (`generatedById` / `approvedById` supplied in the body must
lose to the session) · zero partial writes on refusal · share-token isolation across tenants ·
share-link revocation if the feature supports it · foreign report disclosure through the public
token route.

The public share route deserves its own negative path: it is the one endpoint that answers without a
session, and `client-reports/[id]/share/route.ts` reads `createdById` and `reportId`.

## 14.6 Standing classifications — unchanged

| Item | Status | Note |
|---|---|---|
| CI Redis integration | **GREEN** | `REDIS_URL` mandatory; the suite cannot skip itself green. |
| **LIVE managed Redis** | **RED** | The audit's sole RED. Local Redis, Docker Redis and a GitHub service container **do not close it**. Required: TLS/auth, durability, restart survival, worker reconnect, JobRun/queue reconciliation, eviction and `maxmemory`, queue depth, failed-job visibility. |
| CSP | **YELLOW** | Four findings kept separate, not merged into one row: **(1) promotion mechanism** — the header name is a hard-coded constant with no toggle and no owner; **(2) stale origins** — both Google Fonts hosts are still allowed after `d8e7258` removed the `@import`; **(3) `script-src 'unsafe-inline'`** — enforcing the policy as written would still not stop inline injection without a nonce; **(4) runtime enforcement proof** — the row closes only when an enforcing `Content-Security-Policy` header is *observed on a running production build*, read off the response rather than off the source. Report-Only does not close it. Not required of the current foreign-reference security work unless that work regresses it. |

## 14.7 Final #69 certification — start condition

Not begun. It begins only on an explicit **WAVE-3 FREEZE SHA** plus confirmation that CI is
`SUCCESS` at that head, Booking Links and Client Reports are complete, Work Order object-RBAC is
complete, the request-reference matrix is complete, and the branch is frozen. Then: fresh pinned
worktree at the exact SHA, `HEAD` verified, `git status` verified clean, the full eighteen-point
Wave-3 matrix run, and one APPROVE or REJECT for that SHA alone.

`C:\awt`, `C:\awt2`, `C:\awt3` stay pinned. `C:\awt4` joins them at `5d6eadf` as the provisional
control. The audit databases stay — they are the historical controls that let a later result be
compared against an earlier one rather than merely asserted.

## 14.8 Inventory sharpened — the eight "no helper in route" rows, resolved

§14.2 listed eight routes with no authorization helper visible in the route file and said plainly
that this was a **candidate for verification, not a finding**. Each has now been traced to whatever
actually owns the check. Still measured at pinned `5d6eadf`; still **PROVISIONAL**.

**A methodological correction first.** The helper list used in §14.2 was incomplete — it did not
include `getManageScope` / `canManage`, so `campaigns/[id]/members/route.ts` was reported as
unguarded when it imports both. Part of the "none in route" count was an artefact of the auditor's
own regex, not of the code. The final diff against
`docs/REQUEST_REFERENCE_SECURITY_MATRIX.md` will use the corrected helper set, and this correction
is recorded rather than quietly folded in — an inventory whose method is not disclosed cannot be
disputed, and a completeness claim that cannot be disputed is not evidence.

| Route | Verdict | What actually owns the check |
|---|---|---|
| `tasks/route.ts` | **CLEARED** | Delegates to `lib/tasks/service.ts` and translates its errors — `Forbidden` → 403, `Lead not found` → 404. The service is the single owner of task create/list, which is exactly the arrangement the agent-authorization work established. |
| `campaigns/[id]/members/route.ts` | **CLEARED** | Imports `getManageScope` / `canManage` and delegates to `addCampaignMember` / `removeCampaignMember`, which own the 409 impact gate. Reported unguarded in §14.2 by auditor error. |
| `demo/inbound-reply/route.ts` | **CLEARED** | Hard-gated to `DEMO_TENANT_ID` (403 otherwise) and re-checks `lead.tenantId !== DEMO_TENANT_ID` → 404. |
| `sequences/preview/route.ts` | **CLEARED**, with a note | `leadId` and `sequenceId` are never read from the database. They feed `buildJitterSeed` only, so the endpoint computes a schedule and writes nothing. There is no reference to authorize. The residue is information-theoretic: a caller who guesses a lead id learns that lead's deterministic jitter offsets. Not a reference vulnerability; recorded so the final diff does not treat its absence from the matrix as a gap. |
| `admin/transfer-work/route.ts` | **UNRESOLVED** | Delegates to `lib/admin/transferWork.ts`; the module's own scoping was not traced in this pass. Carry to the final matrix diff. |
| `client-reports/route.ts`, `client-reports/preview/route.ts` | **DEFERRED** | Agent A's declared in-flight area. Not judged. |
| `booking-links/route.ts`, `booking-links/[id]/route.ts` | **DEFERRED** | Same. `requireRole` only, today. |

### `work-orders/route.ts` — PROVISIONAL FLAG, tenant-safe but not object-safe

This one is outside every declared in-flight area, so it is written up in full rather than deferred.

`POST /api/work-orders` passes `parsed.data.leadId` and `parsed.data.campaignId` straight into
`createWorkOrder`, which calls `resolveScope(tenantId, leadId, campaignId)`. That function is
**good** at what it does, and does it explicitly rather than leaning on ambient behaviour:

```ts
const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tenantId: true, campaignId: true } });
if (!lead || lead.tenantId !== tenantId) {
  throw new WorkOrderValidationError(`Lead ${leadId} is not in this tenant`);
}
```

— and the same shape for the campaign. **Cross-tenant references are refused at creation.** That
half is sound.

What it does not do is ask whether *this caller* may reference *this lead*. Tenancy is checked;
object-level access is not. So on the current head:

- an SDR **can create** a work order whose target is a peer's lead inside their own tenant —
  `resolveScope` passes, and a durable `WorkOrder` row results;
- that same SDR **cannot dispatch** it — `5d6eadf` added exactly that check, and the auditor
  verified by revert that it is the single discriminating test in the suite.

The gap is therefore narrow and not a privilege escalation: nothing executes. It is still a durable
write attributable to a reference the caller was not entitled to name, which is the same class the
Lead fix closed by moving `canReferenceCampaign` *before* the Account/Contact upsert. It is also the
exact distinction this repository's own rules draw — capability authorization is not object
authorization — landing on the creation side of a path whose dispatch side was just hardened.

**Handed over rather than filed as a defect**, because Agent A's declared remaining work includes
"Work Order object-RBAC completion", and this is plausibly already in scope. If it is, the final
audit should find a test that fails when the creation-side check is reverted. If it is not, the
final matrix will carry it as an open row with this reasoning attached.

**To be measured at the frozen SHA, not asserted:** create as an SDR against a peer's lead, then
count `WorkOrder`, `WorkOrderLease`, `JobRun` and `AgentAction` rows before and after — the §14.3
harness, applied to creation as well as dispatch.

## 14.9 The five skipped tests — enumerated, with a defect found while enumerating

Groundwork done now at `5d6eadf` rather than waiting for the freeze, since the answer is unlikely to
move and the method is what matters. Re-run and re-confirmed at the frozen SHA.

Obtained from a real Vitest JSON report (`--reporter=json`), not from the summary line.
**All five are in one file**, `tests/redis-integration.test.ts`, under `describe('BullMQ against a
real Redis')`:

| # | Test name | Skip condition | Why it skipped here | CI executes it? | Required release coverage? |
|---|---|---|---|---|---|
| 1 | round-trips a job through a real worker and returns its result | `describe.skipIf(!reachable)` — `reachable` is a live TCP probe, not an env-var read | No Redis of any kind on this host | **Yes** | Yes — for **CI Redis (GREEN)** |
| 2 | reports a waiting job through `collectQueueMetrics` with a real age | same | same | **Yes** | Yes |
| 3 | holds a delayed job in the delayed set, then runs it | same | same | **Yes** | Yes |
| 4 | retries a failing job and reports the attempt count | same | same | **Yes** | Yes |
| 5 | self-heals after the server severs every connection | same | same | **Yes** | Yes |

**The skips are legitimate, and the suite is better defended than a plain `skipIf` suggests.** The
condition is a live reachability probe; and if `REDIS_URL` is *set* but unreachable, the file
**throws** rather than skipping:

```
'REDIS_URL is unreachable on CI. This suite is the only real-Redis coverage in the …'
```

so a broken service container cannot present itself as a pass. CI supplies
`REDIS_URL: redis://localhost:6379` to both the `quality` job (ci.yml:68) and the `e2e` job (:252),
and `scripts/check-test-discipline.mjs --ci` refuses to start without it. Three independent
mechanisms, and they agree.

**These five do not close the LIVE managed Redis row.** They run against a service container. Test 5
— *self-heals after the server severs every connection* — is the closest thing here to live
evidence and is still a container. The standing classification is unchanged: **CI Redis GREEN, LIVE
managed Redis RED**, and the required live proof remains TLS/auth, durability, restart survival,
worker reconnect, JobRun/queue reconciliation, eviction and `maxmemory`, queue depth, failed-job
visibility.

### Defect found while enumerating — `check-test-discipline.mjs` cannot name a skipped test

Fed the **real** report produced above, the guard exits correctly and reports nothing useful:

```
GUARD_EXIT=1

Tests did not execute:

  5 skipped and 0 todo test(s) ran as non-executed on CI.
```

The count is right and the exit code is right. The list is **empty**, and it should have named all
five. Cause: `checkResults()` enumerates with

```js
if (t.status === 'pending' || t.status === 'todo')
```

while Vitest's JSON reporter writes `status: "skipped"` for these assertions. `numPendingTests`
aggregates them, so the count matches; the per-test loop matches nothing.

**Severity: LOW, and precisely bounded.** The gate still **fails closed** — nothing slips through,
and no claim made about it in revision 5 is wrong. What is lost is the diagnostic half: a CI
operator sees *"5 skipped"* with no indication of which tests, in a repository whose whole point is
that an unexplained skip is unacceptable. The fix is one string in the status test.

Recorded against **D11**, which stays **GREEN** — a gate that fails closed but explains itself badly
is not a gate that failed. Carried as debt, and it is exactly the kind of thing that only surfaces
by feeding a gate real output instead of a synthetic fixture: revision 5's six-input matrix used
hand-written JSON with `status: "pending"`, which is why it passed and this did not.

## 14.10 Final-SHA obligations added by this round

Carried forward so the final pass cannot quietly drop them:

1. **Work Order creation object-RBAC** (§14.8) — its own determination, separate from dispatch.
   Cases: own Lead positive control · inaccessible peer Lead · inaccessible Campaign · foreign
   tenant · nonexistent · and the durable `WorkOrder` count **and id set** before/after each refusal.
2. **Sequence preview classification** — treated as a classification question, not a presumed
   vulnerability. Verify at the frozen SHA that foreign or random ids cause no object disclosure, no
   durable mutation, and that output varies only as deterministic scheduling seed material. If all
   three hold, mark **N/A — opaque seed input**, and do not demand authorization that protects
   nothing.
3. **Skipped-test enumeration** — re-run the JSON-report enumeration and reproduce the table above
   against final code. The matrix must never say "5 skipped" without naming them.
4. **Inventory diff** — the auditor's 91-route / 21-relational-input inventory stays private from
   Agent A until their matrix is frozen, except the two scope items already surfaced deliberately.
   At the freeze, diff and report four categories: **missing from Agent A's matrix** · **extra in
   Agent A's matrix** · **same route, different classification** · **delegation claims verified or
   rejected**. The corrected helper set from §14.8 is used, not the one that produced the artefact.

## 14.11 Target 13 — BullMQ fixture isolation, measured (PROVISIONAL)

`1ce8229` changes two call sites from `prisma.jobRun.deleteMany()` to
`prisma.jobRun.deleteMany({ where: { tenantId } })`, and its comment names the mechanism exactly:
the bypass path injects no WHERE filter, so an unfiltered delete removes **every** `JobRun` row in
the database, and `run-now-immediate.test.ts` runs in parallel against the same rows — surfacing as
"a JobRun that was just enqueued reading back as null".

**That is the symptom this audit recorded in revision 2** (`expected null to be 'default-tenant'`)
and later retracted as contaminated. Both things are true and the distinction matters: the *rate*
revision 2 measured was contaminated by Agent A's concurrent database use and remains withdrawn,
but the *defect it pointed at was real*, and this is it. The retraction was of an unsound
measurement, not of the observation.

### Method

Run `tests/bullmq.test.ts` and `tests/run-now-immediate.test.ts` **simultaneously** against one
database, five pairs, with the cleanup scoping present and then reverted to `daf45fe`.

| Configuration | Pairs | Real test failures | Symptom |
|---|---|---|---|
| **Fixed** (`5d6eadf`) | 5 | **0** | — |
| **Reverted** (`daf45fe`) | 5 | **1** | `run-now-immediate` › *removes a terminal job and re-adds a fresh immediate one* — `AssertionError: expected 'cmsu1jm8u…' to be 'cmsu1jm8s…'`, i.e. the JobRun row identity moved underneath the assertion |

**A correction to the auditor's own first reading.** The raw exit codes showed one non-zero result in
*each* configuration, which looked like the experiment failing to discriminate. It was not: the
fixed-configuration non-zero run reports `Test Files 1 passed (1)`, `Tests 3 passed (3)` with a clean
summary and no error in the log. That non-zero status is an artefact of how this harness waits on two
backgrounded processes, not a test failure. Reading exit codes without reading the output is the
same shortcut that produced revision 5's false 17-failure Playwright result; caught here before
publication rather than after.

Discriminating result, therefore: **the collision reproduces when the scoping is reverted, and did
not reproduce in five pairs with it in place.**

### The finding the experiment produced anyway

Both suites declare the *same tenant*:

- `tests/bullmq.test.ts:34` and `:169` — `const tenantId = 'default-tenant'`
- `tests/run-now-immediate.test.ts:58` — `const tenantId = 'default-tenant'`

So `deleteMany({ where: { tenantId } })` scopes the delete to a tenant **both colliding suites
share**. The fix is directionally right and materially reduces blast radius — every *other* tenant's
`JobRun` rows are now safe, which is what made an unfiltered delete dangerous across the whole
suite — but it does **not** isolate the two suites the comment names from each other. They still
delete each other's rows; they simply no longer delete everyone else's.

Five clean pairs is weak evidence of isolation for a race whose window is narrow. The honest reading
is: **damage bounded, collision not eliminated.**

Suggested direction, not a demand: give each suite its own tenant id (a per-file constant, or one
derived from the filename) so the delete is scoped to something that is actually unique. That is a
test-fixture change with no production surface.

**Status: PROVISIONAL — REVERIFY AT FINAL SHA.** Recorded against target 13 as *partially
satisfied*: the regression is real and the fix demonstrably closes the cross-suite-wide case, while
the specific pair it cites remains theoretically able to collide. At the frozen SHA this is re-run
at higher N, and the shared-tenant observation is checked against whatever the final code does.

## 14.12 Inventory — final unresolved row closed

`admin/transfer-work/route.ts` → **CLEARED**. `lib/admin/transferWork.ts` calls
`getManageScope(actor)`, returns `403 Forbidden` when `scope.kind === 'none'`, and then requires
**both** the source and target user to be in scope — campaign-scoped through
`canManage(scope, userId, campaignId)` when a `campaignId` is supplied, user-scoped through
`canManageUser` otherwise. The body-supplied `campaignId` is therefore object-authorized, not merely
tenant-scoped.

Independent inventory status: of the eight routes with no helper visible in the route file, **five
are cleared** (`tasks`, `campaigns/[id]/members`, `demo/inbound-reply`, `sequences/preview`,
`admin/transfer-work`), **one is an active flag** (`work-orders` creation-side object RBAC, §14.8),
and **two pairs are deferred** to Agent A's in-flight work (`booking-links` ×2,
`client-reports` ×2). Nothing remains unresolved for reasons of auditor effort.

## 14.13 Branch movement

PR #69 head has moved from `5d6eadf` to **`d36b3b4`**. This is not a freeze SHA and no certification
work has been done against it. `C:\awt4` stays pinned at `5d6eadf` as the provisional control, so
every finding in §14 remains attached to a SHA that can still be checked out and disputed.

## 14.14 Booking Links at `f8c635f` — pre-registered probes run, one confirmed disclosure

PR #69 head moved again: `5d6eadf` → `d36b3b4` → **`f8c635f`** (CI #269 success). `f8c635f` adds
`canReferenceClient`, wires client + campaign reference checks into `POST /api/booking-links`, adds
`docs/REQUEST_REFERENCE_SECURITY_MATRIX.md`, and adds
`tests/booking-link-reference-integrity.test.ts`. Pinned at `C:\awt5`; still **PROVISIONAL**, no
certification.

The §14.4 Booking Link matrix was written **before** any of this existed. Running it now is the
point of having pre-registered it.

### What the fix covers — verified by reading, then testing

| Pre-registered case | Covered at `f8c635f`? |
|---|---|
| Client: foreign tenant / nonexistent | **Yes** — `canReferenceClient` → 404 |
| Client: same-tenant unauthorized | **Yes** — visibility via `getVisibleCampaignIds`, → 403 |
| Campaign: foreign / nonexistent / unauthorized | **Yes** — `canReferenceCampaign` → 404 / 403 |
| **Client A + Campaign of Client B, same tenant** | **Yes** — `campaign.clientId !== body.clientId` → **422**. This was the case a per-field check cannot catch, and it is handled. |
| `isDefault` cross-tenant clear | **Yes, as defence in depth** — the `updateMany` now states `tenantId` explicitly. The comment is honest that the extension already injected it and that no cross-tenant bug was reproduced. |
| Concurrent single-default invariant | **Not yet measured** — carried to the frozen SHA. |
| **GET disclosure from a poisoned relation** | **NO — reproduced. See below.** |

### CONFIRMED — cross-tenant disclosure through an unfiltered nested `include`

Constructed the fixture §14.4 specified: a **tenant A** `BookingLink` whose `clientId` points at a
**tenant B** `Client`. Then called the real `GET /api/booking-links` handler as a tenant A floor
manager, with only `@/auth` mocked.

```
[PROBE D-GET] status= 200 poisoned row returned= true
[PROBE D-GET] client payload = {"id":"zzaudit-client-b","name":"TENANT-B-SECRET-CLIENT"}

AssertionError: expected '[{"id":"zzaudit-link-poisoned","clien…' not to contain
'TENANT-B-SECRET-CLIENT'
```

**Mechanism, and why it is bigger than booking links.** The client extension in `lib/prisma.ts`
scopes the **top-level** operation — `applyScopedTenant` injects `tenantId` into
`bookingLink.findMany`'s `where`. It does **not** touch nested `include` selections. The route asks
for

```ts
include: {
  client:   { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  createdBy:{ select: { id: true, firstName: true, lastName: true } },
}
```

so any row whose foreign key crosses a tenant boundary discloses that foreign row's selected fields
to the reading tenant. Nothing in the isolation layer prevents it, because the isolation layer never
looks at includes. **This is a property of the tenancy mechanism, not of this endpoint**, and the
same shape appears wherever a route includes a relation. This audit has proven it for exactly one
route and does not claim more than it measured — but the generalisation is the reason it matters.

### The write vector — `PATCH /api/booking-links/[id]`, unfixed

A disclosure needs a poisoned row. `f8c635f` fixes `POST`, so that door is closed. The `[id]` route
was **not** touched (`git diff --stat 5d6eadf f8c635f -- 'app/api/booking-links/[id]/route.ts'` is
empty), and it exports `GET`, **`PATCH`**, `DELETE`. Its `PATCH`:

- is guarded by `requireRole('floor_manager')` and nothing else;
- accepts `body.campaignId` from `updateBookingLinkSchema` and writes it, with **no
  `canReferenceCampaign`** call;
- clears other defaults with an `updateMany` whose `where` names `clientId`, `campaignId` and
  `isDefault` but **no explicit `tenantId`** — the boundary `POST` just added.

So the chain is: **`PATCH` writes an unvalidated cross-tenant `campaignId` → the row is poisoned →
`GET` discloses the foreign campaign name.** The first half is established from source, the second
half is measured above. Poisoned rows can also predate any fix, which is why §14.4 said this
"matters independently of whether POST is later fixed."

**Correction to the auditor's own probe.** The second probe was written against a `PUT` export and
passed. The route exports `PATCH`. That pass was a **false negative** produced by probing the wrong
verb, not evidence of safety — recorded because a green result from a mis-aimed test is exactly the
kind of thing this audit exists to catch, including in itself. The `PATCH` finding above rests on
source inspection; measuring it is carried to the frozen SHA.

### Completeness check — first real output

Agent A's `docs/REQUEST_REFERENCE_SECURITY_MATRIX.md` carries five rows for `/api/booking-links`
POST (`clientId`, `campaignId`, the `campaign.clientId == clientId` consistency rule, the
session-wins fields, and the `isDefault` clear). It carries **no row for
`/api/booking-links/[id]`** in any verb.

That is the first confirmed **missing from Agent A's matrix** entry, and it is not a bookkeeping
nit: the missing route is the live write vector for the disclosure just reproduced. The auditor's
independent inventory (§14.2) listed `booking-links/[id]/route.ts` with `campaignId` and
`requireRole` only, before the matrix existed.

### Status

| Item | Status |
|---|---|
| Booking Link POST reference security | **PROVISIONAL GREEN** — including the client/campaign consistency case |
| Booking Link `isDefault` cross-tenant clear | **PROVISIONAL GREEN** (defence in depth on POST) · **PROVISIONAL RED on PATCH** — no explicit tenant boundary |
| Booking Link default concurrency | **UNMEASURED** — frozen SHA |
| **Booking Link GET disclosure** | **RED — reproduced** |
| **`PATCH /api/booking-links/[id]` reference security** | **RED — unfixed, and absent from the matrix** |

None of this changes a certification, because none is being issued. It is handed over now rather
than held to the freeze, because it is a live security finding in the area Agent A is working, and
withholding it to make a later report more impressive would be indefensible.

**Recommended, not demanded:** the disclosure has two independent fixes, and they are not
alternatives — filter nested includes by tenant (or stop including cross-tenant-capable relations in
list payloads), *and* validate `campaignId` in `PATCH` the way `POST` now does. The first bounds
existing poisoned rows; the second stops new ones.

## 14.15 Handover to Agent A — reproduction, and the blast radius

The auditor stays audit-only; these two REDs go to Agent A with everything needed to fix them, and
the auditor verifies the fix independently afterwards. Written now rather than held to the freeze —
a live cross-tenant disclosure is not something to sit on for a tidier report.

### RED-1 — cross-tenant disclosure through an unfiltered nested `include`

**Reproduce (about 40 lines, no HTTP server needed):**

1. Create tenants A and B.
2. Create a `Client` in **B** with a recognisable name.
3. Create a `BookingLink` in **A** whose `clientId` points at B's client — write it directly through
   Prisma under `tenantStorage.run({ tenantId: A, bypassRls: true })`. This is what a row created by
   any pre-fix code path looks like.
4. Mock `@/auth` to return a tenant A user, import `GET` from `app/api/booking-links/route.ts`, call
   it, and read the JSON.

Observed at `f8c635f`:

```
status = 200, poisoned row returned = true
client payload = {"id":"zzaudit-client-b","name":"TENANT-B-SECRET-CLIENT"}
```

**Cause.** `applyScopedTenant` injects `tenantId` into the **top-level** operation's `where`. It does
not descend into `include`. Any row whose foreign key crosses a tenant boundary therefore discloses
the selected fields of the foreign row.

**Blast radius — measured, not estimated.** 40 route files use `include:`. **29 of them include at
least one tenant-owned relation**, and every one is a candidate for the same disclosure whenever a
poisoned row exists:

`activities` · `admin/imports` · `admin/imports/[id]` · `admin/outbound` · `automation/stats` ·
`booking-links` · `booking-links/[id]` · `campaigns` · `client-reports` · `client-reports/[id]` ·
`client-reports/[id]/share` · `cron/sequence-engine` · `email-health/alerts` · `inbox` · `leads` ·
`leads/[id]` · `meetings` · `meetings/[id]` · `opportunities` · `opportunities/[id]` · `sequences` ·
`sequences/[id]/enrollments` · `sequences/[id]/enrollments/[enrollmentId]/status` ·
`tasks/[id]/run-now` · `team/alerts` · `team/campaigns` · `team/meetings` · `templates` · `notes`

The widest are `opportunities` and `opportunities/[id]`, which include eight relations each
(`account`, `campaign`, `client`, `contact`, `createdBy`, `lead`, `meeting`, `owner`).

**This is why the fix should not be per-route.** Patching `booking-links` alone leaves 28 routes with
the same property. The durable fix is in the isolation layer — have the extension scope nested
includes for tenant-owned models, the way it already scopes the top level — with per-route include
trimming as a fallback only where that is impractical.

**A bound the auditor will not overstate:** exploitation requires a poisoned row. The auditor has
**not** demonstrated that any exists in a real database, only that one can be written and that the
read path discloses it. The severity therefore rests on RED-2.

### RED-2 — `PATCH /api/booking-links/[id]` writes an unvalidated cross-tenant reference

`f8c635f` fixed `POST`. `git diff --stat 5d6eadf f8c635f -- 'app/api/booking-links/[id]/route.ts'`
is empty. That route exports `GET`, **`PATCH`**, `DELETE`, and its `PATCH`:

- is guarded by `requireRole('floor_manager')` and nothing else;
- accepts `body.campaignId` via `updateBookingLinkSchema` and writes it, with **no
  `canReferenceCampaign`** call — the check `POST` now performs;
- clears sibling defaults with an `updateMany` whose `where` names `clientId`, `campaignId`,
  `isDefault` and **no explicit `tenantId`** — the defence-in-depth boundary `POST` just gained.

So `PATCH` is the live vector that produces the poisoned row RED-1 discloses. Established from
source; **measurement is carried to the frozen SHA**, because the auditor's first probe was aimed at
a `PUT` export this route does not have and its pass was a false negative.

**Suggested fixes, which are not alternatives:**
1. Scope nested includes by tenant in `lib/prisma.ts` — bounds every poisoned row that already
   exists, across all 29 routes.
2. Call `canReferenceCampaign` in `PATCH`, and give its `updateMany` the same explicit `tenantId`
   boundary `POST` has — stops new poisoned rows.

### What the auditor will do on the fix

Re-run the §14.4 probe against the frozen SHA, unchanged, plus: a `PATCH` probe aimed at the correct
verb; the default-concurrency invariant; and a spot check that at least two of the other 28 include
routes no longer disclose a poisoned relation. Fixing only `booking-links` will be reported as a
partial fix, with the remaining routes named.

## 14.16 `ad63b42` — default-concurrency fix verified; the two REDs are untouched

Head moved `f8c635f` → `28b3471` (docs) → **`ad63b42`**. Pinned at `C:\awt6`, `PRE_STATUS` 0.
Still PROVISIONAL; no certification.

### Verified — the default-concurrency invariant

`ad63b42` wraps the default-clearing and the create in one `prisma.$transaction` and takes a
Postgres advisory lock first:

```ts
const lockKey = `booking-link-default:${user.tenantId}:${body.clientId}:${body.campaignId ?? ''}`;
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
```

The key is scoped to tenant + client + campaign, so it serialises exactly the scope the invariant is
about and nothing wider.

Measured with the §14.4 pre-registered case — **two concurrent `isDefault` creates, 12 rounds,
through the real `POST` handler, against real Postgres**, counting defaults after every round:

| Configuration | Result |
|---|---|
| Reverted to `f8c635f` (no lock) | `rounds=12 createdOk=24 nonCreate=0 totalLinks=24 worstConcurrentDefaults=2` → **invariant violated**, `AssertionError: expected 2 to be less than or equal to 1` |
| **`ad63b42` (advisory lock)** | **assertion passed — never more than one default for the scope across all 12 rounds** |

Red-green, on one harness, against the real handler. **Target "Booking Link default concurrency" →
PROVISIONAL GREEN.** Both requests still succeed; the losing one simply has its default cleared by
the winner, which is the correct semantics rather than an error.

### Unchanged — the two REDs from §14.14 are still open at `ad63b42`

Re-checked at this exact SHA, not assumed:

| Check | Result at `ad63b42` |
|---|---|
| `PATCH /api/booking-links/[id]` calls `canReferenceCampaign` / `canReferenceClient` | **0 occurrences** |
| `lib/tenant-inject.ts` scopes nested `include` | **0 occurrences** |

So **RED-1** (cross-tenant disclosure through an unfiltered nested `include`, reproduced at
`f8c635f`) and **RED-2** (`PATCH` writes an unvalidated cross-tenant `campaignId`) both stand. The
commits since `f8c635f` addressed a different pre-registered case — a real one, and one the auditor
had listed as unmeasured — but not these.

Recorded plainly because the sequence matters: three heads have shipped since the disclosure was
reproduced, all green in CI, none of them touching it. CI cannot see this class of defect, which is
the entire reason the row exists.

### Running Booking Link status

| Case | Status |
|---|---|
| POST client reference (foreign / nonexistent / same-tenant unauthorized) | PROVISIONAL GREEN |
| POST campaign reference | PROVISIONAL GREEN |
| POST client/campaign consistency (Client A + Client B's campaign, same tenant) | PROVISIONAL GREEN — 422 |
| POST `isDefault` cross-tenant clear | PROVISIONAL GREEN — explicit `tenantId` in the `updateMany` |
| **Default concurrency** | **PROVISIONAL GREEN — measured this round** |
| **GET disclosure from a poisoned relation** | **RED — reproduced, open** |
| **PATCH `[id]` reference security** | **RED — open, and absent from `docs/REQUEST_REFERENCE_SECURITY_MATRIX.md`** |

Five of seven pre-registered Booking Link cases are now provisionally green. The two that are not
are the two the auditor raised, and both remain exactly as reported.

---

# 15. Role change — the auditor became an implementer

Recorded at the top of its own section because it changes how everything after it must be read.

Asked directly whether "let's fix" meant switching roles, the answer was **"Stay auditor"**. The
instruction was then repeated — *"if found you must fix them all"* — and taken as the decision.

**Consequence, stated once and not softened:** this auditor can no longer credibly certify PR #69.
Code written here would be approved by its own author. Sections 1–14 were produced under
independence and stand; anything from here needs a different certifier.

## 15.1 RED-1 — fixed by Agent A, verified independently

`4e90e07` selects `tenantId` on each included relation in `GET /api/booking-links` and withholds any
relation belonging to another tenant, keeping the row itself visible. The reasoning in the commit is
sound and credits the measurement that found it.

Verified by re-running the §14.4 probe **unchanged** at `8fb6b6e`: **passes**. The poisoned tenant-A
link no longer discloses tenant B's client name.

**Scope, unchanged: this is a route-level fix.** `lib/tenant-inject.ts` still contains no
include-scoping, so the other **28** routes that include a tenant-owned relation retain the
property. Reported as a **partial** fix, exactly as §14.15 said it would be.

## 15.2 RED-2 — was exploitable, now fixed here

Source inspection said `PATCH /api/booking-links/[id]` accepted `campaignId` with no check.
Measured through the real handler against real Postgres, before any change:

```
PATCH { campaignId: <tenant B campaign> }  ->  status 200, campaignId after = tenant B's campaign
PATCH { campaignId: <nonexistent> }        ->  status 500 (raw foreign-key error)
```

A **confirmed cross-tenant write**, not a theoretical one — and the live vector for the disclosure
`4e90e07` had just closed on the read side.

Fix committed as `495ab2b` on branch `fix/booking-link-patch-reference-security` (worktree
`C:\awt7`, based on `8fb6b6e`). **Not pushed** — pushing into Agent A's open PR is an outward action
and was not authorised.

What it does, all mirroring the create path rather than inventing a parallel rule:
`canReferenceCampaign` before any write (404 missing-or-foreign, 403 unusable, deliberately
indistinguishable) · the client/campaign consistency rule at 422 · the default-clearing
`updateMany` moved inside a transaction behind the same `pg_advisory_xact_lock`, stating its own
`tenantId` · `GET` and `PATCH` withhold foreign relations the way the collection endpoint now does.

### Verification of this author's own change

| Gate | Result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `eslint` on both changed files | **exit 0** |
| Full Vitest at `8fb6b6e` + fix | **exit 0** — `Test Files 116 passed \| 1 skipped (117)`, `Tests 1660 passed \| 5 skipped (1665)` |
| New regression test, fix applied | 2 passed |
| New regression test, route reverted | **2 failed** — `expected 200 to be 404`, `expected 500 to be 404` |

The red-green is the part that matters: `tests/booking-link-patch-reference-integrity.test.ts` fails
against the previous handler, so it guards the behaviour rather than describing it.

## 15.3 Next, and why it is not being done unilaterally

The remaining item from §14.15 is the **systemic** fix: scope nested `include` selections by tenant
inside `lib/prisma.ts`, which would close all 28 remaining routes at once instead of patching them
one at a time.

It is not being done in the same breath as the above, and the reason is not caution for its own
sake: that file is the isolation layer every query in the application passes through, its behaviour
is relied on by 1,660 tests, and a change there is the highest-blast-radius edit available in this
repository. It wants its own decision, its own review, and — given §15 — a certifier who did not
write it.

Per-route withholding, of the kind `4e90e07` and `495ab2b` both use, remains available as the
lower-risk path: 28 routes, mechanical, individually verifiable.

## 15.4 The systemic fix was attempted, did not work, and was reverted

Recorded in full because a failed attempt that passed every gate is the most useful thing in this
section.

**What was built.** `lib/tenant-includes.ts` — pure functions mirroring `lib/tenant-inject.ts`:
a DMMF-derived relation map, `forceTenantIdOnRelations` (inject `where: { tenantId }` into to-many
includes, force `tenantId` into to-one selections so they can be checked), `scrubForeignRelations`
(null a to-one relation whose `tenantId` differs, drop foreign entries from lists), and
`stripForcedFields` (remove the injected `tenantId` so payload shape is unchanged). Wired into the
scoped path of the extension in `lib/prisma.ts`.

**What the gates said.**

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| Full Vitest | **exit 0** — `Test Files 117 passed \| 1 skipped (118)`, `Tests 1662 passed \| 5 skipped (1667)` |

Green type check. Green suite, including two more tests than before. By every gate this repository
runs, the change was fine.

**What direct measurement said.** A poisoned row read through the scoped path — no route involved,
so only the extension was under test:

```
=== WITH systemic fix ===
[SYSPROOF] client = {"id":"zzs-client-b","name":"TENANT-B-SECRET-CLIENT"}
[SYSPROOF] leaked = true
=== WITHOUT ===
[SYSPROOF] client = {"id":"zzs-client-b","name":"TENANT-B-SECRET-CLIENT"}
[SYSPROOF] leaked = true
```

**Identical with and without.** The change had no effect on the behaviour it existed to change.
Root cause was not isolated before the attempt was reverted; candidates include the relation map
being empty at runtime, the mutated `args` not reaching the driver, or the result never passing
through the new `finish` path. Any of those would produce exactly this: a change that compiles,
passes 1,662 tests, and does nothing.

**Reverted.** `lib/prisma.ts` restored to `HEAD`, `lib/tenant-includes.ts` deleted. The isolation
layer is untouched by this audit.

**Why it was reverted rather than debugged further.** Shipping a security fix whose only evidence is
a green suite would be the precise failure this entire audit was created to catch — the same shape
as the tenant-bootstrap test that could not fail, the discipline gate that could not name a skipped
test, and the Playwright run that failed for environmental reasons. A fix that cannot be
demonstrated working is not a fix; it is a claim.

**Consequence for the matrix.** The systemic nested-include property remains **open**. The 28
routes named in §14.15 still include tenant-owned relations without a per-route guard. Two routes
are protected by hand — `GET /api/booking-links` (`4e90e07`, verified) and
`GET|PATCH /api/booking-links/[id]` (`495ab2b`, verified). The remaining 28 are unprotected, and
the durable fix still wants either a working extension-level change or 28 mechanical per-route
withholdings.

**What the next attempt should do differently:** write the failing measurement *first* — the
`SYSPROOF` script above, run before any code changes, going from `leaked = true` to `leaked = false`
— and treat the test suite as a regression check only. The suite was never going to detect this,
because no test in it reads a cross-tenant relation.

## 15.5 Delivered

Branch `fix/booking-link-patch-reference-security` pushed to `origin`, based on `8fb6b6e`. Two
commits, no force, no existing branch touched.

| SHA | What |
|---|---|
| `495ab2b` | `fix(security): validate the campaign reference on booking-link PATCH` — the confirmed cross-tenant write, closed, with a regression test that fails against the previous handler |
| `eab5e05` | `test(security): add a runnable reproduction for the nested-include disclosure` — `scripts/repro-nested-include-leak.ts` |

Not opened as a pull request; the branch is there to merge, cherry-pick or discard.

### The reproduction script, verified

```
$ npx tsx scripts/repro-nested-include-leak.ts     # against a scratch database
client returned : {"id":"repro-nested-client-b","name":"TENANT-B-CLIENT-NAME-THAT-MUST-NOT-CROSS"}
leaked          : true
RESULT: the foreign relation crossed the tenant boundary. This is the defect.
exit 2

$ DATABASE_URL=…/telestar_crm npx tsx scripts/repro-nested-include-leak.ts
repro failed to run: Refusing to run against "telestar_crm": the name does not contain dev,
development, test or local. This script writes rows. Point it at a scratch database.
```

`tsc --noEmit` exit 0, `eslint` exit 0. It reads through the Prisma client directly, so a fix has
to change the isolation layer to make it pass — no route can satisfy it.

It exits **2** while the defect is present, which keeps it out of CI deliberately: a permanently
red check teaches people to ignore red checks. It is a driver for the fix, and becomes a candidate
for CI the moment it passes.

### Handover, and what is explicitly not claimed

The systemic property is **open**, and this auditor could not close it — §15.4 records the attempt,
its green gates, and its total lack of effect. What is handed over is a measurement that fails,
which is the thing the previous attempt lacked and the reason it failed silently.

The one technical constraint worth carrying forward: Prisma accepts `where` on a **to-many**
include and not on a **to-one** include. A to-one relation can therefore only be filtered after
the query returns, which means `tenantId` must be forced into the selection for it to be checkable,
and then removed again if the caller did not ask for it. Any design that overlooks this will pass
its tests and change nothing, exactly as §15.4's did.

### Standing status after this section

| Row | Status |
|---|---|
| `GET /api/booking-links` foreign-relation disclosure | **GREEN** — Agent A's `4e90e07`, verified independently |
| `GET`/`PATCH /api/booking-links/[id]` | **GREEN** — `495ab2b`, red-green verified |
| Nested-include disclosure, remaining 28 routes | **RED — open**, with a runnable reproduction |
| PR #69 certification by this auditor | **Forfeit** — §15 |
| CI Redis | GREEN · **LIVE managed Redis** RED · **CSP** YELLOW |

---

# 16. Verifications at `634e147`

Pinned at `C:\awt8`, `PRE_HEAD` = `POST_HEAD` = `634e147`, clean throughout. Private database.
Full suite: **exit 0**, `Test Files 118 passed | 1 skipped (119)`, `Tests 1672 passed | 5 skipped (1677)`.

Three items the auditor had left open are closed by measurement rather than by reading.

## 16.1 Work Order creation object-RBAC — §14.8 flag closed

`634e147` adds to `POST /api/work-orders`, before `createWorkOrder` is reached:

```ts
const lead = await prisma.lead.findFirst({ where: { id: parsed.data.leadId, tenantId: user.tenantId }, … });
if (!lead || !(await canAccessLead(user, lead))) return 403;
if (parsed.data.campaignId) { const c = await canReferenceCampaign(user, parsed.data.campaignId); if (c !== 'ok') return 403; }
```

That is object-level authorization, which is exactly what §14.8 said was missing: `resolveScope`
checked tenancy explicitly and well, and never asked whether *this caller* could reference *this
lead*.

Red-green: reverting the route to `a1bc035` → **1 failed / 5 passed**, the failure being
`refuses an in-tenant lead the caller cannot access, and leaks nothing by doing so`. Restored →
9 passed. The one discriminating test is the right one, and the "leaks nothing" half matters —
a 404 would have distinguished a peer's lead from a nonexistent id.

**Row: PROVISIONAL GREEN.**

## 16.2 Client Reports reference security — §14.5 plan executed by the implementation

`a1bc035` validates `clientId` and `campaignId` on `POST /api/client-reports` before metrics are
computed. Red-green: reverting the route → **6 failed**, and the six are almost case-for-case the
matrix the auditor registered in §14.5 before any of this existed:

- refuses a client in another tenant
- refuses a campaign in another tenant
- refuses a client that does not exist
- refuses a campaign that does not exist
- refuses an in-tenant client the caller cannot see
- refuses an in-tenant campaign the caller cannot see

Restored → 9 passed.

**Row: PROVISIONAL GREEN**, with two cases from §14.5 still unasserted and carried: a **spoofed
actor** (`generatedById` / `approvedById` supplied in the body must lose to the session) and
**share-token isolation** across tenants.

## 16.3 Sequence preview — classified N/A, on the criteria set in advance

§14.10 said this was a classification question, not a presumed vulnerability, and named three
conditions for marking it **N/A — opaque seed input**: no object disclosure from foreign or random
ids, no durable mutation, and output varying only as deterministic scheduling seed material.
`tests/sequence-preview-opaque-ids.test.ts` asserts all three, including the one that actually
settles it:

> `does not distinguish an id from another tenant from one that does not exist` — same status, same
> response keys.

An endpoint that never dereferences an id cannot disclose anything by being handed one, and
demanding authorization there would protect nothing while implying the id had meaning.

**Row: N/A — opaque seed input.** No authorization is required and none should be added.

## 16.4 Record preserved

`docs/ALL_GREEN_ACCEPTANCE_MATRIX.md` was untracked — 2,243 lines existing only in one working
copy. Committed as `985c6f8` on branch `docs/all-green-acceptance-matrix`, cut from `origin/main`
and pushed. The audit record now survives the machine it was written on, which it previously
did not.

---

# 17. Completeness check — independent inventory vs `REQUEST_REFERENCE_SECURITY_MATRIX.md`

Compared at `634e147`. The auditor's inventory (§14.2, corrected in §14.8) was built from route
source before the implementation's matrix existed and without reading it. This is the diff.

| | count |
|---|---|
| Routes in the implementation's matrix | **6** (17 field rows) |
| Routes in the auditor's inventory accepting a request-controlled relational id | **21** |
| Overlap | **5** |

`/api/leads` · `/api/booking-links` · `/api/client-reports` · `/api/work-orders` ·
`/api/sequences/preview`.

## 17.1 Missing from the implementation's matrix — 16 routes

`booking-links/[id]` · `client-reports/preview` · `leads/[id]` · `leads/import` · `activities` ·
`ai/draft-outcome` · `email/send` · `meetings` · `notes` · `reminders` · `tasks/bulk` · `tasks` ·
`campaigns` · `campaigns/[id]/members` · `admin/transfer-work` · `demo/inbound-reply`

Absence is not the same as exposure, and most of these are fine. Five were **cleared by the auditor
in §14.8** — `tasks`, `campaigns/[id]/members`, `demo/inbound-reply`, `admin/transfer-work`, and
`booking-links/[id]` (cleared by being fixed in `495ab2b`). Eight more call a guard visible in the
route itself: `activities`, `ai/draft-outcome`, `email/send`, `meetings`, `notes`, `reminders`,
`tasks/bulk`, `leads/[id]` all call `canAccessLead` or `canAccessUser`, and `campaigns` calls
`getVisibleCampaignIds`. None of those has a *negative test*, but none is unguarded.

**Two are neither documented nor guarded, and both are the same defect class already fixed on a
sibling route.** That is the finding this diff exists to produce.

## 17.2 `POST /api/client-reports/preview` — unguarded, and its sibling was just hardened

```ts
const userOrRes = await requireAuth();            // …and nothing else
const snapshot = await buildReportMetrics({
  clientId: body.clientId,
  campaignId: body.campaignId,
  …
});
return NextResponse.json({ snapshot });
```

`POST /api/client-reports` gained `canReferenceClient` + `canReferenceCampaign` in `a1bc035`, with
six red-green tests. `preview` takes **the same two fields**, computes **the same metrics** through
the same `buildReportMetrics`, and checks neither. This is the identical asymmetry as
booking-links `POST` fixed / `PATCH` open: one door closed, the adjacent one left standing.

What is at stake here is worse than a leaked name — the payload is a *metrics snapshot*: meetings
booked, contacts touched, sequence performance for a client and campaign the caller names.

**Honest mitigation, stated because it probably prevents disclosure today:** the queries inside
`buildReportMetrics` go through the Prisma extension, which scopes top-level reads by `tenantId`,
so a foreign `clientId` most likely yields an empty snapshot rather than another tenant's numbers.
That is exactly the reliance `canReferenceCampaign`'s own comment warns against — *"a reference
check that depends on an ambient behaviour is one refactor away from silently passing"*. It also
still answers, which distinguishes a real foreign id from an invented one unless the empty result
is identical for both.

**Status: RED-candidate, needs measurement.** The auditor has not measured this one; saying so is
the difference between this row and §14.14, which was reproduced before it was reported.

## 17.3 `POST /api/leads/import` — capability checked, reference not

```ts
if (!canImportExport(user.role)) return 403;      // capability, not object
…
campaignId: isPool ? null : body.campaignId!,     // straight from the body, unvalidated
```

`POST /api/leads` refuses a cross-tenant `campaignId` — reproduced at **HTTP 201** before
`canReferenceCampaign` existed, per that function's own docblock. The import path creates leads
with `campaignId` taken from the body and never checks it. A database foreign key enforces
*existence*, not *tenancy*, so nothing below this line stops the attachment.

This is the same defect, on the path that creates leads in bulk.

**Status: RED-candidate, needs measurement.** Measuring it needs the import worker, so it wants
Redis — which is why it is reported rather than reproduced.

## 17.4 Extra in the implementation's matrix — none

Every route it lists appears in the auditor's inventory. No phantom coverage.

## 17.5 Same route, different classification

One, and it is benign: the matrix carries `tenantId` rows for `/api/leads`, `/api/booking-links`,
`/api/client-reports` and `/api/work-orders` marked *"ignored, session wins"*. The auditor's
inventory filtered `tenantId` out by construction, on the grounds that a field stamped from the
session is not attack surface. Documenting it is defensible and arguably better — it records that
the field was considered and neutralised, which an omission does not.

## 17.6 Delegation claims — verified

Every delegation the auditor asserted in §14.8 was traced to the module that owns the check, not
assumed: `tasks` → `lib/tasks/service.ts` (translates `Forbidden` → 403, `Lead not found` → 404) ·
`campaigns/[id]/members` → `getManageScope` / `canManage` · `admin/transfer-work` →
`lib/admin/transferWork.ts`, which requires **both** users in scope and 403s on
`scope.kind === 'none'` · `demo/inbound-reply` → hard-gated to `DEMO_TENANT_ID` · `sequences/preview`
→ nothing to delegate, ids are never dereferenced (§16.3).

**None rejected.**

## 17.7 What the diff is worth

A matrix covering 6 of 21 routes is not wrong, but it cannot support a completeness claim — and the
two routes it omits that nobody guarded are both siblings of routes it *does* cover and that were
fixed. The pattern is consistent and worth naming: **the fixes have been correct, and the misses
have been adjacent.** A per-field matrix built from the routes already known to be interesting will
keep reproducing that shape. Enumerating from the route surface first is what breaks it.

## 17.8 `client-reports/preview` measured — downgraded from RED-candidate to YELLOW

§17.2 flagged this as a RED-candidate and said explicitly that it had not been measured. It has
now been, at `634e147`, through the real handler against real Postgres, as a tenant A director:

| Request | Status | Body |
|---|---|---|
| own client (`tenant A`) | **200** | full snapshot, 3,008 bytes, `clientName: "TENANT-A-OWN-CLIENT"` |
| **foreign client + campaign (`tenant B`)** | **500** | `{"error":"Internal server error"}`, 33 bytes |
| invented client + campaign | **500** | `{"error":"Internal server error"}`, 33 bytes |

```
foreign leaks name    = false
foreign === invented  = true
```

**The security outcome is correct.** No cross-tenant metrics are returned, no client or campaign
name crosses, and a real foreign id is **byte-identical** to an invented one — so there is no
existence oracle either. The mitigation §17.2 predicted does hold: the Prisma extension scopes the
reads inside `buildReportMetrics`, the lookup yields nothing, and no foreign data is computed.

**The mechanism is still wrong, which is why this is YELLOW and not GREEN.** The refusal is a
**500**, not a 404 — an unhandled throw somewhere below a lookup that returned null. Three
consequences, none of them a vulnerability:

1. A client error is reported as a server error. The caller is told the server broke; it did not.
2. Every mistyped id becomes an alert. Error monitoring cannot distinguish this from a real fault,
   which is how real faults get tuned out.
3. It is safe **by accident, not by design**. Nothing in that route decided to refuse; a downstream
   throw did. The sibling route `POST /api/client-reports` refuses the same input deliberately,
   with `canReferenceClient` / `canReferenceCampaign` and six tests. This one is one refactor away
   from behaving differently, and nothing would catch it.

**Recommendation:** add the same two reference checks for a deliberate 404, matching the sibling.
It changes no security outcome today; it makes today's outcome intentional and testable.

**Correction to §17.2, recorded rather than edited away.** That section reasoned from source that
the payload at stake was "meetings booked, contacts touched, sequence performance for a client and
campaign the caller names". Measurement says the caller gets 33 bytes of error. The reasoning was
sound and the conclusion was too pessimistic — which is exactly why §17.2 labelled it *needs
measurement* instead of asserting it. A flag that survives measurement is a finding; this one did
not, and it is downgraded on the evidence rather than defended.

`POST /api/leads/import` (§17.3) remains **RED-candidate, unmeasured** — reproducing it needs the
import worker and therefore Redis. Its reasoning is the same shape as this one's, and it deserves
the same scepticism until someone measures it.

---

# 18. The nested-include disclosure, closed — and §15.4 overturned

## 18.1 §15.4 was wrong, and the reason matters more than the row

§15.4 reported an attempt at the systemic fix that "compiled, passed all 1,662 tests, and did
nothing", and reverted it. That conclusion is **withdrawn**. The fix was never exercised: the
script proving it ran the wrong code path.

Traced directly, by instrumenting the extension:

```
[TRACE] op BookingLink findMany store= undefined NODE_ENV= undefined
```

The reproduction ran `tenantStorage.run({ tenantId }, () => prisma.bookingLink.findMany(…))` — a
bare arrow returning the promise. The AsyncLocalStorage context did not reach the extension, the
store arrived `undefined`, and the query took the **bypass** path, which discloses the relation for
a reason that has nothing to do with this defect. It printed `leaked = true` and proved nothing.

With an `async` callback that awaits inside, the same trace reads
`store= {"tenantId":"repro-nested-a","bypassRls":false}` — the scoped path — and the disclosure is
still there. That is a valid reproduction, and the same fix then turns it green.

**So the auditor published, and handed over, a broken measurement** (`eab5e05`), and then used it to
declare a fix ineffective. Both errors are corrected in `0d30bef` rather than quietly amended. The
original §14.14 disclosure is unaffected — that was measured through the real route handler with a
session, which establishes the scoped path correctly.

The instructive part: the test suite could detect neither the defect nor the broken proof. Ten lines
of instrumentation detected both in a single run. When a measurement and a suite disagree about
whether code ran, instrument before theorising.

## 18.2 The fix

`0d30bef` on `fix/nested-include-tenant-scoping`, based on `634e147`, pushed.

`lib/tenant-includes.ts` (new) · `lib/prisma.ts` (wired into the scoped path) ·
`tests/tenant-includes.test.ts` (new) · `scripts/repro-nested-include-leak.ts` (corrected).

Two mechanisms, because Prisma accepts a `where` on a **to-many** include and not on a **to-one**:

- to-many → `where: { tenantId }` injected, so foreign rows never leave the database;
- to-one → `tenantId` forced into the selection, the relation nulled when it belongs elsewhere, and
  the forced field removed again so the response shape is exactly what the caller asked for.

The relation is withheld, never the parent row. A relation whose `tenantId` was not selected is
left alone rather than guessed at — nulling on a guess is a visible product break, while the
disclosure needs a row that already points across the boundary.

**This closes the property for all 30 include-routes**, not the two patched by hand.

| Gate | Result |
|---|---|
| `scripts/repro-nested-include-leak.ts` | `leaked = true` → **`leaked = false`**, exit 0 |
| `tests/tenant-includes.test.ts` with the fix | 6 passed |
| same test, `lib/prisma.ts` reverted | **1 failed** — `expected '…' not to contain 'TINCL-TENANT-B-CLIENT'` |
| `tsc --noEmit` | exit 0 |
| `eslint` | exit 0 |
| Full suite | **exit 0** — `Tests 1678 passed \| 5 skipped (1683)`, the 1,672 baseline plus this file's six |

## 18.3 Row changes

| Row | Before | Now |
|---|---|---|
| Nested-include disclosure, 28 remaining routes | **RED** | **GREEN (pending review)** — closed at the isolation layer, red-green verified |
| §15.4 "systemic fix had no effect" | recorded as fact | **withdrawn** — the proof was broken, not necessarily the code |
| `eab5e05` reproduction script | handed over as the driver | **superseded** by the corrected version in `0d30bef` |

"Pending review" is deliberate: this is the auditor's own code, in the isolation layer every query
passes through, and §15 already records that this auditor cannot certify it. It wants a reviewer
who did not write it.
