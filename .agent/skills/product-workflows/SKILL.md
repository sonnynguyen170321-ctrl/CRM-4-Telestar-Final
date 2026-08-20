---
id: product-workflows
version: 1.0.0
domain: product-workflows
risk: R2
sources: [lib/leads/**, lib/tasks/**, lib/activities/**, app/api/leads/**, app/api/tasks/**]
---

# Leads, tasks, activities

**LOAD WHEN** changing lead lifecycle, tasks, activities, notes, reminders, or stage
transitions.

**DO NOT LOAD WHEN** the change is purely presentational — that is `frontend-role-ux`.

Full product specification: `SKILL.md` at the repository root. This skill carries only what is
easy to get wrong.

## Pipeline

```
New → Sequence Active → Replied → Meeting Booked → Won / Lost
```

A lead's data chain is `lead → campaign → client`. Leads belong to campaigns, not to people;
assignment is a separate axis from ownership.

## Core invariants

- **Every meaningful action writes an `activities` row, and the backend owns that** — not the
  component. It is the source of truth for the leaderboard, coaching and client reporting, so
  a write that only happens on one code path produces a metric that is quietly wrong.
- **Archive is not delete.** Hard delete for archive is forbidden.
- **Three distinct state axes**, never merged: `Lead.stage` is the sales lifecycle;
  `SequenceEnrollment` (status, `nextActionAt`, `pausedReason`, `currentStep`) is the
  authoritative execution lifecycle; `ProspectOperatingState` is who or what is responsible now.
- **`Lead.sequenceStatus` is a legacy compatibility cache.** Nothing keeps it honest. Where it
  and the enrollment disagree, the enrollment is right. Add no new reader, no new writer.
- **Handoff to a human is automatic; handback is not.** A meaningful reply moves a lead to
  `human_attention` on its own. Nothing leaves `human_managed` without an explicit action.

## Known failure modes

- **Activity written from the UI.** Works for the path someone tested, missing everywhere else,
  and the gap only shows up as a manager asking why a rep's numbers look low.
- **Stage changed without its consequences** — sequences not unenrolled, tasks not closed,
  notifications not sent.
- **Metadata shape drift.** Each activity type has a defined metadata shape; a new type that
  invents its own breaks every consumer that reads the field.
- **Task completion semantics by channel.** A phone task opens the call-logging modal and does
  not auto-close; LinkedIn and WhatsApp use "Log & Complete". Skipping bypasses the modal.

## Required tests

```
tests/lead-lifecycle.test.ts        tests/activities.test.ts
tests/lifecycle-integration.test.ts tests/prospect-operating-state.test.ts
tests/lead-reference-integrity.test.ts
e2e/leads/**
```

## Eval cases

- a rep's activity count is lower than their real work → backend activity logging, R2
- a lead keeps receiving sequence steps after replying → auto-unenrolment, R3
- stage shows Won while the enrollment is still active → state-axis confusion, R2
