# V2 Scoring Claude Review Pack

## Purpose

This review pack summarizes the V1 scoring baseline, the proposed V2 scoring engine, and the exact documents/files Claude should review before implementation begins.

No runtime code has been changed for V2.1 or V2.1B.

## V1 Benchmark Summary

Frozen V1 baseline refs:

- branch: `legacy/v1-company-first`
- tag: `v1-company-first-stable`

Primary V1 benchmark command:

```bash
npm run check:scoring-consistency
```

Current benchmark assertions:

- no research plus no strong CSV signal remains uncertain and low confidence
- `Not Relevant` must not score `60`
- non-ICP country is a soft negative
- strong SaaS CSV signal remains uncertain without website evidence
- product-led website research produces score above `60`
- service-led website research keeps score at or below `35`

## V1 Source-Of-Truth Rules

- `CompanyScoreResult` is local/rule prediction.
- `CompanyAiAssessment` is AI second opinion only.
- `FeedbackExample` is SDR final correction and human overlay.
- Default export uses feedback final values first, local score second.
- `includeAi=true` appends AI columns only.
- AI must not overwrite scoring, feedback, review, or export final values.

## V1 Code Files To Review

Scoring:

- `lib/scoring/scoreCompany.ts`
- `lib/scoring/hardRules.ts`
- `lib/scoring/index.ts`
- `scripts/check-scoring-consistency.mjs`

Upload/persistence:

- `lib/client/uploadScoring.ts`
- `lib/client/companyScoreResults.ts`
- `lib/server/companyRecords/rerun.ts`
- `app/api/company-score-results/route.ts`

Feedback/export:

- `app/api/feedback-examples/route.ts`
- `lib/server/feedback/listFeedbackExamples.ts`
- `lib/feedback/localFeedback.ts`
- `lib/server/export/companyCsv.ts`

AI boundary:

- `lib/server/ai/companyScoring.ts`
- `lib/server/ai/companyAiJobs.ts`
- `lib/server/ai/companyAiInput.ts`

Schema:

- `prisma/schema.prisma`

## Proposed V2 Scoring Engine

The V2 engine should be pure, staged, and benchmarked before route wiring.

Proposed stages:

1. Normalize input.
2. Create immutable input/rule snapshot.
3. Compute data quality.
4. Evaluate hard gates.
5. Detect positive signals.
6. Detect negative signals.
7. Classify company type from evidence.
8. Compute fit score.
9. Compute confidence separately from score.
10. Derive qualification.
11. Explain result from evidence trace.
12. Adapt to current `CompanyScoreResult` output shape.

Critical design change:

- V1 mixes fit, confidence, review state, and explanation inside branches.
- V2 should return structured evidence, score breakdown, confidence breakdown, and uncertain reason.

## Implementation Blueprint Summary

Primary blueprint:

- `docs/V2_SCORING_IMPLEMENTATION_BLUEPRINT.md`

Proposed future file structure:

- `lib/v2/scoring/types.ts`
- `lib/v2/scoring/icpRuleSchema.ts`
- `lib/v2/scoring/defaultIcpRules.ts`
- `lib/v2/scoring/normalizeInput.ts`
- `lib/v2/scoring/dataQuality.ts`
- `lib/v2/scoring/signalDetection.ts`
- `lib/v2/scoring/evaluateHardRules.ts`
- `lib/v2/scoring/classifyCompanyType.ts`
- `lib/v2/scoring/computeFitScore.ts`
- `lib/v2/scoring/computeConfidence.ts`
- `lib/v2/scoring/deriveQualification.ts`
- `lib/v2/scoring/explainScore.ts`
- `lib/v2/scoring/evaluateCompany.ts`
- `lib/v2/scoring/adapters/v1OutputAdapter.ts`
- `lib/v2/scoring/testFixtures.ts`
- `lib/v2/scoring/__tests__/*`

The blueprint includes TypeScript interfaces and pure function signatures for:

- `IcpVersionRules`
- `HardGateRule`
- `ScoringSignalRule`
- `NegativeSignalRule`
- `SignalEvidence`
- `HardRuleAssessmentInput`
- `HardRuleAssessmentOutput`
- `MissingDataItem`
- `ScoreBreakdown`
- `CompanyTypeSuggestion`
- `UncertainReason`
- `DataQualityScoreInput`
- data quality, hard gates, signals, fit score, confidence, qualification, type, assessment, and explanation functions

## Supporting V2 Docs

Claude should also review:

- `docs/V2_SCORING_ENGINE_SPEC.md`
- `docs/V2_ICP_RULE_SCHEMA.md`
- `docs/V2_FEEDBACK_LEARNING_SPEC.md`

## Open Questions

1. Are V2 score bands correct, or should the first implementation preserve V1 branch-specific scores exactly?
2. Should missing website remain a terminal hard gate, or become missing gate data that causes uncertain/manual review?
3. Are service/agency signals too strict for product companies that also offer implementation services?
4. Should country outside ICP be a fixed penalty or rule-configurable by ICP version?
5. Is the confidence formula sufficiently separate from fit score?
6. Should stale website research affect score, confidence, or only UI warnings?
7. Should AI outdated status be derived at read time or persisted?
8. Which feedback fields are required before rule learning can be reliable?
9. Is the proposed migration plan too broad for the first V2 scoring pilot?
10. Which tests must pass before wiring V2 into upload scoring behind a feature flag?

## Review Checklist

Claude should verify:

- V1 benchmark behavior is accurately represented.
- V2 proposed interfaces are not overfit to current V1 implementation.
- Hard gates are explicit and reviewable.
- Score and confidence are separate.
- Evidence/source reliability is sufficient for debugging.
- Feedback learning remains human-reviewed.
- Export source-of-truth remains feedback-first.
- AI remains second opinion only.
- Migration notes are deferred and not required for initial code-only V2.
- The test plan is broad enough to catch source-of-truth regressions.

## Recommended Next Implementation Order

1. Add tests and fixture builders under `lib/v2/scoring`, but do not wire runtime routes.
2. Add V2 type definitions and default code-based ICP rules.
3. Implement pure data quality and hard gate evaluation.
4. Implement signal detection and company type classification.
5. Implement score/confidence/qualification derivation.
6. Add V1 output adapter.
7. Run V1 and V2 parity benchmarks side by side.
8. Only after review, decide whether to add schema support for versioned ICP rules.
