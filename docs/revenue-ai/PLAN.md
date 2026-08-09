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

## Phase 2 — Capability-based autonomy

Lands **before** any write-capable tool. Retrofitting permissions onto tools that already write
is how a policy flag ends up ignored by four code paths.

- [ ] `AgentCapability`: `research`, `notes`, `tasks`, `reminders`, `summarize`, `draft_reply`,
      `objection_help`, `meeting_prep`, `sequence_draft`, `sequence_enroll`,
      `send_window_change`, `reengagement_propose`, `reengagement_activate`, `prospect_reply`
- [ ] `AutonomyPolicy` per tenant × role × capability →
      `auto | approval | manager_approval | human_only`
- [ ] Defaults: research/notes/tasks/reminders/summarize/`draft_reply`/`objection_help`/
      `meeting_prep` → `auto`; `sequence_enroll` and `reengagement_activate` → `approval`;
      `send_window_change` → `manager_approval`; `prospect_reply` → `human_only`
- [ ] Enforcement in one place, on the pattern of `lib/sequences/permissions.ts`, layered
      **on top of** existing role checks — never replacing them

**Acceptance:** a capability resolving to `approval` cannot write; it produces a pending
approval. `prospect_reply` is unreachable at every autonomy setting. Existing role gates still
deny what they denied before.

---

## Phase 3 — State model

**Decision made — see [ARCHITECTURE §4](ARCHITECTURE.md).** `SequenceEnrollment` is
authoritative for execution state; `Lead.sequenceStatus` is a legacy compatibility cache with a
documented deprecation path; `ProspectOperatingState` is a separate axis for responsibility.

- [ ] `ProspectOperatingState` with the ten states, defaulted from existing data
      (`ai_managed` where an active enrollment exists, `human_attention` where a lead is at
      stage `replied` with a paused enrollment, `unassigned` otherwise)
- [ ] The four domain services of ARCHITECTURE §4.2 — `handoffProspectToHuman`,
      `markReengagementEligible`, `handbackProspectToAI`, `startAIReengagement` — each owning
      its Task / Notification / Activity / WorkOrder / cache consequences
- [ ] Transitions write an `Activity` (existing table, no new audit log)
- [ ] The compatibility refresh of `Lead.sequenceStatus` happens **only** inside these services
      and `lib/sequences/engine.ts`

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

## Phase 4 — CampaignPlaybook + versioning

Highest leverage, cheapest start: rows can be authored and read by humans before any agent
consumes them.

- [ ] `CampaignPlaybook`: ICP, personas, value prop, research depth, allowed channels, sequence
      strategy, personalization policy, allowed CTAs, send-window policy, reply handling, OOO
      handling, **ghost thresholds per situation**, reengagement strategy, handoff SLA
- [ ] `CampaignPlaybookVersion`: version, rules, `createdBy`, `approvedBy`, `createdAt`
- [ ] Every agent action records the playbook version it ran under
- [ ] Ghost thresholds are policy, never constants: positive reply waiting ≠ proposal sent ≠
      meeting no-show ≠ post-demo

**Acceptance:** "did reply rate improve after v4?" is a query. No playbook version exists
without an `approvedBy`. Send-window policy in a playbook is applied *by the automation engine*,
not by an agent.

---

## Phase 5 — Agent runtime, typed tools, idempotent actions

- [ ] Runtime resolves role → capabilities → tool subset; composes the prompt per ARCHITECTURE §6
- [ ] Tools encode CRM semantics — `handoff_lead_to_sdr()`, not `updateLead()` +
      `createTask()` + `createNotification()`. No `raw_prisma_query`. **No tool holds a Prisma
      client**; each calls a domain service from the reuse map.
- [ ] Every mutation carries `actionKey` (e.g. `workOrder:123:lead:456:create-initial-call`);
      a retry finds the prior success
- [ ] `agent` queue on the existing BullMQ setup with SLA priorities — prospect reply and
      meeting request outrank an interactive SDR command, which outranks work-order execution,
      which outranks bulk research

**Acceptance:** replaying any agent job creates no duplicate CRM rows. Bulk research never
delays a handoff. A grep for `prisma.` inside the tool layer returns nothing.

---

## Phase 6 — Typed work orders

- [ ] Types: `prospect_batch`, `research_batch`, `sequence_design`, `outreach_launch`,
      `followup`, `reengagement`, `reply_review`, `campaign_analysis`, `lead_quality_analysis`
- [ ] The type declares allowed capabilities — the type is what bounds tool access
- [ ] Budgets: `researchBudget`, `tokenBudget`, `maxToolCalls`, `maxExecutionDuration`.
      Exhaustion pauses and reports partial completion; never a silent overspend
- [ ] Concurrency: a lead cannot sit under two competing work orders. Check active agent work,
      current sequence, and operating state before activation
- [ ] Agent lease (`workOrderId`, `leadId`, `mode`, `claimedAt`, `expiresAt`) — execution
      protection only. **Not sales ownership**; assignment stays `Lead.assignedToId`

**Acceptance:** activating a conflicting work order is refused with the conflict named. A lease
never changes who the CRM says owns the lead.

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
