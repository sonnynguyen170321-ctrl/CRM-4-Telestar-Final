# Telestar Revenue AI — STATUS

**Read this first.** Then execute the next unchecked item in [`PLAN.md`](PLAN.md).

| | |
|---|---|
| Phase | **0–6 complete** (6a merged in PR #59, 6b on branch). Next: **Phase 7** — knowledge retrieval and structured research |
| Branch | `feat/phase-6b-agent-execution`, off `main` at the 6a merge (`3e2bfd5`) |
| Blockers | **None.** |
| Restrictions | No external users, no real client data, sending off, email dry-run |

> **Nothing in Phase 6 plans agent work.** `lib/workorders/plan.ts` returns an empty plan by
> design — deciding *which* tools a work order should run is Phase 7 and Phase 8. Phase 6b built
> the machinery that runs a plan safely and stopped there, because a placeholder planner that
> researched or enrolled anything would be autonomous prospect work shipped under a phase whose
> scope excludes it.

> **Phase 6 is one architectural phase reviewed in two parts.** 6a is the durable domain — the
> `WorkOrder` model, the type-declared capability bounds, conflict detection and the execution
> lease. 6b is what executes it. The split is a review boundary, not a design boundary: 6b adds
> no second vocabulary and no second execution path.

> **Every agent tool now runs under capability authorization.** `create_task` — the one
> pre-existing write-capable tool — is mapped to `tasks` and enforced, not grandfathered.
> `executeTool` fails closed on an unregistered tool, on a write capability with no role in
> context, and on anything short of a clean allow.

## Gates — Phase 6b, `feat/phase-6b-agent-execution`

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint app components lib context tests workers` | 0 errors, 0 warnings |
| `vitest run` | **1081 passed, 5 skipped**, 81 files |
| Phase 6b targeted suites | 65 passed (13 SLA · 18 execution · 20 approvals · 9 dispatch · 5 boundary) |
| All work order suites (6a + 6b) | 149 passed |
| `next build` | exit 0 |
| `prisma migrate status` | up to date, **36 migrations** |
| `migrate diff --exit-code` | `No difference detected`, exit 0 |
| Fresh replay into an empty shadow database | clean |

1081 is exactly 65 above `main`'s 1016 — the whole delta is this phase.

### The fixture defect the full suite caught

The Phase 6b suites passed individually and the *full* run failed:

```
Foreign key constraint violated: `AgentAction_userId_fkey (index)`
  at tests/helpers/workOrderFixture.ts → prisma.user.deleteMany
```

`setupWorkOrderFixture` deleted users without first deleting `AgentAction` and
`AgentApprovalRequest`, both of which hold FKs to `User` with **no cascade**. Phase 6a's suites
never created agent rows, so the gap did not exist until 6b's execution and approval suites
started writing them — and it only bites on a run where a *previous* run left rows behind, which
is why every isolated run passed.

This is the same shape as the `bullmq.test.ts` / `rls.test.ts` failures that made CI red while
developer machines stayed green: **a suite that cleans up less than it creates passes until
something runs before it.** Fixed by deleting approvals → actions → AI calls → policies before
users, and re-verified by re-running all eight work order suites against the dirty database the
failed run left behind.

## Phase 6b — what landed, and the two rules that shaped it

**1. Approval is a recorded decision, never a stored permission.** The obvious implementation —
mark the request approved, then let the worker check the flag — turns an approval into a bearer
token for an action whose world has moved on. `resumeApprovedAction` instead re-derives
authorization from scratch on every resume and reads nothing from the request but *which action*
it was about. Five distinct things can still refuse an approved action:

| Refusal | What changed between the click and the run |
|---|---|
| `authorization_changed` | policy tightened to `human_only`, or the role lost the right |
| `insufficient_approval_level` | policy went `approval` → `manager_approval`; a user-level signature no longer covers it |
| `work_order_not_executable` | the order was cancelled, completed or failed |
| `expired` | approval does not stop the clock |
| `rejected` | a human said no |

The level check is the one most likely to be dropped by a future edit, and it is the one that
matters most: an SDR's signature must stop counting the moment the tenant decides that action
needs a manager.

**2. The runtime is the only path to a CRM mutation.** `execution.ts` holds no domain service.
Every step goes through `executeAgentAction`, which is what writes the `AgentAction` ledger,
resolves the capability and enforces idempotency — and the tests assert the *ledger rows*, not a
mock, because a second CRM path would still have called the tool and simply left nothing behind.

The action key is `workorder:{id}:step:{ordinal}:{tool}` — derived from the work order and the
step's position, never the clock. That is what makes three BullMQ retries safe: a redelivered job
finds the completed `AgentAction` and returns its recorded result. A test runs the same plan
twice and asserts the tool was called once.

### The budget guarantee, stated exactly

The check runs *before* each operation and asks "is there anything left", not "will this one
fit" — it cannot ask the second question, because a model call's token cost is unknown until it
returns.

```text
guaranteed   no operation STARTS once a budget is exhausted
not claimed  no operation EXCEEDS the budget
```

A work order can overshoot by at most one operation. That is bounded, visible in the counters,
and the honest description of a pre-flight check on an unknown cost. Reserving a worst-case spend
per call instead would make every budget silently far smaller than the number an operator typed.

A **failed** tool call still spends `maxToolCalls`. Counting only successes would let a retry loop
run unbounded inside its budget, which is the case the limit exists for.

### The boundary guard is transitive

Phase 6a's `next build` proved nothing about `lib/workorders/*` because nothing imported it.
6b gives it routes, so the guard now walks the whole import graph from every `"use client"` file
rather than checking each component's own imports — the realistic failure is
`"use client" panel → @/lib/some-helper → @/lib/workorders/leases`, inherited two hops down.

Two details that make it a real test rather than a green tick:

- **It ignores `import type`.** Its first run reported `types.ts` as a hazard through
  `capabilities.ts → lib/auth → @/lib/prisma` — all type-only imports, erased at build. A
  structural test that cries wolf gets deleted, so the walker now strips erased imports.
- **It carries a control.** One case asserts the walk *does* reach a server-only module from the
  dispatch route. Without it, a resolver silently failing on every specifier would report zero
  offenders and look like success.

## Gates — Phase 6a, `feat/phase-6a-work-orders`

Every row re-run after the fencing work; the earlier `next build` was measured before it and is
void.

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint app components lib context tests` | 0 errors, 0 warnings |
| `vitest run` | **1016 passed, 5 skipped**, 76 files |
| Phase 6a targeted suites | 84 passed — 33 `work-order-bounds` · 24 `work-order-lifecycle` · 27 `work-order-leases` |
| `next build` | exit 0 |
| `prisma migrate status` | up to date, **35 migrations** |
| `migrate diff --from-migrations --to-schema-datamodel --exit-code` | `No difference detected`, exit 0 |
| Fresh replay into an empty shadow database | clean |

1016 is exactly 84 above `main`'s 932 — the whole delta is this phase's tests, so nothing
existing regressed and nothing was quietly skipped. The 5 skips are `tests/redis-integration.test.ts`,
which needs a real Redis and is expected to skip locally.

> **`next build` proves less here than it usually does.** Nothing in `app/`, `components/` or
> `context/` imports `lib/workorders/` yet — 6a is domain services only — so the build exercises
> none of this code's client/server boundary. `leases.ts` imports `node:crypto`, which would fail
> a client bundle. That risk arrives with 6b's API routes, and the build gate only becomes
> meaningful for these modules at that point.

## Phase 6a — what landed, and the three decisions that shaped it

Five modules under `lib/workorders/`, two models, one migration.

**1. The work order bound subtracts and cannot add.** `decideWorkOrderCapability` has exactly
one permitting branch, and all it does is return `decideCapability`'s answer verbatim — there is
no path in that file that constructs an `ALLOW`. So "a work order can never widen agent
autonomy" is a property of the control flow rather than a rule someone has to remember.

The test checks it exhaustively over **4,320** combinations:

```text
9 work order types × 16 AgentCapabilities × 6 CRM roles × 5 stored modes = 4,320
```

Five modes, not four: `null` — "this tenant has stored no policy" — sits alongside `auto`,
`approval`, `manager_approval` and `human_only`, and it is the state every tenant starts in. No
capability is excluded from the matrix; `place_call`, `prospect_reply` and `call_assistance` are
in it precisely because the subtractive property is strongest where the capability is forbidden.
The iteration-count assertion multiplies the four vocabulary lengths rather than naming a
number, so any of them growing widens the matrix instead of leaving a hole in it.

> **Correction.** An earlier revision of this file said 2,700. That figure was never computed —
> the assertion in the test was always derived from the vocabularies and always covered all four
> axes in full. Only the prose was wrong.

`prospect_reply` and `place_call` are locked twice over: they appear in no type's set, *and*
`CAPABILITY_CEILING` pins them to `human_only`. The set of forbidden capabilities is derived
from the ceiling rather than restated, so raising something to `human_only` in
`lib/agent/capabilities.ts` bars it from every work order type automatically.

**Every capability now carries an explicit prospect-effect classification.**
`CAPABILITY_PROSPECT_EFFECT` is a total `Record<AgentCapability, ProspectEffect>`, so adding a
capability **fails the build** until it is classified. The previous shape was a `Set` of the
touching ones, which silently defaulted every future capability to `internal` — failing *open*,
on the classification that decides whether a human-owned prospect may be touched. Writing it out
also corrected one: `place_call` is `touches_prospect` (the prospect's phone rings), while
`call_assistance` stays internal. `PROSPECT_TOUCHING_CAPABILITIES` is derived from the
classification, and `isProspectTouching(type)` from that — one source, two derivations, no
hand-maintained second list.

**2. "Competing" is narrower than "both running".** Blocking any second order on a lead would
make `human_managed` mean "AI off", which ARCHITECTURE §4.3 says it does not. Two orders compete
only when **both can reach the prospect** — so a `reply_review` summarising a thread runs happily
alongside an `outreach_launch`, on an actively enrolled lead, and on a human-managed prospect.
`isProspectTouching` is derived from the capability set rather than declared as a second list:
a hand-maintained list would eventually disagree with the sets, and it would disagree by failing
*open*, on the check that decides whether a human-owned prospect can be touched.

**3. Exclusivity is a constraint, and holds are fenced.** `WorkOrderLease` carries
`@@unique([tenantId, leadId])`, so two concurrent claimants cannot both observe "free" and both
insert — the second's compare-and-set re-evaluates against the first's committed row. A
service-side check with no constraint behind it would be a race under exactly the conditions
leases exist for. The losing claimant is caught at `P2002` and returned as `held_by_other` with
the holder named, so a race never surfaces as a raw Prisma error. Only `exclusive`-mode orders
claim; assistance work takes no lease and is blocked by none.

**`claimToken` fences a superseded holder.** Minted fresh on every claim and reclaim, preserved
across renewals, and required by `renewLease`, `releaseLease` and `holdsLease`. `workOrderId`
alone is not sufficient, and the case it misses is not two different orders — it is **two
attempts at the same order**:

```text
worker 1 claims for order X   →   stalls   →   lease expires
worker 2 retries order X      →   reclaims
worker 1 wakes up             →   its workOrderId still matches
```

A `workOrderId`-only predicate would let worker 1 renew or release a lease it no longer holds,
and report itself as the holder. Both stale-holder cases carry regression tests — cross-order
and same-order-retry — asserting all three verbs fail for the superseded token while the
successor's still works. Re-activating an already-active order rotates the token too, so a
restarted worker supersedes its own prior attempt rather than sharing a hold with it.

`releaseLeasesForWorkOrder` is deliberately the one unfenced writer: it is the order-ending
unwind, and once an order reaches a terminal status no attempt at it may still execute, so
"which attempt holds the row" stops being a question. Fencing exists to stop a superseded worker
acting — not to stop the order itself from ending.

**Still not claimed: that the previous holder has stopped working.** A partitioned process can
be mid-tool-call when its lease expires. Fencing stops it touching the lease; it does not undo a
tool call already in flight. Durable idempotency in `AgentAction`, not the lease, is what stops a
CRM mutation happening twice.

**What a lease is not.** Nothing in `lib/workorders/leases.ts` reads or writes
`Lead.assignedToId` or `Lead.operatingState`, and the tests assert the lead row is byte-identical
before, during and after a full claim → release → complete cycle, and that no `ProspectTransition`
is written. CRM ownership, operating responsibility and execution ownership stay three
independent things.

**Not claimed: exactly-once.** A lease is a time-bounded hold with a deterministic recovery rule
(`live ⟺ releasedAt IS NULL AND expiresAt > now`, applied identically by the claim path, the
conflict check and the sweep). It does not prove the previous holder has stopped — a partitioned
process can still be mid-tool-call when its lease expires. Durable idempotency in `AgentAction`,
not the lease, is what stops a CRM mutation happening twice.

### The migration ordering defect replay caught

The generated migration was timestamped `20260810053420`, which sorts **before**
`20260810180000_prospect_operating_state` and `20260811000001_agent_action` — the tables its new
foreign keys reference. It applied cleanly to the local database, where those tables already
existed, and `migrate status` stayed green throughout. A fresh replay failed immediately:

```
Migration `20260810053420_work_order_phase6a` failed to apply cleanly to the shadow database.
Error code: P1014
The underlying table for model `ProspectTransition` does not exist.
```

Renamed to `20260811010000_work_order_phase6a`. This is the same lesson as the Phase 5 BOM:
**replay is the only gate that sees migration-ordering and migration-encoding faults**, and
neither `migrate status` nor `tsc` nor Vitest can substitute for it.

Prisma made the same mistake a second time when generating the fencing migration
(`20260810055927`, again sorting before the table it alters). Renamed to
`20260811020000_work_order_lease_fencing`. **Prisma timestamps a migration when you generate it,
not relative to the migrations already on disk** — so any branch whose migrations were authored
with dates ahead of the wall clock will keep producing this, and every generated migration on
this repository needs its name checked against the tail of `prisma/migrations/` before it is
applied.

**Migration count is 35, not 34.** The fencing work adds one.

### Why the migration clears legacy `workOrderId` values

`20260811010000` nulls `ProspectTransition.workOrderId`, `AgentAction.workOrderId` and
`AiCall.workOrderId` before adding the foreign keys, and this is intentional rather than
incidental cleanup.

Those three columns were introduced in Phases 3, 5 and 1 as loose nullable `TEXT`, each
explicitly annotated *"set once typed work orders exist (Phase 6). No FK until the model does."*
**There has never been a `WorkOrder` table**, so no value any of them holds can denote a valid
`WorkOrder` reference — the table they would point into is created by this same migration, empty.
Every existing value is dangling by construction, and each `ALTER TABLE … ADD CONSTRAINT` fails
with a foreign key violation without the cleanup.

No production data is affected: nothing outside test fixtures ever wrote those columns, and the
fixtures used placeholder ids such as `wo-1`. Phase 6a is the first real producer.

The fencing migration adds `claimToken` nullable, backfills with `gen_random_uuid()`, then sets
`NOT NULL` — rather than `ADD COLUMN … NOT NULL` in one step, which fails on any non-empty table.
`WorkOrderLease` is empty in every deployed environment, but a migration that only replays
against an empty table is one that fails the first time it meets a developer's database.

### The budget contract 6b must implement against

6a validates and stores the four budgets; 6b enforces them and writes the counters. The units are
fixed **now**, in `lib/workorders/types.ts`, so 6b does not get to invent them — a counter that
measures a different quantity than the limit was set against is a budget that silently does not
work.

| Field | Unit | Counted as | Consumption source in 6b |
|---|---|---|---|
| `researchBudget` | billable research operations | 1 per web search, 1 per page fetch | `AiCall.searchCredits` summed over the work order |
| `tokenBudget` | provider tokens | `promptTokens + completionTokens` per round trip | `AiCall.totalTokens` summed over the work order |
| `maxToolCalls` | tool invocations | 1 per `executeTool` entry, **success or failure** | `AgentAction` rows for the work order |
| `maxExecutionDuration` | **seconds** | wall clock from `WorkOrder.activatedAt` | `now − activatedAt` |

Three readings that would be wrong:

- **A failed tool call still spends `maxToolCalls`.** Counting only successes would let a retry
  loop run unbounded — the exact case the limit exists for.
- **Tokens are per provider round trip, not per SDR exchange.** One tool-calling conversation
  produces several `AiCall` rows by design (Phase 1); the budget sums them.
- **Duration is wall clock from first activation, not accumulated running time.** A pause/resume
  cycle does not refund it, which is why `activatedAt` is set once.

### Deliberately not built in 6a

- **Consumption counters** (`researchUsed`, `tokensUsed`, `toolCallsUsed`). 6b enforces budgets
  incrementally and is what will write them; a column nothing writes is not worth adding early —
  the same reasoning that kept `playbookVersionId` off its dependants until Phase 6 existed to
  write it. 6b adds them in its own migration.
- **API routes and UI.** 6a is domain services only. Routes land with 6b's execution path.
- **Anything that enqueues.** The `agent` queue is 6b's, with work order execution as its first
  real producer.

## Gates — regenerated 2026-08-10 at the rebased Phase 5 HEAD

Every row below was re-run after the rebase. The previous table in this file was measured on
`feat/campaign-playbook` and did **not** describe the Phase 5 branch: at the rebased HEAD the
branch had 16 `tsc` errors and a migration that could not replay. Both are fixed here.

| Gate | Result |
|---|---|
| `next build` | exit 0 |
| `tsc --noEmit` | 0 errors |
| `eslint app components lib context tests` | 0 errors, 0 warnings |
| `vitest run` | 932 passed, 5 skipped, 73 files |
| `prisma migrate status` | up to date, 33 migrations |
| `migrate diff --from-migrations --to-schema-datamodel --exit-code` | `No difference detected`, exit 0 |

## Phase 5 — what the rebase verification found

Four defects, none introduced by the rebase — the branch had never compiled against a `main`
carrying Phase 4:

- **A duplicated block in `ChatContext`** (`leadId`/`userName`/`userRole`/`overdueTasks` declared
  twice) — 8 of the 16 errors.
- **`campaign.description` does not exist.** The authoritative-context select asked for it, which
  invalidated the whole select and cascaded into 5 more errors. Removed rather than synthesised
  from `targetVertical`/`targetGeo`: those mean something else, and handing the model a
  "campaign pitch" assembled from the wrong columns is worse than having none.
- **`SessionUser.tenantId` is optional**, and the ledger key is not. Resolved by refusing before
  the lookup — a default tenant would have written an `AgentAction` row, and possibly a CRM
  mutation, under a tenant nobody proved.
- **`Message` carried no `executionId`** though the send path read one, so the idempotency
  namespace was never actually client-carried. The field is on the type now, minted once per
  logical turn and reused when the same message is resent after a failure.

Plus a **UTF-8 BOM** on `20260811000001_agent_action/migration.sql`: Postgres rejected the first
statement with `syntax error at or near "﻿"`, so the migration could not replay into a fresh
database. Local `migrate status` was clean throughout — replay is the only gate that sees this.

## Phase 3 — what landed, and the one narrow exception

Four transition services, one `applyTransition` primitive that owns ledger + state + activity,
and a `ProspectTransition` table whose unique key identifies **one occurrence** rather than
`(lead, kind)` — see ARCHITECTURE §4.2a for why the coarser key would permanently block a
prospect's second genuine handoff.

**The narrow legacy-cache exception.** `handleApplyReply` gated the whole automatic-handoff path
on `Lead.sequenceStatus`, the compatibility cache. A stale value there could drop a real prospect
reply before `handoffProspectToHuman()` was ever reached. That one reader moved to the
authoritative enrollment, resolved once in the reply path. **No broader sweep** — unrelated
readers stay scheduled for the deprecation, and nothing downstream re-interprets sequence state.

`pauseSequence` now returns `paused | already_paused_or_stopped | no_sequence` instead of `void`.
A reply from a prospect with no active sequence is still a real handoff, so `no_sequence` must
not read as failure — while a genuine database error still throws rather than being inferred
from a missing side effect.

**The ledger claims, it does not certify.** `pending → state_applied → completed`, and a retry
that finds a non-completed row resumes rather than reporting a permanent no-op. The earlier
design treated the row's existence as success, which meant a crash between the insert and the
state write stranded the prospect with manual repair the only way out. A resume skips the
`fromStates` guard — the lead has already moved, and re-checking would turn recovery into a
permanent error.

**Two guarantees, not one.** State this precisely or it will be believed:

```text
ProspectTransition lifecycle    resumable and convergent
Individual business effects     at-most-once claimed, with a detectable repair window
```

An effect is claimed before it runs, so a crash in between leaves it unperformed while the
transition still reaches `completed`. **Not exactly-once.** Accepted for this phase because it
is bounded, detectable and repairable — ARCHITECTURE §4.2a lists the expected effect set per
kind and the query that finds a `completed` row missing one. That query is the entire
manual-repair surface.

## Phase 4 — the authority split that shaped it

`CampaignLeadRequirement` already owned ICP — target titles, countries, industries, company
size, required fields — with delivery counters and its own lifecycle. Putting ICP in the
playbook would have created two definitions that can disagree, which is worse than one. So:

```text
CampaignLeadRequirement   who leadgen should source, and what qualifies
CampaignPlaybookVersion   how approved outreach should operate
CRM / automation services execution and enforcement
```

The zod contract is `.strict()`, so an `icp` key is **rejected**, not ignored — stronger than a
convention that it should not be there.

Attribution is by activation window in Phase 4: `[activatedAt, supersededAt)` half-open, with
supersession stamped at the same instant as activation so the windows tile with no gap and no
overlap. Phase 6 adds explicit `playbookVersionId` columns once work orders exist to write
them; a column nothing writes is not worth adding early.

The activation swap is not transactional — Neon HTTP has no interactive transactions and the
`$extends` wrappers defeat array batching, the same constraint that shaped
`lib/admin/transferWork.ts`. It is ordered, idempotent, and its intermediate state is
detectable: `detectActivationDrift` finds a playbook whose pointer disagrees with its version
rows, and re-running `activateVersion` repairs it. Supersede-then-activate is deliberate — a
crash leaves *no* active version rather than two, and two would silently mis-attribute every
event in the gap.

**The migration drift gate is now required** for any change to `schema.prisma` or migration
SQL — `migrate status` + `migrate diff --from-migrations --to-schema-datamodel --exit-code`
against a shadow database. Phase 3 shipped three migration-only indexes and CI caught them; the
local gate set had no drift check at all, which is why it took a red PR to find.

**Not solved, and not claimed:** reply dedupe remains stage-based and coarse (ARCHITECTURE
§4.2b). Handoff idempotency is independent of `Lead.stage` by design.

## Phase 2 — the two rules that make it hold

**A stored policy can only ever make the agent stricter.** `CAPABILITY_CEILING` caps what a row
may loosen, and resolution is ceiling → stored → default with *strictest wins*. Without that
ordering, a tenant setting `prospect_reply: auto` would reopen Level 4 autonomy through a
settings page. It is denied for all four modes across all six roles, and a test says so.

**CRM role authorization runs first and independently.** `CAPABILITY_ROLE_REQUIREMENT` is
checked before policy is consulted, so `send_window_change` set to `auto` for the SDR role
still returns `denied / role_not_permitted` — autonomy cannot grant what
`lib/sequences/permissions.ts` withholds. Autonomy restricts; it never widens.

> **`next build` is a required gate** for any phase touching shared imports, routes, provider
> code, the server/client boundary or app wiring; Docker build too for runtime/deployment
> phases. Phase 1 is why: it shipped with tsc at 0 and Vitest at 820 passing, and CI still went
> red because a Client Component's import chain reached `lib/prisma`. Bundling failures are
> invisible to every gate that finishes in seconds. And CI counts as green only when GitHub
> reports each required check successful — a watcher exiting 0 proves nothing.

## Phase 1 — what landed

**Cost fields recorded per provider round trip** (`AiCall`): `tenantId`, `userId`, `leadId`,
`workOrderId`, `operation`, `provider`, `model`, `promptTokens`, `completionTokens`,
`totalTokens`, `searchCredits`, `latencyMs`, `estimatedCostUsd` (Decimal 12,6), `status`,
`errorCode`, `createdAt`.

Three design choices worth keeping:

- **One row per round trip, not per exchange.** A tool-calling conversation spends its tokens
  across several calls; aggregating at write time would lose which one spent them.
- **Failures are recorded, and rate limiting is its own status.** A failed call still cost
  latency, and `rate_limited` is a budget signal rather than a bug.
- **Recording never throws and never invents a tenant.** `usage.ts` runs inside the AI request
  path, so a throw would surface as a broken answer; a row with no tenant is worse than a gap
  because it looks like data.

**The AI-optional guarantee is asserted twice, deliberately.** `tests/ai-optional.test.ts` is
structural — no core CRM module may import `lib/ai` or a provider SDK — and covers paths nobody
has written yet. `tests/ai-down-resilience.test.ts` is behavioural: keys removed, outbound HTTP
refusing, and the named subsystems still run. The structural test is the stronger one; a
property held only by accident is one a single import statement removes silently.

Writing it surfaced a real misfiling: `lib/ai/scoring.ts` had no imports and no provider
references — deterministic CRM logic living under the AI tree, making two lead routes look
AI-dependent. Moved to `lib/leads/scoring.ts` rather than allowlisted.

## What exists today

Almost nothing of this initiative — which is good news for sequencing, since there is nothing
to migrate.

| Concept | Reality |
|---|---|
| Agent runtime, work orders, playbooks, autonomy, `NextBestAction`, `ProspectOperatingState` | **None.** No matches anywhere in the codebase. |
| AI layer | 4 tools — `search_web`, `visit_page`, `create_task`, `get_my_tasks` in [`lib/ai/tools.ts`](../../lib/ai/tools.ts). 649 lines TS plus a 434-line `sdr-skills.md`. Routes: `ai/{briefing,chat,memory,onboarding}`. |
| Model routing | [`lib/ai/provider.ts`](../../lib/ai/provider.ts) — Groq `llama-3.3-70b-versatile` default, Gemini fallback. **Records no cost.** |
| Lead scoring | [`lib/ai/scoring.ts`](../../lib/ai/scoring.ts) exists — the deterministic half of hybrid prioritization is already there |
| Account vs contact split | `Account` and `Contact` models exist, `Lead.accountId` → `Account`. Research caching needs no new modeling. |
| Automation engine | Complete — see [`../automation-engine/STATUS.md`](../automation-engine/STATUS.md). Sits exactly where ARCHITECTURE §2 puts it. |

## Phase 0 — what was actually wrong

`SequenceEnrollment.pausedReason` had three vocabularies and they overlapped on two values:

- **Writer**: `pauseSequence` declared `'replied' | 'bounced' | 'meeting_booked' | 'manual'`
- **Reader**: the lead panel's own label map keyed on the eight-value automation vocabulary
- **Declared**: `lib/automation/types.ts` and the schema comment — the reader's eight

So a reply-paused enrollment stored `replied`, missed every key in the map, fell through the
`??`, and rendered **"Paused — replied"** — the raw token. `tests/lifecycle-integration.test.ts`
pinned the writer's spelling, so the suite was green on the wrong vocabulary.

Two further gaps found while fixing it:

- `pauseSequencesBulk` wrote no `pausedReason` at all, so admin bulk-pauses were the only runs
  the panel could not explain. It now writes `manual`; the admin's free text stays on
  `Task.outcome`, where it already was.
- `'bounced'` collapsed hard and soft bounces into one token that suppression semantics apply
  to only half of. The bounce path already knew which it was and now says so.

The type, the labels and the normalizer live in one file so the next divergence cannot compile.
`normalizePausedReason` runs at the single write site, which is what makes an in-flight BullMQ
job carrying the old payload harmless.

## Phase 3 state-model decision — settled 2026-08-09

**`SequenceEnrollment` is authoritative for sequence execution state.** Full record in
[ARCHITECTURE §4](ARCHITECTURE.md). Summary:

- Three distinct axes: `Lead.stage` (sales lifecycle) · `SequenceEnrollment.status` +
  `nextActionAt` / `pausedReason` / `currentStep` (execution lifecycle) ·
  `ProspectOperatingState` (who or what is responsible now). None derivable from another.
- `Lead.sequenceStatus` is **legacy compatibility cache**, not truth. It survives because the
  current CRM depends on it: 15 files, ~25 write sites, ~20 read sites, nothing constraining it
  to agree with the enrollment. Where the two disagree, the enrollment is right.
- **No new reader, no new writer** of `Lead.sequenceStatus`. Phase 3 acceptance test 6 is a
  ratchet on the reader count, not a demand to rewrite the existing ones.
- Deprecation path is five steps and documented; it is not scheduled, deliberately. Step 3
  benefits from the `(status, nextActionAt)` index the automation engine already added.
- Transitions run through four domain services — `handoffProspectToHuman`,
  `markReengagementEligible`, `handbackProspectToAI`, `startAIReengagement` — each owning its
  Task, Notification, Activity, WorkOrder and cache-refresh consequences. No route, tool or
  worker writes the state column.
- `markReengagementEligible` is **inert by design**: a badge and a recommendation. Acceptance
  test 3 spies on sequence, enrollment, task, outbound and queue writes and requires zero.
- Handback creates a **new** approved follow-up workflow. Restarting the prior cold sequence is
  prohibited (acceptance test 4).

## Sequencing rationale

Two phases are ordered earlier than the original proposal had them, on purpose:

- **Cost attribution before any dashboard.** The Director surface quotes cost per meeting.
  Nothing records spend today, so that number cannot exist until `provider.ts` captures it.
- **Autonomy before any write-capable tool.** Retrofitting a permission model onto tools that
  already write is how a policy flag ends up ignored by four code paths.

Level 4 autonomy — AI-managed two-way prospect conversations — is out of scope for this plan
entirely, not a later phase of it. `prospect_reply` stays `human_only` throughout.

## The two rules most likely to be violated by accident

**Handback is a human action.** Handoff to the SDR happens automatically on a Class C reply;
the return trip does not. Ghost detection makes a lead *eligible* and says so — it never
enrolls anyone. Any code path that can move a lead out of `human_managed` without an explicit
SDR action is a defect, and Phase 3 carries a test for exactly that.

**No capability gets a twin.** [ARCHITECTURE §9](ARCHITECTURE.md) is the reuse map: tenancy,
permissions, sequence lifecycle, scheduling, sending, deliverability, inbound, queues, audit,
tasks, meetings, opportunities, leadgen pool, reporting and the campaign-member impact gate all
already exist and already enforce rules. An agent capability wires to one of them or it is
wrong. When a capability appears to need its own path, the existing service needs a parameter —
not a second implementation. The management surfaces in Phase 9 are presentations of
`client-reports`, `sequences/analytics`, `email-health` and `leadgen/metrics`; if a number
cannot be sourced there, extend that module.
