/**
 * Exa is a neural engine. Google operators are text to it, not filters.
 *
 * The contact query planner emits `site:linkedin.com/in "CEO" "Saas" Singapore`, which is right
 * for Brave and Serper and wrong here: Exa's own reference says "Use this parameter for domain or
 * path filtering instead of adding a `site:` operator to the query", so the operator is embedded
 * into the semantic query and steers it rather than restricting it. A production contact run came
 * back 200 with pages that were not profiles, `parseContactHits` dropped every one, and the run
 * was written `succeeded` with zero candidates.
 *
 * Note for the next reader: `category: "people"` is a *valid* Exa category and is not the bug —
 * `linkedin profile` is the one that does not exist. The query text was the problem.
 */
import { describe, expect, it } from "vitest";

import { stripUnsupportedOperators } from "@telestar/core-search/search/providers/shared";

describe("stripUnsupportedOperators", () => {
  it("removes a leading site: filter and keeps the meaning of the query", () => {
    const out = stripUnsupportedOperators('site:linkedin.com/in "CEO" "Saas" Singapore');
    expect(out).toBe('"CEO" "Saas" Singapore');
  });

  it("removes negative site: exclusions too", () => {
    const out = stripUnsupportedOperators('software company -site:techradar.com -site:g2.com Vietnam');
    expect(out).toBe('software company Vietnam');
  });

  it("leaves a query that uses no operators exactly as it was", () => {
    const query = 'B2B logistics companies in Singapore with 50-200 employees';
    expect(stripUnsupportedOperators(query)).toBe(query);
  });

  it("keeps quoted phrases, which Exa does use", () => {
    expect(stripUnsupportedOperators('"Head of Growth" fintech')).toBe('"Head of Growth" fintech');
  });

  it("does not leave double spaces or stray edges behind", () => {
    const out = stripUnsupportedOperators('site:linkedin.com/in   "CTO"   -site:x.com  ');
    expect(out).toBe('"CTO"');
  });

  it("never returns an empty query — an operator-only query keeps its operators rather than becoming nothing", () => {
    // Sending "" would search for everything. If stripping leaves nothing, the caller is better
    // served by the original string, which at least carries the domain as a semantic hint.
    const query = 'site:linkedin.com/in';
    expect(stripUnsupportedOperators(query)).toBe(query);
  });
});
