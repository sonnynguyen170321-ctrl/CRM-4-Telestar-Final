---
id: email-automation
version: 1.0.0
domain: email-automation
risk: R3
sources: [lib/sequences/**, lib/automation/**, lib/email/**, app/api/sequences/**]
---

# Sequences, scheduling, sending

**LOAD WHEN** changing sequences, scheduling, enrolment, send windows, suppression, or A/B
variants.

**DO NOT LOAD WHEN** the question is mailbox health or sending reputation — that is
`email-deliverability`.

## Core invariants

- **Only `lib/automation/scheduling.ts` computes a schedule.** Not a component, not a worker,
  not the preview endpoint — the preview calls the same function server-side precisely so it
  cannot drift from what the worker does.
- **Jitter and A/B selection are seeded from durable ids** (`tenantId + sequenceId + stepId +
  leadId`), never `Math.random()`. This is why the builder reconciles steps **by id** rather
  than delete-and-recreate: new step ids would re-roll send times and re-bucket every
  in-flight lead.
- **Email counts as sent only on provider confirmation.** Never write an `email_sent` activity
  from intent.
- **Every send goes through `OutboundMessage`** and passes a suppression check first.
- **Quota exhaustion is a `DEFER`, not a failure**, and the deliverability preflight runs
  *before* quota reservation so a blocked send never burns a slot.
- **One active sequence per lead.** Enrolling in another auto-unenrols from the current one.
- **No step deletion while active enrollments exist.**

## Known failure modes

- **Delete-and-recreate on save.** The most expensive available mistake here: it silently
  reschedules every in-flight lead and re-buckets every A/B assignment, and nothing errors.
- **Sequence fields mutated through the generic Lead API**, bypassing engine invariants.
- **`Lead.sequenceStatus` treated as truth.** It is a legacy compatibility cache with nothing
  keeping it honest. `SequenceEnrollment` is authoritative; where they disagree, the enrollment
  is right. Add no new reader and no new writer.
- **Auto-unenrolment missed.** A reply, a bounce, or a stage change to Meeting Booked / Won /
  Lost must stop the sequence. Missing one keeps emailing someone who already answered.
- **Timezone and business-day arithmetic** applied at the wrong layer, producing sends at 3am
  local or on weekends.

## Required tests

```
tests/scheduling.test.ts          tests/defer-scheduling.test.ts
tests/eligibility.test.ts         tests/weekend-policy.test.ts
tests/businessDays.test.ts        tests/sequence-*.test.ts
tests/email-idempotency.test.ts   tests/email-safety.test.ts
tests/unsubscribe.test.ts         tests/variant-attribution.test.ts
tests/demo-email-barrier.test.ts
e2e/journeys/automation*.spec.ts
```

## Eval cases

- a prospect receives step 3 twice → idempotency + scheduling, R3
- editing a sequence shifts every in-flight send → step reconciliation by id, R3
- an unsubscribed contact receives a send → suppression check ordering, R3
