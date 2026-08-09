# Playwright Deep Audit — Plan

Companion to [`INVENTORY.md`](./INVENTORY.md) and [`API-ROUTES.md`](./API-ROUTES.md).
Branch: `test/playwright-deep-audit`, cut from `main` @ `06d3f79`.

**Nothing in the test suite has been changed yet.** This document is the §58 deliverable that
must be reviewed before it is.

---

## 1. Target environment — decision required

The audit brief's preference order is staging → isolated local/CI DB → isolated tenant on the
deployment. There is no staging target, so **local is the primary environment**:

- PostgreSQL 16 `telestar_crm`, seeded, 3 tenants, all six roles present
- `.env.local` already pins `EMAIL_SEND_DRY_RUN` / `SEQUENCE_AUTOSEND_ENABLED` /
  `EMAIL_HEALTH_AUTOPAUSE`; each batch re-asserts them before running
- test accounts created per run with `PW_`-prefixed identities and a password from
  `E2E_PASSWORD`, never the published `telestar2026`

**Blocker: there is no Redis and no Docker on this machine.** Without Redis, imports silently
fall back to the inline path, so §19 (job completion), §37 (worker health), §38 (Redis
recovery) and §39 (maintenance repairs) would produce green tests that prove nothing — the
BUG-003 failure mode. Batches 4–6 stay blocked until one of:

1. **Memurai Developer** installed as a Windows service — recommended, smallest change
2. `wsl --install -d Ubuntu` + `apt install redis-server`
3. run only those batches against the GCE box, with run-scoped accounts and no destructive steps

I need a decision on which before Batch 4. Batches 0–3 and 7–9 do not need Redis.

---

## 2. Harness changes before any assertions

| Change | Why |
|---|---|
| six `playwright/.auth/*.json` storage states via a `setup` project | §3 — every current spec logs in inline; no role isolation |
| projects per viewport: `1440x900` (primary), `1024x768`, `900x800` | §4/§42 — config today is a single `1280x800` |
| `trace: 'retain-on-failure'`, `video: 'retain-on-failure'` | config sets `on-first-retry` with `retries: 0`, so **traces are never captured today** |
| shared `e2e/support/` — console/network recorders, API client, poll-until-job-done, `PW_` data factory, cleanup | §49/§53; the recorder logic already exists in the throwaway `e2e/qa/_helpers.ts` and gets promoted |
| console/network failure policy as a fixture, with a documented allowlist | §5 |

Existing `e2e/qa/lane*.spec.ts` is self-labelled throwaway scaffolding. It is **not** part of
the audit suite; its helpers get promoted into `e2e/support/` and the lanes are then deleted in
Batch 9, not before — they are useful reference while writing the real specs.

---

## 3. Execution batches

> **Ordering decision (2026-08-09):** everything that does not need Redis runs first; the
> Redis-dependent batches are parked to the end and picked up once one of the options in §1 is
> chosen. Batches 0–3 are complete — see [`FINDINGS.md`](./FINDINGS.md).
>
> **Run against a production build, not `next dev`.** The audit found a sign-out defect that
> exists only under `next dev` (PW-AUDIT-003), which is enough on its own to distrust dev as
> the audit target. `next build` + `next start -p 3000` — the port matters, `NEXTAUTH_URL`
> pins 3000 and a mismatch silently breaks `signOut()`'s callback.


Each batch: write specs → run → collect evidence → classify → fix one at a time with a failing
regression test first (§51) → re-run.

| # | Batch | Sections | Needs Redis |
|---|---|---|---|
| 0 | Harness: storage states, viewports, recorders, data factory | §3, §4, §5, §49, §53 | no |
| 1 | Authentication + session revocation | §6 | no |
| 2 | RBAC matrix, UI **and** raw API, per role | §7, §57 | no |
| 3 | IDOR between two SDRs + tenant isolation across the 3 tenants | §8, §9 | no |
| 4 | Async spine: enroll, Run Now, import, sync, maintenance — polled to terminal state | §19, §20, §37, §39 | **yes** |
| 5 | Email: composer, idempotency, suppression, reply, bounce, health, safety switches | §21–§29 | **yes** |
| 6 | Redis recovery + delayed-job reconstruction | §38 | **yes** + service control |
| 7 | CRUD surfaces: leads, detail panel, tasks, sequences, campaigns/clients, meetings, opportunities, reports, notifications, audit | §10, §13–§18, §30–§36 | partial |
| 8 | Journeys A–H end to end | §45 | yes for C/H |
| 9 | Cross-cutting: filters/pagination, concurrency, persistence, a11y, desktop gate, AI, SIP; audit existing specs; delete `e2e/qa/` | §40–§44, §46–§48 | no |

Batches 2 and 3 come first among the assertion batches because they are where a P0 would be,
and because they need no infrastructure.

---

## 4. Proposed file structure

Matches §52, with `support/` added because the brief's "reuse helpers" instruction needs a home.

```
e2e/
  support/            auth.setup.ts · fixtures.ts · api.ts · jobs.ts · data.ts · console.ts
  auth/               authentication.spec.ts · session-revocation.spec.ts
  roles/              director · floor-manager · team-lead · sdr · leadgen-manager · leadgen
                      role-negative-access.spec.ts · tenant-isolation.spec.ts
  leads/              lead-crud · lead-access · import · lead-detail-actions
  sequences/          sequence-crud · enrollment · run-now · sequence-worker
  email/              composer · idempotency · suppression · reply · bounce · email-health
  meetings/           meetings · outcomes
  opportunities/      pipeline · handoff
  reports/            client-report · report-share
  admin/              users · work-transfer · jobs · audit
  journeys/           leadgen-to-sdr · sdr-outreach · reply-stop-sequence
                      meeting-to-opportunity · opportunity-to-report · user-lifecycle
  resilience/         double-submit · redis-recovery · maintenance
```

`e2e/crm-journeys.spec.ts` and `e2e/deep-smoke.spec.ts` stay — CI and the post-deploy gate both
reference them by name. `e2e/user-flow-31step.spec.ts` is superseded by `journeys/` and is
removed in Batch 9 once its coverage demonstrably exists elsewhere.

---

## 5. Role-permission matrix — from source, to be proven by test

Derived from `lib/auth.ts`, `proxy.ts`, `app/api/leadgen-pool/guard.ts`,
`lib/opportunities/access.ts`. ✅ permitted · 🚫 must be refused · ⚠️ scoped subset.

| Surface | Director | Floor Mgr | Team Lead | SDR | Leadgen Mgr | Leadgen |
|---|---|---|---|---|---|---|
| `/admin/*`, `/api/admin/*` | ✅ | ✅ | 🚫 edge | 🚫 edge | 🚫 edge | 🚫 edge |
| `/director` | ✅ | ⚠️ | 🚫 client | 🚫 client | 🚫 client | 🚫 client |
| `/team` | ✅ | ✅ | ✅ pod | 🚫 client | ⚠️ | 🚫 client |
| `/leadgen-manager` | ✅ | ✅ | 🚫 client | 🚫 client | ✅ | 🚫 client |
| `/leadgen` pool read | ✅ | ✅ | 🚫 403 | 🚫 403 | ✅ | ✅ |
| pool manager actions (assign/qualify/requirements) | ✅ | ✅ | 🚫 403 | 🚫 403 | ✅ | 🚫 403 |
| leads — visibility | all | all | pod ∪ campaigns | own only | all | assigned campaigns |
| lead import/export | ✅ | ✅ | 🚫 | ✅ | ✅ | ✅ |
| opportunity client handoff approval | ✅ | ✅ | ✅ | 🚫 403 | 🚫 | 🚫 |
| `/client-reports/public/[token]` | unauthenticated by design — must expose report data only |

Two properties worth calling out because they are easy to regress:

- **Team Lead cannot import or export** (`canImportExport`), even though they outrank an SDR
  who can.
- **An SDR can never reach an unassigned lead** in a shared campaign — `canAccessLead` gates the
  account axis behind `ACCOUNT_AXIS_ROLES`, and the user axis requires `assignedToId` to be set.

---

## 6. Findings already open, before any test ran

### PW-AUDIT-001 — `/api/automation/accounts/[id]/cap` trusts the session token

`app/api/automation/accounts/[id]/cap/route.ts:11-16` authorizes from `auth()` — the raw JWT —
instead of `getSessionUser()`. Every other guarded route in the app re-reads the user row and
rejects the request when the user has been deleted, deactivated, moved tenant, or had
`authVersion` bumped. `lib/auth.ts:42` states the intent plainly: *"A director demoted to SDR
keeps `role: 'director'` in their cookie; honouring that is the whole bug this closes."*

This route honours it. A demoted, deactivated or signed-out-all user holding an unexpired token
can still raise an email account's daily send cap.

- **Severity:** P1 provisionally — it is an authorization bypass on a live token, but the blast
  radius is one integer field. Promote to P0 if the tenant question below resolves badly.
- **Regression test:** deactivate a floor manager, reuse their storage state, `PATCH` the route,
  expect 401/403 rather than 200.
- **Also:** returns **401** for a role failure where the rest of the codebase returns **403**.

### PW-AUDIT-002 — same route, possible cross-tenant write. **Unproven.**

The handler looks up the account with `findUnique({ where: { id } })`, then performs the update
inside `tenantStorage.run({ tenantId: account.tenantId })` — the **account's** tenant, not the
caller's. Whether that is exploitable depends on whether the Prisma extension's
`applyScopedTenant` injection actually constrains a `findUnique`:
`lib/tenant-inject.ts:69` puts `tenantId` into `args.where` for `findUnique`, which Prisma may
accept or reject at runtime.

If the lookup is scoped, this is harmless redundancy. If it is not, a manager in tenant A can
mutate an email account in tenant B — a cross-tenant write, **P0** by §50.

Resolved in Batch 3 by direct experiment (query a known foreign-tenant id under a scoped
context and observe), not by reading more code. Recorded now so the question is not lost.

---

## 7. Safety rules in force for every batch

- `EMAIL_SEND_DRY_RUN=true` and `SEQUENCE_AUTOSEND_ENABLED=false` asserted **before** each run,
  and re-asserted after any batch that touches env behaviour
- no destructive batch (import, transfer-work, deactivation, bulk ops) against the GCE box
- never `prisma migrate reset` or `npm run db:seed` against anything remote
- test data prefixed `PW_<YYYYMMDD>_<SPEC>_<n>`; each spec cleans up its own rows
- a failure is investigated to root cause with evidence before any code changes (§49, §51)
- `main` is protected; every fix goes through a branch and a PR with CI green

---

## 8. What this audit will not be able to prove

Listed now rather than quietly marked green later (§56):

- real Gmail / Microsoft Graph delivery — OAuth consent and a live mailbox are absent
- external SIP call connection — configuration only
- production DNS / TLS behaviour — the box is plain HTTP on a bare IP
- Docker image build and the production-image operational checks in §55 — no Docker here
- DB-level RLS enforcement — `DB_RLS_ENFORCED` is unset everywhere; `npm run verify:rls`
  already covers it separately and needs its own throwaway database
