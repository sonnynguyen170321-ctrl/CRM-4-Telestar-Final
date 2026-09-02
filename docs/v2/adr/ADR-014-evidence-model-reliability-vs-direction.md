# ADR-014: Evidence Model - Reliability vs Direction

Status: **V2.ICP0R repaired**

## Context

V2 scoring must collect deterministic evidence before fit score, confidence, qualification, and explanation. Weak ICP benchmark review exposed that evidence quality, source lineage, persona readiness, required evidence, and final qualification were not separated clearly enough.

Implementation is frozen before V2.A2, V2.9, V2.10, runtime scoring, schema, API, UI, and benchmark scripts until this repair is reviewed.

## Decision

Evidence must separate:

```txt
reliability = how much we trust that the evidence exists or was detected correctly
direction = positive | negative | neutral fit direction
weight = scoring impact for the current ICP rule version
source = where the evidence came from
```

These concepts must not be mixed.

Additional ICP0R repair decisions:

- `sourceLineage` is metadata/audit only and not part of confidence scoring.
- Website reachability is not a confidence bonus by itself.
- Website status should drive missing website policy, review flags, or hard gates.
- Persona evidence is first-class scoring evidence for persona-sensitive ICPs.
- Company-only evidence may pre-rank accounts but must not overclaim final `QUALIFIED` for persona-sensitive ICPs.
- AI agent assessment is advisory signal only, not production truth.

## Company Type And Industry Tags

`CompanyType` describes business model:

```ts
type CompanyType =
  | "PRODUCT_SAAS"
  | "PRODUCT_PLATFORM"
  | "SERVICE_ONLY"
  | "SERVICE_PLUS_PRODUCT"
  | "MARKETPLACE"
  | "AGENCY"
  | "UNKNOWN";
```

`industryTags` describe sector/domain signals such as `CRYPTO_WEB3`, `CYBERSECURITY`, `EDTECH`, `CLOUD_INFRA`, `HR_PAYROLL`, and `ERP_MANUFACTURING`.

Do not expand `CompanyType` into a large industry enum.

## Persona Evidence

```ts
type PersonaEvidence = {
  title?: string;
  rawTitle?: string;
  department?: string;
  seniority?: string;
  seniorityTier?: "C_LEVEL" | "VP_LEVEL" | "DIRECTOR" | "MANAGER" | "IC" | "UNKNOWN";
  titleKeywords?: string[];
};
```

Persona evidence contributes up to `25` confidence points in the pilot confidence breakdown.

## Consequences

- Fit score uses direction and weights.
- Confidence score uses evidence presence and quality.
- Final qualification uses fit score, confidence band, hard disqualifiers, required evidence, and assessment mode.
- Explanations must expose reason codes and evidence summary lines.
- Future persistence must store enough evidence detail to support review and feedback learning.
- Old evidence snapshots remain immutable when confidence/evidence policy changes.

## Non-goals

- No schema.
- No migration.
- No runtime scoring implementation.
- No identity resolution implementation.
- No ingestion runtime.
- No live AI calls.
- No V1 behavior change.

## Related files/specs

- `docs/v2/scoring/V2_EVIDENCE_MODEL_SPEC.md`
- `docs/v2/scoring/V2_SCORING_ENGINE_SPEC.md`
- `docs/v2/scoring/V2_ICP_VERSION_RULES_TYPE_SPEC.md`
- `docs/v2/scoring/V2_SCORING_GUARDRAILS.md`
- `docs/v2/scoring/V2_ICP_BENCHMARK_SPEC.md`
- `docs/v2/scoring/V2_CANONICAL_ICP_REGISTRY.md`
