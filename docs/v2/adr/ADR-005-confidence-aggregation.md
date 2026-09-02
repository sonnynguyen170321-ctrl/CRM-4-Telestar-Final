# ADR-005 — Confidence Aggregation

Status: Draft locked for pilot implementation after V2.2 type review.

## Decision

Confidence is separate from Fit Score. Fit Score measures ICP alignment. Confidence measures trust in the assessment given available evidence.

Pilot confidence formula:

```txt
base = weighted average of evidence reliability values
penalties:
- missing critical field: -0.15 each, capped
- conflicting evidence: -0.20
- stale website evidence: -0.15
- low data quality: -0.10 to -0.30
floor/ceiling: clamp 0..1
```

High confidence requires at least 2 meaningful evidence items unless a terminal hard gate is triggered by high-reliability evidence.

## Consequences

- A company can have high fit score but low confidence.
- Missing data should usually create uncertainty, not false failure.
- Confidence constants are `PILOT_PRIORS_v1`, not measured truth.
