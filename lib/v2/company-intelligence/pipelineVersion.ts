// CINT1: pipeline versioning for company intelligence.
//
// `researchVersion` is the per-(organizationId, companyId) idempotency dimension on
// V2CompanyResearchSnapshot / V2CompanyIntelligenceProfile (UNIQUE) + on the
// COMPANY_ENRICHMENT job idempotency key. The legacy pipeline hard-coded version 1,
// so re-running enrichment after a pipeline change silently REUSED the old snapshot
// and the new logic never ran (the stale-reuse bug).
//
// Deriving researchVersion from COMPANY_INTEL_PIPELINE_VERSION means: bump the
// pipeline version => a new researchVersion => fresh snapshot/profile/score, while
// the SAME version stays idempotent (re-run reuses, no duplicates — Invariant 6).
// Callers that build enrichment jobs should default researchVersion to
// currentResearchVersion() instead of a literal.

export const COMPANY_INTEL_PIPELINE_VERSION = 10;
// 1 = legacy presence-flag pipeline (pricing/careers/news booleans).
// 2 = reasoning-first pipeline (evidence-grounded SDR answers + controlled tokens).
// 9 = de-biased taxonomy (non-tech categories: food_beverage, agriculture_commodities,
//     cpg_consumer_goods, retail_distribution) + Vietnamese aliases + served-vertical
//     agreement. The classification change landed without a version bump, so every
//     enrichment re-run stayed idempotent against version 2 and the new taxonomy never
//     reached the database — the exact stale-reuse failure described above.
//
//     It jumps to 9 rather than 3 because `nextForcedResearchVersion` already burned
//     versions 3-8 on per-company forced refreshes (417 profiles at v3, down to 1 at v8).
//     Reusing any of those would re-enter an existing idempotency key and no-op again.
// 10 = two-tier classification: the taxonomy now settles a sector (TECH / REAL_ECONOMY / SERVICES)
//      before scoring categories, and the classifier reads whole identity pages instead of the
//      400-character citation blurb it was being handed. Measured on a 98-company labelled set:
//      category accuracy 20% -> 64%, sector accuracy 95%, unclassifiable 75 -> 18.
//
//      Nothing in the database reflects this until enrichment is re-run at version 10:
//        node --env-file=.env scripts/reenrich-companies.mjs --limit 4000 --concurrency 8 --apply
//        node --env-file=.env scripts/rescore-icp.mjs --apply

/** The researchVersion the current pipeline writes/reads. */
export function currentResearchVersion(): number {
  return COMPANY_INTEL_PIPELINE_VERSION;
}

/**
 * A force re-enrich (on-demand "Extract intelligence" for a wrong/errored company)
 * needs a researchVersion that is NOT already persisted so the idempotent upsert
 * actually re-runs. Callers pass the company's current max researchVersion; this
 * returns the next version to write (never below the current pipeline version).
 */
export function nextForcedResearchVersion(currentMaxVersion: number | null | undefined): number {
  const base = Math.max(COMPANY_INTEL_PIPELINE_VERSION, currentMaxVersion ?? 0);
  return base + 1;
}
