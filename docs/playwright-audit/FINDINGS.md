# Playwright Deep Audit — Findings

Severity per §50 of the audit brief. Every entry carries the evidence that produced it, and
where a first reading turned out to be wrong the correction is kept rather than quietly edited
away — the wrong version is usually the more instructive one.

Environment for everything below: local Postgres, **production build** (`next build` +
`next start -p 3000`) unless a finding says otherwise. Redis absent, so no worker-dependent
path has been exercised yet.

---

## Fixed in this audit

Nothing is left open. Each entry keeps the wrong turns that preceded it, because in
every case the first explanation was plausible and wrong.

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

### PW-AUDIT-007 — the public client-report share link was dead in production

| | |
|---|---|
| **Severity** | **P1** — a shipped feature was completely non-functional for its only audience |
| **Status** | **Fixed.** Regression tests green. |
| **Files** | `lib/client-reports/shareLinks.ts` |
| **Test** | `e2e/reports/client-report-share.spec.ts` |

Every share token resolved to `{"error":"Invalid or expired report link"}`. Not some tokens —
every one, immediately after being minted.

The share endpoint is the only route in the product that answers with no session: `proxy.ts`
excludes `api/client-reports/public` because the recipient is the customer, not Telestar staff.
No session means no tenant context, and the extension in `lib/prisma.ts:86-93` **fails closed**
for reads in production — `find*` returns `null` rather than risk a cross-tenant read. So the
lookup returned nothing and the route reported the token as unknown.

Proven rather than reasoned: the token presented hashed to `1b40e5c6…`, a row with exactly that
`tokenHash` sat in `ClientReportShareLink` under `pw-audit-tenant-a`, unrevoked and unexpired,
and an unextended client found it immediately while the extended client returned `NULL`.

**It only reproduces on a production build.** In development `isLocalOrScript` is true, so the
same queries bypass and succeed — which is why the feature looked healthy in every local
check, and why the existing e2e suite (which runs against `next dev` by default) never saw it.

### The first fix did not work, and why that matters

The obvious repair is to wrap the lookup in `tenantStorage.run({ bypassRls: true })` — the
pattern `getSessionUser` uses for exactly this situation. It was applied, it compiled, and the
emitted bundle contains it:

```js
a.tenantStorage.run({tenantId:"system",bypassRls:!0},()=>r.prisma.clientReportShareLink.findUnique
```

The read still returned null. The `AsyncLocalStorage` the caller enters is not the instance the
extension reads — Next splits them across chunks (`a.` and `r.` are different module
namespaces in the output above). Worth recording because the wrapper *looks* correct in review
and in the source, and only an end-to-end check catches that it does nothing.

**The fix that works** is an unextended, module-scoped `PrismaClient` used solely for resolving
a share token. Safe because the token *is* the credential — 32 random bytes, stored only as a
SHA-256 hash, revocable and expirable, validated before anything is returned — and
`toClientSafeSnapshot` still governs what a customer may see. One extra pool per process, not
per request.

### Three of my own assertions were wrong here too

Recorded because each looked like a finding:

- **"the public report leaked lead data"** — it contained prospect company names. That is what a
  client report is *for*. The real checks are staff addresses, credential material and internal
  cuids, none of which appear.
- **"a password-protected report returned its contents"** — an unauthenticated GET returns
  `{requiresPassword: true, title, clientName}` by design; the recipient needs to know what they
  are unlocking and already holds the link. The contract is that `snapshot` stays null, which it
  does.
- **revoke "failed"** — the route takes `linkId` from the **query string**, not the body. Sent as
  JSON it answers 400 and revokes nothing, which would have looked like a working test.

---

### PW-AUDIT-008 — a campaign could be created against another tenant's client

| | |
|---|---|
| **Severity** | **P1** — cross-tenant write; records injected into another tenant's view |
| **Status** | **Fixed.** Regression test green. |
| **Files** | `app/api/campaigns/route.ts` |
| **Test** | `e2e/admin/clients-and-campaigns.spec.ts` → *a campaign cannot be created against another tenant client* |

`POST /api/campaigns` takes `clientId` from the caller and nothing checked it. A tenant A floor
manager posting tenant B's client id got **201**, and the row landed with `tenantId` of tenant A
and `clientId` of tenant B:

```
create against tenant B client -> 201
created campaign id: cmslpjsku05pb… clientId: pw-audit-client-b tenantId: pw-audit-tenant-a
```

**The leak runs in the direction that is easy to miss.** Nothing came back to the attacker — the
new campaign has no members, so `getVisibleCampaignIds` correctly keeps it out of their own
list, and a test that only checked the attacker's view would have called this clean. The damage
shows up on the victim's side: tenant B reading *their own client* saw campaigns they never
created listed under it.

```
campaigns listed: ['PW_AUDIT_CAMPAIGN_B', 'PW_AUDIT_CROSS_1786274199389953', 'PW_AUDIT_CROSS_1786274219064']
```

So the boundary held for reads and failed for writes, and any per-client aggregate — a client
report being the obvious one — was quietly summing across two tenants.

**Fix:** resolve the client through the tenant-scoped client before creating the campaign; a
client belonging to anyone else simply does not resolve. **404 rather than 403** deliberately —
whether an id exists in another tenant is itself information.

The regression test asserts from **both** sides: the create is refused, *and* the victim tenant's
client does not list the attempted campaign. Status alone was never the property.

---

### PW-AUDIT-005 — sign-out did not end the session (supersedes PW-AUDIT-003)

| | |
|---|---|
| **Severity** | P2 |
| **Status** | **Fixed.** Regression test green, 0 failures in 6 measured runs. |
| **Files** | `app/api/auth/revoke-self/route.ts` (new), `lib/auth/clientSignOut.ts` (new), `components/Topbar.tsx` |
| **Test** | `e2e/auth/authentication.spec.ts` → *sign-out race › PW-AUDIT-005* |

### The root cause was not a race in the client

The first three theories were all wrong, which is worth recording because each was plausible
and each was disproved by looking rather than reasoning:

1. *"Sign-out is cosmetic"* — filed as a **P0** off a 3/3 reproduction under `next dev`.
2. *"Development-only"* — after a production run appeared clean. That run was on port 3100
   while `NEXTAUTH_URL` pins `localhost:3000`, so `signOut()`'s callback pointed at a dead port
   and the flow never completed. It proved nothing.
3. *"A race with next-auth's session refetch"* — closer, but still wrong about the mechanism,
   and the fix it implied (verify the session is gone, then navigate) made things **worse**:
   every second spent verifying was another second for the real cause to act.

Tracing `set-cookie` on every response showed what actually happens:

```
POST /api/auth/signout        200 ["authjs.session-token=CLEARED"]
GET  /meetings?_rsc=…         200 ["authjs.session-token=SET"]      <- RSC prefetch, already in flight
GET  /api/notifications       200 ["authjs.session-token=SET"]
GET  /api/leads               200 ["authjs.session-token=SET"]
```

**`proxy.ts` wraps every matched request in NextAuth's `auth()`, which re-issues the session
cookie on the response.** Any request that left the browser before sign-out cleared the cookie
comes back and puts it straight back — and because the sidebar prefetches its links, a CRM page
always has something in flight. With the client-only fix in place this failed **6 times out of
6**: clearing a cookie cannot win against the server re-minting it.

### The fix

Revocation has to invalidate the **token**, not the cookie. `User.authVersion` already exists
for exactly this and `getSessionUser` checks it on every protected request, so
`POST /api/auth/revoke-self` bumps it before `signOut()` runs. A cookie re-minted a moment
later now carries a token the server rejects. **0 failures in 6 runs** after the change.

**The trade-off, stated rather than buried:** `authVersion` is per user, not per session, so
signing out now ends that user's sessions on every device. That is a real behavioural change.
It is the right default for an internal CRM — "I signed out and I'm still logged in" is a worse
failure than "signing out here also signed me out on my phone" — but per-device revocation
would need a server-side session store, i.e. giving up stateless JWTs, which is far larger than
this defect warrants. Flagging it as a product decision worth confirming.

**Test-infrastructure consequence.** Because sign-out now bumps `authVersion`, signing out as a
fixture role would invalidate that role's stored session for every later spec. The sign-out
tests create a disposable account each run instead.

---

### PW-AUDIT-006 — after sign-out, Back parked the user on a CRM shell that loaded forever

| | |
|---|---|
| **Severity** | P3 — cosmetic; no data was ever exposed |
| **Status** | **Fixed** as a side effect of PW-AUDIT-005 |

Pressing Back after signing out left the URL at `/leads` showing sidebar chrome and a permanent
"Loading…". No protected content was restored — `/api/leads` answered 401 and the previous
user's rows were absent — so §6's actual property always held; what was missing was the
redirect.

`hardSignOut` now leaves via `window.location.replace`, which keeps the signed-in page out of
history, and `SessionSentinel` turns any 401 from a data call into a sign-out. Covered by the
back-button assertions in `e2e/auth/authentication.spec.ts`.

---

### PW-AUDIT-004 — the client kept believing it was signed in after revocation

| | |
|---|---|
| **Severity** | P3 |
| **Status** | **Fixed** (`components/SessionSentinel.tsx`) |

After a deactivation, sign-out-all, role change or password reset, every protected endpoint
correctly answered 401 while `/api/auth/session` still returned the old user — it decodes the
JWT and reports its claims and never calls `getSessionUser`. The authorization boundary was
never in question; what broke was the client's belief, so the user saw a CRM where nothing
loaded rather than "you have been signed out".

There is no shared client fetch helper to hook — 58 call sites use `fetch` directly — so
`SessionSentinel` patches `window.fetch` once, narrowly: same-origin `/api/…` only,
`/api/auth/*` excluded, response passed through untouched. A 401 from a data call now triggers
`hardSignOut()`. Monkey-patching is not a casual choice; it earns its place because the
alternative is 58 edits that a 59th call site would silently escape.

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

## §48 — review of the pre-existing specs

Asked of every assertion: *would this still pass if the feature were broken?*

**`crm-journeys.spec.ts` — 29 assertions, 24 of them `toHaveURL`.** Eighty-three per cent of
the file confirmed only that the browser navigated. A route whose every API call returned 500,
or which rendered Next's error boundary, satisfied all of them; the file was a routing test
wearing a persona-journey costume. Twenty-one of those navigations now go through
`gotoRendered`, which additionally requires a visible `<h1>` and the absence of an error
boundary. Safe to require: every route paints exactly one `<h1>` per
`.claude/rules/brand-design.md`, verified across all 18 before the change.

**`deep-smoke.spec.ts` — the comment and the assertion disagreed.** *"Every route should paint a
heading"* sat above `expect(page.locator('body')).not.toBeEmpty()`, which the sidebar alone
satisfies, so a route whose content died quietly still passed. It now asserts the heading it
always claimed to.

That change produced its own negative control by accident: sampling `isVisible()` once,
immediately after `domcontentloaded`, reported five personas as broken because these pages
fetch data client-side and the heading lands a beat later. Worth keeping — it proves the new
assertion can actually fail, which is the whole question §48 asks.

**Both files defaulted `E2E_PASSWORD` to `telestar2026`.** That string is published in this
repository and is still live on every non-Director demo account on the deployed box, so a bare
`npx playwright test` silently authenticated with a credential anyone can read — precisely what
§1 forbids. The default is gone; both now fail loudly if the variable is unset.

**`user-flow-31step.spec.ts` needed nothing** — 49 assertions, only 4 URL-only. It was rewritten
under BUG-003 and is genuinely assertive.

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

**A vacuous audit-log test, caught by the failure of its neighbour.** `/api/admin/audit-log`
projects `userId` to **`actorId`** in its response. Two tests read `userId`: the actor assertion
failed loudly, but the cross-tenant leak check compared `undefined` against a set of ids and
passed while checking nothing. It now asserts that rows exist *and* that at least one carries an
`actorId`, so the same projection change cannot make it silently vacuous again.

**CSP `script-src` reports `eval` on `/login` under `next dev`** — dev-mode source maps. Not
reproduced on a production build. Tracked with the CSP enforcement work in
`docs/pre-domain-hardening/STATUS.md` Task 8.

---

## Coverage so far

Run against a production build (`next build` + `next start -p 3000`).
**154 tests, all passing, none skipped.**

| Batch | Scope | Result |
|---|---|---|
| 0 | Harness: 9 storage states, recorders, two-tenant fixture, config | green |
| 1 | §6 authentication — 6 roles, invalid login, enumeration, logout, unauthenticated access | green |
| 1b | §6 session revocation — deactivate, sign-out-all, role change, password reset | green |
| 2 | §7 RBAC — admin edge gate, pool roles, import/export, manager reads (UI **and** API) | green |
| 3 | §8 IDOR between two SDRs, §9 tenant isolation across two tenants | green |
| 7a | §13/§47 lead CRUD, notes, reminders, reassignment scope, soft-delete, §46 create race | green |
| 7b | §31–§33 meeting → outcome → opportunity → handoff, incl. concurrent double-submit | green |
| 7c | §16 campaign-member impact gate (both doors) and pod-orphaning guard | green |
| 9a | §42 desktop gate at 1440 / 1024 / 900 | green |
| 7d | §34 client reports, public share links, expiry, revocation, password, exports | green |
| 7e | §16 work transfer (idempotent replay, concurrent, role gate) · §36 audit trail | green |
| 9b | §48 review of the three pre-existing specs | 2 weaknesses fixed |
| 9c | §40 filters, search, limits — scope containment and combination | green |
| 10 | §10 dashboard counters verified against the records behind them | green |
| 11 | §15 clients and campaigns — write gates, read scoping, cross-tenant write | **1 P1 found** |

### What these confirmed working

Worth stating positively, because an audit that only lists defects reads as if nothing was
verified:

- an SDR cannot read, edit, note, task or remind on a teammate's lead in a **shared campaign**,
  while their team lead can reach both — the account axis is a manager privilege and does not
  widen an SDR
- tenant A cannot read or mutate tenant B leads, users, campaigns or mailboxes by direct id
- `authVersion` revocation works for deactivation, sign-out-all, role change and password reset
- Team Lead is correctly excluded from import/export while an SDR is not
- a qualified meeting creates **exactly one** opportunity, and neither re-logging nor two
  concurrent submissions duplicate it — the chain BUG-003 found untested
- an SDR cannot approve their own client handoff; a director can
- the "must not regress" 409 impact gate holds on **both** `/api/campaigns/[id]/members` and
  `/api/admin/assignments`, and deactivating a manager with active reports is refused
- work transfer moves ownership, is genuinely idempotent on `requestId` replay, survives two
  concurrent transfers without splitting the work, and refuses an SDR
- **no filter, search term or `userId` narrowing widens role or tenant scope** — the BUG-001
  invariant holds: an SDR filtering by a teammate's id, or searching a foreign lead's exact
  company name, gets nothing back, and a director filtering by a tenant B campaign gets nothing
- filters AND rather than OR (a contradictory pair returns nothing), invalid enum filters are
  refused with 400 rather than silently dropped, `limit` is clamped at 500, and a nonsensical
  `limit` does not empty the list
- an SDR cannot retrieve archived leads even by passing `archived=true`
- dashboard tabs put each task in the right bucket by timezone-derived day boundaries, drop
  completed work from Overdue, contain only the rep's own tasks, and refuse a manager narrowing
  to someone outside their pod
- admin mutations write an audit row naming actor, action, entity and timestamp; SDRs and Team
  Leads cannot read the audit log; no tenant B activity appears in tenant A's
- archive is a soft delete and the row restores

### Still to do

Not blocked on anything: §41 dialog accessibility, and the remaining lead-detail quick actions
in §14.

Blocked on Redis: §19, §20, §23, §25–§29, §37–§39 and journeys C/H.
