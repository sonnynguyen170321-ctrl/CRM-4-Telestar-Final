# Playwright Deep Audit — Findings

Severity per §50 of the audit brief. Every entry carries the evidence that produced it, and
where a first reading turned out to be wrong the correction is kept rather than quietly edited
away — the wrong version is usually the more instructive one.

Environment for everything below: local Postgres, **production build** (`next build` +
`next start -p 3000`) unless a finding says otherwise. Redis absent, so no worker-dependent
path has been exercised yet.

---

## Open

### PW-AUDIT-001 — `/api/automation/accounts/[id]/cap` authorized from the token, not the database

| | |
|---|---|
| **Severity** | P1 |
| **Status** | **Confirmed by test, fixed, regression test green** |
| **Files** | `app/api/automation/accounts/[id]/cap/route.ts` |
| **Test** | `e2e/auth/session-revocation.spec.ts` → *PW-AUDIT-001 — token-trusting route* |

The route read `auth()` — the raw JWT — and tested the role claim inside it, instead of going
through `getSessionUser()` like every other guarded route. Sessions are stateless, so that
token states who the user *was* when it was minted. `lib/auth.ts:42` says exactly why that
matters: *"A director demoted to SDR keeps `role: 'director'` in their cookie; honouring that
is the whole bug this closes."*

**Proven, not inferred.** A team lead was created, signed in, then deactivated. Every other
endpoint refused the token with 401. This one:

```
Error: a deactivated user changed a send cap (200) — the route trusted the token
```

A deactivated account changed a mailbox's daily send cap — a deliverability control, so the
blast radius is larger than one integer suggests.

**Fix:** `requireManager()`, which goes through `getSessionUser` and therefore re-reads the row
and matches `authVersion`. It also returns **403** for a role failure; the old code returned
**401**, telling a signed-in user they were not signed in.

---

### PW-AUDIT-004 — `/api/auth/session` keeps reporting a revoked user

| | |
|---|---|
| **Severity** | P3 — degraded UI state, not an access-control failure |
| **Status** | Open, no fix attempted |

After a deactivation, sign-out-all, role change or password reset, every protected endpoint
correctly answers 401 — but `/api/auth/session` still returns the old user object. It is
NextAuth's own route: it decodes the JWT and reports its claims, and never calls
`getSessionUser`.

So the authorization boundary holds. What breaks is the client's belief: the app shell renders
as signed in while every data call 401s, which presents as "the CRM is broken" rather than
"you have been signed out". Worth a client-side treatment (treat a 401 from any data call as a
sign-out) rather than a change to the auth route.

Recorded because it cost a round of failing tests: an early assertion treated this endpoint as
the boundary and failed a security control that was working correctly.

---

### PW-AUDIT-005 — sign-out races next-auth's own session refetch (supersedes PW-AUDIT-003)

| | |
|---|---|
| **Severity** | P2 |
| **Status** | Open. Reproduced on a **production build**. No fix attempted. |
| **Test** | `e2e/auth/authentication.spec.ts` → *known defect › PW-AUDIT-005*, marked `fixme` |

Clicking **Sign Out** shortly after a navigation can leave the session alive: the cookie
survives, `/leads` renders and `GET /api/leads` returns 200.

Measured on `next build` + `next start -p 3000`:

```
immediate  run1: GET /api/leads=401 cookiePresent=false
immediate  run2: GET /api/leads=200 cookiePresent=true     <-- sign-out did nothing
immediate  run3: GET /api/leads=401 cookiePresent=false
settled2s  run1..3: GET /api/leads=401 cookiePresent=false
```

**Two corrections are folded in here, both worth keeping.**

*First*, this was originally filed as PW-AUDIT-003, a **P0** — "sign-out is cosmetic" — on the
strength of a 3/3 reproduction under `next dev`. *Second*, an attempt to confirm it on a
production build appeared to reproduce 3/3 and was reported as confirming P0. That run was
invalid: it used port 3100 while `NEXTAUTH_URL` pins `localhost:3000`, so `signOut()`'s
`callbackUrl` pointed at a dead port and the flow never completed. Re-run on port 3000,
sign-out was clean 3/3 and the finding was downgraded to "development-only".

That downgrade was also wrong. The narrower experiment above shows the race is real in
production — it just needs the sign-out to land while a session refetch is in flight, which
`next dev` (StrictMode + dev polling) makes near-certain and a production build makes
roughly one-in-three when sign-out immediately follows a navigation.

**Why P2 and not P0.** The server is not at fault: driven directly, `POST /api/auth/signout`
emits `authjs.session-token=; Max-Age=0` in both its 302 and 200 shapes. Losing the race
requires signing out within about a second of a page load, which is not what a user leaving a
shared machine does — they work first, then leave. But when it does happen, the failure is
silent and total: the user is shown `/login` and believes they signed out.

The fix belongs on the client — have `signOut()` win against, or invalidate, an in-flight
session fetch.

### PW-AUDIT-006 — after sign-out, Back parks the user on a CRM shell that loads forever

| | |
|---|---|
| **Severity** | P3 — cosmetic; **no data is exposed** |
| **Status** | Open |

Pressing Back after signing out leaves the URL at `/leads` instead of redirecting to `/login`.
The page paints the sidebar and a permanent "Loading…".

**No protected content is restored** — that is the §6 property, and it holds: `/api/leads`
answers 401 and the previous user's rows are absent from the DOM (asserted in
`e2e/auth/authentication.spec.ts`). What is missing is the redirect, so a signed-out user is
left staring at a CRM frame that never resolves. Related to PW-AUDIT-004: the client still
believes it holds a session.

---

## Closed

### PW-AUDIT-002 — cross-tenant write via the automation cap route — **not a vulnerability**

| | |
|---|---|
| **Severity** | none |
| **Status** | Closed by experiment |
| **Test** | `e2e/roles/tenant-isolation.spec.ts` → *PW-AUDIT-002 …* |

The route looks the account up with `findUnique({ where: { id } })` and then updates inside
`tenantStorage.run({ tenantId: account.tenantId })` — the account's tenant, not the caller's.
The open question was whether `applyScopedTenant` (`lib/tenant-inject.ts:69`) actually
constrains a `findUnique` at runtime.

It does. A tenant A floor manager aiming at a tenant B mailbox is refused, and the cap is
unchanged when read back by the mailbox's owner. Settled by pointing a real request at a real
foreign id rather than by reading more code.

---

## Not defects — recorded so they are not re-investigated

**The login form submits stale credentials when driven at machine speed.** Filling both fields
and clicking microseconds apart can run the submit handler from a render before React committed
the controlled state (`app/login/page.tsx:51-54`), producing a genuine 401 and a genuine
"Invalid email or password." for correct credentials. Measured: the same credentials driven at
`/api/auth/callback/credentials` succeeded **30/30**, while the form path failed for a different
role on each run. Handled with a `blur()` before submit.

**Visiting `/login` before an API sign-in breaks the sign-in.** next-auth's client fetches its
own CSRF token on mount and rotates the `authjs.csrf-token` cookie, so a token captured moments
earlier no longer matches and the callback fails with `MissingCSRF` — again a different random
subset of roles per run. The setup project now uses a bare `APIRequestContext` and touches no
page at all.

**Two of the three first-run failures in the roles batch were test defects, not app defects.**
Worth naming because both are the exact traps §48 warns about:

- a "cross-tenant user leak" was a substring filter — `.b@` matches `pw.sdr.b@audit.test`,
  which is sdr**B**, a tenant **A** user;
- an IDOR test posted `type: 'call'`, which is not a member of `taskType`
  (`lib/validation/schemas.ts:8`), so `parseBody` returned 400 *before* the authorization check
  ran. Accepting that 400 would have been a green test over a code path never exercised.

**CSP `script-src` reports `eval` on `/login` under `next dev`** — dev-mode source maps. Not
reproduced on a production build. Tracked with the CSP enforcement work in
`docs/pre-domain-hardening/STATUS.md` Task 8.

---

## Coverage so far

| Batch | Scope | Result |
|---|---|---|
| 0 | Harness: 9 storage states, recorders, fixture, config | 9/9 |
| 1 | §6 authentication — 6 roles, invalid login, enumeration, logout, unauthenticated access | green |
| 1b | §6 session revocation — deactivate, sign-out-all, role change, password reset | green |
| 2 | §7 RBAC — admin edge gate, pool roles, import/export, manager reads (UI **and** API) | green |
| 3 | §8 IDOR between two SDRs, §9 tenant isolation across two tenants | green |

**91 tests, 90 passing, 1 `fixme` (PW-AUDIT-005), run against a production build.**

Not yet run: §10, §13–§18, §30–§36 (CRUD surfaces), §40–§48 (cross-cutting).
Blocked on Redis: §19, §20, §23, §25–§29, §37–§39 and journeys C/H.
