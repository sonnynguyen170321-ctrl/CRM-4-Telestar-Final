# V2 ICP Version Rules Type Spec

Status: **V2.ICP0R docs-only repair**
Runtime status: **not implemented in this phase**

## 1. Purpose

`IcpVersionRules` defines the rule configuration contract for deterministic ICP scoring. This file is a docs-only contract repair. It does not create schema, migrations, runtime scoring, API, UI, or benchmark scripts.

## 2. Canonical Types

```ts
type Qualification = "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";

type ConfidenceScore = number; // integer 0..100
type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

type AssessmentMode = "COMPANY_PRE_RANK" | "FULL_ICP_QUALIFICATION";

type AccountPreRank =
  | "STRONG_ACCOUNT_FIT"
  | "POSSIBLE_ACCOUNT_FIT"
  | "WEAK_FIT"
  | "CLEAR_MISMATCH";
```

Do not use `uncertain` as canonical qualification output.

## 3. IcpVersionRules Contract

```ts
type IcpVersionRules = {
  schemaVersion: "v1";
  ruleSetId: string;
  displayName: string;

  missingWebsitePolicy: MissingWebsitePolicy;
  geography: GeographyRules;
  companySize: CompanySizeRules;
  hardGates: HardGateRule[];
  positiveSignals: ScoringSignalRule[];
  negativeSignals: ScoringSignalRule[];
  companyTypeRules: CompanyTypeRule[];

  scoringWeights: ScoringWeights;
  confidencePolicy: ConfidencePolicy;
  scorePolicy: ScorePolicy;

  requiredEvidenceForFinalQualification: RequiredEvidenceForFinalQualification;
  blocksFinalQualificationFromCompanyOnlyEvidence: boolean;
};
```

`blocksFinalQualificationFromCompanyOnlyEvidence` default: `false`.

Set it to `true` for persona-sensitive ICPs, including Stratova CXO, Stratova GCP Event, 1CloudHub, Alison, Chainwire Crypto, Chainwire Cyber, TeleStar SDR Outsourcing, BetterHR, Antsomi, FingerMind, and Vedubox.

## 4. Required Evidence For Final Qualification

```ts
type RequiredEvidenceForFinalQualification = {
  explicitGeo: boolean;
  employeeSize: boolean;
  personaTitle: boolean;
  websiteReachable?: boolean;
};
```

Rule:

```txt
If required evidence is missing, qualification cannot be QUALIFIED.
It must be NEEDS_REVIEW unless a confirmed hard disqualifier makes it UNQUALIFIED.
```

Required evidence block table:

| Required flag | Blocks when `missingEvidence` includes |
| --- | --- |
| `explicitGeo=true` | `target_geo_missing`, `target_geo_match_inferred`, `pipeline_inferred_context_only` |
| `employeeSize=true` | `target_size_missing_required` |
| `personaTitle=true` | `target_persona_missing_required`, `target_persona_seniority_mismatch`, `target_persona_excluded_title` |
| `websiteReachable=true` | `website_missing`, `website_offline`, `website_reachability_unknown` |

## 5. Score Policy

```ts
type ScorePolicy = {
  qualifiedMinFitScore: number;
  needsReviewMinFitScore: number;
};
```

Canonical qualification threshold order:

```txt
fitScore >= qualifiedMinFitScore -> QUALIFIED
fitScore >= needsReviewMinFitScore -> NEEDS_REVIEW
else -> UNQUALIFIED
```

Deprecated ambiguous names:

```ts
qualifiedThreshold
unqualifiedThreshold
```

Do not use `icp.thresholds`.

## 6. Confidence Policy

```ts
type ConfidencePolicy = {
  highConfidenceThreshold: number;   // canonical pilot value: 75
  mediumConfidenceThreshold: number; // canonical pilot value: 45
};
```

Confidence bands:

```txt
HIGH: >= 75
MEDIUM: >= 45 and < 75
LOW: < 45
```

The old `0..1` threshold model is deprecated.

## 7. Confidence Evidence Breakdown

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
- `websiteStatus reachable` is not a separate confidence bonus.
- `websiteStatus` should drive `missingWebsitePolicy`, review flags, or hard gates.

## 8. Scoring Weights

```ts
type ScoringWeights = {
  geography: number;
  companyType: number;
  industry: number;
  size: number;
  persona: number;
  positiveSignals: number;
  negativeSignals: number;
};
```

Each fit component returns:

```txt
0 = no match / confirmed mismatch
0.5 = partial, inferred, or weak match
1 = explicit strong match
```

Validation rule:

```txt
geography + companyType + industry + size + persona + positiveSignals = 100
negativeSignals is separate and can be 0-30
```

Future harnesses must fail validation if positive weights do not sum to `100`.

## 9. Company Type And Industry Tags

Do not expand `CompanyType` into hundreds of industry values.

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

Use `industryTags` for sector/domain specifics:

```txt
AVIATION
MRO
FLEET_TECHNICAL
CRYPTO_WEB3
BLOCKCHAIN
DEFI
NFT
CYBERSECURITY
EDTECH
ONLINE_EDUCATION
DEFENSE_SPACE
MANUFACTURING
BFSI
RETAIL
HOSPITALITY
HEALTHCARE
FNB
TELECOM_ISP
CLOUD_INFRA
HR_PAYROLL
ERP_MANUFACTURING
```

Rule:

```txt
CompanyType = business model.
IndustryTags = sector/domain signals.
```

## 10. Persona Evidence

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

Minimum pilot seniority keyword table:

| Tier | Keywords |
| --- | --- |
| `C_LEVEL` | CEO, Chief, Founder, Co-Founder, Managing Director, General Director, President, COO, CTO, CIO, CMO, CRO, CFO, CISO, CDO, CSO |
| `VP_LEVEL` | VP, Vice President, SVP, EVP |
| `DIRECTOR` | Director, Head of, Lead of, Country Manager, Regional Director |
| `MANAGER` | Manager, Senior Manager, Team Lead |
| `IC` | Engineer, Specialist, Executive, Associate, Assistant, Representative, Coordinator, Analyst |
| `UNKNOWN` | no title or cannot classify |

## 11. Hard Disqualifiers

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

## 12. Known Persona-Sensitive ICP Defaults

| ICP | explicitGeo | employeeSize | personaTitle | blocksCompanyOnlyFinalQualification |
| --- | ---: | ---: | ---: | ---: |
| Stratova CXO | true | true | true | true |
| Stratova GCP Event | true | true | true | true |
| 1CloudHub | true | false | true | true |
| Alison | true | false | true | true |
| Chainwire Crypto | true | false | true | true |
| Chainwire Cyber | true | true | true | true |
| TeleStar SDR Outsourcing | true | true | true | true |
| BetterHR | true | true | true | true |
| Antsomi | true | true | true | true |
| FingerMind | true | false | true | true |
| Vedubox | false | true | true | true |

## 13. Example Policy Fragment

```json
{
  "schemaVersion": "v1",
  "ruleSetId": "telestar-sdr-outsourcing-v1",
  "displayName": "TeleStar SDR Outsourcing ICP v1",
  "missingWebsitePolicy": "review_required",
  "scoringWeights": {
    "geography": 20,
    "companyType": 15,
    "industry": 15,
    "size": 15,
    "persona": 25,
    "positiveSignals": 10,
    "negativeSignals": 20
  },
  "confidencePolicy": {
    "highConfidenceThreshold": 75,
    "mediumConfidenceThreshold": 45
  },
  "scorePolicy": {
    "qualifiedMinFitScore": 75,
    "needsReviewMinFitScore": 45
  },
  "requiredEvidenceForFinalQualification": {
    "explicitGeo": true,
    "employeeSize": true,
    "personaTitle": true
  },
  "blocksFinalQualificationFromCompanyOnlyEvidence": true
}
```

## 14. Out Of Scope

- No schema.
- No migrations.
- No runtime scoring functions.
- No API.
- No UI.
- No benchmark runner.
- No live AI calls.
- No V1 changes.
