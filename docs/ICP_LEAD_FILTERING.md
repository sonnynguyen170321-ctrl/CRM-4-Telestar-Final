# ICP lead filtering

Deterministic ICP scoring applied when a lead record arrives, ported from the leadgen app.

## What was there before

`LeadPoolItem.icpFitScore` and `dataQualityScore` existed as columns and **no code wrote to them**.
The only real ICP measurement, `CampaignLeadRequirement`, runs *after* a pool record is converted into
a Lead — a report on what was already let through, not a gate.

So a pool of tens of thousands of records had no way to answer "which of these actually match the
customer we sell to", and the two score columns rendered blank forever.

## The model

Four things that used to be conflated stay separate:

| Concept | Where | Mutable |
| --- | --- | --- |
| `qualification` | `LeadPoolItem` | Yes — what a **reviewer** decided |
| `icpQualification` | `LeadPoolItem`, mirrored | No — what the **rules** computed |
| `LeadPoolAssessment` | own table, insert-only | Never |
| `CampaignLeadRequirement` | unchanged | The delivery contract with the client |

"A human qualified it but the ICP would not" is a real and useful query, and it is only expressible
because the two verdicts are two columns. The pool browser filters on each independently.

Verdicts are `qualified` / `needs_review` / `unqualified`. There is no `uncertain`.

## Assessments are insert-only

A score is never updated. Each run inserts a `LeadPoolAssessment` carrying the full input snapshot and
the full rules snapshot, then moves `LeadPoolItem.latestAssessmentId` to it in the same transaction.
The mirror columns (`icpFitScore`, `dataQualityScore`, `icpQualification`) exist for list queries and
are always derived from the pointed-at assessment.

`fingerprint` is a hash of the input snapshot plus the rules snapshot, unique on
`(tenantId, poolItemId, fingerprint)`. Re-running with unchanged inputs and unchanged rules reuses the
assessment that exists rather than appending an identical one — which is what makes a rescore
convergent instead of an ever-growing log.

**NOT SCORED is derived**, from `latestAssessmentId IS NULL`. No placeholder row is ever created for a
display state. The pool browser shows it explicitly rather than leaving the cell blank, because "no ICP
is configured yet" and "scored, and unremarkable" are different facts.

## When scoring happens

- **At import** — `workers/import.ts` calls `scoreImportedPoolItem` after each pool record is written.
  It swallows its own failures on purpose: the record is already in the pool by then, and letting a
  missing ICP turn a successful import into a failed row would lose the import to protect a number.
- **At promotion** — research promotion calls the same function, so a discovered lead is judged by the
  same rules as an uploaded one.
- **On demand** — `POST /api/leadgen-pool/rescore` (manager only) for `ids`, a `campaign`, or every
  `unscored` record. The last is the common case after an ICP is configured for the first time. The
  "Score not-scored" button in the pool browser drives it.

The ICP version comes from the record's campaign when it has one, otherwise the tenant's default
profile. A record with neither is reported as skipped, never guessed at.

## Where the rules come from

`@telestar/core-scoring` — the same package the leadgen app scores with, database-agnostic by lint
rule. Its dimensions, dictionaries and golden cases travel with it, so the two applications cannot
drift into scoring the same company differently.

## Identity

Scoring is only as good as the record it scores, so both entry points resolve companies through
`lib/identity/resolveAccount.ts` and people through `resolveContact.ts` — one writer each. Account
resolution is canonical domain → normalised name → raw name, with Vietnamese legal forms folded, so
"Công ty TNHH ABC", "CTY TNHH ABC" and "ABC Co.,Ltd" resolve to one Account instead of three.

Records that predate this need `npm run backfill:account-identity` — see the header of
`scripts/backfill-account-identity.ts`. It is dry-run by default and one-way with `--apply`.
