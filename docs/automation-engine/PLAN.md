# Automation Engine — Plan

> Companion to [`ARCHITECTURE.md`](ARCHITECTURE.md) (the layering contract) and
> [`DOMAIN_MAP.md`](DOMAIN_MAP.md) (every mutation path in the domain).
> Resume pointer: [`STATUS.md`](STATUS.md) — **read that first.**

This plan was written after the work landed, from the shipped code, not before it. It exists
because `DOMAIN_MAP.md §8` names phases 2–8 as the owners of ten gaps and no file ever said
what those phases were. Everything below is checked against an artifact in the tree; where a
phase number came from a code comment rather than an original roadmap, the source comment is
cited.

## Scope boundary

The engine decides **when** an automated step may run and **whether** it may run at all. It does
not own sending (that is the email worker + `OutboundMessage`), inbox sync, or the CRM state
machine. It sits between them, as the second layer of `ARCHITECTURE.md`.

## Phases

### Phase 0–1 — Domain survey and architecture contract

- [x] Enumerate every `SequenceEnrollment`, `Lead.sequence*`, `Task`, and `OutboundMessage`
      mutation path with file:line — `DOMAIN_MAP.md §1–4`
- [x] Record the layering, the invariants, and the timezone precedence chain — `ARCHITECTURE.md`
- [x] Identify the direct-send path that bypasses the pipeline — `DOMAIN_MAP.md §5`

### Phase 2 — Cadence vs policy separation (spec §7)

- [x] Split "when the step is logically due" (delayDays + delayHours) from "when execution is
      permitted" (send window, business days, timezone). Both live in
      [lib/automation/scheduling.ts](../../lib/automation/scheduling.ts) — nothing in a React
      component or a worker computes a schedule any more.

### Phase 3 — Timezone resolution (spec §8)

- [x] [lib/automation/timezone.ts](../../lib/automation/timezone.ts): Lead → User → tenant
      default → `UTC`, with IANA validation. Never guesses from country, phone, email domain
      or IP.

### Phase 4 — Central scheduling + deterministic jitter (spec §9, §10)

- [x] `calculateNextActionAt` as the single scheduling entry point
- [x] [lib/automation/jitter.ts](../../lib/automation/jitter.ts): offset derived from
      `tenantId + sequenceId + stepId + leadId`, so rebuilding from the database reproduces the
      same timestamp. No `Math.random()` anywhere in the scheduling path.
- [x] Send window snapping: before window → window start + jitter; after → next day's start

### Phase 5 — Schema: durable schedule state

- [x] `prisma/migrations/20260809131000_automation_engine_phase3/`:
      `SequenceStep.sendWindowStartMinutes` / `sendWindowEndMinutes`,
      `SequenceEnrollment.nextActionAt` / `pausedReason` / `lastTransitionAt` / `lastEvaluatedAt`,
      plus `nextActionAt` and `(status, nextActionAt)` indexes
- [x] Additive only — the existing `status` enum is untouched (`ARCHITECTURE.md` invariant 5)

### Phase 6 — Eligibility engine (spec §11–13)

- [x] [lib/automation/eligibility.ts](../../lib/automation/eligibility.ts) returns one of five
      decisions: `ALLOW` / `BLOCK` / `DEFER` / `TERMINATE` / `MANUAL_REQUIRED`
- [x] Wired into the worker at
      [workers/sequence.ts:271](../../workers/sequence.ts) — the worker no longer invents policy
- [x] `DEFER` distinguished from `BLOCK`: deferral carries `nextEligibleAt`, block does not

### Phase 7 — Quota exhaustion becomes a deferral, not a death

- [x] [workers/email.ts](../../workers/email.ts): `atomicReserveQuota` failure re-schedules to the
      next quota window with a `quota:<resumeAt>` discriminator, capped by a max-deferrals
      constant so a permanently starved message still terminates
- [x] Deliverability preflight runs **before** quota reservation, so a blocked send never burns a
      slot it cannot use (quota is not refunded)

### Phase 8 — Queue reconciliation (`repairMissingDelayed`)

- [x] [workers/maintenance.ts](../../workers/maintenance.ts) now re-enqueues the BullMQ job
      instead of only re-locking the task, and records the enqueue failure in `details` rather
      than reporting success on a restore that did not happen

### Phase 9 — Cron route joins the pipeline

- [x] [app/api/cron/sequence-engine/route.ts](../../app/api/cron/sequence-engine/route.ts)
      routes through `createOutboundMessage` + `enqueueEmailSendWorkflow`. The direct
      `EmailService.fromAccount()` send flagged in `DOMAIN_MAP.md §5` is gone, so every send in
      the system has an `OutboundMessage` row.

### Phase 10 — Deterministic A/B selection (spec §42)

- [x] [workers/sequence.ts](../../workers/sequence.ts) picks the variant from the same durable
      seed as the jitter. Re-running a job cannot re-bucket a lead.

### Phase 11 — Step reconciliation in the builder

- [x] [lib/sequences/steps.ts](../../lib/sequences/steps.ts): the builder used to save by deleting
      and re-creating every step, which (a) deleted rows out from under active enrollments and
      (b) re-rolled jitter and A/B buckets for every in-flight lead on any edit. Steps are now
      reconciled by id.

### Phase 12 — Send-window permissions (spec §40)

- [x] [lib/sequences/permissions.ts](../../lib/sequences/permissions.ts): `director` and
      `floor_manager` only. A send window is a deliverability lever in the same class as the
      per-mailbox cap; SDRs see the resulting cadence but cannot move it.

### Phase 13 — Cadence preview (spec §28)

- [x] [app/api/sequences/preview/route.ts](../../app/api/sequences/preview/route.ts) computes the
      preview **server-side** through the same `calculateNextActionAt`, so the preview cannot
      drift from what the worker will do
- [x] [components/sequences/SequencePreview.tsx](../../components/sequences/SequencePreview.tsx)
      labels it "estimated" on purpose — the real time is re-decided at execution against live
      CRM state

### Phase 14 — Deferral is visible in the timeline

- [x] `prisma/migrations/20260809210000_automation_deferral_activity/` adds the
      `sequence_deferred` activity type. A deferral is a scheduling event the lead timeline has
      to be able to explain; reusing an outreach type would have misreported it.
- [x] `pausedReason` surfaces in
      [components/LeadDetailPanel.tsx](../../components/LeadDetailPanel.tsx)

### Phase 15 — Test coverage (spec §41–50, §52)

- [x] Unit/integration: `tests/scheduling.test.ts`, `tests/eligibility.test.ts`,
      `tests/defer-scheduling.test.ts`, `tests/lifecycle-integration.test.ts`,
      `tests/queue-reconciliation.test.ts`, plus extensions to `tests/email-worker.test.ts` and
      `tests/sequence-execute.test.ts`
- [x] E2E: `e2e/journeys/automation.spec.ts` (6 journeys),
      `e2e/roles/automation-roles.spec.ts` (3 role gates)

## Follow-ups not in this phase set

- [x] **The `/automation` operator dashboard does not surface deferral state.** Closed by the
      Email Automation lane (Plan 1 §A6). [`lib/automation/operatorState.ts`](../../lib/automation/operatorState.ts)
      derives one reason per in-flight cadence from state the engine already stores —
      `SequenceEnrollment.status`, `nextActionAt`, `pausedReason`, the current step's task and
      the mailbox row — and `/api/automation/stats` returns it as a machine-stable `reasonCode`
      plus an operator-facing `reasonLabel` and `detail`. `sequence_deferred` is also in the
      activity feed's filter now; it was written to the database and filtered out of the only
      page an operator watches, which made every deferral invisible.

      No new column. A stored "reason" would be a second source of truth that could disagree
      with the enrollment; where the two ever differ, the engine is right.
- [x] **`Activity` icon on `/automation` uses `animate-pulse`.** Removed. An
      `e2e/journeys/automation-operator.spec.ts` case asserts the class does not come back.
- [ ] **No backfill for `nextActionAt` on enrollments created before the migration.** Still open.
      They are scheduled from `Task.dueDate` as before, which is correct but means the column is
      null for historical rows and cannot be used as a sole query key until a backfill runs. The
      operator surface handles this by falling back to the task's due date.
