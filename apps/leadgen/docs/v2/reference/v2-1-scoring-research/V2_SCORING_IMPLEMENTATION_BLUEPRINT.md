# V2 Scoring Implementation Blueprint

## Scope

This is an implementation blueprint only. It does not change V1 runtime code, Prisma schema, routes, scoring behavior, feedback behavior, AI behavior, or export behavior.

V2 must preserve these source-of-truth rules:

- `CompanyScoreResult` is the local/rule prediction.
- `CompanyAiAssessment` is an AI second opinion only.
- `FeedbackExample` is the SDR final correction and human overlay.
- Export final values use latest `FeedbackExample` first, latest `CompanyScoreResult` second.
- AI must not overwrite SDR final review, feedback, or final export values.

## A. V1 Scoring Code Map

### Runtime Scoring

`lib/scoring/scoreCompany.ts`

- Exports `scoreCompanyRow(row, index, options)`.
- Reads raw CSV keys directly: `Company Name`, `Website`, `Company Country`, `Company Industry`, `Company Staff Count Range`, `Notes / Tags`, and `Type`.
- Calls `evaluateHardRules`.
- Optionally consumes `WebsiteResearchResult`.
- Applies ICP country adjustment.
- Infers company type from website signals or CSV text.
- Produces `CompanyScoreResult`.

Important V1-specific assumptions:

- Missing website is treated as `website_offline_signal` and therefore a strong disqualifier.
- `b2c_only_signal` is not terminal; it returns uncertain `Not Relevant`.
- `Not Relevant` score is capped at `35`.
- Website research quality directly controls score/confidence buckets.
- Confidence is mostly hardcoded by branch, not computed from data coverage.
- Company brief can fall back to shallow website summary text.

Concepts to reuse in V2:

- Deterministic hard gates before AI.
- Country fit as a soft adjustment except excluded countries.
- Website evidence as local/rule evidence.
- Explicit company type allowlist.
- `Not Relevant` score cap.
- Benchmark-first rule changes.

Do not reuse directly in V2:

- Large monolithic `scoreCompanyRow`.
- Scattered hardcoded constants.
- Branch-specific confidence values without explanation.
- Regex arrays embedded in runtime logic.
- Summary generation tied to scoring branches.

`lib/scoring/hardRules.ts`

- Exports `evaluateHardRules(input)`.
- Normalizes input text by trimming, lowercasing, replacing `_` and `/`, and squashing whitespace.
- Produces flags, triggered flags, terminal status, suggested type/qualification, and reason strings.
- Strong disqualifiers are: solo company, excluded country, services signal, website offline signal, personal email signal.

V2 should split this into:

- schema-driven hard gate definitions,
- reusable text/data normalization,
- evidence capture,
- terminal/review/warning severity handling.

`lib/scoring/index.ts`

- Re-exports `scoreCompanyRow`.
- V2 should not replace this until V2 is ready behind an explicit adapter or feature flag.

### Upload Scoring and Persistence

`lib/client/uploadScoring.ts`

- Runs website research per company record with concurrency `3` when persistence is available.
- Calls `scoreCompanyRow` with persisted website research result by source row index.
- Returns scored rows and website research summary.

V1-specific assumption:

- Website research happens before scoring in the upload preview flow, but scoring still works without research.

V2 should keep:

- scoring pure and independent from persistence,
- website research as optional evidence input,
- upload orchestration outside the scoring engine.

`lib/client/companyScoreResults.ts`

- Posts local score results to `/api/company-score-results`.
- Saves `scoringSource: "rules"`.
- Saves `scoringVersion: "local-hard-rules-v1"`.

V2 should create a new version string only after benchmark parity is approved.

`lib/server/companyRecords/rerun.ts`

- Reconstructs a `ParsedCsvRow` from `CompanyRecord`.
- Loads latest website research.
- Calls `scoreCompanyRow`.
- Saves rerun score result with `scoringVersion: "local-hard-rules-v1-rerun"`.

V2 should preserve immutable scoring history and create a new score result on rerun, not mutate older score results.

### Website Research Signal Usage

`lib/scoring/scoreCompany.ts` uses:

- `websiteResearch.status`
- `websiteResearch.quality`
- `websiteResearch.signals`
- `websiteResearch.classificationHints`
- `websiteResearch.summary`

Core signal categories:

- product
- service
- pricing
- API
- AI
- cloud
- data
- security

V2 should separate:

- raw website research result,
- normalized scoring evidence,
- staleness/reliability metadata,
- score impact.

### Company Type Inference

V1 inference is function-order driven:

1. blockchain product keywords
2. PaaS/developer platform keywords
3. cyber security hints
4. AI product hints
5. cloud hints
6. data solution hints
7. SaaS/product-led hints
8. fallback `Not Relevant`

V2 should encode priority in rule data, not function order.

### Confidence Handling

V1 confidence is branch-assigned:

- hard disqualified with research: `0.85`
- hard disqualified without research: `0.8`
- unreachable website: `0.65`
- parked/empty/service-led website: `0.8`
- very strong product evidence: `0.85`
- strong product evidence: `0.75`
- weak product evidence: `0.55-0.65`
- CSV-only product signal: `0.4-0.45`
- CSV-only weak/no product: `0.3-0.35`

V2 should compute confidence separately from fit score using:

- data coverage,
- evidence reliability,
- conflict level,
- recency/staleness,
- rule certainty,
- source quality.

### Score Result Persistence Shape

`CompanyScoreResult` stores:

- `companyRecordId`
- `companyType`
- `companyScore`
- `qualification`
- `confidence`
- `reason`
- `oneSentenceCompanySummary`
- `hardRuleFlags`
- `reviewState`
- `scoringSource`
- `scoringVersion`
- timestamps

V2 should preserve this persisted output until a migration is explicitly approved. Structured V2 internals can be flattened into current fields during a compatibility phase.

### Feedback Save Behavior

`app/api/feedback-examples/route.ts`

- Validates and creates `FeedbackExample`.
- Stores prediction snapshot fields and final SDR fields.
- Stores learning flags and dataset split metadata.
- Does not mutate `CompanyScoreResult`.

`lib/feedback/localFeedback.ts`

- Builds local feedback objects from `CompanyScoreResult`.
- Captures predicted values and final user corrections.

V2 should use feedback as immutable training/evaluation evidence, not as a mutation of prior predictions.

### Export Overlay Behavior

`lib/server/export/companyCsv.ts`

- Default CSV columns use official final values from feedback first, then score result.
- AI columns are appended only when `includeAi=true`.
- AI agreement status compares official value against latest AI assessment but does not change official values.

V2 must not change export precedence.

### Scoring Consistency Test

`scripts/check-scoring-consistency.mjs`

Current benchmark cases:

- no research and no strong CSV signal
- `Not Relevant` should not score `60`
- non-ICP country soft negative
- strong SaaS CSV signal
- website research product signal
- website research service signal

V2 should add tests before changing behavior and keep this script as the V1 parity checkpoint until the new benchmark runner exists.

## B. Proposed V2 File Structure

Suggested initial layout:

```text
lib/v2/scoring/types.ts
lib/v2/scoring/icpRuleSchema.ts
lib/v2/scoring/defaultIcpRules.ts
lib/v2/scoring/normalizeInput.ts
lib/v2/scoring/dataQuality.ts
lib/v2/scoring/signalDetection.ts
lib/v2/scoring/evaluateHardRules.ts
lib/v2/scoring/classifyCompanyType.ts
lib/v2/scoring/computeFitScore.ts
lib/v2/scoring/computeConfidence.ts
lib/v2/scoring/deriveQualification.ts
lib/v2/scoring/explainScore.ts
lib/v2/scoring/evaluateCompany.ts
lib/v2/scoring/adapters/v1OutputAdapter.ts
lib/v2/scoring/testFixtures.ts
lib/v2/scoring/__tests__/dataQuality.test.ts
lib/v2/scoring/__tests__/evaluateHardRules.test.ts
lib/v2/scoring/__tests__/signalDetection.test.ts
lib/v2/scoring/__tests__/classifyCompanyType.test.ts
lib/v2/scoring/__tests__/evaluateCompany.parity.test.ts
```

Responsibilities:

- `types.ts`: shared V2 scoring contracts.
- `icpRuleSchema.ts`: runtime/schema types for versioned ICP rules.
- `defaultIcpRules.ts`: code-based baseline rules matching V1 until DB-backed rule versions exist.
- `normalizeInput.ts`: canonical scoring input from CSV/company/research.
- `dataQuality.ts`: missing data, coverage, freshness, source reliability.
- `signalDetection.ts`: positive and negative signal matching.
- `evaluateHardRules.ts`: terminal/review/warning hard gates.
- `classifyCompanyType.ts`: priority-based type suggestions.
- `computeFitScore.ts`: weighted score calculation.
- `computeConfidence.ts`: confidence calculation separate from fit score.
- `deriveQualification.ts`: score/confidence/rule-state to qualification.
- `explainScore.ts`: deterministic human-readable explanation from trace.
- `evaluateCompany.ts`: orchestration only.
- `adapters/v1OutputAdapter.ts`: maps V2 assessment to current `CompanyScoreResult` shape.
- `testFixtures.ts`: reusable fixture builders.

Do not wire these files into V1 routes until V2 is explicitly approved.

## C. Proposed TypeScript Interfaces

```ts
export type Qualification = "qualified" | "unqualified" | "uncertain";

export type CompanyType =
  | "Not Relevant"
  | "PAAS"
  | "SAAS"
  | "Cloud"
  | "ITO"
  | "Data Solution"
  | "AI Solution"
  | "AI Service"
  | "Cyber Security"
  | "Blockchain Solution";

export type ReviewState = "unreviewed" | "needs_review" | "reviewed";
```

```ts
export type IcpVersionRules = {
  id: string;
  name: string;
  version: string;
  status: "draft" | "active" | "archived";
  allowedCompanyTypes: CompanyType[];
  qualificationValues: Qualification[];
  scoreBands: Array<{
    id: string;
    label: string;
    min: number;
    max: number;
    defaultQualification: Qualification;
    defaultReviewState: Exclude<ReviewState, "reviewed">;
  }>;
  geography: {
    positiveCountries: string[];
    positiveCountryAliases: string[];
    excludedCountries: string[];
    scoreAdjustments: {
      positiveCountry: number;
      unknownCountry: number;
      nonIcpCountry: number;
    };
  };
  hardGates: HardGateRule[];
  positiveSignals: ScoringSignalRule[];
  negativeSignals: NegativeSignalRule[];
  companyTypeRules: CompanyTypeSuggestion[];
  confidence: {
    minimumForQualified: number;
    missingRequiredDataPenalty: number;
    staleResearchPenalty: number;
    conflictPenalty: number;
  };
};
```

```ts
export type HardGateRule = {
  id: string;
  flagKey: string;
  label: string;
  severity: "terminal" | "review" | "warning";
  sourceFields: Array<
    | "companyName"
    | "website"
    | "companyCountry"
    | "companyIndustry"
    | "companyStaffCountRange"
    | "companyLinkedInUrl"
    | "note"
    | "rawText"
  >;
  match:
    | { kind: "regex_any"; patterns: string[] }
    | { kind: "country_contains"; countries: string[] }
    | { kind: "missing_required"; field: string }
    | { kind: "custom"; implementationKey: string };
  result: {
    companyType?: CompanyType;
    qualification?: Qualification;
    maxScore?: number;
    confidenceFloor?: number;
    reviewState?: Exclude<ReviewState, "reviewed">;
  };
  reasonTemplate: string;
};
```

```ts
export type ScoringSignalRule = {
  id: string;
  label: string;
  companyType?: CompanyType;
  source:
    | "csv"
    | "website_research"
    | "company_record"
    | "linkedin"
    | "feedback";
  sourceFields: string[];
  patterns?: string[];
  websiteSignalKeys?: Array<
    | "productSignals"
    | "pricingSignals"
    | "apiSignals"
    | "aiSignals"
    | "cloudSignals"
    | "dataSignals"
    | "securitySignals"
  >;
  weight: number;
  confidenceWeight: number;
  reliability: "high" | "medium" | "low";
  evidenceLabel: string;
};
```

```ts
export type NegativeSignalRule = {
  id: string;
  label: string;
  severity: "disqualifying" | "strong_penalty" | "weak_penalty";
  source:
    | "csv"
    | "website_research"
    | "company_record"
    | "feedback";
  sourceFields: string[];
  patterns?: string[];
  websiteSignalKeys?: Array<"serviceSignals" | "negativeKeywords" | "parkedSignals">;
  penalty: number;
  maxScore?: number;
  reviewState?: Exclude<ReviewState, "reviewed">;
  reasonTemplate: string;
};
```

```ts
export type SignalEvidence = {
  ruleId: string;
  label: string;
  polarity: "positive" | "negative" | "neutral";
  source: "csv" | "website_research" | "company_record" | "feedback" | "ai_second_opinion";
  sourceField?: string;
  value?: string;
  snippet?: string;
  url?: string;
  reliability: "high" | "medium" | "low";
  scoreImpact: number;
  confidenceImpact: number;
};
```

```ts
export type HardRuleAssessmentInput = {
  companyName: string;
  website?: string | null;
  companyCountry?: string | null;
  companyIndustry?: string | null;
  companyStaffCountRange?: string | null;
  companyLinkedInUrl?: string | null;
  note?: string | null;
  rawText?: string | null;
  rawRowJson?: Record<string, unknown> | null;
  websiteResearch?: {
    status?: string | null;
    quality?: "weak" | "medium" | "strong" | string | null;
    normalizedDomain?: string | null;
    finalUrl?: string | null;
    researchedAt?: string | Date | null;
    signals?: Record<string, unknown> | null;
    classificationHints?: Record<string, unknown> | null;
    summary?: string | null;
  } | null;
  rules: IcpVersionRules;
  assessedAt: Date;
};
```

```ts
export type HardRuleAssessmentOutput = {
  terminal: boolean;
  requiresReview: boolean;
  flags: Record<string, boolean>;
  triggeredRuleIds: string[];
  terminalRuleIds: string[];
  warningRuleIds: string[];
  suggestedQualification?: Qualification;
  suggestedCompanyType?: CompanyType;
  maxScore?: number;
  reviewState: Exclude<ReviewState, "reviewed">;
  evidence: SignalEvidence[];
  missingData: MissingDataItem[];
};
```

```ts
export type MissingDataItem = {
  field:
    | "website"
    | "companyCountry"
    | "companyIndustry"
    | "companyStaffCountRange"
    | "companyLinkedInUrl"
    | "websiteResearch"
    | "websiteSignals";
  severity: "required_gate" | "confidence_penalty" | "informational";
  message: string;
  confidencePenalty: number;
};
```

```ts
export type ScoreBreakdown = {
  baseScore: number;
  positiveSignalScore: number;
  negativePenaltyScore: number;
  geographyAdjustment: number;
  dataQualityAdjustment: number;
  cappedScore?: number;
  finalScore: number;
  scoreBand: string;
  evidence: SignalEvidence[];
};
```

```ts
export type CompanyTypeSuggestion = {
  companyType: CompanyType;
  priority: number;
  score: number;
  confidence: number;
  evidence: SignalEvidence[];
  reason: string;
};
```

```ts
export type UncertainReason =
  | "missing_required_gate_data"
  | "low_data_quality"
  | "low_confidence"
  | "conflicting_signals"
  | "weak_product_evidence"
  | "website_unreachable"
  | "b2c_or_marketplace_signal"
  | "non_icp_country_soft_negative"
  | "manual_review_required";
```

```ts
export type DataQualityScoreInput = {
  hasCompanyName: boolean;
  hasWebsite: boolean;
  hasCompanyCountry: boolean;
  hasCompanyIndustry: boolean;
  hasStaffCountRange: boolean;
  hasCompanyLinkedInUrl: boolean;
  hasWebsiteResearch: boolean;
  websiteReachable?: boolean;
  websiteResearchQuality?: "weak" | "medium" | "strong" | string | null;
  websiteResearchAgeDays?: number | null;
  hasProductSignals?: boolean;
  hasServiceSignals?: boolean;
};
```

## D. Proposed Pure Function Signatures

```ts
export function computeDataQualityScore(input: DataQualityScoreInput): {
  score: number;
  level: "low" | "medium" | "high";
  missingData: MissingDataItem[];
  confidenceAdjustment: number;
};
```

```ts
export function evaluateHardGates(
  input: HardRuleAssessmentInput
): HardRuleAssessmentOutput;
```

```ts
export function detectPositiveSignals(input: {
  assessmentInput: HardRuleAssessmentInput;
  rules: ScoringSignalRule[];
}): SignalEvidence[];
```

```ts
export function detectNegativeSignals(input: {
  assessmentInput: HardRuleAssessmentInput;
  rules: NegativeSignalRule[];
}): SignalEvidence[];
```

```ts
export function computeFitScore(input: {
  rules: IcpVersionRules;
  hardRuleAssessment: HardRuleAssessmentOutput;
  positiveEvidence: SignalEvidence[];
  negativeEvidence: SignalEvidence[];
  dataQuality: ReturnType<typeof computeDataQualityScore>;
  companyTypeSuggestion: CompanyTypeSuggestion;
}): ScoreBreakdown;
```

```ts
export function computeConfidence(input: {
  rules: IcpVersionRules;
  dataQuality: ReturnType<typeof computeDataQualityScore>;
  hardRuleAssessment: HardRuleAssessmentOutput;
  positiveEvidence: SignalEvidence[];
  negativeEvidence: SignalEvidence[];
  companyTypeSuggestion: CompanyTypeSuggestion;
  scoreBreakdown: ScoreBreakdown;
}): {
  confidence: number;
  confidenceLevel: "low" | "medium" | "high";
  reasons: string[];
};
```

```ts
export function deriveQualification(input: {
  rules: IcpVersionRules;
  score: number;
  confidence: number;
  hardRuleAssessment: HardRuleAssessmentOutput;
  negativeEvidence: SignalEvidence[];
}): {
  qualification: Qualification;
  reviewState: Exclude<ReviewState, "reviewed">;
  uncertainReason?: UncertainReason;
};
```

```ts
export function classifyCompanyType(input: {
  rules: IcpVersionRules;
  assessmentInput: HardRuleAssessmentInput;
  positiveEvidence: SignalEvidence[];
  negativeEvidence: SignalEvidence[];
}): CompanyTypeSuggestion;
```

```ts
export function evaluateHardRuleAssessment(
  input: HardRuleAssessmentInput
): {
  hardRuleAssessment: HardRuleAssessmentOutput;
  dataQuality: ReturnType<typeof computeDataQualityScore>;
  positiveEvidence: SignalEvidence[];
  negativeEvidence: SignalEvidence[];
  companyTypeSuggestion: CompanyTypeSuggestion;
  scoreBreakdown: ScoreBreakdown;
  confidence: ReturnType<typeof computeConfidence>;
  qualification: ReturnType<typeof deriveQualification>;
};
```

```ts
export function explainAssessment(input: {
  companyName: string;
  hardRuleAssessment: HardRuleAssessmentOutput;
  dataQuality: ReturnType<typeof computeDataQualityScore>;
  companyTypeSuggestion: CompanyTypeSuggestion;
  scoreBreakdown: ScoreBreakdown;
  confidence: ReturnType<typeof computeConfidence>;
  qualification: ReturnType<typeof deriveQualification>;
}): {
  reason: string;
  oneSentenceCompanySummary: string;
  evidenceSummary: string[];
};
```

## E. Scoring Algorithm Pseudocode

```text
function evaluateCompanyV2(input):
  normalized = normalizeInput(input)
  snapshot = createImmutableAssessmentSnapshot(normalized, input.websiteResearch, input.rules.version)

  hardGateAssessment = evaluateHardGates(snapshot)
  dataQuality = computeDataQualityScore(snapshot)

  if hardGateAssessment has terminal gates:
    positiveEvidence = detectPositiveSignals(snapshot) for explanation only
    negativeEvidence = hardGateAssessment.evidence + detectNegativeSignals(snapshot)
    companyType = hardGateAssessment.suggestedCompanyType ?? "Not Relevant"
    score = min(hardGate maxScore ?? 25, 35)
    confidence = computeConfidence using hard gate certainty and data quality
    qualification = "unqualified"
    if missing gate data makes terminal evidence unreliable:
      qualification = "uncertain"
      uncertain_reason = "missing_required_gate_data"
    return assessment snapshot with immutable trace

  missingGateData = required gate data missing from website/country/staff/research
  positiveEvidence = detectPositiveSignals(snapshot)
  negativeEvidence = detectNegativeSignals(snapshot)

  if any negativeEvidence severity is "disqualifying":
    score cap = negative rule maxScore or 35
    qualification = "unqualified" unless data quality is low
    uncertain_reason = "negative_disqualifying_signal" or "low_data_quality"
    return assessment

  companyTypeSuggestion = classifyCompanyType(snapshot, evidence)
  scoreBreakdown = computeFitScore:
    base score
    + weighted positive signals
    - strong negative penalties
    - weak negative penalties
    + geography adjustment
    + data quality adjustment
    apply maxScore caps
    clamp 0..100

  confidence = computeConfidence:
    starts from source coverage
    increases with high-reliability evidence
    decreases with missing fields
    decreases with stale website research
    decreases with conflicting product/service signals
    stays separate from fit score

  qualification = deriveQualification:
    if score >= qualified threshold and confidence >= minimumForQualified:
      qualified
    if score >= qualified threshold but confidence < minimumForQualified:
      uncertain with uncertain_reason = "low_confidence"
    if score in uncertain band:
      uncertain
    if score below weak/unqualified threshold:
      unqualified
    if conflict is high:
      uncertain with uncertain_reason = "conflicting_signals"

  explanation = explainAssessment from trace, not ad hoc branch strings

  return immutable assessment snapshot:
    input snapshot
    rule version
    evidence trace
    score breakdown
    confidence breakdown
    qualification
    uncertain_reason
    v1-compatible output adapter fields
```

Immutable snapshot behavior:

- Every scoring run creates a new assessment/result object.
- Feedback corrections do not mutate old assessments.
- AI assessments become outdated if the local rule assessment version or input fingerprint changes, but remain historical second opinions.
- Exports resolve final values at read time using feedback-first overlay.

## F. Test Plan

At least these named tests should exist before V2 runtime wiring:

1. `perfect_fit_high_confidence`: ICP country, strong product website evidence, pricing/API signal, qualified.
2. `hard_gate_country_fail`: excluded country triggers terminal unqualified.
3. `hard_gate_employee_missing`: missing staff count lowers confidence but does not auto-disqualify unless another gate fires.
4. `hard_gate_solo_company`: one-person company terminally disqualifies.
5. `missing_website_review_required`: missing website becomes review/uncertain if policy changes from V1 terminal behavior.
6. `low_data_quality`: sparse row produces uncertain low confidence.
7. `high_score_low_confidence_downgrade`: strong CSV/product type but missing research downgrades qualified to uncertain.
8. `negative_disqualifying_signal`: service-only website caps score and disqualifies.
9. `strong_negative_penalty`: outsourcing signal lowers score below qualified.
10. `weak_negative_penalty`: non-ICP country reduces score but does not terminally fail.
11. `conflicting_signals`: product and service evidence together produce uncertain.
12. `stale_research`: old website research reduces confidence and marks stale evidence.
13. `project_a_vs_project_b_different_icp`: same company can score differently under two ICP rule versions.
14. `existing_sdr_final_review_not_overwritten`: V2 assessment does not change `FeedbackExample` final fields.
15. `ai_insight_marked_outdated_when_rule_assessment_changes`: AI second opinion remains stored but marked stale/outdated in consumers.
16. `feedback_signal_correction_does_not_mutate_old_assessment`: feedback creates learning signal only.
17. `not_relevant_score_cap`: `Not Relevant` never exceeds score `35`.
18. `b2c_signal_review_not_terminal`: B2C marketplace signal remains uncertain unless configured terminal.
19. `website_unreachable_uncertain`: unreachable site returns uncertain/review state unless hard policy says terminal.
20. `strong_saas_csv_without_research_uncertain`: CSV-only SaaS signal does not become qualified.
21. `strong_product_website_qualified`: product-led website with strong quality and product signals qualifies.
22. `service_led_ai_company_classifies_ai_service`: AI service/consulting is not confused with AI product solution.
23. `cyber_security_type_priority`: security hint wins over generic SaaS when both are present.
24. `blockchain_type_priority`: blockchain product keywords win over generic platform.
25. `export_overlay_unchanged`: final export values resolve feedback-first, score second, AI appended only when requested.

## G. Migration Readiness Notes

Do not create migrations yet. Eventual schema additions likely needed:

### `IcpVersion`

- `id`
- `name`
- `version`
- `status`
- `rulesJson`
- `createdBy`
- `createdAt`
- `activatedAt`
- `archivedAt`

### `HardRuleAssessment`

- `id`
- `companyRecordId`
- `companyScoreResultId`
- `icpVersionId`
- `inputFingerprint`
- `hardGateStatus`
- `hardGateFlagsJson`
- `missingDataJson`
- `positiveEvidenceJson`
- `negativeEvidenceJson`
- `scoreBreakdownJson`
- `confidenceBreakdownJson`
- `uncertainReason`
- `createdAt`

### `FeedbackExample` Additions

- `signalCorrectionsJson`
- `correctedHardGateFlagsJson`
- `correctedCompanyTypeEvidenceJson`
- `learningReviewStatus`
- `learningReviewedBy`
- `learningReviewedAt`

### `CompanyResearchResult` / `WebsiteResearchResult` Evidence Fields

- `evidenceJson`
- `sourceReliability`
- `stalenessStatus`
- `researchFingerprint`
- `researchedAt`
- `expiresAt`

### `RuleImprovementSuggestion`

- `id`
- `sourceFeedbackExampleId`
- `icpVersionId`
- `suggestionType`
- `targetRuleId`
- `proposedChangeJson`
- `benchmarkImpactJson`
- `status`
- `reviewedBy`
- `reviewedAt`
- `createdAt`

## H. Questions for Claude Review

1. Are the score bands correct for the 10-15 user pilot, or should V2 preserve V1 branch-specific bands longer?
2. Are hard gates too strict, especially missing website and service/agency signals?
3. Is the confidence formula clear enough to separate fit score from evidence quality?
4. Are signal evidence and source reliability enough for manager debugging and feedback learning?
5. Are feedback fields enough for learning without creating noisy or unsafe automatic rule updates?
6. Are test cases complete for parity and source-of-truth boundaries?
7. Is anything overbuilt for a 10-15 user pilot?
8. Should ICP geography remain hardcoded for V2 pilot or become configurable immediately?
9. Should stale website research affect only confidence, or also score?
10. Should AI outdated status be derived at read time or persisted after local rule changes?
