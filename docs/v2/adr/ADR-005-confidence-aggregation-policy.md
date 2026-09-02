# ADR-005: Confidence Aggregation Policy

Status: **V2.ICP0R repaired**

## Context

Weak ICP benchmark review and external logic review exposed that ICP scoring confidence was under-specified. The previous 0..1 confidence model and lowercase qualification language are no longer canonical.

Implementation is frozen before V2.A2, V2.9, V2.10, runtime scoring, schema, API, UI, and benchmark scripts until this docs-only repair is reviewed.

## Decision

Confidence remains separate from fit score and final qualification.

Canonical confidence contract:

```ts
type ConfidenceScore = number; // integer 0..100
type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";
```

Bands:

```txt
HIGH: >= 75
MEDIUM: >= 45 and < 75
LOW: < 45
```

Canonical policy names:

```ts
type ConfidencePolicy = {
  highConfidenceThreshold: number;   // 75
  mediumConfidenceThreshold: number; // 45
};
```

Confidence evidence breakdown:

```ts
type ConfidenceEvidenceBreakdown = {
  companyIdentity: number;      // 0-15
  companyEvidence: number;      // 0-25
  geographyEvidence: number;    // 0-20
  employeeSizeEvidence: number; // 0-15
  personaEvidence: number;      // 0-25
};
```

Repair decisions:

- `personaEvidence` is upgraded from `20` to `25`.
- `sourceLineage` is metadata/audit only and not part of confidence scoring.
- `websiteStatus reachable` is not a separate confidence bonus in this phase.
- `websiteStatus` should drive missing website policy, review flags, or hard gates to avoid double-counting.

Canonical qualification values:

```ts
type Qualification = "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";
```

Rules:

- `LOW` confidence cannot produce `QUALIFIED`.
- Missing required final evidence produces `NEEDS_REVIEW` unless a confirmed hard disqualifier produces `UNQUALIFIED`.
- `HIGH` or `MEDIUM` hard disqualifier hit is confirmed and produces `UNQUALIFIED`.
- `LOW` hard disqualifier hit is possible/ambiguous and produces `NEEDS_REVIEW`.
- Company-only data may produce `accountPreRank`, but it must not produce final `QUALIFIED` for persona-sensitive ICPs when `blocksFinalQualificationFromCompanyOnlyEvidence` is true.

## Consequences

- A company can have high fit score but still require review.
- A company can have high confidence in a negative outcome.
- Confidence policy changes must be versioned with rule snapshots.
- Future schema must store fit score, confidence score, qualification, missing evidence, hard disqualifier hits, and explanation separately.
- AI output and weak benchmark output are not production truth.

## Non-goals

- No schema.
- No migration.
- No runtime scoring implementation.
- No benchmark script.
- No live AI calls.
- No V1 behavior change.

## Related files/specs

- `docs/v2/scoring/V2_SCORING_ENGINE_SPEC.md`
- `docs/v2/scoring/V2_ICP_VERSION_RULES_TYPE_SPEC.md`
- `docs/v2/scoring/V2_SCORING_GUARDRAILS.md`
- `docs/v2/scoring/V2_ICP_BENCHMARK_SPEC.md`
- `docs/v2/scoring/V2_CANONICAL_ICP_REGISTRY.md`
