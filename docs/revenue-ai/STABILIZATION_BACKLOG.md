# Post-demo stabilization backlog

Findings recorded during the Phase 8a exact-SHA reviews and deliberately **not** fixed before the
demo. None of them blocks tomorrow's walkthrough. None of them is lost.

Frozen Phase 8a SHA: `0bf623ec1e59da60589abe856a1a9b935a8e6c0b` (parent `2046b768`).

---

## S1 — a post-lock exception can strand a locked task

**Where:** `workers/sequence.ts`, `handleExecuteTask`.

After the execution claim (`lockedAt: null → lockedAt = now`) succeeds, a failure while creating
the `OutboundMessage` or enqueueing `EMAIL_SEND` leaves the task `pending` **and** locked. The
worker's own claim then excludes the retry, and `repairMissingDelayed` filters `lockedAt: null`, so
neither path picks it up.

Only the deliberate refusal paths release the lock today (occurrence lost, step changed). The
exception path does not.

**Fix shape:** wrap the post-lock section so any throw releases the claim, or give the repair sweep
a stale-lock cutoff like `app/api/cron/sequence-engine/route.ts` already uses.

---

## S2 — schedule-drift detection is not occurrence-aware

**Where:** `workers/maintenance.ts`, `repairEnrollmentScheduleDrift`.

The *repair* now goes through `ensureOccurrenceStepTask` and carries occurrence identity. The
*detection* in front of it is still a generic lookup:

```ts
prisma.task.findFirst({ where: { leadId, sequenceId, sequenceStep, status: 'pending' } })
```

A pending task belonging to a different occurrence of the same lead and sequence therefore counts
as "this one has a task", and the drifted occurrence is skipped.

**Fix shape:** probe `enrollmentStepTaskId(enr.id, enr.currentStep)` first and treat the generic
lookup as the documented pre-Phase-8a fallback only.

---

## S3 — `Lead.sequenceStatus` remains a legacy cache

Unchanged from `ARCHITECTURE.md` §4.1. `handleEmailSync` still gates reply processing on
`sequenceStatus === 'active'` before the authoritative enrollment is consulted inside
`handleApplyReply`. A stale cache can therefore drop a reply *before* the chokepoint.

**Fix shape:** gate the sync loop on the enrollment, or drop the pre-filter entirely and let the
chokepoint decide.

---

## S4 — coarse `already_replied` dedupe

`handleApplyReply` skips any lead already at stage `replied`, so a second genuine reply from the
same prospect is suppressed. Pre-existing, pre-dates Phase 8b, and now slightly more visible
because class B replies deliberately do **not** set that stage.

---

## S5 — deferred rename

Revenue AI → Telestar AI Architecture. Still deferred, on purpose.

---

## S6 — `tests/migration-order.test.ts` cannot run locally

`SyntaxError: Invalid or unexpected token`, caused by the `&` in the checkout path
`C:\Users\admin\Desktop\Sonny & AI\...`. Green in CI. Do not modify the spec to hide it.

---

## Post-demo test debt (explicitly deferred by the demo-mode instruction)

- deep crash injection beyond the six resume points already covered
- the full concurrency matrix
- remaining maintenance edge cases
- queue failure permutations
