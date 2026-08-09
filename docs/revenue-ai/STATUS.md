# Telestar Revenue AI — STATUS

**Read this first.** Then execute the next unchecked item in [`PLAN.md`](PLAN.md).

| | |
|---|---|
| Phase | **0–3 complete.** Next: Phase 4 — `CampaignPlaybook` + versioning |
| Branch | `feat/prospect-operating-state` |
| Blockers | **None.** The Phase 3 state-model decision is made — see below. |
| Restrictions | No external users, no real client data, sending off, email dry-run |

> **Every agent tool now runs under capability authorization.** `create_task` — the one
> pre-existing write-capable tool — is mapped to `tasks` and enforced, not grandfathered.
> `executeTool` fails closed on an unregistered tool, on a write capability with no role in
> context, and on anything short of a clean allow.

## Gates — verified 2026-08-09, local

| Gate | Result |
|---|---|
| `next build` | exit 0 |
| `tsc --noEmit` | 0 errors |
| `eslint app components lib context tests` | 0 errors, 0 warnings |
| `vitest run` | 891 passed, 5 skipped, 69 files |
| `prisma migrate status` | up to date, 31 migrations |

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
