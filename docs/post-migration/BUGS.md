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
