# Post-demo stabilization backlog

Findings recorded during the Phase 8a exact-SHA reviews and deliberately **not** fixed before the
demo. None of them blocks tomorrow's walkthrough. None of them is lost.

Frozen Phase 8a SHA: `0bf623ec1e59da60589abe856a1a9b935a8e6c0b` (parent `2046b768`).

---

## Status as of 2026-08-14 — `integrate/phase-8-10-final` @ `e222657`

Nothing below is deleted. Each item now carries what actually became of it.

| Item | Status | Where it was closed |
|---|---|---|
| S1 post-lock strand | **CLOSED** | `workers/sequence.ts` releases the claim in the `catch` before rethrowing |
| S2 occurrence-aware drift | **OPEN** | not addressed |
| S3 `Lead.sequenceStatus` legacy cache | **DEFERRED** | still compatibility-only; add no reader, no writer |
| S4 coarse `already_replied` dedupe | **OPEN** | not addressed |
| S5 Revenue AI → Telestar AI rename | **DEFERRED** | deliberately, unchanged |
| S6 `migration-order.test.ts` local run | **ENVIRONMENT-ONLY** | the `&` in the checkout path; green in CI |
| S7 ICP adherence not measured | **CLOSED** | `lib/leadgen/icpAdherence.ts` (`1f457ac`) |
| S8 variants aggregate as identical | **CLOSED** | `OutboundMessage.abVariantId` + `OutcomeSignal.abVariantId` (`7d65dfb`) |

The post-demo test debt at the bottom of this file is **partly closed**: the golden journey
(`tests/golden-journey.test.ts`) now covers the durable chain end to end. The deep crash-injection
matrix and the full concurrency permutations remain open.

---

## S1 — a post-lock exception can strand a locked task — **CLOSED**

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

## S7 — ICP adherence is not measured, only approximated — **CLOSED 2026-08-14**

**Where:** `lib/console/surfaces/leadgenManager.ts`.

The Phase 9 acceptance list names *ICP adherence*. What the surface reports is contactability,
duplicate rate, missing required fields and rejection reasons — all real, none of them a
percentage of delivered contacts that actually match the campaign's `CampaignLeadRequirement`
(target titles, countries, industries, company size).

Computing that needs a comparison `lib/leadgen/metrics.ts` does not expose, and building it inside
`lib/console` would be the second analytics backend Phase 9 exists to avoid.

**Fix shape:** extend `getLeadgenMetrics` with a per-campaign requirement-match rate, and read it
from the surface. The requirement row and the pool item both already carry everything needed.

> **Closed exactly that way.** `lib/leadgen/icpAdherence.ts` reads `CampaignLeadRequirement`
> through `matchRequirement` — the same matcher behind the per-lead assessment, exported rather
> than duplicated — and `getLeadgenMetrics` returns it as `icpAdherence`. Missing data reports as
> `unknown` rather than as a match, and a campaign with no criteria reads "not measured" instead
> of 0%.

---

## S8 — reporting does not separate sequence variants — **CLOSED 2026-08-14**

**Where:** Phase 10 attribution generally.

Outcome signals carry `playbookVersionId`, so "did version 4 do better" is answerable. They do not
carry the sequence **variant**, so an A/B test's two arms aggregate as if identical — which is the
one comparison an A/B test exists to make.

`OutcomeSignal.sequenceId` is populated; the variant is not, because the signal is derived from a
reply and the reply does not record which variant produced the message it answers.

**Fix shape:** carry the variant on `OutcomeMessage`/`OutboundMessage` at send time, then resolve
it when collecting. Do not infer it from timing.

> **Closed exactly that way.** `OutboundMessage.abVariantId` is written in the same statement that
> records the send (migration `20260816000000`), the collector resolves it from the last
> variant-carrying send at or before the outcome, and `OutcomeSignal.abVariantId` keeps it as a
> **separate axis** from `playbookVersionId`. Approved per-prospect copy attributes to no variant:
> the approval overrode selection, so nothing was on trial.

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
