# Telestar Revenue AI — STATUS

**Read this first.** Then execute the next unchecked item in [`PLAN.md`](PLAN.md).

| | |
|---|---|
| Phase | **0 complete.** Next: Phase 1 — cost attribution + the AI-optional test |
| Branch | `feat/revenue-ai-foundation` |
| Blockers | None. One decision owed before Phase 3 (see below). |
| Restrictions | No external users, no real client data, sending off, email dry-run |

## Gates — verified 2026-08-09, local

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint app components lib context tests` | 0 errors, 0 warnings |
| `vitest run` | 793 passed, 5 skipped, 63 files |
| `prisma migrate status` | up to date, 27 migrations |

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

## Decision owed before Phase 3

`ProspectOperatingState` would be the fourth state field on one path: `Lead.stage`,
`Lead.sequenceStatus`, `SequenceEnrollment.status`, plus the new one. `Lead.sequenceStatus`
already mirrors `SequenceEnrollment.status` by hand — every mutation path in
[`../automation-engine/DOMAIN_MAP.md`](../automation-engine/DOMAIN_MAP.md) §1–2 writes both,
with no constraint keeping them honest.

Either make the lead column derived, or declare the enrollment authoritative and the column an
explicitly-refreshed cache. Adding a fourth field first multiplies the drift surface instead of
reducing it. **The decision, not the implementation, is what blocks Phase 3.**

## Sequencing rationale

Two phases are ordered earlier than the original proposal had them, on purpose:

- **Cost attribution before any dashboard.** The Director surface quotes cost per meeting.
  Nothing records spend today, so that number cannot exist until `provider.ts` captures it.
- **Autonomy before any write-capable tool.** Retrofitting a permission model onto tools that
  already write is how a policy flag ends up ignored by four code paths.

Level 4 autonomy — AI-managed two-way prospect conversations — is out of scope for this plan
entirely, not a later phase of it.
