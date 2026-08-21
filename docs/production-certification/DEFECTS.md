# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Certificate State**: INVALIDATED — evidence reconciliation in progress
**Candidate SHA**: *(re-freeze pending — `a6d8c0d` invalidated as candidate)*
**Last Updated**: 2026-08-21T20:10:00+07:00

> **Closure rule.** A defect moves `OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`
> only. `VERIFIED` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under `docs/production-certification/evidence/`. "Fix implemented" is
> **not** `VERIFIED`.
>
> **Performance and count metrics are deliberately NOT duplicated in this file.** They live in
> the evidence manifest and are rendered by the generator. See `PROTOCOL.md` §20.

---

## 1. Defect Summary

**Counted from the entries in this file on 2026-08-22, by a parser that is itself tested**
(`tests/defect-ledger-consistency.test.ts`). Not carried forward, and not hand-tallied — the
last two attempts at this table were both wrong.

| Severity | Discovered | Verified Closed | Reopened | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 3 | 0 | 0 | **2** |
| **P1** (Critical) | 39 | 9 | 4 | **26** |
| **P2** (Important) | 23 | 8 | 4 | **11** |
| **P3** (Minor Polish) | 0 | 0 | 0 | 0 |
| **TOTAL** | **65** | **17** | **8** | **39** |

Every id sits in exactly one bucket: active, resolved-in-place, retained-verified, or reopened.
`Discovered` is their sum, not a free-standing tally — that identity is what previously went
unchecked, and it is now asserted per severity.

<details>
<summary>Two wrong versions of this table, and why each was wrong</summary>

**The inherited figures** read `discovered 56 · verified closed 19 · reopened 7 · active 37`.
Active was overstated by four; four P1 and four P2 counted there have no entry anywhere in the
file. The figures had been incremented as defects were added without re-deriving the base.

**The first correction, made earlier the same day, read `53 · 11 · 8 · 33` and was worse on two
columns.** It came from a parser that counted table rows rather than defect ids, and section 4
contains a range row — `` `TEL-P2-001`–`TEL-P2-007` `` — carrying seven defects on one line. So
seven closures were dropped, and the note accompanying it asserted that the inherited "19 verified
closed" figure "had no support". That was false: the true figure is **17**, and 19 was much nearer
the mark than 11.

Recorded rather than quietly overwritten, because the failure is the instructive part: a
correction derived from a parser nobody had tested is not more trustworthy than the number it
replaces. The parser now expands range rows, reads only the first cell of each row — section 3
also lists a *successor* id per row, which double-counted reopenings as 17 — and is covered by
tests that fail if the table and the entries disagree.

</details>

### Active P1 classification (Phase 6)

All 26, individually. No defect is deleted to improve a count.

| Classification | Count | IDs |
|---|---:|---|
| **REAL OPEN DEFECT** | 4 | `TEL-P1-026` · `TEL-P1-027` · `TEL-P1-028` · `TEL-P1-032` |
| **FIX_IMPLEMENTED**, awaiting verification on the new candidate | 20 | `TEL-P1-014`–`024`, `TEL-P1-029`–`031`, `TEL-P1-033`–`037`, `DEPLOY-001`, `DEPLOY-002` |
| **CI_VERIFIED**, awaiting candidate freeze | 2 | `TEL-P1-025` (secret-scan now PASS on PR #100) · `TEL-P1-018` (chain present in `EV-RELEASE-IDENTITY`, `REL-001` VERIFIED) |
| STALE LEDGER ITEM | 0 | the stale item was this summary table, now corrected |
| DUPLICATE | 0 | — |
| ACCEPTED RISK | 0 | none accepted; `TEL-P1-027` may become one, but only by explicit operator decision |

The four genuinely open P1s share a shape: each needs something this checkout cannot reach.

| ID | What it needs |
|---|---|
| `TEL-P1-026` | a container runtime, to finish and run the rollback drill |
| `TEL-P1-027` | authorization to enable PITR on `telestar-db` (production change) |
| `TEL-P1-028` | the production `DATABASE_URL` read from the VM, then a Cloud SQL setting change |
| `TEL-P1-032` | authorization for a schema migration (R4) |

**No P1 is open for want of engineering effort available here.**

---

## 2. Active Defects

### `TEL-P1-037` — A Signing Secret Generated With `Math.random()`
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: CodeQL on PR #101 — `js/insecure-randomness`, **high**. Found in code
  written earlier in this same session.
- **Root cause**: the rewritten webhook test endpoint generated its throwaway signing value with
  `` `whsec_probe_${Math.random().toString(36).slice(2)}` ``. `Math.random()` is not a
  cryptographic source, and a webhook signature is precisely a security context — the value
  proves to the receiving system that a payload came from Telestar.
- **Why it slipped in**: it was introduced *while removing* the caller-supplied secret, so the
  change that improved one property quietly weakened another. The reviewer that caught it was a
  scanner whose result is non-blocking by policy, and which it would have been easy to wave past
  on a green PR.
- **Fix**: `crypto.randomBytes(24).toString('hex')`, matching how the real webhook secret is
  generated in `app/api/webhooks/route.ts`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-034` — The Health Gate Passed On 401, 403, 404, A Login Redirect, And The Wrong Release
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: Phase 9, the adversarial review of the certifier itself.
- **Root cause**: gate 22 decided everything on one line — `if (response.status >= 500) ok = false;`.
  Its description read *"web health endpoints answer and report release identity"*, but the
  function never read `commit` and was never given the candidate SHA to compare against.
- **What therefore passed**: `401`, `403`, `404`, a `302` to a login page, a proxy's HTML error
  page served with `200`, and — the one that matters — a perfectly healthy server running an
  **entirely different release**.
- **And two of its three endpoints do not exist.** It probed `/api/health`, `/api/health/db` and
  `/api/health/redis`. Measured against production: `200`, **`404`**, **`404`**. Because 404 is
  under 500, the gate reported PASS on two endpoints that have never existed. A mandatory gate
  had never verified anything.
- **Second defect in the same function**: it wrote its log to `gate-22-health-smoke.log` while
  recording `logPath` as `<runLabel>-22-health-smoke.log`. The recorded artifact did not exist,
  and each run overwrote the previous run's log — the same defect the queue-load gate was fixed
  for earlier.
- **Fix**: `scripts/certification/lib/healthGate.mjs` requires HTTP **exactly 200**, a body that
  parses as JSON, `ok === true`, and `commit` equal to the frozen candidate. Each rejected
  status is named for what it means operationally, because "not 200" was the thing nobody
  noticed. `HEALTH_ENDPOINTS` is now `['/api/health']` — the two that never existed are gone
  rather than silently passing. The gate receives `candidateSha`, and the log path written is
  the log path recorded.
- **Regression test**: `tests/certification-false-green.test.ts` — 36 passed, exit 0, every case
  a way the gate used to say PASS.
- **Verified by mutation**: reinstating the old `>= 500` rule fails **9 of the 36**. An earlier
  draft of these tests caught only 2, because the status cases used an empty body that failed
  JSON parsing regardless of status; they now carry a valid healthy body so only the status rule
  can fail them.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-035` — Playwright Skips Were Invisible To The Certifier
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: Phase 9, checking what `mandatorySkips` actually counts.
- **Root cause**: `mandatorySkips = (vitest?.testsSkipped ?? 0) + (redisGate?.metrics?.skipped ?? 0)`.
  Playwright is not in that sum. The Playwright gates were recorded by `scriptGate`, which reads
  the exit code — and **Playwright exits 0 when tests are skipped**.
- **Why nothing could have counted them**: `playwright.config.ts` sets `reporter: 'list'`, which
  produces nothing machine-readable. There was no artifact to count even in principle.
- **What that allowed**: the merge run reported **227 passed, 16 skipped**. Those 16 contributed
  nothing to `mandatorySkips`, so the validator's check K — *"final runs require zero"* — would
  have passed a certification with 16 unexecuted browser tests, concentrated in live Telestar AI
  behaviour.
- **Fix**: `scripts/certification/lib/playwrightReport.mjs` parses the JSON report and counts
  `skipped`, `flaky`, `timedOut` and `interrupted` — every outcome that is neither a pass nor an
  honest failure. The ladder requests `--reporter=list,json` with `PLAYWRIGHT_JSON_OUTPUT_NAME`
  **on the certification path only**, so CI and local runs are unchanged. A Playwright gate that
  exits 0 with any unaccounted result is now `FAIL`, and the counts are added to
  `mandatorySkips`. A missing or malformed report reports `parsed: false` rather than zero,
  because absent evidence must never read as a clean run.
- **Regression test**: covered by the 36 in `tests/certification-false-green.test.ts`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-036` — The Rollback Drill Let The Caller Define What Correct Meant
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: Phase 9. This is a defect in `TEL-P1-026`'s own remediation, written earlier
  in this session.
- **Root cause**: `evaluateDrill` compared each phase's observed health against
  `phase.expectedSha` — a value supplied by whoever assembled the drill. A drill could therefore
  declare that the rollback phase was expected to be running the *candidate*, and pass while
  proving the opposite of what DR-003 asks.
- **Fix**: expectation is derived from the frozen release identity. `evaluateDrill` now takes
  `candidateSha` and `previousSha` alongside the digests, and `expectationFor(phaseName, …)`
  maps each phase to the identity it must show. A phase carries **observed state only**; a phase
  that still supplies `expectedSha` is **refused rather than ignored**, because whoever passed it
  believes it is being honoured. Each phase's running digest is also checked against the one the
  freeze names, not merely against its sibling service.
- **Regression test**: `tests/certification-rollback-drill.test.ts` — 32 passed, exit 0, now
  including a caller-supplied `expectedSha`, a rollback phase reporting the candidate, a phase
  running the wrong digest, and identical candidate/previous SHAs.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-033` — A Test Guarding A Secret Printed It, And Depended On The Ambient Environment
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: running the full suite with `.env.local` loaded — the condition the
  certification ladder now runs under, after `TEL-P2-021` taught it to read that file.
- **Two defects in one line.** `tests/golden-journey.test.ts` opened its send assertion with:

  ```ts
  expect(process.env.GROQ_API_KEY ?? '').toBe('');
  ```

  1. **It asserted its premise instead of establishing it.** The journey exists to prove the send
     produces the approved wording with *no AI provider reachable*, but it only hoped the ambient
     environment had no keys. On a machine with them the guard tripped, and test 11 then failed
     as a cascade because the message test 8 should have created did not exist. Measured: 14/14
     without provider keys, 2 failures with them.
  2. **The failure printed the key.** Vitest renders the received value, so a live
     `gsk_…` Groq credential was written to the test output — and the certification ladder
     stores raw gate output under `docs/production-certification/evidence/raw/`. A failing
     certification run would have committed a working provider key into an evidence artifact
     that gitleaks then scans.
- **Why this session caused it to surface**: before `TEL-P2-021` the ladder never loaded
  `.env.local`, so gate 08 ran without provider keys and the test's assumption held by accident.
  Fixing the environment loading made gate 08 run the way a developer does — and this test would
  have failed all three certification runs.
- **Fix**: `beforeAll` now stubs `GROQ_API_KEY`, `GEMINI_API_KEY` and `OPENAI_API_KEY` to empty
  via `vi.stubEnv`, with `vi.unstubAllEnvs()` in `afterAll`, so the premise is **made** true
  regardless of the machine. The guard remains but asserts a derived string —
  `` `${key} present: false` `` — so a failure can never render the credential.
- **Swept**: this was the only assertion in `tests/` or `e2e/` comparing a secret-bearing
  environment variable against a literal.
- **Verified**: `tests/golden-journey.test.ts` 14/14 **with** provider keys loaded and 14/14
  without — the same result either way, which is the property that was missing.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-022` — `lib/authRoles.ts` Was Owned By No Domain
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: `tests/agent-routing.test.ts` failing after `TEL-P0-005` added the file —
  `unmapped paths — add them to .agent/registry/domains.yaml: expected [ 'lib/authRoles.ts' ]`.
- **Root cause**: `auth-rbac-tenancy` maps `lib/auth.ts` and `lib/auth/**`, and the new module
  matches neither. An R4 authorization surface therefore routed to no domain, no risk class and
  no target tests — the same defect as `TEL-P2-020`, one directory over.
- **Fix**: `lib/authRoles.ts` added to the `auth-rbac-tenancy` domain.
- **Regression test**: `tests/agent-routing.test.ts` — 32 passed, exit 0.
- **Evidence ID**: *(none yet)*

---

### `TEL-P0-005` — API Keys Authenticated As Managers Regardless Of Who Created Them
- **Severity**: P0 (privilege escalation)
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the directed blind-spot audit of shared-auth behaviour around `isManager`.
- **Root cause**: `getSessionUser()` in `lib/auth.ts` has two authentication paths that had
  drifted apart.

  | Path | `isManager` |
  |---|---|
  | session JWT | `dbUser._count.reports > 0 \|\| MANAGER_ROLES.includes(role)` — derived |
  | **API key** | **`true` — hardcoded, unconditional** |

- **Why it is exploitable, not theoretical**: `POST /api/developer/keys` is gated by
  `requireAuth()` alone, so **any authenticated user can mint a key** — an SDR included. Every
  request bearing that key then resolves to `isManager: true`, and `requireManager()` passes a
  caller who "is not director/floor_manager/team_lead **and** `!user.isManager`". The negation
  is satisfied, so the gate opens.
- **Invariant violated**: `API_KEY_PERMISSION <= CURRENT_USER_PERMISSION`.
- **Reachable surface**: the six routes gated by `requireManager()` —
  `automation/accounts/[id]/cap`, `opportunities`, `team/alerts`, `team/leaderboard`,
  `team/meetings`, `team/sdr-progress`.
- **Not affected**: the other `isManager` occurrences (`cron/*`, `email/accounts`,
  `email/send`) compute it locally from `role` and never read the poisoned session field.
- **Fix**: the derivation moved to `lib/authRoles.ts` as `deriveIsManager(role, activeReports)`
  and **both** paths now call it; the API-key query selects
  `_count.reports where isActive` so it has the input it previously lacked. The fix is in the
  derivation rather than in `requireManager()` on purpose: an individual contributor with
  active reports is a legitimate manager, and removing the `isManager` check would break them.
  `authRoles.ts` is separate from `auth.ts` because the latter imports next-auth and cannot be
  loaded from a unit test — which is precisely why this rule went untested and the two paths
  drifted.
- **Regression test**: `tests/api-key-privilege-escalation.test.ts` — 17 passed, exit 0.
  Includes a static guard that `isManager:\s*true` appears nowhere in `lib/auth.ts`.
- **Verified by mutation, not only by a green run**: forcing `deriveIsManager` to return `true`
  unconditionally fails **5 of the 17** tests; the module restores clean at 17/17.
- **Blast radius re-run**: 11 authorization and tenancy suites, **103 passed**, exit 0.
- **Remaining before VERIFIED**: exercise through the real HTTP surface with a live SDR-minted
  key, per `.claude/rules/auth-rbac.md` — this is an R4 change and the role E2E suite is part of
  the evidence, not an optional extra.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-029` — Demo Diagnostics Endpoint Readable Against Live Tenants, Without Object Authorization
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the directed object-level authorization audit.
- **Root cause**: `app/api/demo/diagnostics/route.ts` gated on `requireAuth()` and a tenant
  comparison, and nothing else. Two distinct problems:

  1. **It ran against real client tenants.** Its own docstring calls it *"a debugging tool, not
     a customer surface"*, and every sibling under `app/api/demo/` confines itself to
     `DEMO_TENANT_ID` — `inbound-reply` says why in as many words, *"so it cannot be used to
     inject mail into a real one"*. Diagnostics had drifted from that convention and was the
     only route in the directory readable against a live tenant.
  2. **No object authorization inside the tenant.** Any authenticated user could pass any
     `leadId` belonging to their tenant. An SDR could therefore read another SDR's prospect —
     identity and company, operating state, enrollment, current task, work orders, **agent
     actions, approvals**, reply classification, job runs and latest activity.

- **Invariant broken**, stated in `AGENTS.md`: *"Capability authorization is not object
  authorization."* Being allowed to call the endpoint is not being allowed to read that row.
- **Not affected**: cross-tenant reads were already refused, so this was never a tenant-isolation
  breach — it is a within-tenant, cross-user exposure.
- **Fix**: the route now refuses any tenant other than `DEMO_TENANT_ID` with **403**, before it
  reads any prospect data, matching `inbound-reply`. Within the demo tenant it additionally
  resolves `getVisibleUserIds(user)` and refuses a lead outside that set with the **same 404** a
  missing lead returns, so the endpoint cannot be used as an oracle for which lead ids exist.
  The pre-existing tenant check is retained, so neither guard is load-bearing alone.
- **Regression test**: `tests/demo-diagnostics-authorization.test.ts` — 12 passed, exit 0. It
  also asserts the convention across **every** route under `app/api/demo/`, since the defect was
  one route drifting from what its siblings do.
- **Blast radius re-run**: 5 object-authorization suites, **75 passed**, exit 0.
- **Remaining before VERIFIED**: exercise through the real HTTP surface — SDR A requesting
  SDR B's lead must 404.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-030` — Webhook Delivery Was Server-Side Request Forgery With A Response Oracle
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the directed SSRF audit.
- **Root cause**: `deliverWebhook()` called `fetch(url)` with no validation. The only check
  anywhere was the route's `url.startsWith('http')`, which also admits `httpx://`, credentials
  in the URL, and every private address.
- **What that allowed**: any authenticated user could make the production VM issue a **POST**,
  with a body they controlled, to any address it could reach — `127.0.0.1`, `10/8`,
  `169.254.169.254`, the app itself — and read back `statusCode`, `latencyMs` and the raw
  `error` string. Status plus latency plus error text is enough to port-scan and fingerprint the
  internal network from outside. `fetch` also follows redirects by default, so a public URL
  answering `302` to a private one worked too.
- **Fix**: `lib/webhooks/ssrfGuard.ts`, applied **inside `deliverWebhook`** so the test ping and
  the real dispatcher inherit it rather than each route remembering to call it.

  The check is on **resolved addresses**, not hostname text, which is why the exotic encodings
  need no special cases — `http://2130706433/`, `http://0x7f000001/` and a DNS name whose A
  record is `10.0.0.5` all resolve to something blocked. Blocked: loopback, `0.0.0.0/8`,
  `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata), CGNAT, multicast, IPv6
  `::1`/`::`/`fc00::/7`/`fe80::/10`/`ff00::/8`, and IPv4-mapped IPv6 forms. If **any** resolved
  address is blocked the destination is refused, because which one `fetch` picks is not ours to
  choose. Redirects are no longer followed (`redirect: 'manual'`) and a 3xx is a failed
  delivery.
- **Rebinding window closed, after CodeQL disagreed with the first fix.** The initial guard was
  a check-then-use, and CodeQL raised `js/request-forgery` at **critical** on exactly that: a
  validation that runs before the request is not a sanitizer, because `fetch` resolves the name
  again itself. It was right. `guardedDispatcher` now re-runs the same address rules **inside
  undici's connector**, against the address the socket is about to use, so there is no
  resolution after the check.

  The two layers cover different threats, and neither is redundant:

  | Vector | Caught by |
  |---|---|
  | literal IP, in any encoding | the pre-check — a literal cannot rebind, and undici skips DNS for literals entirely |
  | hostname resolving private | either layer |
  | **DNS rebinding** | the connector, which is the only layer that can |

- **Live-verified, not only unit-tested.** Driving the connector directly, `http://localhost` is
  refused with *"resolves to ::1: IPv6 loopback"* while `https://example.com` **reaches status
  200** — the guard blocks without breaking delivery. That check mattered: the first version of
  the connector replied in the single-address shape while asking the resolver for all addresses,
  which handed undici `undefined` and **broke every legitimate delivery**. It was caught by
  running it, not by reading it.
- **End-to-end**: ten vectors driven through `deliverWebhook` itself — loopback literal and by
  name, cloud metadata, `10/8`, `192.168/16`, integer-encoded, IPv6 loopback, credentials in the
  URL, `file://`, and an unsupported scheme — all refused before any socket opens.
- **Regression test**: `tests/webhook-ssrf-and-authorization.test.ts` — 57 passed, exit 0,
  covering every case in the directive's list including integer and hex encodings, IPv6, a
  hostname resolving private, and a mixed public/private answer.
- **Verified by mutation**: forcing `blockedAddressReason` to return `null` fails **30 of 57**.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-031` — Webhook Administration Needed Only Authentication, And Read Back Signing Secrets
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the directed webhook authorization audit.
- **Root cause**: `GET`, `POST` and `DELETE` on `/api/webhooks` — and `POST /api/webhooks/test`
  — were all gated on `requireAuth()`. Any authenticated user, an SDR or a leadgen included,
  could list, create, delete and test the tenant's webhooks.
- **Why it matters twice over**:
  1. A webhook is an **outbound data channel** carrying lead events. Creating one is a way to
     forward a client's pipeline to an address of your choosing.
  2. `GET` returned each config's **signing `secret`** in full. That secret is what the
     receiving system uses to decide a payload really came from Telestar, so reading it is
     enough to forge traffic the client's systems accept as ours.
- **Fix**: all four verbs now require `requireManager()`. The secret became write-only: `GET`
  maps every config through `redactSecret`, returning `secretSet: boolean` instead, and the
  generated secret is echoed exactly once on creation so it can be copied into the receiving
  system. The test endpoint no longer accepts a caller-supplied secret at all — it takes a
  `webhookId` and resolves the URL and secret server-side, or a bare URL for trying an unsaved
  endpoint, signed with a throwaway value.
- **UI follow-through**: `app/automation/page.tsx` no longer reads `webhook.secret`. It sends
  `webhookId` to the test endpoint and renders a fixed mask, so the browser never holds a
  signing secret. Its state type moved to the new `WebhookConfigPublic`.
- **Regression test**: covered by the 57 in `tests/webhook-ssrf-and-authorization.test.ts`,
  including that no verb is gated on mere authentication and that no read path returns a secret.
- **Blast radius re-run**: 5 webhook and authorization suites, **95 passed**, exit 0.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-032` — Webhook Configuration Has No Durable Authority And Writes Can Fail Silently
- **Severity**: P1
- **Status**: `OPEN` — remediation needs a migration, which is R4
- **Discovered by**: the directed durability audit.
- **Measured**: there is **no `Webhook` model in `prisma/schema.prisma`** — the word does not
  appear in the schema at all. Every webhook configuration lives only in Redis, written by
  `cacheSet(getCacheKey(tenantId), updated, WEBHOOK_CACHE_TTL)` where the TTL is
  `3600 * 24 * 30`.
- **Three distinct failures follow**:
  1. **It expires.** After 30 days without a rewrite, every webhook silently stops existing.
  2. **It does not survive Redis.** A restart without persistence, a flush, an eviction under
     memory pressure, or a cache migration loses every tenant's configuration with no record
     that it ever existed.
  3. **A write can silently do nothing.** `cacheSet` returns early when there is no client and
     swallows errors — `catch { /* silently fail — cache is optional */ }`. With Redis down,
     creating a webhook returns `{ success: true }` and stores nothing.
- **Why it is not merely a cache concern**: this is configuration, not a cached projection of
  something durable. There is no source of truth behind it to rebuild from, which is the
  invariant in `AGENTS.md` — *"The database is workflow truth. Queues execute, never decide,
  and are rebuildable from it."*
- **Required remediation**: a `Webhook` model owning `id`, `tenantId`, `url`, `secret`,
  `events`, `isActive`, `createdAt`, `lastDeliveryAt`, `lastStatus`, with the tenant scoping
  every other model has; the routes reading and writing it as the authority; Redis retained
  only as a read cache in front of it, with a failed cache write no longer able to look like a
  successful save. Concurrent create/update/delete then need testing against the database
  rather than against a read-modify-write of a cached array, which is itself lossy under
  concurrency.
- **Why not fixed in this pass**: it requires a schema migration, and `AGENTS.md` classifies
  migrations as **R4 — independent verification plus explicit operator authorization**. The
  analysis is complete and the change is ready to make on authorization.
- **Evidence ID**: *(none yet)*

---

### `TEL-P0-001` — Disaster Recovery Evidence Invalid
- **Severity**: P0 (Launch Blocker)
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: DR evidence was authored, not measured.
- **Finding 1**: `BACKUP_RESTORE.md` documents a 48.2 MB backup artifact
  `telestar_backup_20260819_prod.dump` with SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
  That digest is the SHA-256 of the **empty byte sequence**. A 48.2 MB file cannot produce it.
  The artifact was therefore never hashed, and very likely never created.
- **Finding 2**: The documented restore procedure step 4 executes
  `scripts/verify-db-integrity.ts`. That file **does not exist** in the repository.
- **Finding 3**: Consequently RTO `4m 12s`, RPO `15m`, rollback `38s`, and
  "48/48 tables reconciled" are unsupported numbers.
- **Required remediation**: implement `scripts/verify-db-integrity.ts` with real invariants;
  take a real non-empty dump; hash it; `sha256sum -c` it; restore into an isolated database;
  run the integrity script; compare pre/post record counts; measure RTO from observation;
  derive RPO from actual infrastructure configuration or mark `BLOCKED_EXTERNAL`.
- **Invariant the validator must enforce**: `backupSizeBytes > 0` **and**
  `backupSha256 != e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- **Fix**: implemented `scripts/verify-db-integrity.ts` with a negative control; executed a real drill
  (82.72 MB backup, sha256 `6973d111...`, `sha256sum -c` verified, isolated restore, counts reconciled,
  measured RTO 96.08s). Evidence `EV-DR-BACKUP`, `EV-DR-RESTORE`, `EV-DR-NEGATIVE-CONTROL`.
- **Remaining before VERIFIED**: the drill must be re-run against the frozen candidate SHA; the validator
  rejects DR evidence carrying a superseded SHA.
- **Evidence ID**: *(none yet)*

---

### `TEL-P0-002` — Production Backup Posture Contradicts Itself; RPO Unsubstantiated
- **Severity**: P0 (Launch Blocker)
- **Status**: `RESOLVED` — measured 2026-08-21; superseded by `TEL-P1-027`
- **Discovered by**: attempting to derive RPO from real configuration instead of restating a target.
- **Detail**: three repository documents make incompatible statements about whether the
  production database has any automated backup at all.

  | Source | Claim |
  |---|---|
  | `docs/BACKUP_RESTORE_RUNBOOK.md` section 1 | automated daily backups and 7-day PITR **enabled**; RPO < 5 minutes |
  | `docs/CLOUD_RUN_DEPLOY.md` Cloud SQL creation | instance created with `--availability-type=zonal --no-backup` |
  | `docs/DEPLOY.md` section 8 | as of 2026-08-05 `gcloud sql backups list` returned one manual snapshot — "There is no schedule." |

  The same two documents also disagree on engine version (runbook says PostgreSQL 15, the
  creation command specifies `POSTGRES_16`).
- **Why P0**: if the deploy documentation is accurate, the production database has no
  automated backup and no point-in-time recovery, so the real RPO is "everything since the
  last manual snapshot" — unbounded. A launch on that posture risks unrecoverable data loss.
  The risk is the *uncertainty*: no one currently knows which document describes reality.
- **Why BLOCKED_EXTERNAL**: the live instance cannot be inspected from here. Guessing is
  prohibited.

  > **Correction, 2026-08-21.** This line previously read "`gcloud` is not installed on the
  > certification machine". That is false, and it pointed the remediation at the wrong action.
  > `gcloud` **is** installed — SDK 581.0.0, confirmed by `npm run agent -- doctor` — but
  > `gcloud auth list` reports *No credentialed accounts*. The blocker is authentication, not
  > installation: one `gcloud auth login` by the operator resolves it. Separately, the VM's own
  > service account cannot answer Cloud SQL questions at all
  > (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`), so this must be run from Cloud Shell or from an
  > operator-authenticated workstation — not from the VM.
- **Required remediation**: run `gcloud sql instances describe telestar-crm-db` and
  `gcloud sql backups list` against the real project, attach the raw output as evidence,
  correct whichever document is wrong, and — if backups are in fact disabled — enable
  automated backups and PITR before launch.
- **Evidence ID**: `EV-DR-RPO` (to be re-recorded against the new candidate)

### RESOLVED 2026-08-21 — measured against the live instance

Operator authenticated `gcloud`; the instance was inspected directly. **No document was right.**

First, the remediation command in this very defect names an instance that does not exist. The
real instance is **`telestar-db`**, not `telestar-crm-db`; `scripts/deploy.sh` had it right.

| Source | Claim | Reality |
|---|---|---|
| `BACKUP_RESTORE_RUNBOOK.md` | daily backups **and 7-day PITR**; RPO < 5 min | backups yes, **PITR no**, RPO up to 24 h |
| `CLOUD_RUN_DEPLOY.md` | created `--no-backup` | **wrong** — backups are enabled |
| `DEPLOY.md` (2026-08-05) | one manual snapshot, "no schedule" | true then, **stale now** — a schedule exists |
| `BACKUP_RESTORE_RUNBOOK.md` | PostgreSQL 15 | **`POSTGRES_16`** |

Measured `settings.backupConfiguration`:

```
enabled                       true
startTime                     17:00
retainedBackups               7 (COUNT)
transactionLogRetentionDays   7
pointInTimeRecoveryEnabled    (absent — PITR is OFF)
```

`gcloud sql backups list` shows successful automated backups at 17:00 on five consecutive days
through 2026-08-20, plus one on-demand. So the database **is** backed up daily and the
unbounded-loss scenario this defect feared does not exist.

**The P0 is resolved. It is replaced by a smaller but real finding**, `TEL-P1-027`: without
PITR the worst case is everything since the last daily backup — 24 hours — and `DR-007` requires
under one hour.

Incidentally this validated `DEPLOY-002` against reality: real backup run ids look like
`1787245200000`, which `validate_backup_id` accepts, while `Telestar2026` is refused.

---

### `TEL-P1-014` — Final Three-Run Certification Ladder Incomplete
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: `RUN_1/2/3` executed a 4-gate subset but were documented as full
  certification runs.
- **Detail**: The runs prove TypeScript, ESLint, migration order, and Vitest. They do not
  prove production build, Playwright, Redis integration, queue load, Docker build, image
  inspection, compose validation, worker readiness, or health smoke. Redis was skipped.
- **Required remediation**: `scripts/certification/run-full-certification.mjs` defining the
  complete ladder in code, invoked as `npm run certify:full`; run manifests generated from
  raw run output, not hand-written.
- **Fix**: `scripts/certification/run-full-certification.mjs` runs the whole 22-gate ladder as one
  command. A gate that does not run is reported in `missingGates`, and the validator refuses a run
  that omitted one. Gate 02 proves Postgres and Redis are reachable before anything starts, which is
  what the old runs lacked when they "passed" without Redis. Run manifests and `RUN_N.md` are
  generated from raw output.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-015` — AI Budget Governance Is Process-Local
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Budget reservations are held in an in-process `Map`.
- **Detail**: Process restart erases budget truth. Two web replicas do not share reservations.
  The worker does not observe the web tier's reservations. This is not a durable tenant hard
  budget, and must not be certified as one.
- **Required remediation**: database-authoritative budget ledger
  (`TenantAiBudgetPeriod`: `tenantId`, `periodKey`, `limit`, `used`, `reserved`, `updatedAt`),
  integer minor-units (no floating-point money), atomic conditional reservation.
- **Invariant**: N concurrent processes cannot collectively reserve past the hard limit.
  Must be tested with **actual parallel** requests against the shared store, not sequential calls.
- **Fix**: `TenantAiBudgetPeriod` / `TenantAiBudgetReservation` with integer micro-dollars and a
  single-statement conditional UPDATE as the gate. Proved with ten real child processes against one
  database and a limit of five: exactly five reserved, five refused. `tests/ai-durable-budget.test.ts` 14/14.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-016` — AI Streaming Governance Incomplete
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: `stream()` was implemented without parity to the non-stream path.
- **Missing**: pre-call budget reservation, provider timeout / abort, usage reconciliation,
  attribution recording, cancellation accounting.
- **Required tests**: successful stream; provider error before first token; provider error
  mid-stream; timeout; consumer cancellation; fallback provider; budget exceeded; AI-down
  degraded behaviour.
- **Fix**: `stream()` reserves before opening, enforces a deadline via AbortController, collects
  provider-reported usage, records attribution with token counts, and settles exactly once on every exit
  including consumer cancellation. `tests/ai-stream-governance.test.ts` 10/10 covers all eight cases.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-017` — AI Circuit State Is Process-Local
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Circuit state `Map` and HALF_OPEN lease `Set` coordinate a single Node process.
- **Detail**: Multi-instance resilience cannot be claimed from process-local state. Instance B
  keeps calling a provider that instance A has already circuit-opened.
- **Required remediation**: shared circuit state in Redis (already an operational dependency).
  `circuit:{provider}:{model}` holding state / failure count / lastFailure / openedAt.
  HALF_OPEN probe lease via `SET key value NX PX <timeout>` so exactly one process probes.
  Behaviour when Redis is unavailable must be explicitly defined and tested.
- **Fix**: `lib/ai/sharedCircuit.ts` holds state in Redis; the HALF_OPEN probe is a `SET NX PX` lease.
  Racing 12 concurrent acquirers against a real Redis yields exactly one winner. Redis-unavailable
  behaviour is defined as fail-open to local state and is tested. `tests/ai-shared-circuit.test.ts` 9/9.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-018` — Release Deployment Identity Chain Missing
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`

> **Status corrected 2026-08-21.** This read `OPEN` while the evidence for it already existed.
> `EV-RELEASE-IDENTITY` carries every value the remediation below demands — `ciRunId`
> `32418164738`, image/web/worker digest `sha256:f2e807bb…`, `healthSha` equal to the candidate
> — with `chainProblems: []`, and `REL-001` reads **VERIFIED** in
> [REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md). Carrying it as `OPEN` overstated
> the remaining work; the honest state is fix implemented and evidenced, awaiting re-run
> against the next frozen candidate, since this session supersedes `daa8ffb`.
- **Root cause**: Release identity was asserted at source-SHA level only.
- **Missing authoritative values**: `CI_RUN_ID`, `IMAGE_DIGEST`, `WEB_DIGEST`, `WORKER_DIGEST`,
  `HEALTH_SHA`.
- **Required remediation**: `DEPLOYMENT.md` carrying the full chain; image built from the frozen
  candidate SHA and referenced **by digest**, never by `latest`/`main`/floating tag; proof that
  `EXPECTED_SHA == HEALTH_SHA` and `EXPECTED_IMAGE == WEB_IMAGE == WORKER_IMAGE`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-013` — Six-Role Real Browser Acceptance Not Evidenced
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Database/service role tests were treated as satisfying a browser-acceptance
  requirement.
- **Detail**: `tests/role-journeys.test.ts` is valuable and is retained. It does not prove that
  Director, Floor Manager, Team Lead, SDR, Leadgen Manager, and Leadgen can log in and operate
  the real UI.
- **Required remediation**: `ROLE_BROWSER_EVIDENCE.md` backed by Playwright against a
  production build with real Postgres, real Redis, real server, real browser. Per role: login
  result, landing page, key navigation, allowed workflow, forbidden workflow, object
  authorization attempt, console errors, network failures, screenshot, trace.
- **Fix**: `e2e/certification/six-role-acceptance.spec.ts` drives all six roles in Chromium against a
  production build with real Postgres and Redis. Measured 6/6 PASS, 0 console errors, 0 network
  failures, cross-tenant object denied for every role. The verdict is computed by
  `buildRoleBrowserEvidence`, developed test-first, whose 14 cases pin that a role NOT stopped from a
  forbidden surface FAILS. Evidence `EV-ROLE-BROWSER`; detail in `ROLE_BROWSER_EVIDENCE.md`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-014` — Master Evidence Ledger Stale
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: `EVIDENCE.md` declares candidate `cf23182` and totals `149 files / 1,880 tests`
  while the certificate declared `a6d8c0d` and `154 files / 1,922 tests`. It also lacks
  evidence for the majority of active certification domains.
- **Required remediation**: rebuild from the evidence manifest, covering static, build,
  database, Redis, unit/integration, import, queue load, email, AI, security, roles, Playwright,
  DR, rollback, deployment, and the three final runs.
- **Fix**: `EVIDENCE.md` is generated from the evidence directory, so it cannot name a record that
  does not exist or omit one that does, and it marks any record bound to a superseded candidate.
  `MASTER_TRACKER.md`, `progress.json`, `REQUIREMENT_TRACEABILITY.md` and `RUN_N.md` are generated too.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-015` — Load Results Contradict Certificate
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: For the 1,000-row case `LOAD_TEST.md` recorded `26.11s / 38.3 rows/s / p95 1423ms`
  while the certificate recorded `19.71s / 50.75 rows/s / p95 950ms`. Two authoritative answers
  to one question is a certification failure regardless of which is correct.
- **Required remediation**: one machine-written source of truth (`load-results.json`);
  `LOAD_TEST.md` and the certificate both rendered from it; no manual duplication anywhere.
- **Fix**: the handler benchmark emits `EV-LOAD-HANDLER.json` instead of writing markdown, and
  `LOAD_TEST.md` is rendered from both load records. No document types a performance number.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-016` — Load Benchmark Does Not Exercise The Real BullMQ System
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: The existing benchmark mocks BullMQ and invokes the worker handler directly. That
  is a legitimate **handler** benchmark and is retained under the name
  `IMPORT_HANDLER_BENCHMARK`. It is not queue/system evidence: it measures nothing about
  enqueue latency, queue wait, retry, redelivery, or worker concurrency.
- **Required remediation**: add `IMPORT_SYSTEM_QUEUE_BENCHMARK` using real Redis, real BullMQ,
  real worker, real queue, at 120 / 500 / 1000 rows, recording queue wait and processing
  percentiles, failed jobs, retries, lost/duplicate/stuck rows.
- **Fix**: `scripts/certification/queue-load-benchmark.ts` runs real Redis, real BullMQ, a real worker
  and real jobs, waiting for every row to reach a terminal state rather than for job counts. It
  measured queue wait p95 rising 4ms -> 5007ms -> 8463ms across 120/500/1000 rows with zero lost,
  duplicated or stuck rows - backpressure the handler benchmark is structurally unable to show.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-017` — AI Capability Routing Not Strictly Enforced
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: `requiresTools`, `requiresVision`, `requiresStructuredOutput` do not constrain the
  selected model, and do not constrain **fallback** models at all.
- **Required remediation**: capability filtering applied before preference ranking; every
  fallback must satisfy the same hard requirements as the primary; an unknown preferred model
  must produce an explicit validation error or an explicit fallback decision carrying
  `requestedModel` / `fallbackModel` / `fallbackReason` — never a silent remap.
- **Fix**: routing is a filter pipeline; fallbacks come from the same surviving candidate set, so they
  cannot satisfy weaker requirements than the primary. An unknown preferred model raises
  `UnknownModelError` or returns an explicit `fallbackNotice`. `tests/ai-capability-routing.test.ts` 21/21.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-019` — Requirements Verified Against Test Files That Do Not Exist
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: `npm run certify:validate` check `J2`, on the first run of the validator.
- **Root cause**: requirement rows were authored with plausible-sounding test filenames that
  were never written.
- **Detail**: five requirements cite test files absent from the repository and absent from all
  git history (no delete commit exists, so they were never present):

  | Requirement | Cited test file | Exists |
  |---|---|---|
  | `IMP-011` | `tests/leadgen-pool.test.ts` | no |
  | `ROLE-011` | `tests/leadgen-pool.test.ts` | no |
  | `OPS-008` | `tests/transfer-work.test.ts` | no |
  | `OPS-020` | `tests/lead-lifecycle.test.ts` | no |
  | `OPS-021` | `tests/activities.test.ts` | no |

  Application routes of similar names exist (`app/api/leadgen-pool`, `app/admin/transfer-work`),
  which is likely how the names were invented. A citation to a nonexistent test can never be
  satisfied by any run, and reads as coverage that was never written.
- **Required remediation**: for each requirement either write the missing test, or repoint the
  requirement at the test that genuinely exercises the invariant. Repointing must be justified
  in the commit, never done silently to clear the check.
- **Fix**: `tests/lead-lifecycle.test.ts` (6/6) and `tests/activities.test.ts` (7/7) were written, since
  no test covered those invariants at all. `IMP-011`, `ROLE-011` and `OPS-008` were repointed to the
  tests that genuinely exercise them, each carrying a written justification in `requirements.json`.
  Validator check `J2` now reports zero phantom citations.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-020` — `worker-healthcheck` Never Exits When The Check Succeeds
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: certification gate 18, which recorded `exitCode: null` (killed at its timeout)
  while its own log read `job cmt0ivw530001vwc4rxu2z79t completed`.
- **Root cause**: enqueuing opens a BullMQ queue and its Redis connection, and both keep the Node
  event loop alive. Only the failure path called `process.exit`, so the **success** path returned
  from `main()` and then hung forever.
- **Why it matters**: a health check that hangs when everything is fine is worse than one that
  fails. `npm run worker:healthcheck` is documented as a deploy gate; used there it would wait
  forever and read as an infrastructure problem rather than a working system. The bug was invisible
  precisely because it only manifests on success.
- **Fix**: close the queues and the shared connection, then exit explicitly on both paths. The
  cleanup lives in `main()`, not in the exported `runWorkerHealthcheck`, so
  `scripts/cutover-preflight.ts` does not get its connections closed underneath it.
- **Evidence ID**: gate `18-worker-readiness` in each run manifest

---

### `TEL-P1-021` — AI Circuit State Was Not Namespaced Per Deployment
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the first full ladder run. The Vitest gate failed with 4 failures in
  `ai-stream-governance`, all returning the AI-unavailable message; they passed in isolation.
  Inspecting Redis afterwards showed six of the seven model circuits `OPEN`.
- **Root cause**: `TEL-P1-017` moved circuit state to Redis keyed only by `provider:model`, with no
  deployment scope. Any process that exercises the gateway without API keys fails every provider
  call and therefore opens every circuit — for every other consumer of that Redis, and for 24 hours.
- **Why it matters beyond tests**: sharing circuit state between the instances of one deployment is
  the feature; sharing it between *different* deployments on one Redis is a defect. A staging run
  that exhausts a provider would open production's circuits.
- **Fix**: keys are now `crm4u:ai:circuit:{namespace}:`, following the existing `crm4u:` convention
  in `lib/cache.ts`, with the namespace from `AI_CIRCUIT_NAMESPACE` else `NODE_ENV`. Written
  test-first; three failing cases preceded the implementation. The two suites that drive the gateway
  take a namespace of their own.
- **Verification**: full Vitest went from 2048 passed / 4 failed to 2055 passed / 0 failed / 0 skipped.
- **Evidence ID**: `EV-VITEST`

---

### `TEL-P1-022` — Concurrent Duplicate Job Delivery Could Still Fail The Chunk
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the first real CI run (`32323964277`). 163 test files passed and one failed:
  `TEL-P1-007: executes identical chunk payload concurrently across 2 workers without
  duplicating leads or activities`. It passes on the certification workstation every time.
- **Root cause**: when two workers get the same chunk, one `lead.create` wins and the other
  receives `P2002` on `(tenantId, campaignId, normalizedEmail)`. The loser is supposed to adopt
  the winner's row rather than duplicate it, and it re-read **once**. The constraint firing
  proves the row exists, but not that it is *committed* — and a read landing inside that window
  returns null, so the handler rethrew and failed the whole chunk.
- **Why local runs never saw it**: the window is milliseconds wide. Slower, more contended CI
  hardware widens it enough to hit; this workstation does not. This is the case for running CI
  as evidence rather than trusting a local green.
- **Fix, part 1**: `findLeadAfterConflict` re-reads up to five times with a short delay before
  giving up. A row still absent after that has genuinely not been written, and the caller
  rethrows — so the branch stays honest instead of swallowing a real failure.
- **Fix, part 2 (what actually mattered)**: part 1 alone did not fix it. The second CI run failed
  the same test with `expected 2 to be 1` on `activity.count` — the lead was no longer
  duplicated, but **two `lead_created` activities** were. Three writes in that path used the
  same check-then-act shape:

  | Write | Old guard | Now |
  |---|---|---|
  | `lead_created` activity | `findFirst` then create | unique `Activity.idempotencyKey`, P2002 means "already written" |
  | `sequence_enrolled` activity | `findFirst` then create | same |
  | first sequence-step task | `findFirst` by `leadId` then create | deterministic `taskId`, the mechanism `createTaskForStep` already provides |

  The `catch` wrapped around the activity guard claimed to handle "the concurrency insert
  race". It could not: with no constraint there was nothing to throw. It was catching an error
  that never happened while the duplicate went in cleanly.
- **Schema**: `Activity.idempotencyKey String? @unique`. Nullable, so Postgres permits many
  NULLs and ordinary activities — dozens of `email_sent` rows on one lead — are unaffected,
  while a keyed write is guaranteed once by the database. Migration
  `20260820000000_activity_idempotency_key`. Task needed no schema change: the deterministic
  primary key `createTaskForStep` already accepts is exactly this mechanism.
- **Evidence ID**: `EV-CI-RUN`, plus `EV-VITEST`

---

### `TEL-P2-018` — Two CI Jobs Cannot Run On This Repository
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: CI run `32323964277`.

> **Premise no longer holds, 2026-08-21.** Both jobs now run and pass. Checked across the six
> most recent `ci.yml` runs rather than inferred from one:
>
> | Run | CodeQL | Dependency review |
> |---|---|---|
> | `32487639659` | success | success |
> | `32486606317` | success | success |
> | `32486554961` | cancelled (superseded) | success |
> | `32443270100` | success | skipped (push event — correct) |
> | `32418164738` | success | skipped (push event — correct) |
> | `32416213512` | success | skipped (push event — correct) |
>
> `skipped` on the push runs is the workflow behaving as designed: dependency review needs a
> base ref to diff against, so it runs on `pull_request` only. Whatever repository setting was
> missing on 2026-08-20 — Dependency graph, or Advanced Security — has since been enabled.
> Nothing in this repository changed to cause it, which is why the finding was correctly
> classified `BLOCKED_EXTERNAL` at the time.
>
> This closes the "CI is green is unreachable" concern **for these two jobs**. The genuinely
> unreachable mandatory gate turned out to be a different one — see `TEL-P1-025`.
>
> Note the aggregate job never treated either as mandatory: `require "codeql" "$CODEQL"
> success skipped failure` accepts all three outcomes deliberately, so that the merge gate
> depends on the code rather than on a GitHub plan.
- **Detail**: two required checks fail for repository-configuration reasons rather than code.

  | Job | Error |
  |---|---|
  | Dependency review | "Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled along with GitHub Advanced Security" |
  | CodeQL | "Resource not accessible by integration" when uploading results |

- **Why it matters**: `docs/BRANCH_PROTECTION.md` intends every CI job to be a required status
  check. Two of them can never pass as configured, so the branch-protection intent is not
  actually enforceable, and "CI is green" is unreachable on this repository today.
- **Required remediation**: enable Dependency graph and GitHub Advanced Security in repository
  settings, or remove the jobs from the required set and say so. This is an account/repository
  setting and cannot be changed from the codebase.
- **Evidence ID**: `EV-CI-RUN`

---

### `TEL-P1-023` — The Image Gates Were Blocked By A Constant, Not By The Machine
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: asking why three certification runs failed with no failing gate.
- **Root cause**: `scripts/certification/run-full-certification.mjs` recorded gates
  `19-docker-build` and `20-image-inspection` as `BLOCKED_EXTERNAL` **unconditionally**, via a
  hardcoded `blockedGate(...)` call with the reason "no container runtime on the certification
  workstation". The reason was true of the workstation, but nothing in the code ever checked
  it.
- **Why it matters**: this is the sole cause of `REL-003`, `REL-004` and `REL-005` being
  `NOT_VERIFIED`, and therefore of the `NO-GO` verdict. Because the block was a literal,
  **installing a container runtime would not have changed a single run's verdict** — the gates
  would have gone on reporting blocked on a machine perfectly able to run them. The remediation
  everyone believed was available was not actually wired to anything.
- **Fix**: extracted to `scripts/certification/lib/imageGates.mjs`. `containerRuntime()` probes
  the daemon (`docker version`, then `podman version`) rather than trusting PATH, because an
  installed-but-stopped Docker Desktop resolves on PATH and fails every command. Gate 19 builds
  from the candidate tree, tagged `telestar-crm-candidate:<candidateSha>` and never `latest`.
  Gate 20 reads identity back off the built image and fails unless the image id is a real
  sha256, the `org.opencontainers.image.revision` label equals the candidate SHA, and no
  floating tag references it. `BLOCKED_EXTERNAL` is still recorded — and is still not a pass —
  where no runtime answers.
- **Regression test**: `tests/certification-image-gates.test.ts`, 17 tests, including that a
  missing runtime never yields `PASS` and never silently skips the attempt.
- **Remaining before VERIFIED**: a certification run on a machine with a container runtime.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-001` — A Failed Audit-Trail Write Did Not Fail The Deploy
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: deploying to the live box on 2026-08-21.
- **Root cause**: `scripts/deploy.sh` appended to `deployments.ndjson` as its **last** step. The
  file was root-owned, the append printed `Permission denied`, and the release that is now
  serving traffic has no entry in the audit trail. The `if python3 … elif node …` chain also had
  no `else`, so a machine with neither writer wrote nothing and said nothing.
- **Why it matters**: `REL-001` requires an immutable release identity chain. A deploy that
  leaves no record breaks that chain silently, and the gap is invisible until someone asks what
  is running.
- **Fix**: `assert_record_writable` now runs as a **preflight**, before the pull and long before
  the container swap, so an unwritable record aborts while nothing has happened yet; the missing
  `else` now fails loudly; and `assert_record_appended` confirms the file actually grew by a
  line. The same guards were added to `scripts/rollback.sh`, where the problem is worse — that
  script runs during an incident.
- **Regression test**: `tests/deploy-script.test.ts`.
- **Executed end to end**, not only unit-tested: `scripts/deploy.sh` was run in a sandbox with a
  stub container runtime. With a read-only record file it aborts **exit 1** before the pull, and
  with a record directory that does not exist it aborts the same way — in both cases naming the
  missing audit trail, and in both cases before anything irreversible has happened.
- **Remaining before VERIFIED**: one real deploy on the VM.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-002` — The Pre-Deploy Backup Prompt Accepted Any String
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: deploying to the live box on 2026-08-21.
- **Root cause**: `scripts/deploy.sh` prompted for a Cloud SQL backup id and accepted anything
  non-empty (`[ -n "$BACKUP_ID" ] || fail`). `Telestar2026` — the published demo password — was
  accepted on three separate deploys, and nothing ever asked Cloud SQL whether a backup existed.
- **Why it matters**: the pre-deploy backup is the only thing standing between a bad migration
  and unrecoverable data loss. A prompt that accepts a password records a backup that was never
  taken, which is worse than no prompt: it produces false assurance in the audit trail. Directly
  compounds `TEL-P0-002`.
- **Fix**: `validate_backup_id` rejects anything that is not a numeric run id of plausible
  length. `verify_backup_exists` then asks Cloud SQL directly: a definite "no such backup" now
  aborts the deploy; an inability to ask (no gcloud, no credentials, or the VM service account's
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) is **not** treated as a pass — it warns, requires the
  operator to type `UNVERIFIED`, and records `backupVerified: false` in the deployment record so
  a verified deploy and an unverified one are distinguishable afterwards.
- **Regression test**: `tests/deploy-script.test.ts`, including the literal `Telestar2026` case.
- **Executed end to end.** Running the real `scripts/deploy.sh` with
  `DEPLOY_BACKUP_ID=Telestar2026` aborts **exit 1** — *"Backup ID must be the numeric Cloud SQL
  backup run id, not free text"* — before the migration and before the container swap. Two
  further paths were exercised, because the interesting question is what happens when the
  backup **cannot** be checked rather than when it is plainly wrong:

  | Path | Result |
  |---|---|
  | valid numeric id, gcloud cannot answer, non-interactive | **fails closed**, exit 1 |
  | valid numeric id, operator types `UNVERIFIED` | proceeds, records `backupVerified: false` |

  The first matters most: a deploy run from a script or a CI job, where nobody is present to
  acknowledge, can no longer proceed without a verified backup. On this machine the warning also
  classified correctly — *"gcloud has no usable credentials here"*, not "not installed".
- **Remaining before VERIFIED**: one real deploy on the VM.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-003` — Every Pull Failure Was Reported As A Missing Image
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: a disk-full incident on the VM on 2026-08-21.
- **Root cause**: `$DOCKER pull … || fail "No image published for commit ${COMMIT}. CI publishes
  only after it passes — check the run."` asserted one cause for every possible failure. The VM
  disk had filled with images and build cache; the operator was sent to inspect a CI run that was
  perfectly healthy. `docker image prune -a -f` plus `docker builder prune -f` recovered 36 GB.
- **Fix**: `classify_pull_failure` reads what the registry actually said and names it — full
  disk (with the recovery command), missing manifest, rejected credentials, or network — and
  quotes the real first line for anything unrecognised rather than guessing. Applied to
  `deploy.sh` and to `rollback.sh`, where a misdiagnosis during an incident costs the most.
- **Regression test**: `tests/deploy-script.test.ts`.
- **Executed end to end**: with a stub runtime whose `pull` writes
  `no space left on device`, the real `scripts/deploy.sh` aborts **exit 1** with *"Disk is full
  on this box … This is not a CI problem"* and the recovery command, instead of the old message
  that sent the operator to inspect a healthy CI run.
- **Remaining before VERIFIED**: observed on a real failure, or accepted on the regression test.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-024` — The RPO Evidence Record Was A Constant Asserting A Stale Blocker
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: checking whether the blocker named in `EV-DR-RPO` was still true.
- **Root cause**: `scripts/certification/record-blocked-evidence.mjs` wrote `EV-DR-RPO` from a
  hardcoded literal carrying the reason *"gcloud is not installed on this machine"*. That was
  false by 2026-08-21 — gcloud is installed, SDK 581.0.0 — and because the record was a
  constant, authenticating would not have changed it. The evidence would have gone on citing a
  blocker that no longer existed, and DR-007 would have stayed `NOT_VERIFIED` for a reason
  nobody could act on correctly.
- **Why it matters**: same class as `TEL-P1-023`. An evidence record that cannot change is not
  evidence, it is an assertion — the exact thing this certification programme exists to reject.
- **Fix**: `scripts/certification/lib/rpoProbe.mjs` asks Cloud SQL and separates the outcomes
  that need different actions from different people: `NOT_INSTALLED` (install it),
  `NOT_AUTHENTICATED` (`gcloud auth login`), `INSUFFICIENT_SCOPE` (the VM service account —
  use Cloud Shell), and `MEASURED`. RPO is derived from the real `backupConfiguration`: PITR
  bounds it at transaction-log durability, backups-without-PITR at the daily interval, and no
  automated backup at all is reported `UNBOUNDED` rather than as an error — that last case is
  the `TEL-P0-002` finding, not a failure to measure. Only `MEASURED` writes `PASS`.
- **Regression test**: `tests/certification-rpo-probe.test.ts`, 18 tests, including that no
  failure path can ever return `MEASURED`.
- **Remaining before VERIFIED**: an authenticated `gcloud` run against the live project.
- **Evidence ID**: `EV-DR-RPO` (still `BLOCKED_EXTERNAL` here — now for the accurate reason)

---

### `TEL-P2-019` — A Windows Batch Shim Would Have Reported gcloud As Absent
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the `TEL-P1-024` probe reporting `NOT_INSTALLED` on a machine where
  `gcloud version` works perfectly from the shell.
- **Root cause**: on Windows `gcloud` is `gcloud.cmd`, a batch file. `spawnSync('gcloud', …)`
  returns `ENOENT` for the bare name, and since the CVE-2024-27980 mitigation Node returns
  `EINVAL` for the `.cmd` unless a shell is used. A probe reading either as "not installed"
  reports a false blocker on every Windows certification workstation — which would have
  reproduced the very defect `TEL-P1-024` was fixing, one layer down.
- **Fix**: `scripts/certification/lib/exec.mjs` retries the `.cmd`/`.bat` shim through a shell
  on `ENOENT`/`EINVAL`. Because the shell concatenates rather than escapes, every argument is
  screened for shell metacharacters first and **refused** rather than quoted-and-hoped-for.
  `.exe` programs — docker, podman, node — never touch this path.
- **Regression test**: `tests/certification-rpo-probe.test.ts` — resolves a real shim, and
  asserts a metacharacter argument throws rather than reaching a shell.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-020` — `scripts/rollback.sh` Was Owned By No Domain
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: `tests/agent-routing.test.ts` failing after `rollback.sh` was modified:
  `unmapped paths — add them to .agent/registry/domains.yaml: expected [ 'scripts/rollback.sh' ]
  to deeply equal []`.
- **Root cause**: `production-release` mapped `scripts/deploy*` but not `scripts/rollback*`, so
  the rollback script — an R4 surface — routed to no domain, no risk class and no target tests.
  It went unnoticed only because nobody had changed the file since the router was built.
- **Fix**: added `scripts/rollback*` to the `production-release` domain.
- **Regression test**: `tests/agent-routing.test.ts` — 32 passed, exit 0.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-025` — Any Branch's Test Fixtures Fail Every Pull Request's Secret Scan
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: PR #100. Every job passed — quality, migrations, e2e, docker,
  dependency-audit, CodeQL, dependency-review — and `CI required checks` still failed:

  ```
  secret-scan          failure    (allowed: success )
  ##[error]secret-scan produced 'failure', which is not an acceptable result.
  ```

- **Root cause**: the finding was not in the pull request. `gitleaks` reported
  `generic-api-key` at `tests/telestar-ai-certification-evals.test.ts:111`, commit `5d46eaa`,
  which is on **`feat/telestar-ai-2`** — a branch the PR neither contains nor touches.
  `actions/checkout` runs with `fetch-depth: 0`, so the clone holds every remote ref, and
  `gitleaks detect --source=/repo` walks the entire object graph rather than the PR's own
  commits. One credential-shaped fixture on any branch therefore fails **every** pull request,
  including ones that never go near it.
- **Why it matters**: the merge gate was unreachable for anybody. This is a stronger version of
  the `TEL-P2-018` finding — there the two blocked jobs were at least excluded from the
  mandatory set; here a **mandatory** check could not pass on any branch.
- **Is anything disclosed?** No, and nothing needs rotation. The flagged line is one row of a
  fixture table asserting that `scrubSecrets` redacts credentials before they reach a log or a
  provider, so it necessarily contains credential-shaped strings. Every value is visibly
  synthetic — `AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R` counts in pairs, the Groq fixture
  runs `ABCdef123456GHIjkl…`, and `AKIAIOSFODNN7EXAMPLE` is AWS's own published documentation
  example. None has ever authenticated anything.
- **Fix**: `tests/telestar-ai-certification-evals.test.ts` exempted in `.gitleaks.toml` by
  **exact path**, matching how `tests/gitleaks-allowlist.test.ts` and `tests/p1-hardening.test.ts`
  are already handled. Not by value, deliberately: `tests/gitleaks-allowlist.test.ts` asserts
  that these very shapes stay detected, because a value exemption would follow the string
  anywhere in the repository.
- **Regression test**: `tests/gitleaks-allowlist.test.ts` — 21 passed, exit 0. Pins both that
  the path is exempt and that the Groq fixture value is still caught elsewhere.
- **Residual risk**: the underlying behaviour is unchanged — a *real* secret committed to any
  branch will still fail every PR, which is correct, and a future fixture on a new branch will
  still need its own path entry. Narrowing the scan to the PR's own commits would weaken it and
  was not done.
- **Evidence ID**: *(none yet — closes on a green `secret-scan` for PR #100)*

---

### `TEL-P2-021` — The Ladder Could Not Read This Project's Own Configuration
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: checking gate 02 before spending a full ladder run on it.
- **Root cause**: `run-full-certification.mjs` loaded configuration with
  `import 'dotenv/config'`, which reads `.env` and nothing else. This repository keeps local
  configuration in **`.env.local`** — the Next.js convention the app, the dev server and
  `agent doctor` all follow — and has no `.env` at all. Measured on the certification
  workstation, gate 02 therefore failed:

  ```
  DATABASE_URL is not set
  REDIS_URL is not set; the Redis-dependent gates cannot run
  AUTH_SECRET is not configured
  ENCRYPTION_KEY is not configured
  ```

- **Why it matters**: run 1 would have failed for an environment-loading reason having nothing
  to do with the candidate, after the long gates had already run. The probe itself was honest —
  it exits 1 on `FAIL`, verified directly rather than through a pipe — so this was never a
  false green, only wasted runs and a misleading first impression of the candidate.
- **Fix**: `scripts/certification/lib/loadEnv.mjs` loads `.env.local` then `.env`, matching
  Next.js precedence, and **never overrides a variable already exported in the shell** so CI —
  which exports everything explicitly — is unaffected. Loaded at module scope, because
  `CERT_PORT` is read into a `const` before `main()` runs. `E2E_PASSWORD` stays deliberately
  operator-supplied: it is run-scoped and `e2e/support/fixture.ts` refuses the published demo
  password, so it is now named in `OPERATOR_SUPPLIED` and reported as missing with the list of
  files that were actually read.
- **Measured after the fix**: gate 02 probe exits **0**, `status: PASS`, `problems: []`.
- **Regression test**: `tests/certification-env-loading.test.ts` — 7 passed, exit 0.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-026` — DR-003 Has No Script That Can Ever Produce A Pass
- **Severity**: P1
- **Status**: `OPEN`
- **Discovered by**: checking that the planned remediation would actually reach GO, before
  spending three ladder runs finding out.
- **Detail**: `DR-003` ("Rollback drill to previous immutable container image") is `mandatory`
  and requires an evidence record of kind `dr-rollback` with status `PASS`. The **only** thing
  in the repository that writes that kind is `scripts/certification/record-blocked-evidence.mjs`,
  which writes `NOT_EXECUTED`. Nothing performs a rollback drill and records the result.
- **Why it matters**: this corrects the remediation plan. Installing a container runtime makes
  gates 19 and 20 real (`TEL-P1-023`) and therefore unblocks `REL-003/004/005` — but it does
  **not** unblock `DR-003`, because there is no drill to run. The ceiling with a container
  runtime alone is **106/108**, not 107.
- **Required remediation**: a drill that observes, rather than asserts: deploy digest A, prove
  the health endpoint reports A's SHA; roll back **by digest** to B and prove health reports
  B's SHA; roll forward to A; record both digests, the command, start and finish, web and
  worker health, schema compatibility, and the measured rollback duration. `scripts/rollback.sh`
  already performs the swap safely — including the guards added as `DEPLOY-001`/`DEPLOY-003` —
  so the drill should drive it rather than reimplement it.
- **Progress — the decisions are written and tested; the orchestration is not.**
  `scripts/certification/lib/rollbackDrill.mjs` holds every rule the drill must satisfy before
  it may record a pass, with no container commands in it. That split is deliberate: the
  decisions are where a drill goes wrong quietly, and they can be tested exhaustively without a
  daemon. The rules it refuses on:

  | Refusal | Why it matters |
  |---|---|
  | rollback onto the same digest | exercises nothing |
  | a drill that never returned to the candidate | leaves production on the old release |
  | phases out of order, or absent | not a rollback |
  | health reporting a different commit than expected | containers swapped, bytes did not |
  | web and worker on different images | the mixed-version state `deploy.sh` exists to prevent |
  | a floating tag anywhere | `latest` is not an identity |
  | a duration that was never measured | this is exactly the withdrawn "38 seconds" |
  | a non-object health body | a proxy 502 is a string, not JSON |

  `status` is **derived** inside `buildRollbackEvidence`, never taken from the caller, so a
  failed drill cannot be written down as a passing one — the `TEL-P0-001` failure mode.

  **Verified with a mutation test, not just a green run**: forcing `evaluateDrill` to always
  return `PASS` fails 7 of the 27 tests. A rule nothing can violate would prove nothing.
- **Remaining**: the orchestration shell that drives `scripts/rollback.sh` through the three
  phases and collects the health responses. It needs a live container runtime to develop
  against; writing it blind would produce a script nobody has run, which is the same class of
  defect this requirement exists to close.
- **Regression test**: `tests/certification-rollback-drill.test.ts` — 27 passed, exit 0.
- **Evidence ID**: `EV-DR-ROLLBACK` (still `NOT_EXECUTED` — no drill has run)

---

### `TEL-P1-027` — Measured RPO Is 24 Hours; DR-007 Requires Under One Hour
- **Severity**: P1
- **Status**: `OPEN`
- **Discovered by**: measuring RPO against the live instance instead of restating a target.
- **Measured**: automated daily backups at 17:00 UTC, 7 retained, **point-in-time recovery not
  enabled**. Worst-case data loss is therefore everything written since the last daily backup —
  up to **86,400 seconds**. `DR-007` is `mandatory` and reads *"Measured RPO under 1 hour"*.
- **Why this is a change, not a restatement**: `DR-007` was previously `NOT_VERIFIED` because
  nothing could measure it. It is now measured, and the measured value **fails** the
  requirement. Authenticating `gcloud` did not turn DR-007 green; it turned an unknown into a
  known failure. That is progress, but it is not a pass, and it must not be recorded as one.
- **Required remediation**: enable point-in-time recovery on `telestar-db`, which bounds
  recovery by transaction-log durability rather than by the backup interval and brings the
  measured RPO within the requirement. `transactionLogRetentionDays` is already 7, so the
  retention side is in place.

  > This is a **production configuration change** and needs explicit operator authorization for
  > that action. It is not covered by any instruction to make certification green. Enabling PITR
  > on Cloud SQL requires a restart on some configurations — confirm the maintenance impact
  > before running it.

  Alternatively, and only as a deliberate decision rather than a default: reduce `DR-007`'s
  threshold to match an accepted business RPO of 24 hours, and record who accepted it. Changing
  a requirement to match the system is normally how certifications become worthless, so it
  should be the operator's explicit call, never the agent's.
- **Evidence ID**: `EV-DR-RPO` — will record `MEASURED` / `DAILY_BACKUP` / `86400`

---

### `TEL-P1-028` — Phase 15 Claims Private VPC Transport; The Instance Has A Public IP And Permits Unencrypted Connections
- **Severity**: P1
- **Status**: `OPEN`
- **Discovered by**: reading the instance's network configuration while measuring RPO.
- **The claim**: `STATUS.md`'s Phase 15, *"Cloud SQL Transport Security"*, is marked
  **🟢 GREEN** with the note *"Cloud SQL transport over private VPC connection."*
- **Measured**:

  ```
  ipv4Enabled        true
  ipAddresses        136.110.29.201 (PRIMARY), 136.110.52.105 (OUTGOING)
  PRIVATE_ADDRESS    none
  authorizedNetworks 34.142.236.46/32
  requireSsl         false
  sslMode            ALLOW_UNENCRYPTED_AND_ENCRYPTED
  availabilityType   ZONAL
  ```

  There is **no private VPC path**. The instance is reachable on a public IP, restricted to one
  authorized address, and the server **accepts unencrypted connections**.
- **What is and is not established**: the *server* permits plaintext and there is no private
  connection — both are measured facts that contradict the phase note. Whether the application
  actually connects with TLS **cannot be determined from this checkout**, because the production
  `DATABASE_URL` lives in `.env.production` on the VM. If it carries `sslmode=require` the
  traffic is encrypted despite the permissive server setting; if it does not, database
  credentials and tenant data cross the network in cleartext. **That check has not been run and
  no claim is made about it here.**
- **Why it matters beyond the misconfiguration**: a phase marked GREEN on a false description is
  the same failure class the whole re-certification exists to correct. `SEC` currently reads
  15/15 verified; none of those tests covers Cloud SQL transport, so the green came from a
  document rather than from evidence.
- **Required remediation**, in order:
  1. Read the production `DATABASE_URL` on the VM and establish whether `sslmode=require` is
     set. Do not print the value; report only whether the parameter is present.
  2. Set `requireSsl` / `sslMode` to encrypted-only on `telestar-db`, once step 1 confirms the
     application will not be cut off by it.
  3. Correct or withdraw the Phase 15 note.

  Steps 2 and 3 touch production and need explicit operator authorization.
- **Evidence ID**: *(none yet)*

---

## 3. Reopened Defects

These were previously marked `VERIFIED`. The evidence supporting that closure does not meet the
closure rule, so they return to `OPEN` under a successor ID.

| ID | Prior claim | Why reopened | Successor |
|---|---|---|---|
| `TEL-P1-011` | Atomic pre-provider budget reservation VERIFIED | Reservation is process-local; not durable, not shared | `TEL-P1-015` |
| `TEL-P1-012` | Streaming attribution + single-probe breaker VERIFIED | Breaker state is process-local; streaming lacks budget/timeout/reconciliation parity | `TEL-P1-016`, `TEL-P1-017` |
| `TEL-P1-013` | End-to-end release identity chain VERIFIED | No image/web/worker/health digest chain exists | `TEL-P1-018` |
| `TEL-P1-009` | Certification source code freeze VERIFIED | Candidate `a6d8c0d` invalidated; re-freeze required after remediation | *(re-freeze)* |
| `TEL-P2-008` | Six-role operational journeys VERIFIED | Browser layer never executed | `TEL-P2-013` |
| `TEL-P2-009` | Backup / restore / rollback drill VERIFIED | Empty-file checksum; nonexistent verification script | `TEL-P0-001` |
| `TEL-P2-010` | Test counts reconciled VERIFIED | Two conflicting authoritative totals in tree | `TEL-P2-014` |
| `TEL-P2-012` | 1,000-row load benchmark VERIFIED | Contradictory published results; handler-only scope | `TEL-P2-015`, `TEL-P2-016` |

---

## 4. Retained Verified Defects

These closures are supported by tests that genuinely exercise the invariant. They are retained
and must be re-confirmed against the **new** candidate SHA once it is frozen (a pass on an
earlier SHA does not certify later behaviour-changing code).

| ID | Description | Verifying test |
|---|---|---|
| `TEL-P1-001` | Import partial-write & crash convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-002` | 120-row import concurrency, zero lost rows | `tests/import-race-stress.test.ts` |
| `TEL-P1-003` | Demo tenant live-email transport barrier | `tests/demo-email-barrier.test.ts` |
| `TEL-P1-004` | Production demo seed password guard | `tests/seed-guard.test.ts` |
| `TEL-P1-005` | Eventual batch commit completion | `tests/import-fault-injection.test.ts` |
| `TEL-P1-006` | Import true failure convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-007` | Concurrent duplicate job delivery idempotency | `tests/import-fault-injection.test.ts` |
| `TEL-P1-008` | Release candidate identity separation | `MASTER_TRACKER.md` |
| `TEL-P1-010` | AI structured output runtime Zod validation | `tests/ai-structured-budget.test.ts` |
| `TEL-P2-001`–`TEL-P2-007` | CSV formula injection, email sanitisation, RLS audit, role permissions, traceability mapping, doc synchronisation, ISO-8601 timestamps | see `EVIDENCE.md` |
| `TEL-P2-011` | Import durable-write failpoint matrix | `tests/import-fault-injection.test.ts` |
