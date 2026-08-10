# Telestar Revenue AI — Plan

> Contract: [`ARCHITECTURE.md`](ARCHITECTURE.md). Resume pointer: [`STATUS.md`](STATUS.md).

## The model this plan builds

```text
AI          does the repetitive prospecting work
SDR         does the selling
Managers    manage exceptions and performance
CRM         keeps everything connected and controlled
Automation  schedules and sends, safely
```

Ownership changes hands twice per prospect, and only one of those transitions is automatic:
a meaningful reply moves a lead to the SDR; **only the SDR moves it back.** The full loop is
[ARCHITECTURE §4a](ARCHITECTURE.md).

Ten phases, reshaped from a twenty-item proposal, because phases 13–20 of that list all
depended on 3–12 landing and none was independently shippable. Each phase below ends in
something a user can use or a test can assert.

## Rules that bind every phase

1. **Gates stay green** — `tsc --noEmit`, `eslint app components lib context tests`,
   `vitest run`, and the automation E2E specs.

   **`next build` is a required completion gate** for any phase touching shared imports,
   Next.js routes, provider code, the server/client boundary, or application wiring. It is not
   optional and not "CI will catch it": the fast gates cannot see bundling failures. Phase 1
   shipped a provider import that pulled `async_hooks`/`dns`/`net` into the browser bundle
   with tsc at 0 errors and Vitest at 820 passing — CI went red on Docker build and
   Build·Playwright, not on anything runnable in seconds.

   **Docker build joins the gate** for phases that affect runtime or deployment: worker code,
   Dockerfile, dependencies, environment contracts, or anything the always-on host runs.

   **Any phase touching `schema.prisma` or migration SQL must additionally pass the drift
   gate**, locally, before pushing:

   ```bash
   node node_modules/prisma/build/index.js migrate status
   node node_modules/prisma/build/index.js migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5432/telestar_shadow" \
     --exit-code
   ```

   `migrate diff` replays every migration into a fresh shadow database and compares the result
   to the datamodel. **A migration-only index or constraint is not acceptable** unless the
   datamodel represents the same final schema: it survives only until someone regenerates a
   migration from the schema, at which point it silently disappears and a query plan changes
   under a table nobody is watching. Phase 3 shipped three such indexes and CI caught them.

   **CI is green only when GitHub reports each required check successful.** A watcher process
   exiting 0 is not evidence — read the individual check states.
2. **Nothing gets a twin.** Each phase's acceptance includes: the capability is wired to a
   service in the [reuse map](ARCHITECTURE.md) and adds no parallel CRM, sequence, email,
   permission, tenancy, audit or reporting path.
3. **Existing behaviour is preserved.** Tenant boundaries, role permissions, the campaign-member
   impact gate, suppression, quota and mailbox-health guards, and the current SDR workflows
   keep working exactly as they do now. A phase that changes one of them is a bug in the phase.
4. **AI is additive.** Every phase must leave the CRM fully functional with the AI subsystem
   switched off.

---

## Phase 0 — Vocabulary normalization ✅ complete

Prerequisite: the pause vocabulary the whole lifecycle reads had diverged three ways.

- [x] One `PausedReason`, one `PAUSED_REASON_LABELS`, one `normalizePausedReason` at the single
      write site — [`lib/automation/types.ts`](../../lib/automation/types.ts)
- [x] Bounce callers distinguish `hard_bounce` from `soft_bounce`
- [x] `pauseSequencesBulk` writes `pausedReason: 'manual'` (it previously wrote none)
- [x] `LeadDetailPanel` renders the shared map; `20260809230000_normalize_paused_reason` remaps
      existing rows

**Acceptance:** a reply-paused enrollment renders "Paused — prospect replied". Pinned by
`tests/lifecycle-integration.test.ts` 1, 1b, 2, 2b.

---

## Phase 1 — Cost attribution + proof that AI is optional ✅ complete

- [x] `AiCall` model + `20260810000000_ai_call_attribution` — tenant, user, lead, work order,
      operation, provider, model, prompt/completion/total tokens, search credits, latency,
      estimated cost, status, error code
- [x] `lib/ai/pricing.ts` — one rate table, per-model and per-call. Unknown model returns
      `null` rather than a guess
- [x] `lib/ai/usage.ts` — the only writer of `AiCall`. Never throws into the caller; skips the
      write when there is no tenant rather than inventing a placeholder
- [x] Instrumented every provider round trip: the Groq tool-calling loop (one row per
      iteration), the Groq tool-less retry, Gemini (recorded after the stream drains, where its
      usage metadata appears), Tavily and Jina
- [x] `tests/ai-optional.test.ts` — structural: no core CRM module imports `lib/ai`, no core
      module imports a provider SDK, `recordAiCall` is confined to the AI layer
- [x] `tests/ai-down-resilience.test.ts` — behavioural: every provider key removed and outbound
      HTTP refusing; scheduling, eligibility, reply pause, due-date computation and lead scoring
      all still execute, with no outbound request attempted
- [x] `lib/ai/scoring.ts` → `lib/leads/scoring.ts` — deterministic CRM logic that was misfiled
      under the AI tree and made two lead routes look AI-dependent
- [x] `lib/ai/models.ts` — the import-free client-safe model catalog, split out of
      `provider.ts` after the first push broke the browser bundle. Boundary recorded as
      ARCHITECTURE §10 and held by two regression tests.

**Acceptance met:** cost is queryable by tenant, user, operation, provider and work order.
The CRM has no static dependency on `lib/ai` and none can be added without failing a test. No
new reporting pipeline — these rows feed `client-reports` in Phase 10.

---

## Phase 2 — Capability-based autonomy ✅ complete

Landed **before** any new write-capable tool, and brought the one that already existed under
the policy rather than grandfathering it.

- [x] 14 capabilities in [`lib/agent/capabilities.ts`](../../lib/agent/capabilities.ts), split
      into assistance, CRM writes and outreach
- [x] `AutonomyPolicy` per tenant × role × capability →
      `auto | approval | manager_approval | human_only`, with
      `20260810120000_agent_autonomy_policy`
- [x] Defaults: assistance and low-risk writes `auto`; `sequence_enroll` and
      `reengagement_activate` `approval`; `send_window_change` `manager_approval`;
      `prospect_reply` `human_only`
- [x] **`CAPABILITY_CEILING`** — a stored row can only ever make the agent *stricter*.
      `prospect_reply` is `human_only` in every tenant, for every role, at every setting
- [x] Single enforcement point,
      [`lib/agent/authorization.ts`](../../lib/agent/authorization.ts): resolution is ceiling →
      stored policy → default, strictest wins, in one function
- [x] CRM role authorization runs **first and independently** —
      `CAPABILITY_ROLE_REQUIREMENT` denies before policy is consulted, so a policy row cannot
      grant an SDR the send-window right that `lib/sequences/permissions.ts` withholds
- [x] `executeTool` authorizes every call, fail-closed three ways: unregistered tool refused,
      write capability with no role refused, anything short of a clean `allow` stops the call
      and tells the model to say so rather than imply success
- [x] `create_task` — the pre-existing write-capable tool — mapped to `tasks` and enforced

**Acceptance met:** a capability resolving to `approval` cannot write. `prospect_reply` is
denied for all four modes × all six roles. Role denial beats a permissive policy in both
directions. Existing role gates deny exactly what they denied before.

---

## Phase 3 — State model ✅ complete

**Decision recorded in [ARCHITECTURE §4](ARCHITECTURE.md).** `SequenceEnrollment` is
authoritative for execution state; `Lead.sequenceStatus` is a legacy compatibility cache with a
documented deprecation path; `ProspectOperatingState` is a separate axis for responsibility.

- [x] `ProspectOperatingState` enum + `Lead.operatingState` / `operatingStateAt`, migration
      `20260810180000_prospect_operating_state` with a conservative backfill — `completed` for
      won/lost, `human_managed` for replied/meeting_booked, `ai_managed` where an active
      enrollment exists, `unassigned` for everything else. Nothing is *guessed* into an
      AI-owned state.
- [x] `ProspectTransition` ledger with `@@unique([tenantId, transitionKey])`
- [x] `applyTransition` primitive owning ledger + state + activity, so a caller cannot
      half-apply a transition; caller consequences run in `onApplied`, only when new
- [x] The four services in [`lib/prospects/ownership.ts`](../../lib/prospects/ownership.ts)
- [x] Four dedicated `ActivityType` values rather than overloading unrelated events
- [x] **Narrow legacy-cache exception:** `handleApplyReply` now gates on the authoritative
      enrollment instead of `Lead.sequenceStatus`. Resolved once in the reply path; nothing
      downstream re-interprets sequence state. No broader sweep in this phase.
- [x] `pauseSequence` returns `paused | already_paused_or_stopped | no_sequence` instead of
      `void`, and throws on real failure. `no_sequence` is **not** a failed handoff.

### Acceptance tests

| # | Assertion | Where |
|---|---|---|
| 1 | Every transition is reconstructible from the activity feed | `applyTransition` writes one per transition |
| 2 | Nothing leaves `human_managed` without an explicit SDR action | handback requires a human actor; `startAIReengagement` only from `ai_reengagement` |
| 3 | `markReengagementEligible` creates no sequence, enrollment, task, outbound or queue job — asserted by spying on all five | `prospect-operating-state.test.ts` |
| 4 | `startAIReengagement` refuses to reuse the prior cold sequence | `ColdSequenceRestartError` |
| 5 | `handbackProspectToAI` refuses from an AI-owned state | `TransitionNotAllowedError` |
| 6 | New execution-state reads use `SequenceEnrollment`; no new `Lead.sequenceStatus` reader | reply path now selects no `sequenceStatus` |
| 7 | A stale cache cannot drop a real reply | cache says paused, enrollment says active → handoff still happens |
| 8 | Idempotency is per occurrence, not per (lead, kind) | retry inert; concurrent duplicate loses the unique-constraint race; a later event still applies |

### Acceptance tests

| # | Assertion |
|---|---|
| 1 | Every operating-state transition is reconstructible from the activity feed alone. |
| 2 | No code path moves a lead out of `human_managed` without an explicit SDR action. |
| 3 | `markReengagementEligible` creates **no** sequence, enrollment, task, outbound message or BullMQ job. Asserted by spying on all five, not by inspecting the result. |
| 4 | `startAIReengagement` never re-enrolls the lead's prior cold sequence — the enrollment it creates references the new re-engagement sequence. |
| 5 | `handbackProspectToAI` refuses when CRM state or permissions disallow it, and creates the work order in a state requiring approval rather than an active one. |
| 6 | Every new query about execution state reads `SequenceEnrollment`. A repo-level check asserts the count of `Lead.sequenceStatus` readers does not grow — a ratchet, not a rewrite. |
| 7 | With an enrollment paused and `Lead.sequenceStatus` deliberately set to a disagreeing value, all new logic follows the enrollment. |
| 8 | During `human_managed`, an assistance capability (summarize, draft, objection help, meeting prep) succeeds while every prospect-facing capability is refused. |

---

## Phase 4 — CampaignPlaybook + versioning ✅ complete

- [x] `CampaignPlaybook` — stable identity per campaign, holding no policy
- [x] `CampaignPlaybookVersion` — immutable snapshot; `draft | approved | superseded`,
      `createdBy`, `approvedBy`/`approvedAt`, `activatedAt`/`supersededAt`
- [x] `lib/playbooks/policy.ts` — typed, `.strict()` zod contract at the domain boundary:
      research depth, allowed channels, per-situation ghost thresholds, handoff SLA,
      send-window policy, reply handling
- [x] `lib/playbooks/versions.ts` — one service owning draft / approve / activate / supersede,
      plus `versionActiveAt` and `detectActivationDrift`
- [x] Ghost thresholds are per-situation policy: positive reply waiting ≠ proposal sent ≠
      meeting no-show ≠ post-demo. **No constant existed anywhere to migrate** — searched every
      numeric constant and ghost/stale/follow-up identifier in `lib/`, `workers/`, `app/api/`.

> **The playbook does not define ICP.** `CampaignLeadRequirement` already owns target titles,
> countries, industries, company size and required fields, with delivery counters and its own
> lifecycle. Restating ICP would create two definitions that can disagree — worse than one. The
> zod contract is `.strict()`, so an `icp` key is *rejected*, not ignored.

### Attribution

**Phase 4:** by activation window. `[activatedAt, supersededAt)` is half-open, and activation
supersedes the outgoing version at the *same* boundary timestamp, so the windows tile with no
gap and no overlap. An event at T belongs to exactly one version.

**Phase 6+:** work orders and agent actions store an explicit `CampaignPlaybookVersion.id` —
provenance should not rest on time inference once a writer exists. No FK column is added before
that writer exists.

### Send windows keep exactly one path

```text
playbook policy/default → approved sequence configuration → assertSendWindowPermission
  → SequenceStep fields → automation scheduler
```

No playbook-side scheduler, no second interpreter. The playbook states intent; Director /
Floor Manager authority and the automation engine still decide what reaches a prospect.

### Acceptance tests — 27

approved version immutable · edit creates a new draft · draft cannot be activated · superseded
cannot be reactivated · every activated version carries `approvedBy` + `approvedAt` · historical
versions readable after supersession · version numbers monotonic per playbook · attribution
query uses the half-open window · ghost thresholds differ by situation and all four are
required · no playbook operation enrols, sends, queues or schedules · tenant isolation on
playbook, version and drift detection · unknown keys rejected.

---

## Phase 5 — Agent runtime, typed tools, idempotent actions

- [x] `executeAgentAction` ([`lib/agent/runtime.ts`](../../lib/agent/runtime.ts)) is the only
      path from a provider tool call to a CRM mutation: capability authorization, then the
      `AgentAction` ledger, then the tool. `executeTool` has exactly one caller.
- [x] Tenancy, user and role are derived from the authenticated `SessionUser` and from nowhere
      else. A session with no tenant is **refused before the ledger is read** — no default
      tenant, no `!`, so no ledger row can exist without proven tenancy.
- [x] Tools call domain services. `lib/tasks/service.ts` now owns task create/list and both
      `/api/tasks` and the agent tool call it, which retires the internal-HTTP debt recorded in
      ARCHITECTURE §12. **No tool holds a Prisma client**; no `raw_prisma_query`.
- [x] Every mutation carries `actionKey` = `agent:{executionId}:tool:{ordinal}:{toolName}`.
      The executionId belongs to the SDR's turn and is carried by the client, so resending the
      same message retries rather than duplicates; the ordinal is execution-wide across the
      whole tool loop. A turn with no valid execution id may not run a write-capable tool.
- [x] Authoritative lead context ([`lib/leads/context.ts`](../../lib/leads/context.ts)) —
      lead, campaign, client and the active playbook version are read server-side through
      `canAccessLead`. The browser's copy of those facts is never trusted, and the model
      cannot choose the playbook version its action is attributed to.
- [ ] `agent` queue on the existing BullMQ setup with SLA priorities — prospect reply and
      meeting request outrank an interactive SDR command, which outranks work-order execution,
      which outranks bulk research.
      **Not built.** Nothing enqueues agent work yet: the runtime is called inline from the
      chat request. The first producer is Phase 6's work-order execution, and a queue with no
      producer is a guess at the payload shape. Deferred to Phase 6 with the work orders.

**Acceptance:** replaying a turn creates no duplicate CRM rows. A grep for `prisma.` inside the
tool layer returns nothing. SLA priority ordering is unproven until the queue lands with its
first producer.

---

## Phase 6 — Typed work orders

**One architectural phase, split into 6a and 6b for review.** 6a is the durable domain — the
model, the bounds, the conflict rules and the lease. 6b is what executes it: the `agent` queue,
approval requests, and incremental budget enforcement. The split is a review boundary, not a
design boundary; 6b assumes 6a's vocabulary and adds no second one.

### Phase 6a — Typed WorkOrder domain foundation ✅

- [x] Types: `prospect_batch`, `research_batch`, `sequence_design`, `outreach_launch`,
      `followup`, `reengagement`, `reply_review`, `campaign_analysis`, `lead_quality_analysis`
      ([`lib/workorders/types.ts`](../../lib/workorders/types.ts))
- [x] The type declares allowed capabilities — the type is what bounds tool access. The set is
      an **additional ceiling only**; the composition in
      [`lib/workorders/authorization.ts`](../../lib/workorders/authorization.ts) has no branch
      that constructs an `ALLOW`, so it can subtract and cannot add.
- [x] Budgets `researchBudget` / `tokenBudget` / `maxToolCalls` / `maxExecutionDuration`
      **validated and bounded** at the domain boundary, with `budget_exhausted` a first-class
      pause reason. *Incremental enforcement is 6b* — and so are the consumption counters, since
      a column nothing writes is not worth adding early.
- [x] Concurrency: a lead cannot sit under two competing work orders. Four independent sources
      checked and each reported by name — active work order, live lease, authoritative
      `SequenceEnrollment`, `ProspectOperatingState`
      ([`lib/workorders/conflicts.ts`](../../lib/workorders/conflicts.ts))
- [x] Agent lease (`workOrderId`, `leadId`, `mode`, `claimToken`, `claimedAt`, `expiresAt`) —
      execution protection only. **Not sales ownership**; assignment stays `Lead.assignedToId`
      ([`lib/workorders/leases.ts`](../../lib/workorders/leases.ts))
- [x] **Fencing.** `claimToken` is minted on every claim and reclaim, preserved across renewals,
      and required by `renewLease` / `releaseLease` / `holdsLease`. `workOrderId` alone cannot
      fence *two attempts at the same order* — the case where a stalled worker wakes after its
      lease expired and a retry reclaimed it.
- [x] Exact `CampaignPlaybookVersion` provenance, pinned once at activation — the writer the
      Phase 4 column was waiting for
- [x] `AgentAction`, `AiCall` and `ProspectTransition` carry real foreign keys to `WorkOrder`
      instead of loose text columns

**Acceptance (all proved):** activating a conflicting work order is refused with the conflict
named, and nothing is cancelled or replaced. A lease never changes who the CRM says owns the
lead, nor its operating state, nor writes a `ProspectTransition`. Every type has an explicit
capability set and every *capability* an explicit prospect-effect classification; no type
declares a `human_only` capability; the composed decision is no more permissive than the agent
policy alone across all **4,320** combinations — 9 types × 16 capabilities × 6 roles × 5 stored
modes, where the fifth mode is `null`, "this tenant has stored no policy". A superseded lease
holder can neither renew, release, nor present itself as the holder. Two concurrent exclusive
claimants resolve to one winner and one named refusal, never a raw unique violation. Budgets are
bounded on both sides. Tenant isolation holds against a known id.

### Phase 6b — Queue execution + approval requests ✅

- [x] The `agent` BullMQ queue on the existing infrastructure and `JobRun` durability — no
      agent-specific job store. `createAppWorker`/`wrapProcessor` give the durable mirror, tenant
      resolution and lifecycle for free ([`workers/agent.ts`](../../workers/agent.ts)).
- [x] One SLA priority vocabulary, declared and tested now even where producers do not yet
      exist: prospect reply / meeting request > interactive SDR command > work order execution
      > bulk research ([`lib/agent/priorities.ts`](../../lib/agent/priorities.ts))
- [x] Durable approval requests, so `REQUIRE_USER_APPROVAL` and `REQUIRE_MANAGER_APPROVAL` stop
      being terminal refusals. `AgentApprovalRequest` records tenant, work order, action intent
      (capability + tool + exact args), requester, required level, approver,
      `pending | approved | rejected | expired`, timestamps and playbook version.
      **One request per action, by unique constraint on `(tenantId, actionKey)`.**
- [x] **Approval does not bypass authorization.** `resumeApprovedAction` re-derives the decision
      from current policy every time; nothing is read from the request but *which action* it was
      about. A tightened policy, a `human_only` capability, a cancelled work order, an expired
      approval, or an approval granted at a level the policy now exceeds each still refuse.
- [x] Incremental budget enforcement before each operation, with `budget_exhausted` a pause
      carrying partial completion ([`lib/workorders/budgets.ts`](../../lib/workorders/budgets.ts))
- [x] Execution runs through the Phase 5 `AgentRuntime` — no second WorkOrder-specific CRM path.
      Proved by the `AgentAction` rows, not by a mock.
- [x] Services, queue/worker and API routes only. **No work order or approval UI.**
- [x] Structural client/server boundary guard — a *transitive* import-graph walk, since the
      realistic failure is a Client Component reaching `leases.ts` two hops down a helper.

**Acceptance:** activation enqueues through the existing BullMQ system at the declared priority.
A duplicate enqueue cannot duplicate a CRM mutation. An approval-required action creates exactly
one durable request and does not execute; approving resumes through current authorization;
rejected and expired requests never execute; state changed after approval can still refuse.
Budget exhaustion pauses with partial progress. A provider outage does not break the CRM. Stale
lease recovery is deterministic. `place_call` remains impossible.

---

## Phase 7 — Knowledge retrieval and structured research

- [ ] Split `lib/ai/sdr-skills.md` into `skills/{cold-email,cold-call,qualification,
      objection-handling,meeting-booking,research,personalization,reengagement}.md`;
      retrieve by relevance, never load the set
- [ ] `CompanySignal` / `AccountPainHypothesis` / `PersonalizationHook`, each with source,
      `observedAt`, confidence
- [ ] Account-level research cache keyed on the existing `Account` model; contact research
      separate on `Contact`

**Acceptance:** 20 leads at one account trigger one account research pass. Generated copy cites
stored evidence rows rather than recalling facts.

---

## Phase 8 — The prospecting loop

The core of the operating model. Everything before this was scaffolding.

### 8a — AI does the repetitive work (`ai_managed`)

- [ ] Leadgen agent: company/contact research, qualification, dedup, ICP evaluation — reading
      and writing through `lib/leadgen/*`
- [ ] SDR agent: research, prioritization, notes, tasks, reminders
- [ ] Hybrid prioritization — deterministic scoring first (`lib/ai/scoring.ts` already exists),
      AI explains and refines the top slice rather than rating every lead
- [ ] Personalization drafts sequence content; **activation goes through the existing approval
      path and the automation engine sends**

### 8b — Handoff on a meaningful reply

- [ ] Reply classes A–D (ARCHITECTURE §5) routed inside `handleApplyReply` — the single existing
      chokepoint, not a new listener
- [ ] Class A stops and suppresses via the existing `SuppressionEntry` path, no SDR interrupt
- [ ] Class B proposes a dated resume; the date comes from `calculateNextActionAt`
- [ ] Class C → `human_attention` + handoff package: why AI contacted them, campaign, messages
      sent, the reply, AI's reading, research, recommended objective, suggested response,
      suggested call questions
- [ ] Class D → human review; low confidence never drives automation
- [ ] SLA timestamps `handoffCreatedAt`, `humanOpenedAt`, `humanFirstActionAt`

### 8c — AI assists while the SDR owns the conversation (`human_managed`)

`human_managed` means "AI may not touch the prospect", not "AI off".

- [ ] Thread summarization
- [ ] Reply drafting — always into the SDR's composer, never sent
- [ ] Objection handling support, grounded in the objection actually raised
- [ ] Call prep and meeting prep from account + contact intelligence
- [ ] Automatic CRM note capture after logged calls and meetings

### 8d — Ghost, then handback

- [ ] Ghost eligibility from the playbook threshold for that situation, via
      `markReengagementEligible()` — a badge and a recommendation, **never an enrollment**
- [ ] AI proposes a re-engagement plan reading prior interest, the objection, the unanswered
      question, the last human message, meeting history and any promised follow-up
- [ ] SDR action ("Resume AI Follow-up") calls `handbackProspectToAI()`: validate CRM state and
      permissions → create a re-engagement work order → route for approval
- [ ] `startAIReengagement()` activates the approved workflow through `createTaskForStep` /
      the normal enrollment path — a re-engagement sequence is a sequence
- [ ] **The prior cold sequence is never restarted.** The new workflow is built from the
      conversation that actually happened

**Acceptance:** an OOO creates no SDR task; a pricing question creates an urgent one. No code
path enrolls a `human_managed` lead. "Just following up" cannot be produced — a re-engagement
draft with no cited prior context is rejected. Median handoff response time is queryable.

---

## Phase 9 — Role surfaces, exception-driven

Each role gets support scoped to what that role is responsible for. All four read existing
metrics modules; none gets its own query layer.

- [ ] **SDR** — managed count, what needs you (replies, calls, objections), what AI did today,
      risks. No queue or worker vocabulary anywhere in it.
- [ ] **Team Lead** — exceptions only: untouched positive replies past SLA, overdue calls, stuck
      prospects, follow-up gaps, coaching candidates
- [ ] **Floor Manager** — campaign health, capacity variance ("expected 610, sent 432" with the
      deferral/health/window/suppression breakdown, all of which the automation engine already
      records), mailbox health, bottlenecks
- [ ] **Leadgen Manager** — supply quality: ICP adherence, duplicate rate, enrichment quality,
      contactability, rejection reasons with the source-vs-behaviour split
- [ ] **Director** — prospects worked, replies, meetings, opportunities, AI cost, cost per
      meeting, campaigns at risk

**Acceptance:** every surface lists exceptions, not healthy volume. Every number traces to
`client-reports`, `sequences/analytics`, `email-health` or `leadgen/metrics`. Role scoping uses
the existing pod/permission helpers — a Team Lead sees their pod and no more.

---

## Phase 10 — Approved learning

- [ ] Outcome signals collected as evidence: draft accepted, draft heavily edited, prospect
      replied, meeting booked, lead rejected, research marked irrelevant
- [ ] Periodic **proposals** — "operational-efficiency hooks produced 17% higher positive reply
      rate for logistics CFOs; suggested playbook change" — approved by a manager, creating a
      new playbook version
- [ ] Sequence-version awareness in reporting: variants are not aggregated as if identical

**Acceptance:** no playbook version exists without an `approvedBy`. No agent writes its own
policy.

---

## Golden E2E journey

The defining test once 1–10 land:

```text
Leadgen sources lead → AI verifies ICP → qualified → SDR receives → AI researches
→ AI proposes outreach → approved → automation executes cadence → prospect replies
→ cold outreach stops → AI classifies → SDR handoff → SDR responds → prospect ghosts
→ reengagement eligible → SDR hands back → AI plans follow-up → new sequence
→ meeting booked → automation ends → opportunity created
```

Assert business behaviour, not classifier accuracy: did cold outreach stop, did the right SDR
get the right task, was duplicate work avoided, were tenant boundaries held, was the correct
playbook version applied, did anything enroll a human-managed lead.

---

## Operating restrictions

- No external users, no real client data, live sequence sending off, email in dry-run
- Manual Cloud SQL backup before every migration
- Never `prisma migrate reset` or a destructive seed against a remote database
- **Level 4 autonomy — AI-managed two-way prospect conversations — is out of scope.** Not a
  later phase of this plan; a separate decision with its own risk review. `prospect_reply`
  stays `human_only` throughout.
