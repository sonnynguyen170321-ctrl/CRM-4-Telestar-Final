# Telestar Revenue AI — Plan

> Contract: [`ARCHITECTURE.md`](ARCHITECTURE.md). Resume pointer: [`STATUS.md`](STATUS.md).

Ten phases, reshaped from a twenty-item proposal. The reshaping is deliberate: phases 13–20 of
the original list all depended on 3–12 landing correctly, and none of them was independently
shippable or independently testable. Each phase below ends in something a user can use or a
test can assert.

**Every phase must leave the gates green** — `tsc --noEmit`, `eslint app components lib context
tests`, `vitest run`, and the automation E2E specs.

---

## Phase 0 — Vocabulary normalization ✅ complete

The paused-reason vocabularies had diverged three ways and one of them was user-visible.

- [x] One `PausedReason` type, one `PAUSED_REASON_LABELS` map, one `normalizePausedReason`
      at the single write site — [`lib/automation/types.ts`](../../lib/automation/types.ts)
- [x] `pauseSequence` normalizes whatever a caller passes, so an in-flight BullMQ job carrying
      the old payload cannot reintroduce an unrenderable token
- [x] Bounce callers distinguish `hard_bounce` from `soft_bounce`
- [x] `pauseSequencesBulk` writes `pausedReason: 'manual'` — it previously wrote none, making
      bulk-paused runs the only ones the lead panel could not explain
- [x] `LeadDetailPanel` renders the shared map instead of its own copy
- [x] `20260809230000_normalize_paused_reason` remaps existing rows

**Acceptance:** a reply-paused enrollment renders "Paused — prospect replied", not
"Paused — replied". Pinned by `tests/lifecycle-integration.test.ts` cases 1, 1b, 2, 2b.

---

## Phase 1 — Cost attribution and the AI-optional test

Prerequisite for every budget, every cost report, and invariant 2.

- [ ] `provider.ts` records tokens in, tokens out, model, latency and computed cost per call
- [ ] `AiCall` table: tenant, user, purpose, model, tokens, cost, `workOrderId?`, `createdAt`
- [ ] A test asserting the CRM's core paths — sequence execution, reply processing, email send,
      task completion — run to green with the AI subsystem unavailable

**Acceptance:** cost per call is queryable by tenant, user and purpose; disabling AI fails no
CRM test.

---

## Phase 2 — Capability-based autonomy

Before any write-capable agent tool exists. Retrofitting permissions onto tools that already
write is how a policy flag ends up ignored by four code paths.

- [ ] `AgentCapability` enum: `research`, `notes`, `tasks`, `reminders`, `sequence_draft`,
      `sequence_enroll`, `send_window_change`, `prospect_reply`, `reengagement`, …
- [ ] `AutonomyPolicy` per tenant × role × capability →
      `auto | approval | manager_approval | human_only`
- [ ] Defaults: research/notes/tasks/reminders `auto`; `sequence_enroll` `approval`;
      `send_window_change` `manager_approval`; `prospect_reply` `human_only`
- [ ] Enforcement in one place, on the pattern of
      [`lib/sequences/permissions.ts`](../../lib/sequences/permissions.ts)

**Acceptance:** a tool call whose capability resolves to `approval` cannot write; it produces a
pending approval. Covered per capability, not once.

---

## Phase 3 — State model: collapse the mirror, then add operating state

**Do not add the field before resolving the mirror.** See ARCHITECTURE §4.

- [ ] Decide: make `Lead.sequenceStatus` a derived read of `SequenceEnrollment.status`, or
      declare the enrollment authoritative and the lead column a cache with a stated refresh
      point. Write the decision down.
- [ ] Then add `ProspectOperatingState` with the ten states, defaulting from existing data
- [ ] Transition function — states change through one function that writes an Activity, never
      by an ad-hoc `update`

**Acceptance:** every operating-state transition is reconstructible from the activity feed;
no path writes the field directly.

---

## Phase 4 — CampaignPlaybook + versioning

The highest-leverage item in the proposal, and the cheapest to start: rows can be authored and
read by humans before any agent consumes them.

- [ ] `CampaignPlaybook`: ICP, personas, value prop, research depth, allowed channels, sequence
      strategy, personalization policy, allowed CTAs, send-window policy, reply handling, OOO
      handling, ghost thresholds, reengagement strategy, handoff SLA
- [ ] `CampaignPlaybookVersion`: version, rules, `createdBy`, `approvedBy`, `createdAt`
- [ ] Every agent action records the playbook version it ran under

**Acceptance:** "did reply rate improve after v4?" is answerable by query, not by memory.

---

## Phase 5 — Agent runtime, typed tools, idempotent actions

- [ ] Runtime resolves role → capabilities → tool subset; composes the prompt per
      ARCHITECTURE §6
- [ ] Tools are business-level and encode CRM semantics: `handoff_lead_to_sdr()`, not
      `updateLead()` + `createTask()` + `createNotification()`. No `raw_prisma_query`.
- [ ] Every mutation carries `actionKey` (e.g. `workOrder:123:lead:456:create-initial-call`);
      a retry finds the prior success
- [ ] `agent` queue with SLA priorities; bulk research cannot delay a handoff

**Acceptance:** replaying any agent job produces no duplicate CRM rows.

---

## Phase 6 — Typed work orders

- [ ] Types: `prospect_batch`, `research_batch`, `sequence_design`, `outreach_launch`,
      `followup`, `reengagement`, `reply_review`, `campaign_analysis`, `lead_quality_analysis`
- [ ] Each type declares its allowed capabilities — the type is what bounds tool access
- [ ] Budgets per ARCHITECTURE §9; exhaustion pauses and reports partial completion
- [ ] Concurrency rule: a lead cannot be under two competing work orders. Check active agent
      work, current sequence, and operating state before activation.
- [ ] Agent lease (`workOrderId`, `leadId`, `mode`, `claimedAt`, `expiresAt`) — execution
      protection only, never sales ownership

**Acceptance:** activating a conflicting work order is refused with the conflict named.

---

## Phase 7 — Knowledge retrieval and structured research

- [ ] Split `lib/ai/sdr-skills.md` into `skills/{cold-email,cold-call,qualification,
      objection-handling,meeting-booking,research,personalization,reengagement}.md`
- [ ] Retrieve by relevance; never load the whole set
- [ ] `CompanySignal` / `AccountPainHypothesis` / `PersonalizationHook` with source,
      `observedAt`, confidence
- [ ] Account-level research cache keyed on `Account`; contact research separate

**Acceptance:** 20 leads at one account trigger one account research pass. Generated copy cites
stored evidence rows.

---

## Phase 8 — Read-only agents: Leadgen and SDR research

First user-facing agents. No writes beyond `auto` capabilities.

- [ ] Leadgen: company/contact research, qualification, dedup detection, ICP evaluation
- [ ] SDR: research, prioritization, notes, tasks, reminders
- [ ] Hybrid prioritization — deterministic scoring first
      ([`lib/ai/scoring.ts`](../../lib/ai/scoring.ts) already exists), AI explains and refines
      the top slice rather than rating every lead

**Acceptance:** an SDR can run a full day without the agent writing anything requiring approval.

---

## Phase 9 — Reply classification and the handoff experience

- [ ] Classes A–D per ARCHITECTURE §5, routed inside `handleApplyReply` — the single chokepoint
- [ ] Class B resume dates go through `calculateNextActionAt`
- [ ] Handoff package: why AI contacted them, campaign, messages sent, the reply, AI's reading,
      research, recommended objective, suggested response, suggested call questions
- [ ] Handoff SLA timestamps: `handoffCreatedAt`, `humanOpenedAt`, `humanFirstActionAt`

**Acceptance:** an OOO reply creates no SDR task; a pricing question creates an urgent one.
Median handoff response time is queryable.

---

## Phase 10 — Management surfaces and approved learning

- [ ] Team Lead: exception list — untouched positive replies, overdue calls, stuck prospects,
      follow-up gaps, coaching candidates
- [ ] Floor Manager: campaign health, capacity variance ("expected 610, sent 432, here is the
      breakdown"), mailbox health, bottlenecks
- [ ] Director: prospects worked, replies, meetings, opportunities, AI cost, cost per meeting,
      campaigns at risk
- [ ] Learning: outcomes collected as evidence; periodic **proposals** to change a playbook,
      approved by a manager, creating a new version. Never a silent rewrite.

**Acceptance:** every management surface lists exceptions, not healthy volume. No playbook
version exists without an `approvedBy`.

---

## Golden E2E journey

The eventual defining test, once phases 1–10 land:

```text
Leadgen sources lead → AI verifies ICP → qualified → SDR receives → AI researches
→ AI proposes outreach → approved → automation executes cadence → prospect replies
→ cold outreach stops → AI classifies → SDR handoff → SDR responds → prospect ghosts
→ reengagement eligible → SDR approves AI follow-up → new sequence → meeting booked
→ automation ends → opportunity created
```

Evaluation must assert business behaviour, not classifier accuracy alone: did cold outreach
stop, did the right SDR get the right task, was duplicate work avoided, were tenant boundaries
held, was the correct playbook version applied.

---

## Operating restrictions

Inherited and still in force for this whole initiative:

- No external users, no real client data, live sequence sending off, email in dry-run
- Manual Cloud SQL backup before every migration
- Never `prisma migrate reset` or a destructive seed against a remote database
- Level 4 autonomy (AI-managed two-way prospect conversations) is **out of scope**. Not a
  later phase of this plan — a separate decision with its own risk review.
