# Post-Migration Bug Tracker

Deployment under test: **http://34.142.236.46** — GCE + Docker Compose + Caddy, Cloud SQL
Postgres 16, worker running. Project `telestar-crm-final`, region `asia-southeast1`.

Process per `telestar-crm-post-migration-bug-fix-instructions.md` §7:
`Find → Reproduce → Classify → Fix → Test → Regression Check → Mark Done`. One bug at a time.

Severity per §3: **P0** demo/live blocker · **P1** core workflow broken · **P2** UX friction or
incomplete behavior · **P3** polish.

Note on scope: a failing *test* is not automatically an application bug. Where the app was
proven correct by independent means, the finding is classified as a test defect and the test
is fixed — with the evidence recorded, so it is not re-litigated later.

---

## Master tracker

| ID | Severity | Role | Module | Summary | Status | Fixed in |
|---|---|---|---|---|---|---|
| BUG-001 | P2 | Leadgen | E2E / auth | `crm-journeys` login wait hardcoded to 10s, too tight for a deployment — failed ~1 run in 3 | **Done** | `playwright.config.ts`, `e2e/crm-journeys.spec.ts` |
| BUG-002 | P2 | All | E2E config | `playwright.config.ts` always booted a local dev server, so `BASE_URL` could not target a deployment | **Done** | `playwright.config.ts` |
| BUG-003 | P1 | SDR / Director | E2E / end-to-end journey | The 31-step journey spec asserted against wrong endpoints, invalid enum values and response shapes — the meeting→opportunity chain never ran, yet the test reported success | **Done** | `e2e/user-flow-31step.spec.ts` |

---

## BUG-001 — Leadgen login times out intermittently against the deployment

```text
Bug ID:        BUG-001
Title:         crm-journeys leadgen login wait too short for a real deployment
Severity:      P2  (test defect — application behaves correctly)
Role affected: Leadgen (alex@telestar.vn); latent for all six personas
Module:        E2E suite / authentication
Environment:   Google Cloud VM demo only — passes locally
URL / Page:    http://34.142.236.46/login
User account:  alex@telestar.vn
```

**Steps to reproduce**
1. `BASE_URL=http://34.142.236.46 npx playwright test e2e/crm-journeys.spec.ts`
2. Repeat 3×.

**Expected:** all 7 tests pass consistently.
**Actual:** *Leadgen Specialist* failed roughly one run in three with
`TimeoutError: page.waitForURL: Timeout 10000ms exceeded` at `e2e/crm-journeys.spec.ts:179`.

**Evidence — this is NOT an auth bug.** Posting the credentials directly to the deployment
succeeds every time:

```
alex     login_http=302  session={"user":{"email":"alex@telestar.vn","id":"cmsdiyex9001p…"}}
priya    login_http=302  session={"user":{"email":"priya@telestar.vn",…}}
dominic  login_http=302  session={"user":{"email":"dominic@telestar.vn",…}}
lan.pham login_http=302  session={"user":{"email":"lan.pham@telestar.vn",…}}
```

The Playwright failure snapshot also shows the form correctly filled and the toast/alert
region **empty** — no error was ever rendered. The page simply had not navigated yet.

**Root cause:** sign-in round-trip against GCE + Cloud SQL measured between under 10s and
37s across runs. The suite hardcoded `{ timeout: 10000 }` in six places, sized for a local
dev server. `dominic` passing while `alex` failed was timing variance, not a role difference.

**Fix:** `LOGIN_TIMEOUT` constant — 45s when `BASE_URL` is set, 15s locally. Test timeout
raised to 120s for remote targets, since `beforeEach` counts against the test budget.

**Verification:** the previously flaky test run 4× consecutively against live — 4 passed
(25.8s / 19.4s / 19.8s / 24.9s).

**Status:** Done.

---

## BUG-002 — `BASE_URL` could not actually target a deployment

```text
Bug ID:        BUG-002
Title:         playwright.config always starts a local dev server, ignoring BASE_URL
Severity:      P2
Role affected: All
Module:        E2E configuration
Environment:   Both
```

**Expected:** per `CLAUDE.md`, *"Point `BASE_URL` at a deployment to use it as a post-deploy
gate."*

**Actual:** `webServer.url` was hardcoded to `http://localhost:3000`, so Playwright booted a
local Next.js dev server and waited on localhost even when `BASE_URL` pointed elsewhere —
the documented post-deploy gate could not run as described.

**Fix:** `webServer` is now `undefined` when `BASE_URL` is set.

**Verification:** the live sweep against `http://34.142.236.46` runs without starting any
local server.

**Status:** Done.

---

## BUG-003 — The end-to-end journey spec passed without exercising the journey

```text
Bug ID:        BUG-003
Title:         31-step spec asserted against wrong endpoints, enums and response shapes
Severity:      P1  (test defect, but it masked whether the core chain works at all)
Role affected: SDR, Director
Module:        E2E / Lead -> Meeting -> Opportunity -> Client Report
Environment:   Both
```

**Why this outranks a normal test defect.** This is the only test covering the write path
described in §6 of the instructions doc. It ended in
`console.log('🎉 ALL 31 STEPS PASSED PERFECTLY!')` while the meeting → opportunity chain
never executed. A green run was evidence of nothing.

**Eight defects, all verified against the source contracts:**

| Step | Defect | Evidence |
|---|---|---|
| 8 | Asserted imported leads existed immediately after `POST /api/leads/import`, which answers **202 `{status:'queued'}`** whenever Redis is reachable. Passed only on the inline fallback | `app/api/leads/import/route.ts:350-356` |
| 17-18 | `bookingSource: 'sdr_manual'` is not in `createMeetingSchema` — Zod stripped it silently | `lib/validation/schemas.ts:292-304` |
| 19 | `PATCH /api/meetings/{id}` with `outcome:'qualified'`. `updateMeetingSchema` has **no** `outcome` field, and `qualified` is not a `MeetingOutcome` — the value is `qualified_opportunity`. Returned 200; created nothing | `schemas.ts:306-314`, `prisma/schema.prisma:134-142` |
| 20 | Consequently vacuous — asserted only that `GET /api/opportunities` responded | — |
| 21 | `PUT` with `status:'accepted'`. Not an `OpportunityStatus` (`open\|won\|lost\|rejected\|archived`), and `status` is manager-only while the call used SDR headers. Guarded by `if (opps.length > 0)`, so it never even ran | `app/api/opportunities/[id]/route.ts:46-58` |
| 24 | Read `.id` off the raw body; the route answers `{ report }` | `app/api/client-reports/route.ts:161` |
| 26 | `POST .../share` with no body. `parseBody` calls `req.json()`, which throws on an empty body and returns 400 before the schema is consulted — every field being optional does not help | `lib/validation/core.ts` |
| 27-28 | Hit `/api/email-health/{id}/pause`; the real routes are `/api/email-health/accounts/{id}/pause`. Fire-and-forget, so the 404s were invisible | `app/api/email-health/accounts/[id]/` |
| 11-16 | Wrapped in `if (await x.isVisible())` — asserted nothing at all | — |

**Fix:** rewritten to poll for the async import, book via the real `createMeetingSchema`
fields, log the outcome through `POST /api/meetings/{id}/outcome` with
`outcome: 'qualified_opportunity'`, assert the returned opportunity actually exists, and
accept the handoff via `POST /api/opportunities/{id}/handoff` `{decision:'accepted'}` as
Director. Steps 11-16 now assert real API and DOM state.

**Added coverage:** the SDR is asserted to receive **403** when attempting to approve their
own handoff — `canApproveClientHandoff` permits director / floor_manager / team_lead only
(`lib/opportunities/access.ts:32-34`). The old spec would have reported success either way.

**Environment note, not a bug:** running this against a cold `next dev` intermittently fails
at step 2 with a 401, because `/api/auth/session` returns an HTML shell while the route is
still compiling (`ClientFetchError: Unexpected token '<'`). Warm the dev server before the
run; it does not reproduce against a built deployment.

**Status:** Done.

---

## Capture template

Copy this block for each new finding.

```text
Bug ID:
Title:
Severity:      P0 / P1 / P2 / P3
Role affected: Director / Floor Manager / Team Lead / SDR / Leadgen Manager / Leadgen / All
Module:
Environment:   Google Cloud VM demo / Local / Both
URL / Page:
User account:

Steps to reproduce:
1.
2.

Expected result:
Actual result:

Evidence:
- Screenshot / Playwright trace:
- Browser console error:
- Failing network request:
- Container log (docker compose logs web|worker|caddy):

Suspected root cause:
Files likely involved:
Fix plan:
Test plan:
Status:  Open / In Progress / Fixed / Retest Failed / Done
Date found:
Date fixed:
```
