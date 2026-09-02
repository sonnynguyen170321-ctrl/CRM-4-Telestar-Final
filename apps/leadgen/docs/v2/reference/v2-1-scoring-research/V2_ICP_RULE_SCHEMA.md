# V2 ICP Rule Schema

## Purpose

V1 scoring rules are hardcoded across `lib/scoring/scoreCompany.ts` and `lib/scoring/hardRules.ts`. V2 should move rule configuration into a versioned, inspectable ICP rule schema before adding migrations or runtime changes.

This document describes the target rule shape only. It does not change V1 runtime behavior.

## V1 Rule Inventory

### Hard Disqualifier Flags

Current hard-rule flags:

- `solo_company`
- `excluded_country`
- `services_signal`
- `b2c_only_signal`
- `website_offline_signal`
- `personal_email_signal`

Current strong disqualifiers:

- `solo_company`
- `excluded_country`
- `services_signal`
- `website_offline_signal`
- `personal_email_signal`

Current soft/review disqualifier:

- `b2c_only_signal`

### Geography

Positive ICP countries:

- `united states`
- `australia`
- `singapore`
- `norway`
- `switzerland`
- `denmark`
- `sweden`
- `uk`
- `united kingdom`
- `canada`
- `israel`

Aliases:

- `usa`
- `us`
- `u.s.`
- `u.s.a.`
- `uk`

Excluded countries:

- `india`
- `pakistan`
- `bangladesh`
- `philippines`

### Pattern Families

Solo signals:

- `1 employee`
- `solo`
- `solo founder`
- `self-employed`
- `freelancer`

Service signals:

- `services`
- `consulting`
- `agency`
- `outsourcing`
- `outsourced`
- `software development services`
- `design agency`
- `dev shop`
- `it services`

B2C signals:

- `b2c`
- `consumer app`
- `e-commerce store`
- `marketplace`
- `no b2b`
- `no pricing`
- `retail only`

Website offline signals:

- `site not found`
- `website offline`
- `not reachable`
- `unreachable`
- `dead website`
- `broken site`
- `website broken`

Personal email signals:

- `gmail.com`
- `yahoo.com`
- `outlook.com`
- `hotmail.com`

### Type Signal Families

Current type values:

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

CSV-only type patterns:

- `Cloud`: cloud, infrastructure, devops, hosting
- `Blockchain Solution`: blockchain, ledger, crypto, web3
- `AI Solution`: AI, artificial intelligence, machine learning, ML
- `Cyber Security`: cyber, cybersecurity, security
- `Data Solution`: data, analytics, warehouse, BI
- `PAAS`: PaaS, platform as a service
- `SAAS`: SaaS, software, product, platform
- `ITO`: ITO, IT outsourcing

Website type inference is driven by website signal arrays and classification hints.

## Proposed V2 Rule Schema

The rule schema should be versioned and serializable. A future DB table can store it, but V2 design should start as TypeScript/JSON config.

```ts
type IcpRuleSet = {
  id: string;
  name: string;
  version: string;
  status: "draft" | "active" | "archived";
  description?: string;
  allowedCompanyTypes: CompanyType[];
  qualificationValues: Qualification[];
  scoreBands: ScoreBand[];
  geography: GeographyRules;
  hardRules: HardRuleDefinition[];
  typeRules: CompanyTypeRule[];
  websiteRules: WebsiteResearchRuleSet;
  reviewRules: ReviewStateRules;
  sourcePrecedence: SourcePrecedence;
};
```

### Score Bands

```ts
type ScoreBand = {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultQualification: Qualification;
  defaultReviewState: "unreviewed" | "needs_review";
};
```

Recommended V2 baseline bands from the product docs:

- `0-29`: not relevant
- `30-49`: weak fit
- `50-69`: possible fit, review needed
- `70-84`: strong fit
- `85-100`: very strong fit

V1 does not strictly derive all decisions from these bands, so V2 should benchmark before enforcing them globally.

### Geography Rules

```ts
type GeographyRules = {
  positiveCountries: string[];
  positiveCountryAliases: string[];
  excludedCountries: string[];
  adjustments: {
    positiveCountry: number;
    unknownCountry: number;
    nonIcpCountry: number;
  };
};
```

V1 baseline adjustments:

- positive country: `+3`
- unknown country: `-3`
- non-ICP country: `-8`

### Hard Rules

```ts
type HardRuleDefinition = {
  id: string;
  flagKey: string;
  severity: "terminal" | "review" | "warning";
  sourceFields: string[];
  match: {
    type: "regex_any" | "country_contains" | "empty_website" | "custom";
    patterns?: string[];
  };
  result?: {
    companyType?: CompanyType;
    qualification?: Qualification;
    score?: number;
    confidence?: number;
    reviewState?: "unreviewed" | "needs_review";
  };
  reason: string;
};
```

V2 should distinguish:

- terminal disqualifiers
- review-required disqualifiers
- soft warnings

This matters because V1 treats `b2c_only_signal` differently from other hard-rule flags.

### Company Type Rules

```ts
type CompanyTypeRule = {
  companyType: CompanyType;
  priority: number;
  csvPatterns?: string[];
  websiteProductKeywords?: string[];
  websiteServiceKeywords?: string[];
  requiredHints?: string[];
  excludedHints?: string[];
  productLedRequired?: boolean;
  serviceLedAllowed?: boolean;
};
```

V2 should explicitly encode priority. V1 priority is embedded in function order.

### Website Rules

```ts
type WebsiteResearchRuleSet = {
  statuses: Record<
    string,
    {
      outcome: "terminal" | "review" | "continue";
      companyType: CompanyType;
      score: number;
      qualification: Qualification;
      confidence: number;
      reviewState: "unreviewed" | "needs_review";
      reason: string;
    }
  >;
  productSignalThresholds: {
    strong: number;
    veryStrong: number;
  };
  qualityConfidence: Record<"weak" | "medium" | "strong", number>;
};
```

V1 product signal strength counts product, pricing, API, AI, cloud, data, and security signals. V2 should keep this computable but visible.

### Review State Rules

```ts
type ReviewStateRules = {
  terminalDisqualified: "unreviewed" | "needs_review";
  uncertain: "needs_review";
  positiveQualified: "needs_review";
  default: "needs_review";
};
```

V1 usually marks terminal disqualifiers `unreviewed`, but unreachable websites and positive fits often require review.

### Source Precedence

```ts
type SourcePrecedence = {
  officialPrediction: ["CompanyScoreResult"];
  officialFinal: ["FeedbackExample", "CompanyScoreResult"];
  secondOpinion: ["CompanyAiAssessment"];
  companyBrief: ["FeedbackExample", "CompanyAiAssessment", "WebsiteResearchResult", "CompanyScoreResult"];
};
```

The export source of truth must remain:

1. latest `FeedbackExample` final fields
2. latest `CompanyScoreResult`
3. optional `CompanyAiAssessment` only when explicitly exported as AI columns

## Proposed V2 Evaluation Contract

Each rule should produce a structured trace:

```ts
type RuleTraceEntry = {
  ruleId: string;
  stage: "hard_rule" | "geography" | "website" | "type_inference" | "score_band";
  matched: boolean;
  severity?: "terminal" | "review" | "warning";
  scoreDelta?: number;
  resultOverride?: Partial<{
    companyType: CompanyType;
    qualification: Qualification;
    score: number;
    confidence: number;
    reviewState: ReviewState;
  }>;
  evidence: string[];
};
```

V2 can still persist a compact `hardRuleFlags` JSON, but the internal engine should expose a trace for testing, debugging, and feedback learning.

## Migration Guidance

No migration should be created until:

1. V2 rule schema is reviewed.
2. V1 benchmark fixtures are expanded.
3. Source-of-truth precedence is approved.
4. A migration plan defines whether rule versions are stored as code, DB rows, or both.

The first V2 implementation can ship as code-only config if it preserves persisted output shape.
