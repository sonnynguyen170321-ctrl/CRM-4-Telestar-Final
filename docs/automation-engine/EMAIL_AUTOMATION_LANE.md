# Email Automation + Sequence Execution — lane handoff

Branch: `integrate/phase-8-10-final` (this lane's work lands directly on it).
Baseline it started from: `4db6ce8`.

This lane owns the prospect-communication side: `lib/automation/**`, `lib/email/**`,
`lib/sequences/**`, `workers/email.ts`, `workers/sequence.ts`, the email/sequence jobs, routes,
UI and tests. It deliberately did **not** touch the leadgen pool, qualification, campaign lead
requirements, lead conversion, the Leadgen Manager UI, or Phase 10 proposal learning.

## What was already true, and was not rebuilt

The audit found the execution spine in better shape than the plan assumed. Nothing here is new:

| Concern | Owner |
|---|---|
| what happens next | `evaluateAutomationEligibility` |
| *when* it happens | `calculateNextActionAt` — the only scheduler |
| execution lifecycle | `SequenceEnrollment` + `nextActionAt` / `pausedReason` |
| durable send truth | `OutboundMessage` status machine |
| provider contact | `workers/email.ts`, nowhere else |
| reply consequence | `applyReplyClassification`, one chokepoint |
| ambiguity resolution | `workers/maintenance.ts` |

Occurrence-scoped enrollments, the `lockedAt: null` task CAS, the `sending` →
`reconciliation_required` rule, quota-as-deferral with a cap, deterministic jitter and A/B from
durable seeds, step reconciliation by id, and the reply classes A–D all predate this lane.

## What this lane added

### Proof (§A2, §A3, §A5)

- `tests/sequence-ladder.test.ts` — the three-step schedule: windows, business days, timezone
  resolution, recomputation stability, per-lead jitter buckets, and step-order gating.
- `tests/sequence-ladder-execution.test.ts` — the same ladder executed against an in-memory
  store, asserting **durable state**: the enrollment reaches step 2, the step-2 task carries the
  scheduler's exact timestamp, `nextActionAt` and `Lead.nextTaskDue` agree with it, and step 3
  has no row until step 2 completes.
- Interruptions are proven by letting the **already-queued** step-2 job wake up after the
  interruption and refuse on its own — reply, meeting booked, hard bounce, suppression, SDR
  takeover, won/lost, campaign paused, and a disconnected mailbox (which holds and notifies
  rather than stopping). Nothing is cancelled first; a queue is not a safety mechanism.
- Two crash windows: **database write succeeded, enqueue failed**, and **enqueue succeeded,
  process died before the task completed**. Both converge to exactly one outbound occurrence.
- `tests/email-worker.test.ts` gained an explicit timeout case: a provider timeout must never
  become `failed` → resend. It parks at `reconciliation_required` and the retry stops before the
  provider.

### The operator surface (§A6)

`lib/automation/operatorState.ts` answers "why did this prospect not get Email 2 today?" from
state the engine already stores. It returns a machine-stable `reasonCode`, an operator-facing
`reasonLabel` and `detail`, `nextActionAt`, and `needsAttention`.

A test asserts structurally that no engine vocabulary — `DEFER`, `BLOCK`, queue, job, worker,
enqueue, Redis, enrollment — reaches the strings an operator reads.

`/api/automation/stats` returns the waiting list, scoped through `getLeadWhereScope` so the page
cannot become a way to enumerate a colleague's prospects, and `sequence_deferred` is now in the
activity feed filter.

### Personalization without send authority (§A4)

The original plan put personalization just before `createOutboundMessage`. That was rejected for
good reason: an LLM call in the execution spine makes the copy depend on whether a provider
answered, spends tokens on retries before the durable row exists, and puts provider latency on
the worker's critical path. "AI is down" has to mean the approved sequence still goes out
unchanged.

The rule now: **by the time a sequence task is executable, its prospect-facing content is already
durable, and the sequence worker never asks a model what to say.**

- `SequenceStepCopy` (`prisma/migrations/20260814010000_sequence_step_copy/`) stores approved
  copy keyed by `(enrollmentId, stepOrder)` — the occurrence, not the lead, so a replacement
  cadence cannot inherit copy approved for the one it replaced.
- `lib/sequences/stepCopy.ts` writes it. It takes plain strings and imports nothing from
  `lib/ai`; whoever approved resolved the content first.
- `launchAIOutreach` materializes it **between** `prepareEnrollment` and `finalizeFirstStep`, so
  a crash leaves copy with no cadence rather than a cadence with no copy.
- `workers/sequence.ts` reads it and falls back to the shared `Template` when absent. A/B
  selection is skipped when approved copy exists — the approval already decided.
- `SEQUENCE_AI_PERSONALIZATION` gates *writing*, and defaults off. Reading durable approved
  content is always safe.
- `tests/sequence-step-copy.test.ts` enforces the boundary structurally: no file in the send path
  and no file under `lib/sequences/` may import the AI layer.

## The gap that remains, and it is the important one

**Nothing yet hands an approved draft to the launch.** `prepareProspectOutreach` still returns
its grounded draft in memory and advances the prospect to `ready_for_outreach`; the copy is
discarded there. `launchAIOutreach` now *accepts* `approvedCopy`, but no caller passes it.

So the storage and execution halves of §A4 are done and proven; the approval hand-off is not
wired. Wiring it means carrying the draft from the `sequence_design` work order to the
`outreach_launch` work order — deliberately left to the phase that owns that approval boundary,
because inventing a hand-off here would have meant deciding where an approval is recorded, and
that is not this lane's call.

Until then every cadence uses its shared template, exactly as before.

## Gates

Run from the repository root, through node directly (the checkout path contains `&`, which
breaks npm `.bin` shims):

```bash
npm run check:migration-order
node node_modules/prisma/build/index.js validate
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5432/telestar_shadow" --exit-code
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app components lib context tests workers
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vitest/vitest.mjs run
```

> `prisma generate` fails on Windows with `EPERM … query_engine-windows.dll.node` while a dev
> server is running. Stop it before `next build`. The TypeScript client is written before that
> rename, so `tsc` passes on a stale engine binary — do not read a green `tsc` as evidence that
> `generate` succeeded.

**Do not accept exit 0 as evidence.** Read the discovered counts: a Vitest invocation that runs
zero tests also exits 0, and that has already happened once on this integration.
