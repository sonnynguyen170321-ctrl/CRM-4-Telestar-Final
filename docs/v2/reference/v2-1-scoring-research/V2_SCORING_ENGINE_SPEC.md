# V2 Scoring Engine Spec

## Purpose

This document freezes the V1 local scoring behavior as the benchmark for the V2 scoring engine. V2 may improve structure and configurability, but it must preserve these source-of-truth boundaries:

- `CompanyScoreResult` is the local/rule prediction.
- `CompanyAiAssessment` is an AI second opinion only.
- `FeedbackExample` is the SDR final correction and human overlay.
- Export final values use `FeedbackExample` first and `CompanyScoreResult` second.
- AI must not overwrite local score results, SDR feedback, or export final values.

## V1 Entry Points

Primary runtime files:

- `lib/scoring/scoreCompany.ts`
- `lib/scoring/hardRules.ts`
- `lib/scoring/index.ts`
- `lib/client/uploadScoring.ts`
- `lib/client/companyScoreResults.ts`
- `lib/server/companyRecords/rerun.ts`
- `scripts/check-scoring-consistency.mjs`

Primary function:

```ts
scoreCompanyRow(
  row: ParsedCsvRow,
  index: number,
  options?: { websiteResearch?: WebsiteResearchResult | null }
): CompanyScoreResult
```

The upload flow can optionally run website research first, then calls `scoreCompanyRow` with the persisted website research result. Saved V1 score results use:

- `scoringSource`: `rules`
- `scoringVersion`: `local-hard-rules-v1`
- rerun `scoringVersion`: `local-hard-rules-v1-rerun`

## V1 Inputs

`scoreCompanyRow` reads these CSV row keys directly:

- `Company Name`
- `Website`
- `Company Country`
- `Company Industry`
- `Company Staff Count Range`
- `Notes / Tags`
- `Type`

For reruns from a persisted `CompanyRecord`, the server reconstructs a `ParsedCsvRow` from:

- `rawRowJson`
- `companyName`
- `website`
- `companyCountry`
- `companyLinkedInUrl`
- `companyIndustry`
- `companyPhone1`
- `companyStaffCountRange`
- `note`
- persisted row `type`, if present

Optional website research input is a compact deterministic `WebsiteResearchResult` with:

- `status`
- `quality`
- `signals`
- `classificationHints`
- `summary`
- page/error metadata used by UI but not deeply scored in `scoreCompanyRow`

## V1 Outputs

`CompanyScoreResult` returns:

```ts
{
  company_name: string;
  website?: string;
  company_country?: string;
  type: CompanyType;
  note?: string;
  company_score: number;
  qualification: "qualified" | "unqualified" | "uncertain";
  confidence: number;
  reason: string;
  one_sentence_company_summary: string;
  hard_rule_flags: Record<string, boolean>;
  review_state: "unreviewed" | "needs_review" | "reviewed";
}
```

Allowed `CompanyType` values:

- `Not Relevant`
- `PAAS`
- `SAAS`
- `Cloud`
- `ITO`
- `Data Solution`
- `AI Solution`
- `AI Service`
- `Cyber Security`
- `Blockchain Solution`

Database persistence stores the same concepts in `CompanyScoreResult`:

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

## V1 Decision Pipeline

### 1. Extract Fields

The scorer trims direct CSV cell values. If `Company Name` is missing, it falls back to `Company ${index + 1}`.

### 2. Evaluate Hard Rules

`evaluateHardRules` receives normalized company fields and raw row JSON. It returns:

- flags
- triggered flag keys
- `is_disqualified`
- suggested qualification/type
- reason strings

Hard-rule flags:

- `solo_company`
- `excluded_country`
- `services_signal`
- `b2c_only_signal`
- `website_offline_signal`
- `personal_email_signal`

Strong disqualifier flags:

- `solo_company`
- `excluded_country`
- `services_signal`
- `website_offline_signal`
- `personal_email_signal`

`b2c_only_signal` is not currently a strong disqualifier. It produces an uncertain `Not Relevant` result requiring review.

### 3. Assess Country Fit

ICP countries:

- United States
- Australia
- Singapore
- Norway
- Switzerland
- Denmark
- Sweden
- UK / United Kingdom
- Canada
- Israel

Aliases:

- `usa`
- `us`
- `u.s.`
- `u.s.a.`
- `uk`

Country scoring effects:

- ICP country: `+3`
- non-ICP country: `-8`
- missing country: `-3`

Country is a soft adjustment unless an excluded country hard rule fires.

### 4. Assess Website Research

If website research exists, local scoring uses deterministic website evidence before CSV-only fallback.

Website statuses:

- `blocked`: `Not Relevant`, score `10`, unqualified, confidence `0.85`
- `offline`, `timeout`, `invalid_url`, `error`: `Not Relevant`, score `30`, uncertain, confidence `0.65`
- `parked`: `Not Relevant`, score `15`, unqualified, confidence `0.8`
- `empty`: `Not Relevant`, score `25`, unqualified, confidence `0.8`
- service-led without product-led: service classification, score `25`, unqualified, confidence `0.8`
- very strong product evidence: score `88`, qualified, confidence `0.85`
- strong product evidence: score `78`, qualified, confidence `0.75`
- weak product evidence: score `60`, uncertain, confidence `0.55` or `0.65`
- weak/no product evidence: score `40` or `55`, uncertain

Website-driven scores are adjusted by country fit and clamped. If type is `Not Relevant`, the score is capped at `35`.

### 5. Infer Company Type

Website type inference priority:

1. Blockchain product keywords
2. PaaS/developer platform keywords
3. cyber security classification hint
4. AI product classification hint
5. cloud classification hint
6. data solution classification hint
7. SaaS or generic product-led classification hint
8. `Not Relevant`

CSV-only type inference uses the source `Type` if it is allowed, otherwise patterns in industry/type/note text:

- cloud/infrastructure/devops/hosting -> `Cloud`
- blockchain/ledger/crypto/web3 -> `Blockchain Solution`
- AI/machine learning/ML -> `AI Solution`
- cyber/security -> `Cyber Security`
- data/analytics/warehouse/BI -> `Data Solution`
- PaaS phrases -> `PAAS`
- SaaS/software/product/platform -> `SAAS`
- ITO/IT outsourcing -> `ITO`

`ITO` in CSV-only fallback is treated as `Not Relevant`, score `25`, unqualified, confidence `0.55`.

### 6. Produce CSV-Only Fallback

When no hard disqualifier and no website research are available:

- explicit/product-like type signal: score clamped to `50-60`, uncertain, confidence `0.4-0.45`
- no product signal: `Not Relevant`, score `32` for non-ICP or `35` otherwise, uncertain, confidence `0.3-0.35`

This fallback intentionally avoids assigning strong scores without website evidence.

## V1 Edge Cases

- Missing website currently triggers `website_offline_signal`, which is a strong disqualifier.
- `Not Relevant` scores are normalized to at most `35`.
- Website unreachable is not always `unqualified`; it is often `uncertain` with review needed.
- B2C-only signals are uncertain, not terminally unqualified.
- Service-led website evidence can classify as `ITO`, `AI Service`, or `Not Relevant`, but score remains low.
- `Company Industry` fallback can produce a generic one-sentence summary if website research is absent.
- The current website summary string is often shallow: `Website research suggests a ${type} fit with ${quality} signal quality.`
- Multiple score results can exist for a company; consumers should select latest by `createdAt`.
- Feedback does not mutate `CompanyScoreResult`; it is stored separately.
- AI does not mutate `CompanyScoreResult`; it is stored separately.

## V1 Benchmark Tests

Current benchmark script:

```bash
npm run check:scoring-consistency
```

Fixtures currently assert:

- no research and no strong CSV signal remains uncertain and does not score `60`
- `Not Relevant` must not score `60`
- non-ICP country is a soft negative relative to ICP country
- strong SaaS CSV signal remains uncertain without website evidence
- product-led website research raises score above `60`
- service-led website research keeps score `<= 35`

V2 must preserve these behaviors unless a spec change is explicit and covered by new benchmark fixtures.

## V2 Requirements

V2 should keep the external output shape stable but make the internals more explicit:

1. Separate score stages:
   - input normalization
   - hard disqualifiers
   - ICP geography
   - website evidence
   - company type inference
   - score band resolution
   - review-state resolution
2. Return structured evidence alongside the human reason.
3. Preserve `CompanyScoreResult` as local/rule prediction.
4. Keep `CompanyAiAssessment` out of official scoring.
5. Keep `FeedbackExample` as overlay and learning input only.
6. Add benchmark fixtures before changing rule behavior.
7. Make score bands configurable through an ICP/rule schema, not scattered constants.

## Non-Goals For V2 Scoring Engine

- No AI overwrite of official results.
- No mutation of feedback examples.
- No export source-of-truth change.
- No lead-level scoring until company scoring has V2 parity.
- No schema migration until the V2 rule schema and benchmark set are approved.
