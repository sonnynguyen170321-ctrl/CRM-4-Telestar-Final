# V2 Scoring Engine Spec

Status: **V2.ICP0R docs-only repair**
Runtime status: **not implemented in this phase**

## 1. Executive Decision

Implementation is frozen before V2.A2, V2.9, V2.10, runtime scoring, schema, API, UI, and benchmark scripts.

This spec repairs the ICP scoring contract only. It does not authorize runtime code, schema, migrations, UI, API routes, live AI calls, or benchmark runners.

## 2. Canonical Qualification Output

Use the canonical operational enum:

```ts
type Qualification = "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";
```

Meanings:

- `QUALIFIED`: strong ICP match with required evidence present and no confirmed hard disqualifier.
- `NEEDS_REVIEW`: possible fit or incomplete/conflicting evidence requiring SDR/manager review.
- `UNQUALIFIED`: clear mismatch or confirmed hard disqualifier.

Do not use `uncertain` as a canonical qualification output.

## 3. Fit Score, Confidence Score, And Confidence Band

Fit score and confidence score are separate.

```ts
type ConfidenceScore = number; // integer 0..100
type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";
```

Confidence bands:

```txt
HIGH: >= 75
MEDIUM: >= 45 and < 75
LOW: < 45
```

Canonical policy names:

```ts
type ConfidencePolicy = {
  highConfidenceThreshold: 75;
  mediumConfidenceThreshold: 45;
};
```

The old `0..1` confidence threshold model is deprecated for ICP scoring runtime.

## 4. Confidence Evidence Breakdown

Pilot confidence breakdown:

```ts
type ConfidenceEvidenceBreakdown = {
  companyIdentity: number;      // 0-15
  companyEvidence: number;      // 0-25
  geographyEvidence: number;    // 0-20
  employeeSizeEvidence: number; // 0-15
  personaEvidence: number;      // 0-25
};
```

Total: `100`.

`companyIdentity`:

- companyName present: `+5`
- website/domain present: `+10`

`companyEvidence`:

- company description present: `+10`
- industry present: `+10`
- company keywords / product/service evidence present: `+5`

`geographyEvidence`:

- explicit company/contact country present: `+20`
- pipeline-inferred country only: `+6`
- missing country: `+0`
- explicit non-target country: `+20` evidence confidence, but geography fit becomes `0` or a hard gate hit

`employeeSizeEvidence`:

- explicit employee range present: `+15`
- inferred size band only: `+5`
- missing size: `+0`

`personaEvidence`:

- raw title present: `+8`
- seniorityTier parsed: `+8`
- department/titleKeywords parsed: `+6`
- contact location/persona metadata present when relevant: `+3`
- missing persona: `+0`

Repair decisions:

- `personaEvidence` is upgraded from `20` to `25`.
- `sourceLineage` is removed from confidence scoring and is metadata/audit only.
- `websiteStatus reachable` is not a separate confidence bonus in this phase.
- `websiteStatus` should drive `missingWebsitePolicy`, review flags, or hard gates to avoid double-counting.

## 5. Score Policy

Use long-term naming:

```ts
type ScorePolicy = {
  qualifiedMinFitScore: number;
  needsReviewMinFitScore: number;
};
```

Qualification threshold order:

```txt
fitScore >= qualifiedMinFitScore -> QUALIFIED
fitScore >= needsReviewMinFitScore -> NEEDS_REVIEW
else -> UNQUALIFIED
```

Deprecated names:

```ts
qualifiedThreshold
unqualifiedThreshold
```

`unqualifiedThreshold` is ambiguous and is not canonical.

## 6. Fit Component Scoring

Each fit component returns:

```txt
0 = no match / confirmed mismatch
0.5 = partial, inferred, or weak match
1 = explicit strong match
```

Weighted formula:

```ts
const weightedPositiveScore =
  geographyScore       * weights.geography +
  companyTypeScore     * weights.companyType +
  industryScore        * weights.industry +
  sizeScore            * weights.size +
  personaScore         * weights.persona +
  positiveSignalScore  * weights.positiveSignals;

const weightedPenalty =
  negativeSignalScore * weights.negativeSignals;

const fitScore = clamp(Math.round(weightedPositiveScore - weightedPenalty), 0, 100);
```

Validation rule:

```txt
geography + companyType + industry + size + persona + positiveSignals = 100
negativeSignals is separate and can be 0-30
```

If positive weights do not sum to `100`, the future harness must fail validation.

## 7. Assessment Mode

```ts
type AssessmentMode = "COMPANY_PRE_RANK" | "FULL_ICP_QUALIFICATION";
```

`COMPANY_PRE_RANK` is used when evidence is company-level only or missing final required evidence.

`FULL_ICP_QUALIFICATION` is used when available evidence is sufficient to evaluate required ICP gates, or when a confirmed hard disqualifier is present.

Helper contract:

```ts
function deriveAssessmentMode(input, icpRules): AssessmentMode {
  if (hasAllRequiredEvidenceForFinalQualification(input, icpRules)) {
    return "FULL_ICP_QUALIFICATION";
  }

  if (hasConfirmedHardDisqualifier(input, icpRules)) {
    return "FULL_ICP_QUALIFICATION";
  }

  return "COMPANY_PRE_RANK";
}
```

Helper definitions:

```txt
hasAllRequiredEvidenceForFinalQualification returns true only when no required evidence block exists.
hasConfirmedHardDisqualifier returns true when at least one hard disqualifier hit has HIGH or MEDIUM confidence.
```

## 8. Account Pre-Rank

Keep account pre-rank separate from final qualification.

```ts
type AccountPreRank =
  | "STRONG_ACCOUNT_FIT"
  | "POSSIBLE_ACCOUNT_FIT"
  | "WEAK_FIT"
  | "CLEAR_MISMATCH";
```

Pilot thresholds:

```txt
fitScore >= 75 -> STRONG_ACCOUNT_FIT
fitScore >= 50 and < 75 -> POSSIBLE_ACCOUNT_FIT
fitScore >= 25 and < 50 -> WEAK_FIT
fitScore < 25 -> CLEAR_MISMATCH
```

Confirmed hard disqualifier override:

```txt
accountPreRank = CLEAR_MISMATCH
```

unless the hard disqualifier is explicitly configured as review-only.

## 9. Hard Disqualifier Confidence

```ts
type HardDisqualifierHit = {
  id: string;
  label: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidenceSource: string;
};
```

Rules:

- `HIGH` or `MEDIUM` hard disqualifier = confirmed -> `UNQUALIFIED`.
- `LOW` hard disqualifier = possible/ambiguous -> `NEEDS_REVIEW`.

This prevents overall `LOW` confidence from rescuing an explicit confirmed disqualifier.

## 10. Canonical deriveQualification

```ts
function deriveQualification(params: {
  assessmentMode: "COMPANY_PRE_RANK" | "FULL_ICP_QUALIFICATION";
  fitScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  hardDisqualifiersHit: HardDisqualifierHit[];
  missingEvidence: string[];
  icp: IcpVersionRules;
}): "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED" {
  const {
    assessmentMode,
    fitScore,
    confidence,
    hardDisqualifiersHit,
    missingEvidence,
    icp,
  } = params;

  const confirmedHardDisqualifier = hardDisqualifiersHit.some(
    (hit) => hit.confidence === "HIGH" || hit.confidence === "MEDIUM"
  );

  const possibleHardDisqualifier = hardDisqualifiersHit.some(
    (hit) => hit.confidence === "LOW"
  );

  if (confirmedHardDisqualifier) {
    return "UNQUALIFIED";
  }

  if (possibleHardDisqualifier) {
    return "NEEDS_REVIEW";
  }

  if (confidence === "LOW") {
    return "NEEDS_REVIEW";
  }

  if (
    hasRequiredEvidenceBlock(
      icp.requiredEvidenceForFinalQualification,
      missingEvidence
    )
  ) {
    return "NEEDS_REVIEW";
  }

  if (
    assessmentMode === "COMPANY_PRE_RANK" &&
    icp.blocksFinalQualificationFromCompanyOnlyEvidence
  ) {
    return "NEEDS_REVIEW";
  }

  if (fitScore >= icp.scorePolicy.qualifiedMinFitScore) {
    return "QUALIFIED";
  }

  if (fitScore >= icp.scorePolicy.needsReviewMinFitScore) {
    return "NEEDS_REVIEW";
  }

  return "UNQUALIFIED";
}
```

Use `icp.scorePolicy.qualifiedMinFitScore` and `icp.scorePolicy.needsReviewMinFitScore`, not `icp.thresholds`.

## 11. Output Contract

```ts
type IcpAssessment = {
  assessmentMode: "COMPANY_PRE_RANK" | "FULL_ICP_QUALIFICATION";

  accountPreRank:
    | "STRONG_ACCOUNT_FIT"
    | "POSSIBLE_ACCOUNT_FIT"
    | "WEAK_FIT"
    | "CLEAR_MISMATCH";

  qualification: "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";

  fitScore: number;
  confidenceScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";

  companyType: CompanyType;
  industryTags: string[];

  hardDisqualifiersHit: HardDisqualifierHit[];
  positiveSignalsHit: SignalHit[];
  negativeSignalsHit: SignalHit[];

  reasonCodes: string[];
  reviewFlags: string[];
  missingEvidence: string[];

  shortReason: string;
  evidenceSummary: string[];

  inputSnapshot: CompanyEvidence;
  rulesSnapshot: IcpVersionRules;
};

type SignalHit = {
  id: string;
  label: string;
  evidenceSource: string;
};
```

## 12. Reason Codes

Minimum reason codes:

```txt
target_geo_match_explicit
target_geo_match_inferred
target_geo_missing
target_geo_mismatch_explicit

target_industry_match
target_industry_partial_match
target_industry_mismatch
target_industry_missing

target_company_type_match
target_company_type_partial_match
target_company_type_mismatch
target_company_type_unknown

target_size_match
target_size_missing_required
target_size_mismatch

target_persona_match
target_persona_missing_required
target_persona_seniority_mismatch
target_persona_excluded_title

hard_gate_confirmed
hard_gate_possible_low_confidence

weak_company_only_evidence
pipeline_inferred_context_only
unmapped_pipeline_excluded
multi_icp_assessment_deferred
```

## 13. Short Reason Templates

| Pattern | Trigger | Template |
| --- | --- | --- |
| Confirmed hard disqualifier | `hard_gate_confirmed` | Company is unqualified because it matches a confirmed hard disqualifier: `{hardGateLabels}`. |
| Strong account fit but missing required evidence | `accountPreRank=STRONG_ACCOUNT_FIT` + missing required evidence | Company appears to be a strong account fit for `{icpName}`, but final qualification requires `{missingEvidenceLabels}`. |
| Possible fit with weak evidence | `qualification=NEEDS_REVIEW` + `weak_company_only_evidence` | Company may fit `{icpName}`, but available evidence is company-level only and requires review. |
| Explicit geo mismatch | `target_geo_mismatch_explicit` | Company is unqualified for `{icpName}` because explicit geography does not match the ICP. |
| Persona missing | `target_persona_missing_required` | Company may fit the account profile, but target persona/title evidence is missing. |
| Size missing | `target_size_missing_required` | Company may fit the ICP, but required employee size evidence is missing. |
| Industry mismatch | `target_industry_mismatch` | Company is weak or unqualified for `{icpName}` because available industry evidence does not match the target ICP. |
| Final qualified | `qualification=QUALIFIED` | Company is qualified for `{icpName}` based on matching ICP evidence and no confirmed hard disqualifier. |
| Default review | fallback review case | Company requires review for `{icpName}` because available evidence is incomplete or conflicting. |

## 14. Evidence Summary Templates

```txt
Geo: {explicit/inferred/missing/mismatch} - {details}
Industry: {match/partial/missing/mismatch} - {details}
Company type: {match/partial/unknown/mismatch} - {details}
Size: {match/missing/mismatch} - {details}
Persona: {match/missing/mismatch/excluded} - {details}
Hard gate: {none/possible/confirmed} - {details}
```

## 15. AI Boundary

AI agent output is advisory only. It is not production truth and must not overwrite deterministic assessment, SDR review, manager review, feedback examples, or export final fields.

No live AI calls are allowed in this docs-only repair phase.
