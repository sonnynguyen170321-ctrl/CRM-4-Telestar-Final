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

## 4. Operating state vs sales stage

`Lead.stage` answers **"where is this prospect in the sales process?"**
`ProspectOperatingState` answers **"who or what should be acting right now?"**

```text
Lead.stage: replied          ProspectOperatingState: human_attention
Lead.stage: replied          ProspectOperatingState: waiting_for_prospect   (SDR answered)
Lead.stage: replied          ProspectOperatingState: reengagement_eligible  (5 days silent)
```

Proposed states: `unassigned`, `researching`, `ready_for_outreach`, `ai_managed`,
`human_attention`, `human_managed`, `waiting_for_prospect`, `reengagement_eligible`,
`ai_reengagement`, `completed`.

> **Open modeling question — must be resolved before this ships.** This would be the *fourth*
> state field on one path: `Lead.stage`, `Lead.sequenceStatus`, `SequenceEnrollment.status`,
> and operating state. `Lead.sequenceStatus` already mirrors `SequenceEnrollment.status` by
> hand — every mutation path in [`../automation-engine/DOMAIN_MAP.md`](../automation-engine/DOMAIN_MAP.md)
> §1–2 writes both, with no constraint keeping them consistent. Adding a fourth field before
> collapsing that mirror multiplies the drift surface rather than reducing it. See PLAN Phase 3.

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

## 9. Cost and reliability

- Per work order: `researchBudget`, `tokenBudget`, `maxToolCalls`, `maxExecutionDuration`.
  Exhaustion pauses the work order and reports partial completion — never a silent overspend.
- Priority is SLA-derived: prospect reply and meeting request outrank an interactive SDR
  command, which outranks work-order execution, which outranks bulk research. Bulk research
  must never delay a handoff.
- Model routing already exists in [`lib/ai/provider.ts`](../../lib/ai/provider.ts) (Groq
  default, Gemini fallback) but records no spend. Cost attribution is a prerequisite for any
  cost-per-meeting reporting.
