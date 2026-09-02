# CINT4 transition — company intelligence: wire compiler into live pipeline + scoring

Handoff for Codex. Written 2026-06-21 by Claude (Opus 4.8). Branch
`feature/shared-types`, HEAD `d5e6291`. CINT1–CINT3 done + pushed + green
(typecheck clean, lint 0 errors, build PASS). The reasoning compiler is built and
mock-tested but **NOT wired into the live pipeline** — that is CINT4.

Owner rules (hard):
- Real DB data only — no fake/mock/demo rows. If a field is missing, add a proper
  column with a sensible primary key/index (but CINT4 needs NO schema change; reuse
  existing JSON columns).
- One gate / one change-kind per session (Invariant 12). CINT4 = pipeline wiring +
  scoring. CINT5 (UI) is separate.
- Do NOT change scoring weights, thresholds, qualification values, or workflow
  status. Assessments immutable (Invariant 4): new insert + move `latestHardRuleAssessmentId`.
- Hybrid engine: rules now, LLM slot pluggable + DISABLED this phase. Do NOT add a
  live LLM call in CINT4.

## What CINT1–3 already gives you (entry points — reuse, don't re-build)
- `lib/v2/company-intelligence/reasoning/compile.ts`
  `compileCompanyIntelligence(input: ReasoningInput, {engine?}) => { reasoning, brief, controlledTokens }`
  Default engine = `HybridReasoningEngine` (rules; LLM disabled).
- `lib/v2/company-intelligence/reasoning/contract.ts` — `CompanyIntelligenceReasoning`,
  `ReasoningInput`, `ReasoningEngine`, `EvidenceRef`, `dropUncitedClaims`,
  `emptyReasoning`. Stable, engine-agnostic. Scoring/UI depend only on this.
- `lib/v2/company-intelligence/reasoning/pageModel.ts`
  `extractPageModel({url, html?, text?}) => PageModel` (title/meta/og/H1/H2/JSON-LD +
  classifier `classifyPageType`). Use to turn fetched pages into `ReasoningInput.pages`
  (note `ReasoningInput.pages` uses `headings: string[]`, not `h1` — map `PageModel.h1`
  + `h2s` into `headings`).
- `lib/v2/company-intelligence/search/companyIntelSearch.ts`
  `searchCompanyIntel({companyName, canonicalDomain, country, maxQueriesPerCompany}, deps)`
  + `searchDepsFromEnv(env, fetchImpl)`. Returns normalized results + sanitized
  attempt trace. Env-gated: if `COMPANY_INTEL_SEARCH_ENABLED!=true` or no keys,
  `resolveUsableProviderChain` is empty → no providers → search yields nothing →
  fall back to website-only evidence (still run reasoning).
- `lib/v2/company-intelligence/safeFetch.ts` `safeFetch(url, init, {fetchImpl?, lookup?})`
  — SSRF-safe (per-hop structural + resolved-IP). Use for the real-link crawl.
- `lib/v2/company-intelligence/urlSafety.ts` — structural guard already wired into
  the legacy `fetchWebsite.fetchSinglePage`.
- `lib/v2/company-intelligence/pipelineVersion.ts` `COMPANY_INTEL_PIPELINE_VERSION=2`,
  `currentResearchVersion()`, `nextForcedResearchVersion(currentMax)`.
- `lib/v2/company-intelligence/reasoning/confidenceLink.ts`
  `deriveIntelConfidenceSignal(reasoning) => { evidenceConfidence(0..1), band, hasUsableEvidence }`.
- `lib/v2/company-intelligence/search/scoreSearchResult.ts` — usability + sufficiency
  (already used by the orchestrator).

## CINT4 scope (do, in order)

1. **Real-link crawl** (kills the 404 noise). In `fetchWebsite.ts` (or a new
   `crawlCompanySite.ts` it delegates to): fetch homepage via `safeFetch` (keep
   HTML), `extractPageModel`, then follow REAL internal same-domain links found in
   nav/footer/anchor hrefs — do NOT probe guessed paths like `/careers` `/pricing`.
   Classify each via `classifyPageType`. Cap ≤12 useful pages, respect robots +
   per-domain rate limit (already present), keep the Playwright fallback unchanged.
   Pricing/careers/news count only if a real linked page loaded (advisory only).

2. **Build `ReasoningInput`** from crawled `PageModel[]` (→ `pages`, mapping
   `h1`+`h2s` into `headings`) + `searchCompanyIntel` results (→ `searchResults:
   EvidenceRef[]`, `provider` from the result, `pageType: "SEARCH"`).

3. **Run reasoning** in `runCompanyResearch.ts`: call `searchCompanyIntel`
   (env-gated; website-only if disabled) then `compileCompanyIntelligence` →
   `{ reasoning, brief, controlledTokens }`.

4. **Persist to existing JSON columns** on `V2CompanyIntelligenceProfile`
   (NO schema change) via `companyEnrichmentHandler.ts` / `runCompanyResearch.ts`:
   - `companySummary` = `brief`
   - `classificationJson` = offering (type/vertical/primaryOffering) + businessModel
     + channels + category
   - `evidenceItemsJson` = the cited claims/evidence (offering/partnerships/signals)
   - `factsJson` = `controlledTokens` (the stable vocabulary scoring reads — see #6)
   - `confidenceJson` = `deriveIntelConfidenceSignal(reasoning)` + breakdown
   - `sourceCoverageJson` = provider attempt trace + page coverage (sanitized; NO keys)
   - keep `profileStatus` / `staleAt` semantics.

5. **Versioning / idempotency** (Invariant 6):
   - Default `enqueueCompanyEnrichmentJob` `researchVersion` = `currentResearchVersion()`
     (=2) instead of literal `1` (`lib/v2/company-intelligence/index.ts`). Bumping
     `COMPANY_INTEL_PIPELINE_VERSION` re-enriches; same version stays idempotent
     (reuse). The on-demand "Extract intelligence" (CINT5) uses
     `nextForcedResearchVersion(currentMaxForCompany)`.
   - Keep snapshot/profile UNIQUE `(org, company, researchVersion)`.

6. **Scoring wiring** (no weight/status change):
   - `buildScoringInput` currently consumes `factsJson` via
     `mapNeutralFactsToCompanyEvidence`. ADD mappings for the new controlled tokens
     (`offering.*`, `vertical.*`, `category.*`, `model.*`, `channel.*`, `growth.*`,
     `proof.*`) → company evidence the scorer already understands. Do NOT pass
     arbitrary inputs; only the controlled vocabulary. Do NOT remove/rename existing
     `maturity.*`/fact tokens the scorer reads — map alongside.
   - Feed `deriveIntelConfidenceSignal().evidenceConfidence` into the EXISTING
     confidence breakdown input (the assessment's `confidenceBreakdownJson` /
     `confidence`). Stronger intel ⇒ higher assessment confidence; thin/404 ⇒ lower.
     Find where confidence input is currently weak/defaulted and supply the real value.
   - `inputFingerprint` MUST include the controlled-token set so new intel
     invalidates the cached assessment → re-score; unchanged → reuse.
   - Assessment immutable: new `V2HardRuleAssessment` insert + move
     `latestHardRuleAssessmentId` in one tx (existing pattern).

7. **enrich → score decoupling / batch throughput**: on enrichment completion,
   enqueue `ICP_SCORE` for the company's lead assignments (the source-binding
   pattern already exists in `enqueueCompanyEnrichmentJob` → handler forwards to
   ICP_SCORE). Enrich is the slow stage (throttled, cached); scoring is fast and must
   not block on it. Big batch: enrich fans out in background, scoring drains on
   enriched companies.

## Files likely touched
`fetchWebsite.ts` (+ maybe new `crawlCompanySite.ts`), `runCompanyResearch.ts`,
`companyEnrichmentHandler.ts`, `index.ts` (enqueue default version),
`mapIntelligenceToCompanyEvidence.ts` / `extractFacts.ts`,
`lib/v2/scoring/runtime/buildScoringInput.ts` + the neutral-facts mapper.
Add `scripts/check-v2-company-intel-cint4.mjs` (mock: ReasoningInput build, token→
scoring-evidence mapping, fingerprint-includes-tokens, confidence link).

## Invariants to honor
2 (LeadAssignment unit, no global company score), 4 (assessment immutable, insert +
move latest, full input/rules snapshot), 5 (tenant from session orgId), 6 (idempotent
enrich + score), 7 (NOT_SCORED derived, no placeholder rows, UNCERTAIN deprecated),
8 (soft-delete filters), 9 (keys server-only, never logged), 12 (one gate), 13 (tests
in the exit gate), 16 (V10 execution plan source of truth).

## Gotchas
- **Exa contract**: built per docs.exa.ai; canonical URL returned 403 on Codex's
  earlier check. Re-verify request/response shape on the first live `EXA_API_KEY`
  before trusting `parseExa`. Brave/Serper similarly verify on first live key.
- No live API in default checks (inject fetch/providers). No keys committed.
- Hybrid LLM stays disabled (`DisabledLlmEngine`). Do not wire Anthropic/Exa-deep here.
- Controlled tokens are a stable vocabulary — additive only; scoring + future UI
  depend on them.
- `scratch.ts` untracked at root (ignored). `test.ts` is a tracked debug probe (kept,
  compiles).

## Verification (exit gate)
`npm run typecheck`, `npm run build`, `npm run lint` (expect 0 errors), existing
vitest (`fetchWebsite`, `runCompanyResearch`, scoring snapshot), the new CINT4 smoke,
`git diff --check`. Manual: a company with real evidence yields an identity-first
`companySummary` + controlled tokens in `factsJson` + a re-score whose immutable
snapshot carries the token lineage and a confidence that tracks evidence strength.

## After CINT4 → CINT5 (UI SEE-IT, separate gate)
Shared presenter (`readModel` → presenter) for Company drawer / Lead drawer / Review
/ Compose: business identity first, evidence collapsed, debug secondary. Plus the
`/v2/companies` on-demand **"Extract intelligence"** button (force re-enrich via
`nextForcedResearchVersion` → re-score) for wrong/errored companies.
