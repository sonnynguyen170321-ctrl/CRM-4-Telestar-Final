# Lead Gen Intelligence — V2 Evidence Model Spec

**Status:** Draft for review  
**Purpose:** define how scoring evidence is represented before hard gates, fit score, confidence, and explanations.

## 0. Executive Decision

Do not mix reliability, direction, and weight.

Each evidence item must separate:

```txt
reliability = how much we trust the evidence exists
fit_direction = positive | negative | neutral
fit_weight = how strongly it affects this ICP
source = where the evidence came from
```

## 1. Evidence item shape

```ts
type EvidenceDirection = "positive" | "negative" | "neutral"
type EvidenceSource = "csv" | "website" | "linkedin" | "manual" | "activity" | "ai" | "integration"

type EvidenceItem = {
  key: string
  label: string
  source: EvidenceSource
  reliability: number // 0..1, pilot prior until calibrated
  direction: EvidenceDirection
  weight: number // ICP-specific impact
  value?: string | number | boolean
  matchedText?: string
  url?: string
  detectedAt: string
  evidenceVersion: string
}
```

## 2. Pilot priors

Initial reliability values are pilot priors, not facts.

Examples:

| Evidence | Reliability | Direction | Note |
|---|---:|---|---|
| pricing page found | 0.85 | positive | product maturity signal |
| API/docs page found | 0.85 | positive | technical product signal |
| LinkedIn headcount | 0.90 | neutral/positive | reliable data, direction depends on ICP |
| personal email domain | 0.95 | negative | reliable evidence, negative fit |
| website offline | 0.85 | negative | may be temporary, not always terminal |
| manual SDR correction | 0.95 | neutral | high trust input, not a fit signal by itself |

## 3. Calibration

After enough feedback examples:

```txt
Calculate how often each evidence key agrees with final SDR/Manager outcome.
Compare per ICP.
Version updated reliability policy.
Do not silently change past scores.
```

## 4. Evidence-first rule

Collect evidence before evaluating hard gates.

This prevents service-keyword false negatives:

```txt
Company says "services" but also has platform/pricing/API/product docs.
Result: service_plus_product, not service_only.
```

## 5. ICP0R Evidence Repair

Evidence quality must support separate outputs:

```txt
fitScore
confidenceScore
required evidence readiness
persona readiness
accountPreRank
final qualification
```

Source lineage is metadata/audit only. It must not add confidence points.

Website reachability is not a separate confidence bonus in this phase. Website status should drive `missingWebsitePolicy`, review flags, or hard gates so the same evidence is not double-counted.

### CompanyEvidence

`CompanyEvidence` should retain enough source data for scoring, explanation, and later audit:

```ts
type CompanyEvidence = {
  companyName?: string;
  website?: string;
  canonicalDomain?: string;
  description?: string;
  industry?: string;
  industryTags?: string[];
  companyType?: CompanyType;
  country?: string;
  employeeRange?: string;
  pipelineInferredContext?: string[];
  websiteStatus?: "reachable" | "missing" | "offline" | "unknown";
  personaEvidence?: PersonaEvidence;
};
```

### PersonaEvidence

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

Minimum pilot seniority table:

| Tier | Keywords |
| --- | --- |
| `C_LEVEL` | CEO, Chief, Founder, Co-Founder, Managing Director, General Director, President, COO, CTO, CIO, CMO, CRO, CFO, CISO, CDO, CSO |
| `VP_LEVEL` | VP, Vice President, SVP, EVP |
| `DIRECTOR` | Director, Head of, Lead of, Country Manager, Regional Director |
| `MANAGER` | Manager, Senior Manager, Team Lead |
| `IC` | Engineer, Specialist, Executive, Associate, Assistant, Representative, Coordinator, Analyst |
| `UNKNOWN` | no title or cannot classify |

### CompanyType vs industryTags

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

`industryTags` describe sector/domain signals. Do not expand `CompanyType` into sector enums.

## 6. Evidence summary templates

```txt
Geo: {explicit/inferred/missing/mismatch} - {details}
Industry: {match/partial/missing/mismatch} - {details}
Company type: {match/partial/unknown/mismatch} - {details}
Size: {match/missing/mismatch} - {details}
Persona: {match/missing/mismatch/excluded} - {details}
Hard gate: {none/possible/confirmed} - {details}
```

## 7. AI evidence

AI can summarize or interpret evidence, but AI output is not deterministic evidence unless stored as `AiInsight` with provenance.

HardRuleAssessment must not depend on live AI calls.

Benchmark scripts must not call live AI providers. ChatGPT, Claude, and Gemini assessment fields are imported or human-filled advisory data only.


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
