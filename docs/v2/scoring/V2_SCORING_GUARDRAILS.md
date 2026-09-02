# Lead Gen Intelligence — Scoring Guardrails

**Status:** Draft for review  
**Purpose:** prevent Codex or future agents from changing scoring behavior accidentally.

## 0. Non-negotiables

```txt
Do not make AI the source of truth.
Weak benchmark output is not production truth.
AI agent output is not production truth.
Do not mutate old HardRuleAssessment rows.
Do not mutate AiInsight snapshots.
Do not mutate FeedbackExample history.
Do not auto-learn rules without human approval.
Do not score Company globally.
Always score LeadAssignment + ICPVersion.
Use QUALIFIED / NEEDS_REVIEW / UNQUALIFIED.
Do not use uncertain as canonical qualification output.
```

Implementation is frozen before V2.A2 because weak ICP benchmark and external logic review exposed that ICP scoring runtime behavior is still under-specified.

Do not proceed to:

```txt
V2.A2 Manager Review
V2.9 UI shell
V2.10 Company/Lead review UI
runtime scoring implementation
benchmark scripts
schema/migrations
API routes
UI routes/components
```

## 1. HardRuleAssessment

HardRuleAssessment is immutable.

If input/rules/evidence changes:

```txt
create new assessment snapshot
link to previous if needed
mark old snapshot as superseded/outdated at read time
```

## 2. AI Insight

AI Insight may include:

```txt
company brief
company ICP fit summary
pain points
target vertical
persona
project-specific SDR angle
recommended next action
```

AI Insight must not:

```txt
overwrite rule score
overwrite SDR final review
overwrite manager review
auto-change export final values
```

## 3. FeedbackExample

FeedbackExample is append-only.

Pilot wording:

```txt
feedback-driven tuning
human-in-the-loop improvement
```

Avoid implying self-learning unless that feature is actually built.

## 4. Tests required before wiring to DB/API

```txt
missing website policy tests
service_only vs service_plus_product tests
B2C / excluded country tests
positive product evidence tests
low data quality tests
conflicting signal tests
confidence vs score tests
V1 parity fixture tests
```

## 5. ICP scoring guardrails

Company-only data may pre-rank accounts but must not overclaim final qualification for persona-sensitive ICPs.

Any ICP implementation must separate:

```txt
fitScore
confidenceScore
evidence quality
required evidence
persona readiness
accountPreRank
final qualification
```

Canonical confidence scale:

```txt
ConfidenceScore = integer 0..100
HIGH: >= 75
MEDIUM: >= 45 and < 75
LOW: < 45
```

Canonical qualification values:

```txt
QUALIFIED
NEEDS_REVIEW
UNQUALIFIED
```

Benchmark scripts must not call live AI providers. AI assessment fields are imported/human-filled advisory data only.


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
