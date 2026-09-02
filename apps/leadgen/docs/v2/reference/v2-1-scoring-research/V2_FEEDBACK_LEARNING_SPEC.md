# V2 Feedback Learning Spec

## Purpose

V1 already stores SDR corrections in `FeedbackExample`. V2 should turn those corrections into an explicit learning and evaluation loop without changing the source of truth.

This document defines the intended feedback learning foundation. It does not change V1 runtime code.

## Source-Of-Truth Boundaries

V2 must preserve these rules:

- `CompanyScoreResult` is the local/rule prediction.
- `CompanyAiAssessment` is an AI second opinion only.
- `FeedbackExample` is the SDR final correction and human overlay.
- Export final values use `FeedbackExample` first and `CompanyScoreResult` second.
- AI must not overwrite feedback, scoring results, or final export values.

## V1 Feedback Model

`FeedbackExample` stores:

- `companyRecordId`
- `companyScoreResultId`
- `feedbackImportJobId`
- `companyName`
- `website`
- `predictedCompanyScore`
- `predictedCompanyType`
- `predictedQualification`
- `predictedReason`
- `finalCompanyScore`
- `finalCompanyType`
- `finalQualification`
- `finalNote`
- `reviewer`
- `approvedForLearning`
- `useForPromptRefinement`
- `useForRuleTuning`
- `useForModelTraining`
- `useForEvaluationBenchmark`
- `datasetSplit`
- `promptVersion`
- `ruleVersion`
- `modelVersion`
- `source`
- `rawExampleJson`
- timestamps

Allowed feedback sources:

- `local_ui`
- `imported_csv`
- `api`

Allowed dataset splits:

- `unspecified`
- `train`
- `eval`
- `holdout`

## V1 Feedback Behavior

Current creation path:

- API route: `POST /api/feedback-examples`
- Validation: `feedbackExampleCreateSchema`
- UI/local helper: `lib/feedback/localFeedback.ts`

Feedback captures both prediction and final correction:

- predicted score/type/qualification/reason
- final score/type/qualification/note

Feedback listing supports filters for:

- final qualification
- final company type
- dataset split
- source
- approved for learning
- upload job
- company record
- company score result
- feedback import job
- search by company/website

Feedback does not mutate `CompanyScoreResult`.

## V1 Export Overlay

The CSV export uses:

1. `latestFeedbackExample.finalCompanyType`, `finalCompanyScore`, `finalQualification`
2. fallback to `scoreResult.companyType`, `companyScore`, `qualification`

The export also keeps predicted fields:

- `Predicted Type`
- `Predicted Score`
- `Predicted Qualification`
- `Predicted Reason`
- `Confidence`
- `Summary`

AI fields are appended only when `includeAi=true`. AI does not replace official final fields.

## V2 Learning Objectives

V2 feedback learning should support:

1. Rule tuning:
   - detect repeated false positives and false negatives by rule/version
   - identify rule flags that often disagree with SDR final labels
   - suggest candidate rule changes for human review
2. Prompt refinement:
   - select approved examples for AI second-opinion prompts
   - compare AI outputs against SDR final labels
   - avoid using unapproved or noisy examples
3. Evaluation benchmark:
   - build stable eval/holdout sets from approved feedback
   - run scoring changes against benchmark before shipping
   - report deltas by qualification, company type, and score band
4. Auditability:
   - preserve original prediction, final correction, reviewer note, rule version, model version, and source

## V2 Feedback Lifecycle

### 1. Capture

Feedback is captured when SDRs correct:

- final qualification
- final company type
- final score
- final note

Required minimum for learning:

- company name
- predicted score/type/qualification
- final score/type/qualification
- source
- timestamp

Recommended but optional:

- company record link
- score result link
- predicted reason
- reviewer
- dataset split
- rule version
- prompt version
- model version
- raw example JSON

### 2. Approve

Only feedback with `approvedForLearning=true` should be used for rule tuning, model training, or prompt refinement.

V2 should keep separate flags:

- `useForRuleTuning`
- `useForPromptRefinement`
- `useForModelTraining`
- `useForEvaluationBenchmark`

Do not infer approval from existence. A correction can be valid for export but not clean enough for learning.

### 3. Split

Dataset split rules:

- `train`: examples available for rule/prompt learning.
- `eval`: examples used for recurring benchmark checks.
- `holdout`: examples reserved for final regression checks.
- `unspecified`: not used in automated learning until curated.

V2 should prevent the same example from simultaneously tuning and validating a change unless explicitly allowed by a reviewer.

### 4. Evaluate

V2 scoring changes should be evaluated against feedback examples with:

- `approvedForLearning=true`
- `useForEvaluationBenchmark=true`
- `datasetSplit in ["eval", "holdout"]`

Metrics:

- qualification accuracy
- company type accuracy
- score mean absolute error
- false qualified rate
- false unqualified rate
- uncertain reduction rate
- high-risk disagreement count

High-risk disagreement examples:

- predicted qualified, final unqualified
- predicted unqualified, final qualified
- predicted score differs by more than 20 points
- predicted `Not Relevant`, final product-led type
- predicted product-led type, final `Not Relevant`

### 5. Propose Changes

V2 may generate candidate changes, but should not apply them automatically.

Candidate change types:

- add/remove hard-rule pattern
- change hard-rule severity
- adjust country score delta
- adjust website signal thresholds
- add type keyword mapping
- change score band threshold
- revise AI second-opinion prompt examples

Every change must be reviewable and benchmarked before activation.

## V2 Benchmark Dataset Shape

Recommended derived benchmark row:

```ts
type FeedbackBenchmarkExample = {
  id: string;
  companyRecordId?: string | null;
  companyName: string;
  website?: string | null;
  inputSnapshot: {
    companyCountry?: string | null;
    companyIndustry?: string | null;
    companyStaffCountRange?: string | null;
    note?: string | null;
    rawRowJson?: Record<string, unknown> | null;
    websiteResearchSnapshot?: Record<string, unknown> | null;
  };
  predicted: {
    score?: number | null;
    companyType?: CompanyType | null;
    qualification?: Qualification | null;
    reason?: string | null;
    ruleVersion?: string | null;
    modelVersion?: string | null;
    promptVersion?: string | null;
  };
  final: {
    score: number;
    companyType: CompanyType;
    qualification: Qualification;
    note?: string | null;
  };
  learningFlags: {
    approvedForLearning: boolean;
    useForRuleTuning: boolean;
    useForPromptRefinement: boolean;
    useForModelTraining: boolean;
    useForEvaluationBenchmark: boolean;
    datasetSplit: "unspecified" | "train" | "eval" | "holdout";
  };
};
```

V1 does not always persist a full input snapshot on feedback. V2 should use linked `CompanyRecord`, `CompanyScoreResult`, and website research history where available.

## V2 Rule Learning Analysis

Recommended reports:

- corrections by final qualification
- corrections by predicted qualification
- confusion matrix for qualification
- confusion matrix for company type
- average score error by type
- hard-rule flag disagreement report
- country false-negative/false-positive report
- website quality disagreement report
- service-led false-positive report
- missing website false-negative/false-positive report

Each report should preserve links back to feedback examples and source company records.

## V2 Prompt Learning Analysis

AI remains second opinion only. Prompt learning should compare `CompanyAiAssessment` with `FeedbackExample`, but never promote AI to source of truth.

Recommended prompt-analysis fields:

- AI qualification vs final qualification
- AI company type vs final company type
- AI score delta vs final score
- AI confidence calibration
- AI reason quality notes, if reviewed
- cache hit vs provider call
- prompt version
- model version

Approved examples can be used for few-shot prompt refinement only when:

- they are marked `approvedForLearning`
- they are marked `useForPromptRefinement`
- they do not contain sensitive/raw unnecessary CSV content

## V2 Acceptance Criteria

Before feedback learning affects runtime scoring:

1. A V2 benchmark runner exists.
2. The runner uses approved eval/holdout feedback only.
3. Current V1 benchmark fixtures still pass or documented differences are approved.
4. Proposed rule changes are reviewed before activation.
5. Export final values remain feedback-first.
6. AI remains second opinion only.
7. Feedback history remains immutable except for metadata flags and review curation fields.

## Non-Goals

- No automatic model training pipeline in V2.1.
- No automatic rule changes from feedback.
- No AI overwrite of final SDR corrections.
- No migration until the V2 learning workflow and benchmark runner are approved.
- No lead-level scoring until company-level V2 behavior is benchmarked.
