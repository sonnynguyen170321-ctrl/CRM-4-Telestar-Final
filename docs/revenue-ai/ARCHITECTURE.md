# Telestar Revenue AI — Target Architecture

> The architectural contract for the AI initiative. Roadmap: [`PLAN.md`](PLAN.md).
> Resume pointer: [`STATUS.md`](STATUS.md) — **read that first.**

## 1. Product definition

Not "an AI SDR agent". **One shared agent runtime serving every operating role**, with
capabilities and objectives derived from the authenticated user's existing CRM role.

```text
                    TELESTAR REVENUE AI
                           │
                 Shared Agent Runtime
                           │
   ┌──────────┬────────────┼────────────┬──────────┐
   ▼          ▼            ▼            ▼          ▼
Leadgen   Leadgen Mgr     SDR       Team Lead   Floor Mgr / Director
research   supply       prospecting  exceptions  operations / revenue
qualify    quality      outreach     coaching    capacity / cost
```

There are **not** five AI systems. All share one CRM, one permission model, one tool
registry, one knowledge store, one work-order type set, one audit trail, one automation
engine, one model router.

## 2. Layering

```text
┌──────────────────────────────────────────────────────────────┐
│ TELESTAR CRM — source of business truth                       │
│ Lead, Account, Contact, Campaign, User, Meeting, Opportunity  │
├──────────────────────────────────────────────────────────────┤
│ AGENT RUNTIME — role + policy + retrieved context             │
│ knowledge · work orders · typed tools · autonomy policy       │
├──────────────────────────────────────────────────────────────┤
│ CRM DOMAIN SERVICES — the only writers                        │
│ lib/sequences, lib/leads, lib/admin, lib/meetings …           │
├──────────────────────────────────────────────────────────────┤
│ OUTREACH AUTOMATION ENGINE — scheduling + eligibility         │
│ lib/automation/* (shipped)                                    │
├──────────────────────────────────────────────────────────────┤
│ EXECUTION — BullMQ workers, OutboundMessage, Task             │
├──────────────────────────────────────────────────────────────┤
│ CRM EVENTS → NEXT BEST ACTION → AI continues | human needed   │
└──────────────────────────────────────────────────────────────┘
```

The agent runtime sits **above** domain services and never below them. It has no database
client of its own.

## 3. Invariants

1. **The CRM owns truth; AI owns interpretation.** Every agent mutation goes through a domain
   service that already enforces tenancy, permissions and audit. No agent tool holds a Prisma
   client.

2. **AI is an enhancement layer, and its absence is not an outage.** With the AI subsystem
   fully down, the CRM, automation engine, reply processing and email must keep running.
   This is true today only by accident — nothing in the CRM calls `lib/ai/`. It becomes a
   tested property, not a coincidence.

3. **Autonomy is per capability, never a single level.** A scalar `autonomyLevel = 3` cannot
   express "research is automatic but sequence activation needs a manager". Policy is a map
   from capability to `auto | approval | manager_approval | human_only`.

4. **The AI recommends; policy validates; automation executes.** No tool call is itself the
   decision. A `NextBestAction` is a structured recommendation that a policy check converts
   into a task, an enrollment, or nothing.

5. **No self-modifying policy.** Observation → analysis → recommendation → human approval →
   a new *version* of a playbook. An agent never rewrites the rules it runs under.

6. **Every agent mutation is idempotent under an `actionKey`.** Same discipline the outbound
   pipeline already applies to sends. A retried job finds the prior successful action rather
   than repeating it.

7. **Scheduling stays where it is.** Anything that decides *when* an automated step runs calls
   `lib/automation/scheduling.ts`. An agent proposing "resume after the OOO return date" emits
   an intent; the engine computes the timestamp.

8. **No second system.** There is one CRM, one sequence engine, one email pipeline, one
   permission model, one tenancy mechanism, one audit trail, one reporting layer. The agent
   layer calls them. It does not get an "AI sequence", an "AI send path", an "AI role check",
   an "AI activity log", or an "AI dashboard fed by its own queries". A capability that seems
   to need one is a signal that the existing service needs a parameter, not a twin. See §9.

9. **AI never takes a lead back on its own.** Once a prospect reaches `human_managed`, only the
   SDR returns it to AI. Ghost detection makes a lead *eligible* for re-engagement and says so;
   it does not re-enroll anyone. The transition out of human ownership is always a human action.

10. **The AI runtime is server-only; the model catalog is the only client-safe part.** See §10.

11. **Capability authorization is not object authorization.** See §11. `tasks = auto` means an
    agent may create tasks *in general*; whether it may create *this* task on *that* lead is
    decided afterwards by the CRM domain service. The two are never conflated, and the agent
    layer never reproduces the second.

12. **CRM authorization runs independently of agent autonomy, and autonomy only restricts.**
    Tenancy, role scoping, pod hierarchy and object access are checked by the domain services
    regardless of any policy. A policy row can narrow what an agent does; it can never widen
    what a role may do.

13. **Ceilings are not tenant-configurable, and unknown fails closed.** `CAPABILITY_CEILING`
    caps what a stored policy may loosen. An unregistered tool, a missing role, an unreadable
    policy and an unrecognised stored value all resolve to refusal, never to permission.

14. **A blocked action is never reported as done.** Refusal text tells the model to say what
    needs approving. An agent that implies a write happened when it did not is worse than one
    that cannot write at all.

15. **Agent tools call domain services, not Telestar's own HTTP API.** For any CRM read or
    mutation a shared domain service can own, the tool calls that service directly. It does not
    issue an HTTP request to this application's authenticated routes. See §12. External
    provider and research HTTP calls — Groq, Gemini, Tavily, Jina — are unaffected.

## 4. State model — DECIDED

Three concepts, kept distinct. Each answers a different question and none is derivable from
another.

| Field | Answers | Authority |
|---|---|---|
| `Lead.stage` | Where is this prospect in the **sales process**? | Authoritative |
| `SequenceEnrollment.status` (+ `nextActionAt`, `pausedReason`, `currentStep`) | Where is this prospect in the **sequence execution lifecycle**? | **Authoritative** |
| `ProspectOperatingState` | Who or what should be **acting right now**? | Authoritative |
| `Lead.sequenceStatus` | — | **Legacy compatibility cache. Not a source of truth.** |

After a meaningful reply, all three carry different, non-redundant information:

```text
Lead.stage                 = replied          (sales: they engaged)
SequenceEnrollment.status  = paused           (execution: cadence stopped)
  pausedReason             = reply            (execution: why)
ProspectOperatingState     = human_managed    (responsibility: the SDR owns this)
```

States: `unassigned`, `researching`, `ready_for_outreach`, `ai_managed`, `human_attention`,
`human_managed`, `waiting_for_prospect`, `reengagement_eligible`, `ai_reengagement`,
`completed`.

### 4.1 `SequenceEnrollment` is authoritative for execution state

All new logic reads `SequenceEnrollment` — `status`, `nextActionAt`, `pausedReason`,
`currentStep`, `lastTransitionAt`. Nothing new is permitted to branch on
`Lead.sequenceStatus`.

`Lead.sequenceStatus` stays for now because the current CRM already depends on it — 15 files,
roughly 25 write sites and 20 read sites, none of them constrained to agree with the
enrollment. It is a **read cache maintained by domain services**, and it is the one piece of
this model with an expiry date.

**Deprecation path** (not scheduled here; a prerequisite is listed per step):

1. **Stop the bleeding.** No new reader, no new writer. Enforced by review and by the Phase 3
   acceptance test below. *(Now.)*
2. **Inventory.** Classify the ~20 existing readers into: list/kanban filters, analytics
   aggregations, and single-lead display. *(Before step 3.)*
3. **Replace by class.** Filters and aggregations move to joins on `SequenceEnrollment`, which
   already carries `(status, nextActionAt)` and `nextActionAt` indexes from the automation
   engine migration. Single-lead display reads the enrollment directly.
4. **Narrow the writers.** Once no consumer reads it, the ~25 write sites collapse into the
   domain services of §4.2 as a single cache refresh.
5. **Drop the column.** Expand-contract: stop writing, verify, then remove.

Until step 5, treat any disagreement between the two as *the enrollment being right*.

### 4.2 Transitions go through domain services, never field writes

Operating state changes through named services. No route, no tool, and no worker writes the
column directly. Each service owns **every** consequence of the transition — the operating
state, the `Activity` record, any `Task`, `Notification` or `WorkOrder`, and the
`Lead.sequenceStatus` compatibility refresh — so a transition cannot be half-applied by a
caller that forgot a step.

| Service | Transition | Owns |
|---|---|---|
| `handoffProspectToHuman()` | `ai_managed` → `human_attention` | pauses the enrollment via `pauseSequence`, builds the handoff package, urgent SDR task, notification, SLA `handoffCreatedAt`, activity |
| `markReengagementEligible()` | `waiting_for_prospect` → `reengagement_eligible` | eligibility flag, activity, surfacing to the SDR. **Creates no sequence, no enrollment, no external action.** |
| `handbackProspectToAI()` | `reengagement_eligible` → (pending) | validates CRM state and permissions, creates the re-engagement **work order**, routes it for approval. Does not start outreach. |
| `startAIReengagement()` | (approved) → `ai_reengagement` → `ai_managed` | activates the approved follow-up through the normal enrollment path, activity, work-order state |

Two rules these encode:

- **`markReengagementEligible` is inert.** It is a recommendation and a badge. The name is a
  warning: eligibility reads like something to act on, and acting on it is the defect.
- **Handback does not restart the old cold sequence.** `startAIReengagement` activates a *new*
  approved follow-up workflow built from the actual conversation. Re-enrolling the original
  cadence is prohibited.

### 4.2a Idempotency is per occurrence

`ProspectTransition.transitionKey` identifies **one occurrence**, never just `(lead, kind)`. A
prospect legitimately moves AI → human → AI → human over a lifetime, so a coarse key would let
the first handoff permanently block every later one — the transition would no-op and the SDR
would never hear about the second real reply.

| Transition | Keyed on |
|---|---|
| handoff | the inbound event (provider message / activity id) |
| reengagement_eligible | the handoff that opened this human-managed episode |
| handback | the SDR's request id (a work order once Phase 6 exists) |
| ai_reengagement_started | the approved re-engagement work order |

### The ledger claims, it does not certify

The row is written **before** the state change — but its existence is not proof the transition
finished. It carries execution status:

```text
pending → state_applied → completed
```

A retry that finds a non-completed row **resumes** from wherever it stopped. Treating existence
as success is a trap: a crash between the insert and the state write would strand the prospect,
every retry answering "already applied" while the lead never moved, with manual repair the only
way out. Manual repair is for genuinely irreconcilable data, not for an ordinary crash window.

Each consequence is claimed individually in `appliedEffects` by a conditional array append
*before* it runs, so two racing resumes cannot both perform the same one. A resume also skips
the `fromStates` guard: by then the lead has already moved, and re-checking would turn recovery
into a permanent error.

**Invariant: each business consequence runs at most once, and an interrupted occurrence always
converges to completion.** The residual window — a crash between a claim and its effect —
leaves that single consequence unperformed while the transition still completes. That case, and
only that case, is what the repair path is for.

Two concurrent deliveries race at the unique constraint. The loser inspects the winner's row
rather than assuming it finished: `completed` is a safe no-op, anything else is converged.

### 4.2b Pre-existing lifecycle debt, not solved here

**Reply dedupe is stage-based and coarse.** `handleApplyReply` skips any lead already at stage
`replied`, so a later legitimate reply from the same prospect is suppressed too. That behaviour
is unchanged in Phase 3 and this phase does not claim to fix it. Handoff idempotency is
deliberately independent of it: the transition ledger is keyed on the inbound event, and the
reply path no longer selects `Lead.stage` for the handoff decision.

### 4.3 What `human_managed` blocks

`human_managed` blocks **autonomous prospect-facing action**, nothing else. AI assistance to the
SDR stays fully available throughout: summaries, reply drafts into the SDR's composer, objection
handling, call prep, meeting prep, research, recommendations. The line is whether the prospect
receives something the SDR did not send.

## 4a. The ownership cycle

The operating model in one loop. AI does the repetitive work, the SDR does the selling, and
ownership changes hands at two well-defined moments.

```text
        ready_for_outreach
                │
                ▼
          ai_managed ─────────────── AI: research, personalize, enroll,
                │                    follow up, handle admin replies
                │  meaningful reply (Class C)
                ▼
        human_attention ──────────── handoff package delivered, SLA clock starts
                │
                │  SDR opens / acts
                ▼
        human_managed ────────────── SDR sells. AI assists on request:
                │                    summaries, reply drafts, objection help,
                │                    call prep, meeting prep. AI writes nothing
                │                    to the prospect.
                │  SDR sends, prospect goes quiet
                ▼
      waiting_for_prospect
                │
                │  playbook ghost threshold reached
                ▼
     reengagement_eligible ────────── AI proposes a follow-up plan grounded in the
                │                     actual conversation. It does not act.
                │  ◀── SDR hands the lead back (explicit action)
                ▼
        ai_reengagement ────────────► back to ai_managed
```

Three properties this encodes:

- **Handoff to human is automatic; handback to AI is not.** Invariant 9. A ghost threshold
  produces a recommendation and a badge, never an enrollment.
- **AI stays useful during human ownership.** `human_managed` is not "AI off". It is "AI may
  not touch the prospect". Research, summarization, drafting, objection preparation and
  meeting prep all remain available — they are assistance to the SDR, not outreach.
- **Re-engagement is context-aware or it does not happen.** A follow-up plan reads the prior
  interest, the objection raised, the question left unanswered, the last human message, the
  meeting history and any promised follow-up. "Just following up" is a failure of the feature,
  not an acceptable output.

## 5. Reply classification

Today `handleApplyReply` treats every inbound message identically: pause → skip tasks →
urgent task → notification. That is correct for a pricing question and wasteful for an
out-of-office.

| Class | Examples | Handling |
|---|---|---|
| **A — deterministic stop** | unsubscribe, hard bounce, explicit rejection | stop, suppress where applicable, no human interrupt |
| **B — administrative** | OOO, maternity leave, wrong person, left company | AI proposes a dated resume or a contact swap; under approved policy this can become automatic |
| **C — sales engagement** | interest, question, objection, referral, pricing, meeting request | `human_attention` — this is where SDR skill starts |
| **D — ambiguous** | "Interesting, send me more info" | human review; low confidence must never drive aggressive automation |

Class B resume dates go through the scheduling engine (invariant 7), not a hand-computed
timestamp.

## 6. Knowledge is retrieved, not concatenated

Prompt composition:

```text
system policy + role policy + campaign playbook + relevant skill
+ lead context + relevant recent conversation + research evidence
```

Not the entire handbook, entire campaign, entire CRM history, every prior message. Today
`lib/ai/sdr-skills.md` is a single 434-line file loaded whole; it becomes a `skills/`
directory retrieved by relevance.

## 7. Research is structured and cached per account

Prose research cannot be verified at generation time. Store typed evidence —
`CompanySignal`, `AccountPainHypothesis`, `PersonalizationHook` — each with source,
`observedAt` and confidence, so a generated email cites facts rather than recalling them.

Cache at the **account** level. Twenty leads at one company is one company research pass plus
twenty person passes, not twenty company searches. `Account` and `Contact` models already
exist and `Lead.accountId` already points at `Account`, so the split needs no new modeling.

## 8. Exception-driven operations

A mature agent does not narrate healthy work. "61 prospects running normally" needs no one's
attention. Surface the 3 positive replies, the 2 stuck workflows, the mailbox nearing its cap.
This is a product principle, not a UI preference: it is what makes the Team Lead and Floor
Manager surfaces worth opening.

## 9. Do not rebuild — the reuse map

Invariant 8 made concrete. Everything below exists, is tested, and enforces rules the agent
layer must not reimplement. An agent capability is wired to the left column or it is wrong.

| Concern | Reuse this | Never build |
|---|---|---|
| Tenancy | `lib/prisma.ts` (`tenantStorage`, `$extends`), `lib/tenant-context.ts`, `lib/tenant-inject.ts` | an agent-side tenant filter |
| Permissions | `lib/permissions.ts`, `lib/podScoping.ts`, `lib/sequences/permissions.ts` | an "AI role matrix" |
| Sequence lifecycle | `lib/sequences/engine.ts` — `createTaskForStep`, `advanceSequence`, `pauseSequence`, `unenrollLead` | an AI enrollment path |
| Scheduling / eligibility | `lib/automation/{scheduling,eligibility,timezone,jitter}.ts` | agent-computed send times |
| Sending | `lib/workflows/email.ts` (`createOutboundMessage`, `enqueueEmailSendWorkflow`), `workers/email.ts` | a direct provider call from a tool |
| Deliverability | suppression checks, quota reservation and the mailbox preflight already inside `workers/email.ts` | an AI-side send guard |
| Inbound | `workers/sync.ts` — `handleApplyReply`, `handleApplyBounce` | a second inbox reader |
| Queues + durability | `lib/bullmq/*`, `JobRun` | an agent-only job store |
| Audit | `lib/audit.ts`, `Activity`, `AuditLog` | an AI activity log |
| Tasks / notifications | `Task`, `Notification`, `lib/notifications/prefs.ts` | AI-specific task or alert tables |
| Meetings | `lib/meetings/meetingLifecycle.ts`, `bookingLinks.ts` | agent-side booking |
| Opportunities | `lib/opportunities/{service,lifecycle,access}.ts` | agent-side deal writes |
| Leadgen pool | `lib/leadgen/{pool,requirements,assignableReps}.ts` | a parallel qualification store |
| Reporting | `lib/client-reports/*`, `lib/sequences/analytics.ts`, `lib/email-health/*` | an AI dashboard on its own queries |
| Work-ownership safety | `lib/admin/campaignMembers.ts` impact gate (409 unless a handling mode is named) | an agent bypass |

The management surfaces in PLAN Phase 10 are **presentations of these metrics**, not new
pipelines. If a Director number cannot be sourced from `client-reports` or `analytics`, the fix
is to extend that module.

## 10. The client/server AI boundary — permanent

| Module | May be imported by | Contains |
|---|---|---|
| `lib/ai/models.ts` | **anything, including Client Components** | model ids, labels, descriptions, default. **Import-free — that is its entire purpose.** |
| `lib/ai/provider.ts` | server only | provider SDKs, streaming, tool loop |
| `lib/ai/usage.ts` | server only | Prisma-backed `AiCall` writes |
| `lib/ai/tools.ts` | server only | tool execution |
| any future Prisma-backed AI service | server only | |

**No `"use client"` module may import a server-side AI module, directly or transitively.**

This is not a style preference. `provider.ts` reaches the database through `usage.ts`, so a
Client Component importing it pulls `async_hooks`, `dns` and `net` into the browser bundle and
`next build` fails with a wall of module-not-found. It happened: `AiAssistant.tsx` imported its
model constants from `provider.ts`, and adding usage recording to `provider.ts` broke the build.

**tsc and Vitest both passed while it was broken** — the failure is bundling, not types. Two
regression tests in `tests/ai-optional.test.ts` hold the line, because no second-scale gate can
see this:

- no `"use client"` file imports `@/lib/ai/provider`, `@/lib/ai/usage` or `@/lib/ai/tools`
- `lib/ai/models.ts` contains no `import` and no `require`

When a Client Component needs something from the AI layer, the answer is a new import-free leaf
module or an API route — never an import that happens to work today because the server-only
code has not reached the database yet.

## 11. Capability vs object authorization — permanent

Two independent questions, answered by two independent layers. Conflating them is the failure
mode this section exists to prevent.

| Question | Answered by | Example |
|---|---|---|
| May an agent do this **kind of thing** for this role? | `lib/agent/authorization.ts` | "may it create tasks at all?" |
| May this user act on **this record**? | the CRM domain service | "may they touch lead X, in campaign Y, in tenant Z?" |

`CapabilityDecision` deliberately contains **no** lead, campaign, account or tenant field.
`decideCapability` takes no record argument. There is nowhere to pass an object, which makes
the separation structural rather than a convention someone has to remember.

### What an `auto` capability still cannot do

Even at `tasks = auto`, an agent cannot:

- act on another tenant's record — tenancy is enforced by the `$extends` layer on the Prisma
  client, and the agent holds no client
- act on a lead outside the user's CRM scope — `canAccessLead` in the domain route
- widen leadgen campaign or account scope — `lib/leadgen/*` owns those rules
- bypass assignment or the pod hierarchy — `canAccessUser` and `lib/podScoping.ts`
- bypass send-window permissions — `lib/sequences/permissions.ts`, which denies an SDR
  regardless of capability mode

`tests/agent-object-authorization.test.ts` asserts both halves: the agent layer holds no object
rules (no `canAccessLead(` call, no import of the helpers, no `prisma.<model>` beyond its own
`autonomyPolicy` and `aiCall`), and the domain layer still holds them all.

### The four structured outcomes

```text
ALLOW                       proceed
REQUIRE_USER_APPROVAL       permitted, a human must approve first
REQUIRE_MANAGER_APPROVAL    permitted, a manager must approve
DENY                        never automatable
```

The two approval outcomes stop execution today only because no approval queue exists. The
distinction is already carried in the decision, so Phase 6 turns them into approval *requests*
without rewriting a single rule.

### The refusal contract

A blocked action must never read as a completed one. Refusal text instructs the model to state
what needs approving — "do not describe it as done" is in the string on purpose, because the
most likely failure is not an unauthorized write but a confident report of a write that never
happened.

## 12. Agent tools call domain services, not our own HTTP API

The required shape for any CRM read or mutation:

```text
authenticated agent request
  → agent tool
  → shared CRM domain service
  → existing tenant / role / object authorization
  → database
```

Not this:

```text
agent tool → fetch('/api/…') → route → domain logic
```

An internal HTTP hop adds a second authentication surface for the same operation and invites
the worst possible fix — a bypass header, a forwarded token, a service account. **None of those
is acceptable.** `x-ai-internal` already exists in the tool code and is read by nothing; that is
the only reason it is harmless.

External provider calls are a different thing entirely and unaffected: Groq, Gemini, Tavily and
Jina are HTTP because they live on someone else's server.

### Known debt

`create_task` and `get_my_tasks` predate this rule. They `fetch` this app's `/api/tasks` with no
session cookie, and `getSessionUser` reads the session from cookies — so both return 401 today.
They fail **closed**, which is why this is a functional defect and not a security one, but they
do not work.

The repair is a domain-service extraction (`lib/tasks/*` owning create and list, with the route
and the tool both calling it), scoped to the tool/domain-service integration phase rather than
mixed into unrelated work. Until then `tests/agent-object-authorization.test.ts` carries those
two tools in a named exception list, so any *new* violation fails immediately and the debt stays
visible instead of becoming precedent.

## 13. Cost and reliability

- Per work order: `researchBudget`, `tokenBudget`, `maxToolCalls`, `maxExecutionDuration`.
  Exhaustion pauses the work order and reports partial completion — never a silent overspend.
- Priority is SLA-derived: prospect reply and meeting request outrank an interactive SDR
  command, which outranks work-order execution, which outranks bulk research. Bulk research
  must never delay a handoff.
- Model routing already exists in [`lib/ai/provider.ts`](../../lib/ai/provider.ts) (Groq
  default, Gemini fallback) but records no spend. Cost attribution is a prerequisite for any
  cost-per-meeting reporting.
